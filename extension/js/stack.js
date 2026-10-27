// Your stack: the tools you're using right now, worked out from GitHub. It
// looks at the repos you pushed to in the last two weeks: their languages,
// their package.json dependencies and a few telltale files (supabase/,
// Dockerfile, pubspec.yaml…). Repos you pushed to recently, and committed to
// most, count for more. The Learning and AI news tabs use the result to show
// what's relevant to your work.
import { load, save } from './store.js';
import { githubGet } from './github.js';
import { fetchFeed, fetchHackerNews, normalizeUrl } from './news.js';
import { devtoArticles } from './devto.js';

const STACK_KEY = 'workStack';
const NEWS_KEY = 'stackNews';
const STACK_STALE = 12 * 60 * 60 * 1000;
const NEWS_STALE = 60 * 60 * 1000;
const ACTIVE_DAYS = 14;
const DAY = 24 * 60 * 60 * 1000;
const PRERELEASE = /canary|alpha|beta|\brc\b|rc[.\d]|nightly|experimental|preview|insiders|-next|\bdev\b/i;

// What each tool looks like in a repo, and where to follow it.
//   deps / depPrefixes  package.json dependencies    languages  GitHub's language stats
//   files               paths in the repo             match      how to spot it in a headline
//   tags                dev.to tags                   hn         Hacker News search
//   feeds               official blogs                releases   GitHub repo whose releases to watch
//   topicId             the Learning topic it counts toward, when it maps to exactly one
export const TECHS = [
  { id: 'nextjs', name: 'Next.js', topicId: 'nextjs', hue: 210, deps: ['next'], match: /\bNext\.?js\b/i, tags: ['nextjs'], hn: 'Next.js', feeds: [{ name: 'Next.js blog', url: 'https://nextjs.org/feed.xml' }], releases: 'vercel/next.js' },
  { id: 'react', name: 'React', topicId: 'react', hue: 195, deps: ['react'], match: /\bReact(\.js)?\b(?! Native)/, tags: ['react'], hn: 'React', feeds: [{ name: 'React blog', url: 'https://react.dev/rss.xml' }], releases: 'facebook/react' },
  { id: 'typescript', name: 'TypeScript', topicId: 'typescript', hue: 215, deps: ['typescript'], languages: ['TypeScript'], match: /\bTypeScript\b/i, tags: ['typescript'], hn: 'TypeScript', feeds: [{ name: 'TypeScript blog', url: 'https://devblogs.microsoft.com/typescript/feed/' }] },
  { id: 'tailwind', name: 'Tailwind CSS', topicId: 'tailwind', hue: 190, deps: ['tailwindcss'], match: /\bTailwind\b/i, tags: ['tailwindcss'], hn: 'Tailwind', feeds: [{ name: 'Tailwind CSS blog', url: 'https://tailwindcss.com/feeds/feed.xml' }], releases: 'tailwindlabs/tailwindcss' },
  { id: 'supabase', name: 'Supabase', topicId: 'supabase', hue: 150, deps: ['@supabase/supabase-js', '@supabase/ssr'], files: /^supabase\//, match: /\bSupabase\b/i, tags: ['supabase'], hn: 'Supabase', feeds: [{ name: 'Supabase blog', url: 'https://supabase.com/rss.xml' }], releases: 'supabase/supabase-js' },
  { id: 'postgres', name: 'PostgreSQL', topicId: 'postgres', hue: 225, deps: ['pg', 'postgres', '@neondatabase/serverless'], languages: ['PLpgSQL'], files: /\.sql$/, match: /\bPostgres(QL)?\b/i, tags: ['postgres'], hn: 'Postgres' },
  { id: 'zod', name: 'Zod', hue: 240, deps: ['zod'], match: /\bZod\b/, tags: ['zod', 'typescript'], releases: 'colinhacks/zod' },
  { id: 'shadcn', name: 'shadcn/ui', hue: 0, deps: ['class-variance-authority'], depPrefixes: ['@radix-ui/'], files: /(^|\/)components\.json$/, match: /\b(shadcn|Radix UI)\b/i, tags: ['shadcn', 'react'], releases: 'shadcn-ui/ui' },
  { id: 'motion', name: 'Framer Motion', topicId: 'motion', hue: 320, deps: ['framer-motion', 'motion'], match: /\b(Framer Motion|Motion for React)\b/i, tags: ['framermotion', 'animation'], releases: 'motiondivision/motion' },
  { id: 'ai-sdk', name: 'Vercel AI SDK', hue: 270, deps: ['ai'], depPrefixes: ['@ai-sdk/'], match: /\b(AI SDK|Vercel AI)\b/i, tags: ['ai', 'llm'], hn: 'AI SDK', releases: 'vercel/ai', releaseFilter: /^ai@\d/ },
  { id: 'openai', name: 'OpenAI API', hue: 165, deps: ['openai', '@ai-sdk/openai'], match: /\bOpenAI\b/, tags: ['openai'], hn: 'OpenAI API' },
  { id: 'anthropic', name: 'Claude API', hue: 25, deps: ['@anthropic-ai/sdk', '@ai-sdk/anthropic'], match: /\b(Anthropic|Claude)\b/, tags: ['claude', 'anthropic'], hn: 'Claude' },
  { id: 'gemini', name: 'Gemini API', hue: 230, deps: ['@google/generative-ai', '@google/genai', '@ai-sdk/google'], match: /\bGemini\b/, tags: ['gemini'], hn: 'Gemini API' },
  { id: 'mcp', name: 'MCP', hue: 285, deps: ['@modelcontextprotocol/sdk', 'mcp-handler'], match: /\b(MCP|Model Context Protocol)\b/, tags: ['mcp'], hn: 'MCP', releases: 'modelcontextprotocol/typescript-sdk', releaseFilter: /^\d+\.\d+\.\d+$/ },
  { id: 'tanstack-query', name: 'TanStack Query', hue: 10, deps: ['@tanstack/react-query'], match: /\b(TanStack|React Query)\b/i, tags: ['reactquery', 'tanstack'], releases: 'TanStack/query' },
  { id: 'zustand', name: 'Zustand', hue: 35, deps: ['zustand'], match: /\bZustand\b/i, tags: ['zustand'], releases: 'pmndrs/zustand' },
  { id: 'redux', name: 'Redux Toolkit', hue: 265, deps: ['@reduxjs/toolkit'], match: /\bRedux\b/, tags: ['redux'] },
  { id: 'react-hook-form', name: 'React Hook Form', hue: 330, deps: ['react-hook-form'], match: /\bReact Hook Form\b/i, tags: ['reacthookform', 'react'], releases: 'react-hook-form/react-hook-form' },
  { id: 'tiptap', name: 'Tiptap', hue: 45, depPrefixes: ['@tiptap/'], match: /\b(Tiptap|ProseMirror)\b/i, tags: ['tiptap'], releases: 'ueberdosis/tiptap' },
  { id: 'react-flow', name: 'React Flow', hue: 340, deps: ['@xyflow/react', 'reactflow'], match: /\b(React Flow|xyflow)\b/i, tags: ['reactflow'], releases: 'xyflow/xyflow' },
  { id: 'recharts', name: 'Recharts', hue: 200, deps: ['recharts'], match: /\bRecharts\b/i, tags: ['recharts', 'dataviz'], releases: 'recharts/recharts' },
  { id: 'vitest', name: 'Vitest', hue: 90, deps: ['vitest'], match: /\bVitest\b/i, tags: ['vitest', 'testing'], releases: 'vitest-dev/vitest' },
  { id: 'playwright', name: 'Playwright', hue: 120, deps: ['playwright', '@playwright/test'], match: /\bPlaywright\b/i, tags: ['playwright'], releases: 'microsoft/playwright' },
  { id: 'prisma', name: 'Prisma', hue: 250, deps: ['prisma', '@prisma/client'], files: /(^|\/)schema\.prisma$/, match: /\bPrisma\b/, tags: ['prisma'], feeds: [{ name: 'Prisma blog', url: 'https://www.prisma.io/blog/rss.xml' }] },
  { id: 'drizzle', name: 'Drizzle ORM', hue: 75, deps: ['drizzle-orm'], match: /\bDrizzle\b/, tags: ['drizzle'], releases: 'drizzle-team/drizzle-orm' },
  { id: 'mongodb', name: 'MongoDB', topicId: 'mongodb', hue: 130, deps: ['mongodb', 'mongoose'], match: /\bMongo(DB)?\b/i, tags: ['mongodb'], hn: 'MongoDB' },
  { id: 'node', name: 'Node.js', topicId: 'node', hue: 110, deps: ['express', 'fastify', 'hono', 'koa', 'nodemailer'], match: /\bNode\.?js\b/i, tags: ['node'], hn: 'Node.js', feeds: [{ name: 'Node.js blog', url: 'https://nodejs.org/en/feed/blog.xml' }] },
  { id: 'stripe', name: 'Stripe', hue: 245, deps: ['stripe', '@stripe/stripe-js'], match: /\bStripe\b/, tags: ['stripe'] },
  { id: 'firebase', name: 'Firebase', topicId: 'firebase', hue: 40, deps: ['firebase', 'firebase-admin'], match: /\bFirebase\b/i, tags: ['firebase'] },
  { id: 'docker', name: 'Docker', topicId: 'docker', hue: 205, files: /(^|\/)(Dockerfile|docker-compose\.ya?ml|compose\.ya?ml)$/, match: /\bDocker\b/i, tags: ['docker'], hn: 'Docker', feeds: [{ name: 'Docker blog', url: 'https://www.docker.com/blog/feed/' }] },
  { id: 'vercel', name: 'Vercel', topicId: 'vercel', hue: 0, files: /(^|\/)vercel\.json$/, match: /\bVercel\b/, tags: ['vercel'], hn: 'Vercel' },
  { id: 'flutter', name: 'Flutter', topicId: 'flutter', hue: 200, languages: ['Dart'], files: /(^|\/)pubspec\.yaml$/, match: /\b(Flutter|Dart)\b/, tags: ['flutter'], hn: 'Flutter', feeds: [{ name: 'Flutter blog', url: 'https://medium.com/feed/flutter' }] },
  { id: 'python', name: 'Python', topicId: 'python', hue: 55, languages: ['Python'], files: /(^|\/)(requirements\.txt|pyproject\.toml)$/, match: /\bPython\b/, tags: ['python'], hn: 'Python' },
  { id: 'php', name: 'PHP', topicId: 'php', hue: 250, languages: ['PHP'], files: /(^|\/)composer\.json$/, match: /\b(PHP|WordPress|Laravel)\b/, tags: ['php'] },
  { id: 'apify', name: 'Apify & Crawlee', hue: 15, deps: ['apify', 'apify-client', 'crawlee'], match: /\b(Apify|Crawlee|web scraping)\b/i, tags: ['webscraping'], feeds: [{ name: 'Apify blog', url: 'https://blog.apify.com/rss/' }] },
  { id: 'shopify', name: 'Shopify', topicId: 'shopify', hue: 95, depPrefixes: ['@shopify/'], files: /(^|\/)shopify\.app\.toml$/, match: /\bShopify\b/, tags: ['shopify'] },
];

const techById = new Map(TECHS.map((t) => [t.id, t]));

// The Learning topic a tool's reading counts toward.
export const techTopicId = (tech) => tech.topicId || `stack-${tech.id}`;
export const techForTopic = (topicId) => TECHS.find((t) => techTopicId(t) === topicId);

export function cachedStack() {
  return load(STACK_KEY, null);
}

// Your top tools, most-used first, with the repos they were found in.
export function stackTechs(stack, count = 8) {
  return (stack?.techs || [])
    .map((found) => techById.has(found.id) && { ...techById.get(found.id), repos: found.repos, score: found.score })
    .filter(Boolean)
    .slice(0, count);
}

// The first of your tools that a headline is about, if any.
export function matchTech(techs, item) {
  const text = `${item.title} ${item.description || ''}`;
  return techs.find((t) => t.match.test(text)) || null;
}

let detecting = null;

// Re-checks GitHub twice a day (or when forced) while it's connected.
export async function ensureStack({ force = false } = {}) {
  const [auth, stack] = await Promise.all([load('githubAuth', null), load(STACK_KEY, null)]);
  if (!auth?.token) return stack;
  if (!force && stack?.login === auth.login && Date.now() - stack.detectedAt < STACK_STALE) return stack;
  detecting ??= detectStack(auth.token, auth.login)
    .then(async (result) => {
      await save(STACK_KEY, result);
      return result;
    })
    .finally(() => { detecting = null; });
  return detecting;
}

export async function detectStack(token, login) {
  const repos = await githubGet(token, token
    ? '/user/repos?sort=pushed&per_page=40&affiliation=owner,collaborator,organization_member'
    : `/users/${encodeURIComponent(login)}/repos?sort=pushed&per_page=40`);
  const now = Date.now();
  const active = repos
    .filter((r) => !r.archived && now - Date.parse(r.pushed_at) < ACTIVE_DAYS * DAY)
    .slice(0, 8);

  // Commits from the Work tab's saved days make a repo count for more.
  const workLog = await load('workLog', []);
  const commits = new Map();
  for (const day of workLog.slice(0, ACTIVE_DAYS)) {
    for (const repo of day.repos || []) commits.set(repo.name, (commits.get(repo.name) || 0) + repo.count);
  }

  const scores = new Map();
  const results = await Promise.all(active.map((repo) => repoTools(token, repo).catch(() => null)));
  active.forEach((repo, i) => {
    if (!results[i]) return;
    const age = now - Date.parse(repo.pushed_at);
    const weight = (age < DAY ? 3 : age < 3 * DAY ? 2 : 1) + Math.min(commits.get(repo.full_name) || 0, 20) / 4;
    for (const id of results[i]) {
      const entry = scores.get(id) || { id, score: 0, repos: [] };
      entry.score += weight;
      entry.repos.push(repo.name);
      scores.set(id, entry);
    }
  });

  return {
    login,
    detectedAt: now,
    repos: active.map((r) => ({ name: r.full_name, pushedAt: Date.parse(r.pushed_at) })),
    techs: [...scores.values()]
      .sort((a, b) => b.score - a.score || TECHS.indexOf(techById.get(a.id)) - TECHS.indexOf(techById.get(b.id))),
  };
}

// The ids of the tools a repo uses.
async function repoTools(token, repo) {
  const name = repo.full_name;
  const [languages, tree] = await Promise.all([
    githubGet(token, `/repos/${name}/languages`).catch(() => ({})),
    githubGet(token, `/repos/${name}/git/trees/${encodeURIComponent(repo.default_branch)}?recursive=1`).catch(() => ({ tree: [] })),
  ]);
  const paths = (tree.tree || [])
    .filter((t) => t.type === 'blob' && !/(^|\/)(node_modules|vendor|\.next|dist)\//.test(t.path))
    .map((t) => t.path);

  // The root package.json and a few in subfolders (monorepos).
  const manifests = paths
    .filter((p) => /(^|\/)package\.json$/.test(p) && p.split('/').length <= 3)
    .sort((a, b) => a.split('/').length - b.split('/').length)
    .slice(0, 4);
  const deps = new Set();
  await Promise.all(manifests.map(async (path) => {
    try {
      const file = await githubGet(token, `/repos/${name}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(repo.default_branch)}`);
      const pkg = JSON.parse(decodeBase64(file.content));
      Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).forEach((d) => deps.add(d));
    } catch {
      // An unreadable package.json just tells us less.
    }
  }));

  const totalBytes = Object.values(languages).reduce((n, b) => n + b, 0) || 1;
  const uses = (tech) => (tech.deps || []).some((d) => deps.has(d))
    || (tech.depPrefixes || []).some((prefix) => [...deps].some((d) => d.startsWith(prefix)))
    || (tech.languages || []).some((lang) => (languages[lang] || 0) / totalBytes >= 0.1)
    || (tech.files ? paths.some((p) => tech.files.test(p)) : false);
  return TECHS.filter(uses).map((t) => t.id);
}

function decodeBase64(text) {
  const binary = atob((text || '').replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

// --- What's new in your stack --------------------------------------------------

// The latest from your tools: official blog posts, stable releases, Hacker News
// discussions and DEV articles, taking each tool's best in turn.
export async function stackNews(techs, { force = false } = {}) {
  const key = techs.map((t) => t.id).join();
  const cached = await load(NEWS_KEY, null);
  if (!force && cached?.key === key && Date.now() - cached.fetchedAt < NEWS_STALE) return cached.items;
  const lists = await Promise.all(techs.map((tech) => techNews(tech).catch(() => [])));
  const items = [];
  const seen = new Set();
  for (let i = 0; lists.some((list) => i < list.length); i += 1) {
    for (const list of lists) {
      const item = list[i];
      if (!item || seen.has(normalizeUrl(item.url))) continue;
      seen.add(normalizeUrl(item.url));
      items.push(item);
    }
  }
  await save(NEWS_KEY, { key, fetchedAt: Date.now(), items: items.slice(0, 48) });
  return items;
}

export async function cachedStackNews() {
  return (await load(NEWS_KEY, null))?.items || [];
}

async function techNews(tech) {
  const topic = { id: techTopicId(tech), tags: tech.tags, hue: tech.hue };
  const jobs = [
    ...(tech.feeds || []).map((f) => fetchFeed({ id: `stack-${tech.id}`, name: f.name, group: 'stack', url: f.url }, { limit: 2 })),
    tech.releases ? latestRelease(tech) : null,
    tech.hn ? fetchHackerNews({ query: tech.hn, days: 7, minPoints: 30, limit: 4 }).then((list) => list.filter((i) => tech.match.test(i.title)).slice(0, 2)) : null,
    devtoArticles(topic, 7).then((list) => list.slice(0, 2)),
  ].filter(Boolean);
  const settled = await Promise.allSettled(jobs);
  return settled
    .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    .map((item) => ({ ...item, techId: tech.id, topicId: techTopicId(tech), hue: tech.hue, kind: 'stack' }));
}

// The newest stable release from the last two weeks.
async function latestRelease(tech) {
  const owner = tech.releases.split('/')[0];
  const releases = await fetchFeed({ id: `release-${tech.id}`, name: `${tech.name} on GitHub`, group: 'stack', url: `https://github.com/${tech.releases}/releases.atom` }, { limit: 10 });
  const stable = releases.find((r) => !PRERELEASE.test(r.title) && (!tech.releaseFilter || tech.releaseFilter.test(r.title)));
  if (!stable) return [];
  const version = stable.title.replace(/^.*@/, '').replace(/^v/, '');
  return [{
    ...stable,
    id: `release:${tech.releases}:${version}`,
    title: `${tech.name} ${version} is out`,
    image: `https://github.com/${owner}.png?size=400`,
    imageFit: 'contain',
  }];
}
