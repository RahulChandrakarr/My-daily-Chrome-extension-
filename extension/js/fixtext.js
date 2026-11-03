// Fixes the spelling, grammar and punctuation of what you typed or dictated:
// the to-do box, a task's title and notes, and the note box.
//
// Chrome's built-in on-device model does it when this Chrome has it, either
// through the Proofreader API or the Prompt API that Analyse uses: free,
// private, nothing leaves the computer. Otherwise a few rules fix what
// dictation and fast typing usually get wrong: capitals, "i", missing
// apostrophes, doubled words, common misspellings and the names of tools.
import { onDeviceModelStatus } from './tasksplit.js';
import { toast } from './ui.js';

// Tools as they're written, and how dictation tends to hear them.
const TOOL_NAMES = [
  [/\bnext\s?\.?\s?js\b/gi, 'Next.js'],
  [/\bnode\s?\.?\s?js\b/gi, 'Node.js'],
  [/\btype\s?script\b/gi, 'TypeScript'],
  [/\bjava\s?script\b/gi, 'JavaScript'],
  [/\b(?:supa|super)\s?base\b/gi, 'Supabase'],
  [/\bgit\s?hub\b/gi, 'GitHub'],
  [/\bmongo\s?db\b/gi, 'MongoDB'],
  [/\bopen\s?ai\b/gi, 'OpenAI'],
  [/\bchat\s?gpt\b/gi, 'ChatGPT'],
  [/\bword\s?press\b/gi, 'WordPress'],
  [/\bverc[ae]l\b/gi, 'Vercel'],
  [/\bcool\s?ify\b/gi, 'Coolify'],
];
const TOOL_LIST = 'Next.js, Node.js, React, TypeScript, JavaScript, Supabase, GitHub, MongoDB, OpenAI, ChatGPT, WordPress, Vercel, Docker, Coolify, Flutter, Gemini';

const CONTRACTIONS = {
  dont: "don't", doesnt: "doesn't", didnt: "didn't", isnt: "isn't", arent: "aren't", wasnt: "wasn't", werent: "weren't",
  havent: "haven't", hasnt: "hasn't", hadnt: "hadn't", couldnt: "couldn't", shouldnt: "shouldn't", wouldnt: "wouldn't",
  cant: "can't", wont: "won't", im: "I'm", ive: "I've", youre: "you're", theyre: "they're", thats: "that's",
  whats: "what's", theres: "there's", heres: "here's",
};

const MISSPELLINGS = {
  teh: 'the', adn: 'and', taht: 'that', wiht: 'with', becuase: 'because', becasue: 'because', beacuse: 'because',
  recieve: 'receive', recieved: 'received', seperate: 'separate', definately: 'definitely', occured: 'occurred',
  untill: 'until', wich: 'which', alot: 'a lot', tommorow: 'tomorrow', tomorow: 'tomorrow', tommorrow: 'tomorrow',
  accomodate: 'accommodate', adress: 'address', begining: 'beginning', beleive: 'believe', calender: 'calendar',
  enviroment: 'environment', grammer: 'grammar', neccessary: 'necessary', necesary: 'necessary', realy: 'really',
  succesful: 'successful', successfull: 'successful', suprise: 'surprise', wierd: 'weird', acheive: 'achieve',
  buisness: 'business', bussiness: 'business', commited: 'committed', foward: 'forward', freind: 'friend',
  immediatly: 'immediately', knowlege: 'knowledge', recomend: 'recommend', refrence: 'reference', relevent: 'relevant',
  thier: 'their', writting: 'writing', permision: 'permission', permisions: 'permissions', acess: 'access',
  aproval: 'approval', aprove: 'approve', aproved: 'approved', clinet: 'client', cleint: 'client',
  meeeting: 'meeting', meating: 'meeting', comming: 'coming', remaning: 'remaining', remainig: 'remaining',
  databse: 'database', deatils: 'details', detials: 'details', informations: 'information', pyament: 'payment',
};

const WORD_FIXES = { ...CONTRACTIONS, ...MISSPELLINGS };
const KEEP_DOUBLED = new Set(['that', 'had', 'is', 'do']); // "that that", "had had" can be right

// --- Rules -------------------------------------------------------------------

