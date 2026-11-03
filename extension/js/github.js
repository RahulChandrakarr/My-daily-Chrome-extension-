// Your GitHub activity for the Work tab: the commits you pushed, the branches
// they went to and the pull requests you opened, merged or reviewed on a day,
// plus a written summary of that day.
//
// How it finds your work: the repos you pushed to recently, and each one's
// activity log, list your pushes as they happen. Your event feed adds pull
// requests and fills gaps (it can lag by hours, so it isn't relied on alone).
// GitHub doesn't list commits inside pushes, so each push is expanded with the
// compare API. Commit details (lines and files changed) never change, so
// they're cached.
//
// There's no page code here, so the background service worker can use it to
// write the end-of-day summary.
import { load, save } from './store.js';
import { dateKey, parseKey, addDays } from './dates.js';
import { plural } from './ui.js';

const API = 'https://api.github.com';
const COMMIT_CACHE_KEY = 'githubCommitCache';
const WORK_LOG_KEY = 'workLog';
const KEEP_DAYS = 90;
const ZERO_SHA = /^0+$/;
// Lockfiles and build output would swamp the line counts.
const NOISE = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|composer\.lock|Gemfile\.lock|poetry\.lock|Cargo\.lock)$|(^|\/)(dist|build|\.next|node_modules|vendor)\//;
const listFormat = new Intl.ListFormat(undefined, { style: 'long', type: 'conjunction' });
const numberFormat = new Intl.NumberFormat();

