import test from 'node:test';
import assert from 'node:assert/strict';
import { modelFor, readTier, decideTier, decisionInput, ModelRouter, withModel } from '../desktop/model-router.mjs';
import { CLAUDE_MODELS, modelChange, modelLabel, modelGroups, autoState } from '../src/model-menu.js';
import { cleanSettings } from '../desktop/core.mjs';
import { DEFAULTS } from '../src/defaults.js';

const agy = ['gemini-4-argon-medium', 'gemini-4-argon-high', 'gemini-4-argon-low', 'gemini-3.8-flash-high', 'gemini-3.8-flash-medium', 'gemini-3.8-flash-low'];
const codex = [{ id: 'gpt-6-luna' }, { id: 'gpt-6-terra' }, { id: 'gpt-6.1-sol' }, { id: 'gpt-6-astra' }];

test('each tier is a model of the provider you chose', () => {
  assert.deepEqual(['light', 'standard', 'heavy', 'extreme'].map(tier => modelFor('claude', tier, CLAUDE_MODELS)), ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-2']);
  assert.deepEqual(['light', 'standard', 'heavy', 'extreme'].map(tier => modelFor('gemini', tier, agy)), ['gemini-3.8-flash-low', 'gemini-3.8-flash-high', 'gemini-4-argon-medium', 'gemini-4-argon-high']);
  assert.equal(modelFor('gemini', 'extreme', [...agy, 'gemini-4-carbon-high']), 'gemini-4-carbon-high', 'Carbon once your plan offers it');
  // Gemini 4 Hydrogen, the newest Flash, comes before 3.8 Flash once agy offers it.
  const withHydrogen = [...agy, 'gemini-4-hydrogen-high', 'gemini-4-hydrogen-xhigh', 'gemini-4-hydrogen-medium', 'gemini-4-hydrogen-low'];
  assert.deepEqual(['light', 'standard', 'heavy', 'extreme'].map(tier => modelFor('gemini', tier, withHydrogen)), ['gemini-4-hydrogen-low', 'gemini-4-hydrogen-high', 'gemini-4-argon-medium', 'gemini-4-argon-high']);
  assert.equal(modelFor('gemini', 'standard', withHydrogen, 'medium'), 'gemini-4-hydrogen-medium');
  assert.equal(modelFor('gemini', 'light', withHydrogen, 'max'), 'gemini-4-hydrogen-xhigh', 'max is the highest level it has');
  assert.deepEqual(['light', 'standard', 'heavy', 'extreme'].map(tier => modelFor('codex', tier, codex)), ['gpt-6-luna', 'gpt-6-terra', 'gpt-6.1-sol', 'gpt-6-astra']);
  // A tier a provider lacks falls to the nearest one below, or else the smallest above.
  assert.equal(modelFor('codex', 'standard', [{ id: 'gpt-6.1-sol' }, { id: 'gpt-6-astra' }]), 'gpt-6.1-sol');
  assert.equal(modelFor('codex', 'light', [{ id: 'gpt-6.1-sol' }]), 'gpt-6.1-sol');
  assert.equal(modelFor('deepseek', 'light', ['deepseek-flash']), null);
  assert.equal(modelFor('codex', 'light', []), null);
});

test('a sure answer is taken; an unsure one lands where its chances centre; agents and tutors never go smallest', () => {
  assert.deepEqual(readTier({ type: 'choice', choice: 'light', confidence: 0.91, probabilities: { light: 0.91, standard: 0.07, heavy: 0.01, extreme: 0.01 } }), { tier: 'light', confidence: 0.91, unsure: false });
  assert.equal(readTier({ type: 'choice', choice: 'light', confidence: 0.45, probabilities: { light: 0.45, standard: 0.42, heavy: 0.13, extreme: 0 } }).tier, 'standard');
  assert.equal(readTier({ type: 'choice', choice: 'extreme', confidence: 0.5, probabilities: { light: 0, standard: 0.1, heavy: 0.4, extreme: 0.5 } }).tier, 'heavy');
  assert.equal(readTier({ type: 'choice', choice: 'light', confidence: 0.95, probabilities: { light: 0.95 } }, 'work').tier, 'standard');
  assert.equal(readTier({ type: 'choice', choice: 'light', confidence: 0.95, probabilities: { light: 0.95 } }, 'notebook').tier, 'standard');
  assert.equal(readTier({ type: 'choice', choice: 'gigantic', confidence: 0.9 }), null);
  assert.equal(readTier(null), null);
});

test('the request goes to the Decisions API as one choice question, with the key in a header', async () => {
  let sent;
  const fetchImpl = async (url, options) => { sent = { url, ...options, body: JSON.parse(options.body) }; return { ok: true, json: async () => ({ answers: { tier: { type: 'choice', choice: 'heavy', confidence: 0.83, probabilities: { light: 0.02, standard: 0.12, heavy: 0.83, extreme: 0.03 } }, effort: { type: 'choice', choice: 'high', confidence: 0.77, probabilities: { low: 0.01, medium: 0.17, high: 0.77, max: 0.05 } } }, usage: { total_input_tokens: 612, total_output_tokens: 0 } }) }; };
  const result = await decideTier({ key: 'test-key', text: 'Refactor the auth middleware and fix the failing tests', context: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'Hello!' }], where: 'work', fetchImpl });
  // A work request also asks the orchestrator's plan question and Swarm's; an API that doesn't answer them leaves both unknown.
  assert.deepEqual(result, { tier: 'heavy', confidence: 0.83, unsure: false, effort: 'high', plan: null, swarm: null });
  assert.deepEqual(Object.keys(sent.body.questions), ['tier', 'effort', 'kind', 'plan', 'swarm']);
  assert.deepEqual(Object.keys(sent.body.questions.effort.criteria), ['low', 'medium', 'high', 'max']);
  assert.equal(sent.url, 'https://generativelanguage.googleapis.com/v1beta/decisions');
  assert.equal(sent.headers['x-goog-api-key'], 'test-key');
  assert.equal(sent.body.model, 'gemini-decision-1');
  assert.equal(sent.body.questions.tier.type, 'choice');
  assert.deepEqual(Object.keys(sent.body.questions.tier.criteria), ['light', 'standard', 'heavy', 'extreme']);
  assert.match(sent.body.input, /work session/);
  assert.match(sent.body.input, /User: hi\nFairy: Hello!/);
  assert.match(sent.body.input, /Refactor the auth middleware/);
  assert.doesNotMatch(JSON.stringify(sent.body), /test-key/, 'the key is never in the body');
  await assert.rejects(decideTier({ key: 'k', text: 'x', fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ error: { message: 'API key not valid' } }) }) }), /403: API key not valid/);
  assert.equal(await decideTier({ key: '', text: 'x', fetchImpl }), null);
  assert.ok(decisionInput({ text: 'y'.repeat(20000) }).length < 8300);
});

