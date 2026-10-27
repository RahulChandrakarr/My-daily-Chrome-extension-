// Local-first sync with Supabase. Every change is saved to chrome.storage first,
// so the page reacts instantly, then pushed in the background. Changes from
// your other devices are pulled when a tab opens, when it comes back into view
// and every couple of minutes while it's visible. The newest edit wins.
//
// Talks to Supabase's REST and Auth endpoints with fetch, so there's no SDK to
// bundle. Tables and row-level security are in supabase/schema.sql.
import { load, save } from './store.js';

const CONFIG_KEY = 'supabaseConfig'; // { url, key }
const SESSION_KEY = 'supabaseSession'; // { accessToken, refreshToken, expiresAt, user: { id, email } }
const DIRTY_KEY = 'syncDirty'; // { table: { id: markedAt } }
const CURSOR_KEY = 'syncCursor'; // { table: synced_at of the last row pulled }
const PULL_EVERY = 2 * 60 * 1000;

const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
const ms = (value) => (value ? Date.parse(value) : null);

// How each local collection maps to a Supabase table.
const TABLES = {
  tasks: {
    localKey: 'tasks',
    conflict: 'id',
    toRow: (t, userId) => ({
      id: t.id, user_id: userId, title: t.title, notes: t.notes || '', due: t.due, important: Boolean(t.important),
      url: t.url, done: Boolean(t.done), done_at: iso(t.doneAt), created_at: iso(t.createdAt),
      updated_at: iso(t.updatedAt), deleted: Boolean(t.deleted),
    }),
    fromRow: (r) => ({
      id: r.id, title: r.title, notes: r.notes, due: r.due, important: r.important, url: r.url, done: r.done,
      doneAt: ms(r.done_at), createdAt: ms(r.created_at), updatedAt: ms(r.updated_at), deleted: r.deleted,
    }),
  },
  learning_log: {
    localKey: 'learningLog',
    conflict: 'user_id,item_id',
    toRow: (e, userId) => ({
      user_id: userId, item_id: e.id, topic: e.topic, title: e.title, url: e.url, image: e.image, kind: e.kind,
      read_at: iso(e.readAt), done_at: iso(e.doneAt), updated_at: iso(e.updatedAt),
    }),
    fromRow: (r) => ({
      id: r.item_id, topic: r.topic, title: r.title, url: r.url, image: r.image, kind: r.kind,
      readAt: ms(r.read_at), doneAt: ms(r.done_at), updatedAt: ms(r.updated_at),
    }),
  },
  work_log: {
    localKey: 'workLog',
    conflict: 'user_id,day',
    toRow: (d, userId) => ({ user_id: userId, day: d.id, data: d, updated_at: iso(d.updatedAt) }),
    fromRow: (r) => ({ ...r.data, id: r.day, updatedAt: ms(r.updated_at) }),
  },
  preferences: {
    localKey: 'settings',
    single: true,
    conflict: 'user_id',
    toRow: (s, userId) => ({ user_id: userId, data: s, updated_at: iso(s.updatedAt) }),
    fromRow: (r) => ({ ...r.data, updatedAt: ms(r.updated_at) }),
  },
};

let state = { configured: false, signedIn: false, email: null, syncing: false, lastSyncedAt: null, error: null };
let syncing = null;
let pushTimer = null;
let dirtyChain = Promise.resolve();
const listeners = new Set();

export const getSyncState = () => state;
export const onSyncChange = (fn) => listeners.add(fn);

function setState(changes) {
  state = { ...state, ...changes };
  listeners.forEach((fn) => fn(state));
}

export async function initSync() {
  const [config, session, status] = await Promise.all([load(CONFIG_KEY, null), load(SESSION_KEY, null), load('syncStatus', {})]);
  setState({ configured: Boolean(config?.url && config?.key), signedIn: Boolean(session), email: session?.user?.email || null, lastSyncedAt: status.lastSyncedAt || null });
  syncNow();
  // syncNow does nothing while signed out, so these are safe to set up regardless.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - (state.lastSyncedAt || 0) > 20_000) syncNow();
  });
  setInterval(() => { if (!document.hidden) syncNow(); }, PULL_EVERY);
}

export function getConfig() {
  return load(CONFIG_KEY, { url: '', key: '' });
}

export async function saveConfig({ url, key }) {
  const clean = { url: url.trim().replace(/\/+$/, ''), key: key.trim() };
  await save(CONFIG_KEY, clean);
  setState({ configured: Boolean(clean.url && clean.key) });
}

// --- Auth ----------------------------------------------------------------------

export async function signIn(email, password) {
  const data = await api('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password }, auth: false });
  await startSession(data);
}

// Returns true when Supabase wants the email address confirmed first.
export async function signUp(email, password) {
  const data = await api('/auth/v1/signup', { method: 'POST', body: { email, password }, auth: false });
  if (!data?.access_token) return true;
  await startSession(data);
  return false;
}

export async function signOut() {
  const session = await load(SESSION_KEY, null);
  if (session) api('/auth/v1/logout', { method: 'POST' }).catch(() => {});
  await save(SESSION_KEY, null);
  await save(CURSOR_KEY, {});
  setState({ signedIn: false, email: null, error: null });
}

async function startSession(data) {
  await saveSession(data);
  // First sign-in on this device: send everything stored locally, then pull.
  for (const [table, def] of Object.entries(TABLES)) {
    const local = await load(def.localKey, def.single ? null : []);
    const ids = def.single ? (local ? ['me'] : []) : local.map((x) => x.id);
    await addDirty(table, ids);
  }
  await save(CURSOR_KEY, {});
  setState({ signedIn: true, email: data.user?.email || null, error: null });
  await syncNow();
}

async function saveSession(data) {
  const session = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_at ? data.expires_at * 1000 : Date.now() + (data.expires_in || 3600) * 1000,
    user: { id: data.user?.id, email: data.user?.email },
  };
  await save(SESSION_KEY, session);
  return session;
}

