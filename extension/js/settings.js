// The Settings dialog: your name, theme, news sources, learning topics,
// backups, and the Supabase and GitHub connections.
import { load, save } from './store.js';
import { verifyToken } from './github.js';
import { ALL_SOURCES } from './sources.js';
import { allTopics, customTopic } from './topics.js';
import { getConfig, saveConfig, signIn, signUp, signOut, syncNow, getSyncState, onSyncChange } from './sync.js';
import { visibleTasks, replaceTasks, normalizeImported } from './tasks.js';
import { exportLearningLog, importLearningLog } from './learning.js';
import { dateKey, timeAgo } from './dates.js';
import { el, icon, toast, plural } from './ui.js';

const $ = (id) => document.getElementById(id);
let getSettings;
let updateSettings;

export function initSettings(hooks) {
  ({ getSettings, updateSettings } = hooks);
  const dialog = $('settings');

  $('open-settings').addEventListener('click', () => openSettings());
  $('close-settings').addEventListener('click', () => dialog.close());
  // A click on the dialog element itself is a click on the backdrop.
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });

  $('setting-name').addEventListener('input', (e) => updateSettings({ name: e.target.value.trim() }));
  document.querySelectorAll('input[name="theme"]').forEach((radio) => {
    radio.addEventListener('change', () => updateSettings({ theme: radio.value }));
  });

  $('topic-add').addEventListener('submit', (event) => {
    event.preventDefault();
    const name = $('topic-add-name').value.trim();
    if (!name) return;
    const topic = customTopic(name, $('topic-add-kind').value);
    const settings = getSettings();
    if (allTopics(settings).some((t) => t.id === topic.id)) {
      toast(`${name} is already in your topics`);
      return;
    }
    updateSettings({ customTopics: [...(settings.customTopics || []), topic] });
    $('topic-add-name').value = '';
    renderTopicSettings();
  });

  $('export-data').addEventListener('click', exportData);
  $('import-data').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', importData);

  $('supabase-config').addEventListener('submit', async (event) => {
    event.preventDefault();
    await saveConfig({ url: $('supabase-url').value, key: $('supabase-key').value });
    toast('Supabase project saved');
    renderSyncState();
  });
  $('supabase-auth').addEventListener('submit', (event) => {
    event.preventDefault();
    authenticate(event.submitter?.value === 'signup' ? 'signup' : 'signin');
  });
  $('github-connect').addEventListener('submit', connectGitHub);
  $('github-disconnect').addEventListener('click', async () => {
    await save('githubAuth', null);
    renderGitHubState();
    toast('Disconnected from GitHub. Your saved summaries stay.');
  });
  $('work-summary-time').addEventListener('change', (e) => updateSettings({ workSummaryTime: e.target.value || '18:00' }));
  $('work-notify').addEventListener('change', (e) => updateSettings({ workNotify: e.target.checked }));
  $('auto-done').addEventListener('change', (e) => updateSettings({ autoDone: e.target.checked }));

  $('sync-now').addEventListener('click', () => syncNow());
  $('sign-out').addEventListener('click', async () => {
    await signOut();
    toast('Signed out. Your data stays on this computer.');
  });
  onSyncChange(renderSyncState);
}

// Opens Settings, optionally scrolled to one section.
export async function openSettings(sectionId = null) {
  await fill();
  $('settings').showModal();
  if (sectionId) {
    $(sectionId).scrollIntoView({ block: 'start' });
    $(sectionId).querySelector('input:not([type="hidden"])')?.focus();
  }
}

async function fill() {
  const settings = getSettings();
  $('setting-name').value = settings.name || '';
  $('work-summary-time').value = settings.workSummaryTime || '18:00';
  $('work-notify').checked = settings.workNotify !== false;
  $('auto-done').checked = settings.autoDone !== false;
  await renderGitHubState();
  document.querySelectorAll('input[name="theme"]').forEach((radio) => { radio.checked = radio.value === settings.theme; });
  renderSourceSettings();
  renderTopicSettings();
  const config = await getConfig();
  $('supabase-url').value = config.url || '';
  $('supabase-key').value = config.key || '';
  renderSyncState();
}

function renderSourceSettings() {
  const disabled = new Set(getSettings().disabledSources || []);
  $('setting-sources').replaceChildren(...ALL_SOURCES.map((source) => {
    const label = el('label', 'check-row');
    const input = el('input', '', { type: 'checkbox' });
    input.checked = !disabled.has(source.id);
    input.addEventListener('change', () => {
      const next = new Set(getSettings().disabledSources || []);
      if (input.checked) next.delete(source.id);
      else next.add(source.id);
      updateSettings({ disabledSources: [...next] });
    });
    label.append(input, el('span', '', { text: source.name }));
    return label;
  }));
}

