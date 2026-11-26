import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_QUESTION, classify, escalate, pick, readPlan, worthSplitting } from '../desktop/orchestrator.mjs';
import { ModelRouter, decideTier } from '../desktop/model-router.mjs';
import { autoCaption, autoWhy } from '../src/auto-caption.js';
import { CLAUDE_MODELS } from '../src/model-menu.js';
import { TASKS } from '../evals/tasks.mjs';

const answer = (choice, confidence) => ({ type: 'choice', choice, confidence });
const claude = ['claude-fable-5-2', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];
const agy = ['gemini-4-argon-low', 'gemini-4-argon-medium', 'gemini-4-argon-high', 'gemini-4-hydrogen-low', 'gemini-4-hydrogen-medium', 'gemini-4-hydrogen-high', 'gemini-4-hydrogen-xhigh', 'gemini-3.8-flash-low', 'gemini-3.8-flash-high', 'claude-opus-5-5-high', 'claude-sonnet-5-5-medium', 'gpt-oss-120b', 'gemini-pro-orchestrator-g1-pro'];
const offered = { claude, gemini: agy };

test('the plan answer is read with its confidence, and anything else is no answer', () => {
  assert.deepEqual(readPlan(answer('plan', 0.84)), { shape: 'plan', confidence: 0.84, unsure: false });
  assert.deepEqual(readPlan(answer('step', 0.55)), { shape: 'step', confidence: 0.55, unsure: true });
  assert.equal(readPlan(answer('maybe', 0.9)), null);
  assert.equal(readPlan(null), null);
  assert.deepEqual(Object.keys(PLAN_QUESTION.criteria), ['step', 'plan']);
});

test('one step keeps the tier’s role; a plan, or an unsure answer, goes to the lead', () => {
  const step = classify({ tier: 'standard', effort: 'medium', plan: readPlan(answer('step', 0.9)) });
  assert.deepEqual([step.shape, step.role, step.tier, step.effort], ['step', 'builder', 'standard', 'medium']);
  assert.match(step.reason, /One step \(90% sure\)/);
  assert.equal(classify({ tier: 'light', effort: 'low', plan: readPlan(answer('step', 0.95)) }).role, 'scout');
  // A plan is led by a strong model at high effort, whatever tier the message looked like.
  const plan = classify({ tier: 'standard', effort: 'medium', plan: readPlan(answer('plan', 0.8)) });
  assert.deepEqual([plan.shape, plan.role, plan.tier, plan.effort], ['plan', 'lead', 'heavy', 'high']);
  assert.match(plan.reason, /needs a plan \(80% sure\)/);
  // An extreme request stays extreme, at its own deeper effort.
  const deep = classify({ tier: 'extreme', effort: 'max', plan: readPlan(answer('plan', 0.9)) });
  assert.deepEqual([deep.tier, deep.effort], ['extreme', 'max']);
  const unsure = classify({ tier: 'standard', effort: 'medium', plan: readPlan(answer('step', 0.52)) });
  assert.deepEqual([unsure.shape, unsure.role, unsure.tier], ['unsure', 'lead', 'heavy']);
  // No plan answer (no key, or chat): one step, as Auto was.
  assert.deepEqual([classify({ tier: 'heavy', effort: 'high' }).shape, classify({ tier: 'heavy', effort: 'high' }).role], ['step', 'lead']);
});

test('state beats wording: a plan step’s role, then plan mode, come before the message', () => {
  const sure = { tier: 'heavy', effort: 'high', plan: readPlan(answer('plan', 0.97)) };
  assert.equal(classify(sure, { stepRole: 'builder' }).role, 'builder');
  assert.equal(classify(sure, { stepRole: 'builder' }).tier, 'heavy', 'a step keeps its own tier');
  const planMode = classify({ tier: 'light', effort: 'low', plan: readPlan(answer('step', 0.99)) }, { permission: 'plan' });
  assert.deepEqual([planMode.shape, planMode.role, planMode.tier], ['plan', 'lead', 'heavy']);
  assert.match(planMode.reason, /plan mode/);
});

