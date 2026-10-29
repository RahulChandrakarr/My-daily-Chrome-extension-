# My Daily

A Chrome extension that turns every new tab into your daily dashboard. The left column holds your to-do list, the open tab's log (Learning log or Work history) and GitHub Trending. The rest of the width is for AI news, Learning or Work.

- **To-do list**: tasks with due dates (overdue, today, upcoming, anytime), an important star, notes and links. The toolbar icon's badge shows how many are due. Write out everything you need to do in one go and **Analyse** splits it into separate tasks. With GitHub connected, a task is marked done when you push a commit that matches it, and the Done section shows, day by day, what you pushed and what you finished.
- **Trending on GitHub**: the list from github.com/trending, with the stars each repo gained today, this week or this month, filtered by language if you like. GitHub has no API for this page, so the extension reads the page itself, at most once an hour.
- **AI news**: the latest from The Verge, TechCrunch, MIT Technology Review, Ars Technica, Wired, OpenAI, Google AI, Google DeepMind, Hugging Face, AI stories trending on Hacker News, and Hugging Face's daily papers. Each story has a title, description and image. Also:
  - **Your stack**: news about the tools you use (from GitHub). Fresh stories about them also go to the top of Headlines, labelled with the tool's name.
  - **Models**: what's trending on Hugging Face, and what's downloaded most.
- **Learning**, in sub-tabs:
  - **Your stack**: the tools in the repos you push to (Next.js, Supabase and so on), with what's new in them (official blogs, new releases, Hacker News, DEV), videos about them, and in-depth articles to master your top three.
  - **Suggested**: the most-hyped YouTube videos and most-discussed posts this week across your interests (AI, Web & Next.js, Robotics).
  - **Today**: three articles to learn from (one from your stack, one from your resume, one from your interests) and your progress.
  - **One tab per interest**: its top videos, trending stories and articles to study.
  - **All topics**: every topic, including all the skills on your resume, with how much of each you've covered.
  - Every item has a "Read it" (or "Watched it") and "Tried it" checkbox. These feed your streak, weekly counts and learning log.
- **Work** (connect GitHub): what you pushed today and yesterday, as commits by repo and branch, lines changed, the folders you worked in, and pull requests you opened, merged or reviewed. Each day gets a few short bullets on what you worked on and where, and a daily summary is written automatically at a time you choose. Your GitHub contribution graph (the green squares from your profile) sits below, with your current and longest streak.
- **Supabase sync** (optional): tasks, learning log, work history and settings are saved locally first, so everything is instant, then synced to your own Supabase project.

It runs only in your Chrome. Nothing goes through the Chrome Web Store.

## Setup

```bash
cd ~/Downloads/Rahul/my-daily
./setup.sh
```

The script checks the files, draws the icons if they're missing, copies the extension folder's path to your clipboard and opens `chrome://extensions`. Then, once:

1. Turn on **Developer mode** (top right).
2. Click **Load unpacked**, press **Cmd+Shift+G**, paste the path and click **Select**.
3. Open a new tab. If Chrome asks whether this is the new tab page you expected, click **Keep it**. "Change it back" turns the extension off.

The extension loads straight from `extension/`, so keep that folder where it is. After you edit any code, click the reload icon on My Daily in `chrome://extensions`.

## Using it

| Where | What you can do |
| --- | --- |
| To-do | Type a task and press Enter (Shift+Enter starts a new line; the box grows). **+** adds it, and a pasted list becomes one task per line. **✦ Analyse** reads a whole paragraph ("I have to call Priya, then fix the login bug and send the invoice tomorrow, it's urgent…") and proposes separate tasks, with due days and stars picked up from the words. Check them, edit or leave any out, then add them all. Pick Today, Tomorrow, No date or a date first for tasks that don't say. Click a task to edit its title, notes or date, or to delete it (with undo). |
| AI news | Switch between Your stack, Headlines, News, AI labs, Hacker News, Papers and Models. **To-do** on a card adds the story to your list. News refreshes every 15 minutes while a tab is open. |
| Learning | Switch between Your stack, Suggested, Today, your interests and All topics. **Scan again** re-checks GitHub for your tools (it does so on its own twice a day). Tick **Read it**, **Watched it** or **Tried it** on anything. **Different picks** swaps today's lessons. In All topics, pick a topic to see its best articles. A topic counts as covered after 5 articles. |
| Work | Switch between Today, Yesterday and earlier days. **Listen** reads the summary aloud, **Copy summary** copies it as Markdown bullets for a standup or a chat, and **Refresh** checks GitHub again (it also does that every 10 minutes while the tab is open). Hover a square in the contribution graph for that day's count. |
| Settings (top right) | Your name, light or dark, Supabase sync, GitHub and the time of the daily summary, learning topics (turn off, or add your own), news sources, and backup or restore. |

