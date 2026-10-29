// The Work tab: what you pushed to GitHub today, yesterday and on earlier
// days, with a written summary of each day. The background service worker
// also writes the day's summary at the time set in Settings.
//
// Today's commits are checked every 10 minutes while any dashboard tab is
// open, whichever tab you're on, so matching to-do items get marked done.
import { load, save, watch } from './store.js';
import { markDirty } from './sync.js';
import { buildWorkDays, saveWorkRecords, workMarkdown, cleanSubject, dayLabel } from './github.js';
import { completeFromCommits } from './tasks.js';
import { initContributions, refreshContributions } from './contributions.js';
import { openSettings } from './settings.js';
import { dateKey, addDays, timeAgo } from './dates.js';
import { el, toast, plural } from './ui.js';

const STALE = 10 * 60 * 1000; // how long today's numbers are reused
const SHOWN_COMMITS = 8;
const $ = (id) => document.getElementById(id);
const listFormat = new Intl.ListFormat(undefined, { style: 'long', type: 'conjunction' });
const numberFormat = new Intl.NumberFormat();

let auth = null; // { token, login }
let records = []; // the work log, newest first
let view = dateKey(); // the day on screen
let visible = false;
let loading = false;
let error = null;
const expanded = new Set(); // repos showing all their commits

export async function initWork() {
  auth = await load('githubAuth', null);
  records = await load('workLog', []);
  // A click on the end-of-day notification asks for its day.
  const requested = await load('workView', null);
  if (requested) {
    view = requested;
    save('workView', null);
  }

  watch('githubAuth', (value) => {
    auth = value || null;
    error = null;
    render();
    refreshWork();
  });
  watch('workLog', (value) => {
    records = value || [];
    render();
    completeFromCommits(records.slice(0, 2));
  });
  $('work-refresh').addEventListener('click', () => refreshWork({ force: true }));
  $('work-copy').addEventListener('click', copySummary);
  $('work-listen').addEventListener('click', listen);
  $('work-connect-button').addEventListener('click', () => openSettings('github-section'));

  render();
  initContributions();
  completeFromCommits(records.slice(0, 2));
  refreshWork();
  setInterval(() => { if (!document.hidden) refreshWork(); }, 60_000);
}

export function setWorkVisible(isVisible) {
  visible = isVisible;
  if (isVisible) refreshWork();
}

// Rebuilds today when it's more than a few minutes old, and yesterday until
// it has been written after the day ended. The contribution graph refreshes
// alongside, while the Work tab is open.
async function refreshWork({ force = false } = {}) {
  if (visible || force) refreshContributions({ force });
  if (!auth?.token || loading) return;
  const today = dateKey();
  const yesterday = addDays(today, -1);
  const saved = (day) => records.find((r) => r.id === day);
  const days = [];
  if (force || !saved(today) || Date.now() - saved(today).generatedAt > STALE) days.push(today);
  if (force || !saved(yesterday)?.final) days.push(yesterday);
  if (!days.length) return;

  loading = true;
  error = null;
  render();
  try {
    const fresh = await buildWorkDays(auth.token, auth.login, days);
    records = await saveWorkRecords(fresh, markDirty);
    completeFromCommits(fresh);
  } catch (e) {
    error = e.message;
  } finally {
    loading = false;
    render();
  }
}

async function copySummary() {
  const record = records.find((r) => r.id === view);
  if (!record) return;
  try {
    await navigator.clipboard.writeText(workMarkdown(record));
    toast('Summary copied');
  } catch {
    toast('Couldn\'t copy. Select the summary text and copy it instead.');
  }
}

const pointsOf = (record) => (record.points?.length ? record.points : [record.summary]);