test('the router falls back to your chosen model when it has no key, fails or offers nothing', async () => {
  const picks = [];
  let key = '';
  const router = new ModelRouter({ key: () => key, offered: () => ({ claude: CLAUDE_MODELS, gemini: agy, codex }), onPick: pick => picks.push(pick),
    decide: async ({ text }) => { if (/boom/.test(text)) throw new Error('Gemini Decisions answered 500'); return { tier: /timer/.test(text) ? 'light' : 'heavy', confidence: 0.9, unsure: false }; } });
  assert.equal(await router.pick({ provider: 'claude', text: 'set a timer for 5 minutes' }), null, 'no key');
  key = 'k';
  assert.equal((await router.pick({ provider: 'claude', text: 'set a timer for 5 minutes' })).model, 'claude-haiku-5-5');
  assert.equal((await router.pick({ provider: 'gemini', text: 'debug this race condition' })).model, 'gemini-4-argon-medium');
  assert.equal(await router.pick({ provider: 'claude', text: 'boom' }), null);
  assert.match(router.problem, /500/);
  assert.equal(await router.pick({ provider: 'deepseek', text: 'set a timer' }), null);
  assert.equal(picks.length, 2);
  assert.deepEqual(withModel({ a: 1 }, 'codex', 'gpt-6-luna'), { a: 1, model: 'gpt-6-luna' });
  assert.deepEqual(withModel({}, 'gemini', 'gemini-3.8-flash-low'), { antigravityModel: 'gemini-3.8-flash-low' });
});

