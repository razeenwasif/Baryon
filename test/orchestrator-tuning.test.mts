import test from 'node:test';
import assert from 'node:assert/strict';
import { routingReport } from '../scripts/routing-report.mjs';
import { evalSettings, runSuite, scriptedProvider, summarise } from '../evals/runner.mjs';
import { TASKS } from '../evals/tasks.mjs';

test('the routing report sums each role and model, with moves and stand-ins, and only the recent past', () => {
  const now = Date.parse('2026-11-14T10:00:00Z'), at = (hours: number) => new Date(now - hours * 3600000).toISOString();
  const { rows, moved, standIns } = routingReport([
    { at: at(1), role: 'builder', model: 'claude-sonnet-5-5', ms: 20000, outcome: 'moved', trouble: 'signed-out' },
    { at: at(1), role: 'builder', model: 'gemini-4-hydrogen-high', ms: 30000, outcome: 'done', standIn: 'Moved to Gemini, because Claude is signed out.' },
    { at: at(2), role: 'lead', model: 'claude-opus-5-5', ms: 90000, outcome: 'done', tokens: { input: 100, output: 10 } },
    { at: at(3), role: 'lead', model: 'claude-opus-5-5', ms: 60000, outcome: 'failed', tokens: { input: 50, output: 5 } },
    { at: at(400), role: 'scout', model: 'claude-haiku-5-5', ms: 1000, outcome: 'done' },
  ] as any, { since: now - 14 * 86400000 });
  assert.deepEqual(rows.map(row => [row.role, row.model, row.jobs, row.done || 0, row.failed || 0, row.moved || 0]), [
    ['builder', 'claude-sonnet-5-5', 1, 0, 0, 1], ['builder', 'gemini-4-hydrogen-high', 1, 1, 0, 0], ['lead', 'claude-opus-5-5', 2, 1, 1, 0]]);
  assert.deepEqual(rows.find(row => row.role === 'lead')!.tokens, { input: 150, output: 15 });
  assert.equal(rows.find(row => row.role === 'lead')!.medianMs, 90000);
  assert.deepEqual([moved, standIns], [1, 1]);
});

test('on the orchestrator, each task runs as routed, and its plan answer is scored against the task’s label', { skip: process.platform !== 'darwin' }, async () => {
  const tasks = ['work-find-fact', 'work-export-formats'].map(id => TASKS.find(task => task.id === id)!);
  const routed: string[] = [];
  const { results, summary } = await runSuite(tasks, { provider: (task: any) => scriptedProvider(task.script),
    route: async (task: any) => { routed.push(task.id); const plan = task.shape === 'plan'; return { settings: evalSettings('claude', { model: plan ? 'claude-opus-5-5' : 'claude-sonnet-5-5' }), helpers: { lead: plan, provider: scriptedProvider([]), seat: () => ({ settings: evalSettings('claude'), label: null }) }, pick: { model: plan ? 'claude-opus-5-5' : 'claude-sonnet-5-5', shape: plan ? 'plan' : 'unsure' } }; } });
  assert.deepEqual(routed, ['work-find-fact', 'work-export-formats']);
  assert.ok(results.every(result => result.ok), results.map(r => r.checks.filter(c => !c.ok).map(c => c.name)).flat().join(', '));
  assert.deepEqual(results.map(result => [result.shape, result.pick!.shape]), [['step', 'unsure'], ['plan', 'plan']]);
  assert.deepEqual(summary.plans, { matched: 1, asked: 2 }, 'unsure on a one-step task counts as a miss, as it sent the task to the lead');
  assert.equal(summarise(results).plans!.matched, 1);
});

test('tuned from the 13 Nov comparison: renames are everyday work, and the lead groups steps and doesn’t redo them', async () => {
  const { LEAD_RULES } = await import('../desktop/orchestrator.mjs');
  let sent: any;
  const { decideTier } = await import('../desktop/model-router.mjs');
  await decideTier({ key: 'k', text: 'Rename fetchUser to loadUser everywhere', where: 'work', fetchImpl: (async (_url: any, options: any) => { sent = JSON.parse(options.body); return { ok: true, json: async () => ({ answers: {} }) }; }) as any });
  assert.match(sent.questions.tier.criteria.standard, /renaming something everywhere/);
  assert.match(sent.questions.tier.criteria.heavy, /needs judgement/);
  assert.match(LEAD_RULES, /Group small, related changes/);
  assert.match(LEAD_RULES, /rather than redoing it yourself/);
});
