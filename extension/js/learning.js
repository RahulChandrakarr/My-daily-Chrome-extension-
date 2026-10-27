// The Learning tab, split into sub-tabs:
//   Your stack  news, videos and deep dives for the tools you use (from GitHub)
//   Suggested   the videos and posts getting the most attention this week
//   Today       today's three lessons and your progress
//   one per interest  its top videos, trending stories and articles to study
//   All topics  every topic and how much of it you've covered
// "Read it" (or "Watched it") and "Tried it" checkboxes feed the learning
// log, which syncs to Supabase when it's set up.
import { load, save, watch, stableJson } from './store.js';
import { markDirty } from './sync.js';
import { fetchFeed, fetchHackerNews, normalizeUrl } from './news.js';
import { devtoArticles } from './devto.js';
import { cachedSuggestions, refreshSuggestions, pickVideos, SUGGESTIONS_STALE } from './suggestions.js';
import { activeTopics, topicHue } from './topics.js';
import { stackTechs, stackNews, cachedStackNews, matchTech, techTopicId, techForTopic, ensureStack } from './stack.js';
import { openSettings } from './settings.js';
import { renderCard, releaseCards, renderSkeletons } from './cards.js';
import { cachedPreview } from './preview.js';
import { addToTodoButton } from './tasks.js';
import { dateKey, addDays, timeAgo } from './dates.js';
import { el, icon, safeUrl, plural } from './ui.js';

const BRIEF_KEY = 'brief';
const LOG_KEY = 'learningLog';
const HISTORY_KEY = 'learnHistory'; // { topics: { id: date last picked }, items: [ids already suggested] }
const VIEW_KEY = 'learnView';
const TRENDING_STALE = 20 * 60 * 1000;
const TOPIC_GOAL = 5; // articles read in a topic before it counts as covered
const PER_ROW = 3; // cards in one full row
const $ = (id) => document.getElementById(id);
const listFormat = new Intl.ListFormat(undefined, { style: 'long', type: 'conjunction' });

let topics = [];
let log = new Map();
const ownWrites = []; // saves from this tab that storage hasn't echoed back yet
let brief = null;
let building = false;
let refreshingTrending = false;
let suggestions = null;
let loadingSuggestions = false;
let suggestionsFailed = false;
let view = 'stack'; // 'stack', 'suggested', 'today', 'all' or 'topic:<id>'
let studyTopicId = null;
let ready = false;
let visible = false; // whether the Learning tab is on screen
const articleRequests = new WeakMap(); // grid -> its latest article request
let techs = []; // your stack, most-used first
let stackItems = []; // what's new in your stack
let githubConnected = false;
let scanning = false;

const interests = () => topics.filter((t) => t.kind === 'interest');

export async function initLearning(settings, stack) {
  topics = activeTopics(settings);
  techs = stackTechs(stack, 6);
  setLog(await load(LOG_KEY, []));
  brief = await load(BRIEF_KEY, null);
  suggestions = await cachedSuggestions();
  stackItems = await cachedStackNews();
  githubConnected = Boolean((await load('githubAuth', null))?.token);
  view = await load(VIEW_KEY, 'stack');
  if (!viewExists(view)) view = 'stack';

  watch('githubAuth', (value) => {
    githubConnected = Boolean(value?.token);
    if (view === 'stack') renderStackView();
  });
  $('stack-connect-button').addEventListener('click', () => openSettings('github-section'));
  $('stack-rescan').addEventListener('click', async () => {
    scanning = true;
    renderStackView();
    try {
      await ensureStack({ force: true });
    } finally {
      scanning = false;
      renderStackView();
    }
  });

  watch(LOG_KEY, (value) => {
    const own = ownWrites.indexOf(stableJson(value || []));
    if (own !== -1) {
      ownWrites.splice(0, own + 1);
      return;
    }
    setLog(value || []);
    renderLearning();
  });
  // Another tab may build today's brief or load suggestions first; use theirs.
  watch(BRIEF_KEY, (value) => {
    if (!value || stableJson(value) === stableJson(brief)) return;
    brief = value;
    renderLearning();
  });
  watch('suggestions', (value) => {
    if (!value || value.fetchedAt === suggestions?.fetchedAt) return;
    suggestions = value;
    renderSuggestionViews();
  });

  $('brief-reshuffle').addEventListener('click', () => buildBrief({ reshuffle: true }));
  $('suggest-refresh').addEventListener('click', () => loadSuggestions({ force: true }));
  $('study-close').addEventListener('click', () => {
    studyTopicId = null;
    renderTopics();
    renderStudy();
  });

  ready = true;
  renderLearning();
  refreshLearning();
  setInterval(() => { if (!document.hidden) refreshLearning(); }, 60_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshLearning(); });
}

