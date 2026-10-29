// The to-do list. Tasks live in chrome.storage.local (key "tasks") and sync to
// Supabase when it's set up. Deleted tasks stay as tombstones for a while so
// the deletion can reach your other devices.
//
// With GitHub connected, a task is marked done when you push a commit that
// matches it, and the Done section shows what you pushed each day.
import { load, save, watch, stableJson } from './store.js';
import { markDirty } from './sync.js';
import { dayLabel } from './github.js';
import { splitTasks } from './tasksplit.js';
import { dateKey, addDays, formatDue } from './dates.js';
import { el, icon, safeUrl, toast, plural } from './ui.js';

const KEY = 'tasks';
const TOMBSTONE_DAYS = 30;
const $ = (id) => document.getElementById(id);

let tasks = [];
const ownWrites = []; // saves from this tab that storage hasn't echoed back yet
let openId = null; // task whose editor is expanded
let openSnapshot = null; // that task before editing, so Cancel can put it back
let showDone = false;
let draftDue = 'today'; // '', 'today', 'tomorrow' or a YYYY-MM-DD date
let draftImportant = false;
let autoDone = true; // mark tasks done from matching commits
let entering = new Set(); // tasks just added, which animate in
let proposals = null; // tasks found by Analyse, waiting to be added
let proposalInfo = { method: 'rules', note: null };
let workDays = []; // the Work tab's saved days, for the Done section
const listeners = new Set();
const listFormat = new Intl.ListFormat(undefined, { style: 'long', type: 'conjunction' });

export async function initTasks() {
  const cutoff = Date.now() - TOMBSTONE_DAYS * 24 * 60 * 60 * 1000;
  tasks = (await load(KEY, [])).filter((t) => !t.deleted || t.updatedAt > cutoff);
  workDays = await load('workLog', []);
  showDone = await load('showDone', false);
  watch('workLog', (value) => {
    workDays = value || [];
    if (showDone) renderTasks();
  });
  bindForm();
  // Another tab, or a pull from Supabase, changed the list. Echoes of this
  // tab's own saves arrive in order and are skipped.
  watch(KEY, (value) => {
    const own = ownWrites.indexOf(stableJson(value ?? []));
    if (own !== -1) {
      ownWrites.splice(0, own + 1);
      return;
    }
    tasks = value ?? [];
    renderTasks();
    listeners.forEach((fn) => fn(visibleTasks()));
  });
  renderTasks();
}

export const visibleTasks = () => tasks.filter((t) => !t.deleted);
export const onTasksChange = (fn) => listeners.add(fn);

export function setTaskOptions({ autoDone: enabled }) {
  autoDone = enabled !== false;
}

// --- Done from commits ----------------------------------------------------------------

// Words that say little about which task a commit is for.
const STOP_WORDS = new Set(('the a an to and or for of in on with into from by is it this that my our we be up at as use using via '
  + 'add added adds fix fixed fixes update updated updates make made change changed changes new page task work wip '
  + 'feat chore refactor docs test style').split(' '));

function keywords(text) {
  return new Set(text.toLowerCase()
    .replace(/^\w+(\([^)]*\))?!?:\s*/, '') // "feat(scope): "
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
    .map((w) => w.replace(/(ing|ed|es|e|s)$/, ''))
    .filter((w) => w.length > 2));
}

// A commit matches a task when it shares at least two of the task's keywords,
// covering 60% or more of them. Tasks with fewer than two keywords never match.
export function commitMatches(taskTitle, message) {
  const want = keywords(taskTitle);
  if (want.size < 2) return false;
  const have = keywords(message);
  const hits = [...want].filter((w) => have.has(w)).length;
  return hits >= 2 && hits / want.size >= 0.6;
}

