// Chrome keeps running the background code it loaded (background.js and the
// modules it imports) until the extension is reloaded on chrome://extensions;
// restarting Chrome or the computer doesn't refresh it. The dashboard, though,
// reads these files fresh on every new tab. Bump this number whenever the
// background code changes: the dashboard compares it with the number the
// background reports, and offers a reload when they differ.
export const BACKGROUND_VERSION = 2;