// Called when the Learning tab is shown or hidden. Suggestions only load
// while it's on screen.
export function setLearningVisible(isVisible) {
  visible = isVisible;
  if (visible && ready) refreshLearning();
}

// Called when your stack is first worked out from GitHub, or changes.
export function setLearningStack(stack) {
  techs = stackTechs(stack, 6);
  if (ready && view === 'stack') renderStackView();
  if (visible) loadStackNews();
}

async function loadStackNews({ force = false } = {}) {
  if (!techs.length) return;
  try {
    stackItems = await stackNews(techs, { force });
  } catch {
    // Keep what we had.
  }
  if (view === 'stack') renderStackNews();
}

export function updateLearningTopics(settings) {
  const before = interests().map((t) => t.id).join();
  topics = activeTopics(settings);
  if (!viewExists(view)) view = 'suggested';
  // A new interest needs its own videos.
  if (suggestions && interests().map((t) => t.id).join() !== before) suggestions = { ...suggestions, fetchedAt: 0 };
  renderLearning();
  refreshTrending();
  if (visible) loadSuggestions();
}

// Builds a new brief on a new day, and keeps trending stories and suggestions fresh.
export function refreshLearning() {
  if (visible) {
    loadSuggestions();
    loadStackNews();
  }
  if (!brief || brief.date !== dateKey()) return buildBrief();
  if (!brief.learn?.length && Date.now() - (brief.failedAt || 0) > 5 * 60 * 1000) return buildBrief();
  // A lesson whose topic was removed or turned off gets replaced.
  if (brief.learn?.some((item) => !topics.some((t) => t.id === item.topicId))) return buildBrief({ replaceStale: true });
  if (Date.now() - (brief.trendingAt || 0) > TRENDING_STALE) return refreshTrending();
  return Promise.resolve();
}

function setLog(entries) {
  log = new Map(entries.map((e) => [e.id, e]));
}

function saveLog(changedIds) {
  const entries = [...log.values()];
  ownWrites.push(stableJson(entries));
  if (ownWrites.length > 50) ownWrites.shift();
  save(LOG_KEY, entries);
  markDirty('learning_log', changedIds);
}

// --- Today's brief ---------------------------------------------------------------

// `reshuffle` swaps all of today's lessons; `replaceStale` swaps only those
// whose topic has been removed or turned off.
async function buildBrief({ reshuffle = false, replaceStale = false } = {}) {
  if (building) return;
  building = true;
  const today = dateKey();
  const sameDay = brief?.date === today;
  $('brief-reshuffle').disabled = true;
  if (!sameDay || reshuffle) renderSkeletons($('learn-cards'), PER_ROW);
  try {
    const keep = replaceStale && sameDay ? brief.learn.filter((i) => topics.some((t) => t.id === i.topicId)) : [];
    const skip = new Set((reshuffle && sameDay ? brief.learn : keep).map((i) => i.topicId));
    const learn = [...keep, ...(await pickLessons(skip))].slice(0, PER_ROW);
    brief = {
      date: today,
      learn,
      trending: sameDay ? brief.trending : {},
      trendingAt: sameDay ? brief.trendingAt : 0,
      error: null,
    };
  } catch {
    brief = {
      ...(brief || {}),
      date: today,
      learn: sameDay ? brief.learn : [],
      failedAt: Date.now(),
      error: "Couldn't reach dev.to for today's lessons. Check your connection, then press Different picks.",
    };
  } finally {
    building = false;
    $('brief-reshuffle').disabled = false;
  }
  await save(BRIEF_KEY, brief);
  renderLearning();
  if (Date.now() - (brief.trendingAt || 0) > TRENDING_STALE) refreshTrending();
}

