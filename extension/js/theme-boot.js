// Applies a saved light/dark choice before the page paints, so it doesn't flash.
try {
  const theme = localStorage.getItem('theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch {
  // Storage blocked: fall back to the system setting.
}
