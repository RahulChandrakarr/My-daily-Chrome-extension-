// Keeps your GitHub streak going on days you don't push. From the time set in
// Settings (22:00 unless you change it), it asks GitHub how many contributions
// you have today. If there are none, it commits the day's log to a repo of
// yours, so today's square on your profile turns green.
//
// The commit is a real record, not filler: a Markdown file with the to-dos you
// finished and what you read or tried in Learning, and a commit message that
// says what's in it. It only ever writes to the one repo named in Settings, and
// that repo has to be yours (not an organisation's), so client and work repos
// are never touched. In a public repo the log leaves out your to-do titles.
//
// Chrome has to be running. The background checks every few minutes, so if
// Chrome was closed at the set time, the check runs once it's open again, until
// midnight. "Today" is this computer's day; for any evening time in India that
// is also the day GitHub puts the commit on.
//
// No page code here: the background service worker runs it, and Settings uses
// it to set up the repo and for "Check now".
import { load, save } from './store.js';
import { dateKey } from './dates.js';
import { githubGet, githubSend, contributionDays, GitHubError } from './github.js';
import { plural } from './ui.js';

export const STREAK_STATE_KEY = 'streakState';
export const STREAK_DEFAULT_TIME = '22:00';
const DEFAULT_REPO_NAME = 'daily-log';
const NAME = /^[\w.-]+$/;

let running = null;

// "daily-log", "you/daily-log" or a github.com link, as "owner/name".
// Null when it isn't a repo name.
export function parseRepo(input, login) {
  const clean = String(input || '').trim()
    .replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');
  if (!clean) return `${login}/${DEFAULT_REPO_NAME}`;
  const parts = clean.split('/');
  const [owner, name] = parts.length === 1 ? [login, parts[0]] : parts;
  if (parts.length > 2 || !NAME.test(owner) || !NAME.test(name)) return null;
  return `${owner}/${name}`;
}

// Finds the log repo, or creates it as a private repo. It has to be yours:
// the log never goes to an organisation's repo.
export async function setupStreakRepo({ token, login }, fullName) {
  const [owner, name] = fullName.split('/');
  const notYours = () => new GitHubError(`The log only goes to a repo of your own, like ${login}/${DEFAULT_REPO_NAME}. ${fullName} isn't yours.`);
  if (owner.toLowerCase() !== login.toLowerCase()) throw notYours();
  let repo;
  let created = false;
  try {
    repo = await githubGet(token, `/repos/${owner}/${name}`);
  } catch (error) {
    if (error.status !== 404) throw error;
    repo = await githubSend(token, 'POST', '/user/repos', {
      name,
      private: true,
      auto_init: true,
      description: 'A log of my day, one Markdown file per day, written by My Daily.',
    }).catch((e) => {
      if (e.status === 401) throw e;
      throw new GitHubError(`Couldn't create ${fullName} (GitHub returned ${e.status}). Your token needs the repo scope, or create the repo on GitHub yourself.`, e.status);
    });
    created = true;
  }
  if (repo.owner?.type !== 'User' || repo.owner.login.toLowerCase() !== login.toLowerCase()) throw notYours();
  if (repo.fork) throw new GitHubError(`${repo.full_name} is a fork, and commits to a fork don't count on your graph. Pick another repo.`);
  if (repo.archived) throw new GitHubError(`${repo.full_name} is archived, so nothing can be committed to it. Pick another repo.`);
  return {
    fullName: repo.full_name,
    private: repo.private,
    defaultBranch: repo.default_branch,
    url: repo.html_url,
    created,
  };
}

// One check at a time. Without `force` it waits for the set time and stops
// once today is settled; "Check now" passes force. Either way it commits only
// when GitHub shows no contribution today.
export function keepStreak(options) {
  running ||= check(options).finally(() => { running = null; });
  return running;
}

async function check({ force = false } = {}) {
  const [settings, auth, state] = await Promise.all([
    load('settings', {}),
    load('githubAuth', null),
    load(STREAK_STATE_KEY, null),
  ]);
  if (!settings.streakKeep || !auth?.token) return { status: 'off' };
  const today = dateKey();
  const settled = state?.date === today && state.status !== 'error';
  if (!force && (settled || minutesNow() < minutesOf(settings.streakTime || STREAK_DEFAULT_TIME))) {
    return settled ? state : { status: 'waiting' };
  }
  // Already committed today: GitHub's graph can lag behind, so don't commit again.
  if (state?.date === today && state.status === 'committed') return state;

  let result;
  try {
    result = await run(settings, auth, today);
  } catch (error) {
    result = { status: 'error', error: error.message };
  }
  const next = { ...result, date: today, at: Date.now() };
  await save(STREAK_STATE_KEY, next);
  return next;
}

