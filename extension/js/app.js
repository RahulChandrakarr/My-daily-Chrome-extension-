// Starts the dashboard: header, tabs, search and keyboard shortcuts, then the
// to-do list, the AI news tab and the learning tab.
import { load, save, watch } from './store.js';
import { initSync, markDirty } from './sync.js';
import { loadPreviews } from './preview.js';
import { initTasks, onTasksChange, visibleTasks, renderTasks, setTaskOptions } from './tasks.js';
import { initFeed, setDisabledSources, setStack } from './feed.js';
import { initLearning, updateLearningTopics, refreshLearning, setLearningVisible, setLearningStack } from './learning.js';
import { cachedStack, ensureStack } from './stack.js';
import { initSettings } from './settings.js';
import { initWork, setWorkVisible } from './work.js';
import { initTrending } from './trending.js';
import { dateKey } from './dates.js';
import { plural } from './ui.js';

const DEFAULT_SETTINGS = {
  name: '',
  theme: 'system',
  disabledSources: [],
  disabledTopics: [],
  customTopics: [],
  workSummaryTime: '18:00', // when the background writes the day's GitHub summary
  workNotify: true,
  autoDone: true, // mark to-do items done when a pushed commit matches them
  updatedAt: 0,
};
const $ = (id) => document.getElementById(id);

let settings;
let shownDay = dateKey();

async function main() {
  settings = { ...DEFAULT_SETTINGS, ...(await load('settings', {})) };
  applyTheme();
  renderHero();
  await initSync();
  await loadPreviews();
  setTaskOptions(settings);
  await initTasks();
  onTasksChange(renderTaskSummary);
  renderTaskSummary();
  initTabs();
  bindSearch();
  bindShortcuts();
  initSettings({ getSettings: () => settings, updateSettings });
  const stack = await cachedStack();
  initFeed(settings, stack);
  initLearning(settings, stack);
  initWork();
  initTrending();

  // Your stack (the tools in the repos you push to), re-checked twice a day.
  watch('workStack', (value) => {
    setStack(value);
    setLearningStack(value);
  });
  ensureStack().catch(() => {});
  watch('githubAuth', () => ensureStack({ force: true }).catch(() => {}));

  // Settings changed in another tab or pulled from Supabase.
  watch('settings', (value) => {
    if (!value || value.updatedAt === settings.updatedAt) return;
    const previous = settings;
    settings = { ...DEFAULT_SETTINGS, ...value };
    applySettings(previous);
  });
  setInterval(tick, 60_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
}

function updateSettings(changes) {
  const previous = settings;
  settings = { ...settings, ...changes, updatedAt: Date.now() };
  save('settings', settings);
  markDirty('preferences', ['me']);
  applySettings(previous);
}

function applySettings(previous) {
  applyTheme();
  renderHero();
  setTaskOptions(settings);
  if (previous.disabledSources.join() !== settings.disabledSources.join()) setDisabledSources(settings.disabledSources);
  const topicsBefore = JSON.stringify([previous.disabledTopics, previous.customTopics]);
  if (topicsBefore !== JSON.stringify([settings.disabledTopics, settings.customTopics])) updateLearningTopics(settings);
}

function applyTheme() {
  const { theme } = settings;
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  try {
    localStorage.setItem('theme', theme);
  } catch {
    // Only used to avoid a flash on the next load.
  }
}

// --- Header ------------------------------------------------------------------------

function renderHero() {
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour >= 5 && hour < 12 ? 'Good morning' : hour >= 12 && hour < 17 ? 'Good afternoon' : 'Good evening';
  $('greeting').textContent = settings.name ? `${greeting}, ${settings.name}` : greeting;
  $('day-name').textContent = now.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

function renderTaskSummary() {
  const tasks = visibleTasks();
  const today = dateKey();
  const open = tasks.filter((t) => !t.done);
  const dueToday = open.filter((t) => t.due === today).length;
  const overdue = open.filter((t) => t.due && t.due < today).length;
  let text;
  if (!tasks.length) text = 'Your to-do list is empty';
  else if (!dueToday && !overdue) text = open.length ? 'Nothing due today' : 'Everything is done';
  else text = `${plural(dueToday, 'task')} due today${overdue ? `, ${overdue} overdue` : ''}`;
  $('task-summary').textContent = text;
  $('task-summary').classList.toggle('is-due', dueToday + overdue > 0);
}

// Runs every minute: keeps the greeting current and rolls over at midnight.
function tick() {
  renderHero();
  const today = dateKey();
  if (today === shownDay) return;
  shownDay = today;
  renderTasks();
  renderTaskSummary();
  refreshLearning();
}

// --- Tabs, search, shortcuts ------------------------------------------------------

async function initTabs() {
  const tabs = [...document.querySelectorAll('.tabs [role="tab"]')];
  const select = (tab, focus = false) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !on;
    }
    document.body.dataset.tab = tab.dataset.tab;
    setLearningVisible(tab.dataset.tab === 'learning');
    setWorkVisible(tab.dataset.tab === 'work');
    save('activeTab', tab.id);
    if (focus) tab.focus();
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      const step = event.key === 'ArrowRight' ? 1 : -1;
      select(tabs[(i + step + tabs.length) % tabs.length], true);
    });
  });
  select($(await load('activeTab', 'tab-news')) || tabs[0]);
}

const URL_LIKE = /^(https?:\/\/\S+|localhost(:\d+)?(\/\S*)?|[\w-]+(\.[\w-]+)*\.(com|org|net|io|dev|ai|app|co|in|edu|gov|me|xyz|so|sh|gg|tv|us|uk|ly|to)(:\d+)?(\/\S*)?)$/i;

function bindSearch() {
  $('search-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const text = $('search-input').value.trim();
    if (!text) return;
    if (URL_LIKE.test(text)) {
      location.href = /^https?:\/\//i.test(text) ? text : `${text.startsWith('localhost') ? 'http' : 'https'}://${text}`;
    } else if (globalThis.chrome?.search?.query) {
      chrome.search.query({ text, disposition: 'CURRENT_TAB' });
    } else {
      location.href = `https://www.google.com/search?q=${encodeURIComponent(text)}`;
    }
  });
}

function bindShortcuts() {
  document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.target.closest?.('input, textarea, select, [contenteditable="true"], dialog[open]')) return;
    if (event.key === '/') {
      event.preventDefault();
      $('search-input').focus();
    } else if (event.key === 'n') {
      event.preventDefault();
      $('task-input').focus();
    }
  });
}

main();
