// Fetches AI news from RSS/Atom feeds, Hacker News and Hugging Face, and keeps
// the last result in storage so a new tab can show it instantly.
import { FEEDS, AI_PATTERN } from './sources.js';
import { load, save } from './store.js';
import { safeUrl, clip, inertHtml } from './ui.js';
import { fetchThroughBackground } from './net.js';

const CACHE_KEY = 'newsCache';
export const STALE_AFTER = 15 * 60 * 1000;
const PER_FEED = 15;
const MAX_AGE = 14 * 24 * 60 * 60 * 1000;
const MEDIA_NS = 'http://search.yahoo.com/mrss/';

export function cachedNews() {
  return load(CACHE_KEY, null);
}

export async function refreshNews(disabled = []) {
  const enabled = (id) => !disabled.includes(id);
  const jobs = [
    ...FEEDS.filter((f) => enabled(f.id)).map((f) => ({ id: f.id, run: () => fetchFeed(f) })),
    ...(enabled('hn') ? [{ id: 'hn', run: () => fetchHackerNews({ match: AI_PATTERN }) }] : []),
    ...(enabled('papers') ? [{ id: 'papers', run: fetchPapers }] : []),
  ];
  const [results, models] = await Promise.all([
    Promise.allSettled(jobs.map((job) => job.run())),
    enabled('models') ? fetchModels().catch(() => null) : Promise.resolve({ trending: [], top: [] }),
  ]);

  const items = [];
  const failed = [];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') items.push(...result.value);
    else failed.push(jobs[i].id);
  });
  if (models === null) failed.push('models');
  if (jobs.length && !items.length) throw new Error('No news sources could be reached');

  const data = {
    fetchedAt: Date.now(),
    items: dedupe(items).sort((a, b) => b.publishedAt - a.publishedAt),
    models: models || { trending: [], top: [] },
    failed,
  };
  await save(CACHE_KEY, data);
  return data;
}

async function fetchText(url) {
  const res = await fetchThroughBackground(url);
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
  return res.text;
}

export async function fetchJson(url) {
  return JSON.parse(await fetchText(url));
}

// --- RSS and Atom ---------------------------------------------------------