async function run(settings, auth, today) {
  const days = await contributionDays(auth.token, auth.login);
  const count = days.find((d) => d.date === today)?.count || 0;
  if (count > 0) return { status: 'contributed', count };

  const fullName = parseRepo(settings.streakRepo, auth.login);
  if (!fullName) throw new GitHubError('The repo name in Settings isn\'t valid. Use a name like daily-log.');
  const repo = await setupStreakRepo(auth, fullName);
  const log = await dayLog(today, { withTaskTitles: repo.private });
  const path = `${today.slice(0, 4)}/${today}.md`;
  const put = () => githubSend(auth.token, 'PUT', `/repos/${repo.fullName}/contents/${path}`, {
    message: log.message,
    content: base64(log.text),
  });
  try {
    // A repo created a moment ago can take a second to accept commits.
    const res = await put().catch(async (error) => {
      if (!repo.created || ![404, 409].includes(error.status)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return put();
    });
    return { status: 'committed', repo: repo.fullName, url: res.commit?.html_url || repo.url, message: log.subject };
  } catch (error) {
    // 422: today's file is already there, so a commit already went in today.
    if (error.status !== 422) throw error;
    return { status: 'committed', repo: repo.fullName, url: `${repo.url}/blob/${repo.defaultBranch}/${path}`, message: 'Today\'s log was already in the repo' };
  }
}

// --- The day's log -------------------------------------------------------------------

// The Markdown file and the commit message, both from what you did today.
async function dayLog(today, { withTaskTitles }) {
  const [tasks, learning] = await Promise.all([load('tasks', []), load('learningLog', [])]);
  const onToday = (ms) => Boolean(ms) && dateKey(new Date(ms)) === today;
  const done = tasks.filter((t) => t.done && onToday(t.doneAt)).sort((a, b) => a.doneAt - b.doneAt);
  const open = tasks.filter((t) => !t.done && !t.deleted);
  const overdue = open.filter((t) => t.due && t.due < today).length;
  const tried = learning.filter((e) => onToday(e.doneAt));
  const read = learning.filter((e) => onToday(e.readAt) && !onToday(e.doneAt));

  const date = new Date();
  const long = date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const short = date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  const lines = [`# ${long}`, ''];
  if (done.length) {
    lines.push('## Done', '');
    if (withTaskTitles) lines.push(...done.map((t) => `- ${oneLine(t.title)}`));
    else lines.push(`${plural(done.length, 'to-do')} finished. Titles are left out because this repo is public.`);
    lines.push('');
  }
  if (tried.length || read.length) {
    lines.push('## Learning', '');
    lines.push(...tried.map((e) => `- Tried: ${link(e)}`));
    lines.push(...read.map((e) => `- ${e.kind === 'video' ? 'Watched' : 'Read'}: ${link(e)}`));
    lines.push('');
  }
  if (!done.length && !tried.length && !read.length) {
    lines.push('Nothing was ticked off or logged in My Daily today.', '');
  }
  if (open.length) {
    lines.push('## Still open', '', `${plural(open.length, 'to-do')}${overdue ? `, ${overdue} overdue` : ''}.`, '');
  }
  lines.push('---', '', `Committed by My Daily at ${time}, because there was no other contribution on GitHub today.`, '');

  const counts = [
    done.length && `${plural(done.length, 'to-do')} done`,
    read.length && `${read.length} read`,
    tried.length && `${tried.length} tried`,
  ].filter(Boolean);
  const subject = `Daily log for ${short}${counts.length ? `: ${counts.join(', ')}` : ''}`;
  const message = `${subject}\n\nNo other contribution on GitHub today, so My Daily committed the day's log.`;
  return { text: lines.join('\n'), subject, message };
}

function oneLine(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function link(entry) {
  const title = oneLine(entry.title || entry.url).replace(/([[\]])/g, '\\$1');
  return /^https?:\/\//i.test(entry.url || '') ? `[${title}](${entry.url})` : title;
}

// --- Helpers -------------------------------------------------------------------------

function minutesOf(time) {
  const [hour, minute] = String(time).split(':').map(Number);
  return (hour || 0) * 60 + (minute || 0);
}

function minutesNow() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

// The Contents API takes base64; btoa alone breaks on anything outside Latin-1.
function base64(text) {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}
