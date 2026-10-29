// Turns a paragraph like "I have to call Priya, then fix the login bug and
// also send the invoice tomorrow, it's urgent" into separate to-do items,
// each with a due day and an important flag when the words say so.
//
// Chrome's built-in on-device model (Gemini Nano, via the Prompt API) does the
// splitting when this Chrome has it: free, private, nothing leaves the
// computer. Otherwise a rule-based splitter handles lists, sentences, "then",
// "also" and "and <verb>".
import { dateKey, addDays } from './dates.js';

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Words a task usually starts with; used to tell "fix X and send Y" (two
// tasks) from "email Priya and Sam" (one).
const VERBS = new Set(('add ask attend back backup book bring buy build call cancel catch change check clean close collect complete configure '
  + 'connect contact continue create debug decide delete demo deploy design discuss do document download draft drop edit email '
  + 'file fill finalise finalize finish fix follow get go implement improve install integrate investigate learn make meet merge '
  + 'message migrate move order organise organize pay pick ping plan post practice practise prep prepare present print publish '
  + 'push read record refactor release remind remove renew reply research return review run schedule send set setup share ship '
  + 'sign start study submit sync take talk test text think tidy try update upload visit watch wrap write').split(' '));

// Openers that aren't part of the task: "I have to", "also", "then", "don't forget to"…
const LEAD_IN = /^(?:and|also|then|plus|after that|afterwards|finally|first(?:ly)?|second(?:ly)?|third(?:ly)?|next|lastly|so|oh|ok(?:ay)?|it(?:'s| is)\s+(?:really\s+)?(?:urgent|important|time)\s+to|i\s+(?:also\s+)?(?:have|need|want|got)\s+to|i\s+(?:should|must|will|gotta)|i'll|i'd like to|we\s+(?:need|have)\s+to|need\s+to|have\s+to|has\s+to|got\s+to|gotta|must|should|remember\s+to|don't\s+forget\s+to|do\s+not\s+forget\s+to|make\s+sure\s+(?:to|i|that\s+i)|please|today\s+i\s+(?:have|need)\s+to|tomorrow\s+i\s+(?:have|need)\s+to|there(?:'s| is)\s+also)\b[\s,:;-]*/i;

// Leftovers that aren't tasks: "and so many things", "etc".
const FILLER = /^(?:etc\.?|and so on|so on|so many (?:things|more)|many (?:more )?things|a lot (?:of things|more)|other stuff|stuff|things|that'?s it|that'?s all|and more|more)$/i;

const IMPORTANT = /\b(?:urgent(?:ly)?|asap|a\.s\.a\.p\.?|important|high priority|top priority|critical)\b/i;

// --- Rule-based splitter ----------------------------------------------------------

export function splitTasksByRules(text) {
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*•▪◦–]|\d+[.)]|\[[ x]\])\s*/i, '').trim())
    .filter(Boolean);
  const pieces = lines.flatMap((line) => line
    .split(/(?<=[.!?])\s+(?=\S)|;\s*|\s+(?:and\s+)?then\s+|,?\s+and\s+also\s+|,?\s+also\s+/i)
    .flatMap(splitOnVerbs));
  const seen = new Set();
  return pieces
    .map(toTask)
    .filter((t) => t && !seen.has(t.title.toLowerCase()) && seen.add(t.title.toLowerCase()));
}

// Splits on ", " and " and " only where what follows starts a new task.
function splitOnVerbs(sentence) {
  const parts = sentence.split(/(,\s*(?:and\s+)?|\s+and\s+)/i);
  const out = [parts[0]];
  for (let i = 1; i < parts.length; i += 2) {
    const next = parts[i + 1] || '';
    const firstWord = stripLeadIns(next).split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '');
    if (VERBS.has(firstWord) || LEAD_IN.test(next)) out.push(next);
    else out[out.length - 1] += parts[i] + next;
  }
  return out;
}

function stripLeadIns(text) {
  let current = text.trim();
  for (let i = 0; i < 4; i += 1) {
    const next = current.replace(LEAD_IN, '').trim();
    if (next === current) break;
    current = next;
  }
  return current;
}

