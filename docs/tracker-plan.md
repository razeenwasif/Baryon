# Experiment tracker plan

The plan doc: https://claude.ai/artifact/6QdyYELvMwDxoHfeTTpPck (18 Nov). Every experiment Fairy runs for you, on this Mac or on atlas and forge, becomes a run you can find again: the code that ran, its parameters, the numbers it found, the files it made and where it ran. Records follow Proton's `run.json` and live in Fairy's own data folder (`runs/<project key>.json`), never in the project.

## Stages

| Stage | What | State |
|---|---|---|
| 1 | The run store (`desktop/runs.mjs`), the code's state, `fairy_track.py`, and `run_experiment` in work sessions | Built 18 Nov (branch `tracker`) |
| 2 | Runs on atlas and forge: `track` on `nexus_run`, filled in when the outputs come back | Built 18 Nov (branch `tracker`) |
| 3 | The Runs panel: projects, a project's runs, a run's page, Research's runs read in | Built 18 Nov (branch `tracker`) |
| 4 | Compare: side by side, and three charts in inline SVG | Built 18 Nov (branch `tracker`) |
| 5 | `runs_list` and `runs_compare` in chats, run citations, the iPhone | Built 18 Nov (branch `tracker`) |

## Stage 1

- **A run** (`desktop/runs.mjs`, `cleanRun`): `id` (R1, R2, … per project, never reused), `name`, `project`, `command`, `code`, `params`, `metrics` (`{name: {value, unit, steps?}}`, as Proton's `metrics.json`), `files` (path, bytes, sha256, figure), `where` (here, outside, atlas, forge, lab), `state` (running, done, failed, timed-out, stopped), `exit`, `started`, `ended`, `seconds`, `folder`, `from` (the chat), `notes`, `tags`.
- **The store** (`RunStore`): one JSON file per project in Fairy's data folder, written through a queue per file and renamed into place. `start`, `finish` (once; a run's numbers are fixed after it ends), `annotate` (name, notes and tags only), `remove`, `list`, `get`.
- **The code's state** (`codeState`): `git rev-parse HEAD`, the branch, and each uncommitted or untracked file with its sha256 (the run folders left out); the entry script (`train.py` in `python3 train.py`) and its sha256, inside git or not. No model call.
- **`fairy_track.py`**, copied beside each run: `param`, `params` (a dict or argparse Namespace), `metric(name, value, unit=None, step=None)` (steps kept as a series, up to 10,000), `figure`. Any language can write `params.json` and `metrics.json` instead.
- **`run_experiment`**, in the work tools' new `runs` group (offered directly when a request is about experiments, sweeps, benchmarks, epochs or a run like R12). It records the code's state, starts the run, makes `.fairy/runs/R<n>/` in the project (with a `.gitignore` of `*`), and runs the command exactly as `run_command` does, with `export FAIRY_RUN_DIR=… PYTHONPATH=…;` before it, shown on the card. Then it reads `params.json` and `metrics.json`, adds `--name value` flags as parameters, lists the files the run made or changed with their hashes, and ends the run as done, failed or timed out. A refused or stopped run is kept as stopped. The answer to the model ends with the run in a line: `R1 “size 64” done in 0.2 s: ops 1234 op/s`.
- **Checked.** 2,375 tests pass (8 in `test/runs.test.mjs`, one a real Python run through `fairy_track`, one in the real macOS sandbox).

## Stage 2

- **Sent.** `nexus_run` takes `track` (default true where the tracker is on) and `params`; neither reaches Nexus. Before the snapshot goes, Fairy takes the code's state; once Nexus takes the job, the run is recorded as running on atlas or forge (`--on`, else by target) with the job id, its folder `nexus-outputs/<job>`. The answer says the run's number and that it fills in when the outputs come back.
- **In the job.** It writes `params.json` and `metrics.json` into `$DUET_OUTPUT_DIR`; `fairy_track.py` falls back to `$DUET_OUTPUT_DIR` when there's no `FAIRY_RUN_DIR`. The snapshot leaves out git-ignored files, so the helper isn't sent; the plain JSON works from any language on macOS or Windows.
- **Settled** (`RunStore.findJob`, `settleJob`). When `nexus_outputs` fetches a tracked job's outputs into the project, Fairy asks Nexus for its exit (a two-second look at the log) and ends the run: what it reported, every other file with its hash (paths in the project), done or failed. A watcher on the job does the same from Fairy's `watcher-outputs` (full paths); its find now carries `ended: { job, exit, outputs }`. A settled run stays as it is, and a cluster run's seconds are left empty, since the wait for your Accept isn't its run.
- **Checked.** 2,377 tests, 10 in `test/runs.test.mjs`. The watcher tests changed for the new hook. Not yet: a real tracked job on atlas.

