// The Notes tab: what you did, what's left and what you're waiting on, written
// down per project and per day, beside what you pushed to GitHub that day. The
// Note button on each project in the Work tab opens the same note box with
// that project and day filled in.
//
// Notes live in chrome.storage.local (key "workNotes") and sync to Supabase
// when it's set up. Deleted notes stay as tombstones for a while so the
// deletion can reach your other devices.
import { load, save, watch, stableJson } from './store.js';
import { markDirty } from './sync.js';
import { dayLabel } from './github.js';
import { fixFields } from './fixtext.js';
import { dateKey } from './dates.js';
import { el, icon, toast, plural } from './ui.js';

const KEY = 'workNotes';
const TOMBSTONE_DAYS = 30;
const DAYS_PER_PAGE = 14;
const REPO_NAME = /^[\w.-]+\/[\w.-]+$/; // owner/repo, as GitHub writes it
const $ = (id) => document.getElementById(id);

let notes = [];
const ownWrites = []; // saves from this tab that storage hasn't echoed back yet
let workDays = []; // the Work tab's saved days: which projects you pushed to
let filter = null; // the project shown, or null for all of them
let shownDays = DAYS_PER_PAGE;
let editing = null; // the note open in the note box, or null for a new one
const listeners = new Set();

export async function initNotes() {
  const cutoff = Date.now() - TOMBSTONE_DAYS * 24 * 60 * 60 * 1000;
  notes = (await load(KEY, [])).filter((n) => !n.deleted || n.updatedAt > cutoff);
  workDays = await load('workLog', []);
  // Another tab, or a pull from Supabase, changed the notes. Echoes of this
  // tab's own saves arrive in order and are skipped.
  watch(KEY, (value) => {
    const own = ownWrites.indexOf(stableJson(value ?? []));
    if (own !== -1) {
      ownWrites.splice(0, own + 1);
      return;
    }
    notes = value ?? [];
    changed();
  });
  watch('workLog', (value) => {
    workDays = value || [];
    renderNotes();
  });
  bindDialog();
  $('notes-new').addEventListener('click', () => openNoteDialog({ project: filter }));
  $('notes-more').addEventListener('click', () => {
    shownDays += DAYS_PER_PAGE;
    renderNotes();
  });
  renderNotes();
}

export const visibleNotes = () => notes.filter((n) => !n.deleted);
export const onNotesChange = (fn) => listeners.add(fn);

// One project's notes, one day's, or both, oldest first.
export function notesFor({ project = null, day = null } = {}) {
  return visibleNotes()
    .filter((n) => (!project || n.project === project) && (!day || n.day === day))
    .sort((a, b) => a.createdAt - b.createdAt);
}

// "wbt-web-support/tbs" -> "tbs"; a name you typed stays as it is.
export const projectLabel = (project) => (REPO_NAME.test(project) ? project.split('/')[1] : project);
export const projectOwner = (project) => (REPO_NAME.test(project) ? project.split('/')[0] : '');

// Opens the Notes tab on one project.
export function showNotesFor(project) {
  showProject(project);
  document.dispatchEvent(new CustomEvent('tab:select', { detail: 'notes' }));
}

function showProject(project) {
  filter = project || null;
  shownDays = DAYS_PER_PAGE;
  renderNotes();
}

// --- Saving ---------------------------------------------------------------------

function addNote({ project, day, text }) {
  const now = Date.now();
  const note = { id: crypto.randomUUID(), project, day, text, createdAt: now, updatedAt: now, deleted: false };
  notes.push(note);
  commit([note.id]);
}

function updateNote(id, changes) {
  const note = notes.find((n) => n.id === id);
  if (!note) return;
  Object.assign(note, changes, { updatedAt: Date.now() });
  commit([id]);
}

function removeNote(id) {
  updateNote(id, { deleted: true });
  toast('Note deleted', { label: 'Undo', run: () => updateNote(id, { deleted: false }) });
}

function commit(changedIds) {
  ownWrites.push(stableJson(notes));
  if (ownWrites.length > 50) ownWrites.shift();
  save(KEY, notes);
  markDirty('work_notes', changedIds);
  changed();
}

function changed() {
  renderNotes();
  listeners.forEach((fn) => fn());
}

// --- Projects -------------------------------------------------------------------

// Every project you've pushed to or written about, most recent first.
function knownProjects() {
  const latest = new Map();
  const seen = (project, day) => { if (!(latest.get(project) >= day)) latest.set(project, day); };
  for (const r of workDays) for (const repo of r.repos || []) seen(repo.name, r.id);
  for (const n of visibleNotes()) seen(n.project, n.day);
  return [...latest].sort((a, b) => b[1].localeCompare(a[1])).map(([project]) => project);
}

