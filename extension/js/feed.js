// The AI news tab: section chips and story cards, plus Hugging Face models.
// When your stack is known (from GitHub), stories about your tools get their
// own "Your stack" section and float to the top of Headlines with a label.
import { cachedNews, refreshNews, normalizeUrl, STALE_AFTER } from './news.js';
import { GROUPS, ALL_SOURCES } from './sources.js';
import { renderCard, releaseCards, renderSkeletons } from './cards.js';
import { addToTodoButton } from './tasks.js';
import { stackTechs, matchTech, stackNews, cachedStackNews } from './stack.js';
import { load, save } from './store.js';
import { timeAgo } from './dates.js';
import { el, compact, plural } from './ui.js';

const PAGE = 24;
const BOOSTED = 4; // stories about your stack lifted to the top of Headlines
const BOOST_WINDOW = 48 * 60 * 60 * 1000;
const $ = (id) => document.getElementById(id);

let data = null;
let group = 'all';
let limit = PAGE;
let disabled = [];
let readIds = new Set();
let refreshing = false;
let failedToLoad = false;
let waiting = null; // fresh results held back while you're scrolled down
let techs = []; // your stack, most-used first
let stackItems = []; // news gathered for your stack

export async function initFeed(settings, stack) {
  disabled = settings.disabledSources || [];
  techs = stackTechs(stack, 6);
  group = await load('newsGroup', techs.length ? 'stack' : 'all');
  if (!groups().some((g) => g.id === group)) group = 'all';
  readIds = new Set(await load('readItems', []));
  stackItems = await cachedStackNews();
  renderChips();

  data = await cachedNews();
  if (data) render();
  else renderSkeletons($('news-cards'));

  $('news-refresh').addEventListener('click', () => {
    refresh();
    loadStackNews({ force: true });
  });
  $('news-more').addEventListener('click', () => {
    limit += PAGE;
    renderCards();
  });
  $('news-new').addEventListener('click', showWaiting);

  if (!data || isStale()) refresh();
  loadStackNews();
  // Keep the feed fresh while the tab stays open, and when you come back to it.
  setInterval(() => {
    if (!document.hidden && isStale()) refresh({ quiet: true });
    if (!document.hidden) loadStackNews();
    updateStatus();
  }, 60_000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && isStale()) refresh({ quiet: true });
  });
}

export function setDisabledSources(list) {
  disabled = list;
  if (!groups().some((g) => g.id === group)) group = 'all';
  renderChips();
  refresh();
}

// Called when your stack is first worked out, or changes.
export function setStack(stack) {
  techs = stackTechs(stack, 6);
  if (group === 'stack' && !techs.length) group = 'all';
  renderChips();
  render();
  loadStackNews();
}

const isStale = () => !data || Date.now() - data.fetchedAt > STALE_AFTER;

function groups() {
  return [...(techs.length ? [{ id: 'stack', label: 'Your stack' }] : []), ...GROUPS]
    .filter((g) => g.id !== 'models' || !disabled.includes('models'));
}

async function refresh({ quiet = false } = {}) {
  if (refreshing) return;
  refreshing = true;
  $('news-refresh').classList.add('is-loading');
  updateStatus();
  try {
    const fresh = await refreshNews(disabled);
    failedToLoad = false;
    // Don't reshuffle the cards under you while you're reading further down.
    if (quiet && window.scrollY > 300 && data) {
      waiting = fresh;
    } else {
      data = fresh;
      waiting = null;
    }
  } catch {
    failedToLoad = true;
  } finally {
    refreshing = false;
    $('news-refresh').classList.remove('is-loading');
  }
  if (!waiting) render();
  updateStatus();
}

async function loadStackNews({ force = false } = {}) {
  if (!techs.length) {
    stackItems = [];
    return;
  }
  try {
    stackItems = await stackNews(techs, { force });
  } catch {
    // Keep what we had.
  }
  if (group === 'stack' || group === 'all') renderCards();
}

