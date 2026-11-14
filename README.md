# My Daily

A Chrome extension that turns every new tab into your daily dashboard. The left column holds your to-do list, the open tab's log (Learning log or Work history) and GitHub Trending. The rest of the width is for AI news, Learning, Work or Notes.

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
- **Work** (connect GitHub): what you pushed today and yesterday, as commits by repo and branch, lines changed, the folders you worked in, and pull requests you opened, merged or reviewed. Each day gets a few short bullets on what you worked on and where, and a daily summary is written automatically at a time you choose. Your GitHub contribution graph (the green squares from your profile) sits below, with your current and longest streak. Each project has a **Note** button, and its card shows the notes you wrote for it that day.
- **Keep my streak** (optional, connect GitHub): on a day you don't push, it commits the day's log to a private repo of yours in the evening, so your contribution graph doesn't skip that day. The log lists the to-dos you finished and what you read or tried, and the commit message says what's in it.
- **Notes**: write down what you did on a project, what's left and what you're waiting on (say, a permission a client still has to give), so it isn't only in your head. Each note belongs to a project and a day, and keeps the time you wrote it. The Notes tab lists each day, newest first, with the projects you pushed to and the notes under each one. Pick a project to see only its notes.
- **Questions**: interview practice built from your resume. Upload it once (PDF or text) and the AI lists the topics it covers. Then: a **daily quiz** of 20 fresh questions across your topics, with single-answer and choose-all-that-apply questions; **levels**, 40 per topic and 25 questions each, harder as you go, four open at first and one more each day; a **report** for today, this week and this month; and **feedback** once a day on where you're weak, what to work on and what's worth learning next. Needs an AI: an OpenRouter key in Settings (best; a quiz costs a few cents) or Chrome's on-device AI (free, simpler questions, no PDF).
- **Supabase sync** (optional): tasks, learning log, work history, notes and settings are saved locally first, so everything is instant, then synced to your own Supabase project.

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
| To-do | Type a task and press Enter (Shift+Enter starts a new line; the box grows). **+** adds it, and a pasted list becomes one task per line. **✦ Analyse** reads a whole paragraph ("I have to call Priya, then fix the login bug and send the invoice tomorrow, it's urgent…") and proposes separate tasks, with due days and stars picked up from the words. Check them, edit or leave any out, then add them all. Pick Today, Tomorrow, No date or a date first for tasks that don't say. **Fix** (the lines-and-tick icon at the end of the row under the box) corrects the spelling and grammar of what you typed or dictated, before you add it. Click a task to edit its title, notes or date, or to delete it (with undo); **Fix** in the editor corrects its title and notes. |
| AI news | Switch between Your stack, Headlines, News, AI labs, Hacker News, Papers and Models. **To-do** on a card adds the story to your list. News refreshes every 15 minutes while a tab is open. |
| Learning | Switch between Your stack, Suggested, Today, your interests and All topics. **Scan again** re-checks GitHub for your tools (it does so on its own twice a day). Tick **Read it**, **Watched it** or **Tried it** on anything. **Different picks** swaps today's lessons. In All topics, pick a topic to see its best articles. A topic counts as covered after 5 articles. |
| Work | Pick Today, Yesterday or any date with the calendar, or click a square in the contribution graph to open that day. The summary card shows the day's figures and one line per task, beside your contribution graph and streak. **Listen** reads the summary aloud, **Copy summary** copies it as Markdown bullets for a standup or a chat, and **Refresh** checks GitHub again (it also does that every 10 minutes while the tab is open). **Note** on a project adds a note for that project on the day you're looking at. |
| Notes | **New note** asks for a project (pick one of your repos or type any name, like "Lead serve"), a day (today unless you change it) and what to write. **Fix writing** corrects its spelling and grammar, and **⌘ Enter** saves. Click a project's name or chip to see only its notes, and a commit count to open that day in Work. Each note has Edit and Delete (with undo). |
| Settings (top right) | Your name, light or dark, Supabase sync, GitHub and the time of the daily summary, learning topics (turn off, or add your own), news sources, and backup or restore. |

Keyboard: `/` jumps to search, `n` jumps to the new-task box.

## Syncing with Supabase

