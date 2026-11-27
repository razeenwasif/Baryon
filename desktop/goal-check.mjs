// A goal's done-when, checked (docs/goals-board-plan.md, stage 2; docs/reproduce-plan.md, stage 5): after each step,
// by Fairy, with no model. A command runs once in the goal's folder in the sandbox (as a saved eval's check does) and
// passes on exit 0; a run's metric passes when the newest finished run in the folder that has it is past the value;
// `claims` passes when every picked claim on a paper reproduction has a finished full-scale run within its tolerance;
// “you say so” never passes here.
import { hasFeature, optionalImport } from './edition.mjs';
import { goalCheckRecord } from './work-verdict.mjs';

const reproCompareMod = hasFeature('reproduce') ? await optionalImport('./reproduce/compare.mjs', import.meta.url) : null;
const compareClaims = reproCompareMod?.compareClaims || null;

export const CHECK_TIMEOUT = 3 * 60 * 1000;

// run({ command, cwd, timeout, signal }) → { exitCode, timedOut, output }   runs.list(folder) → runs, newest first
export async function checkGoal(goal, { run, runs, now = () => new Date().toISOString(), timeout = CHECK_TIMEOUT, signal } = {}) {
  const when = goal.doneWhen || { kind: 'say' }, at = now();
  if (when.kind === 'command') {
    if (!goal.folder) return { at, kind: 'command', command: when.command, exitCode: null, timedOut: false, passed: false, detail: 'There’s no folder to run the check in.' };
    const result = await run({ command: when.command, cwd: goal.folder, timeout, signal });
    const tail = String(result.output || '').trim().split('\n').slice(-6).join('\n').slice(-600);
    const exitCode = Number.isInteger(result.exitCode) ? result.exitCode : null;
    const timedOut = result.timedOut === true;
    const passed = exitCode === 0 && !timedOut;
    const detail = timedOut ? `${when.command} didn’t finish in ${Math.round(timeout / 60000)} minutes.` : `${when.command} exited ${result.exitCode}${tail ? `: ${tail}` : '.'}`;
    const check = { at, kind: 'command', command: when.command, exitCode, timedOut, passed, detail };
    return { ...check, record: goalCheckRecord(check) };
  }
  if (when.kind === 'metric') {
    if (!goal.folder) return { at, kind: 'metric', passed: false, detail: 'There’s no folder whose runs to read.' };
    const found = (await runs.list(goal.folder)).find(item => item.state === 'done' && Number.isFinite(item.metrics?.[when.metric]?.value));
    if (!found) {
      const check = { at, kind: 'metric', metric: when.metric, passed: false, detail: `No finished run in the folder has ${when.metric} yet.` };
      return { ...check, record: goalCheckRecord(check) };
    }
    const value = found.metrics[when.metric].value, passed = when.op === '<=' ? value <= when.value : value >= when.value;
    const check = { at, kind: 'metric', metric: when.metric, passed, run: found.id, detail: `${found.id}: ${when.metric} ${value} (${when.op === '<=' ? 'at most' : 'at least'} ${when.value} wanted).` };
    return { ...check, record: goalCheckRecord(check) };
  }
  if (when.kind === 'claims') {
    if (!compareClaims) {
      const check = { at, kind: 'claims', passed: false, detail: 'Paper reproduction checks require Baryon Pro.' };
      return { ...check, record: goalCheckRecord(check) };
    }
    if (!goal.folder) return { at, kind: 'claims', passed: false, detail: 'There’s no folder whose runs to read.' };
    const allRuns = runs ? await runs.list(goal.folder) : [];
    const comparison = compareClaims({ claims: goal.claims || [], runs: allRuns, claimOutcomes: goal.claimOutcomes || {} });
    const check = {
      at,
      kind: 'claims',
      passed: comparison.passed,
      detail: comparison.summary,
      ...(comparison.rows.length ? {
        claims: comparison.rows.map(row => ({
          id: row.claimId,
          verdict: row.verdict,
          passed: row.passed,
          accepted: row.accepted,
          ...(row.run ? { run: row.run.id } : {}),
          ...(Number.isFinite(row.ours) ? { ours: row.ours } : {}),
          ...(row.evidence ? { evidence: row.evidence } : {}),
        })),
      } : {}),
    };
    return { ...check, record: goalCheckRecord(check) };
  }
  return { at, kind: 'say', passed: false, detail: 'Done when you say so.' };
}

