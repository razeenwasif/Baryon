# Fairy goals board: plan (short copy)

19 Nov 2026. The full plan, with its state diagram and tables, is the Claude Doc
https://claude.ai/artifact/HBZW6xby7iMvrZY5Bh3hGp (doc id `830bafaa-0573-4df1-ac93-28f6e04b44c5`; read it with the
docs tools). If the two differ, the doc wins. All five stages are built (below). Doc 7's fourth pick; backlog capability item 2.

## What a goal is

A record in Fairy's data folder (`goals.json`), G1, G2, never reused: an **outcome** (one sentence), a **done-when**
(a command that must pass, a run's metric past a value, or your say; never Fairy's own judgement), a **folder** (none:
tracked and reminded only), **steps** (each written by the one before; you can change it), **notes**, what it
**waits on** (a watcher, a date, your answer), how it **moves** (Ask first by default, or On its own) and a **budget**
(steps a day, and the plan bars under 85% as Research's scheduled rounds).

States: Active, Waiting for you, Waiting on something, Paused (budget), Done, Dropped.

## How it moves

Each step is an ordinary work turn in the goal's folder (`startLinkedWork`, as a watcher's Work on it), given the
outcome, done-when, notes, last steps and next step as data; it ends with a new tool, `goal_update` (what it did,
learned, the next step, whether it needs you; its own goal only, never the outcome or check). After each step Fairy
runs the done-when check in the sandbox with no model: passed is Done; failed sets the next step. An error, or two
steps that change nothing, wait for you. Every card, the sandbox and the folder's permission apply unchanged.

## Where each part lands

`desktop/goals.mjs` (GoalStore, cleanGoal, nextState; pure moves) · `desktop/goal-runner.mjs` (when a step may start:
budget, bars, waits, the card) · `desktop/goal-tools.mjs` (`goal_update`, `goal_propose`) · `desktop/goal-check.mjs`
(command, run metric, your say) · `watchers.mjs` (a watcher may name a goal) · `src/goals-view.js`/`.css`,
`src/goals-logic.js`, a Goals place under Experiments · calls `goals-list`, `goal-get`, `goal-add`, `goal-set`,
`goal-continue`, `goal-pause`, `goal-done`, `goal-drop` · iPhone `/v1/goals`, `GoalsView.swift`, Your week ·
`routing.jsonl` `goal-step` lines.

## Stages

| Stage | Adds | Done when |
| --- | --- | --- |
| 1 Board | store, Goals place, New goal, a goal's page, steps you write | Three goals kept, edited, seen on the MacBook |
| 2 A step as a turn | Continue, `goal_update`, the check, Waiting for you | A goal with a failing test command steps until it passes, then Done |
| 3 Waiting | watcher events and dates, the Ask first cards, notifications, iPhone | A goal waiting on a Nexus job steps on after your OK on the phone |
| 4 On its own | after a good step, an event or a time; steps a day; 85% bars | Two steps overnight inside budget, then a notice at the limit |
| 5 From a chat | `goal_propose` card; chats name their goal; Your week | A multi-session ask offers a goal, added only on Add goal |

## Decisions (suggestion in brackets)

Answered 19 Nov as suggested: **1** its own place, under Experiments · **2** 5 active · **3** a goal with no folder
is allowed, tracked only. 4 Done-when kinds [command, run metric, your say] — stage 2. 5 Default start [Ask
first] — stage 3. 6 Steps a day [3, per goal] · 7 What starts a step on its own [after a good step, an event, a daily
time; each a tick] · 8 Overnight [allowed within budget] — stage 4. 9 Goals offered from a chat [a card] — stage 5.

## Rules

From `main` 3cf0332 in a worktree, a branch per stage (`goals-1-board`, …). Nothing starts on its own before stage 4.
Moves and the start rule pure. A step is an ordinary work turn. Outcome and done-when change only on your edit. No
content in logs. No real model in tests; a real step needs a yes. New calls listed and tested. Push and install only
when asked; Status page after each install.

## Stage 1, as built (19 Nov, branch `goals-1-board`)

- `desktop/goals.mjs`: `GoalStore` over `goals.json` in the data folder (written whole through a temporary file, one
  change at a time; an unreadable file kept as `goals.unreadable.json`). Goals G1, G2, … never reused, steps S1, S2, …
  within a goal. `add`, `set` (outcome, done-when, folder, notes, how it moves: yours only), `step` (add, tick,
  untick, skip, reword, note, remove), `state` (pause, resume, done, drop, reopen: yours only in stage 1), `link`
  (chats and runs). At most five open (decision 2); a command done-when needs a folder; a folder is checked with
  `checkWorkFolder` (decision 3: no folder is allowed, tracked only).
- Calls on the Remote list: `goals-list` and `goal-get` (reads), `goal-add`, `goal-set`, `goal-step`, `goal-state`,
  `goal-link`; each argument made a string or a plain object in main, and the store refuses the rest.
- The board (`src/goals-view.js`, `src/goals-view.css`, `src/goals-logic.js`): Goals in the sidebar under Experiments
  (decision 1), three columns (Active; Waiting or paused; Done), New goal, and a goal's page with its steps to tick,
  notes, linked chats and runs (each opening), history, and Pause, Resume, Mark done, Drop, Reopen and Edit. It hides
  and is hidden with the other places.
- Nothing starts work yet: stage 2 makes Continue run a step as a work turn.