// Marks open tasks done when a commit made after them matches.
export function completeFromCommits(records) {
  if (!autoDone) return;
  const commits = records.flatMap((r) => (r.repos || []).flatMap((repo) => repo.commits
    .filter((c) => !c.merge)
    .map((c) => ({ ...c, repo: repo.repo }))));
  const completed = [];
  for (const task of tasks) {
    if (task.done || task.deleted) continue;
    const match = commits.find((c) => c.at > task.createdAt
      && !(task.ignoreShas || []).includes(c.sha)
      && commitMatches(task.title, c.message));
    if (!match) continue;
    Object.assign(task, {
      done: true,
      doneAt: match.at,
      doneBy: { sha: match.sha, repo: match.repo, url: match.url, message: match.message },
      updatedAt: Date.now(),
    });
    completed.push(task);
  }
  if (!completed.length) return;
  commit(completed.map((t) => t.id));
  const message = completed.length === 1
    ? `Marked "${completed[0].title}" done. It matches your commit in ${completed[0].doneBy.repo}.`
    : `Marked ${completed.length} tasks done from your commits.`;
  toast(message, {
    label: 'Undo',
    run: () => {
      const now = Date.now();
      completed.forEach((t) => Object.assign(t, {
        done: false, doneAt: null, doneBy: null, ignoreShas: [...(t.ignoreShas || []), t.doneBy?.sha].filter(Boolean), updatedAt: now,
      }));
      commit(completed.map((t) => t.id));
    },
  });
}

export function addTask(fields) {
  return addTasks([fields])[0];
}

// Adds several tasks at once, keeping their order.
export function addTasks(list) {
  const now = Date.now();
  const created = list.map(({ title, due = null, important = false, url = null, notes = '' }, i) => ({
    id: crypto.randomUUID(),
    title: title.trim(),
    notes,
    due,
    important,
    url: safeUrl(url),
    done: false,
    doneAt: null,
    createdAt: now + i, // tasks sort oldest first, so the first one stays first
    updatedAt: now,
    deleted: false,
  }));
  tasks.unshift(...created);
  entering = new Set(created.map((t) => t.id));
  commit(created.map((t) => t.id));
  entering = new Set();
  return created;
}

export function hasOpenTaskFor(url) {
  return tasks.some((t) => t.url === url && !t.done && !t.deleted);
}

// Replaces every task, e.g. from an imported backup.
export function replaceTasks(list) {
  const now = Date.now();
  const incoming = new Set(list.map((t) => t.id));
  const removed = tasks.filter((t) => !incoming.has(t.id)).map((t) => ({ ...t, deleted: true, updatedAt: now }));
  tasks = [...list.map((t) => ({ ...t, updatedAt: now })), ...removed];
  commit(tasks.map((t) => t.id));
}

// A "+ To-do" button for story cards. `compact` shows just the icon.
export function addToTodoButton(item, { compact = false } = {}) {
  const button = el('button', compact ? 'card-action card-action--icon' : 'card-action', { type: 'button', title: 'Add to your to-do list' });
  const label = (text) => (compact ? [] : [el('span', '', { text })]);
  const setAdded = () => {
    button.replaceChildren(icon('check', 16), ...label('In to-do'));
    button.title = 'In your to-do list';
    button.disabled = true;
  };
  if (hasOpenTaskFor(item.url)) setAdded();
  else button.append(icon('plus', 16), ...label('To-do'));
  button.setAttribute('aria-label', `Add "${item.title}" to your to-do list`);
  button.addEventListener('click', () => {
    addTask({ title: item.title, url: item.url });
    setAdded();
  });
  return button;
}

function update(id, changes, { rerender = true } = {}) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  Object.assign(task, changes, { updatedAt: Date.now() });
  commit([id], { rerender });
}

function commit(changedIds, { rerender = true } = {}) {
  ownWrites.push(stableJson(tasks));
  if (ownWrites.length > 50) ownWrites.shift();
  save(KEY, tasks);
  markDirty('tasks', changedIds);
  if (rerender) renderTasks();
  listeners.forEach((fn) => fn(visibleTasks()));
}

function removeTask(id) {
  update(id, { deleted: true });
  if (openId === id) openId = null;
  toast('Task deleted', { label: 'Undo', run: () => update(id, { deleted: false }) });
}

