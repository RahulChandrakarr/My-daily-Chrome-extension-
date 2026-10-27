// Suggestions for the Learning tab: the videos and posts getting the most
// attention this week in your interests.
//   Videos come from each interest's YouTube channels, read from YouTube's
//   public channel feeds (no API key needed), and are ranked by "hype": views,
//   weighted toward videos that got them quickly.
//   Posts come from Hacker News, DEV Community and Lobsters, ranked by each
//   site's own points, reactions or score.
import { load, save } from './store.js';
import { fetchThroughBackground } from './net.js';
import { fetchHackerNews, fetchJson, normalizeUrl } from './news.js';
import { devtoArticles } from './devto.js';
import { topicHue, topicMatcher } from './topics.js';
import { safeUrl, clip } from './ui.js';

const CACHE_KEY = 'suggestions';
export const SUGGESTIONS_STALE = 45 * 60 * 1000;
const VIDEO_MAX_AGE = 14 * 24 * 60 * 60 * 1000;
const YT_NS = 'http://www.youtube.com/xml/schemas/2015';
const MEDIA_NS = 'http://search.yahoo.com/mrss/';

export function cachedSuggestions() {
  return load(CACHE_KEY, null);
}

export async function refreshSuggestions(interests) {
  const [videoLists, posts] = await Promise.all([
    Promise.all(interests.map((t) => topicVideos(t).catch(() => []))),
    hypedPosts(interests).catch(() => []),
  ]);
  const videos = Object.fromEntries(interests.map((t, i) => [t.id, videoLists[i]]));
  if (!videoLists.some((list) => list.length) && !posts.length) throw new Error('No suggestions could be loaded');
  const data = { fetchedAt: Date.now(), videos, posts };
  await save(CACHE_KEY, data);
  return data;
}

// The highest-hype videos, with at most `perChannel` from one channel and
// `perTopic` from one topic, so a single big channel doesn't fill the row.
// If that leaves gaps, a second pass lets channels add more.
export function pickVideos(videos, count, { perChannel = 1, perTopic = Infinity } = {}) {
  const ranked = [...videos].sort((a, b) => b.hype - a.hype);
  const channels = new Map();
  const topics = new Map();
  const picked = [];
  for (const channelLimit of [perChannel, Infinity]) {
    for (const video of ranked) {
      if (picked.length >= count) break;
      if (picked.includes(video)) continue;
      if ((channels.get(video.sourceName) || 0) >= channelLimit || (topics.get(video.topicId) || 0) >= perTopic) continue;
      channels.set(video.sourceName, (channels.get(video.sourceName) || 0) + 1);
      topics.set(video.topicId, (topics.get(video.topicId) || 0) + 1);
      picked.push(video);
    }
  }
  return picked.sort((a, b) => b.hype - a.hype);
}

// --- YouTube -------------------------------------------------------------------

async function topicVideos(topic) {
  const results = await Promise.allSettled((topic.channels || []).map((c) => channelVideos(c, topic)));
  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}

async function channelVideos(channel, topic) {
  const res = await fetchThroughBackground(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channel.id)}`);
  if (!res.ok) throw new Error(`YouTube returned ${res.status} for ${channel.name}`);
  const doc = new DOMParser().parseFromString(res.text, 'application/xml');
  const cutoff = Date.now() - VIDEO_MAX_AGE;
  return [...doc.querySelectorAll('entry')]
    .map((entry) => videoItem(entry, channel, topic))
    .filter((video) => video && video.publishedAt > cutoff);
}

function videoItem(entry, channel, topic) {
  const videoId = entry.getElementsByTagNameNS(YT_NS, 'videoId')[0]?.textContent.trim();
  const title = entry.querySelector('title')?.textContent.trim();
  const link = entry.querySelector('link')?.getAttribute('href') || '';
  if (!videoId || !/^[\w-]{6,20}$/.test(videoId) || !title) return null;
  if (link.includes('/shorts/') || /#shorts/i.test(title)) return null;
  const publishedAt = Date.parse(entry.querySelector('published')?.textContent) || 0;
  const views = Number(entry.getElementsByTagNameNS(MEDIA_NS, 'statistics')[0]?.getAttribute('views')) || 0;
  const hours = Math.max((Date.now() - publishedAt) / 3_600_000, 6);
  const description = entry.getElementsByTagNameNS(MEDIA_NS, 'description')[0]?.textContent || '';
  return {
    id: `yt:${videoId}`,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    title,
    description: clip(videoSummary(description), 200),
    image: `https://i.ytimg.com/vi/${videoId}/hq720.jpg`,
    imageFallback: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
    source: 'youtube',
    sourceName: channel.name,
    publishedAt,
    views,
    hype: views / hours ** 0.75,
    topicId: topic.id,
    hue: topicHue(topic),
    kind: 'video',
    video: true,
  };
}

// Video descriptions often open with a sponsor plug or a list of links; use the
// first paragraph that's neither.
const PROMO = /https?:\/\/|sponsor|% off|use code|promo|discount|patreon|subscribe|merch|affiliate/i;

function videoSummary(description) {
  return description.split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !PROMO.test(p)) || '';
}

// --- Posts ------------------------------------------------------------------------

async function hypedPosts(interests) {
  const topicFor = (title, tags = []) => interests.find((t) => (t.lobsters || []).some((tag) => tags.includes(tag)))
    || interests.find((t) => topicMatcher(t).test(title));

  const [hn, devto, lobsters] = await Promise.allSettled([
    fetchHackerNews({ days: 3, minPoints: 80, limit: 300 }),
    Promise.all(interests.map((t) => devtoArticles(t, 7).then((list) => list.slice(0, 5)).catch(() => []))),
    fetchJson('https://lobste.rs/hottest.json'),
  ]);

  const lists = [];
  if (hn.status === 'fulfilled') {
    lists.push(hn.value.map((item) => ({ ...item, topic: topicFor(item.title) })).filter((item) => item.topic));
  }
  if (devto.status === 'fulfilled') {
    lists.push(devto.value.flat().sort((a, b) => (b.points || 0) - (a.points || 0))
      .map((item) => ({ ...item, topic: interests.find((t) => t.id === item.topicId) })));
  }
  if (lobsters.status === 'fulfilled' && Array.isArray(lobsters.value)) {
    lists.push(lobsters.value
      .map((story) => ({
        id: `lobsters:${story.short_id}`,
        url: safeUrl(story.url) || safeUrl(story.comments_url),
        title: story.title,
        description: clip(story.description_plain || ''),
        image: null,
        source: 'lobsters',
        sourceName: 'Lobsters',
        publishedAt: Date.parse(story.created_at) || null,
        points: story.score,
        comments: story.comment_count,
        discussionUrl: safeUrl(story.comments_url),
        topic: topicFor(story.title, story.tags || []),
      }))
      .filter((item) => item.url && item.topic)
      .sort((a, b) => b.points - a.points));
  }

  // Take each site's best in turn, so the list mixes all three.
  const posts = [];
  const urls = new Set();
  for (let i = 0; lists.some((list) => i < list.length); i += 1) {
    for (const list of lists) {
      const item = list[i];
      if (!item || urls.has(normalizeUrl(item.url))) continue;
      urls.add(normalizeUrl(item.url));
      const { topic, ...rest } = item;
      posts.push({ ...rest, topicId: topic.id, hue: topicHue(topic), kind: 'post' });
    }
  }
  return posts.slice(0, 30);
}
