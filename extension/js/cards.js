// Story cards shared by the news and learning tabs: image, source, title,
// description and a row of actions. A story without an image or description
// gets one from the article's Open Graph tags once its card nears the viewport.
import { cachedPreview, fetchPreview } from './preview.js';
import { sourceHue } from './sources.js';
import { timeAgo } from './dates.js';
import { el, compact } from './ui.js';

const observer = new IntersectionObserver(onIntersect, { rootMargin: '600px 0px' });
const pendingCards = new WeakMap();

export function renderCard(item, { lead = false, topic = null, foot = null, read = false, onOpen = null } = {}) {
  const preview = cachedPreview(item.url);
  const image = item.image || preview?.image;
  const description = item.description || preview?.description;

  const card = el('article', lead ? 'card card--lead' : 'card');
  card.style.setProperty('--hue', item.hue ?? sourceHue(item.source));
  card.classList.toggle('is-read', read);

  const media = el('div', ['card-media', item.video && 'is-video', item.imageFit === 'contain' && 'is-logo'].filter(Boolean).join(' '));
  if (image) setImage(media, image, item);
  else setCover(media, item);

  const meta = el('div', 'card-meta');
  if (topic) meta.append(el('span', 'card-topic', { text: topic, title: topic }));
  meta.append(el('span', 'card-source', { text: item.sourceName }));
  if (item.publishedAt) {
    meta.append(el('time', 'card-time', { datetime: new Date(item.publishedAt).toISOString(), text: timeAgo(item.publishedAt) }));
  }
  if (item.readingTime) meta.append(el('span', 'card-time', { text: `${item.readingTime} min read` }));
  if (item.views) meta.append(el('span', 'card-time', { text: `${compact(item.views)} views` }));
  (item.metaExtra || []).forEach((text) => meta.append(el('span', 'card-time', { text })));

  const title = el('h3', 'card-title');
  const link = el('a', '', { href: item.url, text: item.title });
  if (onOpen) {
    link.addEventListener('click', () => onOpen(card));
    link.addEventListener('auxclick', (event) => { if (event.button === 1) onOpen(card); });
  }
  title.append(link);

  const body = el('div', 'card-body');
  body.append(meta, title);
  if (description) body.append(el('p', 'card-desc', { text: description }));
  if (foot) body.append(foot);
  card.append(media, body);

  if (!preview && (!image || !description) && !item.url.startsWith('https://news.ycombinator.com/')) {
    pendingCards.set(card, { item, needsImage: !image });
    observer.observe(card);
  }
  return card;
}

// Stops watching cards that are about to be removed from the page.
export function releaseCards(container) {
  container.querySelectorAll('.card').forEach((card) => observer.unobserve(card));
}

export function renderSkeletons(container, count = 6) {
  container.replaceChildren(...Array.from({ length: count }, () => {
    const card = el('div', 'card is-skeleton', { 'aria-hidden': 'true' });
    card.append(el('div', 'card-media'), el('div', 'card-body'));
    return card;
  }));
}

function onIntersect(entries) {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const card = entry.target;
    observer.unobserve(card);
    const pending = pendingCards.get(card);
    if (!pending) continue;
    fetchPreview(pending.item.url).then((preview) => {
      if (!card.isConnected) return;
      if (pending.needsImage && preview.image) setImage(card.querySelector('.card-media'), preview.image, pending.item);
      if (preview.description && !card.querySelector('.card-desc')) {
        card.querySelector('.card-title').after(el('p', 'card-desc', { text: preview.description }));
      }
    });
  }
}

function setImage(media, src, item) {
  const img = el('img', '', { src, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
  img.addEventListener('load', () => media.classList.add('is-loaded'));
  img.addEventListener('error', () => {
    // e.g. a YouTube video without a large thumbnail falls back to the small one.
    if (item.imageFallback && src !== item.imageFallback) setImage(media, item.imageFallback, item);
    else setCover(media, item);
  });
  media.classList.remove('is-cover');
  media.replaceChildren(img);
}

// Shown when a story has no usable image: its name (or its source's) on a tint.
function setCover(media, item) {
  media.classList.add('is-cover');
  media.replaceChildren(el('span', 'cover-name', { text: item.coverText || item.sourceName }));
}