function clearDone() {
  const done = visibleTasks().filter((t) => t.done).map((t) => t.id);
  const now = Date.now();
  tasks.forEach((t) => { if (done.includes(t.id)) Object.assign(t, { deleted: true, updatedAt: now }); });
  commit(done);
  toast(`Cleared ${plural(done.length, 'task')}`, {
    label: 'Undo',
    run: () => {
      const later = Date.now();
      tasks.forEach((t) => { if (done.includes(t.id)) Object.assign(t, { deleted: false, updatedAt: later }); });
      commit(done);
    },
  });
}

// --- Rendering ---------------------------------------------------------------

function sortTasks(a, b) {
  return (b.important - a.important) || (a.due || '9999').localeCompare(b.due || '9999') || a.createdAt - b.createdAt;
}

export function renderTasks() {
  const root = $('task-groups');
  const today = dateKey();
  const open = visibleTasks().filter((t) => !t.done).sort(sortTasks);
  const done = visibleTasks().filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const groups = [
    { id: 'overdue', label: 'Overdue', items: open.filter((t) => t.due && t.due < today) },
    { id: 'today', label: 'Today', items: open.filter((t) => t.due === today) },
    { id: 'upcoming', label: 'Upcoming', items: open.filter((t) => t.due && t.due > today) },
    { id: 'anytime', label: 'Anytime', items: open.filter((t) => !t.due) },
  ].filter((g) => g.items.length);

  const sections = groups.map((g) => renderGroup(g, today));
  if (!open.length) {
    sections.push(el('p', 'tasks-empty', {
      text: done.length ? 'All done. Add the next thing above.' : 'Nothing on your list yet. Add your first task above.',
    }));
  }
  if (done.length || workDays.some((r) => r.stats?.commits)) sections.push(renderDone(done, today));
  root.replaceChildren(...sections);
}

function renderGroup(group, today) {
  const section = el('section', `task-group task-group--${group.id}`);
  const heading = el('h3', 'task-group-title');
  heading.append(el('span', '', { text: group.label }), el('span', 'task-group-count', { text: group.items.length }));
  const list = el('ul', 'task-list');
  list.append(...group.items.map((t) => renderTask(t, today)));
  section.append(heading, list);
  return section;
}

function renderDone(done, today) {
  const section = el('section', 'task-group task-group--done');
  const head = el('div', 'task-done-head');
  const toggle = el('button', 'task-done-toggle', { type: 'button', 'aria-expanded': String(showDone) });
  toggle.append(el('span', '', { text: 'Done' }), el('span', 'task-group-count', { text: done.length }));
  toggle.addEventListener('click', () => {
    showDone = !showDone;
    save('showDone', showDone);
    renderTasks();
  });
  head.append(toggle);
  if (done.length) {
    const clear = el('button', 'link-button', { type: 'button', text: 'Clear done' });
    clear.addEventListener('click', clearDone);
    head.append(clear);
  }
  section.append(head);
  if (!showDone) return section;

  // One block per day: what you pushed to GitHub, then the tasks you finished.
  const days = new Map();
  for (const t of done) {
    const day = t.doneAt ? dateKey(new Date(t.doneAt)) : '';
    if (!days.has(day)) days.set(day, []);
    days.get(day).push(t);
  }
  for (const r of workDays.slice(0, 7)) if (r.stats?.commits && !days.has(r.id)) days.set(r.id, []);
  for (const [day, list] of [...days].sort((a, b) => b[0].localeCompare(a[0]))) {
    const block = el('div', 'task-day');
    block.append(el('h4', 'task-day-name', { text: day ? dayLabel(day) : 'Earlier' }));
    const work = workDays.find((r) => r.id === day);
    if (work?.repos?.length) {
      const highlights = work.highlights?.length ? `: ${work.highlights.join('; ')}` : '';
      block.append(el('p', 'task-day-work', { text: `Pushed to ${listFormat.format(work.repos.map((r) => r.repo))}${highlights}.` }));
    }
    if (list.length) {
      const ul = el('ul', 'task-list');
      ul.append(...list.map((t) => renderTask(t, today)));
      block.append(ul);
    }
    section.append(block);
  }
  return section;
}

