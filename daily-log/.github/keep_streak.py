"""Keep my streak, run by GitHub Actions in your daily-log repo.

A backup for My Daily's evening check, which only runs while your computer is
awake and Chrome is open. This runs on GitHub's servers, so it works with the
computer off.

It reads your public contribution graph (the one everyone sees, with private
contributions included when that's on in your profile settings). If today's
square is empty, it commits a short check-in file as you, so the square turns
green. If you contributed anything today, or My Daily already committed the
day's log, it does nothing.

Settings, all from the environment:
  LOG_TZ    your time zone (default Asia/Kolkata); "today" is today there
  DRY_RUN   set to 1 to print what would happen without committing
  TODAY     a YYYY-MM-DD date to check instead of today (for testing)
"""

import datetime
import json
import os
import pathlib
import re
import subprocess
import sys
import urllib.request
import zoneinfo

LOGIN = os.environ.get("GITHUB_REPOSITORY_OWNER", "")
TOKEN = os.environ.get("GITHUB_TOKEN", "")
TZ = zoneinfo.ZoneInfo(os.environ.get("LOG_TZ", "Asia/Kolkata"))
DRY_RUN = os.environ.get("DRY_RUN") == "1"


def fetch(url, data=None):
    headers = {"User-Agent": "daily-log-keep-streak"}
    if TOKEN and url.startswith("https://api.github.com"):
        headers["Authorization"] = f"Bearer {TOKEN}"
    if data is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(data).encode()
    request = urllib.request.Request(url, data=data, headers=headers)
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode()


def contributions_on(day):
    """Today's count from the public graph: the page first, then the API."""
    try:
        page = fetch(f"https://github.com/users/{LOGIN}/contributions")
        cell = re.search(rf'<td\b[^>]*\bdata-date="{day}"[^>]*>', page)
        if cell:
            cell_id = re.search(r'\bid="([^"]+)"', cell.group(0))
            tip = cell_id and re.search(rf'<tool-tip\b[^>]*\bfor="{re.escape(cell_id.group(1))}"[^>]*>\s*(\d+|No)\b', page)
            if tip:
                return 0 if tip.group(1) == "No" else int(tip.group(1))
            level = re.search(r'\bdata-level="(\d)"', cell.group(0))
            if level:
                return int(level.group(1))  # 0 means none; above 0, at least one
    except Exception as error:  # noqa: BLE001 - fall back to the API
        print(f"Couldn't read the contributions page ({error}), asking the API")
    query = """query($login: String!) { user(login: $login) { contributionsCollection {
      contributionCalendar { weeks { contributionDays { date contributionCount } } } } } }"""
    data = json.loads(fetch("https://api.github.com/graphql", {"query": query, "variables": {"login": LOGIN}}))
    weeks = data["data"]["user"]["contributionsCollection"]["contributionCalendar"]["weeks"]
    for week in weeks:
        for d in week["contributionDays"]:
            if d["date"] == day:
                return d["contributionCount"]
    raise SystemExit(f"{day} isn't on the contribution graph yet")


def git(*args):
    subprocess.run(["git", *args], check=True)


def main():
    if not LOGIN:
        raise SystemExit("GITHUB_REPOSITORY_OWNER isn't set")
    now = datetime.datetime.now(TZ)
    # A run GitHub started late, after midnight, would land on the wrong day.
    if now.hour < 6 and not os.environ.get("TODAY"):
        print(f"It's {now:%H:%M}, past midnight, so it's too late for yesterday and too early for today.")
        return
    day = os.environ.get("TODAY") or now.date().isoformat()
    date = datetime.date.fromisoformat(day)

    count = contributions_on(day)
    if count:
        print(f"{day}: you have contributions on GitHub, so there's nothing to do.")
        return

    path = pathlib.Path(f"{date:%Y}/{day}.md")
    if path.exists():
        print(f"{path} is already committed (the graph can take a few minutes to catch up).")
        return

    user = json.loads(fetch(f"https://api.github.com/users/{LOGIN}"))
    author = f"{user.get('name') or LOGIN} <{user['id']}+{LOGIN}@users.noreply.github.com>"
    long_date = f"{date:%A}, {date.day} {date:%B %Y}"
    text = (
        f"# {long_date}\n\n"
        f"Nothing on GitHub by {now:%H:%M} ({TZ.key}), and My Daily didn't write the day's log "
        "(the computer was probably off or asleep), so the Keep my streak workflow committed this check-in.\n"
    )
    subject = f"Daily check-in for {date:%a} {date.day} {date:%b}"
    message = f"{subject}\n\nNo other contribution on GitHub today and no log from My Daily, so the streak workflow committed this check-in."
    print(f"{day}: no contributions. Committing {path} as {author}: {subject}")
    if DRY_RUN:
        print("--- (dry run, nothing committed) ---\n" + text)
        return

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    name, email = author[: author.index(" <")], author[author.index("<") + 1 : -1]
    git("add", str(path))
    git("-c", f"user.name={name}", "-c", f"user.email={email}", "commit", "-q", "-m", message)
    git("push", "-q")


if __name__ == "__main__":
    main()