export class GitHubError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function gh(token, path) {
  const res = await fetch(`${API}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: 'omit',
    cache: 'no-store',
  });
  if (res.status === 401) throw new GitHubError("GitHub didn't accept the token. Connect again in Settings.", 401);
  if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
    throw new GitHubError("GitHub's hourly request limit was reached. Try again in a while.", 403);
  }
  if (!res.ok) throw new GitHubError(`GitHub returned ${res.status}`, res.status);
  return res.json();
}

export const githubGet = gh;

export async function verifyToken(token) {
  const user = await gh(token, '/user');
  return { login: user.login, name: user.name || user.login };
}

// One work record per day ('YYYY-MM-DD', local time). Works for older days too:
// only pushes from those days (and two days after, for commits pushed late)
// are expanded.
export async function buildWorkDays(token, login, days) {
  const sorted = [...days].sort();
  const from = parseKey(sorted[0]).getTime();
  const until = parseKey(addDays(sorted.at(-1), 3)).getTime();
  // A rejected token should stop everything; other failures just mean less to go on.
  const softly = (promise) => promise.catch((error) => {
    if (error.status === 401) throw error;
    return [];
  });
  const [events, activity] = await Promise.all([
    softly(eventsSince(token, login, from)),
    softly(recentPushes(token, login, from)),
  ]);
  const pushes = mergePushes(activity, events).filter((p) => p.at < until);
  const [commits, prs] = await Promise.all([
    commitsFromPushes(token, login, pushes, from),
    pullRequests(token, events.filter((e) => Date.parse(e.created_at) < until)),
  ]);
  return days.map((day) => {
    const start = parseKey(day).getTime();
    const end = parseKey(addDays(day, 1)).getTime();
    const inDay = (at) => at >= start && at < end;
    return summarizeDay(day, commits.filter((c) => inDay(c.at)), prs.filter((p) => inDay(p.at)));
  });
}

// Adds records to the saved work log (newest first, last 90 days).
export async function saveWorkRecords(records, markDirty = async () => {}) {
  const saved = await load(WORK_LOG_KEY, []);
  const byId = new Map(saved.map((r) => [r.id, r]));
  records.forEach((r) => byId.set(r.id, r));
  const cutoff = addDays(dateKey(), -KEEP_DAYS);
  const next = [...byId.values()].filter((r) => r.id >= cutoff).sort((a, b) => b.id.localeCompare(a.id));
  await save(WORK_LOG_KEY, next);
  await markDirty('work_log', records.map((r) => r.id));
  return next;
}

// --- Collecting -----------------------------------------------------------------

async function eventsSince(token, login, from) {
  const events = [];
  for (let page = 1; page <= 3; page += 1) {
    const batch = await gh(token, `/users/${encodeURIComponent(login)}/events?per_page=100&page=${page}`);
    events.push(...batch);
    if (batch.length < 100 || Date.parse(batch.at(-1).created_at) < from) break;
  }
  return events.filter((e) => Date.parse(e.created_at) >= from);
}

// Your pushes from each recently pushed repo's activity log, which is up to
// date (unlike the event feed). Pushes, force pushes and new branches count.
async function recentPushes(token, login, from) {
  const repos = await gh(token, token
    ? '/user/repos?sort=pushed&per_page=30&affiliation=owner,collaborator,organization_member'
    : `/users/${encodeURIComponent(login)}/repos?sort=pushed&per_page=30`);
  const active = repos.filter((r) => Date.parse(r.pushed_at) >= from).slice(0, 15);
  const age = (Date.now() - from) / (24 * 60 * 60 * 1000);
  const period = age <= 6 ? 'week' : age <= 29 ? 'month' : age <= 89 ? 'quarter' : 'year';
  const logs = await mapLimit(active, 4, (repo) => gh(token, `/repos/${repo.full_name}/activity?actor=${encodeURIComponent(login)}&time_period=${period}&per_page=100`).catch(() => []));
  return active.flatMap((repo, i) => logs[i]
    .filter((a) => ['push', 'force_push', 'branch_creation'].includes(a.activity_type) && Date.parse(a.timestamp) >= from)
    .map((a) => ({ repo: repo.full_name, ref: a.ref, before: a.before, head: a.after, at: Date.parse(a.timestamp) })));
}

// One list of pushes from both sources, without repeats.
function mergePushes(activity, events) {
  const fromEvents = events
    .filter((e) => e.type === 'PushEvent' && e.payload?.head)
    .map((e) => ({ repo: e.repo.name, ref: e.payload.ref, before: e.payload.before, head: e.payload.head, at: Date.parse(e.created_at) }));
  const seen = new Set();
  return [...activity, ...fromEvents].filter((p) => {
    const key = `${p.repo}:${p.head}`;
    if (!p.head || ZERO_SHA.test(p.head) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function commitsFromPushes(token, login, pushes, from) {
  const me = login.toLowerCase();
  const isMine = (c) => [c.author?.login, c.committer?.login].some((name) => name?.toLowerCase() === me);
  const lists = await mapLimit(pushes, 4, (push) => pushedCommits(token, login, push, from).catch(() => []));

  const found = new Map();
  pushes.forEach((push, i) => {
    const { repo } = push;
    const branch = (push.ref || '').replace(/^refs\/heads\//, '');
    for (const c of lists[i]) {
      if (!isMine(c)) continue;
      const known = found.get(c.sha);
      if (known) {
        if (branch && !known.branches.includes(branch)) known.branches.push(branch);
        continue;
      }
      // When the commit was last made (a rebase or amend counts), else when it was pushed.
      const at = Date.parse(c.commit?.committer?.date || c.commit?.author?.date) || push.at;
      if (at < from) continue;
      found.set(c.sha, {
        sha: c.sha,
        repo,
        branches: branch ? [branch] : [],
        message: (c.commit?.message || '').split('\n')[0].trim(),
        url: c.html_url || `https://github.com/${repo}/commit/${c.sha}`,
        at,
        merge: (c.parents?.length || 0) > 1,
        additions: 0,
        deletions: 0,
        files: [],
      });
    }
  });

  const cache = await load(COMMIT_CACHE_KEY, {});
  const own = [...found.values()].filter((c) => !c.merge).slice(0, 100);
  await mapLimit(own, 4, async (c) => {
    const detail = cache[c.sha] || await commitDetail(token, c.repo, c.sha).catch(() => null);
    if (!detail) return;
    cache[c.sha] = detail;
    Object.assign(c, { additions: detail.additions, deletions: detail.deletions, files: detail.files });
  });
  await save(COMMIT_CACHE_KEY, pruneCache(cache));
  return [...found.values()];
}

async function pushedCommits(token, login, push, from) {
  const { repo, before, head } = push;
  if (before && !ZERO_SHA.test(before)) {
    try {
      const compare = await gh(token, `/repos/${repo}/compare/${before}...${head}`);
      if (compare.commits?.length) return compare.commits;
    } catch {
      // History rewritten by a force push, for example. Fall back below.
    }
  }
  // A new branch has no "before", so read the branch's recent commits instead.
  const since = new Date(from).toISOString();
  return gh(token, `/repos/${repo}/commits?sha=${head}&author=${encodeURIComponent(login)}&since=${since}&per_page=50`);
}

