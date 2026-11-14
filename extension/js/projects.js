// Your projects, in Levels: written interview questions about the projects
// on your resume, because that's where most interviews go first.
//
// Each project has its own ladder (the same rules as the skill levels: ten
// open to start, more as you pass them), five questions a level, from
// "walk me through it" to a senior interviewer pushing back. You answer in
// writing; the AI marks it against the project, corrects anything wrong,
// and shows a stronger version.
//
// It remembers what you've said: after each answer, the facts about the
// project in it are saved, so later questions build on them, and an answer
// that contradicts an earlier one is pointed out. Everything is saved here,
// and a level's questions are written once and kept.
import { load, save } from './store.js';
import { dateKey } from './dates.js';
import { askJson, AiUnavailable } from './ai.js';
import { openSettings } from './settings.js';
import { el, toast, plural } from './ui.js';

const KEY = 'projectPractice';
const LEVEL_SIZE = 5;
const LEVEL_START = 10;
const LEVEL_UNLOCK_AFTER = 5;
const PASS_SCORE = 70;

// { byProject: { [id]: { levels: { [n]: { ids, generatedAt } }, items: { id }, attempts: [], facts: [] } } }
let data = null;
let rerender = () => {};
let getProjects = () => [];
let current = null; // project id
let openLevel = null;
let openItem = null; // { id, level }
let busy = false;

export async function initProjects({ rerender: fn, projects }) {
  rerender = fn;
  getProjects = projects;
  data = (await load(KEY, null)) || { byProject: {} };
}

function store(id) {
  data.byProject[id] ||= { levels: {}, items: {}, attempts: [], facts: [] };
  return data.byProject[id];
}

const persist = () => save(KEY, data);

function button(label, className, onClick, { disabled = false } = {}) {
  const node = el('button', `btn ${className}`.trim(), { type: 'button', text: label, disabled });
  node.addEventListener('click', onClick);
  return node;
}

function card(title, ...children) {
  const node = el('section', 'work-card q-card', { 'data-area': 'know' });
  if (title) node.append(el('h3', 'work-card-title', { text: title }));
  node.append(...children);
  return node;
}

function attemptsFor(s, id) {
  return s.attempts.filter((a) => a.itemId === id);
}

function bestScore(s, id) {
  return Math.max(0, ...attemptsFor(s, id).map((a) => a.score || 0));
}

function levelPassed(s, n) {
  const info = s.levels[n];
  if (!info || !info.ids.every((id) => attemptsFor(s, id).length)) return false;
  return info.ids.reduce((sum, id) => sum + bestScore(s, id), 0) / info.ids.length >= PASS_SCORE;
}

function openCount(s) {
  const passed = Object.keys(s.levels).map(Number).filter((n) => levelPassed(s, n)).length;
  return { passed, open: LEVEL_START + Math.max(0, passed - (LEVEL_UNLOCK_AFTER - 1)) };
}

// --- Rendering ---------------------------------------------------------------------------

// True while a project question is open, so Levels shows only that.
export function projectItemOpen() {
  return Boolean(openItem);
}

