// Reads an article page's Open Graph tags to get its preview image and
// description. Ported from uptime/app/api/site-preview/route.ts with the same
// fallbacks (og:image, then twitter:image; og:title, then <title>; the favicon
// resolved against the page URL), plus og:description. It runs here rather than
// in a Next.js route because extension pages may fetch any site listed in the
// manifest's host_permissions, so no server is needed.
import { load, save } from './store.js';
import { safeUrl, clip, inertHtml } from './ui.js';
import { fetchThroughBackground } from './net.js';

const CACHE_KEY = 'previewCache';
const MAX_ENTRIES = 1000;
const KEEP_FOUND = 7 * 24 * 60 * 60 * 1000;
const KEEP_MISSING = 12 * 60 * 60 * 1000;
const MAX_BYTES = 400_000; // Open Graph tags live in <head>; stop reading once it closes
const TIMEOUT = 8000;
const CONCURRENCY = 4;

let cache = {};
let saveTimer = null;
let active = 0;
const queue = [];
const pending = new Map();

export async function loadPreviews() {
  cache = await load(CACHE_KEY, {});
  const now = Date.now();
  for (const [url, entry] of Object.entries(cache)) {
    const keep = entry.image || entry.description ? KEEP_FOUND : KEEP_MISSING;
    if (now - entry.at > keep) delete cache[url];
  }
}

// The stored preview for a URL, or undefined if the page hasn't been read yet.
export function cachedPreview(url) {
  return cache[url];
}

export function fetchPreview(url) {
  if (cache[url]) return Promise.resolve(cache[url]);
  if (!pending.has(url)) {
    pending.set(url, new Promise((resolve) => {
      queue.push({ url, resolve });
      pump();
    }));
  }
  return pending.get(url);
}

function pump() {
  while (active < CONCURRENCY && queue.length) {
    const { url, resolve } = queue.shift();
    active += 1;
    readPreview(url).then(resolve).finally(() => {
      active -= 1;
      pending.delete(url);
      pump();
    });
  }
}

async function readPreview(url) {
  const page = await fetchHead(url);
  let preview = { title: null, description: null, image: null, favicon: null };
  try {
    if (page) preview = extractPreview(page.html, page.url);
  } catch {
    // Unparseable page: remember it as having no preview.
  }
  // Offline failures aren't remembered, so they're retried once the network is back.
  if (page || navigator.onLine) {
    cache[url] = { ...preview, at: Date.now() };
    persistSoon();
  }
  return preview;
}

async function fetchHead(url) {
  try {
    const res = await fetchThroughBackground(url, {
      timeout: TIMEOUT,
      maxBytes: MAX_BYTES,
      stopAtHeadEnd: true,
      accept: 'text/html,application/xhtml+xml',
    });
    if (!res.ok || !/html/i.test(res.contentType)) return null;
    return { html: res.text, url: res.url };
  } catch {
    return null;
  }
}

export function extractPreview(html, pageUrl) {
  const head = html.split(/<\/head>/i)[0];
  const doc = inertHtml(head);
  const meta = (...keys) => {
    for (const key of keys) {
      const value = doc.querySelector(`meta[property="${key}"], meta[name="${key}"]`)?.getAttribute('content')?.trim();
      if (value) return value;
    }
    return null;
  };
  const iconHref = doc.querySelector('link[rel="icon"], link[rel="shortcut icon"], link[rel~="icon"]')?.getAttribute('href');
  return {
    title: meta('og:title') || doc.querySelector('title')?.textContent.trim() || null,
    description: clip(meta('og:description', 'twitter:description', 'description')) || null,
    image: safeUrl(meta('og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image', 'twitter:image:src'), pageUrl),
    favicon: safeUrl(iconHref || '/favicon.ico', pageUrl),
  };
}

function persistSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const entries = Object.entries(cache);
    if (entries.length > MAX_ENTRIES) {
      entries.sort((a, b) => b[1].at - a[1].at);
      cache = Object.fromEntries(entries.slice(0, MAX_ENTRIES));
    }
    save(CACHE_KEY, cache);
  }, 1000);
}