async function commitDetail(token, repo, sha) {
  const c = await gh(token, `/repos/${repo}/commits/${sha}`);
  const files = (c.files || [])
    .map((f) => [f.filename, f.additions || 0, f.deletions || 0])
    .filter(([name]) => !NOISE.test(name));
  return {
    additions: files.reduce((n, f) => n + f[1], 0),
    deletions: files.reduce((n, f) => n + f[2], 0),
    files: files.sort((a, b) => (b[1] + b[2]) - (a[1] + a[2])).slice(0, 40),
    at: Date.now(),
  };
}

function pruneCache(cache) {
  const entries = Object.entries(cache);
  if (entries.length <= 1500) return cache;
  return Object.fromEntries(entries.sort((a, b) => b[1].at - a[1].at).slice(0, 1500));
}

async function pullRequests(token, events) {
  const relevant = events.filter((e) => (e.type === 'PullRequestEvent' && ['opened', 'closed', 'reopened'].includes(e.payload?.action))
    || e.type === 'PullRequestReviewEvent');
  // Event payloads are trimmed, so fetch each pull request's title once.
  const details = new Map();
  const detail = (repo, number) => {
    const key = `${repo}#${number}`;
    if (!details.has(key)) details.set(key, gh(token, `/repos/${repo}/pulls/${number}`).catch(() => null));
    return details.get(key);
  };
  const items = await mapLimit(relevant, 4, async (e) => {
    const repo = e.repo.name;
    const pr = e.payload.pull_request || {};
    const number = pr.number || e.payload.number;
    if (!number) return null;
    const full = (pr.title && pr.html_url && 'merged' in pr ? pr : await detail(repo, number)) || pr;
    let action = e.payload.action;
    if (e.type === 'PullRequestReviewEvent') action = 'reviewed';
    else if (action === 'closed') action = full.merged || full.merged_at ? 'merged' : 'closed';
    return {
      id: `${repo}#${number}:${action}`,
      repo,
      number,
      title: full.title || `Pull request #${number}`,
      url: full.html_url || `https://github.com/${repo}/pull/${number}`,
      action,
      at: Date.parse(e.created_at),
    };
  });
  const unique = new Map();
  items.filter(Boolean).forEach((p) => unique.set(p.id, p));
  return [...unique.values()].sort((a, b) => b.at - a.at);
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// --- Summarising ----------------------------------------------------------------

export function summarizeDay(day, commits, prs) {
  const repos = groupByRepo(commits);
  const own = commits.filter((c) => !c.merge);
  const stats = {
    commits: own.length,
    merges: commits.length - own.length,
    repos: repos.length,
    additions: own.reduce((n, c) => n + c.additions, 0),
    deletions: own.reduce((n, c) => n + c.deletions, 0),
    opened: prs.filter((p) => p.action === 'opened').length,
    merged: prs.filter((p) => p.action === 'merged').length,
    reviewed: prs.filter((p) => p.action === 'reviewed').length,
  };
  const now = Date.now();
  const done = doneTasks(own);
  const record = {
    id: day,
    stats,
    repos,
    prs,
    overview: overviewLine(stats, repos),
    done: done.slice(0, MAX_TASKS),
    moreCommits: Math.max(done.length - MAX_TASKS, 0),
    highlights: done.slice(0, 3).map((t) => t.text),
    generatedAt: now,
    final: now >= parseKey(addDays(day, 1)).getTime(), // written after the day ended
    updatedAt: now,
  };
  record.points = summaryPoints(record);
  record.summary = shortSummary(day, record);
  return record;
}

function groupByRepo(commits) {
  const byRepo = new Map();
  for (const c of commits) {
    if (!byRepo.has(c.repo)) byRepo.set(c.repo, []);
    byRepo.get(c.repo).push(c);
  }
  return [...byRepo].map(([name, list]) => {
    const own = list.filter((c) => !c.merge);
    const areas = new Map();
    for (const c of own) {
      for (const [file, add, del] of c.files) areas.set(areaOf(file), (areas.get(areaOf(file)) || 0) + add + del);
    }
    const [owner, repo] = name.split('/');
    return {
      name,
      owner,
      repo,
      url: `https://github.com/${name}`,
      count: own.length,
      additions: own.reduce((n, c) => n + c.additions, 0),
      deletions: own.reduce((n, c) => n + c.deletions, 0),
      branches: [...new Set(list.flatMap((c) => c.branches))],
      // Busiest folders first; "extension" is dropped when "extension/js" is listed.
      areas: [...areas]
        .sort((a, b) => b[1] - a[1])
        .map(([area]) => area)
        .filter((area, _, all) => !all.some((other) => other.startsWith(`${area}/`)))
        .slice(0, 4),
      commits: list.sort((a, b) => b.at - a.at).map(({ files, repo: _, ...c }) => c),
    };
  }).sort((a, b) => b.count - a.count || (b.additions + b.deletions) - (a.additions + a.deletions));
}

// "app/api/leads/route.ts" -> "app/api"; "README.md" -> "README.md".
function areaOf(path) {
  const parts = path.split('/');
  return parts.length === 1 ? path : parts.slice(0, Math.min(2, parts.length - 1)).join('/');
}

// "feat(leads): add scoring endpoint" -> "Add scoring endpoint".
export function cleanSubject(message) {
  const subject = message.replace(/^(\w+)(\([^)]*\))?!?:\s*/, '').trim();
  return subject.charAt(0).toUpperCase() + subject.slice(1);
}

