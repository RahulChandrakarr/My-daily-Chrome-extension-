// When you get something wrong in Questions, this teaches it: the right
// answer, why it's right, a simple example and an everyday analogy, in easy
// language. Written by the AI the moment you get the question wrong, then
// kept with the question so it isn't written twice, and shown again in the
// end-of-quiz list. Without AI, the question's own one-line explanation is
// all there is.
import { askJson } from './ai.js';
import { el } from './ui.js';

export const LESSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'why', 'example', 'analogy', 'remember'],
  properties: {
    answer: { type: 'string', description: 'the right answer in one plain sentence' },
    why: { type: 'string', description: 'why it is right, and why the chosen answer is tempting but wrong, in two to four short sentences of easy English' },
    example: { type: 'string', description: 'a small concrete example; a short code snippet if the topic is code' },
    analogy: { type: 'string', description: 'an everyday analogy that makes the idea stick, one to three sentences' },
    remember: { type: 'string', description: 'one line to remember it by' },
  },
};

const INSTRUCTIONS = 'You are a patient teacher helping a developer learn from a mistake. '
  + 'Explain in easy, everyday English, short sentences, no jargon unless you explain it. '
  + 'Always give a concrete example and an analogy from daily life (traffic, kitchens, shops, post, school). '
  + 'Be kind but clear about why the chosen answer is wrong.';

// For multiple-choice questions. `chosen` is the index or indexes picked.
export async function explainChoice({ question, options, answers, chosen, topic }) {
  const list = (i) => [].concat(i).map((n) => options[n]).filter(Boolean).join('; ');
  const prompt = `Topic: ${topic}\nQuestion: ${question}\nOptions:\n${options.map((o, i) => `${i + 1}. ${o}`).join('\n')}\n`
    + `Right answer: ${list(answers)}\nThe learner chose: ${list(chosen) || 'nothing'}\n\nTeach this.`;
  return askJson({ instructions: INSTRUCTIONS, prompt, schema: LESSON_SCHEMA, maxTokens: 1200 });
}

// A card with the lesson, or a loading or fallback state.
//   lesson: the object above, or 'loading', or null (no AI: show `fallback`)
export function renderLesson(lesson, { fallback = '' } = {}) {
  const box = el('div', 'q-lesson');
  box.append(el('h4', 'q-lesson-title', { text: 'Let\'s learn this' }));
  if (lesson === 'loading') {
    box.append(el('p', 'q-hint', { text: 'Writing an explanation for you…' }));
    return box;
  }
  if (!lesson) {
    box.append(el('p', 'q-text', { text: fallback || 'Set up AI in Settings to get a full explanation with an example and an analogy.' }));
    return box;
  }
  const part = (label, text, pre = false) => {
    if (!text) return;
    const row = el('div', 'q-lesson-part');
    row.append(el('b', '', { text: label }), el(pre ? 'pre' : 'p', pre ? 'q-given' : '', { text }));
    box.append(row);
  };
  part('The right answer', lesson.answer);
  part('Why', lesson.why);
  part('Example', lesson.example, /\n/.test(lesson.example || '') || /[{};=()]/.test(lesson.example || ''));
  part('Think of it like this', lesson.analogy);
  part('Remember', lesson.remember);
  return box;
}