test('a plan is split only when two or more steps need real work', () => {
  assert.equal(worthSplitting([{ size: 'large' }, { size: 'small' }]), false);
  assert.equal(worthSplitting([{ size: 'medium' }, { size: 'large' }, { size: 'small' }]), true);
  assert.equal(worthSplitting([]), false);
});

test('each role gets its seat on the provider you chose', () => {
  const at = role => { const seat = pick(role, { home: 'claude', offered }); return seat && [seat.provider, seat.model, seat.effort]; };
  assert.deepEqual(at('lead'), ['claude', 'claude-opus-5-5', 'high']);
  assert.deepEqual(at('builder'), ['claude', 'claude-sonnet-5-5', 'medium']);
  assert.deepEqual(at('scout'), ['claude', 'claude-haiku-5-5', 'low']);
  const gem = role => pick(role, { home: 'gemini', offered }).model;
  assert.deepEqual(['lead', 'builder', 'scout'].map(gem), ['gemini-4-argon-high', 'gemini-4-hydrogen-high', 'gemini-4-hydrogen-low']);
  // Carbon takes the lead's seat once Antigravity lists it.
  assert.equal(pick('lead', { home: 'gemini', offered: { gemini: [...agy, 'gemini-4-carbon-high'] } }).model, 'gemini-4-carbon-high');
  // Saver thinks less below the lead; Quality more.
  assert.equal(pick('builder', { home: 'claude', offered, bias: 'saver' }).effort, 'low');
  assert.equal(pick('builder', { home: 'claude', offered, bias: 'quality' }).effort, 'high');
  assert.equal(pick('lead', { home: 'claude', offered, bias: 'saver' }).effort, 'high', 'the lead keeps its effort');
});

test('a signed-out or full provider hands builder and scout work over first, and the lead last', () => {
  const out = pick('builder', { home: 'claude', offered, available: { claude: false } });
  assert.deepEqual([out.provider, out.model, out.standIn], ['antigravity', 'gemini-4-hydrogen-high', true]);
  assert.match(out.reason, /Claude isn’t available/);
  const busy = { home: 'claude', offered, usage: { claude: 0.9 } };
  assert.equal(pick('builder', busy).provider, 'antigravity');
  assert.match(pick('builder', busy).reason, /^Builder on Gemini, because Claude’s usage is 90%\.$/);
  assert.equal(pick('lead', busy).provider, 'claude', 'the lead stays until its bar is nearly full');
  assert.equal(pick('lead', { ...busy, usage: { claude: 0.99 } }).provider, 'antigravity');
  // Saver moves sooner; Quality later.
  assert.equal(pick('builder', { ...busy, usage: { claude: 0.75 }, bias: 'saver' }).provider, 'antigravity');
  assert.equal(pick('builder', { ...busy, usage: { claude: 0.9 }, bias: 'quality' }).provider, 'claude');
  // Everything full still runs somewhere, in the usual order.
  assert.equal(pick('builder', { home: 'claude', offered, usage: { claude: 0.99, gemini: 0.99 } }).provider, 'claude');
  // With Gemini signed out too, Claude through Antigravity can't stand in either.
  assert.equal(pick('builder', { home: 'claude', offered, available: { claude: false, gemini: false } }), null);
});

test('a short job keeps off agy’s start-up time unless nothing else can take it', () => {
  assert.equal(pick('scout', { home: 'gemini', offered, short: true }).provider, 'claude');
  assert.equal(pick('scout', { home: 'gemini', offered, short: true, available: { claude: false } }).provider, 'antigravity');
  assert.equal(pick('builder', { home: 'gemini', offered }).provider, 'antigravity', 'a long builder step is fine on Gemini');
});