// How a project reads in the note box: its short name, unless two of your
// projects share it.
function projectField(project, known = knownProjects()) {
  const label = projectLabel(project);
  return known.filter((p) => projectLabel(p).toLowerCase() === label.toLowerCase()).length > 1 ? project : label;
}

// What you typed, matched to a project you already have: "tbs" finds
// wbt-web-support/tbs, and "lead serve" finds "Lead serve".
function resolveProject(text) {
  const typed = text.trim().replace(/\s+/g, ' ');
  const lower = typed.toLowerCase();
  const known = knownProjects();
  const exact = known.find((p) => p.toLowerCase() === lower);
  if (exact) return exact;
  const byLabel = known.filter((p) => projectLabel(p).toLowerCase() === lower);
  return byLabel.length === 1 ? byLabel[0] : typed;
}

// --- The note box -------------------------------------------------------------------

export function openNoteDialog({ project = null, day = dateKey(), note = null } = {}) {
  editing = note;
  const known = knownProjects();
  const current = note?.project ?? project;
  $('note-dialog-title').textContent = note ? 'Edit note' : current ? `Note for ${projectLabel(current)}` : 'New note';
  $('note-project').value = current ? projectField(current, known) : '';
  $('note-day').value = note?.day ?? day;
  $('note-text').value = note?.text ?? '';
  $('note-save').textContent = note ? 'Save' : 'Add note';
  $('note-projects').replaceChildren(...known.map((p) => el('option', '', { value: projectField(p, known) })));
  $('note-dialog').showModal();
  (current ? $('note-text') : $('note-project')).focus();
}

function bindDialog() {
  const dialog = $('note-dialog');
  // There's no closing on a click outside, so a half-written note isn't lost.
  $('note-close').addEventListener('click', () => dialog.close());
  $('note-cancel').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { editing = null; });
  $('note-fix').addEventListener('click', () => fixFields([{ field: $('note-text'), kind: 'note' }], $('note-fix')));
  $('note-text').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      $('note-form').requestSubmit();
    }
  });
  $('note-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const project = resolveProject($('note-project').value);
    const text = $('note-text').value.trim();
    const day = $('note-day').value || dateKey();
    if (!project || !text) return;
    if (editing) {
      updateNote(editing.id, { project, day, text });
    } else {
      addNote({ project, day, text });
      toast(`Note added to ${projectLabel(project)}`);
    }
    dialog.close();
  });
}

// --- Pieces the Work tab uses too ------------------------------------------------

// "+ Note": a new note for one project on one day.
export function addNoteButton(project, day) {
  const label = `Add a note to ${projectLabel(project)}`;
  const button = el('button', 'card-action', { type: 'button', title: label, 'aria-label': label });
  button.append(icon('plus', 15), el('span', '', { text: 'Note' }));
  button.addEventListener('click', () => openNoteDialog({ project, day }));
  return button;
}

const timeFormat = { hour: '2-digit', minute: '2-digit' };

// Notes in the order they were written, each with the time, Edit and Delete.
export function noteList(list) {
  const ul = el('ul', 'notes');
  ul.append(...list.map((note) => {
    const li = el('li', 'note');
    const written = new Date(note.createdAt);
    // The time shows when the note was written on its own day.
    li.append(el('time', 'note-time', {
      datetime: written.toISOString(),
      title: `Written ${written.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`,
      text: dateKey(written) === note.day ? written.toLocaleTimeString(undefined, timeFormat) : '',
    }));
    li.append(el('p', 'note-text', { text: note.text }));
    const actions = el('div', 'note-actions');
    const edit = el('button', 'task-btn', { type: 'button', 'aria-label': 'Edit note', title: 'Edit' });
    edit.append(icon('edit', 15));
    edit.addEventListener('click', () => openNoteDialog({ note }));
    const remove = el('button', 'task-btn task-btn--delete', { type: 'button', 'aria-label': 'Delete note', title: 'Delete' });
    remove.append(icon('trash', 15));
    remove.addEventListener('click', () => removeNote(note.id));
    actions.append(edit, remove);
    li.append(actions);
    return li;
  }));
  return ul;
}

// --- The Notes tab ------------------------------------------------------------------

export function renderNotes() {
  const all = visibleNotes();
  const projects = new Set(all.map((n) => n.project));
  $('notes-summary').textContent = all.length
    ? `${plural(all.length, 'note')} across ${plural(projects.size, 'project')}.`
    : 'What you did, what\'s left and what you\'re waiting on, for each project. Add one here or with Note on a project in the Work tab.';
  renderFilter(all);
  renderDays();
}