Keyboard: `/` jumps to search, `n` jumps to the new-task box.

## Syncing with Supabase

1. Create a project at [supabase.com](https://supabase.com), or use one you already have.
2. Open **SQL Editor → New query**, paste [supabase/schema.sql](supabase/schema.sql) and click **Run**. It creates four tables (`tasks`, `learning_log`, `work_log`, `preferences`) with row-level security, so each signed-in user can only reach their own rows. It's safe to run again.
3. In **Project Settings → API Keys**, copy the project URL and the **publishable** key (`sb_publishable_…`, or the legacy `anon` key). Never use the secret or `service_role` key here.
4. On the dashboard, open **Settings → Sync with Supabase**, paste both and click **Save project**.
5. Click **Create account** with an email and password, then **Sign in**. If your project requires email confirmation, click the link Supabase emails you first. To skip confirmation, turn off **Confirm email** under Authentication → Sign In / Providers → Email.

Once signed in, changes upload about a second after you make them. Changes from your other devices download when you open a tab, when you come back to one, and every 2 minutes while it's open. A green dot on the Settings button means sync is working, and a red dot means it needs attention. If two devices edit the same thing, the newer edit wins, and the database enforces that too.

## Connecting GitHub

1. Create a [classic personal access token](https://github.com/settings/tokens/new?scopes=repo&description=My%20Daily) with the **repo** scope. Without it, private and work repositories don't show up. Give it an expiry date you're comfortable with.
2. If a work organisation uses single sign-on, click **Configure SSO** next to the token and authorise it for that organisation.
3. On the dashboard, open **Settings → GitHub**, paste the token and click **Connect**. The Work tab fills in right away.
4. Pick when the daily summary is written (6:00 PM by default), and whether it also appears as a notification. Clicking the notification opens that day in the Work tab.

**Your stack** comes from the repos you pushed to in the last two weeks: their languages, `package.json` dependencies and telltale files (`supabase/`, `Dockerfile`, `vercel.json`…). Repos you pushed to recently, and committed to most, count for more. The list of tools it recognises, and where to follow each one, is in [extension/js/stack.js](extension/js/stack.js).

**How Analyse splits your text:** when your Chrome has its built-in on-device AI (Gemini Nano, through Chrome's Prompt API), that does the splitting. It's free and private, and nothing leaves your computer. The first time, Chrome may need to download the model, and until it's ready a rule-based splitter is used. That splitter handles lists, sentences, "then", "also" and "and <verb>", strips openers like "I have to", reads "today", "tomorrow" and "by Friday" as due days, and reads "urgent" or "ASAP" as important. The preview says which one was used.

**To-do items done by commits:**
- **What matches:** a commit matches an open task when it shares at least two of the task's keywords, covering 60% or more of them. Generic words like "fix", "add" and "update" don't count, so "Fix login redirect" is matched by "fix: login redirect loop" but not by "fix: signup redirect".
- **Timing:** only commits made after the task was created count. They're checked every 10 minutes while a dashboard tab is open.
- **Wrong match:** untick the task (or press **Undo**) and that commit won't be matched to it again.
- **Turn it off:** in **Settings → GitHub**.

**Why a push might not show in your contribution graph.** The graph is GitHub's own, so GitHub's rules decide what counts. A commit counts when:
- it was made with an email address linked to your GitHub account,
- it's on the repository's default branch (feature-branch commits count once merged),
- the repository isn't a fork,
- for private repositories, "Include private contributions" is on in your profile settings.

Check a repo with `git config user.email`. If it shows someone else's address (a shared team account, say), set your own for that repo with `git config user.email you@example.com`.

How the Work tab finds your commits:
- **Which pushes:** your GitHub event feed lists each push, and the extension expands each one into its commits. Only commits you authored count, so teammates' commits merged into your branch aren't included. Merge commits are listed but not counted.
- **Line counts** leave out lockfiles and build output.
- **Which day:** a commit belongs to the day it was made, by its commit time (a rebase or amend moves it to that day).
- **Delay:** GitHub's event feed can lag by a few minutes, and occasionally longer, so a push you just made may take a moment to show.
- **Token storage:** the token is stored only in this Chrome profile. It isn't in backups and isn't sent to Supabase.

## Where your data lives

Without Supabase, everything is in this Chrome profile's extension storage. Removing the extension deletes it, so use **Settings → Export backup** now and then. The backup is a JSON file with your tasks and learning log; **Import backup** restores it.

The extension contacts only the news and learning sources listed above, dev.to (for learning articles), the article pages it reads preview images from, GitHub's API if you connect it, and your Supabase project if you set one up.

## How news images work

Most feeds include an image. When a story doesn't (TechCrunch, OpenAI and every Hacker News link), the dashboard reads the article's own preview image and description from its Open Graph tags. That logic is ported from `uptime/app/api/site-preview/route.ts`: `og:image`, then `twitter:image`; `og:title`, then `<title>`; plus `og:description`. It runs inside the extension instead of a server:

- Only the page's `<head>` is downloaded.
- The fetch runs in the background service worker, so the site's fonts and scripts are never loaded.
- Results are cached for a week.

If a site blocks the request, the card shows a tinted cover with the source's name.

## How suggestions work

- **Videos** come from YouTube's public channel feeds, which include each video's view count. That means no API key, and no scraping of YouTube's pages, which breaks often. Videos from the last two weeks are ranked by "hype": views, weighted toward videos that got them quickly. Each row takes at most one video per channel, so one big channel can't fill it.
- **Posts** come from Hacker News (front-page stories from the last 3 days that match an interest), DEV Community (this week's most-liked articles) and Lobsters (its hottest stories). The list takes each site's best in turn.
- Both refresh every 45 minutes while the Learning tab is open. **Refresh** fetches immediately.

## Changing sources and topics

- **News feeds**: [extension/js/sources.js](extension/js/sources.js). Copy an entry, give it a new `id` and any RSS or Atom URL.
- **Learning topics and YouTube channels**: [extension/js/topics.js](extension/js/topics.js) has your interests and the skills from your resume, each with dev.to tags, trending feeds and, for interests, YouTube channels. To add a channel, open its page, view the page source, search for `channelId` and add `{ name, id }` to the topic's `channels`. For quick topic additions, use **Settings → Learning topics → Add a topic** instead.

## Files

```
my-daily/
├── setup.sh                 checks files, makes icons, opens Chrome's Extensions page
├── supabase/schema.sql      tables, row-level security and the sync trigger
├── tools/make_icons.py      draws the icons (Python standard library only)
└── extension/               the folder Chrome loads
    ├── manifest.json
    ├── dashboard.html       the new tab page
    ├── background.js        toolbar badge, end-of-day work summary, fetches feeds and pages
    ├── css/dashboard.css
    ├── fonts/               Bricolage Grotesque (SIL Open Font License)
    ├── icons/
    └── js/
        ├── app.js           start-up, header, tabs, search, shortcuts
        ├── tasks.js         to-do list
        ├── tasksplit.js     Analyse: splits a paragraph into tasks
        ├── feed.js          AI news tab
        ├── news.js          fetching and parsing feeds, Hacker News, Hugging Face
        ├── learning.js      Learning sub-tabs, daily brief, Read it / Tried it, stats, log
        ├── suggestions.js   hyped YouTube videos and posts
        ├── devto.js         DEV Community articles, cached
        ├── topics.js        your interests and resume topics
        ├── cards.js         the story card shared by both tabs
        ├── preview.js       Open Graph preview images (ported from uptime)
        ├── work.js          Work tab
        ├── contributions.js GitHub contribution graph and streaks
        ├── github.js        GitHub activity and the daily summary
        ├── stack.js         your stack: tools found in your repos, and news about them
        ├── trending.js      Trending on GitHub (reads github.com/trending)
        ├── sync.js          Supabase sign-in, push and pull
        ├── settings.js      Settings dialog
        ├── sources.js       news sources
        ├── net.js, store.js, dates.js, ui.js, theme-boot.js   small helpers
```

## Troubleshooting

- **The new tab went back to Google's page.** You probably clicked "Change it back". Turn My Daily back on in `chrome://extensions`.
- **The news says it couldn't reach some sources.** Those sites were down or blocked the request; the rest still load. Press **Refresh** to try again.
- **Sync shows a red dot.** Open Settings to see the error. "Session ended" means sign in again. A 404 error usually means `schema.sql` hasn't been run in that project.
- **To remove it**, click **Remove** on My Daily in `chrome://extensions`. Export a backup first if you aren't using Supabase.