test('the critic comes from a family that didn’t do the work', () => {
  assert.equal(pick('critic', { home: 'claude', offered, family: 'claude' }).model, 'gemini-4-argon-high');
  assert.equal(pick('critic', { home: 'claude', offered, family: 'gemini' }).model, 'claude-opus-5-5');
  // Claude through Antigravity is still Claude, so it can't review Claude's work; GPT-OSS is the last resort.
  const last = pick('critic', { home: 'claude', offered: { claude, gemini: ['claude-opus-5-5-high', 'gpt-oss-120b'] }, family: 'claude' });
  assert.equal(last.model, 'gpt-oss-120b');
  assert.match(last.reason, /last resort/);
});

test('escalation: two failed checks or a hand-back go to the lead, and only once a step', () => {
  let step = { role: 'builder' }, next;
  next = escalate(step, 'check-failed');
  assert.deepEqual([next.to, next.step.failures], ['builder', 1]);
  next = escalate(next.step, 'check-failed');
  assert.deepEqual([next.to, next.itself, next.step.escalated], ['lead', false, true]);
  assert.match(next.reason, /failed twice/);
  // The lead's second brief fails too: the lead does it itself rather than sending it back again.
  const again = escalate(escalate(next.step, 'check-failed').step, 'check-failed');
  assert.deepEqual([again.to, again.itself], ['lead', true]);
  assert.equal(escalate({ role: 'builder' }, 'hand-back').to, 'lead');
  assert.equal(escalate({ role: 'builder', escalated: true }, 'hand-back').itself, true);
  assert.match(escalate({ role: 'scout' }, 'not-found').reason, /lead decides/);
  assert.equal(escalate({ role: 'builder' }, 'done').to, null);
});

test('a work request asks the plan question in the same call, and the route rides on the pick', async () => {
  let sent;
  const fetchImpl = async (url, options) => { sent = JSON.parse(options.body); return { ok: true, json: async () => ({ answers: {
    tier: { type: 'choice', choice: 'standard', confidence: 0.8, probabilities: {} }, effort: { type: 'choice', choice: 'medium', confidence: 0.8, probabilities: {} },
    ...(sent.questions.plan ? { plan: answer('plan', 0.77) } : {}) } }) }; };
  const work = await decideTier({ key: 'k', text: 'Add a --json option with tests and docs', where: 'work', fetchImpl });
  assert.deepEqual(Object.keys(sent.questions), ['tier', 'effort', 'kind', 'plan', 'swarm']);
  assert.deepEqual(work.plan, { shape: 'plan', confidence: 0.77, unsure: false });
  const chat = await decideTier({ key: 'k', text: 'hi', where: 'chat', fetchImpl });
  assert.deepEqual(Object.keys(sent.questions), ['tier', 'effort', 'kind'], 'chat isn’t split, so it isn’t asked the plan question');
  assert.equal(chat.plan, undefined);

  const router = new ModelRouter({ key: () => 'k', offered: () => ({ claude: CLAUDE_MODELS }), decide: options => decideTier({ ...options, fetchImpl }) });
  const picked = await router.pick({ provider: 'claude', text: 'Add a --json option with tests and docs', where: 'work' });
  assert.deepEqual([picked.model, picked.tier, picked.effort, picked.route.role], ['claude-opus-5-5', 'heavy', 'high', 'lead']);
  const caption = { model: picked.model, tier: picked.tier, effort: picked.effort, route: picked.route };
  assert.equal(autoCaption(caption), 'Opus 5.5 · careful · needs a plan');
  assert.match(autoWhy(caption), /^The orchestrator picked the heavy tier\. This needs a plan \(77% sure\), so the lead plans/);
  assert.equal(autoWhy({ model: 'claude-haiku-5-5', tier: 'light' }), 'The orchestrator picked the light tier.');
  // Plan mode leads whatever the answer was.
  const planned = await router.pick({ provider: 'claude', text: 'Rename a variable', where: 'work', permission: 'plan' });
  assert.equal(planned.route.role, 'lead');
  const chatPick = await router.pick({ provider: 'claude', text: 'hi', where: 'chat' });
  assert.deepEqual([chatPick.route.role, chatPick.route.shape], ['builder', undefined], 'a chat gets a role, but no plan answer');
});

