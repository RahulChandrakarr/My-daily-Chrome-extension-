// Opens the dashboard from the toolbar icon, keeps the icon's badge showing
// how many open tasks are due today or overdue, fetches feeds and article
// pages for the dashboard (see js/net.js for why that happens here), writes
// the end-of-day GitHub summary at the time set in Settings, and keeps your
// streak on days you don't push (see js/streak.js).
import { dateKey } from './js/dates.js';
import { buildWorkDays, saveWorkRecords } from './js/github.js';
import { keepStreak, STREAK_STATE_KEY } from './js/streak.js';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'fetch-text' || sender.id !== chrome.runtime.id) return false;
  fetchText(message).then(sendResponse, (error) => sendResponse({ error: error.message }));
  return true; // reply asynchronously
});

// Reads a response as text. With stopAtHeadEnd it stops once </head> arrives,
// which is all that's needed for a page's Open Graph tags.
async function fetchText({ url, timeout = 12000, maxBytes = 5_000_000, stopAtHeadEnd = false, accept = null }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-cache',
      headers: accept ? { Accept: accept } : {},
    });
    const result = { ok: res.ok, status: res.status, url: res.url || url, contentType: res.headers.get('content-type') || '' };
    if (!res.ok) return result;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (text.length < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      text += chunk;
      if (stopAtHeadEnd && /<\/head>/i.test(text.slice(-(chunk.length + 7)))) break;
    }
    reader.cancel().catch(() => {});
    return { ...result, text };
  } finally {
    clearTimeout(timer);
  }
}

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
});

async function updateBadge() {
  const { tasks = [] } = await chrome.storage.local.get('tasks');
  const today = dateKey();
  const due = tasks.filter((t) => !t.done && !t.deleted && t.due && t.due <= today).length;
  await chrome.action.setBadgeText({ text: due ? String(due) : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#F2B544' });
  await chrome.action.setBadgeTextColor?.({ color: '#151A2E' });
}

function scheduleBadge() {
  chrome.alarms.create('badge', { periodInMinutes: 30 });
  updateBadge();
}

// --- End-of-day work summary ----------------------------------------------------

async function scheduleWorkSummary() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  const [hour, minute] = (settings.workSummaryTime || '18:00').split(':').map(Number);
  const next = new Date();
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
  chrome.alarms.create('work-summary', { when: next.getTime(), periodInMinutes: 24 * 60 });
}

async function writeWorkSummary() {
  const { githubAuth, settings = {} } = await chrome.storage.local.get(['githubAuth', 'settings']);
  if (!githubAuth?.token) return;
  const [record] = await buildWorkDays(githubAuth.token, githubAuth.login, [dateKey()]);
  await saveWorkRecords([record], markDirtyForSync);
  if (settings.workNotify === false || (!record.stats.commits && !record.prs.length)) return;
  chrome.notifications.create(`work-summary:${record.id}`, {
    type: 'basic',
    iconUrl: 'icons/icon-128.png',
    title: record.stats.commits ? `Your day: ${record.stats.commits} commits` : 'Your day on GitHub',
    message: record.summary.length > 240 ? `${record.summary.slice(0, 237)}…` : record.summary,
    priority: 1,
  });
}

// The dashboard pushes these to Supabase the next time it syncs.
async function markDirtyForSync(table, ids) {
  const { supabaseSession, syncDirty = {} } = await chrome.storage.local.get(['supabaseSession', 'syncDirty']);
  if (!supabaseSession) return;
  syncDirty[table] = { ...(syncDirty[table] || {}) };
  ids.forEach((id) => { syncDirty[table][id] = Date.now(); });
  await chrome.storage.local.set({ syncDirty });
}

// --- Keep my streak ---------------------------------------------------------------

// Checks often so a missed time (Chrome closed, computer asleep) is caught up
// soon after; before the set time, or once today is settled, a check is just
// a storage read.
function scheduleStreak() {
  chrome.alarms.create('streak', { periodInMinutes: 5 });
  checkStreak();
}

async function checkStreak() {
  const before = await chrome.storage.local.get(STREAK_STATE_KEY);
  const state = await keepStreak().catch(() => null);
  const was = before[STREAK_STATE_KEY];
  const isNew = state?.status === 'committed' && !(was?.status === 'committed' && was.date === state.date);
  if (!isNew) return;
  chrome.notifications.create(`streak:${state.date}`, {
    type: 'basic',
    iconUrl: 'icons/icon-128.png',
    title: 'Streak kept',
    message: `No contribution yet today, so My Daily committed today's log to ${state.repo}: "${state.message}"`,
    priority: 1,
  });
}

chrome.notifications.onClicked.addListener(async (id) => {
  if (id.startsWith('streak:')) {
    chrome.notifications.clear(id);
    const { [STREAK_STATE_KEY]: state } = await chrome.storage.local.get(STREAK_STATE_KEY);
    if (state?.url) chrome.tabs.create({ url: state.url });
    return;
  }
  if (!id.startsWith('work-summary:')) return;
  chrome.notifications.clear(id);
  await chrome.storage.local.set({ activeTab: 'tab-work', workView: id.split(':')[1] });
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
});

// --- Wiring ----------------------------------------------------------------------

function startUp() {
  scheduleBadge();
  scheduleWorkSummary();
  scheduleStreak();
}

chrome.runtime.onInstalled.addListener(startUp);
chrome.runtime.onStartup.addListener(startUp);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'badge') updateBadge();
  if (alarm.name === 'work-summary') writeWorkSummary().catch(() => {});
  if (alarm.name === 'streak') checkStreak();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.tasks) updateBadge();
  if (changes.settings && changes.settings.newValue?.workSummaryTime !== changes.settings.oldValue?.workSummaryTime) {
    scheduleWorkSummary();
  }
});
