// Learning topics.
//   interest: your chosen topics. Each gets its own tab in Learning with top
//             videos, trending stories and articles to study, and feeds the
//             Suggested tab.
//   resume:   skills from Rahul_Kumar_Full_Stack_Developer.pdf. They take turns
//             in "Learn today", so every skill on the resume comes up regularly.
// `tags`     dev.to tags for study articles (the first is the main one).
// `feeds`    RSS feeds, and `hn` a Hacker News search, for trending stories.
// `channels` YouTube channels for video suggestions. A channel's id is in its
//            page source: search for "channelId".
// `match`    picks this topic's stories off Hacker News's front page.
// `lobsters` Lobsters tags that belong to this topic.
import { AI_PATTERN } from './sources.js';

export const DEFAULT_TOPICS = [
  {
    id: 'ai', name: 'AI', kind: 'interest', hue: 265, tags: ['ai', 'machinelearning'], hn: 'AI',
    feeds: [],
    match: AI_PATTERN,
    lobsters: ['ai', 'vibecoding'],
    channels: [
      { name: 'Two Minute Papers', id: 'UCbfYPyITQ-7l4upoX8nvctg' },
      { name: 'AI Explained', id: 'UCNJ1Ymd5yFuUPtn21xtRbbw' },
      { name: 'Matthew Berman', id: 'UCawZsQWqfGSbCI5yjkdVkTA' },
      { name: 'Andrej Karpathy', id: 'UCXUPKJO5MZQN11PqgIvyuvQ' },
      { name: 'Yannic Kilcher', id: 'UCZHmQk67mSJgfCCTn7xBfew' },
      { name: 'bycloud', id: 'UCgfe2ooZD3VJPB6aJAnuQng' },
      { name: 'Wes Roth', id: 'UCqcbQf6yw5KzRoDDcZ_wBSw' },
      { name: 'Google DeepMind', id: 'UCP7jMXSY2xbc3KCAE0MHQ-A' },
      { name: 'OpenAI', id: 'UCXZCJLdBC09xxGZ6gcdrc6A' },
      { name: 'Anthropic', id: 'UCrDwWp7EBBv4NwvScIpBDOA' },
    ],
  },
  {
    id: 'nextjs', name: 'Web & Next.js', kind: 'interest', hue: 210, tags: ['nextjs', 'webdev'], hn: 'Next.js',
    feeds: [{ name: 'Next.js blog', url: 'https://nextjs.org/feed.xml' }],
    match: /\b(Next\.?js|React|JavaScript|TypeScript|CSS|HTML|browsers?|frontend|web ?dev\w*|Node\.?js|Deno|Bun|Vercel|WebAssembly|Wasm)\b/i,
    lobsters: ['web', 'javascript', 'css', 'browsers'],
    channels: [
      { name: 'Fireship', id: 'UCsBjURrPoezykLs9EqgamOA' },
      { name: 'Theo - t3.gg', id: 'UCbRP3c757lWg9M-U7TyEkXA' },
      { name: 'Web Dev Simplified', id: 'UCFbNIlppjAuEX4znoulh0Cw' },
      { name: 'Jack Herrington', id: 'UC6vRUjYqDuoUsYsku86Lrsw' },
      { name: 'Vercel', id: 'UCLq8gNoee7oXM7MvTdjyQvA' },
      { name: 'ByteGrad', id: 'UCf6AGqO98eGk11nfazociVQ' },
      { name: 'Josh tried coding', id: 'UCvGwM5woTl13I-qThI4YMCg' },
      { name: 'Beyond Fireship', id: 'UC2Xd-TjJByJyK2w1zNwY0zQ' },
      { name: 'ThePrimeTime', id: 'UCUyeluBRhGPCW4rPe_UvBZQ' },
    ],
  },
  {
    id: 'robotics', name: 'Robotics', kind: 'interest', hue: 175, tags: ['robotics'], hn: 'robot',
    feeds: [
      { name: 'IEEE Spectrum', url: 'https://spectrum.ieee.org/feeds/topic/robotics.rss' },
      { name: 'The Robot Report', url: 'https://www.therobotreport.com/feed/' },
    ],
    match: /\b(robot\w*|humanoids?|drones?|Boston Dynamics|Optimus)\b/i,
    lobsters: [],
    channels: [
      { name: 'Boston Dynamics', id: 'UC7vVhkEfw4nOGp8TyDk7RcQ' },
      { name: 'IEEE Spectrum', id: 'UCFQDtftsHGzSh1-TReNT4lA' },
      { name: 'Figure', id: 'UCYlq-KmwPjc1DtsGmthFqSQ' },
      { name: 'Unitree Robotics', id: 'UCsMbp4V8oxzHCMdOUP-3oWw' },
      { name: 'James Bruton', id: 'UCUbDcUPed50Y_7KmfCXKohA' },
    ],
  },

  { id: 'javascript', name: 'JavaScript', kind: 'resume', tags: ['javascript'] },
  { id: 'typescript', name: 'TypeScript', kind: 'resume', tags: ['typescript'] },
  { id: 'react', name: 'React', kind: 'resume', tags: ['react'] },
  { id: 'state', name: 'Redux, Zustand & TanStack Query', kind: 'resume', tags: ['redux', 'zustand', 'reactquery'] },
  { id: 'tailwind', name: 'Tailwind CSS', kind: 'resume', tags: ['tailwindcss'] },
  { id: 'motion', name: 'Framer Motion & GSAP', kind: 'resume', tags: ['animation', 'gsap', 'framermotion'] },
  { id: 'node', name: 'Node.js & Express', kind: 'resume', tags: ['node', 'express'] },
  { id: 'supabase', name: 'Supabase', kind: 'resume', tags: ['supabase'] },
  { id: 'firebase', name: 'Firebase', kind: 'resume', tags: ['firebase'] },
  { id: 'postgres', name: 'PostgreSQL & SQL', kind: 'resume', tags: ['postgres', 'sql'] },
  { id: 'mongodb', name: 'MongoDB', kind: 'resume', tags: ['mongodb'] },
  { id: 'mysql', name: 'MySQL', kind: 'resume', tags: ['mysql'] },
  { id: 'api', name: 'REST APIs', kind: 'resume', tags: ['api'] },
  { id: 'auth', name: 'JWT & OAuth auth', kind: 'resume', tags: ['authentication', 'oauth'] },
  { id: 'llm', name: 'LLM apps & tool calling', kind: 'resume', tags: ['llm', 'openai'] },
  { id: 'prompting', name: 'Prompt engineering', kind: 'resume', tags: ['promptengineering'] },
  { id: 'flutter', name: 'Flutter & Dart', kind: 'resume', tags: ['flutter', 'dart'] },
  { id: 'python', name: 'Python', kind: 'resume', tags: ['python'] },
  { id: 'php', name: 'PHP & WordPress', kind: 'resume', tags: ['php', 'wordpress'] },
  { id: 'docker', name: 'Docker & self-hosting', kind: 'resume', tags: ['docker', 'selfhosted'] },
  { id: 'gcp', name: 'Google Cloud', kind: 'resume', tags: ['googlecloud'] },
  { id: 'vercel', name: 'Vercel & deployment', kind: 'resume', tags: ['vercel'] },
  { id: 'performance', name: 'Web performance', kind: 'resume', tags: ['performance'] },
  { id: 'pwa', name: 'Progressive web apps', kind: 'resume', tags: ['pwa'] },
  { id: 'git', name: 'Git & GitHub', kind: 'resume', tags: ['git', 'github'] },
  { id: 'shopify', name: 'Shopify', kind: 'resume', tags: ['shopify'] },
];

// Topics you add in Settings: an interest also gets trending stories from a
// Hacker News search for its name. They're saved in settings, so they can't
// hold a regular expression; topicMatcher builds one from the name instead.
export function customTopic(name, kind) {
  const tag = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return {
    id: `custom-${tag}`,
    name: name.trim(),
    kind,
    tags: [tag],
    hn: kind === 'interest' ? name.trim() : null,
    feeds: [],
    channels: [],
    lobsters: [],
    custom: true,
  };
}

export function topicMatcher(topic) {
  if (topic.match) return topic.match;
  const escaped = topic.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i');
}

export function allTopics(settings) {
  return [...DEFAULT_TOPICS, ...(settings.customTopics || [])];
}

export function activeTopics(settings) {
  const off = new Set(settings.disabledTopics || []);
  return allTopics(settings).filter((t) => !off.has(t.id));
}

export function topicHue(topic) {
  if (topic.hue != null) return topic.hue;
  let h = 0;
  for (const ch of topic.id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}
