// Puzzles and Communication, the two practice sections inside the Questions
// tab. Both work the same way: one new set a day, and 40 levels that open one
// a day (the same count as the quiz levels). Unlike the quizzes, most answers
// here are written or spoken, so the AI marks them and says what was good and
// what to change. Without AI, the answer is shown and you mark yourself.
//
//   Puzzles        One new problem a day: a DSA question, a logic puzzle or an
//                  estimation, the kind an interviewer gives to see how you
//                  think. Levels have five puzzles each and get harder.
//   Communication  Five tasks a day: a grammar question, a message to rewrite
//                  professionally, a work situation to reply to, and one to
//                  answer out loud (the microphone transcribes it; filler words
//                  and pace are counted here, and the AI judges the content).
//                  Levels go from clear sentences to client conversations,
//                  leadership and interviews.
//
// Attempts are kept locally, like everything else, and feed the Report and
// the daily Feedback in questions.js.
import { load, save } from './store.js';
import { dateKey, addDays, parseKey } from './dates.js';
import { askJson, aiSource, AiUnavailable } from './ai.js';
import { openSettings } from './settings.js';
import { explainChoice, renderLesson } from './teach.js';
import { el, toast, plural } from './ui.js';

const PUZZLE_KEY = 'puzzleData';
const COMM_KEY = 'commData';
export const PRACTICE_LEVELS = 40;
const LEVEL_SIZE = 5;
const PASS_SCORE = 70;
const FILLERS = /\b(um+|uh+|erm|hmm|like|basically|actually|literally|you know|sort of|kind of|i mean|right\?)\b/gi;

const $ = (id) => document.getElementById(id);
const percent = (n, total) => (total ? Math.round((n / total) * 100) : 0);

// { daily: { [day]: ids }, levels: { [n]: { ids, generatedAt } }, items: { id: item }, attempts: [] }
let puzzles = null;
let comm = null;
let rerender = () => {};
let busy = false;
let openItem = null; // { section, id, mode: 'daily' | 'level', level }
let recorder = null; // the active speech recognition

export async function initPractice({ rerender: fn }) {
  rerender = fn;
  [puzzles, comm] = await Promise.all([load(PUZZLE_KEY, null), load(COMM_KEY, null)]);
  puzzles ||= empty();
  comm ||= empty();
}

