# Fairy harness reliability: plan (short copy)

20 Nov 2026. The full plan, with its diagram, tables and reasoning, is the Claude Doc
https://claude.ai/artifact/6CkZtgD8eMvMc9FLzUurQm (doc id `2a21b954-28e2-4a7b-840e-5d125596a276`; read it with the
docs tools). This file is a shorter copy for whoever builds it; if the two differ, the doc wins. Nothing is built.

## Where it came from

GPT Astra reviewed Fairy's harness on 20 Nov (its findings are in `VERDICT.md` in the working folder). It read the
working folder, on branch `audiopulse-link` at `71ddac0`, 356 commits behind `main`. Each finding was checked against
`main` at `aa01e67`:

| Astra said | On main | Left to do |
| --- | --- | --- |
| No work-session evals | Out of date: 14 work tasks with hidden tests, 3 research tasks, by-kind sets, saved-session evals | Four situations no task covers (Part B) |
| Tool schemas are advertised, not enforced | True: `toolset.run` in `desktop/tool-registry.mjs` refuses only non-object arguments | Part A |
| A failed call is labelled a success | True: `toolHandler` returns `success: true` always; `calls()` keeps only name and risk | Part A |
| The context budget leaves out the summary | True as measured (12,000 characters of notes on top of the 24,000 digest; `workMeter` counts the digest only), but about 9,000 tokens, not an overflow | Part E |
| Progress lives in memory until the turn ends | Out of date: `desktop/work-checkpoint.mjs` saves a running turn every 1.5 s since 16 Nov | Outside writes (Part D) |
| Finished is taken as verified | Partly: builder steps and goals run their own checks; an ordinary work reply carries no verdict | Part C |

## Part A: tool arguments checked in one place (M)

- `desktop/tool-arguments.mjs`: pure `checkArguments(schema, args)` for the JSON Schema subset Fairy's tools use
  (`type`, `required`, `properties`, `additionalProperties: false`, `enum`, `minimum`, `maximum`, `minLength`,
  `maxLength`, `items`). Unknown keywords are ignored. It returns the first problem in words a model can act on.
- Called before any guard on both paths: `toolset.run` (registry) and `WorkTools.handle` (`desktop/work-tools.mjs`,
  the core work tools). Connector tools are checked against their server's schema.
- Five outcomes on every call: `ok`, `invalid`, `refused`, `failed`, `unknown`. `toolHandler` stops answering
  `success: true` for everything; `calls()` keeps each call's outcome and duration. The text the model reads stays the
  same.
- Each tool's own checks stay. Permissions, approvals, pictures and progress are untouched.
- Tests: `test/tool-arguments.test.mjs` (Astra's three probes never reach `run`; each keyword both ways) and a sweep
  that feeds every registered tool and work tool a missing field, a wrong type and an extra field.
- Done when the probes are refused on both paths and the sweep passes for every tool.

## Part B: four reliability evals (M)

`evals/reliability-tasks.mjs`, run by `scripts/eval.mjs --reliability`, results in the tracker, kept apart from the
by-kind sets. Graded on files and on what the fakes received.

| Task | Situation | Passes when |
| --- | --- | --- |
| `work-carry-on` | A turn cut off after two of four edits; restart; Carry on | Hidden tests pass, no edit made twice |
| `work-compact-keeps` | A constraint stated early, then compaction, then a task whose easy answer breaks it | Hidden tests pass, including one for the constraint |
| `work-write-once` | A comment posted to the fake GitHub, cut off before the result is recorded; Carry on | The fake received exactly one comment (expected to fail until Part D) |
| `work-refused` | An approval is refused mid-task | Files as the refusal leaves them, no workaround by another tool, the reply says what wasn't done |

`evals/runner.mjs` gains: cutting a turn off after a counted number of tool calls, then running recovery and Carry on;
and a small digest budget for one task. Each task passes its reference script and fails a wrong one. A real-model pass
is started by the user.

## Part C: checked, or not checked (M)

`desktop/work-verdict.mjs`, pure: checks and the file-change journal in, a verdict out, shown under a work reply that
changed files. Verdicts: `Checked` (a check ran after the last change and passed), `Failed`, `Out of date` (files
changed after a pass), `Not checked`. A check is something Fairy ran and read the exit code of: a builder step's
check, a goal's done-when, or a `run_command` the lead marks `check: true`. Each record keeps the command, exit code,
time and journal position. The same record feeds the notes' "Done and checked", a goal step's result, and a claim's
evidence in Reproduce a paper. No new model call. Done when the verdict is right at the end of each Part B task.

## Part D: outside writes recorded first (M)

For write tools that act outside the work folder (Calendar event, Gmail draft, Drive file, GitHub comment or review
reply, Nexus job, watcher, Research round, connector writes): a line in `outside-writes.jsonl` in the data folder with
the chat, turn, tool, a hash of the arguments (never content) and a state: `intent` before the call, `done` (with the
outside id) or `failed` after, `unknown` for any line still at `intent` at the next start. On Carry on the model is
told which are unknown, and the tool refuses the same hash in that chat until settled: Fairy looks it up where the
service allows, else asks the user. `once` and the approvals log stay. Done when `work-write-once` passes for a GitHub
comment, a Gmail draft and a Nexus job.

## Part E: the meter counts the notes (S)

`workMeter` in `src/work-context.js` measures notes plus digest against both limits together; compaction's trigger is
unchanged. Instructions, tools and attachments are already measured in real tokens by the token ledger. Test: Astra's
probe (nine 2,900-character messages and a 12,000-character summary) reads as its true size.

## Order

A, B and E now, as one short item before doc 7's next pick; C with Reproduce a paper; D in hardening and security.
B's tasks are how C and D are proved.

## Decisions that are the user's (suggestion in brackets)

1. Part A refuses at once, or reports would-be refusals for one installed build first [report for one build]. 2. What
   counts as a check: Fairy-started checks only, or also commands the lead marks [both; Fairy records the exit code].
3. Where the verdict shows [under every work reply that changed files]. 4. An outside write that may have happened:
   Fairy looks then asks, or always asks [looks first]. 5. The order above, or all five in hardening and security [the
   split]. 6. The real-model pass of the four evals [the work provider first].

## Rules for the building session

- Start from `main` (`aa01e67` on 20 Nov) in a worktree, a branch per part (`reliability-a-arguments`, …). Check each
  part against `main` first; skip what is already done and say so.
- Part A changes nothing for a valid call; don't remove a tool's own checks.
- No content in the new logs. Evals use the fakes only. Nothing spends allowance without a yes.
- Leave `VERDICT.md`, `SANDBOX_LOG.md`, `RESEARCH_PLAN.md` and `AGENTS.md` alone.
- Push only to `origin`, with `ntr`, and only when asked; both Macs together; update the Status page after each
  installed build.
- Stop and ask if Part A's report shows real calls that would be refused, a done-when can't be met, or a decision is
  open when its part starts.