function renderTopicSettings() {
  const settings = getSettings();
  const disabled = new Set(settings.disabledTopics || []);
  const topics = allTopics(settings);
  const groups = [
    ['Interests: each gets its own tab in Learning', topics.filter((t) => t.kind === 'interest')],
    ['Study topics: these take turns in Learn today', topics.filter((t) => t.kind !== 'interest')],
  ];
  $('setting-topics').replaceChildren(...groups.map(([title, list]) => {
    const group = el('div', 'setting-topic-group');
    group.append(el('p', 'setting-help', { text: title }));
    const grid = el('div', 'check-grid');
    grid.append(...list.map((topic) => {
      const row = el('div', 'check-row');
      const label = el('label');
      const input = el('input', '', { type: 'checkbox' });
      input.checked = !disabled.has(topic.id);
      input.addEventListener('change', () => {
        const next = new Set(getSettings().disabledTopics || []);
        if (input.checked) next.delete(topic.id);
        else next.add(topic.id);
        updateSettings({ disabledTopics: [...next] });
      });
      label.append(input, el('span', '', { text: topic.name }));
      row.append(label);
      if (topic.custom) {
        const remove = el('button', 'icon-btn icon-btn--small', { type: 'button', 'aria-label': `Remove ${topic.name}` });
        remove.append(icon('close', 14));
        remove.addEventListener('click', () => {
          updateSettings({ customTopics: (getSettings().customTopics || []).filter((t) => t.id !== topic.id) });
          renderTopicSettings();
        });
        row.append(remove);
      }
      return row;
    }));
    group.append(grid);
    return group;
  }));
}

// --- Backup ------------------------------------------------------------------------

async function exportData() {
  const payload = {
    app: 'my-daily',
    version: 1,
    exportedAt: new Date().toISOString(),
    tasks: visibleTasks(),
    learningLog: await exportLearningLog(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const link = el('a', '', { href: URL.createObjectURL(blob), download: `my-daily-backup-${dateKey()}.json` });
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function importData(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const tasks = normalizeImported(Array.isArray(parsed) ? parsed : parsed.tasks || []);
    const log = Array.isArray(parsed.learningLog) ? parsed.learningLog : [];
    if (!tasks.length && !log.length) throw new Error('empty');
    const current = visibleTasks().length;
    if (tasks.length && !confirm(`Replace your ${plural(current, 'task')} with the ${plural(tasks.length, 'task')} in this file?`)) return;
    if (tasks.length) replaceTasks(tasks);
    if (log.length) importLearningLog(log);
    toast(`Imported ${plural(tasks.length, 'task')} and ${plural(log.length, 'learning log entry', 'learning log entries')}`);
  } catch {
    toast('That file isn\'t a My Daily backup. Choose a file made with Export.');
  }
}

// --- GitHub -------------------------------------------------------------------------

async function connectGitHub(event) {
  event.preventDefault();
  const token = $('github-token').value.trim();
  if (!token) return;
  const button = $('github-connect').querySelector('button');
  button.disabled = true;
  try {
    const user = await verifyToken(token);
    await save('githubAuth', { token, login: user.login, name: user.name, connectedAt: Date.now() });
    $('github-token').value = '';
    toast(`Connected to GitHub as @${user.login}. Your work shows in the Work tab.`);
  } catch (error) {
    toast(error.status === 401 ? 'GitHub didn\'t accept that token. Check it, then try again.' : error.message);
  } finally {
    button.disabled = false;
    renderGitHubState();
  }
}

async function renderGitHubState() {
  const auth = await load('githubAuth', null);
  $('github-status').textContent = auth?.token
    ? `Connected as @${auth.login}.`
    : 'Not connected. Connect to track the commits and pull requests you push each day.';
  $('github-connect').hidden = Boolean(auth?.token);
  $('github-connected').hidden = !auth?.token;
}

// --- Supabase -----------------------------------------------------------------------

async function authenticate(mode) {
  const email = $('supabase-email').value.trim();
  const password = $('supabase-password').value;
  if (!email || !password) return;
  $('supabase-auth').querySelectorAll('button').forEach((b) => { b.disabled = true; });
  try {
    if (mode === 'signup') {
      const needsConfirmation = await signUp(email, password);
      toast(needsConfirmation ? 'Account created. Confirm the email Supabase sent you, then sign in.' : 'Account created and signed in');
    } else {
      await signIn(email, password);
      toast('Signed in. Syncing your data…');
    }
    $('supabase-password').value = '';
  } catch (error) {
    toast(error.message);
  } finally {
    $('supabase-auth').querySelectorAll('button').forEach((b) => { b.disabled = false; });
    renderSyncState();
  }
}

function renderSyncState() {
  const state = getSyncState();
  $('supabase-auth').hidden = !state.configured || state.signedIn;
  $('sync-signed-in').hidden = !state.signedIn;
  let status;
  if (!state.configured) status = 'Not set up. Your data is saved on this computer only.';
  else if (!state.signedIn) status = 'Project saved. Sign in to start syncing.';
  else if (state.syncing) status = `Signed in as ${state.email}. Syncing…`;
  else status = `Signed in as ${state.email}.${state.lastSyncedAt ? ` Last synced ${timeAgo(state.lastSyncedAt)}.` : ''}`;
  $('sync-status').textContent = status;
  $('sync-error').textContent = state.error || '';
  $('sync-error').hidden = !state.error;
  $('sync-badge').dataset.state = !state.signedIn ? 'off' : state.error ? 'error' : 'on';
  $('sync-badge').title = !state.signedIn ? 'Supabase sync is off' : state.error || 'Synced with Supabase';
}
