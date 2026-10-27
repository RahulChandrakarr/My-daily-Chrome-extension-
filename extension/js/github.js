// Your GitHub activity for the Work tab: the commits you pushed, the branches
// they went to and the pull requests you opened, merged or reviewed on a day,
// plus a written summary of that day.
//
// How it finds your work: your event feed lists every push (private and
// organisation repos included, when the token can see them). GitHub no longer
// lists commits inside push events, so each push is expanded with the compare
// API. Commit details (lines and files changed) never change, so they're cached.
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

// One work record per day ('YYYY-MM-DD', local time).
export async function buildWorkDays(token, login, days) {
  const from = parseKey([...days].sort()[0]).getTime();
  const events = await eventsSince(token, login, from);
  const [commits, prs] = await Promise.all([
    commitsFromPushes(token, login, events, from),
    pullRequests(token, events),
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

async function commitsFromPushes(token, login, events, from) {
  const pushes = events.filter((e) => e.type === 'PushEvent' && e.payload?.head && !ZERO_SHA.test(e.payload.head));
  const me = login.toLowerCase();
  const isMine = (c) => [c.author?.login, c.committer?.login].some((name) => name?.toLowerCase() === me);
  const lists = await mapLimit(pushes, 4, (push) => pushedCommits(token, login, push, from).catch(() => []));

  const found = new Map();
  pushes.forEach((push, i) => {
    const repo = push.repo.name;
    const branch = (push.payload.ref || '').replace(/^refs\/heads\//, '');
    for (const c of lists[i]) {
      if (!isMine(c)) continue;
      const known = found.get(c.sha);
      if (known) {
        if (branch && !known.branches.includes(branch)) known.branches.push(branch);
        continue;
      }
      // When the commit was last made (a rebase or amend counts), else when it was pushed.
      const at = Date.parse(c.commit?.committer?.date || c.commit?.author?.date) || Date.parse(push.created_at);
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
  const repo = push.repo.name;
  const { before, head } = push.payload;
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
  const record = {
    id: day,
    stats,
    repos,
    prs,
    highlights: highlights(own),
    generatedAt: now,
    final: now >= parseKey(addDays(day, 1)).getTime(), // written after the day ended
    updatedAt: now,
  };
  record.summary = writeSummary(day, record);
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
      areas: [...areas].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([area]) => area),
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

// The commits that changed the most, as plain subjects.
function highlights(own) {
  const seen = new Set();
  return [...own]
    .sort((a, b) => (b.additions + b.deletions) - (a.additions + a.deletions))
    .map((c) => cleanSubject(c.message))
    .filter((s) => s && !/^(wip|update|updates|changes|fix|fixes|minor)\.?$/i.test(s) && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()))
    .slice(0, 3);
}

export function dayLabel(day) {
  const today = dateKey();
  if (day === today) return 'Today';
  if (day === addDays(today, -1)) return 'Yesterday';
  return parseKey(day).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

function writeSummary(day, { stats, repos, prs, highlights: points }) {
  const label = dayLabel(day);
  const when = label === 'Today' || label === 'Yesterday' ? label : `On ${label}`;
  if (!stats.commits && !stats.merges && !prs.length) {
    return label === 'Today' ? 'Nothing pushed to GitHub yet today.' : `${when}, nothing was pushed to GitHub.`;
  }

  const did = [];
  if (stats.commits) {
    let commits = `made ${plural(stats.commits, 'commit')}`;
    commits += stats.repos > 1 ? ` across ${stats.repos} repos` : ` in ${repos[0].repo}`;
    if (stats.additions || stats.deletions) commits += ` (+${numberFormat.format(stats.additions)} −${numberFormat.format(stats.deletions)} lines)`;
    did.push(commits);
  }
  const prParts = [['merged', stats.merged], ['opened', stats.opened], ['reviewed', stats.reviewed]].filter(([, n]) => n);
  prParts.forEach(([verb, n], i) => did.push(i === 0 ? `${verb} ${plural(n, 'pull request')}` : `${verb} ${n}`));
  const sentences = [`${when} you ${listFormat.format(did)}.`];

  const lead = repos[0];
  if (lead) {
    const branch = lead.branches.length === 1 ? ` on ${lead.branches[0]}` : lead.branches.length > 1 ? ` across ${lead.branches.length} branches` : '';
    const areas = lead.areas.length ? `, mainly in ${listFormat.format(lead.areas.slice(0, 3))}` : '';
    if (repos.length > 1) {
      sentences.push(`Most of it was in ${lead.repo}${branch}${areas}.`);
    } else if (lead.branches.length) {
      const where = lead.branches.length === 1 ? lead.branches[0] : `${lead.branches.length} branches`;
      sentences.push(`It went to ${where}${areas}.`);
    } else if (lead.areas.length) {
      sentences.push(`Mostly in ${listFormat.format(lead.areas.slice(0, 3))}.`);
    }
    if (repos.length > 1) {
      const others = repos.slice(1, 4).map((r) => `${r.repo} (${plural(r.count, 'commit')})`);
      sentences.push(`Also ${listFormat.format(others)}${repos.length > 4 ? ` and ${repos.length - 4} more` : ''}.`);
    }
  }
  if (points.length) sentences.push(`Highlights: ${points.join('; ')}.`);
  return sentences.join(' ');
}

// The day as Markdown, for pasting into a standup or a chat.
export function workMarkdown(record) {
  const date = parseKey(record.id).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const lines = [`**Work summary: ${date}**`, '', record.summary];
  for (const repo of record.repos) {
    const meta = [plural(repo.count, 'commit'), `+${repo.additions} −${repo.deletions}`, ...repo.branches].join(', ');
    lines.push('', `**${repo.repo}** (${meta})`);
    repo.commits.filter((c) => !c.merge).slice(0, 10).forEach((c) => lines.push(`- ${cleanSubject(c.message)}`));
  }
  if (record.prs.length) {
    lines.push('', '**Pull requests**');
    record.prs.forEach((p) => lines.push(`- ${p.action.charAt(0).toUpperCase()}${p.action.slice(1)} #${p.number} ${p.title} (${p.repo.split('/')[1]})`));
  }
  return lines.join('\n');
}