// Two resume skills and one interest a day. Topics you've studied least, and
// haven't been suggested lately, come first, so the whole list gets covered.
async function pickLessons(skip) {
  const today = dateKey();
  const history = await load(HISTORY_KEY, { topics: {}, items: [] });
  const stats = topicStats();
  const score = (t) => (stats.get(t.id)?.read || 0) + (stats.get(t.id)?.tried || 0);
  const rank = (list) => list
    .filter((t) => !skip.has(t.id))
    .sort((a, b) => score(a) - score(b)
      || (history.topics[a.id] || '').localeCompare(history.topics[b.id] || '')
      || hash(a.id + today) - hash(b.id + today));

  // With your stack known, one lesson comes from a tool you're using right now.
  const stackPool = rank(techs.map((tech) => topics.find((t) => t.id === tech.topicId)
    || { id: techTopicId(tech), name: tech.name, tags: tech.tags, hue: tech.hue }));
  const inStack = new Set(stackPool.map((t) => t.id));
  const resume = rank(topics.filter((t) => t.kind !== 'interest' && !inStack.has(t.id)));
  const picks = rank(interests().filter((t) => !inStack.has(t.id)));
  const plan = stackPool.length ? [[stackPool, 1]] : [];
  const left = 3 - plan.length;
  if (picks.length && resume.length) plan.push([resume, left - 1], [picks, 1]);
  else plan.push([resume.length ? resume : picks, left]);

  const seen = new Set([...log.keys(), ...history.items]);
  const lessons = [];
  let anyReached = false;
  for (const [pool, count] of plan) {
    // Fetch a few candidates at once and keep the best-ranked ones that worked.
    const candidates = pool.slice(0, count + 1);
    const results = await Promise.all(candidates.map((t) => lessonFor(t, seen).catch(() => undefined)));
    let taken = 0;
    results.forEach((lesson, i) => {
      if (lesson !== undefined) anyReached = true;
      if (!lesson || taken >= count) return;
      lessons.push(lesson);
      history.topics[candidates[i].id] = today;
      taken += 1;
    });
  }
  if (!anyReached) throw new Error('dev.to unreachable');
  history.items = [...lessons.map((l) => l.id), ...history.items].slice(0, 400);
  await save(HISTORY_KEY, history);
  return lessons;
}

async function lessonFor(topic, seen) {
  const fresh = (await devtoArticles(topic, 30)).filter((a) => !seen.has(a.id));
  const lesson = fresh.find((a) => (a.readingTime || 0) >= 4) || fresh[0];
  return lesson ? { ...lesson, kind: 'learn' } : null;
}

async function refreshTrending() {
  if (refreshingTrending || !brief) return;
  refreshingTrending = true;
  try {
    const results = await Promise.all(interests().map(async (t) => [t.id, await trendingFor(t).catch(() => null)]));
    const trending = { ...(brief.trending || {}) };
    for (const [id, items] of results) if (items) trending[id] = items;
    brief = { ...brief, trending, trendingAt: Date.now() };
    await save(BRIEF_KEY, brief);
  } finally {
    refreshingTrending = false;
  }
  const topic = currentTopic();
  if (topic) renderTopicTrending(topic);
}

// A row of stories, taken in turn from each source so one site doesn't fill it.
async function trendingFor(topic) {
  const hue = topicHue(topic);
  const jobs = [
    ...(topic.feeds || []).map((f) => fetchFeed({ id: `topic-${topic.id}`, name: f.name, group: 'trending', url: f.url }, { limit: 6 })),
    topic.hn ? fetchHackerNews({ query: topic.hn, days: 5, minPoints: 20, limit: 4 }) : null,
    devtoArticles(topic, 7).then((list) => list.slice(0, 4)),
  ].filter(Boolean);
  const lists = (await Promise.allSettled(jobs)).filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (!lists.length) throw new Error(`Nothing reachable for ${topic.name}`);

  const picked = [];
  const urls = new Set();
  for (let i = 0; picked.length < PER_ROW && lists.some((list) => i < list.length); i += 1) {
    for (const list of lists) {
      const item = list[i];
      if (!item || picked.length >= PER_ROW || urls.has(normalizeUrl(item.url))) continue;
      urls.add(normalizeUrl(item.url));
      picked.push({ ...item, id: item.id.startsWith('devto:') || item.id.startsWith('hn:') ? item.id : `web:${normalizeUrl(item.url)}`, topicId: topic.id, kind: 'trend', hue });
    }
  }
  return picked;
}

