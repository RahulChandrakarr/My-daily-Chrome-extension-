// Articles from DEV Community (dev.to) for a topic, most-liked first.
// dev.to rate-limits bursts, so its answers are cached (an hour for this
// week's top articles, longer for older ones) and fetched two at a time.
import { load, save } from './store.js';
import { topicHue } from './topics.js';
import { safeUrl, clip } from './ui.js';

const CACHE_KEY = 'devtoCache';
const TTL = { 7: 60 * 60 * 1000, 30: 6 * 60 * 60 * 1000, 365: 24 * 60 * 60 * 1000 };
let cache = null;
let saveTimer = null;
let active = 0;
const queue = [];

// `days` is 7, 30 or 365: the window dev.to ranks "top" articles over.
export async function devtoArticles(topic, days) {
  const results = await Promise.allSettled(topic.tags.map((tag) => devtoTag(tag, days)));
  if (results.every((r) => r.status === 'rejected')) throw new Error('dev.to unreachable');
  const articles = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  // Small tags have little in a month; look back further for those.
  if (articles.length < 6 && days < 365) return devtoArticles(topic, 365);
  const ids = new Set();
  return articles
    .filter((a) => !ids.has(a.id) && ids.add(a.id))
    .sort((a, b) => (b.positive_reactions_count || 0) - (a.positive_reactions_count || 0))
    .map((a) => ({
      id: `devto:${a.id}`,
      url: safeUrl(a.url),
      title: a.title,
      description: clip(a.description),
      image: safeUrl(a.cover_image || a.social_image),
      source: 'devto',
      sourceName: 'DEV Community',
      publishedAt: Date.parse(a.published_at) || null,
      readingTime: a.reading_time_minutes,
      points: a.positive_reactions_count,
      topicId: topic.id,
      hue: topicHue(topic),
    }))
    .filter((a) => a.url);
}

async function devtoTag(tag, days) {
  cache ??= await load(CACHE_KEY, {});
  const key = `${tag}:${days}`;
  const hit = cache[key];
  if (hit && Date.now() - hit.at < TTL[days]) return hit.articles;
  const url = `https://dev.to/api/articles?tag=${encodeURIComponent(tag)}&top=${days}&per_page=30`;
  const raw = await new Promise((resolve, reject) => {
    queue.push({ url, resolve, reject });
    pump();
  });
  const articles = raw.map((a) => ({
    id: a.id,
    url: a.url,
    title: a.title,
    description: a.description,
    cover_image: a.cover_image,
    social_image: a.social_image,
    published_at: a.published_at,
    reading_time_minutes: a.reading_time_minutes,
    positive_reactions_count: a.positive_reactions_count,
  }));
  cache[key] = { at: Date.now(), articles };
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    for (const [k, entry] of Object.entries(cache)) {
      if (Date.now() - entry.at > TTL[365]) delete cache[k];
    }
    save(CACHE_KEY, cache);
  }, 1000);
  return articles;
}

function pump() {
  while (active < 2 && queue.length) {
    const job = queue.shift();
    active += 1;
    fetchWithRetry(job.url).then(job.resolve, job.reject).finally(() => {
      active -= 1;
      pump();
    });
  }
}

async function fetchWithRetry(url, attempt = 0) {
  const res = await fetch(url, { credentials: 'omit' });
  if (res.status === 429 && attempt < 2) {
    await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
    return fetchWithRetry(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`dev.to returned ${res.status}`);
  return res.json();
}