function empty() {
  return { daily: {}, levels: {}, items: {}, attempts: [] };
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

function reportAiError(error) {
  if (error instanceof AiUnavailable) toast(error.message, { label: 'Settings', run: () => openSettings('ai-section') });
  else toast(error.message || 'Something went wrong.');
}

// --- Shared: daily set and levels -------------------------------------------------------

const SECTIONS = {
  puzzle: {
    get data() { return puzzles; },
    key: PUZZLE_KEY,
    dailyCount: 1,
    title: 'Puzzles',
    dailyIntro: 'One new problem a day, the kind an interviewer gives to see how you think: a coding problem, a logic puzzle or an estimation. Write your approach, or the answer, and the AI marks it.',
    levelLine: 'Each level has five puzzles and gets harder. A level is passed when all five are solved.',
  },
  comm: {
    get data() { return comm; },
    key: COMM_KEY,
    dailyCount: 5,
    title: 'Communication',
    dailyIntro: 'Five tasks a day: a grammar question, a message to make professional, a work situation to reply to, and one to answer out loud. Each is scored out of 100 with what to change.',
    levelLine: 'Each level has five tasks. Early levels are clear sentences and short messages; later ones are client conversations, difficult news, leadership and interviews. An average of 70 passes a level.',
  },
};

function bands(section, n) {
  if (section === 'puzzle') {
    if (n <= 8) return 'warm-up: arrays, strings, simple counting, easy logic puzzles, mental estimation';
    if (n <= 16) return 'easy interview: hash maps, two pointers, sorting, simple recursion, reasoning puzzles with a trick';
    if (n <= 24) return 'medium interview: trees, graphs, binary search, dynamic programming basics, probability puzzles, system estimation';
    if (n <= 32) return 'hard interview: harder dynamic programming, graph algorithms, design trade-offs, tricky logic puzzles';
    return 'expert: problems a top company asks in final rounds, with several steps and edge cases';
  }
  if (n <= 8) return 'clear sentences: grammar, tense, articles, punctuation, short plain messages';
  if (n <= 16) return 'professional basics: emails, standup updates, asking for help, saying no politely, replying to a client';
  if (n <= 24) return 'explaining and discussing: explaining technical things to non-technical people, meetings, giving and receiving feedback, disagreeing respectfully';
  if (n <= 32) return 'hard conversations: clients who are unhappy, missed deadlines, pushing back on scope, negotiating, delivering bad news';
  return 'leadership and interviews: presenting, persuading, senior-level interview answers, handling conflict in a team';
}

// A level's difficulty, with a reminder that it should feel harder than four levels below.
function difficulty(section, n) {
  return `level ${n} of ${PRACTICE_LEVELS} (${bands(section, n)}), clearly harder than level ${Math.max(1, n - 4)}`;
}

async function persist(section) {
  await save(SECTIONS[section].key, SECTIONS[section].data);
}

function todaysIds(section) {
  return SECTIONS[section].data.daily[dateKey()] || null;
}

function attemptsFor(section, id) {
  return SECTIONS[section].data.attempts.filter((a) => a.itemId === id);
}

function solved(section, id) {
  return attemptsFor(section, id).some((a) => a.correct);
}

function bestScore(section, id) {
  return Math.max(0, ...attemptsFor(section, id).map((a) => a.score || 0));
}

async function ensureDaily(section) {
  if (todaysIds(section)) return;
  const d = SECTIONS[section].data;
  const n = suggestedLevel(section);
  const items = section === 'puzzle'
    ? await writePuzzles({ count: 1, difficulty: `${bands('puzzle', n)}; one self-contained problem` })
    : await writeCommTasks({ count: 5, difficulty: bands('comm', n), mix: true });
  items.forEach((item) => { d.items[item.id] = item; });
  d.daily[dateKey()] = items.map((i) => i.id);
  await persist(section);
}

// The daily set follows how far you've got: just above the highest level passed.
function suggestedLevel(section) {
  const d = SECTIONS[section].data;
  const passed = Object.keys(d.levels).map(Number).filter((n) => levelPassed(section, n));
  return Math.min(PRACTICE_LEVELS, (passed.length ? Math.max(...passed) : 0) + 1);
}

function levelPassed(section, n) {
  const info = SECTIONS[section].data.levels[n];
  if (!info) return false;
  if (section === 'puzzle') return info.ids.every((id) => solved('puzzle', id));
  const scores = info.ids.map((id) => bestScore('comm', id));
  return info.ids.every((id) => attemptsFor('comm', id).length) && scores.reduce((a, b) => a + b, 0) / scores.length >= PASS_SCORE;
}

async function ensureLevel(section, n) {
  const d = SECTIONS[section].data;
  if (d.levels[n]) return;
  const items = section === 'puzzle'
    ? await writePuzzles({ count: LEVEL_SIZE, difficulty: difficulty('puzzle', n) })
    : await writeCommTasks({ count: LEVEL_SIZE, difficulty: difficulty('comm', n), mix: true });
  items.forEach((item) => { d.items[item.id] = item; });
  d.levels[n] = { ids: items.map((i) => i.id), generatedAt: Date.now() };
  await persist(section);
}

// --- Rendering a section ------------------------------------------------------------------

// `open` is how many levels are open today (from questions.js).
export function renderPractice(section, { open }) {
  const def = SECTIONS[section];
  const wrap = el('div', 'q-stack');
  if (openItem?.section === section) {
    const item = def.data.items[openItem.id];
    if (item) {
      wrap.append(renderItem(section, item));
      return wrap;
    }
    openItem = null;
  }

  // Today
  const ids = todaysIds(section);
  if (ids) {
    const list = el('div', 'q-tasks');
    ids.forEach((id, i) => list.append(taskRow(section, def.data.items[id], i, { mode: 'daily' })));
    const done = ids.filter((id) => attemptsFor(section, id).length).length;
    wrap.append(card(`Today: ${done} of ${ids.length} done`, list));
  } else {
    wrap.append(card('Today', el('p', 'q-text', { text: def.dailyIntro }),
      button(busy ? 'Writing…' : section === 'puzzle' ? 'Get today\'s puzzle' : 'Get today\'s tasks', 'btn--primary', () => run(() => ensureDaily(section)), { disabled: busy })));
  }

  // Levels
  const grid = el('div', 'q-levels');
  for (let n = 1; n <= PRACTICE_LEVELS; n += 1) {
    const info = def.data.levels[n];
    const passed = levelPassed(section, n);
    const started = info && info.ids.some((id) => attemptsFor(section, id).length);
    const locked = n > open;
    const tile = el('button', `q-level${locked ? ' is-locked' : ''}${passed ? ' is-passed' : ''}${started && !passed ? ' is-tried' : ''}`, {
      type: 'button', disabled: locked || busy, title: locked ? `Opens in ${plural(n - open, 'day')}` : passed ? 'Passed' : started ? 'Started' : 'Not tried yet',
    });
    let note = locked ? '🔒' : bands(section, n).split(':')[0];
    if (info && !locked) {
      note = section === 'puzzle'
        ? `${info.ids.filter((id) => solved('puzzle', id)).length}/${info.ids.length}`
        : `${Math.round(info.ids.reduce((s, id) => s + bestScore('comm', id), 0) / info.ids.length)}`;
    }
    tile.append(el('span', 'q-level-number', { text: String(n) }), el('span', 'q-level-note', { text: note }));
    if (!locked) tile.addEventListener('click', () => run(() => openLevel(section, n)));
    grid.append(tile);
  }
  wrap.append(card(`Levels: ${open} of ${PRACTICE_LEVELS} open, one more each day`, grid, el('p', 'q-hint', { text: `${def.levelLine}${busy ? ' Writing…' : ''}` })));

  // A level's items, once opened
  if (openLevelN?.section === section) {
    const info = def.data.levels[openLevelN.n];
    if (info) {
      const list = el('div', 'q-tasks');
      info.ids.forEach((id, i) => list.append(taskRow(section, def.data.items[id], i, { mode: 'level', level: openLevelN.n })));
      wrap.append(card(`Level ${openLevelN.n}${levelPassed(section, openLevelN.n) ? ' · passed' : ''}`, list));
    }
  }
  return wrap;
}

let openLevelN = null; // { section, n }

async function openLevel(section, n) {
  await ensureLevel(section, n);
  openLevelN = { section, n };
}

function taskRow(section, item, i, { mode, level = null }) {
  const row = el('button', 'q-task', { type: 'button' });
  const attempts = attemptsFor(section, item.id);
  const last = attempts.at(-1);
  const status = !last ? 'Not done' : section === 'puzzle' ? (solved('puzzle', item.id) ? 'Solved' : 'Not yet') : `Best ${bestScore('comm', item.id)}`;
  row.append(
    el('span', 'q-task-kind', { text: section === 'puzzle' ? item.kind : SKILL_NAMES[item.skill] || item.skill }),
    el('span', 'q-task-title', { text: item.title }),
    el('span', `q-task-status${(section === 'puzzle' ? solved('puzzle', item.id) : bestScore('comm', item.id) >= PASS_SCORE) ? ' is-good' : ''}`, { text: status }),
  );
  row.addEventListener('click', () => { openItem = { section, id: item.id, mode, level }; rerender(); });
  return row;
}

async function run(job) {
  if (busy) return;
  busy = true;
  rerender();
  try {
    await job();
  } catch (error) {
    reportAiError(error);
  } finally {
    busy = false;
    rerender();
  }
}

// --- One item: the problem or task, the answer box, the marking -------------------------------

function renderItem(section, item) {
  const body = el('div', 'q-question');
  const head = el('div', 'q-quiz-head');
  head.append(el('span', 'q-quiz-title', { text: item.title }));
  head.append(button('Back', 'btn--ghost btn--small', () => { stopRecording(); openItem = null; rerender(); }));
  body.append(head);
  body.append(el('span', 'q-topic-tag', { text: section === 'puzzle' ? item.kind : SKILL_NAMES[item.skill] || item.skill }));
  body.append(el('p', 'q-question-text', { text: item.prompt }));
  if (item.given) body.append(el('pre', 'q-given', { text: item.given }));

  const attempts = attemptsFor(section, item.id);
  const last = attempts.at(-1);
  const isDone = section === 'puzzle' ? solved('puzzle', item.id) : Boolean(last);

  if (item.skill === 'grammar') {
    body.append(renderChoice(section, item, last));
  } else if (item.skill === 'speak') {
    body.append(renderSpeak(section, item, last));
  } else {
    body.append(renderWritten(section, item, last));
  }
  if (last) body.append(renderMark(section, item, last));
  if (isDone && item.solution && item.skill !== 'grammar') {
    const details = el('details', 'q-solution');
    details.append(el('summary', '', { text: section === 'puzzle' ? 'A good solution' : 'A strong answer' }), el('p', 'q-explanation', { text: item.solution }));
    body.append(details);
  }
  if (item.hints?.length && !isDone) {
    const details = el('details', 'q-solution');
    details.append(el('summary', '', { text: plural(item.hints.length, 'hint') }), ...item.hints.map((h) => el('p', 'q-explanation', { text: h })));
    body.append(details);
  }
  return card('', body);
}

function renderChoice(section, item, last) {
  const list = el('div', 'q-options', { role: 'group' });
  const inputs = [];
  item.options.forEach((option, i) => {
    const label = el('label', 'q-option');
    const input = el('input', '', { type: 'radio', name: `c-${item.id}`, value: String(i) });
    if (last) {
      input.disabled = true;
      input.checked = last.chosen === i;
      if (i === item.answer) label.classList.add('is-right');
      else if (last.chosen === i) label.classList.add('is-wrong');
    }
    inputs.push(input);
    label.append(input, el('span', '', { text: option }));
    list.append(label);
  });
  const wrap = el('div', 'q-stack');
  wrap.append(list);
  if (!last) {
    wrap.append(button('Check', 'btn--primary', async () => {
      const chosen = inputs.findIndex((i) => i.checked);
      if (chosen < 0) { toast('Pick an answer first.'); return; }
      const correct = chosen === item.answer;
      await recordAttempt(section, item, { chosen, correct, score: correct ? 100 : 0, feedback: item.explanation || '', source: 'rules' });
      rerender();
      if (!correct && !item.lesson) {
        // Teach it: written once, kept on the task.
        explainChoice({ question: item.prompt, options: item.options, answers: [item.answer], chosen, topic: 'English grammar and professional writing' })
          .then((lesson) => { item.lesson = lesson; return persist(section); })
          .catch((error) => { item.lessonFailed = error.message; })
          .finally(rerender);
      }
    }));
  }
  return wrap;
}

function renderWritten(section, item, last) {
  const wrap = el('div', 'q-stack');
  const box = el('textarea', 'field note-text-field q-answer', { rows: item.answerType === 'code' ? 10 : 6, placeholder: item.answerType === 'code' ? 'Your approach, then the code or pseudocode…' : item.answerType === 'short' ? 'Your answer, with a line on why' : 'Your answer…', 'aria-label': 'Your answer', spellcheck: item.answerType === 'code' ? 'false' : 'true' });
  if (last) box.value = last.answer || '';
  wrap.append(box);
  const actions = el('div', 'q-actions');
  const canRetry = !last || !(section === 'puzzle' ? last.correct : false);
  if (canRetry) {
    actions.append(button(last ? 'Mark again' : 'Check my answer', 'btn--primary', () => {
      const answer = box.value.trim();
      if (answer.length < 3) { toast('Write your answer first.'); return; }
      run(() => markAnswer(section, item, { answer }));
    }, { disabled: busy }));
  }
  wrap.append(actions);
  return wrap;
}

function renderSpeak(section, item, last) {
  const wrap = el('div', 'q-stack');
  wrap.append(el('p', 'q-hint', { text: 'Click Record, answer out loud as you would in an interview (aim for 30-90 seconds), then Stop. The words are transcribed here; nothing is recorded or stored as audio. You can also type.' }));
  const box = el('textarea', 'field note-text-field q-answer', { rows: 6, placeholder: 'Your answer appears here as you speak…', 'aria-label': 'Transcript' });
  if (last) box.value = last.answer || '';
  const status = el('p', 'q-hint q-rec-status');
  const actions = el('div', 'q-actions');
  const supported = Boolean(globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition);
  let startedAt = null;
  const recordButton = button('Record', 'btn', () => {
    if (recorder) {
      stopRecording();
      recordButton.textContent = 'Record';
      status.textContent = `Stopped after ${Math.round((Date.now() - startedAt) / 1000)} seconds.`;
      return;
    }
    startedAt = Date.now();
    startRecording(box, status, () => { recordButton.textContent = 'Record'; });
    recordButton.textContent = 'Stop';
  }, { disabled: !supported });
  if (!supported) status.textContent = 'Speech recognition isn\'t available in this Chrome, so type your answer instead.';
  actions.append(recordButton);
  actions.append(button(last ? 'Mark again' : 'Mark my answer', 'btn--primary', () => {
    stopRecording();
    recordButton.textContent = 'Record';
    const answer = box.value.trim();
    if (answer.split(/\s+/).length < 8) { toast('Say or write a bit more first.'); return; }
    const seconds = startedAt ? Math.round((Date.now() - startedAt) / 1000) : null;
    run(() => markAnswer(section, item, { answer, seconds, spoken: Boolean(startedAt) }));
  }, { disabled: busy }));
  wrap.append(box, status, actions);
  return wrap;
}

function startRecording(box, status, onEnd) {
  const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  const rec = new SR();
  rec.lang = 'en-IN';
  rec.continuous = true;
  rec.interimResults = true;
  const before = box.value ? `${box.value.trim()} ` : '';
  let finals = '';
  rec.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const r = event.results[i];
      if (r.isFinal) finals += `${r[0].transcript.trim()} `;
      else interim += r[0].transcript;
    }
    box.value = `${before}${finals}${interim}`.trim();
  };
  rec.onerror = (event) => {
    status.textContent = event.error === 'not-allowed'
      ? 'Chrome needs microphone access. Click the camera/microphone icon in the address bar and allow it, then try again.'
      : `Recording stopped: ${event.error}.`;
  };
  rec.onend = () => { if (recorder === rec) recorder = null; onEnd?.(); };
  recorder = rec;
  status.textContent = 'Listening…';
  rec.start();
}

