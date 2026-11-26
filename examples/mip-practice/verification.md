# Fairy — MIP practice quiz verification

All 12 questions passed the live screenshot-based run on 2026-09-28.

| Question | Result | Delivery | Words | Sentences | Model time |
|---|---|---|---|---|---|
| 1 | PASS | p3 | — | — | 8.8 s |
| 2 | PASS | star | 46 | 2 | 7.6 s |
| 3 | PASS | star | 55 | 2 | 10.7 s |
| 4 | PASS | no | — | — | 5.9 s |
| 5 | PASS | star | 32 | 2 | 9.2 s |
| 6 | PASS | no | — | — | 8.8 s |
| 7 | PASS | star | 61 | 2 | 12.8 s |
| 8 | PASS | p3 | — | — | 5.5 s |
| 9 | PASS | star | 34 | 2 | 6.8 s |
| 10 | PASS | star | 49 | 2 | 7.2 s |
| 11 | PASS | no | — | — | 6.0 s |
| 12 | PASS | star | 33 | 2 | 6.4 s |

## What was tested

- The actual HTML was rendered at a 1365×980 logical viewport; the supplied image questions included scrolled views.
- Native macOS Vision OCR, Fairy’s question buffer, QuizMonitor, QuestionHistory, Astra provider, output parser and delivery routing were used.
- Astra received screenshots and captured prior questions, never the independent answer key, quiz DOM, user memory or a prewritten answer. Local notes retrieval was omitted to isolate screenshot/context performance.
- Every explanation was reviewed against the independent mathematical key, including signed lower bounds and integer-hull subtleties.
- Q7 received Q6 plus its Q4 prerequisite; the provider context cap remains two earlier questions.
- Clipboard and corner-publishing callbacks were recorded in the harness, rather than changing the user’s actual clipboard or desktop overlay. This was not a full live Safari/installed-app interaction test.
- HTML navigation, radio selection, written-answer persistence and script errors were checked in Electron.
- Mathematical checks: 2,040 Boolean assignment/formula cases and 2,916 bounded max-formulation grid points passed.

## Limits

These are observed results, not a guarantee of every future model response or of 1–2 second latency. Open the quiz in order, let Fairy observe the setup, and scroll image questions down to their choices. Quiz history is temporary and resets on pause, mode disable or window changes. OCR alignment did not always join image-heavy scroll frames; in this run retained earlier screenshots and readable current screenshots still supplied sufficient evidence for every answer.

Answer-key details and sources: [answer-key.md](answer-key.md).


## Expanded optimization suite — 29 September 2026

The standalone HTML now contains 24 questions: the original 12, plus four each on
Benders decomposition, column generation, and convex optimization. The added questions
are original; their answer key and reference sources are separate from the HTML.

- **516 regression tests pass.**
- **24/24 screenshot/model answers pass**, including all written word limits, with one
  model request per question in the recorded fixture run.
- Independent numerical checks cover the original SAT/max formulations and the added
  Benders cuts, reduced cost, a degeneracy counterexample, KKT example, and both graph
  orientations (`validate-maths.py`, `validate-added-maths.py`).
- Installed Safari checks passed Q1–Q14 before exposing an OCR reference-label error
  in Q15; that error is fixed and regression tested.
- Actual corner glyphs were captured and compared with the answer key. A changed graph
  with identical wording produced Yes then No; restoring the graph reused Yes without
  another model request.
- A fresh 100-frame native worker check used four process starts and skipped Vision
  98 times, with a warm median of 79.6 ms. Measured RSS was 17.6–140 MiB. The 160 MiB
  recycle threshold is checked between frames and is not a strict allocation cap.

## Final installed-app result — 29 September 2026

**24/24 passed in the installed Fairy app with Safari.** Actual native corner
symbols were captured and matched against vector glyph templates. All ten clipboard
answers were reviewed mathematically; each had two sentences and met its word limit.
The answer key was never supplied to Fairy.

Q1 and Q4 each retained three overlapping views. The successful run held the top
view for 4 seconds and the middle view for 3.5 seconds. An earlier faster scroll
missed part of Q4's setup and Q5 correctly abstained; arbitrarily fast scrolling is
not guaranteed to retain every view.

There were 27 model requests across 24 questions: Q1 and Q4 triggered additional
requests while scrolling. Model latency ranged from 4.3 to 8.9 seconds, with a
median of 5.97 seconds; this is model time, not full detection-to-display time.
The separate fixed-screenshot fixture used exactly 24 calls for 24 questions.

The final additional installed checks passed:

- Changing only Q24's graph changed Yes to No; restoring the graph reused Yes.
- Returning to Q13 and Q14 produced confirmed cache hits with zero new requests.
- A newer clipboard sentinel survived the Q14 revisit; its star still displayed.
- Normal window mode produced the correct Q17 symbol, and Stop cleared the hint.

An earlier tightened cache run missed a Q14 cache hit. Repeating the same check
passed without a code change; the exact intermittent cause remains unconfirmed.
Do not infer that every revisit is guaranteed to avoid a model call. This remains
recorded for the next reliability/latency pass rather than hidden by the passing rerun.

The 516-test regression suite passes. Installed JavaScript and HTML match source;
the installed native OCR binary matches the signed release (signing changes binary
hashes relative to the unsigned build). The native worker benchmark remains the
100-frame result above. The model response-time optimization phase has not started.

Evidence: `.local-data/verification/quiz-final/installed-results.json`,
`installed-summary.json`, `installed-extra.json`, `glyph-checks.json`,
`installed-hashes.json`, and the native hint PNGs. Original clipboard text and
hands-free/pause/floating settings were restored by the harness. Verification ends
with quiz mode off. Only text clipboard formats were preserved.

| Question | Symbol | Written words | Model seconds |
|---|---|---:|---:|
| 1 | p3 | — | 4.98 |
| 2 | star | 46 | 7.08 |
| 3 | star | 42 | 6.96 |
| 4 | no | — | 8.73 |
| 5 | star | 44 | 7.72 |
| 6 | no | — | 5.02 |
| 7 | star | 43 | 8.49 |
| 8 | p3 | — | 5.62 |
| 9 | star | 24 | 5.28 |
| 10 | star | 39 | 5.98 |
| 11 | no | — | 6.21 |
| 12 | star | 36 | 5.78 |
| 13 | p2 | — | 4.74 |
| 14 | star | 53 | 7.91 |
| 15 | yes | — | 5.13 |
| 16 | false | — | 6.81 |
| 17 | p2 | — | 7.63 |
| 18 | star | 48 | 6.66 |
| 19 | false | — | 4.94 |
| 20 | p3 | — | 4.31 |
| 21 | p2 | — | 5.86 |
| 22 | star | 71 | 8.91 |
| 23 | true | — | 5.96 |
| 24 | yes | — | 5.33 |


## Follow-up: scrolling and cache caveats

The September 29 follow-up adds once-captured view retention, exact-pixel cache and
prerequisite identity, stable history on known-view revisits, and immutable in-flight
answer evidence. **523 regressions pass.** Ten targeted installed questions and a
changed-graph variant passed; 13 confirmed live cache hits caused no new requests or
clipboard overwrites. The former 2500/1700 ms scroll cadence retained all three Q4
views. One initial post-install attempt still missed context; content never captured
between samples remains unavailable. See the detailed follow-up report at
`../../.local-data/verification/quiz-caveats/VERIFICATION.md` for the exact test scope,
final guard coverage and remaining physical sampling limit.