function renderTask(task, today) {
  const isOpen = openId === task.id;
  const li = el('li', 'task');
  li.classList.toggle('is-done', task.done);
  li.classList.toggle('is-important', task.important);
  li.classList.toggle('is-open', isOpen);
  li.classList.toggle('is-entering', entering.has(task.id));

  const check = el('input', 'task-check', { type: 'checkbox', 'aria-label': `Done: ${task.title}` });
  check.checked = task.done;
  check.addEventListener('change', () => {
    li.classList.toggle('is-done', check.checked);
    const changes = { done: check.checked, doneAt: check.checked ? Date.now() : null };
    // Unticking a task a commit completed: don't match that commit to it again.
    if (!check.checked && task.doneBy) {
      Object.assign(changes, { doneBy: null, ignoreShas: [...(task.ignoreShas || []), task.doneBy.sha] });
    }
    // A short pause lets the strike-through show before the task moves to Done.
    setTimeout(() => update(task.id, changes), 320);
  });

  const toggleEditor = () => {
    if (isOpen) {
      closeEditor();
    } else {
      openId = task.id;
      openSnapshot = { title: task.title, notes: task.notes, due: task.due };
      renderTasks();
      document.querySelector('.task-editor .field')?.focus();
    }
  };

  const main = el('div', 'task-main');
  const title = el('button', 'task-title', { type: 'button', 'aria-expanded': String(isOpen), text: task.title });
  title.addEventListener('click', toggleEditor);
  main.append(title);

  const sub = el('div', 'task-sub');
  if (task.due) {
    const state = task.done ? 'later' : task.due < today ? 'late' : task.due === today ? 'today' : 'later';
    sub.append(el('span', `due due--${state}`, { text: formatDue(task.due, today) }));
  }
  if (task.doneBy) {
    const pushed = el('a', 'task-link task-commit', { href: task.doneBy.url, title: `Done by your commit: ${task.doneBy.message}` });
    pushed.append(icon('check', 13), el('span', '', { text: `Pushed in ${task.doneBy.repo}` }));
    sub.append(pushed);
  }
  if (task.url) {
    const link = el('a', 'task-link', { href: task.url, title: task.url });
    link.append(icon('link', 13), el('span', '', { text: new URL(task.url).hostname.replace(/^www\./, '') }));
    sub.append(link);
  }
  if (task.notes) {
    const notes = el('span', 'task-has-notes', { title: 'Has notes' });
    notes.append(icon('notes', 13));
    sub.append(notes);
  }
  if (sub.childElementCount) main.append(sub);

  const actions = el('div', 'task-actions');
  const star = el('button', 'task-star', {
    type: 'button',
    'aria-pressed': String(task.important),
    'aria-label': task.important ? 'Unmark as important' : 'Mark as important',
    title: task.important ? 'Unmark as important' : 'Mark as important',
  });
  star.append(icon('star', 17));
  star.addEventListener('click', () => update(task.id, { important: !task.important }));
  const edit = el('button', 'task-btn', {
    type: 'button', 'aria-expanded': String(isOpen), 'aria-label': `Edit "${task.title}"`, title: 'Edit',
  });
  edit.append(icon('edit', 17));
  edit.addEventListener('click', toggleEditor);
  const remove = el('button', 'task-btn task-btn--delete', { type: 'button', 'aria-label': `Delete "${task.title}"`, title: 'Delete' });
  remove.append(icon('trash', 17));
  remove.addEventListener('click', () => removeTask(task.id));
  actions.append(star, edit, remove);

  li.append(check, main, actions);
  if (isOpen) li.append(renderEditor(task, li));
  return li;
}

function closeEditor() {
  openId = null;
  openSnapshot = null;
  renderTasks();
}