// --- Suggestions ----------------------------------------------------------------------

async function loadSuggestions({ force = false } = {}) {
  if (loadingSuggestions) return;
  if (!force && suggestions && Date.now() - suggestions.fetchedAt < SUGGESTIONS_STALE) return;
  loadingSuggestions = true;
  $('suggest-refresh').classList.add('is-loading');
  if (!suggestions) renderSuggestionViews(); // skeletons while the first batch loads
  try {
    suggestions = await refreshSuggestions(interests());
    suggestionsFailed = false;
  } catch {
    suggestionsFailed = true;
  } finally {
    loadingSuggestions = false;
    $('suggest-refresh').classList.remove('is-loading');
  }
  renderSuggestionViews();
}

// --- Progress ------------------------------------------------------------------------

function setProgress(item, field, checked) {
  const now = Date.now();
  const entry = log.get(item.id) || {
    id: item.id,
    topic: item.topicId,
    title: item.title,
    url: item.url,
    image: item.image || cachedPreview(item.url)?.image || null,
    kind: item.kind,
    readAt: null,
    doneAt: null,
  };
  entry[field] = checked ? now : null;
  if (field === 'doneAt' && checked && !entry.readAt) entry.readAt = now; // trying it means you read it
  entry.updatedAt = now;
  log.set(item.id, entry);
  saveLog([item.id]);

  syncCards(item.id);
  renderStats();
  renderTopics();
  renderLog();
  const topic = currentTopic();
  if (topic) renderTopicSummary(topic);
}

// The same article can appear in more than one section; keep them in step.
function syncCards(itemId) {
  const entry = log.get(itemId);
  document.querySelectorAll('[data-item]').forEach((card) => {
    if (card.dataset.item !== itemId) return;
    card.classList.toggle('is-read', Boolean(entry?.readAt));
    card.querySelectorAll('input[data-field]').forEach((input) => { input.checked = Boolean(entry?.[input.dataset.field]); });
  });
}

function topicStats() {
  const stats = new Map();
  for (const entry of log.values()) {
    const s = stats.get(entry.topic) || { read: 0, tried: 0 };
    if (entry.readAt) s.read += 1;
    if (entry.doneAt) s.tried += 1;
    stats.set(entry.topic, s);
  }
  return stats;
}

function streak() {
  const days = new Set();
  for (const e of log.values()) {
    if (e.readAt) days.add(dateKey(new Date(e.readAt)));
    if (e.doneAt) days.add(dateKey(new Date(e.doneAt)));
  }
  let day = dateKey();
  if (!days.has(day)) day = addDays(day, -1); // today still counts if you haven't studied yet
  let count = 0;
  while (days.has(day)) {
    count += 1;
    day = addDays(day, -1);
  }
  return count;
}

// --- Sub-tabs ------------------------------------------------------------------------

function viewExists(id) {
  if (['stack', 'suggested', 'today', 'all'].includes(id)) return true;
  return id.startsWith('topic:') && interests().some((t) => `topic:${t.id}` === id);
}

const panelFor = (id) => (id.startsWith('topic:') ? 'learn-topic' : `learn-${id}`);

function currentTopic() {
  return view.startsWith('topic:') ? interests().find((t) => `topic:${t.id}` === view) : null;
}

