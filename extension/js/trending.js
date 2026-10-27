// "Trending on GitHub", under the to-do list: the repos on github.com/trending,
// with how many stars each gained today, this week or this month. GitHub has
// no API for this page, so the extension reads the page itself (through the
// background service worker, see net.js) and keeps the result for an hour.
import { load, save } from './store.js';
import { fetchThroughBackground } from './net.js';
import { el, inertHtml, compact } from './ui.js';

const CACHE_KEY = 'githubTrending';
const FILTER_KEY = 'githubTrendingFilter';
const STALE = 60 * 60 * 1000;
const SHOWN = 8;
const RANGES = [['daily', 'Today', 'today'], ['weekly', 'Week', 'this week'], ['monthly', 'Month', 'this month']];
const LANGUAGES = [['', 'Any language'], ['typescript', 'TypeScript'], ['javascript', 'JavaScript'], ['python', 'Python'], ['go', 'Go'], ['rust', 'Rust']];
const $ = (id) => document.getElementById(id);
const numberFormat = new Intl.NumberFormat();

let filter = { since: 'daily', language: '' };
let repos = null;
let loading = false;
let failed = false;
let showAll = false;

export async function initTrending() {
  filter = { ...filter, ...(await load(FILTER_KEY, {})) };
  $('trending-language').replaceChildren(...LANGUAGES.map(([value, label]) => el('option', '', { value, text: label })));
  $('trending-language').value = filter.language;
  $('trending-language').addEventListener('change', (e) => setFilter({ language: e.target.value }));
  $('trending-more').addEventListener('click', () => {
    showAll = !showAll;
    render();
  });
  renderRanges();
  await refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, 10 * 60 * 1000);
}

function setFilter(changes) {
  filter = { ...filter, ...changes };
  save(FILTER_KEY, filter);
  showAll = false;
  renderRanges();
  refresh();
}

const keyOf = (f) => `${f.language}:${f.since}`;
const pageUrl = (f) => `https://github.com/trending${f.language ? `/${encodeURIComponent(f.language)}` : ''}?since=${f.since}`;

async function refresh() {
  const wanted = { ...filter };
  const cache = await load(CACHE_KEY, {});
  const hit = cache[keyOf(wanted)];
  repos = hit?.repos || null;
  failed = false;
  if (hit && Date.now() - hit.fetchedAt < STALE) {
    render();
    return;
  }
  loading = true;
  render();
  try {
    const res = await fetchThroughBackground(pageUrl(wanted), { timeout: 15000 });
    if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
    const parsed = parseTrending(res.text);
    if (!parsed.length) throw new Error('No repos found on the page');
    cache[keyOf(wanted)] = { fetchedAt: Date.now(), repos: parsed };
    await save(CACHE_KEY, cache);
    if (keyOf(wanted) === keyOf(filter)) repos = parsed; // the filter may have changed meanwhile
  } catch {
    if (keyOf(wanted) === keyOf(filter)) failed = !repos;
  } finally {
    loading = false;
    render();
  }
}

// Reads the repo rows from github.com/trending.
export function parseTrending(html) {
  const doc = inertHtml(html);
  const number = (node) => Number((node?.textContent || '').replace(/[^\d]/g, '')) || 0;
  return [...doc.querySelectorAll('article.Box-row')].map((row) => {
    const [owner, name] = (row.querySelector('h2 a')?.getAttribute('href') || '').replace(/^\/+/, '').split('/');
    if (!owner || !name) return null;
    const color = (row.querySelector('.repo-language-color')?.getAttribute('style') || '').match(/#[0-9a-f]{3,8}\b/i)?.[0] || null;
    return {
      owner,
      name,
      url: `https://github.com/${owner}/${name}`,
      description: row.querySelector('p')?.textContent.replace(/\s+/g, ' ').trim() || '',
      language: row.querySelector('[itemprop="programmingLanguage"]')?.textContent.trim() || '',
      color,
      stars: number(row.querySelector('a[href$="/stargazers"]')),
      gained: number(row.querySelector('.float-sm-right')),
    };
  }).filter(Boolean);
}

function renderRanges() {
  $('trending-range').replaceChildren(...RANGES.map(([since, label]) => {
    const button = el('button', '', { type: 'button', 'aria-pressed': String(filter.since === since), text: label });
    button.addEventListener('click', () => setFilter({ since }));
    return button;
  }));
  $('trending-open').href = pageUrl(filter);
}

function render() {
  const list = $('trending-list');
  const more = $('trending-more');
  const period = RANGES.find(([since]) => since === filter.since)[2];
  $('trending-status').textContent = loading ? 'Updating…' : `Stars gained ${period}`;
  if (!repos) {
    more.hidden = true;
    list.replaceChildren(el('li', 'trend-empty', {
      text: failed ? 'Couldn\'t load GitHub Trending. It tries again in a few minutes.' : 'Loading GitHub Trending…',
    }));
    return;
  }
  list.replaceChildren(...(showAll ? repos : repos.slice(0, SHOWN)).map((repo) => {
    const li = el('li', 'trend-repo');
    const head = el('div', 'trend-repo-head');
    const link = el('a', 'trend-repo-link', { href: repo.url });
    link.append(
      el('img', 'trend-avatar', { src: `https://github.com/${encodeURIComponent(repo.owner)}.png?size=40`, alt: '', width: 20, height: 20, loading: 'lazy', referrerpolicy: 'no-referrer' }),
      el('span', 'trend-repo-name', { text: `${repo.owner}/${repo.name}` }),
    );
    head.append(link, el('span', 'trend-gained', { text: `+${numberFormat.format(repo.gained)}`, title: `${numberFormat.format(repo.gained)} stars ${period}` }));
    li.append(head);
    if (repo.description) li.append(el('p', 'trend-desc', { text: repo.description }));
    const meta = el('div', 'trend-meta');
    if (repo.language) {
      const lang = el('span', 'trend-lang', { text: repo.language });
      if (repo.color) lang.style.setProperty('--lang', repo.color);
      meta.append(lang);
    }
    meta.append(el('span', '', { text: `${compact(repo.stars)} stars` }));
    li.append(meta);
    return li;
  }));
  more.hidden = repos.length <= SHOWN;
  more.textContent = showAll ? 'Show fewer' : `Show all ${repos.length}`;
}