function renderEditor(task, li) {
  const box = el('div', 'task-editor');
  const close = closeEditor;
  const cancel = () => {
    if (openSnapshot) update(task.id, openSnapshot, { rerender: false });
    closeEditor();
  };

  const titleInput = el('input', 'field', { type: 'text', 'aria-label': 'Task' });
  titleInput.value = task.title;
  titleInput.addEventListener('input', () => {
    const value = titleInput.value.trim();
    if (!value) return;
    li.querySelector('.task-title').textContent = value;
    update(task.id, { title: value }, { rerender: false });
  });

  const notes = el('textarea', 'field', { rows: 3, placeholder: 'Notes', 'aria-label': 'Notes' });
  notes.value = task.notes || '';
  notes.addEventListener('input', () => update(task.id, { notes: notes.value }, { rerender: false }));

  const row = el('div', 'task-editor-row');
  const due = el('input', 'field field--date', { type: 'date', 'aria-label': 'Due date' });
  due.value = task.due || '';
  due.addEventListener('change', () => update(task.id, { due: due.value || null }));
  const clearDue = el('button', 'link-button', { type: 'button', text: 'No date' });
  clearDue.addEventListener('click', () => update(task.id, { due: null }));
  const cancelButton = el('button', 'btn btn--ghost btn--small', { type: 'button', text: 'Cancel' });
  cancelButton.addEventListener('click', cancel);
  const saveButton = el('button', 'btn btn--primary btn--small', { type: 'button', text: 'Save' });
  saveButton.addEventListener('click', close);
  const buttons = el('div', 'task-editor-buttons');
  buttons.append(cancelButton, saveButton);
  row.append(due);
  if (task.due) row.append(clearDue);
  row.append(buttons);

  // Changes are saved as you type; Save closes the editor, Cancel undoes them.
  box.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    } else if (event.key === 'Enter' && event.target === titleInput) {
      event.preventDefault();
      close();
    }
  });
  box.append(titleInput, notes, row);
  return box;
}

// --- New-task form -------------------------------------------------------------

function bindForm() {
  const form = $('task-form');
  const input = $('task-input');
  const date = $('task-date');
  const star = $('task-important');

  const syncPicker = () => {
    form.querySelectorAll('[data-due]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.due === draftDue)));
    date.classList.toggle('is-set', /^\d{4}-/.test(draftDue));
  };
  form.querySelectorAll('[data-due]').forEach((button) => button.addEventListener('click', () => {
    draftDue = button.dataset.due;
    date.value = '';
    syncPicker();
  }));
  date.addEventListener('change', () => {
    draftDue = date.value || '';
    syncPicker();
  });
  star.addEventListener('click', () => {
    draftImportant = !draftImportant;
    star.setAttribute('aria-pressed', String(draftImportant));
  });

  // The box grows with what you write. Enter adds; Shift+Enter starts a new line.
  input.addEventListener('input', growInput);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  // Add: what you wrote becomes a task; each line of a pasted list becomes its own.
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const titles = input.value
      .split('\n')
      .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)]|\[[ x]\])\s*/i, '').trim())
      .filter(Boolean);
    if (!titles.length) return;
    addTasks(titles.map((title) => ({ title, due: draftDueDate(), important: draftImportant })));
    if (titles.length > 1) toast(`Added ${plural(titles.length, 'task')}`);
    clearDraft();
    input.focus();
  });

  $('task-analyse').addEventListener('click', analyse);
  syncPicker();
  growInput(); // one line tall until there's more to show
}

function draftDueDate() {
  if (draftDue === 'today') return dateKey();
  if (draftDue === 'tomorrow') return addDays(dateKey(), 1);
  return draftDue || null;
}