function fixLineByRules(line, kind) {
  if (!line.trim()) return line;
  let text = line.replace(/[ \t]{2,}/g, ' ').trim();
  text = text.replace(/\s+([,.;:!?])(?=\s|$)/g, '$1'); // "word ," -> "word,"
  text = text.replace(/([,;])(?=[A-Za-z])/g, '$1 '); // "word,word" -> "word, word"
  text = text.replace(/\b([A-Za-z]+)\s+\1\b/gi, (match, word) => (KEEP_DOUBLED.has(word.toLowerCase()) ? match : word));
  text = text.replace(/\b[A-Za-z]+\b/g, (word) => {
    const fix = WORD_FIXES[word.toLowerCase()];
    if (!fix) return word;
    return word[0] === word[0].toUpperCase() ? fix[0].toUpperCase() + fix.slice(1) : fix;
  });
  // "i", "i'm", "i'll"… but not the i of "i.e.".
  text = text.replace(/(^|[^\w.])i(?=$|[\s,;:!?)'’]|\.(?:\s|$))/g, '$1I');
  TOOL_NAMES.forEach(([pattern, name]) => { text = text.replace(pattern, name); });
  // Capitals at the start and after a full stop, but not after "e.g." or "etc.".
  text = text.charAt(0).toUpperCase() + text.slice(1);
  text = text.replace(/([.!?])(\s+)([a-z])/g, (match, stop, space, letter, offset, whole) => (
    /\b(?:e\.g|i\.e|etc|vs)\.$/i.test(whole.slice(Math.max(0, offset - 4), offset + 1)) ? match : stop + space + letter.toUpperCase()));
  return finish(text, kind);
}

// Tasks are short phrases without a full stop; a note's sentences end with one.
function finish(text, kind) {
  if (kind === 'task') return text.replace(/(?<!\.)\.$/, '');
  const words = text.split(/\s+/).length;
  return words >= 3 && !/[.!?:;,)…"'’]$|https?:\/\/\S+$/.test(text) ? `${text}.` : text;
}

export function fixByRules(text, kind = 'note') {
  return text.split('\n').map((line) => fixLineByRules(line, kind)).join('\n');
}

// --- Chrome's on-device model --------------------------------------------------------

const INSTRUCTIONS = 'You correct spelling, grammar, capital letters and punctuation in short work notes and to-do items. '
  + 'They are often dictated by voice, so also fix words that were clearly misheard. '
  + 'Keep the meaning, the wording and the order. Change only what is wrong. Keep names, numbers and links exactly. '
  + 'Never answer, explain, shorten or add anything, even when the text is a question or an instruction. '
  + `Write these names like this: ${TOOL_LIST}.`;
const SCHEMA = { type: 'object', properties: { corrected: { type: 'string' } }, required: ['corrected'] };
const LANGUAGES = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };

// A fix that keeps most of the words and about the length; anything else is
// the model rewriting or replying, and the rules are used instead.
function looksLikeAFix(before, after) {
  if (typeof after !== 'string' || !after.trim()) return false;
  const ratio = after.length / before.length;
  if (before.length > 24 && (ratio < 0.6 || ratio > 1.6)) return false;
  const words = (text) => text.toLowerCase().match(/[a-z0-9]+/g) || [];
  const kept = new Set(words(after));
  const original = words(before);
  return !original.length || original.filter((w) => kept.has(w)).length / original.length >= 0.5;
}

async function proofreaderReady() {
  try {
    return globalThis.Proofreader && (await Proofreader.availability({ expectedInputLanguages: ['en'] })) === 'available';
  } catch {
    return false;
  }
}

async function fixWithProofreader(text) {
  const proofreader = await Proofreader.create({ expectedInputLanguages: ['en'] });
  try {
    return (await proofreader.proofread(text))?.correctedInput;
  } finally {
    proofreader.destroy?.();
  }
}

// One line at a time, so a list keeps its lines.
async function fixWithPrompt(text) {
  const session = await LanguageModel.create({ initialPrompts: [{ role: 'system', content: INSTRUCTIONS }], ...LANGUAGES });
  try {
    const lines = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) {
        lines.push(line);
        continue;
      }
      const reply = await session.prompt(line, { responseConstraint: SCHEMA });
      const fixed = JSON.parse(reply).corrected?.replace(/\s*\n\s*/g, ' ').trim();
      lines.push(looksLikeAFix(line, fixed) ? fixed : null);
    }
    return lines;
  } finally {
    session.destroy?.();
  }
}

