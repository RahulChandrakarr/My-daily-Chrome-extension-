// One place to ask an AI model for JSON, for the Questions section (quizzes,
// levels, reports and feedback).
//
// Two ways, tried in this order:
//   1. OpenRouter, with the key you paste in Settings. Claude through
//      OpenRouter writes the best questions and can read a PDF resume. It
//      costs a little: a 20-question quiz is a few cents.
//   2. Chrome's on-device model (the one Analyse and Fix use): free and
//      private, but its questions are simpler and it can't read a PDF.
// With neither, the caller gets an AiUnavailable error and says so.
import { load } from './store.js';
import { onDeviceModelStatus } from './tasksplit.js';

export const DEFAULT_MODEL = 'anthropic/claude-opus-5.5';
const OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions';

export class AiUnavailable extends Error {}

// The key lives in its own storage key (like the GitHub token), so it stays on
// this computer: settings sync to Supabase, this doesn't.
export const AI_AUTH_KEY = 'aiAuth';

export async function aiConfig() {
  const [auth, settings] = await Promise.all([load(AI_AUTH_KEY, null), load('settings', {})]);
  return { key: (auth?.key || '').trim(), model: (settings.aiModel || '').trim() || DEFAULT_MODEL };
}

// Which way the next request would go: 'openrouter', 'on-device' or null.
export async function aiSource() {
  const { key } = await aiConfig();
  if (key) return 'openrouter';
  return (await onDeviceModelStatus()) === 'available' ? 'on-device' : null;
}

// Asks for JSON matching `schema` (a JSON Schema object). `instructions` is
// the system prompt, `prompt` the request; `pdf` is an optional
// { name, base64 } the model should read (OpenRouter only).
// Returns the parsed object.
export async function askJson({ instructions, prompt, schema, pdf = null, maxTokens = 8000 }) {
  const { key, model } = await aiConfig();
  if (key) return viaOpenRouter({ key, model, instructions, prompt, schema, pdf, maxTokens });
  if (pdf) throw new AiUnavailable('Reading a PDF needs an OpenRouter key in Settings. You can paste the resume text instead.');
  if ((await onDeviceModelStatus()) === 'available') return viaOnDevice({ instructions, prompt, schema });
  throw new AiUnavailable('No AI is set up. Paste an OpenRouter key in Settings, or turn on Chrome\'s on-device AI.');
}

async function viaOpenRouter({ key, model, instructions, prompt, schema, pdf, maxTokens }) {
  const content = pdf
    ? [
      { type: 'text', text: prompt },
      { type: 'file', file: { filename: pdf.name, file_data: `data:application/pdf;base64,${pdf.base64}` } },
    ]
    : prompt;
  const body = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'system', content: `${instructions}\n\nReply with JSON only, matching this schema:\n${JSON.stringify(schema)}` }, { role: 'user', content }],
    response_format: { type: 'json_schema', json_schema: { name: 'reply', strict: true, schema } },
    ...(pdf ? { plugins: [{ id: 'file-parser', pdf: { engine: 'pdf-text' } }] } : {}),
  };
  const res = await fetch(OPENROUTER, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/RahulChandrakarr/My-daily-Chrome-extension-',
      'X-Title': 'My Daily',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error('OpenRouter didn\'t accept the key. Check it in Settings.');
  if (res.status === 402) throw new Error('OpenRouter says the account has no credit left.');
  if (!res.ok || data.error) throw new Error(`OpenRouter: ${data.error?.message || `returned ${res.status}`}`);
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('OpenRouter sent an empty reply.');
  return parseJson(text);
}

async function viaOnDevice({ instructions, prompt, schema }) {
  const session = await LanguageModel.create({
    initialPrompts: [{ role: 'system', content: instructions }],
    expectedInputs: [{ type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
  });
  try {
    return parseJson(await session.prompt(prompt, { responseConstraint: schema }));
  } finally {
    session.destroy?.();
  }
}

// Models sometimes wrap JSON in a code fence or a sentence.
function parseJson(text) {
  const clean = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(clean);
  } catch {
    const start = clean.search(/[[{]/);
    const end = Math.max(clean.lastIndexOf('}'), clean.lastIndexOf(']'));
    if (start < 0 || end <= start) throw new Error('The AI didn\'t reply with JSON.');
    return JSON.parse(clean.slice(start, end + 1));
  }
}

// Checks a key by asking OpenRouter who it belongs to. Returns the label and
// the remaining credit when OpenRouter reports one.
export async function verifyOpenRouterKey(key) {
  const res = await fetch('https://openrouter.ai/api/v1/auth/key', { headers: { Authorization: `Bearer ${key.trim()}` } });
  if (res.status === 401) throw new Error('OpenRouter didn\'t accept that key.');
  if (!res.ok) throw new Error(`OpenRouter returned ${res.status}`);
  const { data } = await res.json();
  return { label: data?.label || 'key', limitRemaining: data?.limit_remaining ?? null };
}