function toTask(raw) {
  const important = IMPORTANT.test(raw); // before "It's urgent to" is stripped
  let title = stripLeadIns(raw).replace(/^[\s,.;:–-]+|[\s,.;:–-]+$/g, '');
  const { due, rest } = takeDue(title);
  title = rest
    .replace(IMPORTANT, '')
    .replace(/,?\s*(?:it'?s|it is|this is)\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,.;:–-]+|[\s,.;:–!-]+$/g, '');
  if (title.length < 3 || FILLER.test(title)) return null;
  return { title: title.charAt(0).toUpperCase() + title.slice(1), due, important };
}

// Pulls "today", "tomorrow", "by Friday", "on Monday" out of a task.
function takeDue(text) {
  const today = dateKey();
  const rules = [
    [/\b(?:by\s+)?(?:today|tonight|this (?:morning|afternoon|evening)|end of (?:the )?day|eod)\b/i, () => today],
    [/\b(?:by\s+)?tomorrow(?: (?:morning|afternoon|evening))?\b/i, () => addDays(today, 1)],
    // Only "by Friday", "on Monday"… so "Friday's meeting" isn't read as a due day.
    [new RegExp(`\\b(?:by|on|this|next|before|until|till)\\s+(${WEEKDAYS.join('|')})\\b(?!')`, 'i'), (m) => nextWeekday(m[1])],
  ];
  for (const [pattern, resolve] of rules) {
    const match = text.match(pattern);
    if (match) return { due: resolve(match), rest: text.replace(match[0], ' ') };
  }
  return { due: null, rest: text };
}

function nextWeekday(name) {
  const target = WEEKDAYS.indexOf(name.toLowerCase());
  const now = new Date();
  const ahead = (target - now.getDay() + 7) % 7 || 7;
  return addDays(dateKey(now), ahead);
}

// --- Chrome's on-device model --------------------------------------------------------

const SCHEMA = {
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          due: { type: 'string', enum: ['none', 'today', 'tomorrow', ...WEEKDAYS] },
          important: { type: 'boolean' },
        },
        required: ['title', 'due', 'important'],
      },
    },
  },
  required: ['tasks'],
};

const INSTRUCTIONS = 'You turn what someone says they need to do into a to-do list. '
  + 'Write one task per separate thing to do, as a short imperative phrase (for example "Call Priya about the invoice"). '
  + 'Keep names, numbers and details. Leave out filler such as "I have to" or "and so many things". '
  + 'Set due to today, tomorrow or a weekday only when the text says so, otherwise none. '
  + 'Set important to true only for words like urgent, ASAP or important.';

// "available", "downloadable", "downloading" or "unavailable".
export async function onDeviceModelStatus() {
  try {
    if (!globalThis.LanguageModel) return 'unavailable';
    return await LanguageModel.availability({ expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] });
  } catch {
    return 'unavailable';
  }
}

let downloadStarted = false;

// Splits with the on-device model when it's ready, and with the rules
// otherwise. If Chrome can download the model, the download starts so it's
// ready next time. Returns { tasks, method, note }.
export async function splitTasks(text) {
  const status = await onDeviceModelStatus();
  if (status === 'available') {
    try {
      const session = await LanguageModel.create({
        initialPrompts: [{ role: 'system', content: INSTRUCTIONS }],
        expectedInputs: [{ type: 'text', languages: ['en'] }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
      });
      const reply = await session.prompt(text, { responseConstraint: SCHEMA });
      session.destroy?.();
      const tasks = JSON.parse(reply).tasks
        .map((t) => ({
          title: t.title.trim().replace(/[.!]+$/, ''),
          due: t.due === 'today' ? dateKey() : t.due === 'tomorrow' ? addDays(dateKey(), 1) : WEEKDAYS.includes(t.due) ? nextWeekday(t.due) : null,
          important: Boolean(t.important),
        }))
        .filter((t) => t.title.length >= 2);
      if (tasks.length) return { tasks, method: 'ai' };
    } catch {
      // Fall through to the rules.
    }
  }
  let note = null;
  if ((status === 'downloadable' || status === 'downloading') && !downloadStarted) {
    downloadStarted = true;
    // Needs the click that started this; the model then downloads in the background.
    LanguageModel.create().then((s) => s.destroy?.()).catch(() => {});
    note = 'Chrome is downloading its on-device AI for smarter splitting next time.';
  }
  return { tasks: splitTasksByRules(text), method: 'rules', note };
}