// Reads the day's bullets aloud with Chrome's built-in speech; pressing again stops.
function listen() {
  const button = $('work-listen');
  if (speechSynthesis.speaking) {
    speechSynthesis.cancel();
    return;
  }
  const record = records.find((r) => r.id === view);
  if (!record) return;
  const speech = new SpeechSynthesisUtterance(`${dayLabel(view)}. ${pointsOf(record).join('. ')}.`.replace(/\+/g, 'plus ').replace(/−/g, 'minus '));
  speech.rate = 1.05;
  const done = () => {
    button.setAttribute('aria-pressed', 'false');
    button.querySelector('span').textContent = 'Listen';
  };
  speech.onend = done;
  speech.onerror = done;
  button.setAttribute('aria-pressed', 'true');
  button.querySelector('span').textContent = 'Stop';
  speechSynthesis.speak(speech);
}

// --- Rendering ------------------------------------------------------------------

function render() {
  const connected = Boolean(auth?.token);
  $('work-connect').hidden = connected;
  $('work-main').hidden = !connected;
  renderHistory();
  if (!connected) return;
  renderDays();
  renderDay();
}

// Today, yesterday, then earlier days that have a summary.
function dayList() {
  const today = dateKey();
  const days = [today, addDays(today, -1)];
  for (const r of records) if (!days.includes(r.id) && days.length < 7) days.push(r.id);
  if (!days.includes(view)) days.push(view);
  return days;
}