function showWaiting() {
  if (!waiting) return;
  data = waiting;
  waiting = null;
  render();
  $('panel-news').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function render() {
  if (group === 'models') renderSections();
  else renderCards();
  updateStatus();
}

function renderChips() {
  $('news-groups').replaceChildren(...groups().map((g) => {
    const chip = el('button', g.id === 'stack' ? 'chip chip--stack' : 'chip', { type: 'button', 'aria-pressed': String(g.id === group), text: g.label });
    chip.addEventListener('click', () => {
      group = g.id;
      limit = PAGE;
      save('newsGroup', group);
      renderChips();
      render();
    });
    return chip;
  }));
}

// --- Story lists -----------------------------------------------------------------

const withTech = (item, tech) => (tech ? { ...item, stackTech: tech.name } : item);

function listItems() {
  const items = (data?.items || []).filter((i) => !disabled.includes(i.source));
  if (group === 'stack') {
    const own = stackItems.map((i) => withTech(i, techs.find((t) => t.id === i.techId)));
    const matched = items.map((i) => withTech(i, matchTech(techs, i))).filter((i) => i.stackTech);
    const seen = new Set();
    return [...own, ...matched]
      .filter((i) => !seen.has(normalizeUrl(i.url)) && seen.add(normalizeUrl(i.url)))
      .sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
  }
  if (group === 'all') {
    // Fresh stories about your stack go first, then everything by time.
    const list = items.filter((i) => i.group !== 'papers');
    const recent = Date.now() - BOOST_WINDOW;
    const boosted = list
      .filter((i) => i.publishedAt > recent)
      .map((i) => withTech(i, matchTech(techs, i)))
      .filter((i) => i.stackTech)
      .slice(0, BOOSTED);
    const ids = new Set(boosted.map((i) => i.id));
    return [...boosted, ...list.filter((i) => !ids.has(i.id))];
  }
  const inGroup = items.filter((i) => i.group === group);
  return group === 'hn' || group === 'papers' ? inGroup.sort((a, b) => (b.points || 0) - (a.points || 0)) : inGroup;
}

function renderCards() {
  $('news-sections').hidden = true;
  $('news-cards').hidden = false;
  const container = $('news-cards');
  releaseCards(container);
  const items = listItems();
  $('news-more').hidden = items.length <= limit;

  if (!items.length) {
    let message = 'No stories in this section right now.';
    if (failedToLoad && !data) message = 'Couldn\'t load the news. Check your internet connection, then press Refresh.';
    else if (group === 'stack') message = 'Nothing new about your stack in the last two weeks.';
    else if (disabled.length >= ALL_SOURCES.length - 2) message = 'All news sources are off. Turn some on in Settings.';
    container.replaceChildren(el('p', 'empty', { text: message }));
    return;
  }

  // Lead with the first story that has a picture.
  const shown = items.slice(0, limit);
  const leadIndex = shown.slice(0, 6).findIndex((i) => i.image);
  if (leadIndex > 0) shown.unshift(...shown.splice(leadIndex, 1));
  container.replaceChildren(...shown.map((item, i) => storyCard(item, { lead: i === 0 && leadIndex !== -1 })));
}

function storyCard(item, { lead = false } = {}) {
  return renderCard(item, {
    lead,
    topic: item.stackTech || null,
    foot: cardFoot(item),
    read: readIds.has(item.id),
    onOpen: (node) => markRead(item, node),
  });
}

// --- Models ---------------------------------------------------------------------------

function renderSections() {
  $('news-cards').hidden = true;
  $('news-more').hidden = true;
  const root = $('news-sections');
  root.hidden = false;
  root.querySelectorAll('.cards').forEach(releaseCards);
  const models = data?.models?.trending ? data.models : null;
  const sections = [
    ['Trending now', 'The models getting the most attention on Hugging Face this week', models?.trending],
    ['Most used', 'The most downloaded models over the last 30 days', models?.top],
  ];
  root.replaceChildren(...sections.map(([title, note, items]) => {
    const section = el('section', 'news-section');
    section.append(el('h3', 'section-title', { text: title }), el('p', 'section-note', { text: note }));
    const grid = el('div', 'cards cards--three');
    if (!items) renderSkeletons(grid, 3);
    else if (!items.length) grid.append(el('p', 'empty', { text: 'Nothing to show right now. Press Refresh to try again.' }));
    else grid.append(...items.slice(0, 6).map((item) => storyCard(item)));
    section.append(grid);
    return section;
  }));
}

function cardFoot(item) {
  const foot = el('div', 'card-foot');
  if (item.points && (item.source === 'hn' || item.group === 'papers')) {
    foot.append(el('span', 'card-stat', { text: `${compact(item.points)} ${item.group === 'papers' ? 'upvotes' : 'points'}` }));
  }
  if (item.discussionUrl) {
    foot.append(el('a', 'card-stat card-stat--link', { href: item.discussionUrl, text: plural(item.comments || 0, 'comment') }));
  } else if (item.comments) {
    foot.append(el('span', 'card-stat', { text: plural(item.comments, 'comment') }));
  }
  foot.append(addToTodoButton(item));
  return foot;
}

function markRead(item, card) {
  card.classList.add('is-read');
  readIds.add(item.id);
  save('readItems', [...readIds].slice(-500));
}

function updateStatus() {
  $('news-new').hidden = !waiting;
  if (refreshing) {
    $('news-status').textContent = 'Updating…';
    return;
  }
  $('news-status').textContent = data ? `Updated ${timeAgo(data.fetchedAt)}` : '';
  const failed = (data?.failed || []).map((id) => ALL_SOURCES.find((s) => s.id === id)?.name).filter(Boolean);
  $('news-failed').textContent = failed.length ? `Couldn't reach ${failed.join(', ')}` : '';
}