export function renderProjects() {
  const projects = getProjects();
  const wrap = el('div', 'q-stack q-projects');
  if (!projects.length) {
    wrap.append(card('Your projects',
      el('p', 'q-text', { text: 'Interviewers ask about the projects on your resume more than anything else. Read your resume again and its projects appear here, each with its own ladder of written questions.' }),
      el('p', 'q-hint', { text: 'The reader now pulls out projects, so a resume read before today needs one more read.' })));
    return wrap;
  }
  current = projects.find((p) => p.id === current)?.id || projects[0].id;
  const project = projects.find((p) => p.id === current);
  const s = store(current);

  if (openItem && s.items[openItem.id]) {
    wrap.append(renderItem(project, s, s.items[openItem.id]));
    return wrap;
  }

  const tabs = el('div', 'learn-tabs q-topics', { role: 'tablist', 'aria-label': 'Projects' });
  projects.forEach((p) => {
    const { passed } = openCount(store(p.id));
    const tab = el('button', 'learn-tab', { type: 'button', role: 'tab', 'aria-selected': String(p.id === current), text: passed ? `${p.name} · ${passed}` : p.name });
    tab.addEventListener('click', () => { current = p.id; openLevel = null; rerender(); });
    tabs.append(tab);
  });
  wrap.append(tabs);

  const about = el('div', 'q-project-about');
  about.append(el('p', 'q-text', { text: project.summary }));
  const meta = [project.role ? `Your role: ${project.role}` : null, project.stack?.length ? `Stack: ${project.stack.join(', ')}` : null].filter(Boolean);
  if (meta.length) about.append(el('p', 'q-hint', { text: meta.join(' · ') }));
  if (s.facts.length) {
    const details = el('details', 'q-solution');
    details.append(el('summary', '', { text: `${plural(s.facts.length, 'thing')} you've told it about this project` }));
    const ul = el('ul', 'q-ul');
    s.facts.forEach((f) => ul.append(el('li', '', { text: f })));
    details.append(ul);
    about.append(details);
  }

  const { passed, open } = openCount(s);
  const grid = el('div', 'q-levels');
  for (let n = 1; n <= open + 1; n += 1) {
    const info = s.levels[n];
    const done = levelPassed(s, n);
    const started = info && info.ids.some((id) => attemptsFor(s, id).length);
    const locked = n > open;
    const tile = el('button', `q-level${locked ? ' is-locked' : ''}${done ? ' is-passed' : ''}${started && !done ? ' is-tried' : ''}${openLevel === n ? ' is-open' : ''}`, {
      type: 'button', disabled: locked || busy, title: locked ? `Opens when you pass ${plural(Math.max(1, LEVEL_UNLOCK_AFTER - passed), 'more level')}` : done ? 'Passed' : started ? 'Started' : 'Not tried yet',
    });
    const note = locked ? '🔒' : info ? `${Math.round(info.ids.reduce((sum, id) => sum + bestScore(s, id), 0) / info.ids.length)}` : band(n).split(':')[0];
    tile.append(el('span', 'q-level-number', { text: String(n) }), el('span', 'q-level-note', { text: note }));
    if (!locked) tile.addEventListener('click', () => run(async () => { await ensureLevel(project, s, n); openLevel = n; }));
    grid.append(tile);
  }
  const node = card(`${project.name}: ${passed} of ${open} levels passed`, about, grid,
    el('p', 'q-hint', { text: `Five written questions a level, the kind an interviewer asks about your own work. Your answer is marked against the project and corrected where it's wrong, and what you say is remembered for later questions. ${Math.round(PASS_SCORE)} average passes a level.${busy ? ' Writing…' : ''}` }));

  if (openLevel && s.levels[openLevel]) {
    const list = el('div', 'q-tasks');
    s.levels[openLevel].ids.forEach((id, i) => {
      const item = s.items[id];
      const last = attemptsFor(s, id).at(-1);
      const row = el('button', 'q-task', { type: 'button' });
      row.append(
        el('span', 'q-task-kind', { text: `Q${i + 1}` }),
        el('span', 'q-task-title', { text: item.title }),
        el('span', `q-task-status${bestScore(s, id) >= PASS_SCORE ? ' is-good' : ''}`, { text: last ? `Best ${bestScore(s, id)}` : 'Not done' }),
      );
      row.addEventListener('click', () => { openItem = { id, level: openLevel }; rerender(); });
      list.append(row);
    });
    node.append(el('h4', 'q-level-heading', { text: `Level ${openLevel}${levelPassed(s, openLevel) ? ' · passed' : ''}` }), list);
  }
  wrap.append(node);
  return wrap;
}