test('every work eval task says what shape it is, and both shapes are there', () => {
  const work = TASKS.filter(task => task.kind === 'work');
  assert.ok(work.length >= 5);
  for (const task of work) assert.ok(['step', 'plan'].includes(task.shape), task.id);
  assert.ok(work.some(task => task.shape === 'plan') && work.some(task => task.shape === 'step'));
});

test('if the API refuses the plan question, Auto carries on without it and stops asking it', async () => {
  const asked = [], logs = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body); asked.push(Object.keys(body.questions));
    if (body.questions.plan) return { ok: false, status: 400, json: async () => ({ error: { message: 'Unknown question plan' } }) };
    return { ok: true, json: async () => ({ answers: { tier: { type: 'choice', choice: 'standard', confidence: 0.9 }, effort: { type: 'choice', choice: 'medium', confidence: 0.9 } } }) };
  };
  const router = new ModelRouter({ key: () => 'k', offered: () => ({ claude: CLAUDE_MODELS }), decide: options => decideTier({ ...options, fetchImpl }), log: line => logs.push(line) });
  const first = await router.pick({ provider: 'claude', text: 'Fix the failing test', where: 'work' });
  assert.deepEqual([first.model, first.route.shape, first.route.role], ['claude-sonnet-5-5', 'step', 'builder']);
  await router.pick({ provider: 'claude', text: 'Fix another test', where: 'work' });
  assert.deepEqual(asked, [['tier', 'effort', 'kind', 'plan', 'swarm'], ['tier', 'effort', 'kind', 'plan'], ['tier', 'effort', 'kind'], ['tier', 'effort', 'kind']], 'Swarm’s question goes first, then the plan question; the kind, not named, stays');
  assert.match(logs[0], /Swarm question was refused/);
  assert.match(logs[1], /plan question was refused/);
  // An API that refuses only Swarm's question keeps the plan question.
  const kept = [], picky = new ModelRouter({ key: () => 'k', offered: () => ({ claude: CLAUDE_MODELS }), log: () => {}, decide: options => decideTier({ ...options, fetchImpl: async (url, request) => {
    const body = JSON.parse(request.body); kept.push(Object.keys(body.questions));
    if (body.questions.swarm) return { ok: false, status: 400, json: async () => ({ error: { message: 'Unknown question swarm' } }) };
    return { ok: true, json: async () => ({ answers: { tier: { type: 'choice', choice: 'heavy', confidence: 0.9 }, effort: { type: 'choice', choice: 'high', confidence: 0.9 }, plan: { type: 'choice', choice: 'plan', confidence: 0.9 } } }) };
  } }) });
  assert.equal((await picky.pick({ provider: 'claude', text: 'Build the export feature', where: 'work' })).route.shape, 'plan');
  assert.deepEqual(kept, [['tier', 'effort', 'kind', 'plan', 'swarm'], ['tier', 'effort', 'kind', 'plan']]);
  assert.deepEqual([picky.askPlan, picky.askSwarm, picky.askKind], [true, false, true]);
  // Any other failure still falls back to your chosen model, as before.
  const broken = new ModelRouter({ key: () => 'k', offered: () => ({ claude: CLAUDE_MODELS }), decide: async () => { throw new Error('Gemini Decisions answered 403: API key not valid'); } });
  assert.equal(await broken.pick({ provider: 'claude', text: 'x', where: 'work' }), null);
  assert.equal(broken.askPlan, true);
});