function renderDays() {
  const days = dayList();
  const buttons = days.map((day) => {
    const label = dayLabel(day);
    const short = label === 'Today' || label === 'Yesterday' ? label : new Date(`${day}T00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    const selected = day === view;
    const button = el('button', 'learn-tab', { type: 'button', role: 'tab', 'aria-selected': String(selected), tabindex: selected ? '0' : '-1', text: short });
    button.addEventListener('click', () => showDay(day));
    return button;
  });
  buttons.forEach((button, i) => button.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const next = days[(i + (event.key === 'ArrowRight' ? 1 : -1) + days.length) % days.length];
    showDay(next);
    $('work-days').querySelector('[aria-selected="true"]')?.focus();
  }));
  $('work-days').replaceChildren(...buttons);
}

function showDay(day) {
  view = day;
  globalThis.speechSynthesis?.cancel();
  render();
}

function renderDay() {
  const record = records.find((r) => r.id === view);
  $('work-title').textContent = `${dayLabel(view)}: summary`;
  $('work-copy').disabled = !record;
  $('work-listen').disabled = !record || !globalThis.speechSynthesis;
  $('work-refresh').classList.toggle('is-loading', loading);

  let status = '';
  if (loading) status = 'Checking GitHub…';
  else if (error) status = error;
  else if (record) status = `Updated ${timeAgo(record.generatedAt)}`;
  $('work-status').textContent = status;
  $('work-status').title = record && auth?.login ? `From @${auth.login}` : '';
  $('work-status').classList.toggle('is-error', Boolean(error) && !loading);

  if (!record) {
    $('work-points').replaceChildren(el('li', 'work-point is-plain', { text: loading ? 'Looking at what you pushed…' : 'There\'s no summary for this day.' }));
    $('work-stats').replaceChildren();
    $('work-repos').replaceChildren();
    $('work-prs-section').hidden = true;
    return;
  }

  // The first bullet is the headline; nothing pushed reads as a plain line.
  const quiet = !record.points?.length;
  $('work-points').replaceChildren(...pointsOf(record).map((point, i) => el('li', `work-point${quiet ? ' is-plain' : ''}${i === 0 && !quiet ? ' is-lead' : ''}`, { text: point })));
  const { stats } = record;
  const prCount = stats.opened + stats.merged + stats.reviewed;
  const statItems = [
    [stats.commits, stats.commits === 1 ? 'Commit' : 'Commits'],
    [stats.repos, stats.repos === 1 ? 'Repo' : 'Repos'],
    [`+${numberFormat.format(stats.additions)} −${numberFormat.format(stats.deletions)}`, 'Lines changed'],
    [prCount, prCount === 1 ? 'Pull request' : 'Pull requests'],
  ];
  $('work-stats').replaceChildren(...statItems.map(([value, label]) => {
    const stat = el('div', 'stat');
    stat.append(el('span', 'stat-value', { text: value }), el('span', 'stat-label', { text: label }));
    return stat;
  }));

  $('work-repos').replaceChildren(...record.repos.map(renderRepo));
  $('work-prs-section').hidden = !record.prs.length;
  $('work-prs').replaceChildren(...record.prs.map(renderPullRequest));
}

function lineCounts(additions, deletions) {
  const span = el('span', 'work-lines');
  span.append(el('span', 'work-add', { text: `+${numberFormat.format(additions)}` }), el('span', 'work-del', { text: `−${numberFormat.format(deletions)}` }));
  return span;
}

function renderRepo(repo) {
  const section = el('section', 'work-repo');
  const head = el('div', 'work-repo-head');
  const title = el('div', 'work-repo-title');
  title.append(el('a', 'work-repo-name', { href: repo.url, text: repo.repo }), el('span', 'work-repo-owner', { text: repo.owner }));
  const numbers = el('div', 'work-repo-numbers');
  numbers.append(el('span', '', { text: plural(repo.count, 'commit') }), lineCounts(repo.additions, repo.deletions));
  head.append(title, numbers);
  section.append(head);

  const meta = el('div', 'work-repo-meta');
  repo.branches.forEach((branch) => meta.append(el('span', 'work-branch', { text: branch, title: 'Branch' })));
  if (repo.areas.length) meta.append(el('span', 'work-areas', { text: `Mostly in ${listFormat.format(repo.areas)}` }));
  if (meta.childElementCount) section.append(meta);

  const showAll = expanded.has(repo.name);
  const list = el('ol', 'work-commits');
  list.append(...repo.commits.slice(0, showAll ? undefined : SHOWN_COMMITS).map((c) => {
    const li = el('li', c.merge ? 'work-commit is-merge' : 'work-commit');
    li.append(el('time', 'work-time', { datetime: new Date(c.at).toISOString(), text: new Date(c.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) }));
    li.append(el('a', 'work-message', { href: c.url, text: c.merge ? c.message : cleanSubject(c.message), title: c.message }));
    li.append(c.merge ? el('span', 'work-tag', { text: 'Merge' }) : lineCounts(c.additions, c.deletions));
    return li;
  }));
  section.append(list);

  if (repo.commits.length > SHOWN_COMMITS) {
    const toggle = el('button', 'link-button', { type: 'button', text: showAll ? 'Show fewer' : `Show all ${repo.commits.length} commits` });
    toggle.addEventListener('click', () => {
      if (showAll) expanded.delete(repo.name);
      else expanded.add(repo.name);
      renderDay();
    });
    section.append(toggle);
  }
  return section;
}

const PR_LABELS = { opened: 'Opened', merged: 'Merged', reviewed: 'Reviewed', closed: 'Closed', reopened: 'Reopened' };

function renderPullRequest(pr) {
  const li = el('li', 'work-pr');
  li.append(el('span', `work-pr-state work-pr-state--${pr.action}`, { text: PR_LABELS[pr.action] || pr.action }));
  const body = el('div', 'work-pr-body');
  body.append(el('a', 'work-message', { href: pr.url, text: pr.title }));
  body.append(el('span', 'work-pr-meta', { text: `${pr.repo.split('/')[1]} #${pr.number}` }));
  li.append(body);
  return li;
}

function renderHistory() {
  const list = $('work-history');
  if (!auth?.token) {
    list.replaceChildren(el('li', 'empty', { text: 'Connect GitHub to start keeping a history of your work.' }));
    return;
  }
  if (!records.length) {
    list.replaceChildren(el('li', 'empty', { text: loading ? 'Checking GitHub…' : 'No days recorded yet.' }));
    return;
  }
  list.replaceChildren(...records.slice(0, 14).map((r) => {
    const li = el('li');
    const button = el('button', 'work-day', { type: 'button', 'aria-pressed': String(r.id === view) });
    const line = r.stats.commits
      ? `${plural(r.stats.commits, 'commit')}, mostly ${r.repos[0]?.repo}`
      : r.prs.length ? plural(r.prs.length, 'pull request') : 'Nothing pushed';
    button.append(el('span', 'work-day-name', { text: dayLabel(r.id) }), el('span', 'work-day-line', { text: line }));
    button.addEventListener('click', () => showDay(r.id));
    li.append(button);
    return li;
  }));
}