function renderTabs() {
  const tabs = [
    { id: 'stack', label: 'Your stack' },
    { id: 'suggested', label: 'Suggested' },
    { id: 'today', label: 'Today' },
    ...interests().map((t) => ({ id: `topic:${t.id}`, label: t.name, hue: topicHue(t) })),
    { id: 'all', label: 'All topics' },
  ];
  const buttons = tabs.map((tab) => {
    const selected = tab.id === view;
    const button = el('button', tab.hue == null ? 'learn-tab' : 'learn-tab learn-tab--topic', {
      type: 'button', role: 'tab', id: `learn-tab-${tab.id.replace(':', '-')}`, 'aria-selected': String(selected),
      'aria-controls': panelFor(tab.id), tabindex: selected ? '0' : '-1', text: tab.label,
    });
    if (tab.hue != null) button.style.setProperty('--hue', tab.hue);
    button.addEventListener('click', () => selectView(tab.id));
    return button;
  });
  buttons.forEach((button, i) => button.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const next = tabs[(i + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    selectView(next.id, true);
  }));
  $('learn-tabs').replaceChildren(...buttons);
}

function selectView(id, focus = false) {
  view = id;
  save(VIEW_KEY, id);
  renderTabs();
  showView();
  if (focus) $('learn-tabs').querySelector('[aria-selected="true"]').focus();
  if (visible) {
    loadSuggestions();
    if (id === 'stack') loadStackNews();
  }
}

function showView() {
  const panel = panelFor(view);
  for (const id of ['learn-stack', 'learn-suggested', 'learn-today', 'learn-topic', 'learn-all']) $(id).hidden = id !== panel;
  $(panel).setAttribute('aria-labelledby', `learn-tab-${view.replace(':', '-')}`);
  if (view === 'stack') renderStackView();
  if (view === 'suggested') renderSuggested();
  const topic = currentTopic();
  if (topic) renderTopicView(topic);
}

function renderSuggestionViews() {
  if (view === 'suggested') renderSuggested();
  if (view === 'stack') renderStackVideos();
  const topic = currentTopic();
  if (topic) renderTopicVideos(topic);
}

// --- Your stack ----------------------------------------------------------------------

const MASTERED_TOOLS = 3; // tools with a "master it" row

function renderStackView() {
  const hasStack = techs.length > 0;
  $('stack-connect').hidden = hasStack || githubConnected;
  $('stack-main').hidden = !hasStack && !githubConnected;
  if (!hasStack && !githubConnected) return;

  $('stack-rescan').disabled = scanning;
  $('stack-rescan').classList.toggle('is-loading', scanning);
  if (!hasStack) {
    $('stack-summary').textContent = scanning
      ? 'Looking through the repos you pushed to in the last two weeks…'
      : 'No tools found yet. Push to a repo, then press Scan again.';
    for (const id of ['stack-tools', 'stack-news', 'stack-videos', 'stack-master']) $(id).replaceChildren();
    $('stack-videos-section').hidden = true;
    return;
  }

  const repos = [...new Set(techs.flatMap((t) => t.repos))];
  $('stack-summary').textContent = `From the repos you pushed to in the last two weeks (${listFormat.format(repos.slice(0, 3))}${repos.length > 3 ? ` and ${repos.length - 3} more` : ''}), you're working with ${listFormat.format(techs.map((t) => t.name))}.`;
  $('stack-tools').replaceChildren(...techs.map((tech) => {
    const chip = el('span', 'stack-tool', { title: `Found in ${tech.repos.join(', ')}` });
    chip.style.setProperty('--hue', tech.hue);
    chip.append(el('span', 'stack-tool-name', { text: tech.name }), el('span', 'stack-tool-repos', { text: plural(tech.repos.length, 'repo') }));
    return chip;
  }));
  renderStackNews();
  renderStackVideos();
  renderMastery();
}

function techTopic(tech) {
  return { id: techTopicId(tech), name: tech.name, tags: tech.tags, hue: tech.hue };
}

function renderStackNews() {
  const grid = $('stack-news');
  if (!techs.length) return;
  releaseCards(grid);
  const items = stackItems.filter((i) => techs.some((t) => t.id === i.techId)).slice(0, PER_ROW * 2);
  if (!items.length) {
    renderSkeletons(grid, PER_ROW);
    return;
  }
  grid.replaceChildren(...items.map((item) => {
    const tech = techs.find((t) => t.id === item.techId);
    return learningCard({ ...item, topicName: tech?.name }, { tried: true });
  }));
}