// --- What you did, one short line per commit ------------------------------------------

const MAX_TASKS = 5;
const MAX_TASK_LENGTH = 64;
const TRIVIAL = /^(?:wip|updates?|changes?|fix(?:es)?|minor|misc|tweaks?|cleanup|typo|refactor)\.?$|^merged? (?:branch|pull request|remote-tracking)/i;

// Leading verbs in commit messages, and how they read once done.
const PAST = {
  add: 'added', adjust: 'adjusted', align: 'aligned', allow: 'allowed', animate: 'animated', block: 'blocked',
  build: 'built', bump: 'bumped', change: 'changed', check: 'checked', clean: 'cleaned', close: 'closed',
  connect: 'connected', convert: 'converted', correct: 'corrected', create: 'created', delete: 'deleted',
  deploy: 'deployed', disable: 'disabled', display: 'displayed', document: 'documented', drop: 'dropped',
  edit: 'edited', enable: 'enabled', extract: 'extracted', finish: 'finished', fix: 'fixed', handle: 'handled',
  hide: 'hid', implement: 'implemented', improve: 'improved', integrate: 'integrated', introduce: 'introduced',
  keep: 'kept', link: 'linked', list: 'listed', load: 'loaded', make: 'made', merge: 'merged', migrate: 'migrated',
  move: 'moved', open: 'opened', optimise: 'optimised', optimize: 'optimized', polish: 'polished', prevent: 'prevented',
  redesign: 'redesigned', refactor: 'refactored', release: 'released', remove: 'removed', rename: 'renamed',
  render: 'rendered', replace: 'replaced', restore: 'restored', return: 'returned', revert: 'reverted', rewrite: 'rewrote',
  save: 'saved', send: 'sent', set: 'set', ship: 'shipped', show: 'showed', simplify: 'simplified', speed: 'sped',
  split: 'split', start: 'started', stop: 'stopped', support: 'supported', switch: 'switched', sync: 'synced',
  test: 'tested', tidy: 'tidied', update: 'updated', upgrade: 'upgraded', upload: 'uploaded', use: 'used',
  validate: 'validated', wrap: 'wrapped', write: 'wrote',
};

function pastTense(text) {
  const [first, ...rest] = text.split(' ');
  const done = PAST[first.toLowerCase()];
  if (!done) return text;
  return [first[0] === first[0].toUpperCase() ? capitalise(done) : done, ...rest].join(' ');
}