// What a step's work turn is given with its request: the goal, its check, what was learned, what the last steps did
// and this step. It's data the user wrote and Fairy kept; the step reports back with goal_update.
export function goalBrief(goal, step) {
  const done = goal.steps.filter(item => item.state === 'done' || item.state === 'skipped');
  const recent = done.slice(-3), older = done.slice(0, -3);
  const when = goal.doneWhen.kind === 'command'
    ? `the command \`${goal.doneWhen.command}\` passes in this folder`
    : goal.doneWhen.kind === 'metric'
      ? `a finished run’s ${goal.doneWhen.metric} is ${goal.doneWhen.op === '<=' ? 'at most' : 'at least'} ${goal.doneWhen.value}`
      : goal.doneWhen.kind === 'claims'
        ? 'every picked claim has a finished full-scale run within its tolerance'
        : 'the user says so';
  const reproLines = [];
  if (goal.paper && goal.plan?.status === 'approved') {
    const codeLine = goal.plan.code?.mode === 'authors-code' && goal.plan.code?.repoUrl
      ? `Authors’ public repository at a pinned commit: ${goal.plan.code.repoUrl} (clone and record the commit SHA).`
      : 'Implement from scratch.';
    const gated = (goal.plan.datasets || []).filter(ds => ds.requiresLogin).map(ds => ds.name);
    const picked = (goal.claims || []).filter(claim => claim.picked);
    reproLines.push(
      `Reproduction plan (${goal.plan.file || 'REPRODUCTION.md'}): ${codeLine}`,
      ...(picked.length ? [`Picked claims to reproduce: ${picked.map(c => `${c.id} (${c.metric}: ${c.value}${c.unit === '%' ? '%' : c.unit ? ` ${c.unit}` : ''}, ${c.direction}, tol ${c.tolerance?.kind === 'rel' ? `±${Number((c.tolerance.value * 100).toFixed(4))}%` : `±${c.tolerance?.value}`})`).join('; ')}.`] : []),
      ...(gated.length ? [`Gated datasets (${gated.join(', ')}): NEVER sign up or enter credentials; if this step needs gated data that is not already present, stop and ask the user via goal_update(needsYou).`] : []),
      ...(goal.budget?.hours ? [`Compute budget: ${goal.budget.hours.forge}h GPU on forge, ${goal.budget.hours.atlas}h CPU on atlas. Heavy runs go only through Nexus tickets the user accepts; jobs fetch their own data. Tag every run_experiment and nexus_run with claims (e.g. ["C1"]) and scale ("smoke", "scaled", or "full"); scaled and smoke runs are always marked and never count as reproduced.`] : []),
      'Deviations: record any difference from the paper (guessed hyperparameter, dataset version, library, or pinned commit) in goal_update(deviations).',
      ...(goal.deviations?.length ? [`Recorded deviations so far: ${goal.deviations.slice(-8).map(d => `${d.id}: ${d.what}${d.why ? ` (${d.why})` : ''}`).join('; ')}.`] : []),
    );
  }
  const lines = [
    `This turn is one step towards goal ${goal.id}. Do this step, then call goal_update once, at the end, with what you did and the next step.`,
    `Goal: ${goal.outcome}`,
    `Done when: ${when}. Fairy checks that herself after this step; don’t claim the goal is done.`,
    ...reproLines,
    ...(goal.notes ? [`What earlier steps learned:\n${goal.notes}`] : []),
    ...(older.length ? [`Earlier steps: ${older.map(item => item.what).join('; ')}`] : []),
    ...recent.map(item => `Step ${item.id} (${item.state}): ${item.what}${item.note ? `\n  ${item.note}` : ''}`),
    ...(goal.lastCheck ? [`The last check: ${goal.lastCheck.passed ? 'passed' : 'not yet'}. ${goal.lastCheck.detail}`] : []),
    `This step (${step.id}): ${step.what}`,
  ];
  return `<<<GOAL\n${lines.join('\n\n')}\nGOAL>>>`;
}
