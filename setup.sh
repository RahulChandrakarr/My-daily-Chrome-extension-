#!/usr/bin/env bash
# Sets up the My Daily Chrome extension on this Mac.
#
#   ./setup.sh            check the files, make icons if needed, open Chrome's Extensions page
#   ./setup.sh --no-open  do everything except open Chrome
#
# Nothing is installed system-wide. Chrome loads the extension straight from
# the extension/ folder next to this script.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT="$ROOT/extension"
OPEN_CHROME=1
[[ "${1:-}" == "--no-open" ]] && OPEN_CHROME=0

if [[ -t 1 ]]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; RESET=$'\033[0m'
else
  BOLD=''; DIM=''; GREEN=''; YELLOW=''; RED=''; RESET=''
fi
step() { printf '\n%s%s%s\n' "$BOLD" "$1" "$RESET"; }
ok()   { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$1"; }
warn() { printf '  %s!%s %s\n' "$YELLOW" "$RESET" "$1"; }
fail() { printf '  %s✗ %s%s\n' "$RED" "$1" "$RESET"; exit 1; }

step "Checking the extension files"
REQUIRED=(
  manifest.json dashboard.html background.js css/dashboard.css fonts/BricolageGrotesque.woff2
  js/app.js js/cards.js js/dates.js js/devto.js js/feed.js js/github.js js/learning.js js/net.js js/news.js js/preview.js
  js/settings.js js/sources.js js/stack.js js/store.js js/suggestions.js js/sync.js js/tasks.js js/theme-boot.js js/topics.js js/trending.js js/ui.js js/work.js
)
for file in "${REQUIRED[@]}"; do
  [[ -f "$EXT/$file" ]] || fail "Missing extension/$file"
done
ok "All ${#REQUIRED[@]} files are in place"

# JavaScript for Automation ships with macOS, so this needs no extra tools.
if VERSION=$(osascript -l JavaScript -e '
  function run(argv) {
    const text = $.NSString.stringWithContentsOfFileEncodingError(argv[0], $.NSUTF8StringEncoding, null).js;
    return JSON.parse(text).version;
  }' "$EXT/manifest.json" 2>/dev/null); then
  ok "manifest.json is valid (version $VERSION)"
else
  fail "extension/manifest.json isn't valid JSON. Fix it, then run setup again."
fi

step "Checking the icons"
MISSING_ICONS=0
for size in 16 32 48 128; do
  [[ -f "$EXT/icons/icon-$size.png" ]] || MISSING_ICONS=1
done
if [[ $MISSING_ICONS -eq 0 ]]; then
  ok "Icons are in place"
elif xcode-select -p >/dev/null 2>&1 && command -v python3 >/dev/null; then
  python3 "$ROOT/tools/make_icons.py"
  ok "Made the icons"
else
  warn "Icons are missing and Python isn't available to draw them. Chrome will show a plain letter instead."
fi

step "Looking for Google Chrome"
if [[ -d "/Applications/Google Chrome.app" || -d "$HOME/Applications/Google Chrome.app" ]]; then
  ok "Google Chrome is installed"
else
  warn "Google Chrome wasn't found in Applications. Install it from google.com/chrome, then run setup again."
  OPEN_CHROME=0
fi

printf '%s' "$EXT" | pbcopy
ok "Copied the extension folder's path to your clipboard"

if [[ $OPEN_CHROME -eq 1 ]]; then
  open -a "Google Chrome" "chrome://extensions/" 2>/dev/null \
    && ok "Opened Chrome's Extensions page" \
    || warn "Couldn't open Chrome. Go to chrome://extensions yourself."
fi

cat <<EOF

${BOLD}Finish in Chrome${RESET} (one time only)
  1. On the Extensions page (chrome://extensions), turn on ${BOLD}Developer mode${RESET} at the top right.
  2. Click ${BOLD}Load unpacked${RESET}.
  3. Press ${BOLD}Cmd+Shift+G${RESET}, paste the path (it's on your clipboard), press Enter, then click ${BOLD}Select${RESET}:
     ${DIM}$EXT${RESET}
  4. Open a new tab. If Chrome asks whether this is the new tab page you expected, click ${BOLD}Keep it${RESET}.

${BOLD}Optional: sync with Supabase${RESET}
  Run supabase/schema.sql in your project's SQL editor, then open Settings on the dashboard
  and add your project URL and publishable key. README.md has the details.

${DIM}After changing any code, click the reload icon on My Daily in chrome://extensions.${RESET}
EOF