function stopRecording() {
  if (!recorder) return;
  try { recorder.stop(); } catch { /* already stopped */ }
  recorder = null;
}

// --- Marking --------------------------------------------------------------------------------

const MARK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['correct', 'score', 'feedback', 'better', 'strengths', 'fixes', 'lesson'],
  properties: {
    correct: { type: 'boolean', description: 'for puzzles: the answer or approach is right; for communication: good enough to use as is' },
    score: { type: 'integer', description: '0 to 100' },
    feedback: { type: 'string', description: 'two to four sentences, direct, specific to this answer' },
    better: { type: 'string', description: 'for communication: a strong version of the answer in the person\'s own voice; for puzzles: the key idea they missed, or empty if right' },
    strengths: { type: 'array', items: { type: 'string' }, description: 'one to three short points' },
    fixes: { type: 'array', items: { type: 'string' }, description: 'one to three short points: what to change' },
    lesson: {
      type: 'object',
      additionalProperties: false,
      required: ['answer', 'why', 'example', 'analogy', 'remember'],
      description: 'when the answer is not correct, teach the idea in easy everyday English; when it is correct, leave every field empty',
      properties: {
        answer: { type: 'string', description: 'the key idea or right approach in one plain sentence' },
        why: { type: 'string', description: 'why it works and where the answer went wrong, two to four short sentences' },
        example: { type: 'string', description: 'a small concrete example, or a short code snippet for coding problems' },
        analogy: { type: 'string', description: 'an everyday analogy that makes it stick' },
        remember: { type: 'string', description: 'one line to remember it by' },
      },
    },
  },
};

