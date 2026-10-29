// Your GitHub contribution graph (the green squares on your profile) and your
// streaks, for the Work tab. With a token it asks GitHub's GraphQL API;
// without one it reads the public graph on your profile. Either way the
// squares match what GitHub shows, because GitHub decides what counts.
import { load, save, watch } from './store.js';
import { fetchThroughBackground } from './net.js';
import { dateKey, addDays, parseKey } from './dates.js';
import { el, inertHtml, plural } from './ui.js';

const CACHE_KEY = 'contribCalendar';
const STALE = 30 * 60 * 1000;
const LEVELS = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };
const QUERY = `query($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount contributionLevel } }
      }
    }
  }
}`;
const $ = (id) => document.getElementById(id);
const numberFormat = new Intl.NumberFormat();

let calendar = null; // { login, fetchedAt, total, days: [{ date, count, level }] }
let loading = false;

export async function initContributions() {
  calendar = await load(CACHE_KEY, null);
  watch('githubAuth', () => refreshContributions({ force: true }));
  render();
}

export async function refreshContributions({ force = false } = {}) {
  const auth = await load('githubAuth', null);
  if (!auth?.login || loading) return;
  if (!force && calendar?.login === auth.login && Date.now() - calendar.fetchedAt < STALE) return;
  loading = true;
  render();
  try {
    const days = auth.token
      ? await fromGraphQL(auth).catch(() => fromProfilePage(auth.login))
      : await fromProfilePage(auth.login);
    calendar = { login: auth.login, fetchedAt: Date.now(), days, total: days.reduce((n, d) => n + d.count, 0) };
    await save(CACHE_KEY, calendar);
  } catch {
    // Keep showing the last graph; it fills in again on the next refresh.
  } finally {
    loading = false;
    render();
  }
}

async function fromGraphQL({ token, login }) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: QUERY, variables: { login } }),
    credentials: 'omit',
  });
  if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
  const { data } = await res.json();
  const weeks = data?.user?.contributionsCollection?.contributionCalendar?.weeks;
  if (!weeks) throw new Error('No contribution calendar');
  return weeks.flatMap((w) => w.contributionDays).map((d) => ({
    date: d.date,
    count: d.contributionCount,
    level: LEVELS[d.contributionLevel] ?? 0,
  }));
}

// The same graph from your public profile page, for when there's no token.
async function fromProfilePage(login) {
  const res = await fetchThroughBackground(`https://github.com/users/${encodeURIComponent(login)}/contributions`);
  if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
  const doc = inertHtml(res.text);
  const tips = new Map([...doc.querySelectorAll('tool-tip[for]')].map((t) => [t.getAttribute('for'), t.textContent]));
  const days = [...doc.querySelectorAll('td[data-date]')].map((cell) => {
    const tip = tips.get(cell.id) || '';
    return {
      date: cell.getAttribute('data-date'),
      count: Number(tip.match(/^(\d+)/)?.[1] || 0),
      level: Number(cell.getAttribute('data-level')) || 0,
    };
  });
  if (!days.length) throw new Error('No contribution calendar on the page');
  return days.sort((a, b) => a.date.localeCompare(b.date));
}

// --- Streaks ------------------------------------------------------------------------

// Days in a row with at least one contribution. Today still counts toward the
// current streak until it's over, so a streak isn't "broken" at breakfast.
export function streaks(days) {
  const active = new Set(days.filter((d) => d.count > 0).map((d) => d.date));
  let day = dateKey();
  if (!active.has(day)) day = addDays(day, -1);
  let current = 0;
  while (active.has(day)) {
    current += 1;
    day = addDays(day, -1);
  }
  let longest = 0;
  let run = 0;
  for (const d of days) {
    run = d.count > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  const today = days.find((d) => d.date === dateKey())?.count || 0;
  return { current, longest, today, activeDays: active.size };
}

// --- Rendering ------------------------------------------------------------------------

function render() {
  const section = $('contrib-section');
  if (!section) return;
  if (!calendar?.days?.length) {
    section.hidden = !loading;
    $('contrib-stats').replaceChildren(el('span', 'contrib-note', { text: 'Loading your contribution graph…' }));
    $('contrib-graph').replaceChildren();
    return;
  }
  section.hidden = false;
  const { current, longest, today, activeDays } = streaks(calendar.days);
  const stat = (value, label, accent = false) => {
    const node = el('div', accent ? 'contrib-stat is-accent' : 'contrib-stat');
    node.append(el('span', 'contrib-stat-value', { text: value }), el('span', 'contrib-stat-label', { text: label }));
    return node;
  };
  $('contrib-stats').replaceChildren(
    stat(plural(current, 'day'), current ? 'Current streak' : 'No streak yet. Push today to start one', current > 0),
    stat(plural(longest, 'day'), 'Longest streak'),
    stat(numberFormat.format(today), today === 1 ? 'Contribution today' : 'Contributions today'),
    stat(numberFormat.format(calendar.total), `In the last year, on ${plural(activeDays, 'day')}`),
  );
  $('contrib-graph').replaceChildren(renderGraph(calendar.days));
}

const WEEKDAY_LABELS = { 1: 'Mon', 3: 'Wed', 5: 'Fri' };

// Weeks as columns, Sunday to Saturday down each one, like GitHub's graph.
function renderGraph(days) {
  const grid = el('div', 'contrib-grid', { role: 'img', 'aria-label': `${numberFormat.format(calendar.total)} contributions in the last year` });
  const first = parseKey(days[0].date);
  const offset = first.getDay(); // the first week can start mid-week
  const weeks = Math.ceil((days.length + offset) / 7);
  grid.style.setProperty('--weeks', weeks);
  const today = dateKey();

  // Month names over the week each month starts in. A month that only just
  // makes it onto the graph is left unnamed, so its label doesn't overlap the next.
  const starts = [];
  days.forEach((d, i) => {
    const date = parseKey(d.date);
    if (i === 0 || date.getDate() === 1) starts.push({ week: Math.floor((i + offset) / 7), date });
  });
  starts.forEach(({ week, date }, i) => {
    const next = starts[i + 1];
    if ((next && next.week - week < 3) || week >= weeks - 1) return;
    const label = el('span', 'contrib-month', { text: date.toLocaleDateString(undefined, { month: 'short' }) });
    label.style.gridColumn = `${week + 2} / span 4`;
    grid.append(label);
  });
  for (const [weekday, name] of Object.entries(WEEKDAY_LABELS)) {
    const label = el('span', 'contrib-weekday', { text: name });
    label.style.gridRow = `${Number(weekday) + 2}`;
    grid.append(label);
  }
  days.forEach((d, i) => {
    const date = parseKey(d.date);
    const cell = el('span', `contrib-day level-${d.level}${d.date === today ? ' is-today' : ''}`, {
      title: `${d.count ? plural(d.count, 'contribution') : 'No contributions'} on ${date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}`,
    });
    cell.style.gridColumn = `${Math.floor((i + offset) / 7) + 2}`;
    cell.style.gridRow = `${date.getDay() + 2}`;
    grid.append(cell);
  });

  const legend = el('div', 'contrib-legend');
  legend.append(el('span', '', { text: 'Less' }), ...[0, 1, 2, 3, 4].map((l) => el('span', `contrib-day level-${l}`)), el('span', '', { text: 'More' }));
  const wrap = el('div', 'contrib-wrap');
  wrap.append(grid, legend);
  return wrap;
}