function renderStackVideos() {
  if (!techs.length) return;
  const all = Object.values(suggestions?.videos || {}).flat();
  const videos = pickVideos(all.filter((v) => matchTech(techs, v)), PER_ROW)
    .map((v) => ({ ...v, topicId: techTopicId(matchTech(techs, v)) }));
  $('stack-videos-section').hidden = !videos.length;
  if (videos.length) {
    releaseCards($('stack-videos'));
    $('stack-videos').replaceChildren(...videos.map((v) => learningCard(v, { tried: true })));
  }
}

// A row per top tool: how far you've got, and three in-depth articles.
function renderMastery() {
  const stats = topicStats();
  $('stack-master').replaceChildren(...techs.slice(0, MASTERED_TOOLS).map((tech) => {
    const read = stats.get(techTopicId(tech))?.read || 0;
    const row = el('section', 'master-row');
    row.style.setProperty('--hue', tech.hue);
    const head = el('div', 'master-head');
    head.append(el('h4', 'master-title', { text: `Master ${tech.name}` }));
    const progress = el('div', 'master-progress', { title: `${read} of ${TOPIC_GOAL} articles read` });
    const bar = el('span', 'master-bar');
    bar.style.setProperty('--progress', Math.min(read / TOPIC_GOAL, 1));
    progress.append(el('span', '', { text: read >= TOPIC_GOAL ? 'Covered' : `${read} of ${TOPIC_GOAL} read` }), bar);
    head.append(progress);
    const grid = el('div', 'cards cards--three');
    row.append(head, grid);
    renderArticles(grid, techTopic(tech), PER_ROW, { minutes: 5 });
    return row;
  }));
}

// --- Rendering -------------------------------------------------------------------------

export function renderLearning() {
  renderTabs();
  renderSummary();
  renderStats();
  renderLessons();
  renderTopics();
  renderStudy();
  renderLog();
  showView();
}

function renderSuggested() {
  const names = interests().map((t) => t.name);
  $('suggest-summary').textContent = names.length
    ? `The most-watched videos and most-discussed posts this week in ${listFormat.format(names)}.`
    : 'Add an interest in Settings to get suggestions.';
  const ids = new Set(interests().map((t) => t.id));
  const videos = suggestions && pickVideos(interests().flatMap((t) => suggestions.videos?.[t.id] || []), PER_ROW * 2, { perTopic: 2 });
  const posts = suggestions && (suggestions.posts || []).filter((p) => ids.has(p.topicId)).slice(0, PER_ROW * 2);
  fillGrid($('suggest-videos'), videos, PER_ROW * 2, 'No new videos from your channels this week.');
  fillGrid($('suggest-posts'), posts, PER_ROW * 2, 'No posts in your interests right now.');
}

function renderTopicView(topic) {
  $('topic-title').textContent = topic.name;
  $('learn-topic').style.setProperty('--hue', topicHue(topic));
  renderTopicSummary(topic);
  renderTopicVideos(topic);
  renderTopicTrending(topic);
  renderArticles($('topic-articles'), topic, PER_ROW * 2);
}

function renderTopicSummary(topic) {
  const s = topicStats().get(topic.id) || { read: 0, tried: 0 };
  $('topic-summary').textContent = s.read || s.tried
    ? `You've read ${plural(s.read, 'article')} and tried ${s.tried} in ${topic.name}. Read ${TOPIC_GOAL} to cover it.`
    : `You haven't started ${topic.name} yet. Read ${TOPIC_GOAL} articles to cover it.`;
}

function renderTopicVideos(topic) {
  const hasChannels = Boolean(topic.channels?.length);
  $('topic-videos-section').hidden = !hasChannels;
  if (!hasChannels) return;
  const videos = suggestions && pickVideos(suggestions.videos?.[topic.id] || [], PER_ROW);
  fillGrid($('topic-videos'), videos, PER_ROW, `No new ${topic.name} videos in the last two weeks.`, { showTopic: false });
}

function renderTopicTrending(topic) {
  const grid = $('topic-trending');
  releaseCards(grid);
  const items = brief?.trending?.[topic.id];
  if (!items) renderSkeletons(grid, PER_ROW);
  else if (!items.length) grid.replaceChildren(el('p', 'empty', { text: 'Nothing new this week.' }));
  else grid.replaceChildren(...items.slice(0, PER_ROW).map((item) => learningCard(item, { tried: false, showTopic: false })));
}