async function markAnswer(section, item, { answer, seconds = null, spoken = false }) {
  const speech = item.skill === 'speak' ? speechStats(answer, seconds) : null;
  let mark;
  let source = 'ai';
  try {
    const instructions = section === 'puzzle'
      ? 'You are a fair interviewer marking a candidate\'s answer to a problem. Judge the reasoning and the answer against the reference solution; a different but correct approach is fine. Be direct and specific. Point out the key idea they missed, if any, and any complexity or edge-case mistakes.'
      : 'You coach professional communication in English for a software developer. Mark the answer for clarity, grammar, tone, structure and whether it does the job in the situation. Be direct, specific and encouraging without flattery. In "better", rewrite their answer as a strong version that keeps their meaning and sounds like them, not like a template.';
    const prompt = `Task: ${item.title}\n${item.prompt}\n${item.given ? `\nGiven:\n${item.given}\n` : ''}`
      + `${item.solution ? `\nReference solution or guidance (don't reveal it word for word):\n${item.solution}\n` : ''}`
      + `${item.rubric ? `\nWhat a good answer has:\n${item.rubric}\n` : ''}`
      + `\nThe candidate's answer${spoken ? ' (spoken, transcribed, so ignore punctuation and small transcription slips)' : ''}:\n${answer}\n`
      + (speech ? `\nSpeaking stats: ${speech.words} words${seconds ? ` in ${seconds} seconds (${speech.wpm} words per minute)` : ''}, ${plural(speech.fillers, 'filler word')}.` : '');
    mark = await askJson({ instructions, prompt, schema: MARK_SCHEMA, maxTokens: 1500 });
  } catch (error) {
    if (!(error instanceof AiUnavailable)) throw error;
    mark = null;
    source = 'self';
  }
  if (mark) {
    const lesson = !mark.correct && mark.lesson?.answer ? mark.lesson : null;
    await recordAttempt(section, item, { answer, correct: Boolean(mark.correct), score: clamp(mark.score), feedback: mark.feedback, better: mark.better, strengths: mark.strengths || [], fixes: mark.fixes || [], lesson, speech, seconds, source });
    return;
  }
  // No AI: show the solution and let them mark it.
  await recordAttempt(section, item, { answer, correct: null, score: null, feedback: '', speech, seconds, source, pending: true });
}

function clamp(n) {
  return Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
}

function speechStats(text, seconds) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const fillers = (text.match(FILLERS) || []).length;
  return { words, fillers, fillerRate: words ? Math.round((fillers / words) * 100) : 0, wpm: seconds ? Math.round((words / seconds) * 60) : null };
}