async function validSession() {
  const session = await load(SESSION_KEY, null);
  if (!session) return null;
  if (session.expiresAt - 60_000 > Date.now()) return session;
  try {
    const data = await api('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST', body: { refresh_token: session.refreshToken }, auth: false,
    });
    return saveSession({ ...data, user: data.user || session.user });
  } catch (error) {
    if (error.status === 400 || error.status === 401) {
      await save(SESSION_KEY, null);
      setState({ signedIn: false, email: null, error: 'Your Supabase session ended. Sign in again in Settings.' });
      return null;
    }
    throw error;
  }
}

async function api(path, { method = 'GET', body, headers = {}, auth = true } = {}) {
  const config = await getConfig();
  if (!config.url || !config.key) throw new Error('Add your Supabase project URL and key in Settings first.');
  const session = auth ? await validSession() : null;
  if (auth && !session) throw new Error('Not signed in to Supabase.');
  const res = await fetch(`${config.url}${path}`, {
    method,
    headers: {
      apikey: config.key,
      'Content-Type': 'application/json',
      ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    const error = new Error(detail.msg || detail.message || detail.error_description || `Supabase returned ${res.status}`);
    error.status = res.status;
    throw error;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// --- Push and pull -------------------------------------------------------------

// Records that local items changed. They're pushed a moment later, together.
export function markDirty(table, ids) {
  if (!state.signedIn || !ids.length) return Promise.resolve();
  return addDirty(table, ids).then(() => {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => syncNow({ pullToo: false }), 1200);
  });
}

function addDirty(table, ids) {
  dirtyChain = dirtyChain.then(async () => {
    const dirty = await load(DIRTY_KEY, {});
    const now = Date.now();
    dirty[table] = { ...(dirty[table] || {}) };
    ids.forEach((id) => { dirty[table][id] = now; });
    await save(DIRTY_KEY, dirty);
  });
  return dirtyChain;
}

export function syncNow({ pullToo = true } = {}) {
  if (!state.signedIn) return Promise.resolve();
  if (syncing) return syncing;
  setState({ syncing: true });
  syncing = (async () => {
    try {
      await push();
      if (pullToo) await pull();
      const lastSyncedAt = Date.now();
      await save('syncStatus', { lastSyncedAt });
      setState({ lastSyncedAt, error: null });
    } catch (error) {
      setState({ error: navigator.onLine ? error.message : 'Offline. Changes will sync when you reconnect.' });
    } finally {
      syncing = null;
      setState({ syncing: false });
    }
  })();
  return syncing;
}

async function push() {
  const session = await validSession();
  if (!session) return;
  const startedAt = Date.now();
  const dirty = await load(DIRTY_KEY, {});
  for (const [table, marks] of Object.entries(dirty)) {
    const def = TABLES[table];
    const ids = Object.keys(marks || {});
    if (!def || !ids.length) continue;
    const local = await load(def.localKey, def.single ? null : []);
    const records = def.single ? (local ? [local] : []) : local.filter((x) => ids.includes(x.id));
    if (records.length) {
      await api(`/rest/v1/${table}?on_conflict=${def.conflict}`, {
        method: 'POST',
        body: records.map((r) => def.toRow(r, session.user.id)),
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      });
    }
    // Clear only what was marked before this push; edits made meanwhile go next time.
    dirtyChain = dirtyChain.then(async () => {
      const latest = await load(DIRTY_KEY, {});
      for (const id of ids) if (latest[table]?.[id] <= startedAt) delete latest[table][id];
      await save(DIRTY_KEY, latest);
    });
    await dirtyChain;
  }
}

async function pull() {
  const cursors = await load(CURSOR_KEY, {});
  for (const [table, def] of Object.entries(TABLES)) {
    const since = cursors[table] ? `&synced_at=gt.${encodeURIComponent(cursors[table])}` : '';
    const rows = await api(`/rest/v1/${table}?select=*${since}&order=synced_at.asc&limit=1000`);
    if (!rows?.length) continue;
    const remote = rows.map(def.fromRow);
    if (def.single) {
      const local = await load(def.localKey, {});
      const newest = remote[remote.length - 1];
      if ((newest.updatedAt || 0) > (local.updatedAt || 0)) await save(def.localKey, newest);
    } else {
      const local = await load(def.localKey, []);
      const byId = new Map(local.map((x) => [x.id, x]));
      let changed = false;
      for (const item of remote) {
        const mine = byId.get(item.id);
        if (!mine || (item.updatedAt || 0) > (mine.updatedAt || 0)) {
          byId.set(item.id, item);
          changed = true;
        }
      }
      if (changed) await save(def.localKey, [...byId.values()]);
    }
    cursors[table] = rows[rows.length - 1].synced_at;
  }
  await save(CURSOR_KEY, cursors);
}
