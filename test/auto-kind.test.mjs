import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { promisify } from 'node:util';
import { KINDS, KIND_CRITERIA, ModelRouter, decideTier, pickLine, readKind } from '../desktop/model-router.mjs';
import { CLAUDE_MODELS } from '../src/model-menu.js';
import { autoWhy, kindWords } from '../src/auto-caption.js';
import { routingReport } from '../scripts/routing-report.mjs';
import { kindLabels, kindScore } from '../evals/kind-labels.mjs';

const run = promisify(execFile);
const choice = (value, confidence = 0.9) => ({ type: 'choice', choice: value, confidence });
const api = (answers, seen = []) => async (url, options) => { const body = JSON.parse(options.body); seen.push(body); return { ok: true, json: async () => ({ answers }) }; };

test('the kind is asked in the same call for a typed chat and a work session, with a criterion for each of the ten kinds', async () => {
  assert.deepEqual(KINDS, ['code', 'maths', 'circuits', 'research', 'data', 'business', 'writing', 'vision', 'teaching', 'everyday']);
  assert.deepEqual(Object.keys(KIND_CRITERIA), KINDS);
  for (const [where, spoken, asked] of [['chat', false, true], ['work', false, true], ['chat', true, false], ['notebook', false, false], ['draw', false, false], ['swarm', false, false], ['build', false, false]]) {
    const seen = [];
    await decideTier({ key: 'k', text: 'Solve x² = 4', where, spoken, fetchImpl: api({ tier: choice('heavy'), effort: choice('high'), kind: choice('maths') }, seen) });
    assert.equal('kind' in seen[0].questions, asked, `${where}${spoken ? ' (spoken)' : ''}`);
    if (asked) assert.deepEqual(Object.keys(seen[0].questions.kind.criteria), KINDS);
  }
  const decided = await decideTier({ key: 'k', text: 'Solve x² = 4', fetchImpl: api({ tier: choice('heavy'), effort: choice('high'), kind: choice('maths', 0.83) }) });
  assert.deepEqual([decided.kind, decided.kindConfidence, decided.kindUnsure], ['maths', 0.83, false]);
});

test('the kind’s answer is read as given, unsure below 0.6, and nothing for a choice it doesn’t know', () => {
  assert.deepEqual(readKind(choice('circuits', 0.912)), { kind: 'circuits', confidence: 0.91, unsure: false });
  assert.deepEqual(readKind(choice('writing', 0.41)), { kind: 'writing', confidence: 0.41, unsure: true });
  for (const bad of [null, { type: 'number', choice: 'code' }, choice('poetry'), {}]) assert.equal(readKind(bad), null);
});

test('stage 1 changes no pick: the same model and effort whatever the kind, or with none', async () => {
  const picks = [];
  for (const kind of [...KINDS, null]) {
    const router = new ModelRouter({ key: () => 'k', offered: () => ({ claude: CLAUDE_MODELS }), decide: options => decideTier({ ...options, fetchImpl: api({ tier: choice('heavy'), effort: choice('high'), ...(kind ? { kind: choice(kind) } : {}) }) }) });
    const pick = await router.pick({ provider: 'claude', text: 'Help me with this', where: 'chat' });
    picks.push([pick.model, pick.effort, pick.tier]);
    assert.equal(pick.kind, kind || undefined);
  }
  assert.equal(new Set(picks.map(String)).size, 1, JSON.stringify(picks));
});

test('a refused kind question is dropped, and Auto carries on without it rather than falling back', async () => {
  const asked = [], logs = [];
  const refusing = async (url, options) => {
    const body = JSON.parse(options.body); asked.push(Object.keys(body.questions));
    if (body.questions.kind) return { ok: false, status: 400, json: async () => ({ error: { message: 'Unknown question kind' } }) };
    return { ok: true, json: async () => ({ answers: { tier: choice('standard'), effort: choice('medium'), plan: choice('step') } }) };
  };
  const router = new ModelRouter({ key: () => 'k', offered: () => ({ claude: CLAUDE_MODELS }), decide: options => decideTier({ ...options, fetchImpl: refusing }), log: line => logs.push(line) });
  assert.equal((await router.pick({ provider: 'claude', text: 'hi there', where: 'chat' })).model, 'claude-sonnet-5-5');
  assert.equal((await router.pick({ provider: 'claude', text: 'Fix the failing test', where: 'work' })).route.shape, 'step');
  assert.deepEqual(asked, [['tier', 'effort', 'kind'], ['tier', 'effort'], ['tier', 'effort', 'plan', 'swarm']]);
  assert.deepEqual([router.askKind, router.askPlan, router.askSwarm], [false, true, true], 'only the kind went');
  assert.match(logs[0], /kind question was refused/);
  // Any other failure in a chat still falls back to your chosen model, and keeps asking the kind.
  const broken = new ModelRouter({ key: () => 'k', offered: () => ({ claude: CLAUDE_MODELS }), decide: async () => { throw new Error('Gemini Decisions answered 403: API key not valid'); } });
  assert.equal(await broken.pick({ provider: 'claude', text: 'x', where: 'chat' }), null);
  assert.equal(broken.askKind, true);
});