async function recordAttempt(section, item, fields) {
  const d = SECTIONS[section].data;
  d.attempts.push({
    id: crypto.randomUUID(),
    itemId: item.id,
    day: dateKey(),
    at: Date.now(),
    kind: openItem?.mode || 'daily',
    level: openItem?.level || null,
    skill: item.skill || item.kind,
    ...fields,
  });
  await persist(section);
}

function renderMark(section, item, last) {
  const wrap = el('div', 'q-mark');
  if (last.pending) {
    wrap.append(el('p', 'q-hint', { text: 'No AI is set up to mark this, so compare with the solution and mark it yourself.' }));
    if (item.solution) wrap.append(el('p', 'q-explanation', { text: item.solution }));
    const actions = el('div', 'q-actions');
    const mark = (correct) => async () => {
      Object.assign(last, { pending: false, correct, score: correct ? 100 : 40, source: 'self' });
      await persist(section);
      rerender();
    };
    actions.append(button('I got it', 'btn--primary', mark(true)), button('Not yet', 'btn', mark(false)));
    wrap.append(actions);
    return wrap;
  }
  const verdict = el('p', `q-verdict ${last.correct ? 'is-good' : 'is-bad'}`, { text: section === 'puzzle' ? (last.correct ? 'Solved.' : 'Not yet.') : `${last.score} / 100${last.correct ? ' · good to send' : ''}` });
  wrap.append(verdict);
  if (last.feedback) wrap.append(el('p', 'q-text', { text: last.feedback }));
  if (!last.correct) {
    const lesson = last.lesson || item.lesson || null;
    if (lesson) wrap.append(renderLesson(lesson));
    else if (item.skill === 'grammar') wrap.append(renderLesson(item.lessonFailed ? null : 'loading', { fallback: item.lessonFailed }));
  }
  if (last.speech) {
    wrap.append(el('p', 'q-hint', { text: `${last.speech.words} words${last.speech.wpm ? `, ${last.speech.wpm} per minute (120-160 is a good interview pace)` : ''}, ${plural(last.speech.fillers, 'filler word')}${last.speech.fillerRate >= 5 ? ': try pausing instead' : ''}.` }));
  }
  if (last.strengths?.length || last.fixes?.length) {
    const cols = el('div', 'q-mark-cols');
    if (last.strengths?.length) cols.append(pointList('Good', last.strengths));
    if (last.fixes?.length) cols.append(pointList('Change', last.fixes));
    wrap.append(cols);
  }
  if (last.better && !last.correct) {
    const details = el('details', 'q-solution', { open: section === 'comm' ? '' : null });
    details.append(el('summary', '', { text: section === 'puzzle' ? 'What was missing' : 'A stronger version' }), el('p', 'q-explanation q-better', { text: last.better }));
    wrap.append(details);
  }
  return wrap;
}