test('jobs inside a work turn: scouts and builders stay within your provider, and the lead is the turn itself', async () => {
  const { seatFor, helperRole, levelOf } = await import('../desktop/orchestrator.mjs');
  const on = { auto: true, home: 'claude', offered };
  assert.deepEqual(['scout', 'builder'].map(role => { const seat = seatFor(role, on); return [seat.provider, seat.model, seat.effort]; }), [['claude', 'claude-haiku-5-5', 'low'], ['claude', 'claude-sonnet-5-5', 'medium']]);
  const gem = seatFor('scout', { ...on, home: 'gemini' });
  assert.deepEqual([gem.provider, gem.model, gem.effort], ['antigravity', 'gemini-4-hydrogen-low', 'low'], 'Gemini’s effort is read from the model’s name');
  assert.equal(seatFor('builder', { ...on, home: 'gemini' }).effort, 'high');
  // Your choice wins, there's no Auto without a key, and the lead is whatever model the turn is on.
  assert.equal(seatFor('scout', { ...on, auto: false }), null);
  assert.equal(seatFor('lead', on), null);
  assert.equal(seatFor('scout', { ...on, home: 'codex' }), null, 'Codex has no seats yet, so its own model does it');
  // Stage 2 never moves between providers: a signed-out home leaves nothing to take it.
  assert.equal(seatFor('scout', { ...on, available: { claude: false } }), null);
  assert.deepEqual([helperRole('ask_helper'), helperRole('ask_helper', 'lead'), helperRole('ask_helper', 'builder')], ['scout', 'lead', 'scout']);
  assert.deepEqual([helperRole('start_helper'), helperRole('start_helper', 'scout'), helperRole('start_helper', 'critic')], ['builder', 'scout', 'builder']);
  assert.deepEqual(['gemini-4-hydrogen-xhigh', 'gemini-4-argon-medium', 'claude-opus-5-5'].map(levelOf), ['max', 'medium', null]);
});

test('the helper tools take a role, and the row says which model took the job', async () => {
  const { WorkTools, workTools } = await import('../desktop/work-tools.mjs');
  const { mkdtemp, realpath, rm } = await import('node:fs/promises'), { tmpdir } = await import('node:os'), { join } = await import('node:path');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'fairy-roles-')));
  try {
    const asked = [], rows = [];
    const tools = new WorkTools({ root, permission: 'auto', runCommand: async () => ({ exitCode: 0, output: '' }), approve: async () => 'allow', onEvent: event => { if (event.type === 'tool') rows.push({ ...event.row }); },
      helper: async ({ task, role, onSeat }) => { asked.push({ task, role }); onSeat({ model: role === 'lead' ? 'claude-opus-5-5' : 'claude-haiku-5-5', role }); return 'found it'; } });
    const schema = tools.available().find(tool => tool.name === 'ask_helper');
    assert.deepEqual(schema.inputSchema.properties.role.enum, ['scout', 'lead']);
    assert.deepEqual(workTools.length >= 0 && schema.inputSchema.required, ['task']);
    await tools.handle({ tool: 'ask_helper', arguments: { task: 'Where is the port set?' } });
    await tools.handle({ tool: 'ask_helper', arguments: { task: 'Why does this deadlock?', role: 'lead' } });
    const badRole = await tools.handle({ tool: 'ask_helper', arguments: { task: 'x', role: 'builder' } });
    assert.equal(badRole.success, false); assert.equal(badRole.outcome, 'invalid');
    // The tool's own fallback stays intact when argument checks only report.
    tools.argumentsMode = 'report';
    await tools.handle({ tool: 'ask_helper', arguments: { task: 'x', role: 'builder' } });
    assert.deepEqual(asked.map(item => item.role), ['scout', 'lead', 'scout']);
    const done = tools.activity.filter(row => row.tool === 'helper');
    assert.deepEqual(done.map(row => row.seat), [{ model: 'claude-haiku-5-5', role: 'scout' }, { model: 'claude-opus-5-5', role: 'lead' }, { model: 'claude-haiku-5-5', role: 'scout' }]);
    assert.ok(rows.some(row => row.tool === 'helper' && row.status === 'running' && row.seat), 'the seat shows while it works');
  } finally { await rm(root, { recursive: true, force: true }); }
});
