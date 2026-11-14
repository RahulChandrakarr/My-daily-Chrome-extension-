// The Questions tab: interview practice built from your resume.
//
//   Resume      Upload your resume (PDF or text) once. The AI reads it and
//               lists the topics it covers; those drive everything below.
//               Without a resume, the resume topics in topics.js are used.
//   Daily quiz  One quiz a day, 15-20 questions, written fresh for the day
//               across your topics. Some questions have one right answer,
//               some several (checkboxes). A question you get right is never
//               asked again. One you get wrong comes back, but not within a
//               week of the last time, and at most a few per quiz.
//   Levels      For each topic, 40 levels of 25 questions, harder as you go.
//               Four are open at first and one more opens each day. A level's
//               questions are written the first time you open it.
//   Report      Today, this week and this month: quizzes done, accuracy,
//               your strongest and weakest topics, and levels passed.
//   Feedback    Once a day: where you're weak, what to work on and what's
//               worth learning next, written from your answers and your stack.
//
// Everything is stored on this computer like the rest of My Daily. The AI
// (js/ai.js) only writes questions and feedback; your answers never leave.
import { load, save, watch } from './store.js';
import { dateKey, addDays, daysBetween, parseKey } from './dates.js';
import { DEFAULT_TOPICS } from './topics.js';
import { stackTechs } from './stack.js';
import { streaks } from './contributions.js';
import { askJson, aiSource, AiUnavailable } from './ai.js';
import { openSettings } from './settings.js';
import { initPractice, renderPractice, puzzleStats, commStats, practiceNotes, practiceDays, practiceLevelsPassed, exportPractice } from './practice.js';
import { explainChoice, renderLesson } from './teach.js';
import { el, icon, toast, plural } from './ui.js';

const RESUME_KEY = 'quizResume';
const BANK_KEY = 'quizBank';
const SESSIONS_KEY = 'quizSessions';
const LEVELS_KEY = 'quizLevels';
const FEEDBACK_KEY = 'quizFeedback';

const DAILY_SIZE = 20;
const MAX_RETRIES = 4; // wrong answers that come back in one daily quiz
const RETRY_AFTER_DAYS = 7;
const LEVEL_SIZE = 20;
const PASS_MARK = 0.7;

const $ = (id) => document.getElementById(id);
const percent = (n, total) => (total ? Math.round((n / total) * 100) : 0);

let resume = null; // { source, name, topics: [{ id, name, group }], savedAt }
let bank = []; // questions, see makeQuestion
let sessions = []; // finished and in-progress quizzes
let levels = {}; // { topicId: { [level]: { questionIds, generatedAt, best } } }
let feedback = null; // { day, summary, workOn: [], learnNext: [] }
let view = 'daily'; // daily | levels | report | feedback
// The quiz being taken, by id. Storage changes (including this tab's own
// saves) replace `sessions` with a fresh copy, so holding the object itself
// would leave the quiz writing to a session that's no longer saved.
let activeSessionId = null;
const activeSession = () => (activeSessionId ? sessions.find((s) => s.id === activeSessionId) || null : null);
let levelTopic = null;
let reportRange = 'week';
let busy = false;

// --- Start-up -------------------------------------------------------------------------

export async function initQuestions() {
  [resume, bank, sessions, levels, feedback] = await Promise.all([
    load(RESUME_KEY, null), load(BANK_KEY, []), load(SESSIONS_KEY, []), load(LEVELS_KEY, {}), load(FEEDBACK_KEY, null),
  ]);
  activeSessionId = sessions.find((s) => !s.finishedAt && s.day === dateKey())?.id || null;
  view = await load('questionsView', 'daily');
  if (view === 'report' || view === 'feedback') view = 'profile'; // merged into Profile
  await initPractice({ rerender: render });
  // What the rest of My Daily knows about your work, for the profile's work summary.
  const WORK_KEYS = { workLog: 'log', contribCalendar: 'calendar', workStack: 'stack', workNotes: 'notes', tasks: 'tasks', learningLog: 'learning' };
  await Promise.all(Object.entries(WORK_KEYS).map(async ([key, field]) => {
    work[field] = await load(key, null);
    watch(key, (value) => { work[field] = value; if (view === 'profile') render(); });
  }));
  $('questions-tabs').addEventListener('click', (event) => {
    const button = event.target.closest('[data-view]');
    if (!button) return;
    view = button.dataset.view;
    save('questionsView', view);
    render();
  });
  $('questions-resume').addEventListener('click', openResumeDialog);
  initResumeDialog();
  watch(BANK_KEY, (value) => { bank = value || []; });
  watch(SESSIONS_KEY, (value) => { sessions = value || []; });
  render();
}

export function setQuestionsVisible(visible) {
  if (visible) render();
}

function topics() {
  return resume?.topics?.length ? resume.topics : DEFAULT_TOPICS.filter((t) => t.kind === 'resume').map((t) => ({ id: t.id, name: t.name, group: 'Skills' }));
}

function topicName(id) {
  return topics().find((t) => t.id === id)?.name || bank.find((q) => q.topic === id)?.topicName || id;
}

// --- Rendering ------------------------------------------------------------------------

function render() {
  const panel = $('panel-questions');
  if (!panel || panel.hidden) return;
  $('questions-tabs').querySelectorAll('[data-view]').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.view === view));
  });
  $('questions-summary').textContent = resume
    ? `${plural(topics().length, 'topic')} from ${resume.name}. ${summaryLine()}`
    : `Using the ${plural(topics().length, 'skill')} from the resume in topics.js until you upload yours. ${summaryLine()}`;
  const body = $('questions-body');
  const running = activeSession();
  if (running && (view === 'daily' || view === 'levels')) {
    body.replaceChildren(renderQuiz(running));
    return;
  }
  const views = {
    daily: renderDaily,
    levels: renderLevels,
    profile: renderProfile,
    puzzles: () => renderPractice('puzzle'),
    comm: () => renderPractice('comm'),
  };
  body.dataset.view = view; // colours the cards by area, see the Questions CSS
  body.replaceChildren((views[view] || renderDaily)());
}

function summaryLine() {
  const today = dateKey();
  const done = sessions.filter((s) => s.finishedAt && s.day === today);
  if (!done.length) return 'No quiz yet today.';
  const correct = done.reduce((n, s) => n + s.score.correct, 0);
  const total = done.reduce((n, s) => n + s.score.total, 0);
  return `Today: ${plural(done.length, 'quiz', 'quizzes')}, ${correct} of ${total} right.`;
}

function card(title, ...children) {
  const node = el('section', 'work-card q-card');
  if (title) node.append(el('h3', 'work-card-title', { text: title }));
  node.append(...children);
  return node;
}

function button(label, className, onClick, { disabled = false } = {}) {
  const node = el('button', `btn ${className}`.trim(), { type: 'button', text: label, disabled });
  node.addEventListener('click', onClick);
  return node;
}

// --- Daily quiz -----------------------------------------------------------------------

