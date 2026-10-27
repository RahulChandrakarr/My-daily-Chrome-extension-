// Local-calendar date helpers. Due dates are stored as 'YYYY-MM-DD' strings in
// local time, so "today" follows the clock on this computer rather than UTC.

const DAY = 24 * 60 * 60 * 1000;

export function dateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key, days) {
  const date = parseKey(key);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

export function daysBetween(fromKey, toKey) {
  return Math.round((parseKey(toKey) - parseKey(fromKey)) / DAY);
}

export function formatDue(key, today = dateKey()) {
  const diff = daysBetween(today, key);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  const date = parseKey(key);
  if (diff > 1 && diff < 7) return date.toLocaleDateString(undefined, { weekday: 'long' });
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export function timeAgo(ms, now = Date.now()) {
  const seconds = Math.round((ms - now) / 1000);
  if (Math.abs(seconds) < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return relative.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relative.format(hours, 'hour');
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 7) return relative.format(days, 'day');
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