test('the Orchestrator in the model menu: on by default, turned off by choosing a model, and showing what it picked', () => {
  const start = cleanSettings({ backend: 'claude', claudeModel: 'claude-opus-5-5' }, DEFAULTS);
  assert.equal(start.autoModel, 'on');
  assert.deepEqual(autoState(start, false, false), { on: true, provider: 'claude', providerName: 'Claude', working: false, note: 'Needs a Gemini API key' });
  assert.equal(autoState(start, false, true).working, true);
  assert.equal(autoState({ ...start, backend: 'deepseek' }, false, true).note, 'Not for DeepSeek');
  const groups = modelGroups({ settings: start, connected: { claude: true } });
  assert.equal(modelLabel(start, false, groups, { hasKey: false }), 'Opus 5.5', 'without a key, the chosen model as before');
  assert.equal(modelLabel(start, false, groups, { hasKey: true }), 'Orchestrator');
  assert.equal(modelLabel(start, false, groups, { hasKey: true, pick: { provider: 'claude', model: 'claude-haiku-5-5', where: 'chat' } }), 'Orchestrator · Haiku 5.5');
  assert.equal(modelLabel(start, false, groups, { hasKey: true, pick: { provider: 'claude', model: 'claude-haiku-5-5', where: 'work' } }), 'Orchestrator', 'a work pick isn’t shown on a chat');
  assert.equal(cleanSettings(modelChange({ provider: 'claude', model: 'claude-sonnet-5-5' }), start).autoModel, 'off');
  assert.equal(cleanSettings(modelChange({ auto: true }), { ...start, autoModel: 'off' }).autoModel, 'on');
  assert.equal(cleanSettings(modelChange({ work: true, auto: false }), start).workAutoModel, 'off');
  assert.throws(() => cleanSettings({ autoModel: 'maybe' }, start), /picks the model/);
});

test('Auto picks the thinking effort too, in each provider’s own terms', async () => {
  const { readEffort } = await import('../desktop/model-router.mjs');
  assert.equal(readEffort({ type: 'choice', choice: 'low', confidence: 0.9 }), 'low');
  assert.equal(readEffort({ type: 'choice', choice: 'low', confidence: 0.9 }, 'work'), 'medium', 'an agent with tools thinks at least a little');
  assert.equal(readEffort({ type: 'choice', choice: 'max', confidence: 0.4, probabilities: { low: 0, medium: 0.2, high: 0.4, max: 0.4 } }), 'high');
  assert.equal(readEffort(undefined), null);
  // Gemini's thinking level is in the model's name.
  assert.equal(modelFor('gemini', 'heavy', agy, 'high'), 'gemini-4-argon-high');
  assert.equal(modelFor('gemini', 'heavy', agy, 'low'), 'gemini-4-argon-low');
  assert.equal(modelFor('gemini', 'light', agy, 'max'), 'gemini-3.8-flash-high');
  assert.equal(modelFor('claude', 'light', CLAUDE_MODELS, 'max'), 'claude-haiku-5-5');
  assert.deepEqual(withModel({}, 'claude', 'claude-opus-5-5', 'max'), { claudeModel: 'claude-opus-5-5', autoEffort: 'max' });
  assert.deepEqual(withModel({}, 'codex', 'gpt-6.1-sol', 'max'), { model: 'gpt-6.1-sol', reasoning: 'high' });
  assert.deepEqual(withModel({}, 'gemini', 'gemini-4-argon-low', 'low'), { antigravityModel: 'gemini-4-argon-low', reasoning: 'low' });
  const { autoCaption, modelName } = await import('../src/auto-caption.js');
  assert.equal(autoCaption({ model: 'claude-haiku-5-5', tier: 'light', effort: 'low' }), 'Haiku 5.5 · quick');
  assert.equal(autoCaption({ model: 'gemini-4-argon-high', tier: 'heavy', effort: 'high' }), 'Gemini 4 Argon · careful');
  assert.equal(modelName('gpt-6.1-sol'), 'GPT 6.1 Sol');
  assert.equal(modelName('gemini-4-hydrogen-xhigh'), 'Gemini 4 Hydrogen');
  assert.equal(autoCaption(null), '');
});