## Stage 3

- **The place.** Runs sits under Research in the sidebar (a chart icon) and takes the chat's place as Research, the notebooks and Diffusion do; opening any of them closes the others, and Velvet's grid stands down behind it. `src/runs-view.js`, `src/runs-view.css`, and what it works out with no DOM in `src/runs-logic.js`.
- **Projects.** Every work folder with runs, and every investigation in Research's folder with Lab or cluster runs, newest first, with how many runs, how many running and when the latest started.
- **A project's runs.** A table: run and name, state, where (with the Nexus job), started, time, then up to six parameters and six metrics, the ones most of its runs have. Click a heading to sort (an empty value always last); All, Done, Failed, Running and Stopped; a search over id, name, command and tags.
- **A run's page.** The command, the code (commit, branch, uncommitted files with their hashes, the entry script), parameters, metrics with a small line for a metric logged by step, figures, the end of its printout (now kept on each run: the command's output, a cluster job's log), its other files with size and hash, the chat that started it, and your name, tags and notes for it, with Delete run (its files stay).
- **Research's runs** (`desktop/run-reader.mjs`), read and never changed: Proton's `runs/R00N/run.json`, `metrics.json`, `figures/` and `stdout.txt` as R1, R2, … (`R001` kept as its label), and `.fairy/nexus-runs.json` as C1, C2, … with their outputs. Read only: no notes or delete.
- **Calls.** `runs-projects`, `runs-list`, `runs-figure` (only a picture the run lists, in its project or outputs, at most 15 MB, as a data URL), `runs-annotate` (a name, notes and tags, never numbers) and `runs-remove`; all on the Remote list, so the MacBook's window shows Runs from the mini. A refused call writes nothing.
- **Checked.** In a test page with sample runs (projects, sorting, filters, search, a run's page with a figure and a step line, saving notes, an investigation read only). 2,382 tests; two older checks of `app.js` lines updated.

## Stage 4

- **Ticking.** A box at the start of each row in a project's table (it never opens the run); Compare N runs appears above the table once two are ticked, up to eight. Ticks stay while you sort, filter or search, and while you look at a run.
- **Colours.** One per run, in a fixed order of eight (`SERIES` in `src/runs-logic.js`): the reference palette's dark steps, run through the dataviz validator against the panel's surface (`#13151c`): every adjacent pair clear for colour-blind readers (worst ΔE 8.4), all at least 3:1. A run keeps its colour in the legend, the bars, the lines and the table's headings; every word stays in the panel's own inks.
- **Across runs**: a metric as bars from zero (a negative one below it), 4px rounded at the far end, no number on every bar: hover a run's column for its value. **Against a parameter**: a metric against a numeric parameter as points in one colour, each named; a parameter spread over 20× or more (a learning rate) goes on a log axis, and points within 10 px share one label. **By step**: one 2px line per run for a metric logged by step, named at its end (four or fewer, nudged apart and kept in the plot), with a crosshair that reads every line at the nearest step. Hairline grid, the axis name above the plot, a note naming any run left out for want of a number.
- **Side by side**: a column per run; parameters, metrics, then state, where, time and commit (with “+ changes” when it had uncommitted ones); what differs marked with a dot, and Only what differs.
- **Checked.** In the test page with sample runs (all three charts, the hover readouts, the table and its toggle); 2,386 tests, 5 in `test/runs-panel.test.mjs`.

## Stage 5

- **In chats.** The `runs` group now has `runs_list` (the project's runs, newest first, one line each: id, name, state, where, when, parameters, metrics, tags; filter by state or words) and `runs_compare` (two to eight runs as a Markdown table of every parameter and metric, what differs marked `*`, then state, where, seconds and commit). Both read only Fairy's own record, so neither asks; what they return is marked as data. Each shows as a Runs row in the chat.
- **Citations.** After a work turn, `linkRuns` (`desktop/runs.mjs`) turns each run id the answer names (R12) into a `fairy-run:R12` link, only for runs the project has, never inside code or an existing link, and never “R2 score”, R² or R2-like. In the window a click opens Runs at that run's page in the chat's folder.
- **On the iPhone.** Settings → Fairy, on your Mac → Runs: the projects with runs (Research's marked), a project's runs with state, where, when and their first metrics, and a run's metrics, parameters, commit, the end of its printout, and your tags and notes. Read only. The phone link answers `/v1/runs` and `/v1/runs-list` (only for a folder the list names; a Mac paired as a face can't use them), with `phoneRun` giving just what the phone shows (no files, no steps). Demo data for the Simulator (`-FairyDemo`).
- **Checked.** 2,388 tests; the iPhone app built for the Simulator and the three screens looked at there in demo mode. Not yet: on the iPhone itself, which needs the app installed on it.