function pointList(title, points) {
  const node = el('div', 'q-point');
  node.append(el('b', '', { text: title }));
  const ul = el('ul', 'q-ul');
  points.forEach((p) => ul.append(el('li', '', { text: p })));
  node.append(ul);
  return node;
}

// --- Writing puzzles and tasks ----------------------------------------------------------------

const PUZZLE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['puzzles'],
  properties: {
    puzzles: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'kind', 'problem', 'given', 'answerType', 'hints', 'solution', 'rubric'],
        properties: {
          title: { type: 'string', description: 'short, like "Two sum" or "The three light switches"' },
          kind: { type: 'string', description: 'coding, logic, estimation or probability' },
          problem: { type: 'string', description: 'the full problem statement, self-contained' },
          given: { type: 'string', description: 'example input and output, or a small table; empty if none' },
          answerType: { type: 'string', description: 'code, short or explain' },
          hints: { type: 'array', items: { type: 'string' }, description: 'two hints, the first small' },
          solution: { type: 'string', description: 'the answer and the approach, with time and space complexity for coding problems' },
          rubric: { type: 'string', description: 'one line: what a correct answer must contain' },
        },
      },
    },
  },
};

async function writePuzzles({ count, difficulty: level }) {
  const recent = Object.values(puzzles.items).slice(-60).map((p) => p.title);
  const instructions = 'You write interview problems for a full-stack developer practising problem solving: coding problems (data structures and algorithms), logic puzzles, estimation and probability questions. '
    + 'Each is self-contained and solvable in text in 5-15 minutes. Mix kinds. Never repeat a problem from the list of earlier titles, and prefer less famous problems over the classics everyone has memorised.';
  const prompt = `Write exactly ${count} problem${count === 1 ? '' : 's'}.\nDifficulty: ${level}.\n${recent.length ? `Earlier titles, don't repeat:\n${recent.map((t) => `- ${t}`).join('\n')}` : ''}`;
  const data = await askJson({ instructions, prompt, schema: PUZZLE_SCHEMA, maxTokens: 6000 });
  const list = (data.puzzles || []).filter((p) => p?.title && p.problem).map((p) => ({
    id: crypto.randomUUID(),
    title: String(p.title).trim(),
    kind: String(p.kind || 'logic').toLowerCase(),
    prompt: String(p.problem).trim(),
    given: String(p.given || '').trim() || null,
    answerType: ['code', 'short', 'explain'].includes(p.answerType) ? p.answerType : 'explain',
    hints: (p.hints || []).map(String).filter(Boolean).slice(0, 2),
    solution: String(p.solution || '').trim(),
    rubric: String(p.rubric || '').trim(),
    createdAt: Date.now(),
  }));
  if (!list.length) throw new Error('The AI sent no usable puzzles. Try again.');
  return list.slice(0, count);
}

const SKILL_NAMES = { grammar: 'Grammar', rewrite: 'Writing', scenario: 'Situation', speak: 'Speaking' };

const COMM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tasks'],
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['skill', 'title', 'prompt', 'given', 'options', 'answer', 'explanation', 'solution', 'rubric'],
        properties: {
          skill: { type: 'string', description: 'grammar, rewrite, scenario or speak' },
          title: { type: 'string', description: 'short' },
          prompt: { type: 'string', description: 'the task. grammar: a question with options; rewrite: what to rewrite and for whom; scenario: the work situation and who they are replying to; speak: an interview or meeting question to answer out loud' },
          given: { type: 'string', description: 'the text to rewrite, or the message they are replying to; empty otherwise' },
          options: { type: 'array', items: { type: 'string' }, description: 'grammar only: 4 options, one right; empty for other skills' },
          answer: { type: 'integer', description: 'grammar only: index of the right option; -1 otherwise' },
          explanation: { type: 'string', description: 'grammar only: why, in one or two sentences; empty otherwise' },
          solution: { type: 'string', description: 'rewrite, scenario, speak: a strong model answer' },
          rubric: { type: 'string', description: 'one line: what a strong answer does' },
        },
      },
    },
  },
};