// All projects, then each project with its number of notes.
function renderFilter(all) {
  const counts = new Map();
  for (const n of all) counts.set(n.project, (counts.get(n.project) || 0) + 1);
  const chip = (project, label, count) => {
    const button = el('button', 'learn-tab', { type: 'button', 'aria-pressed': String(project === filter), title: project || 'Every project' });
    button.append(el('span', '', { text: label }));
    if (count) button.append(el('span', 'notes-count', { text: count }));
    button.addEventListener('click', () => showProject(project));
    return button;
  };
  const known = knownProjects();
  $('notes-projects').replaceChildren(
    chip(null, 'All projects', all.length),
    ...known.map((p) => chip(p, projectField(p, known), counts.get(p) || 0)),
  );
}

// Newest day first. Each day lists the projects you pushed to or wrote about,
// with that day's notes under each one.
function renderDays() {
  const days = new Map(); // day -> project -> { notes, commits }
  const entry = (day, project) => {
    if (!days.has(day)) days.set(day, new Map());
    const projects = days.get(day);
    if (!projects.has(project)) projects.set(project, { notes: [], commits: 0 });
    return projects.get(project);
  };
  for (const r of workDays) {
    for (const repo of r.repos || []) if (repo.count && (!filter || repo.name === filter)) entry(r.id, repo.name).commits = repo.count;
  }
  for (const n of notesFor({ project: filter })) entry(n.day, n.project).notes.push(n);

  const order = [...days.keys()].sort((a, b) => b.localeCompare(a));
  $('notes-more').hidden = order.length <= shownDays;
  if (!order.length) {
    $('notes-days').replaceChildren(el('p', 'empty', {
      text: filter ? `No notes for ${projectLabel(filter)} yet.` : 'No notes yet. Press New note to write your first.',
    }));
    return;
  }
  $('notes-days').replaceChildren(...order.slice(0, shownDays).map((day) => renderDay(day, days.get(day))));
}

function renderDay(day, projects) {
  const section = el('section', 'notes-day');
  section.append(el('h3', 'notes-day-name', { text: dayLabel(day) }));
  // Projects with notes first, the latest note first; then the ones you only pushed to.
  const latest = (p) => p.notes.at(-1)?.createdAt || 0;
  const order = [...projects].sort(([, a], [, b]) => latest(b) - latest(a) || b.commits - a.commits);
  section.append(...order.map(([project, { notes: list, commits }]) => renderProject(project, day, list, commits)));
  return section;
}

function renderProject(project, day, list, commits) {
  const block = el('div', list.length ? 'notes-project' : 'notes-project is-quiet');
  const head = el('div', 'notes-project-head');
  const name = el('button', 'notes-project-name', { type: 'button', text: projectLabel(project), title: `Only ${projectLabel(project)}` });
  name.disabled = project === filter;
  name.addEventListener('click', () => showProject(project));
  head.append(name);
  if (projectOwner(project)) head.append(el('span', 'notes-project-owner', { text: projectOwner(project) }));
  if (commits) {
    const pushed = el('button', 'link-button', { type: 'button', text: plural(commits, 'commit'), title: 'Open this day in the Work tab' });
    pushed.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('workday:select', { detail: day }));
      document.dispatchEvent(new CustomEvent('tab:select', { detail: 'work' }));
    });
    head.append(pushed);
  }
  head.append(addNoteButton(project, day));
  block.append(head);
  if (list.length) block.append(noteList(list));
  return block;
}

// --- Backup ------------------------------------------------------------------------

export const exportNotes = () => visibleNotes();

// Merges notes from a backup; the newer version of each note wins. Returns
// how many were added or changed.
export function importNotes(list) {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const changedIds = [];
  for (const n of list) {
    if (typeof n?.id !== 'string' || typeof n.project !== 'string' || typeof n.text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(n.day)) continue;
    const mine = byId.get(n.id);
    if (mine && (mine.updatedAt || 0) >= (n.updatedAt || 0)) continue;
    const now = Date.now();
    byId.set(n.id, {
      id: n.id, project: n.project.trim(), day: n.day, text: n.text,
      createdAt: Number(n.createdAt) || now, updatedAt: Number(n.updatedAt) || now, deleted: Boolean(n.deleted),
    });
    changedIds.push(n.id);
  }
  if (!changedIds.length) return 0;
  notes = [...byId.values()];
  commit(changedIds);
  return changedIds.length;
}