function renderItem(project, s, item) {
  const body = el('div', 'q-question');
  const head = el('div', 'q-quiz-head');
  head.append(el('span', 'q-quiz-title', { text: `${project.name} · Level ${openItem.level}` }));
  head.append(button('Back', 'btn--ghost btn--small', () => { openItem = null; rerender(); }));
  body.append(head);
  body.append(el('span', 'q-topic-tag', { text: item.kind }));
  body.append(el('p', 'q-question-text', { text: item.prompt }));
  if (item.followUp) body.append(el('p', 'q-hint', { text: `If you're done quickly: ${item.followUp}` }));

  const last = attemptsFor(s, item.id).at(-1);
  const box = el('textarea', 'field note-text-field q-answer', { rows: 8, placeholder: 'Answer as you would in the interview: what, why, how, and what happened…', 'aria-label': 'Your answer' });
  if (last) box.value = last.answer || '';
  body.append(box);
  const actions = el('div', 'q-actions');
  actions.append(button(last ? 'Mark again' : 'Check my answer', 'btn--primary', () => {
    const answer = box.value.trim();
    if (answer.split(/\s+/).length < 8) { toast('Write a bit more first, as you would say it in the interview.'); return; }
    run(() => markAnswer(project, s, item, answer));
  }, { disabled: busy }));
  body.append(actions);

  if (last) {
    const mark = el('div', 'q-mark');
    if (last.pending) {
      mark.append(el('p', 'q-hint', { text: 'No AI is set up to mark this. Compare with the guidance and mark it yourself.' }));
      if (item.guidance) mark.append(el('p', 'q-explanation', { text: item.guidance }));
      const self = (score) => async () => { Object.assign(last, { pending: false, score, correct: score >= PASS_SCORE }); await persist(); rerender(); };
      const a = el('div', 'q-actions');
      a.append(button('Good answer', 'btn--primary', self(85)), button('Needs work', 'btn', self(45)));
      mark.append(a);
    } else {
      mark.append(el('p', `q-verdict ${last.correct ? 'is-good' : 'is-bad'}`, { text: `${last.score} / 100${last.correct ? ' · interview-ready' : ''}` }));
      if (last.feedback) mark.append(el('p', 'q-text', { text: last.feedback }));
      if (last.corrections?.length) {
        const block = el('div', 'q-lesson');
        block.append(el('h4', 'q-lesson-title', { text: 'Corrections' }));
        const ul = el('ul', 'q-ul');
        last.corrections.forEach((c) => ul.append(el('li', '', { text: c })));
        block.append(ul);
        mark.append(block);
      }
      if (last.strengths?.length || last.fixes?.length) {
        const cols = el('div', 'q-mark-cols');
        if (last.strengths?.length) cols.append(pointList('Good', last.strengths));
        if (last.fixes?.length) cols.append(pointList('Change', last.fixes));
        mark.append(cols);
      }
      if (last.better) {
        const details = el('details', 'q-solution', { open: last.correct ? null : '' });
        details.append(el('summary', '', { text: 'A stronger version, in your words' }), el('p', 'q-explanation q-better', { text: last.better }));
        mark.append(details);
      }
      if (last.facts?.length) mark.append(el('p', 'q-hint', { text: `Remembered: ${last.facts.join(' · ')}` }));
    }
    body.append(mark);
  }
  return card('', body);
}

function pointList(title, points) {
  const node = el('div', 'q-point');
  node.append(el('b', '', { text: title }));
  const ul = el('ul', 'q-ul');
  points.forEach((p) => ul.append(el('li', '', { text: p })));
  node.append(ul);
  return node;
}

async function run(job) {
  if (busy) return;
  busy = true;
  rerender();
  try {
    await job();
  } catch (error) {
    if (error instanceof AiUnavailable) toast(error.message, { label: 'Settings', run: () => openSettings('ai-section') });
    else toast(error.message || 'Something went wrong.');
  } finally {
    busy = false;
    rerender();
  }
}

// --- Writing questions ---------------------------------------------------------------------

function band(n) {
  if (n <= 3) return 'overview: what it does, who it is for, your role, why that stack, how you would demo it';
  if (n <= 7) return 'how it works: data model, the main flows, APIs, auth, deployment, how the pieces talk';
  if (n <= 12) return 'problems: the hardest bug, performance, scaling, trade-offs, what you would change now';
  if (n <= 18) return 'senior interviewer pushing back: security, failure modes, cost, testing, metrics, "why not X instead"';
  return 'deep dives: internals of the choices made, edge cases, migrations, what breaks at 100x the load';
}

const QUESTIONS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['questions'],
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'kind', 'prompt', 'followUp', 'guidance'],
        properties: {
          title: { type: 'string', description: 'short, like "Why Supabase?"' },
          kind: { type: 'string', description: 'overview, design, problem, pushback or deep dive' },
          prompt: { type: 'string', description: 'the question as the interviewer would say it, specific to this project' },
          followUp: { type: 'string', description: 'a follow-up the interviewer would add if the answer is short' },
          guidance: { type: 'string', description: 'what a strong answer covers, two to four lines' },
        },
      },
    },
  },
};

function projectContext(project, s) {
  return `Project: ${project.name}\nWhat it is: ${project.summary}\n${project.role ? `Their role: ${project.role}\n` : ''}${project.stack?.length ? `Stack: ${project.stack.join(', ')}\n` : ''}`
    + (s.facts.length ? `\nWhat they have said about it in earlier answers (treat as true unless a new answer contradicts it):\n${s.facts.map((f) => `- ${f}`).join('\n')}\n` : '');
}