// One line saying what a commit did, in the past tense:
//   "feat(leads): add lead scoring endpoint"            -> "Added lead scoring endpoint"
//   "Tidy the project root: unused files removed, …"    -> "Tidied the project root"
//   "fix: refresh token before expiry"                  -> "Fixed: Refresh token before expiry"
export function taskLine(message) {
  const subject = message.split('\n')[0];
  const type = subject.match(/^(\w+)(?:\([^)]*\))?!?:\s/)?.[1]?.toLowerCase();
  let text = cleanSubject(subject)
    .replace(/\s*\([^()]*\b\d{4}\)\s*$/, '') // "(Rahul, 24 Oct 2026)"
    .replace(/\s*\(#\d+\)\s*$/, '') // "(#42)"
    .replace(/[.\s]+$/, '');
  // A heading before a colon is the task when it says enough on its own
  // ("Tidy the project root: …"); a short one keeps the start of its detail
  // ("Creative Studio: AIVA makes finished ads …").
  const [head, ...rest] = text.split(/:\s/);
  const detail = (s) => s.split(/;\s|\s[—–]\s|,\s+(?:and|with|so|but)\s/)[0];
  text = head.length >= 20 || !rest.length ? detail(head) : `${head}: ${detail(rest.join(': '))}`;
  if (text.length > MAX_TASK_LENGTH) {
    text = `${text.slice(0, MAX_TASK_LENGTH).replace(/\s+\S*$/, '').replace(/[\s,;:–—-]+$/, '')}…`;
  }
  const firstWord = text.split(' ')[0].toLowerCase();
  if (type === 'fix' && firstWord !== 'fix') return `Fixed: ${text}`;
  return pastTense(text);
}

// Each of the day's commits as a task, biggest change first, repeats left out.
function doneTasks(own) {
  const seen = new Set();
  return [...own]
    .sort((a, b) => (b.additions + b.deletions) - (a.additions + a.deletions))
    .map((c) => ({ text: taskLine(c.message), repo: c.repo.split('/')[1], message: c.message.split('\n')[0] }))
    .filter(({ text }) => text && !TRIVIAL.test(text) && !seen.has(text.toLowerCase()) && seen.add(text.toLowerCase()));
}

export function dayLabel(day) {
  const today = dateKey();
  if (day === today) return 'Today';
  if (day === addDays(today, -1)) return 'Yesterday';
  return parseKey(day).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

const capitalise = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// The headline: how much, where, and any pull requests, in one line.
//   "3 commits across 2 repos, +226 −60 lines, merged 1 pull request"
function overviewLine(stats, repos) {
  const parts = [];
  if (stats.commits) {
    const where = stats.repos > 1 ? `across ${stats.repos} repos` : `in ${repos[0].repo}`;
    parts.push(`${plural(stats.commits, 'commit')} ${where}`);
    if (stats.additions || stats.deletions) parts.push(`+${numberFormat.format(stats.additions)} −${numberFormat.format(stats.deletions)} lines`);
  }
  [['merged', stats.merged], ['opened', stats.opened], ['reviewed', stats.reviewed]]
    .filter(([, n]) => n)
    .forEach(([verb, n], i) => parts.push(i === 0 ? `${verb} ${plural(n, 'pull request')}` : `${verb} ${n}`));
  return parts.length ? capitalise(parts.join(', ')) : '';
}

// The summary as plain lines: the headline, then one line per task. Used for
// copying, reading aloud and the notification.
function summaryPoints({ overview, done, moreCommits, stats }) {
  if (!overview) return [];
  const tag = stats.repos > 1;
  return [
    overview,
    ...done.map((t) => (tag ? `${t.text} (${t.repo})` : t.text)),
    ...(moreCommits ? [`And ${plural(moreCommits, 'more commit')}`] : []),
  ];
}

// One line for the notification, the work history and the to-do Done section.
function shortSummary(day, record) {
  const label = dayLabel(day);
  if (!record.points.length) {
    return label === 'Today' ? 'Nothing pushed to GitHub yet today.' : `Nothing pushed to GitHub ${label === 'Yesterday' ? 'yesterday' : `on ${label}`}.`;
  }
  const [first, second] = record.points;
  return `${label}: ${first}.${second ? ` ${second.replace(/[.…]$/, '')}.` : ''}`;
}

// The day as short Markdown bullets, for pasting into a standup or a chat.
export function workMarkdown(record) {
  const date = parseKey(record.id).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const points = record.points?.length ? record.points : [record.summary];
  const lines = [`**Work summary: ${date}**`, ...points.map((p) => `- ${p}`)];
  if (record.prs.length) {
    lines.push('', '**Pull requests**');
    record.prs.forEach((p) => lines.push(`- ${capitalise(p.action)} #${p.number} ${p.title} (${p.repo.split('/')[1]})`));
  }
  return lines.join('\n');
}