function renderDaily() {
  const today = dateKey();
  const wrap = el('div', 'q-stack');
  const todays = sessions.find((s) => s.kind === 'daily' && s.day === today);
  if (todays?.finishedAt) {
    wrap.append(renderResult(todays, 'Today\'s quiz is done. A new one is written tomorrow.'));
  } else if (todays) {
    // Started but not finished (the tab was closed, say): carry on, don't write a second one.
    const answered = Object.keys(todays.answers).length;
    wrap.append(card('Today\'s quiz',
      el('p', 'q-text', { text: `${answered} of ${todays.questionIds.length} answered, ${todays.score.correct} right so far.` }),
      button('Continue today\'s quiz', 'btn--primary', () => { activeSessionId = todays.id; render(); })));
  } else {
    const retries = retryPool().length;
    const intro = card('Today\'s quiz',
      el('p', 'q-text', { text: `${DAILY_SIZE} interview questions across your topics, written fresh for today. Some have one right answer, some several.${retries ? ` ${plural(Math.min(retries, MAX_RETRIES), 'question')} you got wrong before ${retries === 1 ? 'comes' : 'come'} back.` : ''}` }),
      button(busy ? 'Writing today\'s questions…' : 'Start today\'s quiz', 'btn--primary', startDaily, { disabled: busy }));
    wrap.append(intro);
  }
  const past = sessions.filter((s) => s.kind === 'daily' && s.finishedAt && s.day !== today).sort((a, b) => b.day.localeCompare(a.day)).slice(0, 14);
  if (past.length) {
    const list = el('div', 'q-history');
    past.forEach((s) => {
      const row = el('div', 'q-history-row');
      row.append(
        el('span', '', { text: parseKey(s.day).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) }),
        el('b', `q-score ${s.score.correct / s.score.total >= PASS_MARK ? 'is-good' : ''}`, { text: `${s.score.correct} / ${s.score.total}` }),
      );
      list.append(row);
    });
    wrap.append(card('Earlier quizzes', list));
  }
  return wrap;
}

// Questions you got wrong, not asked for a week, oldest first.
function retryPool() {
  const cutoff = addDays(dateKey(), -RETRY_AFTER_DAYS);
  return bank
    .filter((q) => q.kind === 'daily' && !q.retired && q.asks.length && !q.asks.at(-1).correct && q.asks.at(-1).day <= cutoff)
    .sort((a, b) => a.asks.at(-1).day.localeCompare(b.asks.at(-1).day));
}

async function startDaily() {
  if (busy) return;
  busy = true;
  render();
  try {
    const retries = retryPool().slice(0, MAX_RETRIES);
    const fresh = await writeQuestions({
      count: DAILY_SIZE - retries.length,
      topics: dailyTopics(),
      kind: 'daily',
      difficulty: 'what a good interviewer asks a developer with 2-4 years of experience: practical, specific, with a few that need real understanding',
    });
    bank.push(...fresh);
    await save(BANK_KEY, bank);
    activeSessionId = newSession({ kind: 'daily', questionIds: shuffle([...retries, ...fresh]).map((q) => q.id) }).id;
  } catch (error) {
    reportAiError(error);
  } finally {
    busy = false;
    render();
  }
}

// Today's topics: a rotating slice of your resume, plus your weakest ones.
function dailyTopics() {
  const all = topics();
  const perDay = Math.min(6, all.length);
  const dayNumber = daysBetween('2026-01-01', dateKey());
  const start = (dayNumber * perDay) % all.length;
  const picked = Array.from({ length: perDay }, (_, i) => all[(start + i) % all.length]);
  const weak = topicStats(30).filter((t) => t.total >= 3 && t.accuracy < PASS_MARK).slice(0, 2);
  weak.forEach((w) => { if (!picked.some((p) => p.id === w.id)) picked.push({ id: w.id, name: w.name }); });
  return picked;
}

// --- Levels ---------------------------------------------------------------------------
// One ladder per skill. Ten levels are open to begin with; from the fifth
// level you pass, every level you pass opens one more, so the ladder grows
// with you rather than with the calendar. A level's 20 questions are written
// the first time you open it and kept, so they're never written twice.

export const LEVEL_START = 10;
export const LEVEL_UNLOCK_AFTER = 5;

export function openLevelCount(passed) {
  return LEVEL_START + Math.max(0, passed - (LEVEL_UNLOCK_AFTER - 1));
}

function passedLevels(topicId) {
  return Object.values(levelsFor(topicId)).filter((l) => l?.best && l.best.total && l.best.correct / l.best.total >= PASS_MARK).length;
}

function renderLevels() {
  const wrap = el('div', 'q-stack');
  const all = topics();
  levelTopic = all.find((t) => t.id === levelTopic)?.id || all[0]?.id || null;

  // Your skills as tabs, with a box to add one.
  const chips = el('div', 'learn-tabs q-topics', { role: 'tablist', 'aria-label': 'Skills' });
  all.forEach((t) => {
    const passed = passedLevels(t.id);
    const chip = el('button', 'learn-tab', { type: 'button', role: 'tab', 'aria-selected': String(t.id === levelTopic), text: passed ? `${t.name} · ${passed}` : t.name });
    chip.addEventListener('click', () => { levelTopic = t.id; render(); });
    chips.append(chip);
  });
  const addForm = el('form', 'q-add-skill');
  const input = el('input', 'field', { type: 'text', placeholder: 'Add a skill, like HTML', 'aria-label': 'Add a skill', maxlength: '60', autocomplete: 'off' });
  addForm.append(input, button('Add', 'btn btn--small', () => {}));
  addForm.querySelector('button').type = 'submit';
  addForm.addEventListener('submit', (event) => {
    event.preventDefault();
    addSkill(input.value);
    input.value = '';
  });
  chips.append(addForm);
  wrap.append(chips);

  if (!levelTopic) {
    wrap.append(card('', el('p', 'empty', { text: 'Add a skill above, or upload your resume, to get a ladder of levels.' })));
    return wrap;
  }

  const topic = all.find((t) => t.id === levelTopic);
  const stats = levelsFor(levelTopic);
  const passed = passedLevels(levelTopic);
  const open = openLevelCount(passed);
  const grid = el('div', 'q-levels');
  for (let n = 1; n <= open + 1; n += 1) {
    const info = stats[n];
    const best = info?.best;
    const done = best && best.total && best.correct / best.total >= PASS_MARK;
    const locked = n > open;
    const toUnlock = Math.max(1, LEVEL_UNLOCK_AFTER - passed);
    const tile = el('button', `q-level${locked ? ' is-locked' : ''}${done ? ' is-passed' : ''}${best && !done ? ' is-tried' : ''}`, {
      type: 'button',
      disabled: locked || busy,
      title: locked ? `Opens when you pass ${plural(toUnlock, 'more level')}` : best ? `Best ${best.correct} of ${best.total}` : 'Not tried yet',
    });
    tile.append(
      el('span', 'q-level-number', { text: String(n) }),
      el('span', 'q-level-note', { text: locked ? '🔒' : best ? `${percent(best.correct, best.total)}%` : levelLabel(n) }),
    );
    if (!locked) tile.addEventListener('click', () => startLevel(levelTopic, n));
    grid.append(tile);
  }
  const remove = button('Remove skill', 'btn--ghost btn--small q-remove-skill', () => removeSkill(levelTopic));
  const head = el('div', 'q-levels-head');
  head.append(el('h3', 'work-card-title', { text: `${topic.name}: ${passed} of ${open} levels passed` }), remove);
  const node = el('section', 'work-card q-card');
  node.append(head, grid, el('p', 'q-hint', {
    text: `Each level has ${LEVEL_SIZE} questions, written the first time you open it and kept. ${Math.round(PASS_MARK * 100)}% passes a level, and you can retake any level. `
      + `${LEVEL_START} levels are open to start; from the ${ordinal(LEVEL_UNLOCK_AFTER)} level you pass, every level you pass opens one more.${busy ? ' Writing the level\'s questions…' : ''}`,
  }));
  wrap.append(node);
  return wrap;
}