async function ensureLevel(project, s, n) {
  if (s.levels[n]) return;
  const earlier = Object.values(s.items).map((i) => i.title);
  const instructions = 'You are an experienced interviewer preparing questions about a candidate\'s own project, from their resume. '
    + 'Ask the way a real interviewer does: specific to this project and its stack, open questions that need a real answer, one thing per question. Never repeat an earlier question.';
  const prompt = `${projectContext(project, s)}\nWrite exactly ${LEVEL_SIZE} questions for level ${n}: ${band(n)}. Level ${n} should be harder than level ${Math.max(1, n - 3)}.\n`
    + (earlier.length ? `Earlier questions, don't repeat:\n${earlier.map((t) => `- ${t}`).join('\n')}` : '');
  const out = await askJson({ instructions, prompt, schema: QUESTIONS_SCHEMA, maxTokens: 3000 });
  const items = (out.questions || []).filter((q) => q?.prompt).slice(0, LEVEL_SIZE).map((q) => ({
    id: crypto.randomUUID(),
    title: String(q.title || q.prompt).trim().slice(0, 80),
    kind: String(q.kind || 'overview').toLowerCase(),
    prompt: String(q.prompt).trim(),
    followUp: String(q.followUp || '').trim(),
    guidance: String(q.guidance || '').trim(),
    createdAt: Date.now(),
  }));
  if (!items.length) throw new Error('The AI sent no usable questions. Try again.');
  items.forEach((i) => { s.items[i.id] = i; });
  s.levels[n] = { ids: items.map((i) => i.id), generatedAt: Date.now() };
  await persist();
}

// --- Marking -------------------------------------------------------------------------------

const MARK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['score', 'correct', 'feedback', 'corrections', 'strengths', 'fixes', 'better', 'facts'],
  properties: {
    score: { type: 'integer', description: '0 to 100' },
    correct: { type: 'boolean', description: 'true when this answer would satisfy the interviewer as it stands' },
    feedback: { type: 'string', description: 'two to four direct sentences on the answer' },
    corrections: { type: 'array', items: { type: 'string' }, description: 'each thing that is technically wrong, vague where it should be specific, or contradicts what they said earlier, with the fix; empty if none' },
    strengths: { type: 'array', items: { type: 'string' } },
    fixes: { type: 'array', items: { type: 'string' }, description: 'what to change, one to three points' },
    better: { type: 'string', description: 'a stronger version of their answer in their own voice, keeping their facts, 80 to 160 words' },
    facts: { type: 'array', items: { type: 'string' }, description: 'new facts about the project stated in this answer, as short plain statements worth remembering; empty if none' },
  },
};

async function markAnswer(project, s, item, answer) {
  let mark = null;
  try {
    const instructions = 'You are an experienced interviewer marking a candidate\'s answer about their own project. '
      + 'Judge whether it answers the question, is specific and technically right, and holds together with what they said before. '
      + 'Correct every mistake plainly, in easy English, and say what a stronger answer adds. Keep their voice in the stronger version. Be direct, not harsh.';
    const prompt = `${projectContext(project, s)}\nQuestion: ${item.prompt}\n${item.guidance ? `What a strong answer covers: ${item.guidance}\n` : ''}\nTheir answer:\n${answer}`;
    mark = await askJson({ instructions, prompt, schema: MARK_SCHEMA, maxTokens: 2000 });
  } catch (error) {
    if (!(error instanceof AiUnavailable)) throw error;
  }
  const attempt = { id: crypto.randomUUID(), itemId: item.id, level: openItem?.level || null, day: dateKey(), at: Date.now(), answer };
  if (mark) {
    const facts = (mark.facts || []).map((f) => String(f).trim()).filter((f) => f && !s.facts.includes(f)).slice(0, 6);
    s.facts.push(...facts);
    if (s.facts.length > 60) s.facts.splice(0, s.facts.length - 60);
    Object.assign(attempt, {
      score: Math.max(0, Math.min(100, Math.round(Number(mark.score) || 0))),
      correct: Boolean(mark.correct),
      feedback: mark.feedback,
      corrections: mark.corrections || [],
      strengths: mark.strengths || [],
      fixes: mark.fixes || [],
      better: mark.better,
      facts,
    });
  } else {
    Object.assign(attempt, { pending: true, score: null, correct: null });
  }
  s.attempts.push(attempt);
  await persist();
}

// --- For the profile and feedback ----------------------------------------------------------

export function projectStats(days) {
  const from = dateKey(new Date(Date.now() - days * 864e5));
  const all = Object.values(data?.byProject || {});
  const attempts = all.flatMap((s) => s.attempts).filter((a) => a.day >= from && !a.pending);
  const avg = attempts.length ? Math.round(attempts.reduce((n, a) => n + a.score, 0) / attempts.length) : null;
  const levelsPassed = all.reduce((n, s) => n + Object.keys(s.levels).map(Number).filter((k) => levelPassed(s, k)).length, 0);
  return { attempts: attempts.length, average: avg, levelsPassed, facts: all.reduce((n, s) => n + s.facts.length, 0) };
}

export function projectDays() {
  return new Set(Object.values(data?.byProject || {}).flatMap((s) => s.attempts).filter((a) => !a.pending).map((a) => a.day));
}

export function exportProjects() {
  return data;
}
