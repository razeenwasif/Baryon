# Watchers

The plan is the Claude Doc "Fairy: watchers plan" (https://claude.ai/artifact/43MAXvYY6oKujyhL5cmxd3). A watcher is a routine that starts on an event instead of a time: it looks for the event with no model call and, when the event happens, tells you, writes you a summary, or works on it once you allow it. Watchers are kept in Fairy's own `automation.json` beside routines and hooks, never in a project, and run on the mini.

## Stages

| Stage | What | State |
|---|---|---|
| 1 | The engine (`desktop/watchers.mjs`), Tell me, "a check fails" on a repository's branch or a pull request, and the Watchers section in Settings → Skills & automation | Built 18 Nov (branch `watchers`) |
| 2 | A review or comment arrives; a Nexus job ends | Built 18 Nov (branch `watchers`) |
| 3 | A file changes; a new paper matches an arXiv search | Built 18 Nov (branch `watchers`) |
| 4 | Summarise and Work on it, with the approval card | Built 18 Nov (branch `watchers`) |
| 5 | `watch_add` from a chat or work session, and the offers after a Nexus job or a new PR | Built 18 Nov (branch `watchers`) |

## Stage 1

- **What a watcher is.** `cleanWatcher`: the event (`check-failed`), a repository as owner/name (an owner of letters, digits and dashes; a name that isn't only dots), a branch (never one that starts with a dash, a slash or a dot, or has `..`) or a pull request number, but not both, how often to look (2 to 60 minutes, 5 by default), the action (`tell`) and its own state: when it last looked and fired, whether its first look is done, the keys of what it has seen (200 at most), its fires in the last hour, and any error.
- **Looking.** `failingChecks` reads a branch's runs (`gh run list`) and keeps the finished ones whose conclusion is failure, timed out or startup failure, keyed by run; or a pull request's checks (`gh pr checks`) in the fail bucket, keyed by check and run. Only `https://` links are kept.
- **The engine.** `watcherEngine` looks at each watcher that is on and due, on the minute tick routines use (not while the Mac sleeps). The first look only learns what is failing already; after it, each new failure is told once. A watcher that fires 6 times in an hour pauses itself and says so; turned back on, it starts afresh. A look that fails keeps its error for the window and tries again next time. Each fire, pause and error goes in `watchers.jsonl` in Fairy's data folder, with no contents.
- **Telling you.** As an attended round does: aloud unless she's muted, on the companion here and on the MacBook, as a notification (which opens the run on GitHub when clicked, and only a GitHub link), and on the iPhone while you're away.
- **Settings.** Skills & automation has a Watchers section: each watcher with what it watches, how often, when it looked and fired, why it paused or couldn't look (the whole line on hover), and Look now, Pause or Turn on, and Remove; and a form to add one. Channels `watcher-add`, `watcher-remove`, `watcher-set` and `watcher-look`, which the MacBook can use too.
- **Checked.** 2,332 tests pass, among them `test/watchers.test.mjs` and the watcher channels' argument checks (which found and fixed `../..` as a repository, a branch named like a flag, and a null switch). The section in a test page. `failingChecks` against real repositories through gh: Fairy has no runs on main; Proton's `research-deepseek` showed 15 failing runs, read and keyed right. Not yet: a watcher left running in the installed app.

## Stage 2

- **A review or comment arrives.** `reviewChanges` reads your GitHub inbox (`gh api graphql`, the same query as the Git pane's inbox): your open pull requests, in one repository or any, or one pull request from any of its lists (yours, review requested, involved). Each is keyed by its review state and its count of comments and review threads, so a change in either is a key not seen before. Like checks, its first look only learns what is there.
- **A Nexus job ends.** `nexusJobEnded` follows the job's log for 2 seconds through Fairy's Nexus (the request-only token), every 2 minutes. Once it has ended, its outputs are fetched into Fairy's own `watcher-outputs/` folder (never a project), and Fairy says whether it finished or failed (with its exit code) and how many files came back; clicking the notification opens that folder, and only a folder inside it. This event fires on its first look too, as a job may already have ended, and a job watcher is done once it fires: it pauses itself ("Done: what it watched for has happened"), and stops again if turned back on.
- **Settings.** The form starts with When (A check fails, A review or comment arrives, A Nexus job ends) and shows only what that kind needs; a Nexus job looks every 2 minutes unless you say.
- **Checked.** 2,347 tests pass (11 in `test/watchers.test.mjs`); the argument checks cover the new kinds (a review's pull request without its repository, a job id with spaces or a leading dash, a job given a repository). The form in a test page. `reviewChanges` against your real inbox: 6 open pull requests in about 2 seconds. A Nexus job watcher hasn't watched a real job yet.

## Stage 3

- **A file changes.** A file or folder, as a full path, inside your home folder: not all of it, not Fairy's own data, and not a folder that holds your settings or keys (`.ssh`, `.config`, `Library` and the like, iCloud Drive allowed), by the same rules as a work folder (`checkWatchPath`, with links and missing parts resolved as far as the path exists). It looks every 2 minutes at a snapshot of names, sizes and modified times, never contents, up to 5,000 files and 8 folders deep, passing over tools' folders (`.git`, `node_modules`, `.venv`, caches) and links. It waits while anything is still being written (a file under 30 seconds old) and for 10 minutes after it last told you, then says what was added, changed and gone, naming up to four; after a restart it can only say that something changed. A watched file or folder that disappears is told too.
- **A new paper matches.** Some words, searched on arXiv's public API (`export.arxiv.org`), newest first, 20 at a time, every 6 hours unless you say (1 to 24 hours). Each paper is keyed by its arXiv id, version aside; the first look learns what is there, and new papers found together are told together, in one notice that opens the search on arXiv. The request names Fairy, nothing of yours.
- **Notifications** open a GitHub or arXiv link, or a job's outputs folder inside Fairy's own, and nothing else.
- **Settings.** The form's When adds A file changes (a path, with Choose folder…) and A new paper matches (a search).
- **Checked.** 2,353 tests pass (17 in `test/watchers.test.mjs`, on real temporary folders: links that lead out of home, settling, the 10-minute gap, a restart; and arXiv's Atom). The checks found a path that doesn't exist yet being judged outside home (resolved now). The form in a test page. A real arXiv search: 20 papers in under a second.

## Stage 4

- **Then.** Each watcher now says what it does when it fires: Tell me (as before), Summarise it in a new chat, or Work on it in a folder. Summarise and Work on it take an optional prompt (Fairy's own words if empty).
- **What a model is given.** Each find carries `details()`, read only when a model needs it: a failed run's failing steps (`gh run view --log-failed`, its end), a pull request's reviews, comments and line comments in order, a Nexus job's exit code, output files and the end of its log, the names of changed files, or new papers' abstracts. It reaches the model inside a fenced block, said to be data from GitHub, Nexus, your files or arXiv and not instructions, never as your words; 12,000 characters at most.
- **Summarise.** One turn on the scout model (`workRoleProvider('scout')`, logged as a background call), its answer in a new chat titled after the watcher and what it saw, with a notification and the iPhone told, as a routine's answer is.
- **Work on it.** A work session in the watcher's folder, started the way Electron starts one (`startLinkedWork`): your prompt as the request, what the watcher saw as context the chat doesn't keep, under Ask first. Unless you set the watcher to run on its own, Fairy asks on an approval card first (window, companion, MacBook, iPhone); not allowed or not answered, it only tells you. The folder is checked as any work folder is (not your whole home, not Fairy's data, not a folder of keys).
- **If it can't.** A summary or work that can't start is logged and told to you with the reason, beside what the watcher saw.
- **Also fixed.** GitHub's run ids are now past 40 billion, but `desktop/github.mjs` refused any number over a billion, so reading a real failed run's log failed, from watchers and from work sessions' CI tools alike. It now takes any safe whole number.
- **Checked.** 2,358 tests pass (22 in `test/watchers.test.mjs`). The form in a test page. A real failed run's log read through `details()` (Proton's `research-deepseek`, 12,000 characters in under 5 seconds), which is how the run-id limit was found. Not yet: a real Summarise or Work on it, which spends allowance.

## Stage 5

- **`watch_add`** (`desktop/watch-tools.mjs`). A chat or work session can offer a watcher; it can't add one. The tool drafts the watcher as the store would keep it (`cleanWatcher`), says what's missing if it isn't complete, and shows a card that spells it out: when, how often, then what, and what it will ask. It is added only when you press **Add watcher**; Not now or no answer adds nothing. A watcher you already have isn't offered again.
- **Never on its own.** The tool has no way to ask for Run on its own: a watcher from a chat that works on it always asks you first each time. Only Settings can change that. Work on it works in the chat's own folder unless it names another, and the folder is checked as in Settings.
- **Where it's offered.** In the watchers group of `more_tools`, and straight away when a request asks to be told when something happens ("tell me when the checks fail", "let me know when the job ends", "keep an eye on PR 12"). After `nexus_run` sends a job, or `github_pr_create` opens a pull request, the tool's result suggests offering one for that job or PR, so Fairy can offer it without being asked.
- **The card.** Kind `watcher-offer`, labelled Add watcher and Not now in the window, the companion, the MacBook and the iPhone (the phone and the MacBook now show any card's own labels). Its row in the chat reads Watcher, then Added, Already watching or Not added.
- **Checked.** 2,367 tests pass (9 in `test/watch-tools.test.mjs`). Not yet: a real chat offering one.