function ordinal(n) {
  return `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : Math.min(n % 10, 4)] || 'th'}`;
}

// Adding or removing a skill edits the saved resume topics. Without a
// resume yet, the built-in list becomes yours to edit.
async function ensureResumeTopics() {
  if (resume) return;
  resume = { source: 'default', name: 'Your profile', title: '', summary: '', topics: topics(), pdf: null, text: null, savedAt: Date.now() };
}

async function addSkill(text) {
  const name = String(text || '').replace(/\s+/g, ' ').trim();
  if (name.length < 2) return;
  await ensureResumeTopics();
  const id = slug(name);
  if (!resume.topics.some((t) => t.id === id)) {
    resume.topics.push({ id, name, group: 'Added' });
    await save(RESUME_KEY, resume);
  }
  levelTopic = id;
  render();
}

async function removeSkill(id) {
  const topic = topics().find((t) => t.id === id);
  if (!topic || !confirm(`Remove ${topic.name} from your skills? Its levels and scores are kept if you add it back.`)) return;
  await ensureResumeTopics();
  resume.topics = resume.topics.filter((t) => t.id !== id);
  await save(RESUME_KEY, resume);
  levelTopic = null;
  render();
}

function levelsFor(topicId) {
  return levels[topicId] || {};
}

function levelLabel(n) {
  if (n <= 3) return 'basics';
  if (n <= 7) return 'junior';
  if (n <= 12) return 'mid';
  if (n <= 18) return 'senior';
  return 'expert';
}

function levelDifficulty(n) {
  const band = n <= 3 ? 'fundamentals and definitions a beginner should know'
    : n <= 7 ? 'junior developer questions: everyday usage, common mistakes, reading small snippets'
      : n <= 12 ? 'mid-level questions: how things work underneath, trade-offs, debugging, a few code-reading questions'
        : n <= 18 ? 'senior questions: design decisions, performance, security, edge cases, comparing approaches'
          : 'expert questions: internals, scaling, failure modes, questions a principal engineer would ask';
  return `level ${n}: ${band}. Level ${n} should be noticeably harder than level ${Math.max(1, n - 3)}`;
}

async function startLevel(topicId, n) {
  if (busy) return;
  const topic = topics().find((t) => t.id === topicId) || { id: topicId, name: topicName(topicId) };
  let info = levelsFor(topicId)[n];
  if (!info) {
    busy = true;
    render();
    try {
      const questions = await writeQuestions({ count: LEVEL_SIZE, topics: [topic], kind: 'level', level: n, difficulty: levelDifficulty(n) });
      bank.push(...questions);
      await save(BANK_KEY, bank);
      info = { questionIds: questions.map((q) => q.id), generatedAt: Date.now(), best: null };
      levels[topicId] = { ...levelsFor(topicId), [n]: info };
      await save(LEVELS_KEY, levels);
    } catch (error) {
      reportAiError(error);
      return;
    } finally {
      busy = false;
      render();
    }
  }
  activeSessionId = newSession({ kind: 'level', topic: topicId, level: n, questionIds: info.questionIds }).id;
  render();
}

// --- Writing questions ----------------------------------------------------------------

const QUESTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['questions'],
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['topic', 'question', 'options', 'answers', 'explanation'],
        properties: {
          topic: { type: 'string', description: 'the topic id this question belongs to' },
          question: { type: 'string' },
          options: { type: 'array', items: { type: 'string' }, description: '4 or 5 options, no letters or numbers in front' },
          answers: { type: 'array', items: { type: 'integer' }, description: 'indexes of the right options; one for single-answer questions, two or more for choose-all-that-apply' },
          explanation: { type: 'string', description: 'one or two sentences on why, as an interviewer would explain it' },
        },
      },
    },
  },
};

async function writeQuestions({ count, topics: list, kind, level = null, difficulty }) {
  const recent = bank
    .filter((q) => list.some((t) => t.id === q.topic))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 80)
    .map((q) => q.text);
  const multi = Math.max(2, Math.round(count / 4));
  const instructions = 'You write technical interview questions for a full-stack developer preparing for job interviews. '
    + 'Each question is multiple choice with 4 or 5 options. Make wrong options plausible, not silly. '
    + 'Ask about things that come up in real interviews: how it works, why, what happens if, which is better and when, and reading short code. '
    + 'Keep code snippets short and put them in the question text. Never repeat a question from the list of earlier questions, and vary the wording and angle. '
    + 'Write in plain English.';
  const prompt = `Write exactly ${count} questions.\n\n`
    + (resume?.summary ? `About the person (ask some questions about the kind of work and tools on their resume, as an interviewer who read it would):\n${resume.summary}\n\n` : '')
    + `Topics (use the id in the topic field, spread the questions across them${list.length > 1 ? ', at least one per topic' : ''}):\n${list.map((t) => `- ${t.id}: ${t.name}`).join('\n')}\n\n`
    + `Difficulty: ${difficulty}.\n\n`
    + `About ${multi} of the questions should have two or more right answers (choose all that apply); the rest have exactly one.\n\n`
    + (recent.length ? `Earlier questions, do not repeat or paraphrase these:\n${recent.map((t) => `- ${t}`).join('\n')}\n` : '');
  const data = await askJson({ instructions, prompt, schema: QUESTION_SCHEMA, maxTokens: 12000 });
  const ids = new Set(list.map((t) => t.id));
  const questions = (data.questions || [])
    .filter((q) => q?.question && Array.isArray(q.options) && q.options.length >= 3 && Array.isArray(q.answers) && q.answers.length)
    .map((q) => makeQuestion(q, { kind, level, topicId: ids.has(q.topic) ? q.topic : list[0].id }))
    .filter((q) => q.answers.length && q.answers.every((i) => i >= 0 && i < q.options.length));
  if (!questions.length) throw new Error('The AI sent no usable questions. Try again.');
  return questions.slice(0, count);
}

function makeQuestion(q, { kind, level, topicId }) {
  const options = q.options.map((o) => String(o).trim()).filter(Boolean);
  const answers = [...new Set(q.answers.map(Number))].filter((i) => Number.isInteger(i)).sort((a, b) => a - b);
  return {
    id: crypto.randomUUID(),
    kind,
    level,
    topic: topicId,
    topicName: topicName(topicId),
    text: String(q.question).trim(),
    options,
    answers,
    multi: answers.length > 1,
    explanation: String(q.explanation || '').trim(),
    createdAt: Date.now(),
    asks: [], // [{ day, correct }]
    retired: false, // true once answered right (daily questions only)
  };
}

// --- Taking a quiz --------------------------------------------------------------------

function newSession({ kind, questionIds, topic = null, level = null }) {
  const session = {
    id: crypto.randomUUID(),
    kind,
    topic,
    level,
    day: dateKey(),
    questionIds,
    answers: {}, // { questionId: { chosen: [idx], correct } }
    position: 0,
    score: { correct: 0, total: questionIds.length },
    startedAt: Date.now(),
    finishedAt: null,
  };
  sessions.push(session);
  save(SESSIONS_KEY, sessions);
  return session;
}

