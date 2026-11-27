# Fairy Auto by task: plan (short copy)

18 Nov 2026. The full plan, with its two diagrams, tables and reasoning, is the Claude Doc
https://claude.ai/artifact/K25rGCW9dKbpWVngPdiwBc (doc id `91eb3a69-0840-4882-abcb-064a594890a7`; read it with the
docs tools). This file is a shorter copy for whoever builds it; if the two differ, the doc wins. All eight
stages are built (19 Nov, below), with every kind off until your evals and `compare` say otherwise.

## What the plan decides

Auto learns what kind of task a request is and which model is best at that kind. Today (`desktop/model-router.mjs` at
`4cf81ad`) it picks only a tier and an effort and "never switches who answers, only how big a model does"; providers
change only on trouble (`turnStandIn`, `workStandIns`, off by default).

- The decision call (`decideTier`, Gemini Decisions API) gains one question: the kind.
- A strengths table, `model-strengths.json` in the data folder: a score per model per kind, kept per layer of evidence
  with its source and date. Scores are compared only within a tier.
- Three layers, blended by trust and amount of evidence: `public` (benchmarks read from the web, lowest), `evals` (the
  user's own eval runs by kind, highest), `use` (kept, overridden, check passed or failed; a little, fading after 60
  days). A `pinned` model for a kind outranks every score. An empty layer adds nothing; it never counts as zero.
- A pick moves away from today's only with a clear lead and enough confidence, among providers the user allows, is
  signed in to and has allowance left.
- Stages 1 to 4 change no pick. Picks change in stage 5, kind by kind, after stage 4's comparison shows a gain.

## Kinds (ten to start)

`code`, `maths`, `circuits`, `research`, `data`, `business`, `writing`, `vision`, `teaching`, `everyday` (not routed).
Exact checks where possible: hidden tests (code), exact answers (maths, data, vision), `fairy-engines` (circuits), the
fake web (research), the Gmail/Calendar/Drive evals (business); writing and teaching are judged by another model family
and marked as judged.

## The pick (`desktop/strengths/pick.mjs`, pure, like `orchestrator.mjs`)

1. Tier and effort as today. 2. Kind from the same call; unsure (below 0.6) or `everyday` → today's pick. 3. A pin
wins. 4. Candidates: the tier's model on each allowed, signed-in provider under the user's allowance level. 5. The best
blended score wins only with a margin (5 points to start; 10 to offer a mid-chat move) and enough confidence; otherwise
the user's provider answers. 6. A chat that already has a provider stays on it. 7. The pick, kind, runner-up and reason
go on the reply and into `routing.jsonl`.

