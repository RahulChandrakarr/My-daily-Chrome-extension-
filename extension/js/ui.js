// Small DOM helpers. Text from feeds is always set with textContent, never
// innerHTML, so a hostile feed can't inject markup into the dashboard.

export function el(tag, className, attrs = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const [name, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (name === 'text') node.textContent = value;
    else node.setAttribute(name, value === true ? '' : value);
  }
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  close: 'M6 6l12 12M18 6L6 18',
  edit: 'M4.5 19.5h3.8L19 8.8a2.4 2.4 0 0 0-3.4-3.4L4.5 15.7v3.8zM14 7l3.4 3.4',
  trash: 'M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.9 12a1.8 1.8 0 0 0 1.8 1.6h5.6a1.8 1.8 0 0 0 1.8-1.6l.9-12M10 11v6M14 11v6',
  star: 'M12 3.8l2.5 5.1 5.6.8-4 3.9 1 5.6-5.1-2.6-5 2.6 1-5.6-4.1-3.9 5.6-.8z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  notes: 'M5 7h14M5 12h14M5 17h9',
  refresh: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4.2h-4.2',
};

export function icon(name, size = 18) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({
    viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor',
    'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
  })) svg.setAttribute(k, v);
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICONS[name]);
  svg.append(path);
  return svg;
}

// Only http(s) links get through, so a feed can't smuggle in javascript: URLs.
export function safeUrl(value, base) {
  if (!value) return null;
  try {
    const url = new URL(value, base);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

// Parses third-party HTML without loading anything it references. A template's
// content is inert: no scripts run, no images load and, unlike DOMParser,
// Chrome doesn't preload the page's fonts and stylesheets.
export function inertHtml(html) {
  const template = document.createElement('template');
  template.innerHTML = html || '';
  template.content.querySelectorAll('script, style, noscript, template').forEach((node) => node.remove());
  return template.content;
}

export function clip(text, max = 260) {
  if (!text) return '';
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max).replace(/\s+\S*$/, '')}…` : clean;
}

const compactFormat = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
export const compact = (n) => compactFormat.format(n || 0);

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

let toastTimer = null;

export function toast(message, action) {
  const box = document.getElementById('toast');
  box.replaceChildren(el('span', '', { text: message }));
  if (action) {
    const button = el('button', 'toast-action', { type: 'button', text: action.label });
    button.addEventListener('click', () => {
      action.run();
      box.hidden = true;
    });
    box.append(button);
  }
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, 6000);
}
