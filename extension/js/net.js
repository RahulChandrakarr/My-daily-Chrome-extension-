// Fetches feeds and article pages through the background service worker. Many
// sites send `Link: rel=preload` headers, and a fetch made from this page would
// make Chrome download their fonts and scripts for nothing; the service worker
// has no page, so those headers are ignored there.

export async function fetchThroughBackground(url, options = {}) {
  const res = await chrome.runtime.sendMessage({ type: 'fetch-text', url, ...options });
  if (!res) throw new Error(`No response for ${url}`);
  if (res.error) throw new Error(res.error);
  return res; // { ok, status, url, contentType, text }
}