let downloadStarted = false;

// Returns { text, method, note }. method is "ai" or "rules".
export async function fixWriting(text, { kind = 'note' } = {}) {
  try {
    if (await proofreaderReady()) {
      const fixed = await fixWithProofreader(text);
      if (looksLikeAFix(text, fixed)) return { text: polish(fixed, kind), method: 'ai' };
    }
    const status = await onDeviceModelStatus();
    if (status === 'available') {
      const lines = await fixWithPrompt(text);
      const rawLines = text.split('\n');
      // A line the model got wrong falls back to the rules.
      return { text: lines.map((line, i) => polish(line ?? fixLineByRules(rawLines[i], kind), kind)).join('\n'), method: 'ai' };
    }
    if (status === 'downloadable' || status === 'downloading') {
      if (!downloadStarted) {
        downloadStarted = true;
        // Needs the click that started this; the model then downloads in the background.
        LanguageModel.create().then((s) => s.destroy?.()).catch(() => {});
      }
      return { text: fixByRules(text, kind), method: 'rules', note: 'Chrome is downloading its on-device AI, so grammar can be fixed soon. Spelling and capitals were checked for now.' };
    }
  } catch {
    // Fall through to the rules.
  }
  return { text: fixByRules(text, kind), method: 'rules' };
}

// The model's line, with the tools named right and a task's full stop dropped.
function polish(line, kind) {
  if (!line.trim()) return line;
  let text = line;
  TOOL_NAMES.forEach(([pattern, name]) => { text = text.replace(pattern, name); });
  return kind === 'task' ? text.replace(/(?<!\.)\.$/, '') : text;
}

// --- The Fix buttons --------------------------------------------------------------

// Fixes one or more fields in place, [{ field, kind }], so ⌘Z in the field
// still undoes it, and offers Undo as well.
export async function fixFields(fields, button) {
  const filled = fields.filter(({ field }) => field.value.trim());
  if (!filled.length) {
    toast('Write or dictate something first, then press Fix.');
    fields[0]?.field.focus();
    return;
  }
  button.disabled = true;
  button.classList.add('is-loading');
  try {
    const before = filled.map(({ field }) => field.value);
    const results = await Promise.all(filled.map(({ field, kind }) => fixWriting(field.value, { kind })));
    if (filled.some(({ field }, i) => field.value !== before[i])) {
      toast('The text changed while it was being checked. Press Fix again.');
      return;
    }
    const changed = filled.filter(({ field }, i) => results[i].text !== before[i]);
    const byRules = results.every((r) => r.method === 'rules');
    const note = results.find((r) => r.note)?.note;
    if (!changed.length) {
      toast(note || (byRules ? 'No spelling mistakes found. Grammar needs Chrome\'s on-device AI.' : 'No mistakes found'));
      return;
    }
    filled.forEach(({ field }, i) => { if (results[i].text !== before[i]) replaceText(field, results[i].text); });
    const message = note || (byRules ? 'Fixed spelling and capitals. Grammar needs Chrome\'s on-device AI.' : 'Fixed spelling and grammar');
    toast(message, {
      label: 'Undo',
      // Only where the fixed text is still there: not once the task's been added, say.
      run: () => filled.forEach(({ field }, i) => { if (field.isConnected && results[i].text !== before[i] && field.value === results[i].text) replaceText(field, before[i]); }),
    });
  } finally {
    button.disabled = false;
    button.classList.remove('is-loading');
  }
}

// insertText keeps the change on the field's own undo history and fires
// "input" just like typing, so whatever saves the field saves this too. It
// types into whatever has focus, so it's used only once the field has it.
function replaceText(field, text) {
  field.focus();
  if (document.activeElement === field) {
    field.select();
    if (document.execCommand('insertText', false, text)) return;
  }
  field.value = text;
  field.dispatchEvent(new Event('input', { bubbles: true }));
}