test('the reply keeps the kind for its tooltip, and routing.jsonl gets a line per pick with no words of the request', async () => {
  const router = new ModelRouter({ key: () => 'k', offered: () => ({ claude: CLAUDE_MODELS }), decide: options => decideTier({ ...options, fetchImpl: api({ tier: choice('heavy'), effort: choice('high'), kind: choice('maths', 0.82) }) }) });
  const secret = 'Prove the Riemann hypothesis for my thesis on zeta functions';
  const line = pickLine(await router.pick({ provider: 'claude', text: secret, where: 'chat' }));
  assert.deepEqual(line, { type: 'pick', where: 'chat', provider: 'claude', model: 'claude-opus-5-5', tier: 'heavy', effort: 'high', role: 'lead', kind: 'maths', kindConfidence: 0.82 });
  assert.ok(!JSON.stringify(line).includes('Riemann'));
  assert.equal(kindWords({ kind: 'maths', kindConfidence: 0.82 }), 'Read as maths (82% sure).');
  assert.equal(kindWords({ kind: 'everyday' }), 'Read as an everyday request.');
  assert.match(autoWhy({ model: 'claude-opus-5-5', tier: 'heavy', kind: 'circuits', kindConfidence: 0.7 }), /heavy tier\. Read as circuits \(70% sure\)\.$/);
  assert.equal(kindWords({}), '');
  const main = await readFile(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /const autoRecord = pick => \(\{ model: pick\.model, tier: pick\.tier, effort: pick\.effort, \.\.\.\(pick\.kind \? \{ kind: pick\.kind, kindConfidence: pick\.kindConfidence \} : \{\}\)/);
  assert.match(main, /routingLog\.add\(pickLine\(pick\)\);/);
});

test('the routing report counts picks by kind apart from the jobs', () => {
  const at = new Date().toISOString();
  const report = routingReport([{ at, type: 'pick', kind: 'code' }, { at, type: 'pick', kind: 'code' }, { at, type: 'pick' }, { at, role: 'lead', model: 'claude-opus-5-5', ms: 1000, outcome: 'done' }]);
  assert.deepEqual(report.kinds, { code: 2, 'not asked': 1 });
  assert.deepEqual(report.rows.map(row => [row.role, row.jobs]), [['lead', 1]]);
});

test('about forty labelled requests, every kind among them, from the eval tasks where they reach', async () => {
  const labels = kindLabels();
  assert.ok(labels.length >= 40, String(labels.length));
  assert.deepEqual([...new Set(labels.map(label => label.kind))].sort(), [...KINDS].sort());
  assert.equal(new Set(labels.map(label => label.id)).size, labels.length);
  assert.ok(labels.every(label => label.text && ['chat', 'work'].includes(label.where)));
  assert.equal(labels.find(label => label.id === 'work-fix-bug').where, 'work');
  const score = kindScore([{ id: 'a', kind: 'code', got: 'code' }, ...Array.from({ length: 9 }, (_, i) => ({ id: `b${i}`, kind: 'maths', got: 'maths' })), { id: 'c', kind: 'writing', got: 'teaching', confidence: 0.5 }]);
  assert.deepEqual([score.right, score.asked, score.passes], [10, 11, true]);
  assert.deepEqual(score.misses, [{ id: 'c', kind: 'writing', got: 'teaching', confidence: 0.5 }]);
  assert.equal(kindScore([{ id: 'a', kind: 'code', got: null }, { id: 'b', kind: 'code', got: 'code' }]).passes, false);
  // The check lists them with no call, and won't call without a key.
  const script = new URL('../scripts/kind-check.mjs', import.meta.url).pathname, env = { ...process.env, GEMINI_API_KEY: '' };
  assert.match((await run(process.execPath, [script, '--list'], { env })).stdout, new RegExp(`${labels.length} requests\\.`));
  await assert.rejects(run(process.execPath, [script], { env }), error => error.code === 2 && /Set GEMINI_API_KEY/.test(error.stderr));
});