function renderQuiz(session) {
  const wrap = el('div', 'q-stack');
  // A question missing from the bank is skipped, not the end of the quiz.
  while (session.position < session.questionIds.length && !bank.some((q) => q.id === session.questionIds[session.position])) {
    session.position += 1;
  }
  const question = bank.find((q) => q.id === session.questionIds[session.position]);
  if (!question) {
    finishSession(session);
    return renderResult(session);
  }
  const answered = session.answers[question.id];
  const head = el('div', 'q-quiz-head');
  const title = session.kind === 'daily' ? 'Today\'s quiz' : `${topicName(session.topic)} · Level ${session.level}`;
  head.append(
    el('span', 'q-quiz-title', { text: title }),
    el('span', 'q-quiz-progress', { text: `${session.position + 1} / ${session.questionIds.length} · ${session.score.correct} right` }),
  );
  // Handlers look the session up again when clicked: by then a storage change
  // may have replaced `sessions`, and `session` would be a detached copy.
  const live = () => sessions.find((s) => s.id === session.id) || session;
  const quit = button('Stop', 'btn--ghost btn--small', () => {
    if (!confirm('Stop this quiz? The questions you answered are kept; the rest wait for next time.')) return;
    finishSession(live());
    render();
  });
  head.append(quit);

  const body = el('div', 'q-question');
  body.append(el('span', 'q-topic-tag', { text: question.topicName }));
  body.append(el('p', 'q-question-text', { text: question.text }));
  if (question.multi) body.append(el('p', 'q-hint', { text: 'Choose all that apply.' }));
  const list = el('div', 'q-options', { role: 'group' });
  const inputs = [];
  question.options.forEach((option, i) => {
    const label = el('label', 'q-option');
    const input = el('input', '', { type: question.multi ? 'checkbox' : 'radio', name: `q-${question.id}`, value: String(i) });
    if (answered) {
      input.disabled = true;
      input.checked = answered.chosen.includes(i);
      if (question.answers.includes(i)) label.classList.add('is-right');
      else if (answered.chosen.includes(i)) label.classList.add('is-wrong');
    }
    inputs.push(input);
    label.append(input, el('span', '', { text: option }));
    list.append(label);
  });
  body.append(list);

  const actions = el('div', 'q-actions');
  if (answered) {
    const verdict = el('p', `q-verdict ${answered.correct ? 'is-good' : 'is-bad'}`, { text: answered.correct ? 'Right.' : `Not quite. ${question.answers.length > 1 ? 'The right answers are marked.' : 'The right answer is marked.'}` });
    body.append(verdict);
    if (question.explanation) body.append(el('p', 'q-explanation', { text: question.explanation }));
    if (!answered.correct) body.append(lessonFor(question, answered.chosen));
    const last = session.position >= session.questionIds.length - 1;
    actions.append(button(last ? 'See your score' : 'Next question', 'btn--primary', () => {
      const s = live();
      if (last) finishSession(s);
      else s.position += 1;
      save(SESSIONS_KEY, sessions);
      render();
    }));
  } else {
    actions.append(button('Check', 'btn--primary', () => {
      const chosen = inputs.filter((i) => i.checked).map((i) => Number(i.value));
      if (!chosen.length) { toast('Pick an answer first.'); return; }
      answer(live(), question, chosen);
      render();
    }));
  }
  body.append(actions);
  const progress = el('div', 'q-progress', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(session.questionIds.length), 'aria-valuenow': String(session.position + (answered ? 1 : 0)) });
  const fill = el('span');
  fill.style.width = `${Math.round(((session.position + (answered ? 1 : 0)) / session.questionIds.length) * 100)}%`;
  progress.append(fill);
  wrap.append(head, progress, card('', body));
  return wrap;
}

function answer(session, shown, chosen) {
  // The question object shown may be a detached copy too; write to the one in the bank.
  const question = bank.find((q) => q.id === shown.id) || shown;
  const correct = chosen.length === question.answers.length && chosen.every((i) => question.answers.includes(i));
  session.answers[question.id] = { chosen, correct };
  if (correct) session.score.correct += 1;
  question.asks.push({ day: session.day, correct });
  if (correct && question.kind === 'daily') question.retired = true;
  save(BANK_KEY, bank);
  save(SESSIONS_KEY, sessions);
}

// The lesson for a wrong answer: kept on the question once written, so a
// question that comes back a week later shows it straight away. Written
// when first needed, then the quiz redraws.
const lessonsInProgress = new Set();

function lessonFor(shown, chosen) {
  const question = bank.find((q) => q.id === shown.id) || shown;
  if (question.lesson) return renderLesson(question.lesson);
  if (question.lessonFailed) return renderLesson(null, { fallback: question.lessonFailed });
  if (!lessonsInProgress.has(question.id)) {
    lessonsInProgress.add(question.id);
    explainChoice({ question: question.text, options: question.options, answers: question.answers, chosen, topic: question.topicName })
      .then((lesson) => {
        const live = bank.find((q) => q.id === question.id);
        if (live) live.lesson = lesson;
        return save(BANK_KEY, bank);
      })
      .catch((error) => {
        const live = bank.find((q) => q.id === question.id);
        if (live) live.lessonFailed = error.message || 'The explanation couldn\'t be written.';
      })
      .finally(() => {
        lessonsInProgress.delete(question.id);
        render();
      });
  }
  return renderLesson('loading');
}

function finishSession(session) {
  if (session.finishedAt) return;
  session.finishedAt = Date.now();
  session.score.total = Object.keys(session.answers).length || session.questionIds.length;
  if (session.kind === 'level' && session.topic) {
    const info = levelsFor(session.topic)[session.level];
    if (info) {
      const better = !info.best || session.score.correct / session.score.total > info.best.correct / info.best.total;
      if (better) info.best = { correct: session.score.correct, total: session.score.total };
      save(LEVELS_KEY, levels);
    }
  }
  activeSessionId = null;
  save(SESSIONS_KEY, sessions);
  if (feedback?.day === dateKey()) {
    feedback = null;
    save(FEEDBACK_KEY, null);
  }
}

function renderResult(session, note = '') {
  const { correct, total } = session.score;
  const pct = percent(correct, total);
  const wrong = session.questionIds.map((id) => bank.find((q) => q.id === id)).filter((q) => q && session.answers[q.id] && !session.answers[q.id].correct);
  const body = el('div', 'q-result');
  body.append(el('p', 'q-result-score', { text: `${correct} of ${total} right · ${pct}%` }));
  body.append(el('p', 'q-text', { text: pct >= 90 ? 'Excellent.' : pct >= PASS_MARK * 100 ? 'Good. Keep the streak going.' : 'Keep at it. The ones you missed come back in a week.' }));
  if (note) body.append(el('p', 'q-hint', { text: note }));
  if (wrong.length) {
    const list = el('div', 'q-missed');
    list.append(el('h4', '', { text: 'To revisit' }));
    wrong.forEach((q) => {
      const item = el('div', 'q-missed-item');
      item.append(el('p', 'q-missed-q', { text: q.text }), el('p', 'q-missed-a', { text: `Answer: ${q.answers.map((i) => q.options[i]).join('; ')}` }));
      if (q.explanation) item.append(el('p', 'q-explanation', { text: q.explanation }));
      if (q.lesson) item.append(renderLesson(q.lesson));
      list.append(item);
    });
    body.append(list);
  }
  const actions = el('div', 'q-actions');
  if (session.kind === 'level') actions.append(button('Back to levels', 'btn', () => { view = 'levels'; render(); }));
  actions.append(button('See your profile', 'btn--ghost', () => { view = 'profile'; save('questionsView', view); render(); }));
  body.append(actions);
  return card(session.kind === 'daily' ? 'Today\'s quiz' : `${topicName(session.topic)} · Level ${session.level}`, body);
}