async function writeCommTasks({ count, difficulty: level, mix }) {
  const recent = Object.values(comm.items).slice(-80).map((t) => t.title);
  const instructions = 'You write short communication exercises for a software developer in India improving professional English: grammar questions, messages to rewrite professionally, work situations to reply to (clients, managers, teammates), and questions to answer out loud. '
    + 'Make them realistic for a developer: standups, client emails, code review comments, deadlines, interviews. Teach by doing: each task should make one habit of professional communication clear (be specific, lead with the point, say what you need, stay polite under pressure). Never repeat earlier titles.';
  const prompt = `Write exactly ${count} tasks.\nDifficulty: ${level}.\n${mix ? 'Mix: at least one grammar, one rewrite, one scenario and one speak task.' : ''}\n${recent.length ? `Earlier titles, don't repeat:\n${recent.map((t) => `- ${t}`).join('\n')}` : ''}`;
  const data = await askJson({ instructions, prompt, schema: COMM_SCHEMA, maxTokens: 6000 });
  const list = (data.tasks || []).filter((t) => t?.title && t.prompt).map((t) => {
    const skill = ['grammar', 'rewrite', 'scenario', 'speak'].includes(t.skill) ? t.skill : 'scenario';
    const options = skill === 'grammar' ? (t.options || []).map(String).filter(Boolean) : [];
    return {
      id: crypto.randomUUID(),
      skill,
      title: String(t.title).trim(),
      prompt: String(t.prompt).trim(),
      given: String(t.given || '').trim() || null,
      options,
      answer: skill === 'grammar' ? Number(t.answer) : null,
      explanation: String(t.explanation || '').trim(),
      solution: String(t.solution || '').trim(),
      rubric: String(t.rubric || '').trim(),
      answerType: 'explain',
      createdAt: Date.now(),
    };
  }).filter((t) => t.skill !== 'grammar' || (t.options.length >= 3 && t.answer >= 0 && t.answer < t.options.length));
  if (!list.length) throw new Error('The AI sent no usable tasks. Try again.');
  return list.slice(0, count);
}

// --- Stats for the Report and Feedback -------------------------------------------------------

export function puzzleStats(days) {
  const from = addDays(dateKey(), -days);
  const attempts = (puzzles?.attempts || []).filter((a) => a.day >= from && !a.pending);
  const items = new Set(attempts.map((a) => a.itemId));
  const solvedIds = new Set(attempts.filter((a) => a.correct).map((a) => a.itemId));
  const byKind = {};
  attempts.forEach((a) => {
    const kind = puzzles.items[a.itemId]?.kind || 'other';
    byKind[kind] ||= { tried: new Set(), solved: new Set() };
    byKind[kind].tried.add(a.itemId);
    if (a.correct) byKind[kind].solved.add(a.itemId);
  });
  return {
    attempts: attempts.length,
    tried: items.size,
    solved: solvedIds.size,
    firstTry: [...solvedIds].filter((id) => attempts.find((a) => a.itemId === id)?.correct).length,
    levelsPassed: Object.keys(puzzles?.levels || {}).map(Number).filter((n) => levelPassed('puzzle', n)).length,
    byKind: Object.entries(byKind).map(([kind, v]) => ({ kind, tried: v.tried.size, solved: v.solved.size })),
  };
}

export function commStats(days) {
  const from = addDays(dateKey(), -days);
  const attempts = (comm?.attempts || []).filter((a) => a.day >= from && !a.pending && a.score != null);
  const bySkill = {};
  attempts.forEach((a) => {
    bySkill[a.skill] ||= { scores: [], fillers: [], wpm: [] };
    bySkill[a.skill].scores.push(a.score);
    if (a.speech) {
      bySkill[a.skill].fillers.push(a.speech.fillerRate);
      if (a.speech.wpm) bySkill[a.skill].wpm.push(a.speech.wpm);
    }
  });
  const avg = (list) => (list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : null);
  const byDay = new Map();
  attempts.forEach((a) => { byDay.set(a.day, [...(byDay.get(a.day) || []), a.score]); });
  return {
    attempts: attempts.length,
    average: avg(attempts.map((a) => a.score)),
    levelsPassed: Object.keys(comm?.levels || {}).map(Number).filter((n) => levelPassed('comm', n)).length,
    bySkill: Object.entries(bySkill).map(([skill, v]) => ({ skill, name: SKILL_NAMES[skill] || skill, average: avg(v.scores), count: v.scores.length, fillerRate: avg(v.fillers), wpm: avg(v.wpm) })).sort((a, b) => a.average - b.average),
    trend: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, scores]) => ({ day, average: avg(scores) })),
  };
}