1. Create a project at [supabase.com](https://supabase.com), or use one you already have.
2. Open **SQL Editor → New query**, paste [supabase/schema.sql](supabase/schema.sql) and click **Run**. It creates five tables (`tasks`, `learning_log`, `work_log`, `work_notes`, `preferences`) with row-level security, so each signed-in user can only reach their own rows. It's safe to run again, and if you set up sync before notes were added, run it again to add `work_notes`. Until then, Settings tells you, and everything else keeps syncing.
3. In **Project Settings → API Keys**, copy the project URL and the **publishable** key (`sb_publishable_…`, or the legacy `anon` key). Never use the secret or `service_role` key here.
4. On the dashboard, open **Settings → Sync with Supabase**, paste both and click **Save project**.
5. Click **Create account** with an email and password, then **Sign in**. If your project requires email confirmation, click the link Supabase emails you first. To skip confirmation, turn off **Confirm email** under Authentication → Sign In / Providers → Email.

Once signed in, changes upload about a second after you make them. Changes from your other devices download when you open a tab, when you come back to one, and every 2 minutes while it's open. A green dot on the Settings button means sync is working, and a red dot means it needs attention. If two devices edit the same thing, the newer edit wins, and the database enforces that too.

## Connecting GitHub

1. Create a [classic personal access token](https://github.com/settings/tokens/new?scopes=repo&description=My%20Daily) with the **repo** scope. Without it, private and work repositories don't show up. Give it an expiry date you're comfortable with.
2. If a work organisation uses single sign-on, click **Configure SSO** next to the token and authorise it for that organisation.
3. On the dashboard, open **Settings → GitHub**, paste the token and click **Connect**. The Work tab fills in right away.
4. Pick when the daily summary is written (6:00 PM by default), and whether it also appears as a notification. Clicking the notification opens that day in the Work tab.
5. To keep your streak, tick **Keep my streak on days I don't push**, and pick the time and repo (10:00 PM and `daily-log` by default).

**How Keep my streak works:**
- **The check:** from the time you set, the extension asks GitHub how many contributions you have today. Any contribution counts (a push, a pull request, a review), because that's what keeps a square green. If there's at least one, nothing happens.
- **The commit:** if there are none, it commits `YYYY/YYYY-MM-DD.md` to your log repo, with a message like `Daily log for Thu 5 Nov: 3 to-dos done, 2 read`. You get a notification, and clicking it opens the commit. It commits at most once a day, and **Check now** in Settings runs the check right away.
- **The repo:** it has to be yours, not an organisation's, so client and work repos are never touched. If it doesn't exist, it's created as a private repo when you turn this on. In a public repo the log leaves out your to-do titles.
- **Private repos:** commits to them show on your public graph only with "Include private contributions" on in your GitHub profile settings.
- **This check needs Chrome open and the computer awake.** If Chrome was closed at the set time, the check runs when you open it, as long as it's still the same day. For days your computer stays off or asleep, add the workflow below.
- **With the computer off:** [daily-log/](daily-log/) holds a GitHub Actions workflow for your log repo. It runs on GitHub at 10:47 PM and again at 11:19 PM India time. It reads your public contribution graph, and if today is empty it commits a short check-in as you (with your GitHub no-reply address, so it counts). To add it, copy the `.github` folder into your log repo and push. Settings can't add it for you, because a token needs the extra `workflow` scope to write workflows. Set My Daily's own check earlier than 10:47 PM, so on days your computer is on, the fuller log goes in first.

**Your stack** comes from the repos you pushed to in the last two weeks: their languages, `package.json` dependencies and telltale files (`supabase/`, `Dockerfile`, `vercel.json`…). Repos you pushed to recently, and committed to most, count for more. The list of tools it recognises, and where to follow each one, is in [extension/js/stack.js](extension/js/stack.js).

**How Analyse splits your text:** when your Chrome has its built-in on-device AI (Gemini Nano, through Chrome's Prompt API), that does the splitting. It's free and private, and nothing leaves your computer. The first time, Chrome may need to download the model, and until it's ready a rule-based splitter is used. That splitter handles lists, sentences, "then", "also" and "and <verb>", strips openers like "I have to", reads "today", "tomorrow" and "by Friday" as due days, and reads "urgent" or "ASAP" as important. The preview says which one was used.

**How Fix corrects your writing:** the same on-device AI fixes spelling, grammar, punctuation and words dictation misheard, keeping your wording, names and line breaks (through Chrome's Proofreader API when your Chrome has it, otherwise the Prompt API). Nothing leaves your computer. Without it, rules fix capitals, "i", missing apostrophes ("dont"), doubled words ("the the"), common misspellings and tool names ("next js" → Next.js, "super base" → Supabase), and the message says grammar wasn't checked. Fix changes the text in the box, so you can read it before adding; **Undo** in the message, or ⌘Z in the box, puts back what you wrote.

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

## Questions: how the quizzes work

- **A wrong answer teaches you.** Get a question wrong anywhere in Questions and a "Let's learn this" box is written for it: the right answer, why (and why the one you picked was tempting), a small example, an everyday analogy and a line to remember it by, in easy English. It's written the moment you get it wrong, kept with the question, and shown again in the end-of-quiz list and whenever that question comes back. For puzzles and communication tasks it comes with the marking.
- **Right answers aren't asked again.** A daily-quiz question you get right is retired.
- **Wrong answers come back, but not within a week.** A question you got wrong returns in a daily quiz at least 7 days later, at most 4 per quiz; the rest of the quiz is new. Level questions stay with their level, so you can retake it.
- **Topics each day:** a rotating slice of your resume (six topics a day, so every topic comes round), plus your two weakest topics of the last month.
- **Levels** open with the days since you saved your resume: 4 on the first day, 5 the next, up to 40. A level's questions are written the first time you open it and kept, and 70% passes it. Levels 1-8 are basics, 9-16 junior, 17-24 mid, 25-32 senior, 33-40 expert.
- **Report** counts finished quizzes and levels. The by-topic list is sorted weakest first, so it doubles as a to-study list.
- **Feedback** is written from your accuracy by topic, the questions you missed this week, your resume topics and the tools in the repos you push to. Without AI, it's built from your scores alone.
- **Where it's stored:** on this computer, in the extension's storage, like everything else. Resume topics are kept; the resume file isn't. Your answers never go to the AI; it only writes questions and the feedback summary.
- **Puzzles:** one new problem a day (a coding problem, a logic puzzle, an estimation or a probability question), and 40 levels of five puzzles each, from warm-ups to final-round problems. You write your approach or answer and the AI marks it against a reference solution, with the key idea you missed if it's wrong. Two hints are there if you want them. A level is passed when all five are solved. The daily puzzle's difficulty follows the highest level you've passed.
- **Communication:** five tasks a day (a grammar question, a message to rewrite professionally, a work situation to reply to, and one to answer out loud), and 40 levels of five tasks, from clear sentences through client emails, explaining technical things, hard conversations, and leadership and interviews. Written answers are scored out of 100 with what was good, what to change, and a stronger version in your own voice. For the spoken task, **Record** uses Chrome's speech recognition to transcribe you (nothing is stored as audio; Chrome asks for the microphone once); filler words and words per minute are counted here, and the AI judges the content. An average of 70 passes a level.
- **Marking without AI:** the solution is shown and you mark yourself with "I got it" or "Not yet".
- The **Report** has problem-solving and communication sections (score by skill, filler-word rate, pace, a trend by day), and the daily **Feedback** reads them too.

## Where your data lives

Without Supabase, everything is in this Chrome profile's extension storage. Removing the extension deletes it, so use **Settings → Export backup** now and then. The backup is a JSON file with your tasks, learning log and notes; **Import backup** restores it (notes are merged with the ones you have, never replaced).

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
├── daily-log/.github/      Keep my streak workflow, copied into your log repo (works with the computer off)
├── setup.sh                 checks files, makes icons, opens Chrome's Extensions page
├── supabase/schema.sql      tables, row-level security and the sync trigger
├── tools/make_icons.py      draws the icons (Python standard library only)
└── extension/               the folder Chrome loads
    ├── manifest.json
    ├── dashboard.html       the new tab page
    ├── background.js        toolbar badge, end-of-day work summary, streak check, fetches feeds and pages
    ├── css/dashboard.css
    ├── fonts/               Bricolage Grotesque (SIL Open Font License)
    ├── icons/
    └── js/
        ├── app.js           start-up, header, tabs, search, shortcuts
        ├── tasks.js         to-do list
        ├── tasksplit.js     Analyse: splits a paragraph into tasks
        ├── fixtext.js       Fix: spelling and grammar of what you typed or dictated
        ├── feed.js          AI news tab
        ├── news.js          fetching and parsing feeds, Hacker News, Hugging Face
        ├── learning.js      Learning sub-tabs, daily brief, Read it / Tried it, stats, log
        ├── suggestions.js   hyped YouTube videos and posts
        ├── devto.js         DEV Community articles, cached
        ├── topics.js        your interests and resume topics
        ├── cards.js         the story card shared by both tabs
        ├── preview.js       Open Graph preview images (ported from uptime)
        ├── work.js          Work tab
        ├── notes.js         Notes tab, the note box and the notes on Work's project cards
        ├── questions.js     Questions tab: resume topics, daily quiz, levels, report, feedback
        ├── practice.js      Puzzles and Communication: daily sets, levels, marking, speaking
        ├── ai.js            asks OpenRouter (Claude) or Chrome's on-device AI for JSON
        ├── contributions.js GitHub contribution graph and streaks
        ├── github.js        GitHub activity and the daily summary
        ├── streak.js        Keep my streak: the evening check and the day's log commit
        ├── version.js       which background code the dashboard expects, to catch a stale one
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
- **A "My Daily needs a reload" bar at the top.** Chrome keeps running the extension's old background code after an update, and restarting Chrome doesn't refresh it. Until the extension is reloaded, the streak check and the evening summary don't run. Click **Reload My Daily** in the bar, or the reload icon on My Daily in `chrome://extensions`.
- **Sync shows a red dot.** Open Settings to see the error. "Session ended" means sign in again. A 404 error usually means `schema.sql` hasn't been run in that project.
- **To remove it**, click **Remove** on My Daily in `chrome://extensions`. Export a backup first if you aren't using Supabase.