// --- Report ---------------------------------------------------------------------------

// --- Profile ---------------------------------------------------------------------------
// One page in two columns. Across the top: who you are and five all-time
// figures. Left: practice progress for a range, accuracy by topic and your
// work from GitHub. Right: today's feedback, the stack you ship with and
// your skills from the resume.

const RANGES = { day: ['Today', 0], week: ['This week', 6], month: ['This month', 29] };
const GROUP_ORDER = ['Languages', 'Frontend', 'Backend', 'Databases', 'Cloud & DevOps', 'AI', 'Mobile', 'Practices', 'Design', 'Other'];

function renderProfile() {
  const page = el('div', 'pf');
  page.append(renderHero());
  const grid = el('div', 'pf-grid');
  const main = el('div', 'pf-col');
  main.append(renderProgressCard(), renderAccuracyCard(), renderWorkCard());
  const side = el('div', 'pf-col');
  side.append(renderFeedbackCard(), renderStackCard(), renderSkillsCard());
  grid.append(main, side);
  page.append(grid);
  return page;
}

function go(next) {
  view = next;
  save('questionsView', view);
  render();
}

function iconButton(name, label, className, onClick, { disabled = false } = {}) {
  const node = el('button', className, { type: 'button', disabled });
  node.append(icon(name, 16), el('span', '', { text: label }));
  node.addEventListener('click', onClick);
  return node;
}

function pfCard(title, subtitle, { aside = null, className = '' } = {}) {
  const node = el('section', `pf-card ${className}`.trim());
  const head = el('div', 'pf-card-head');
  const titles = el('div');
  titles.append(el('h3', 'pf-card-title', { text: title }));
  if (subtitle) titles.append(el('p', 'pf-card-sub', { text: subtitle }));
  head.append(titles);
  if (aside) head.append(aside);
  node.append(head);
  return node;
}

// --- Hero

