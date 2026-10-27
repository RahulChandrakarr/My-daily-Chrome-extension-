// News sources for the AI news tab. Every feed here is already AI-focused. To
// add one, copy an entry and give it a unique id; any RSS or Atom URL works.
// `hue` tints the cover shown when a story has no image.

export const FEEDS = [
  { id: 'verge', name: 'The Verge', group: 'news', hue: 285, url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml' },
  { id: 'techcrunch', name: 'TechCrunch', group: 'news', hue: 140, url: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
  { id: 'mittr', name: 'MIT Technology Review', group: 'news', hue: 0, url: 'https://www.technologyreview.com/topic/artificial-intelligence/feed' },
  { id: 'ars', name: 'Ars Technica', group: 'news', hue: 18, url: 'https://arstechnica.com/ai/feed/' },
  { id: 'wired', name: 'Wired', group: 'news', hue: 205, url: 'https://www.wired.com/feed/tag/ai/latest/rss' },
  { id: 'openai', name: 'OpenAI', group: 'labs', hue: 165, url: 'https://openai.com/news/rss.xml' },
  { id: 'google', name: 'Google AI', group: 'labs', hue: 220, url: 'https://blog.google/innovation-and-ai/technology/ai/rss/' },
  { id: 'deepmind', name: 'Google DeepMind', group: 'labs', hue: 250, url: 'https://deepmind.google/blog/rss.xml' },
  { id: 'hfblog', name: 'Hugging Face', group: 'labs', hue: 45, url: 'https://huggingface.co/blog/feed.xml' },
];

export const OTHER_SOURCES = [
  { id: 'hn', name: 'Hacker News', group: 'hn', hue: 24 },
  { id: 'papers', name: 'Hugging Face Papers', group: 'papers', hue: 45 },
  { id: 'models', name: 'Hugging Face models', group: 'models' },
];

export const ALL_SOURCES = [...FEEDS, ...OTHER_SOURCES];

export const GROUPS = [
  { id: 'all', label: 'Headlines' },
  { id: 'news', label: 'News' },
  { id: 'labs', label: 'AI labs' },
  { id: 'hn', label: 'Hacker News' },
  { id: 'papers', label: 'Papers' },
  { id: 'models', label: 'Models' },
];

// A Hacker News story counts as AI news when its title matches this.
export const AI_PATTERN = /\b(AI|AGI|LLMs?|GPT[-\w.]*|ChatGPT|OpenAI|Anthropic|Claude|Gemini|DeepMind|Llama|Mistral|Qwen|DeepSeek|Grok|xAI|Copilot|Hugging ?Face|machine learning|deep learning|neural|transformers?|diffusion|agentic|AI agents?|chatbots?|Nvidia|inference|fine-?tun\w*|RAG|embeddings?)\b/i;

export function sourceHue(id) {
  return ALL_SOURCES.find((s) => s.id === id)?.hue ?? 230;
}