## Stage 2, as built (19 Nov, branch `goals-2-steps`)

Decision 4 answered: a done-when can be a command, a run's metric, or your say.

- Continue (`goal-continue`, on the Remote list) begins the next step (`GoalStore.begin`: the goal active, a folder,
  nothing running; with no step written, the step is to work out the next one and take it). It runs as a work turn
  through `startLinkedWork`, as a watcher's Work on it does, in the goal's own chat (kept on the goal and linked),
  under that chat's permission (Ask first for a new one). Every card, the sandbox and the folder's rules apply.
- The turn is given `goalBrief` (the outcome, the done-when, notes, the last three steps in full and older ones in a
  line, the last check, this step) between marks as data, and `goal_update`, a core tool on that turn only:
  - what the step did, kept on the step;
  - anything learned, added to the notes;
  - the next step, inserted after this one unless it's already next;
  - a question for you.
- When the turn ends, main records its outcome and whether it changed files on the run, and `settleGoalStep` does
  the rest:
  - it runs the done-when (`desktop/goal-check.mjs`) in the sandbox with no model: a command in the folder, or the
    newest finished run's metric;
  - `GoalStore.settle` then decides: passed is Done; an error or a step's question is Waiting for you; two steps in
    a row that change nothing is Waiting for you; a stop puts the step back.
  - A notification says Done or Waiting for you, and `routing.jsonl` gets a `goal-step` line.
- After a restart, a step left running whose chat isn't working goes back to be run again (`recover`).
- The goal's page has Continue, a line while a step runs (with its chat), the last check's result, each step's note,
  and a question in amber. It reads itself again every 4 s while a step runs.

## Stage 3, as built (19 Nov, branch `goals-3-waiting`)

Decision 5 answered: Ask first by default.

- A goal waits (`GoalStore.wait`, state Waiting) on one of Fairy's watchers or until a time. You set this on its page
  with Wait on… (a Nexus job ends, one of your watchers fires, or a date and time; `goal-wait` on the Remote list,
  `{ kind: 'none' }` to stop waiting). A step can also set it: `goal_update`'s `wait_for_job`, for a job it sent to
  the cluster. Main makes a `nexus-job` watcher titled “Nexus job …” for it, tied to the goal.
- A watcher may name a goal (`goal` in `cleanWatcher`; `AutomationStore.tieWatcher`). When it fires, the engine's
  `wake` wakes the goals waiting on it instead of its own action; with none waiting, it does its own action.
  A time is looked at each minute (`dueWaits`).
- Waking (`wakeGoal`): back to Active with why, a notification, then Ask first. A card (“Start G2’s next step? …”,
  Start step or Not now) goes to whichever screen you're at, the iPhone included. Allowed runs the step
  (`continueGoal`); Not now, or no answer in eight minutes, leaves it Active for Continue.
- The iPhone's Your week has “Fairy is working on”: the open goals (at most five, read fresh each time), each with
  its state, its next step or why it waits, a running step, and a question in red. It's read only; a goal's cards
  come as any card does (`phone-week.mjs` `goals`, `WeekView.swift`, demo data).

## Stage 4, as built (19 Nov, branch `goals-4-own`)

Decisions 6–8 answered as suggested: 3 steps a day per goal (1 to 10); after a good step, when its wait is over, and a
time each day, each a tick; overnight allowed within the budget and the bars.

- `desktop/goal-runner.mjs` (pure): `ownStart` allows a step on its own only for a goal set to On its own, active,
  with a folder, nothing running, fewer steps started today (local day, `stepsToday`) than its budget, and the work
  provider's bars under 85% (`fullness` over `usageFrom`). `dailyDue` says when a goal's daily time has come.
- The store: `triggers` (`afterStep`, `onEvent`, `daily`), `budget`, `moves` set by you on the page, `budgetPause`
  (Paused, `pausedBy: 'budget'`, with why), `newDay` (those goals active again), `ownPending` (a start that waited
  for room, cleared when a step begins), `markDaily`.
- Main's `ownTry` runs the rule. Allowed, it starts the step (`continueGoal`; a `goal-own` line in `routing.jsonl`).
  Budget spent: the goal pauses for today, with a notification. Plan full: the start stays pending and is tried
  each minute. It's called:
  - 20 s after a good step;
  - when a wait ends, instead of the card;
  - at the daily time;
  - for a pending start, each minute;
  - on a new day, for goals that go on after a good step.
- The goal's page has How it moves: Ask first or On its own, steps a day, the three ticks, and today's count. Every
  goal starts Ask first; the board marks a goal that moves on its own.

## Stage 5, as built (19 Nov, branch `goals-5-chat`)

Decision 9 answered: a chat offers a goal on a card, and it's added only on Add goal.

- `goal_propose` (work-tools.mjs, a `goals` group behind `more_tools`). It's offered directly when a request plainly
  needs it: “keep at it until it’s done”, “make this a goal”, “over the next few days”, “across sessions”. It puts up
  a `goal-offer` card (Add goal, Not now) with the outcome, what says it's done, the session's folder, the first
  steps and that it asks first. Added only on Add goal (`goalStore.add`, the five-open limit still applying); Not now
  or no answer adds nothing. An open goal with the same words isn't offered again.
- A goal's own chat is named after it, “G3 · …”, when its first step makes it. Your week on the iPhone already lists
  goals beside promises (stage 3).