// Fills a grid with suggestion cards, or skeletons while they load.
function fillGrid(grid, items, count, emptyText, { showTopic = true } = {}) {
  releaseCards(grid);
  if (!items) {
    if (suggestionsFailed) grid.replaceChildren(el('p', 'empty', { text: 'Couldn\'t load suggestions. Check your connection, then press Refresh.' }));
    else renderSkeletons(grid, count);
    return;
  }
  if (!items.length) {
    grid.replaceChildren(el('p', 'empty', { text: emptyText }));
    return;
  }
  grid.replaceChildren(...items.map((item) => learningCard(item, { tried: true, showTopic })));
}

// The best dev.to articles in a topic, ones you haven't read first, and with
// `minutes`, longer reads before shorter ones.
async function renderArticles(grid, topic, count, { minutes = 0 } = {}) {
  const request = {};
  articleRequests.set(grid, request);
  releaseCards(grid);
  renderSkeletons(grid, PER_ROW);
  try {
    const all = await devtoArticles(topic, 30);
    if (articleRequests.get(grid) !== request) return; // a newer request replaced this one
    const articles = [...all.filter((a) => (a.readingTime || 0) >= minutes), ...all.filter((a) => (a.readingTime || 0) < minutes)];
    const unread = articles.filter((a) => !log.get(a.id)?.readAt);
    const read = articles.filter((a) => log.get(a.id)?.readAt);
    grid.replaceChildren(...[...unread, ...read].slice(0, count)
      .map((a) => learningCard({ ...a, kind: 'learn' }, { tried: true, showTopic: false })));
  } catch {
    if (articleRequests.get(grid) !== request) return;
    grid.replaceChildren(el('p', 'empty', { text: 'Couldn\'t reach dev.to. Check your connection, then open this tab again.' }));
  }
}

function renderSummary() {
  const summary = $('brief-summary');
  if (!brief?.learn?.length) {
    summary.textContent = building || !brief ? 'Putting together today\'s brief…' : brief.error || '';
    return;
  }
  summary.textContent = `Learn ${listFormat.format(brief.learn.map((i) => topicName(i.topicId)))} today.`;
}

function renderStats() {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const entries = [...log.values()];
  const stats = topicStats();
  const covered = topics.filter((t) => (stats.get(t.id)?.read || 0) >= TOPIC_GOAL).length;
  const items = [
    [plural(streak(), 'day'), 'Learning streak'],
    [entries.filter((e) => e.readAt > weekAgo).length, 'Read or watched this week'],
    [entries.filter((e) => e.doneAt > weekAgo).length, 'Tried this week'],
    [`${covered} of ${topics.length}`, 'Topics covered'],
  ];
  $('learning-stats').replaceChildren(...items.map(([value, label]) => {
    const stat = el('div', 'stat');
    stat.append(el('span', 'stat-value', { text: value }), el('span', 'stat-label', { text: label }));
    return stat;
  }));
}

function renderLessons() {
  const root = $('learn-cards');
  if (building) return;
  releaseCards(root);
  if (!brief || brief.date !== dateKey()) {
    renderSkeletons(root, PER_ROW);
    return;
  }
  if (!brief.learn?.length) {
    root.replaceChildren(el('p', 'empty', { text: brief.error || 'No lessons found for your topics today.' }));
    return;
  }
  root.replaceChildren(...brief.learn.map((item) => learningCard(item, { tried: true })));
}

function learningCard(item, { tried, showTopic = true }) {
  const entry = log.get(item.id);
  const foot = el('div', 'card-foot');
  foot.append(progressCheck(item, 'readAt', item.video ? 'Watched it' : 'Read it', entry));
  if (tried) foot.append(progressCheck(item, 'doneAt', 'Tried it', entry));
  foot.append(addToTodoButton(item, { compact: true }));
  const card = renderCard(item, {
    topic: showTopic ? item.topicName || topicName(item.topicId) : null,
    foot,
    read: Boolean(entry?.readAt),
  });
  card.dataset.item = item.id;
  return card;
}