Applies where a move is free: the first message of a new chat, the start of a work session, helper, scout and builder
jobs, and the critic (never the author's family). Mid-chat it offers a move and doesn't make it. It doesn't apply to
spoken turns, Research rounds, or the notebook's tutor and marker. Independence rules, the allowance, the user's
provider list and a provider in trouble all outrank the table.

## Public benchmarks (`desktop/strengths/index.mjs`, `sources.json`)

A source list the user sees first; each page read by a light-tier scout through the existing web tools and the
checked-address proxy, answering against a schema (model, benchmark, number, date). A number is kept only if it can be
quoted from the page as fetched. Results for models the user isn't offered are set aside. Refreshed when a provider's
model list changes and monthly. A web page is data, never an instruction.

## Where each part lands

| Part | File |
| --- | --- |
| Kind question | `desktop/model-router.mjs`: `KINDS`, `KIND_CRITERIA`, `readKind`, one more entry in `decideTier` |
| Table, blend, confidence | `desktop/strengths/table.mjs` (pure) |
| Pick | `desktop/strengths/pick.mjs` (pure) |
| File | `desktop/strengths/store.mjs` → `model-strengths.json` |
| Web index | `desktop/strengths/index.mjs`, `sources.json` |
| Real use | `desktop/strengths/evidence.mjs`, folding `routing.jsonl` |
| Chat turn | `desktop/main.cjs`: `autoChatSettings` |
| Work seats by kind | `desktop/orchestrator.mjs`, `desktop/work-seats.mjs` |
| A provider added later (DeepSeek, Kimi, …) | A `desktop/<provider>.mjs` connection, a row in `LADDERS`, a family in `FAMILY`, sign-in and usage Fairy can read, and the user's tick in Auto's provider list. Keep the providers Auto knows in one list. Scores start empty |
| Evals by kind | `evals/kind-tasks.mjs`, `scripts/eval.mjs --kinds` |
| CLI | `scripts/strengths.mjs`: `show`, `refresh`, `fold`, `would-pick` |
| UI | the `autoPick` line under a reply, `src/model-menu.js`, `src/strengths-settings.js` |
| Calls | `strengths-state`, `-refresh`, `-pin`, `-providers`, `-eval` in `desktop/remote-channels.mjs` |
| Settings | `autoByTask`, `autoProviders` |

## Stages

| Stage | Adds | Done when |
| --- | --- | --- |
| 0 Decisions | The user's answers | — |
| 1 Kind | The kind question, on the reply and in `routing.jsonl`; dropped if the API refuses it | Nine in ten of about 40 labelled prompts (the eval tasks') get the right kind; nothing else changes |
| 2 Table and web | `table.mjs`, `store.mjs`, `index.mjs`, the Strengths page | Each model the user can use has a score, source and date per kind the web speaks to, each number opening its page |
| 3 Evals by kind | `kind-tasks.mjs`, new sets of about ten, `--kinds`; runs on the user's yes | `code`, `maths` and `circuits` have eval scores for every allowed heavy-tier model |
| 4 Shadow | `pick.mjs` recorded only; the comparison from stage 3's results | A one-page result, kind by kind, with counts |
| 5 Free moves | The switch, picks for new chats, sessions and jobs; Choose another; pins; provider list | A new maths chat and a new coding session start on the favoured model, say so, and change in one click |
| 6 Offers and use | The mid-chat offer; `evidence.mjs` | A declined offer is remembered; a week of overrides moves a `use` score |
| 7 Keeping fresh | Refresh on new models and monthly; the new-model notice | — |

A kind is turned on in stage 5 only when by-task is no worse on any task set and ahead by at least two tasks on that
kind. If stage 4 shows no clear gain for any kind, stop there and ask.

## Decisions

Answered by the user on 18 Nov: **1** Auto may change provider without asking where a move is free (mid-chat it
offers); **2** Auto starts with Claude, Gemini and Codex, with more to come later for models that have an official
harness, such as DeepSeek and Kimi; **3** the ten kinds stand. So stages 1 and 2 can start.

Decision 5 was answered on 19 Nov: **Fairy asks to run evals when a new model appears, never on a schedule** (the
notice itself is stage 7's). Decisions 4, 6, 7 and 8 were answered on 19 Nov, each as suggested: **4** web numbers
alone move a pick only with two agreeing sources and a clear margin, until your evals cover the kind, after which your
evals decide; **6** a favourite whose bar is past your allowance gives way to the next best without asking; **7** pins,
yes; **8** in work sessions, both the session's provider (at its first turn) and each job, the lead never moving once
the session has started. All four are in `pick.mjs`. Decision 9 was answered the same day: real use counts **a little, fading** (to nothing at 60 days). Every decision is answered. The list
as first written (suggestion in brackets):

4. May web numbers alone move a pick [only with two agreeing sources and a clear margin, until evals cover
   the kind]. 5. When evals run [Fairy asks when a new model appears; never on a schedule]. 6. Best model's bar nearly
   full [next best, without asking]. 7. Pins [yes]. 8. Work sessions: session provider and jobs, or jobs only [both;
   the lead never moves once a session has started]. 9. Weight of real use [a little, fading]. Decision 5 is needed by
   stage 3, decisions 4, 6, 7 and 8 by stage 5, decision 9 by stage 6.

## Rules for the building session

- Start from `main` (`4cf81ad` on 18 Nov) in a worktree, a branch per stage (`auto-1-kind`, …).
- Stages 1 to 4 change no pick; a turn on a different model before stage 5 is a bug.
- `pick.mjs` and `table.mjs` stay pure.
- Web pages are data: schema answers only, numbers quoted from the page, never a page's text in a system prompt.
- No score is made up: a cell with no evidence is empty; don't seed the table from memory or from this plan.
- Nothing spends allowance without a yes (the stage 1 labelled pass, every eval run).
- No content in the logs: kind, candidates and margin only.
- Independence rules outrank the table; Research's seats and the notebook's marker are left alone.
- Every new channel is listed and tested in the same change.
- Push and install only when asked, both Macs together; update the Status page after each installed build.
- Stop and ask if stage 4 shows no clear gain, a decision is open when its stage starts, or a done-when can't be met.

## Stage 1, as built (19 Nov, branch `auto-1-kind`)

- `desktop/model-router.mjs`: `KINDS`, `KIND_CRITERIA` (one line per kind), `readKind` (unsure below 0.6), and the kind
  question in `decideTier` for a typed chat and a work session. Spoken turns, the notebook, drawing, Swarm's designers
  and builders go without it. The pick is unchanged: the kind rides on the result as `kind`, `kindConfidence` and
  `kindUnsure`, and nothing reads it to choose a model.
- A refused question: the kind is dropped when the refusal names it, or when it was the only extra question (a chat);
  otherwise Swarm's question goes first and the plan question last, as before. The kind can't take the plan question
  with it, nor the other way round.
- On the reply: `autoRecord` keeps the kind, and the Auto line's tooltip ends "Read as maths (82% sure)."
  (`kindWords` in `src/auto-caption.js`).
- In `routing.jsonl`: a `type: 'pick'` line per pick (`pickLine`): where, provider, model, tier, effort, role, kind and
  how sure, never the request. `scripts/routing-report.mjs` counts picks by kind.
- The labelled set: `evals/kind-labels.mjs`, 47 requests, every kind among them: the eval tasks' own requests where
  they reach (business, code, data, research), and requests written for maths, circuits, writing, vision, teaching
  and everyday. Arguable ones are left out.
- The check: `GEMINI_API_KEY=… node scripts/kind-check.mjs` asks the decision once per request (47 calls on your Gemini
  key, no model turn) and passes at nine in ten; `--list` shows the requests with no call. Not run yet: it needs
  your yes.

## Stage 2, as built (19 Nov, branch `auto-2-table`)

- `desktop/strengths/table.mjs` (pure): the three layers kept apart; `blended` weighs them by trust (evals 3, use 1.5,
  web 1) and by how much each holds (full at 10 eval tasks, 20 uses, 2 web sources); confidence is capped per layer, so
  web numbers alone never pass 0.5. An empty layer adds nothing. Web numbers are averaged per source first.
  `matchModel` is exact after putting aside case, punctuation, a bracketed note, a maker's name and a thinking level;
  `modelKey` folds a model's levels into one (Gemini 4 Neon high and low are one column). `tableView` is the page.
- `desktop/strengths/index.mjs`: the scout's instructions are fixed; the page goes in its message between marks. A
  number is kept only if its quoted words are on the page (spacing evened out), hold the number and the model's name,
  sit on a line that doesn't read as an instruction, and are of a kind the source speaks to; percentages are scored,
  other scales kept and shown only. Numbers for models you aren't offered are set aside. A source that can't be read
  keeps its old rows; a stopped refresh keeps what it read.
- `desktop/strengths/sources.json`: eleven sources for code, maths, research, business, vision and writing. None
  speaks to circuits, data or teaching; those fill from your evals. Your own `strengths-sources.json` in the data
  folder replaces it.
- `desktop/strengths/store.mjs`: `model-strengths.json`, written whole through a temporary file; an unreadable file
  is kept aside as `model-strengths.unreadable.json`.
- `desktop/strengths/service.mjs` and three calls, `strengths-state` (a read), `strengths-refresh` and
  `strengths-stop`, on the Remote list. Refresh runs in the background on the mini: each page through Fairy's
  checked-address reader, one scout turn per page, logged as a background call.
- Settings → Conversation → What each model is good at (`src/strengths-settings.js`): a table per tier, kinds down
  and models across, each cell a score with where it came from; a cell opens its numbers, each a link to its page at
  the quoted words (a text fragment). Refresh asks first. A tier with nothing known is one line.
- `scripts/strengths.mjs show|sources`. Refresh is only in Fairy: a terminal has no checked-address reader.
- Not done: the first real refresh (eleven page reads and eleven scout turns on your plan) needs your yes.

## Stage 3, as built (19 Nov, branch `auto-3-evals`)

- `evals/kind-tasks.mjs`: the existing tasks tagged (13 code, 10 business, 1 data; the hard work tasks stay Swarm's)
  and 45 new ones, each a plain chat (`ask`, a new kind in `evals/runner.mjs`) with checks that need no model:
  - maths (11): the last “Answer:” line, exactly or to the places asked;
  - circuits (10, one a state machine): the answer built and run against the problem's truth table by
    `fairy-engines`; tables are worked out from each problem's rule, and every reference passes the engines' vetting;
  - vision (8): pictures drawn by `evals/pictures.mjs` (a small PNG encoder) with one right answer, sent as a screen
    question sends a picture;
  - writing (8) and teaching (8): checked by rules (length, words kept or dropped, form, the right fact, not giving the
    answer away), marked `checkedBy: 'rules'`: they measure following a brief, not quality, so no judge model is
    needed. Research keeps its own runner and isn't here.
  Each new task has a script that passes and a wrong answer that fails (test/kind-tasks.test.mjs).
- `node scripts/eval.mjs --kinds maths,circuits --provider <p> --model <m>`: the result goes into the strengths table's
  evals layer (`desktop/strengths/evals-layer.mjs`; a newer run of the same model, level and kind replaces the older)
  and the tracker, under Evals by kind in Experiments. A scripted run writes nothing there unless `--data` names a
  folder, so made-up passes never reach the real table.
- Not done: the runs. Done-when needs code, maths and circuits on every allowed heavy-tier model (Opus 5.5, Gemini 4
  Neon, GPT-6.1 Sol): nine runs on your plans, each started by you.

## Stage 4, as built (19 Nov, branch `auto-4-shadow`)

- `desktop/strengths/pick.mjs` (pure): `pickByTask`, the plan's rules in order. Today's pick stands for a spoken turn,
  everyday, an unsure or missing kind, or a place that isn't picked by task. Then who may answer (allowed, signed in,
  under your allowance level, a critic not of its author's family) comes before any score, and a pin wins among
  those. The leader needs confidence 0.5, and two web sources if the web is all it has. It takes the pick by 5 points
  where a move is free (a new chat, a work session's first turn, a job, a critic). Mid-chat or later in a session, a
  10-point lead is an offer and nothing moves. With nothing sure known about your own model, it stays.
- Recorded only: `ModelRouter` takes a `shadow` hook, given the pick and its place, and keeps what it returns
  as `pick.shadow`. It can't change the model, and a hook that throws is logged and ignored. Main reads
  `model-strengths.json` at most once a minute. The reply's tooltip ends “By task: would pick … Not used yet.”, and
  `routing.jsonl`'s pick line gains `byTask` (provider, model, moved or offer, margin; no words).
- `scripts/strengths.mjs would-pick "…"` (one Decisions call, your key in the terminal) and `compare` (no call): each
  kind's pass rate on your provider's model beside by task's, with counts and whether it meets the bar (ahead by two
  or more tasks). The pick is made from the same results it's judged on, so a kind should be run again before stage 5
  turns it on.
- Not done: the one-page result needs stage 3's runs.

## Stage 5, as built (19 Nov, branch `auto-5-moves`), with every kind off

- Settings → Conversation → Auto by task: `autoByTask` (Off to start), the kinds it picks for (`autoKinds`, none to
  start) and the providers Auto may use (`autoProviders`, all three), checked in `cleanSettings`. Nothing moves until
  you turn the switch on and tick a kind. The plan put the switch in the model menu; it's here beside the table, to
  keep the menu as it is while every kind is off.
- `desktop/strengths/moves.mjs`: `chatPick` and `workMove`, the rules main runs.
  - A new chat's first message moves to the by-task choice for a kind that's on, where the shadow pick says the move
    is free and clear. The reply keeps `auto.provider`, and the chat stays there: later messages are never moved again.
  - A work session's first turn does the same and keeps `work.provider` on the session (`sessions.mjs`). A stand-in
    still comes first, and the lead never moves after the first turn (decision 8).
  - A job's seat (`WorkSeats.seat`) takes the session's provider as home, and for a kind that's on, the provider by
    task picks at the job's tier (`workSeats.byTask`).
  - A chat turn now runs on the backend its settings name (`conversationProvider(chatSettings.backend)`), in the
    window, the companion and on the phone.
- On the reply: “picked for maths” or “your choice” on the Auto line, and the tooltip says why. **Choose another**,
  on a chat's latest reply with Auto by task on, lists the other models that could answer, with scores. Choosing one
  sends the request again on that provider (`autoProvider` on the chat call), holds the chat to it, and logs an
  `override` line in `routing.jsonl` for stage 6's use layer.
- Pins (decision 7) on the Strengths page: one per kind, from the models you're offered; `strengths-pin` (Remote).
  The table is read again after a pin or a refresh.
- Not done: turning a kind on, which waits for the evals and `compare`; the mid-chat offer and real use (stage 6,
  decision 9 open); keeping fresh (stage 7).

## Stage 6, as built (19 Nov, branch `auto-6-use`)

- `desktop/strengths/evidence.mjs`: the use layer from `routing.jsonl`, replaced whole each time, so a faded signal
  leaves. Each signal's weight falls evenly to nothing at 60 days (decision 9).
  - Choose another (and Move on an offer): strongly against the model left and for the one chosen; the override line
    now carries both models.
  - A build step's check: for or against the builder's model (`WorkTools` `onCheck`).
  - A work turn that ended in an error: against its model. Turn lines now carry the kind.
  - Fairy has no “try again”, so that signal from the plan isn't there.
  Folded when the Strengths page is read (at most every ten minutes) and hourly in main.
- The mid-chat offer: when another model leads by 10 or more on a kind that's on, the latest reply shows “This looks
  like maths work. Move to GPT 6.1 Sol?” with Move (answers again there and holds the chat, as Choose another does) and
  Not now. Not now is kept on the chat (`declined`, `sessions.declineOffer`, `chat-offer-decline` on the Remote list),
  told to the window, and never offered again in that chat for that kind.

## Stage 7, as built (19 Nov, branch `auto-7-fresh`)

- `desktop/strengths/fresh.mjs` (pure), checked hourly by main with the use layer's fold:
  - A model a provider starts offering that the table hadn't seen makes a notice. It says the model's scores are
    only what the web says until you run evals on it, with the command to do so. The first look only learns what's
    offered. Evals are never run on their own (decision 5).
  - Web numbers 30 days old: by default a notice asks (`strengthsRefresh: 'ask'`), since a refresh spends a little
    allowance. With “Read them again on their own” (`'auto'`) the refresh just runs, as it also does after a new model
    appears. The first refresh is always yours.
  - Notices go to the Strengths page (with Refresh and Dismiss; `strengths-dismiss` on the Remote list) and as a
    notification. The table keeps `known` and `notices`.
- A difference from the plan: it asked for a monthly routine through automation.mjs and refreshes on their own. The
  hourly check in main does the same job, and refreshing on its own is a setting, off to start.