function growInput() {
  const input = $('task-input');
  // Empty: the natural one-line height (measuring could catch the placeholder
  // wrapping before the font has loaded).
  if (!input.value) {
    input.style.height = '';
    return;
  }
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight + 2, 220)}px`;
}

function clearDraft() {
  $('task-input').value = '';
  growInput();
  draftImportant = false;
  $('task-important').setAttribute('aria-pressed', 'false');
}

// --- Analyse: one paragraph in, separate tasks out --------------------------------

async function analyse() {
  const input = $('task-input');
  const text = input.value.trim();
  if (!text) {
    toast('Write or paste everything you need to do, then press Analyse.');
    input.focus();
    return;
  }
  const button = $('task-analyse');
  button.disabled = true;
  button.classList.add('is-loading');
  try {
    const { tasks: found, method, note } = await splitTasks(text);
    if (!found.length) {
      toast('Couldn\'t find separate tasks in that. Try one per sentence or line.');
      return;
    }
    // A due day or star picked in the form applies where the text doesn't say.
    proposals = found.map((t) => ({ ...t, due: t.due ?? draftDueDate(), important: t.important || draftImportant }));
    proposalInfo = { method, note };
    renderProposals();
  } finally {
    button.disabled = false;
    button.classList.remove('is-loading');
  }
}

function closeProposals() {
  proposals = null;
  renderProposals();
}

function renderProposals() {
  const box = $('task-proposals');
  box.hidden = !proposals;
  if (!proposals) {
    box.replaceChildren();
    return;
  }
  const today = dateKey();
  const head = el('div', 'proposals-head');
  head.append(
    el('span', 'proposals-title', { text: `${plural(proposals.length, 'task')} found` }),
    el('span', 'proposals-method', { text: proposalInfo.method === 'ai' ? 'Split by Chrome\'s on-device AI' : 'Split by sentences and lists' }),
  );
  const list = el('ul', 'proposals');
  list.append(...proposals.map((p, i) => {
    const li = el('li', 'proposal');
    const field = el('input', 'field field--small', { type: 'text', 'aria-label': `Task ${i + 1}`, maxlength: 500 });
    field.value = p.title;
    field.addEventListener('input', () => { p.title = field.value; });
    li.append(field);
    li.append(p.due ? el('span', `due due--${p.due === today ? 'today' : 'later'}`, { text: formatDue(p.due, today) }) : el('span'));
    const star = el('button', 'task-star', { type: 'button', 'aria-pressed': String(p.important), 'aria-label': 'Important', title: 'Important' });
    star.append(icon('star', 15));
    star.addEventListener('click', () => {
      p.important = !p.important;
      star.setAttribute('aria-pressed', String(p.important));
    });
    const remove = el('button', 'task-btn task-btn--delete', { type: 'button', 'aria-label': `Leave out "${p.title}"`, title: 'Leave out' });
    remove.append(icon('close', 15));
    remove.addEventListener('click', () => {
      proposals.splice(i, 1);
      if (proposals.length) renderProposals();
      else closeProposals();
    });
    li.append(star, remove);
    return li;
  }));

  const actions = el('div', 'proposals-actions');
  const add = el('button', 'btn btn--primary btn--small', { type: 'button', text: `Add ${plural(proposals.length, 'task')}` });
  add.addEventListener('click', () => {
    const ready = proposals.filter((p) => p.title.trim());
    addTasks(ready);
    toast(`Added ${plural(ready.length, 'task')}`);
    clearDraft();
    closeProposals();
  });
  const cancel = el('button', 'btn btn--ghost btn--small', { type: 'button', text: 'Cancel' });
  cancel.addEventListener('click', closeProposals);
  actions.append(add, cancel);

  box.replaceChildren(head, list, ...(proposalInfo.note ? [el('p', 'proposals-note', { text: proposalInfo.note })] : []), actions);
}

// --- Backup ------------------------------------------------------------------------

export function normalizeImported(list) {
  const now = Date.now();
  return list
    .filter((t) => t && typeof t.title === 'string' && t.title.trim())
    .map((t) => ({
      id: typeof t.id === 'string' ? t.id : crypto.randomUUID(),
      title: t.title.trim().slice(0, 500),
      notes: typeof t.notes === 'string' ? t.notes : '',
      due: /^\d{4}-\d{2}-\d{2}$/.test(t.due) ? t.due : null,
      important: Boolean(t.important),
      url: safeUrl(t.url),
      done: Boolean(t.done),
      doneAt: t.done ? Number(t.doneAt) || now : null,
      createdAt: Number(t.createdAt) || now,
      updatedAt: now,
      deleted: false,
    }));
}