function progressCheck(item, field, label, entry) {
  const wrap = el('label', 'check-pill');
  const input = el('input', '', { type: 'checkbox', 'data-field': field });
  input.checked = Boolean(entry?.[field]);
  input.addEventListener('change', () => setProgress(item, field, input.checked));
  wrap.append(input, el('span', '', { text: label }));
  return wrap;
}

function renderTopics() {
  const stats = topicStats();
  const groups = [
    ['Your interests', interests()],
    ['From your resume', topics.filter((t) => t.kind !== 'interest')],
  ].filter(([, list]) => list.length);
  $('topic-list').replaceChildren(...groups.map(([label, list]) => {
    const group = el('div', 'topic-group');
    group.append(el('h4', 'topic-group-title', { text: label }));
    const ul = el('ul', 'topics');
    ul.append(...list.map((topic) => {
      const s = stats.get(topic.id) || { read: 0, tried: 0 };
      const li = el('li');
      const button = el('button', 'topic', { type: 'button', 'aria-pressed': String(studyTopicId === topic.id) });
      button.style.setProperty('--hue', topicHue(topic));
      button.style.setProperty('--progress', Math.min(s.read / TOPIC_GOAL, 1));
      const counts = s.read || s.tried ? `${s.read} read, ${s.tried} tried` : 'Not started';
      button.append(el('span', 'topic-name', { text: topic.name }), el('span', 'topic-counts', { text: counts }), el('span', 'topic-bar'));
      button.addEventListener('click', () => {
        studyTopicId = studyTopicId === topic.id ? null : topic.id;
        renderTopics();
        renderStudy();
        if (studyTopicId) $('study-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      li.append(button);
      return li;
    }));
    group.append(ul);
    return group;
  }));
}

function renderStudy() {
  const topic = topics.find((t) => t.id === studyTopicId);
  $('study-panel').hidden = !topic;
  if (!topic) {
    releaseCards($('study-cards'));
    $('study-cards').replaceChildren();
    return;
  }
  $('study-title').textContent = `Study ${topic.name}`;
  renderArticles($('study-cards'), topic, PER_ROW * 2);
}

function renderLog() {
  const entries = [...log.values()]
    .filter((e) => e.readAt || e.doneAt)
    .sort((a, b) => Math.max(b.readAt || 0, b.doneAt || 0) - Math.max(a.readAt || 0, a.doneAt || 0))
    .slice(0, 12);
  const list = $('log-list');
  if (!entries.length) {
    list.replaceChildren(el('li', 'empty', { text: 'Nothing here yet. Tick "Read it" or "Tried it" on any article to start your log.' }));
    return;
  }
  list.replaceChildren(...entries.map((e) => {
    const li = el('li', 'log-entry');
    const status = e.doneAt ? 'Tried' : e.kind === 'video' ? 'Watched' : 'Read';
    const when = Math.max(e.readAt || 0, e.doneAt || 0);
    const mark = el('span', `log-mark log-mark--${e.doneAt ? 'tried' : 'read'}`, { title: status });
    mark.append(icon('check', 14));
    const body = el('div', 'log-body');
    body.append(el('a', 'log-title', { href: e.url, text: e.title }));
    const meta = el('div', 'log-meta');
    meta.append(el('span', '', { text: topicName(e.topic) }), el('span', '', { text: `${status} ${timeAgo(when)}` }));
    body.append(meta);
    li.append(mark, body);
    return li;
  }));
}

function topicName(id) {
  return topics.find((t) => t.id === id)?.name || techForTopic(id)?.name || 'Other';
}

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

export async function exportLearningLog() {
  return [...log.values()];
}

// Merges entries from a backup; the newer version of each entry wins.
export function importLearningLog(entries) {
  const changed = [];
  for (const entry of entries) {
    if (!entry?.id || typeof entry.title !== 'string') continue;
    const mine = log.get(entry.id);
    if (mine && (mine.updatedAt || 0) >= (entry.updatedAt || 0)) continue;
    log.set(entry.id, { ...entry, url: safeUrl(entry.url), image: safeUrl(entry.image), updatedAt: entry.updatedAt || Date.now() });
    changed.push(entry.id);
  }
  if (!changed.length) return;
  saveLog(changed);
  renderLearning();
}