// Every day with a puzzle or communication attempt, for the profile streak.
export function practiceDays() {
  return new Set([...(puzzles?.attempts || []), ...(comm?.attempts || [])].filter((a) => !a.pending).map((a) => a.day));
}

export function practiceLevelsPassed() {
  const count = (section, data) => Object.keys(data?.levels || {}).map(Number).filter((n) => levelPassed(section, n)).length;
  return count('puzzle', puzzles) + count('comm', comm);
}

// Recent feedback text, for the daily Feedback prompt.
export function practiceNotes() {
  const p = puzzleStats(7);
  const c = commStats(7);
  const lastFixes = (comm?.attempts || []).slice(-8).flatMap((a) => a.fixes || []).slice(-8);
  return `Puzzles this week: ${p.tried} tried, ${p.solved} solved${p.byKind.length ? ` (${p.byKind.map((k) => `${k.kind} ${k.solved}/${k.tried}`).join(', ')})` : ''}.\n`
    + `Communication this week: ${c.attempts ? `${c.attempts} tasks, average ${c.average}/100 (${c.bySkill.map((s) => `${s.name} ${s.average}`).join(', ')})` : 'nothing yet'}.\n`
    + (c.bySkill.find((s) => s.skill === 'speak')?.fillerRate != null ? `Speaking: ${c.bySkill.find((s) => s.skill === 'speak').fillerRate}% filler words, ${c.bySkill.find((s) => s.skill === 'speak').wpm || '?'} words per minute.\n` : '')
    + (lastFixes.length ? `Things the coach told them to change recently:\n${lastFixes.map((f) => `- ${f}`).join('\n')}` : '');
}

// The report cards for both sections.
export function renderPracticeReport(days, rangeLabel) {
  const nodes = [];
  const p = puzzleStats(days);
  const pStats = el('div', 'q-stats');
  [[String(p.tried), 'puzzles tried'], [String(p.solved), 'solved'], [String(p.firstTry), 'on the first try'], [String(p.levelsPassed), 'levels passed']].forEach(([v, l]) => {
    const n = el('span', 'mini-stat');
    n.append(el('b', '', { text: v }), document.createTextNode(` ${l}`));
    pStats.append(n);
  });
  if (p.byKind.length) {
    const line = el('p', 'q-hint', { text: p.byKind.map((k) => `${k.kind}: ${k.solved} of ${k.tried}`).join(' · ') });
    nodes.push(card(`${rangeLabel}: problem solving`, pStats, line));
  } else {
    nodes.push(card(`${rangeLabel}: problem solving`, pStats, el('p', 'q-hint', { text: 'No puzzles in this range yet.' })));
  }

  const c = commStats(days);
  const cStats = el('div', 'q-stats');
  [[String(c.attempts), 'tasks'], [c.average == null ? '–' : `${c.average}`, 'average score'], [String(c.levelsPassed), 'levels passed']].forEach(([v, l]) => {
    const n = el('span', 'mini-stat');
    n.append(el('b', '', { text: v }), document.createTextNode(` ${l}`));
    cStats.append(n);
  });
  const parts = [cStats];
  if (c.bySkill.length) {
    const list = el('div', 'q-bars');
    c.bySkill.forEach((s) => {
      const row = el('div', 'q-bar-row');
      const bar = el('div', 'q-bar');
      const fill = el('span', `q-bar-fill ${s.average >= PASS_SCORE ? 'is-good' : s.average >= 50 ? 'is-mid' : 'is-bad'}`);
      fill.style.width = `${s.average}%`;
      bar.append(fill);
      const extra = s.skill === 'speak' && s.fillerRate != null ? ` · ${s.fillerRate}% fillers${s.wpm ? `, ${s.wpm} wpm` : ''}` : '';
      row.append(el('span', 'q-bar-label', { text: s.name }), bar, el('span', 'q-bar-value', { text: `${s.average} · ${plural(s.count, 'task')}${extra}` }));
      list.append(row);
    });
    parts.push(list);
    if (c.trend.length > 1) {
      const row = el('div', 'q-trend', { role: 'img', 'aria-label': 'Average score by day' });
      c.trend.forEach((t) => {
        const bar = el('span', `q-trend-bar ${t.average >= PASS_SCORE ? 'is-good' : 'is-bad'}`, { title: `${parseKey(t.day).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}: ${t.average}` });
        bar.style.height = `${Math.max(8, t.average)}%`;
        row.append(bar);
      });
      parts.push(row);
    }
  } else {
    parts.push(el('p', 'q-hint', { text: 'No communication tasks in this range yet.' }));
  }
  nodes.push(card(`${rangeLabel}: communication`, ...parts));
  return nodes;
}

export function exportPractice() {
  return { puzzles, communication: comm };
}