function renderHero() {
  const hero = el('section', 'pf-hero');
  const top = el('div', 'pf-hero-top');
  const name = resume?.name || 'Your profile';
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
  top.append(el('div', 'pf-avatar', { text: initials, 'aria-hidden': 'true' }));
  const who = el('div', 'pf-who');
  who.append(el('h3', 'pf-name', { text: name }));
  const meta = el('p', 'pf-meta');
  const bits = [
    resume?.title || 'Developer',
    `${plural(topics().length, 'topic')} from ${resume ? 'your resume' : 'the built-in resume'}`,
    resume ? `Resume read ${new Date(resume.savedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : 'Upload yours to make it personal',
  ];
  bits.forEach((text, i) => {
    if (i) meta.append(el('span', 'pf-sep', { 'aria-hidden': 'true' }));
    meta.append(el('span', '', { text }));
  });
  who.append(meta);
  top.append(who);

  const actions = el('div', 'pf-actions');
  actions.append(iconButton('upload', resume ? 'Update resume' : 'Upload resume', 'btn', openResumeDialog));
  const todays = sessions.find((s) => s.kind === 'daily' && s.day === dateKey());
  const label = todays?.finishedAt ? 'See today\'s result' : todays ? 'Continue today\'s quiz' : 'Start today\'s quiz';
  actions.append(iconButton('play', label, 'btn btn--primary pf-cta', () => {
    if (todays && !todays.finishedAt) activeSessionId = todays.id;
    go('daily');
    if (!todays) startDaily();
  }, { disabled: busy }));
  top.append(actions);
  hero.append(top);

  const days = practiceDaysAll();
  const answered = bank.reduce((n, q) => n + q.asks.length, 0);
  const right = bank.reduce((n, q) => n + q.asks.filter((a) => a.correct).length, 0);
  const figures = el('div', 'pf-figures');
  [
    ['Day streak', String(streakOf(days)), 'days'],
    ['Days practised', String(days.size), ''],
    ['Questions answered', String(answered), ''],
    ['Accuracy', answered ? `${percent(right, answered)}%` : '–', 'all-time'],
    ['Levels passed', String(quizLevelsPassed() + practiceLevelsPassed()), ''],
  ].forEach(([label, value, unit]) => {
    const cell = el('div', 'pf-figure');
    const big = el('p', 'pf-figure-value');
    big.append(el('b', '', { text: value }));
    if (unit) big.append(el('span', '', { text: ` ${unit}` }));
    cell.append(el('span', 'pf-label', { text: label }), big);
    figures.append(cell);
  });
  hero.append(figures);
  return hero;
}

// --- Practice progress

function renderProgressCard() {
  const picker = el('div', 'segmented pf-range', { role: 'group', 'aria-label': 'Range' });
  Object.entries(RANGES).forEach(([key, [label]]) => {
    const b = el('button', '', { type: 'button', 'aria-pressed': String(key === reportRange), text: label });
    b.addEventListener('click', () => { reportRange = key; render(); });
    picker.append(b);
  });
  const node = pfCard('Practice progress', 'Knowledge, problem solving and communication', { aside: picker });
  const days = RANGES[reportRange][1];

  const done = sessionsIn(days);
  const answered = done.reduce((n, s) => n + Object.keys(s.answers).length, 0);
  const correct = done.reduce((n, s) => n + s.score.correct, 0);
  const quizLevels = done.filter((s) => s.kind === 'level' && s.score.total && s.score.correct / s.score.total >= PASS_MARK).length;
  const p = puzzleStats(days);
  const c = commStats(days);

  const row = el('div', 'pf-minis');
  row.append(miniCard('know', 'book', 'Knowledge',
    [[String(done.length), 'quizzes taken'], [String(answered), 'questions answered'], [`${percent(correct, answered)}%`, 'right'], [String(quizLevels), 'levels passed']],
    done.length ? '' : 'Nothing yet in this range', 'Take quiz', () => go('daily')));
  row.append(miniCard('solve', 'spark', 'Problem solving',
    [[String(p.tried), 'puzzles tried'], [String(p.solved), 'solved'], [String(p.firstTry), 'on the first try'], [String(p.levelsPassed), 'levels passed']],
    p.tried ? '' : 'No puzzles yet', 'Try a puzzle', () => go('puzzles')));
  const speak = c.bySkill.find((s) => s.skill === 'speak');
  row.append(miniCard('talk', 'chat', 'Communication',
    [[String(c.attempts), 'tasks done'], [c.average == null ? '—' : String(c.average), 'average score'], [String(c.levelsPassed), 'levels passed'], speak?.fillerRate != null ? [`${speak.fillerRate}%`, 'filler words'] : null].filter(Boolean),
    c.attempts ? (c.bySkill.length > 1 ? c.bySkill.map((s) => `${s.name} ${s.average}`).join(' · ') : '') : 'No tasks yet', 'Start a task', () => go('comm')));
  node.append(row);
  return node;
}

function miniCard(area, iconName, title, stats, note, linkLabel, onClick) {
  const node = el('div', 'pf-mini', { 'data-area': area });
  const head = el('div', 'pf-mini-head');
  const badge = el('span', 'pf-mini-icon');
  badge.append(icon(iconName, 16));
  head.append(badge, el('h4', '', { text: title }));
  node.append(head);
  const grid = el('div', 'pf-mini-stats');
  stats.forEach(([value, label]) => {
    const s = el('div', 'pf-mini-stat');
    s.append(el('b', '', { text: value }), el('span', '', { text: label }));
    grid.append(s);
  });
  node.append(grid);
  const foot = el('div', 'pf-mini-foot');
  if (note) foot.append(el('span', 'pf-mini-note', { text: note }));
  const link = el('button', 'pf-link', { type: 'button', text: `${linkLabel} →` });
  link.addEventListener('click', onClick);
  foot.append(link);
  node.append(foot);
  return node;
}

// --- Accuracy by topic

function renderAccuracyCard() {
  const legend = el('div', 'pf-legend');
  [['bad', 'Needs work'], ['mid', 'Improving'], ['good', 'Strong']].forEach(([cls, text]) => {
    const item = el('span', `pf-legend-item is-${cls}`);
    item.append(el('i', 'pf-swatch', { 'aria-hidden': 'true' }), document.createTextNode(text));
    legend.append(item);
  });
  const node = pfCard('Accuracy by topic', 'Weakest first · all-time answers', { aside: legend });
  const stats = topicStats(3650);
  if (!stats.length) {
    node.append(el('p', 'pf-empty', { text: 'Take a quiz and your topics show here, weakest first.' }));
    return node;
  }
  const list = el('div', 'pf-rows');
  stats.forEach((t, i) => {
    const row = el('div', 'pf-row');
    const name = el('span', 'pf-row-name');
    name.append(el('span', '', { text: t.name }));
    if (i === 0 && t.accuracy < PASS_MARK) name.append(el('span', 'pf-focus', { text: 'Focus' }));
    const cls = t.accuracy >= PASS_MARK ? 'good' : t.accuracy >= 0.5 ? 'mid' : 'bad';
    const bar = el('div', 'pf-bar');
    const fill = el('span', `is-${cls}`);
    fill.style.width = `${Math.round(t.accuracy * 100)}%`;
    bar.append(fill);
    const value = el('span', `pf-row-value is-${cls}`);
    value.append(el('b', '', { text: `${Math.round(t.accuracy * 100)}%` }), document.createTextNode(` · ${t.correct}/${t.total}`));
    row.append(name, bar, value);
    list.append(row);
  });
  node.append(list);
  return node;
}

// --- Working on now

function renderWorkCard() {
  const today = dateKey();
  const since = (days) => addDays(today, -days);
  const log = (work.log || []).filter((r) => r.id >= since(29));
  const calendar = work.calendar;
  const pill = calendar?.days?.length
    ? el('span', 'pf-pill', { text: `${calendar.total.toLocaleString()} contributions this year · on ${plural(streaks(calendar.days).activeDays, 'day')}` })
    : null;
  const node = pfCard('Working on now', 'From your GitHub · last 30 days', { aside: pill });
  if (!(work.log || []).length && !calendar) {
    const empty = el('div', 'pf-empty-block');
    empty.append(el('p', 'pf-empty', { text: 'Connect GitHub and this fills in from the repos you push to: commits, projects, pull requests and your contribution streak.' }));
    empty.append(button('Connect GitHub', 'btn btn--small', () => openSettings('github-section')));
    node.append(empty);
    return node;
  }

  const sum = (field) => log.reduce((n, r) => n + (r.stats?.[field] || 0), 0);
  const repoMap = new Map();
  log.forEach((r) => r.repos.forEach((repo) => {
    const p = repoMap.get(repo.repo) || { name: repo.repo, commits: 0, areas: new Map() };
    p.commits += repo.count;
    repo.areas?.forEach((a) => p.areas.set(a, (p.areas.get(a) || 0) + 1));
    repoMap.set(repo.repo, p);
  }));
  const doneTasks = (work.tasks || []).filter((t) => t.done && !t.deleted && t.doneAt && dateKey(new Date(t.doneAt)) >= since(29)).length;
  const learned = (work.learning || []).filter((e) => {
    const at = Math.max(e.readAt || 0, e.doneAt || 0);
    return at && dateKey(new Date(at)) >= since(29);
  }).length;
  const tiles = el('div', 'pf-tiles');
  [
    [String(sum('commits')), 'commits'],
    [String(log.filter((r) => r.stats?.commits).length), 'days with a push'],
    [String(repoMap.size), 'projects touched'],
    [String(sum('opened') + sum('merged') + sum('reviewed')), 'pull requests'],
    [String(doneTasks), 'to-dos done'],
    [String(learned), 'things read or tried'],
  ].forEach(([v, l]) => {
    const t = el('div', 'pf-tile');
    t.append(el('b', '', { text: v }), el('span', '', { text: l }));
    tiles.append(t);
  });
  node.append(tiles);

  const repos = [...repoMap.values()].sort((a, b) => b.commits - a.commits).slice(0, 3);
  if (repos.length) {
    node.append(el('span', 'pf-label', { text: 'Most active repos' }));
    const list = el('div', 'pf-repos');
    const max = repos[0].commits || 1;
    repos.forEach((p) => {
      const item = el('div', 'pf-repo');
      const head = el('div', 'pf-repo-head');
      const name = el('span', 'pf-repo-name');
      name.append(icon('folder', 15), el('b', '', { text: p.name }));
      head.append(name, el('span', 'pf-repo-count', { text: plural(p.commits, 'commit') }));
      const bar = el('div', 'pf-bar pf-bar--repo');
      const fill = el('span');
      fill.style.width = `${Math.round((p.commits / max) * 100)}%`;
      bar.append(fill);
      item.append(head, bar);
      const areas = [...p.areas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a]) => a);
      if (areas.length) {
        const chips = el('div', 'pf-areas');
        areas.forEach((a) => chips.append(el('code', 'pf-area', { text: a })));
        item.append(chips);
      }
      list.append(item);
    });
    node.append(list);
  }

  if (calendar?.days?.length) {
    const s = streaks(calendar.days);
    const foot = el('p', 'pf-streak');
    foot.append(icon('flame', 15));
    foot.append(el('b', '', { text: s.current ? `${s.current}-day` : 'No' }), document.createTextNode(` push streak${s.current ? '' : ' right now'} · longest ${plural(s.longest, 'day')}`));
    node.append(foot);
  }
  return node;
}

// --- Stack and skills

function renderStackCard() {
  const node = pfCard('Stack you ship with', 'Tools found in the repos you push to');
  const techs = stackTechs(work.stack, 12);
  if (!techs.length) {
    node.append(el('p', 'pf-empty', { text: 'Connect GitHub to see your stack.' }));
    return node;
  }
  const chips = el('div', 'pf-chips');
  techs.forEach((t) => chips.append(el('span', 'pf-chip is-stack', { text: t.name })));
  node.append(chips);
  return node;
}

function renderSkillsCard() {
  const legend = el('span', 'pf-legend-item is-good pf-tested');
  legend.append(el('i', 'pf-swatch', { 'aria-hidden': 'true' }), document.createTextNode('Tested'));
  const node = pfCard('Skills', `${plural(topics().length, 'topic')} from ${resume ? 'your resume' : 'the built-in resume'}`, { aside: legend });
  const accuracy = new Map(topicStats(3650).map((t) => [t.id, t]));
  const groups = new Map();
  topics().forEach((t) => {
    const g = t.group || 'Other';
    groups.set(g, [...(groups.get(g) || []), t]);
  });
  const ordered = [...groups.entries()].sort(([a], [b]) => {
    const ia = GROUP_ORDER.indexOf(a);
    const ib = GROUP_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  ordered.forEach(([group, items]) => {
    node.append(el('span', 'pf-label', { text: group }));
    const chips = el('div', 'pf-chips');
    items.forEach((t) => {
      const stat = accuracy.get(t.id);
      const cls = !stat ? '' : stat.accuracy >= PASS_MARK ? ' is-good' : stat.accuracy >= 0.5 ? ' is-mid' : ' is-bad';
      const chip = el('span', `pf-chip${cls}`, { title: stat ? `${stat.correct} of ${stat.total} right` : 'Not tested yet' });
      chip.append(el('span', '', { text: t.name }));
      if (stat) chip.append(el('b', '', { text: `${Math.round(stat.accuracy * 100)}%` }));
      chips.append(chip);
    });
    node.append(chips);
  });
  return node;
}

// --- Shared figures

function sessionsIn(days) {
  const from = addDays(dateKey(), -days);
  return sessions.filter((s) => s.finishedAt && s.day >= from);
}

// Per-topic accuracy over the last N days, weakest first.
function topicStats(days) {
  const from = addDays(dateKey(), -days);
  const byTopic = new Map();
  bank.forEach((q) => {
    q.asks.filter((a) => a.day >= from).forEach((a) => {
      const t = byTopic.get(q.topic) || { id: q.topic, name: q.topicName, total: 0, correct: 0 };
      t.total += 1;
      if (a.correct) t.correct += 1;
      byTopic.set(q.topic, t);
    });
  });
  return [...byTopic.values()].map((t) => ({ ...t, accuracy: t.correct / t.total })).sort((a, b) => a.accuracy - b.accuracy || b.total - a.total);
}

function quizLevelsPassed() {
  return Object.values(levels).filter((v) => v && typeof v === 'object').flatMap((v) => Object.values(v)).filter((l) => l?.best && l.best.correct / l.best.total >= PASS_MARK).length;
}

// Every day with a finished quiz or a puzzle or communication attempt.
function practiceDaysAll() {
  const days = practiceDays();
  sessions.filter((s) => s.finishedAt).forEach((s) => days.add(s.day));
  return days;
}

// Days in a row with practice; today counts if it has some, else it starts from yesterday.
function streakOf(days) {
  let day = dateKey();
  if (!days.has(day)) day = addDays(day, -1);
  let n = 0;
  while (days.has(day)) {
    n += 1;
    day = addDays(day, -1);
  }
  return n;
}

// What the rest of My Daily knows about your work, loaded at start-up.
const work = { log: null, calendar: null, stack: null, notes: null, tasks: null, learning: null };

// --- Feedback -------------------------------------------------------------------------

const FEEDBACK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'workOn', 'learnNext'],
  properties: {
    summary: { type: 'string', description: 'two or three sentences on how the practice is going, honest and specific' },
    workOn: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['topic', 'why', 'how'], properties: { topic: { type: 'string' }, why: { type: 'string' }, how: { type: 'string', description: 'one concrete thing to do today' } } },
    },
    learnNext: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['name', 'why'], properties: { name: { type: 'string', description: 'a technology, tool or practice worth learning' }, why: { type: 'string' } } },
    },
  },
};

// The dark card on the right: today's feedback, or the button to write it.
function renderFeedbackCard() {
  const node = el('section', 'pf-card pf-feedback');
  const head = el('div', 'pf-feedback-head');
  const badge = el('span', 'pf-feedback-icon');
  badge.append(icon('star', 16));
  head.append(badge, el('h3', 'pf-card-title', { text: 'Today\'s feedback' }));
  node.append(head);
  if (feedback?.day === dateKey()) {
    node.append(el('p', 'pf-feedback-text', { text: feedback.summary }));
    if (feedback.workOn?.length) {
      node.append(el('span', 'pf-label', { text: 'Work on' }));
      const list = el('div', 'pf-points');
      feedback.workOn.forEach((w) => {
        const item = el('div', 'pf-point');
        item.append(el('b', '', { text: w.topic }), el('p', '', { text: w.why }), el('p', 'pf-point-how', { text: w.how }));
        list.append(item);
      });
      node.append(list);
    }
    if (feedback.learnNext?.length) {
      node.append(el('span', 'pf-label', { text: 'Worth learning next' }));
      const list = el('div', 'pf-points');
      feedback.learnNext.forEach((w) => {
        const item = el('div', 'pf-point');
        item.append(el('b', '', { text: w.name }), el('p', '', { text: w.why }));
        list.append(item);
      });
      node.append(list);
    }
    const when = new Date(feedback.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    node.append(el('p', 'pf-feedback-when', { text: `Written at ${when}${feedback.source === 'rules' ? ' from your scores alone; set up AI in Settings for fuller feedback' : ''}.` }));
    node.append(button(busy ? 'Writing…' : 'Write it again', 'btn pf-feedback-btn pf-feedback-btn--ghost', () => writeFeedback(), { disabled: busy }));
    return node;
  }
  node.append(el('p', 'pf-feedback-text', { text: 'Once a day: where you\'re weak, what to work on today and what\'s worth learning next, from your answers, your resume and the tools in your repos.' }));
  node.append(button(busy ? 'Writing…' : 'Write today\'s feedback', 'btn pf-feedback-btn', () => writeFeedback(), { disabled: busy }));
  return node;
}

async function writeFeedback() {
  if (busy) return;
  busy = true;
  render();
  try {
    const stats = topicStats(30);
    const recentWrong = bank.filter((q) => q.asks.some((a) => a.day >= addDays(dateKey(), -7) && !a.correct)).slice(-15).map((q) => `${q.topicName}: ${q.text}`);
    const stack = (await load('workStack', null))?.techs?.map((t) => t.name) || [];
    const week = sessionsIn(6);
    const prompt = `Topics on the resume: ${topics().map((t) => t.name).join(', ')}.\n`
      + `Tools in the repos pushed to recently: ${stack.join(', ') || 'unknown'}.\n`
      + `Last 7 days: ${plural(week.length, 'quiz', 'quizzes')}, ${week.reduce((n, s) => n + s.score.correct, 0)} of ${week.reduce((n, s) => n + Object.keys(s.answers).length, 0)} right.\n`
      + `Accuracy by topic over 30 days (weakest first):\n${stats.map((t) => `- ${t.name}: ${Math.round(t.accuracy * 100)}% of ${t.total}`).join('\n') || '- nothing answered yet'}\n`
      + `Questions missed this week:\n${recentWrong.map((t) => `- ${t}`).join('\n') || '- none'}\n`
      + `Levels passed: ${Object.values(levels).filter((v) => v && typeof v === 'object').flatMap((v) => Object.values(v)).filter((l) => l?.best && l.best.correct / l.best.total >= PASS_MARK).length}.\n`
      + practiceNotes();
    const instructions = 'You coach a full-stack developer preparing for job interviews: technical knowledge, problem solving and professional communication in English. Be direct and specific, no flattery. '
      + 'Name 2-4 things to work on (a topic, problem-solving habit or communication habit), each with one concrete thing to do today. '
      + 'Then name 2-4 technologies, tools or practices worth learning next, picked for this person: things that are new or growing in their field, or gaps next to what they already use. Say why in one line.';
    let result;
    let source = 'ai';
    try {
      result = await askJson({ instructions, prompt, schema: FEEDBACK_SCHEMA, maxTokens: 2000 });
    } catch (error) {
      if (!(error instanceof AiUnavailable)) throw error;
      result = feedbackByRules(stats, week);
      source = 'rules';
    }
    feedback = { day: dateKey(), at: Date.now(), source, summary: result.summary, workOn: result.workOn || [], learnNext: result.learnNext || [] };
    await save(FEEDBACK_KEY, feedback);
  } catch (error) {
    reportAiError(error);
  } finally {
    busy = false;
    render();
  }
}

function feedbackByRules(stats, week) {
  const weak = stats.filter((t) => t.total >= 3 && t.accuracy < PASS_MARK).slice(0, 3);
  const strong = stats.filter((t) => t.total >= 3 && t.accuracy >= 0.85).slice(-2);
  const summary = !stats.length
    ? 'No answers yet, so there\'s nothing to judge. Take today\'s quiz.'
    : `${plural(week.length, 'quiz', 'quizzes')} this week. ${weak.length ? `Weakest: ${weak.map((t) => t.name).join(', ')}.` : 'No topic under 70% yet.'}${strong.length ? ` Strong on ${strong.map((t) => t.name).join(' and ')}.` : ''}`;
  return {
    summary,
    workOn: weak.map((t) => ({ topic: t.name, why: `${Math.round(t.accuracy * 100)}% right over ${t.total} questions.`, how: `Open ${t.name} in Levels and do the next level today.` })),
    learnNext: [],
  };
}

// --- Resume ---------------------------------------------------------------------------

const RESUME_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'title', 'summary', 'topics'],
  properties: {
    name: { type: 'string', description: 'the person\'s name as written on the resume' },
    title: { type: 'string', description: 'their job title in two to four words, e.g. "Full-stack developer"' },
    summary: { type: 'string', description: 'five to eight lines on their experience: years, roles, the main projects and what each was built with, so an interviewer could ask about their actual work' },
    topics: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'group'],
        properties: {
          name: { type: 'string', description: 'a skill, technology, tool or area as an interviewer would name it, e.g. "React", "PostgreSQL", "REST API design", "System design"' },
          group: { type: 'string', description: 'Languages, Frontend, Backend, Databases, Cloud & DevOps, AI, Mobile, Practices, or Other' },
        },
      },
    },
  },
};

function initResumeDialog() {
  const dialog = $('resume-dialog');
  $('resume-close').addEventListener('click', () => dialog.close());
  $('resume-cancel').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  $('resume-file').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    if (!/\.pdf$/i.test(file.name)) {
      $('resume-text').value = await file.text();
      $('resume-file-name').textContent = `${file.name}: text loaded below.`;
    } else {
      $('resume-file-name').textContent = `${file.name} (PDF): read by the AI when you click Read resume.`;
    }
  });
  $('resume-form').addEventListener('submit', readResume);
  $('resume-reread').addEventListener('click', (event) => readResume(event, { again: true }));
  $('resume-clear').addEventListener('click', async () => {
    if (!confirm('Forget the uploaded resume and go back to the built-in topics? Your quizzes and scores stay.')) return;
    resume = null;
    await save(RESUME_KEY, null);
    dialog.close();
    render();
  });
}

async function openResumeDialog() {
  const dialog = $('resume-dialog');
  $('resume-text').value = '';
  $('resume-file').value = '';
  $('resume-file-name').textContent = '';
  $('resume-clear').hidden = !resume;
  $('resume-saved').hidden = !resume;
  $('resume-reread').hidden = !(resume?.pdf || resume?.text);
  if (resume) {
    const when = new Date(resume.savedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    const what = resume.pdf ? resume.pdf.name : resume.text ? 'pasted text' : 'topics only';
    $('resume-saved').textContent = `Saved: ${resume.name} (${what}), read on ${when}, ${plural(resume.topics.length, 'topic')}. It stays until you upload another. To replace it, choose a new file or paste new text below.`;
  }
  const source = await aiSource();
  $('resume-ai-note').textContent = source === 'openrouter'
    ? 'A PDF is read by Claude through OpenRouter. You can paste the text instead.'
    : source === 'on-device'
      ? 'Chrome\'s on-device AI can read pasted text, not a PDF. For PDFs, add an OpenRouter key in Settings.'
      : 'No AI is set up, so the resume can\'t be read yet. Add an OpenRouter key in Settings.';
  renderResumeTopics();
  dialog.showModal();
}

function renderResumeTopics() {
  const list = $('resume-topics');
  const items = resume?.topics || [];
  list.replaceChildren(...items.map((t) => {
    const chip = el('span', 'chip q-resume-chip', { text: t.name });
    const remove = el('button', 'icon-btn icon-btn--small', { type: 'button', 'aria-label': `Remove ${t.name}` });
    remove.append(icon('close', 12));
    remove.addEventListener('click', async () => {
      resume.topics = resume.topics.filter((x) => x.id !== t.id);
      await save(RESUME_KEY, resume);
      renderResumeTopics();
      render();
    });
    chip.append(remove);
    return chip;
  }));
  $('resume-topics-wrap').hidden = !items.length;
}

// Reads the file or text in the dialog. With `again`, re-reads the saved one
// (for example after the AI is set up, or to refresh the topic list).
async function readResume(event, { again = false } = {}) {
  event.preventDefault();
  const file = again ? null : $('resume-file').files[0];
  const text = again ? (resume?.text || '') : $('resume-text').value.trim();
  const isPdf = again ? Boolean(resume?.pdf) : Boolean(file && /\.pdf$/i.test(file.name));
  if (!isPdf && text.length < 80) { toast('Paste the resume text, or choose a PDF.'); return; }
  const button = again ? $('resume-reread') : $('resume-read');
  button.disabled = true;
  button.textContent = 'Reading…';
  try {
    const pdf = again ? resume.pdf : isPdf ? { name: file.name, base64: await toBase64(file) } : null;
    const instructions = 'You read a developer\'s resume and list every skill, technology, tool and area it shows, as topics an interviewer could ask about. '
      + 'Include languages, frameworks, databases, cloud and DevOps tools, AI work, mobile, and practices such as testing or system design when the resume shows them. '
      + 'Merge close variants (React and React.js). 10 to 40 topics.';
    const data = await askJson({ instructions, prompt: pdf ? 'The resume is attached.' : `The resume:\n\n${text}`, schema: RESUME_SCHEMA, pdf, maxTokens: 3000 });
    const seen = new Set();
    const list = (data.topics || []).map((t) => ({ id: slug(t.name), name: String(t.name).trim(), group: t.group || 'Other' })).filter((t) => t.name && !seen.has(t.id) && seen.add(t.id));
    if (!list.length) throw new Error('No topics were found in the resume.');
    // The file (or text) is kept too, so it can be read again without uploading.
    resume = {
      source: pdf ? 'pdf' : 'text',
      name: data.name || pdf?.name || 'your resume',
      title: String(data.title || '').trim(),
      summary: String(data.summary || '').trim(),
      topics: list,
      pdf: pdf || null,
      text: pdf ? null : text,
      savedAt: Date.now(),
    };
    await save(RESUME_KEY, resume);
    toast(`Read ${resume.name}: ${plural(list.length, 'topic')}. Saved until you upload another.`);
    $('resume-dialog').close();
    render();
  } catch (error) {
    reportAiError(error);
  } finally {
    button.disabled = false;
    button.textContent = again ? 'Read again' : 'Read resume';
  }
}

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'topic';
}

// --- Helpers --------------------------------------------------------------------------

function reportAiError(error) {
  if (error instanceof AiUnavailable) {
    toast(error.message, { label: 'Settings', run: () => openSettings('ai-section') });
  } else {
    toast(error.message || 'Something went wrong.');
  }
}

function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// For backups.
export function exportQuestions() {
  return { resume, bank, sessions, levels, ...exportPractice() };
}