export async function fetchFeed(feed, { limit = PER_FEED } = {}) {
  const doc = new DOMParser().parseFromString(await fetchText(feed.url), 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error(`${feed.name} did not return a feed`);
  const cutoff = Date.now() - MAX_AGE;
  return [...doc.querySelectorAll('item, entry')]
    .map((node) => feedItem(node, feed))
    .filter((item) => item && item.publishedAt > cutoff)
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .slice(0, limit);
}

function feedItem(node, feed) {
  const kids = [...node.children];
  const child = (...names) => kids.find((k) => names.includes(k.localName) && k.namespaceURI !== MEDIA_NS);
  const text = (...names) => child(...names)?.textContent.trim() || '';

  const url = safeUrl(feedLink(kids) || text('guid', 'id'));
  const title = htmlText(text('title'));
  if (!url || !title) return null;

  const summaryHtml = text('description', 'summary');
  const bodyHtml = text('encoded', 'content');
  const summary = parseHtml(summaryHtml || bodyHtml);
  const body = bodyHtml && bodyHtml !== summaryHtml ? parseHtml(bodyHtml) : summary;

  return {
    id: `${feed.id}:${url}`,
    url,
    title,
    description: clip(cleanSummary(textOf(summary))),
    image: mediaImage(node, url) || htmlImage(summary, url) || htmlImage(body, url),
    source: feed.id,
    sourceName: feed.name,
    group: feed.group,
    publishedAt: Date.parse(text('pubDate', 'published', 'updated', 'date')) || 0,
  };
}

function feedLink(kids) {
  const links = kids.filter((k) => k.localName === 'link');
  const atom = links.find((l) => l.getAttribute('href') && ['alternate', null].includes(l.getAttribute('rel')));
  if (atom) return atom.getAttribute('href');
  return links.map((l) => l.textContent.trim()).find(Boolean) || '';
}

function mediaImage(node, base) {
  const candidates = [
    ...[...node.getElementsByTagNameNS(MEDIA_NS, 'content')].filter(
      (m) => (m.getAttribute('medium') || 'image') === 'image' && !/^(video|audio)/.test(m.getAttribute('type') || ''),
    ),
    ...node.getElementsByTagNameNS(MEDIA_NS, 'thumbnail'),
    ...[...node.getElementsByTagName('enclosure')].filter((e) => /^image\//.test(e.getAttribute('type') || '')),
  ];
  for (const candidate of candidates) {
    const url = safeUrl(candidate.getAttribute('url'), base);
    if (url) return url;
  }
  return null;
}

function htmlImage(doc, base) {
  for (const img of doc.querySelectorAll('img')) {
    const width = Number(img.getAttribute('width'));
    const height = Number(img.getAttribute('height'));
    if ((width && width < 40) || (height && height < 40)) continue; // tracking pixels
    const url = safeUrl(img.getAttribute('src') || img.getAttribute('data-src'), base);
    if (url) return url;
  }
  return null;
}

const parseHtml = inertHtml;
const textOf = (fragment) => fragment.textContent.replace(/\s+/g, ' ').trim();
const htmlText = (s) => (/[&<]/.test(s) ? textOf(parseHtml(s)) : s);

function cleanSummary(text) {
  return text
    .replace(/The post .+ appeared first on .+$/i, '')
    .replace(/\s*(Continue reading|Read more)\W*$/i, '')
    .replace(/\[(…|\.\.\.)\]$/, '…')
    .trim();
}

// --- Hacker News, Hugging Face ---------------------------------------------

export async function fetchHackerNews({ query = '', match = null, days = 2, minPoints = 40, limit = 30 } = {}) {
  const since = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
  const params = new URLSearchParams({
    tags: 'story',
    query,
    numericFilters: `created_at_i>${since},points>${minPoints}`,
    hitsPerPage: query ? '50' : '300',
  });
  const { hits } = await fetchJson(`https://hn.algolia.com/api/v1/search?${params}`);
  return hits
    .filter((hit) => hit.title && (!match || match.test(hit.title)))
    .sort((a, b) => b.points - a.points)
    .slice(0, limit)
    .map((hit) => {
      const discussionUrl = `https://news.ycombinator.com/item?id=${hit.objectID}`;
      return {
        id: `hn:${hit.objectID}`,
        url: safeUrl(hit.url) || discussionUrl,
        title: hit.title,
        description: '',
        image: null,
        source: 'hn',
        sourceName: 'Hacker News',
        group: 'hn',
        publishedAt: hit.created_at_i * 1000,
        points: hit.points,
        comments: hit.num_comments,
        discussionUrl,
      };
    });
}

async function fetchPapers() {
  const list = await fetchJson('https://huggingface.co/api/daily_papers?limit=30');
  return list
    .filter((entry) => entry?.paper?.id)
    .sort((a, b) => (b.paper.upvotes || 0) - (a.paper.upvotes || 0))
    .slice(0, 20)
    .map(({ paper, title, thumbnail, numComments, publishedAt }) => ({
      id: `papers:${paper.id}`,
      url: `https://huggingface.co/papers/${encodeURIComponent(paper.id)}`,
      title: title || paper.title,
      description: clip(paper.ai_summary || paper.summary),
      image: safeUrl(thumbnail),
      source: 'papers',
      sourceName: 'Hugging Face Papers',
      group: 'papers',
      publishedAt: Date.parse(publishedAt || paper.publishedAt) || Date.now(),
      points: paper.upvotes || 0,
      comments: numComments || 0,
    }));
}

// Two lists from Hugging Face: what's trending now, and what's used most
// (downloads over the last 30 days).
async function fetchModels() {
  const [trending, top] = await Promise.all([
    fetchJson('https://huggingface.co/api/models?sort=trendingScore&limit=12'),
    fetchJson('https://huggingface.co/api/models?sort=downloads&limit=12'),
  ]);
  return { trending: trending.map(modelItem), top: top.map(modelItem) };
}

function modelItem(m) {
  const [org, name] = m.id.includes('/') ? m.id.split(/\/(.+)/) : ['', m.id];
  const path = m.id.split('/').map(encodeURIComponent).join('/');
  const task = m.pipeline_tag ? m.pipeline_tag.replace(/-/g, ' ') : null;
  return {
    id: `model:${m.id}`,
    url: `https://huggingface.co/${path}`,
    title: name,
    description: task ? `${task.charAt(0).toUpperCase()}${task.slice(1)} model${org ? ` from ${org}` : ''}.` : '',
    image: `https://cdn-thumbnails.huggingface.co/social-thumbnails/models/${path}.png`,
    source: 'models',
    sourceName: org || 'Hugging Face',
    coverText: name,
    publishedAt: Date.parse(m.createdAt) || null,
    metaExtra: [`${compactNumber(m.likes)} likes`, `${compactNumber(m.downloads)} downloads`],
    group: 'models',
  };
}

const compactNumber = (n) => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0);

// The same story often appears in a feed and on Hacker News. Keep the feed's
// version (it has an image and summary) and attach the HN points to it.
function dedupe(items) {
  const seen = new Map();
  for (const item of items) {
    const key = normalizeUrl(item.url);
    const existing = seen.get(key);
    if (!existing) seen.set(key, item);
    else if (item.source === 'hn' && existing.source !== 'hn') {
      Object.assign(existing, { points: item.points, comments: item.comments, discussionUrl: item.discussionUrl });
    }
  }
  return [...seen.values()];
}

export function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    [...u.searchParams.keys()].filter((k) => k.startsWith('utm_')).forEach((k) => u.searchParams.delete(k));
    return `${u.host.replace(/^www\./, '')}${u.pathname.replace(/\/$/, '')}${u.search}`.toLowerCase();
  } catch {
    return url;
  }
}
