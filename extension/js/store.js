// Thin wrapper over chrome.storage.local. Falls back to localStorage so
// dashboard.html can also be opened as a plain file while developing.

const area = globalThis.chrome?.storage?.local;

export async function load(key, fallback) {
  if (area) {
    const result = await area.get(key);
    return result[key] ?? fallback;
  }
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export async function save(key, value) {
  if (area) return area.set({ [key]: value });
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the in-memory copy still works for this tab.
  }
}

// chrome.storage hands values back with object keys sorted, so a value read
// back never matches JSON.stringify of what was saved. Compare with this.
export function stableJson(value) {
  return JSON.stringify(value, (key, v) => (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    : v));
}

// Calls back when another tab (or the sync engine) changes a key.
export function watch(key, callback) {
  if (area) {
    chrome.storage.onChanged.addListener((changes, name) => {
      if (name === 'local' && key in changes) callback(changes[key].newValue);
    });
    return;
  }
  window.addEventListener('storage', (event) => {
    if (event.key === key) callback(event.newValue ? JSON.parse(event.newValue) : undefined);
  });
}
