// Models for each role (Settings → Work sessions): your model per role per provider for the orchestrator's lead,
// builder and scout, and Swarm's designer. Automatic leaves the choice as before; a choice is used while its provider
// offers it, and a seat can only be given its own provider's model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pick, seatFor, seatChoices, swarmChoices, SEAT_SETTINGS } from '../desktop/orchestrator.mjs';
import { designerSeats } from '../desktop/swarm.mjs';
import { ModelRouter } from '../desktop/model-router.mjs';
import { cleanSettings } from '../desktop/core.mjs';
import { DEFAULTS } from '../src/defaults.js';
import { seatKey, seatModels, seatOptions, SEAT_ROWS, SEAT_COLUMNS } from '../src/seat-settings.js';
import { CLAUDE_MODELS } from '../src/model-menu.js';

const gemini = ['gemini-4-neon-high', 'gemini-4-neon-xhigh', 'gemini-4-neon-low', 'gemini-4-argon-high', 'gemini-4-hydrogen-high', 'gemini-4-hydrogen-low', 'gemini-pro-orchestrator-neon'];
const offered = { claude: CLAUDE_MODELS, gemini, codex: [{ id: 'gpt-6-astra' }, { id: 'gpt-6.1-sol' }, { id: 'gpt-6-terra' }] };

test('every setting the window draws is one the app keeps, and all start Automatic', () => {
  const drawn = SEAT_ROWS.flatMap(row => SEAT_COLUMNS.map(column => seatKey(row.role, column.provider)));
  assert.deepEqual([...drawn].sort(), [...SEAT_SETTINGS].sort());
  for (const key of SEAT_SETTINGS) assert.equal(DEFAULTS[key as keyof typeof DEFAULTS], '', key);
  assert.deepEqual(seatChoices(DEFAULTS), { lead: {}, builder: {}, scout: {} });
  assert.deepEqual(swarmChoices(DEFAULTS), {});
});

test('a seat can only be given its own provider’s model', () => {
  const base = cleanSettings({});
  assert.equal(cleanSettings({ ...base, orchBuilderClaude: 'claude-opus-5-5' }).orchBuilderClaude, 'claude-opus-5-5');
  assert.equal(cleanSettings({ ...base, swarmCodex: 'gpt-6-astra' }).swarmCodex, 'gpt-6-astra');
  assert.throws(() => cleanSettings({ ...base, swarmGemini: 'claude-opus-5-5' }), /Gemini model/);
  assert.throws(() => cleanSettings({ ...base, orchLeadClaude: 'gemini-4-neon-high' }), /Claude model/);
  assert.throws(() => cleanSettings({ ...base, orchLeadGemini: 'gemini-pro-orchestrator-neon' }), /Gemini model/, 'agy’s own Orchestrator isn’t one model');
  assert.throws(() => cleanSettings({ ...base, orchScoutCodex: '--model x' }), /Codex model/);
});

test('the orchestrator uses your choice for a role while the provider offers it', () => {
  const chosen = seatChoices({ orchBuilderClaude: 'claude-opus-5-5', orchScoutGemini: 'gemini-4-neon-low', orchLeadGemini: 'gemini-4-argon-high' });
  const builder = pick('builder', { home: 'claude', offered: offered as any, chosen })!;
  assert.deepEqual([builder.model, builder.effort, builder.yours], ['claude-opus-5-5', 'medium', true], 'the builder seat’s effort with your model');
  assert.equal(pick('scout', { home: 'gemini', offered: offered as any, chosen })!.model, 'gemini-4-neon-low');
  assert.equal(pick('critic', { home: 'claude', offered: offered as any, family: 'claude', chosen })!.model, 'gemini-4-argon-high', 'the critic is a lead of the other family, so your Gemini lead');
  assert.equal(pick('builder', { home: 'gemini', offered: offered as any, chosen })!.model, 'gemini-4-hydrogen-high', 'a role you left Automatic');
  const gone = seatChoices({ orchBuilderClaude: 'claude-opus-4-1' });
  assert.equal(pick('builder', { home: 'claude', offered: offered as any, chosen: gone })!.model, 'claude-sonnet-5-5', 'a choice no longer offered falls back');
  assert.equal(seatFor('builder', { auto: true, home: 'claude', offered: offered as any, chosen })!.model, 'claude-opus-5-5');
});

test('Swarm uses your designer per provider, its level as chosen', () => {
  const status = { claude: true, gemini: true, codex: true };
  const seats = designerSeats({ status, offered: offered as any, tier: 'extreme', effort: 'max', chosen: swarmChoices({ swarmGemini: 'gemini-4-neon-high', swarmClaude: 'claude-opus-5-5' }) }).seats;
  assert.deepEqual(seats.map(seat => [seat.provider, seat.model, Boolean(seat.yours)]), [['claude', 'claude-opus-5-5', true], ['gemini', 'gemini-4-neon-high', true], ['codex', 'gpt-6-astra', false]]);
});

test('a chosen lead is used only for a work turn the orchestrator makes the lead', async () => {
  const decide = (plan: any, tier: any) => async () => ({ tier, effort: 'high', confidence: 0.9, unsure: false, plan });
  const router = (plan: any, tier: any = 'heavy') => new ModelRouter({ key: () => 'k', offered: () => ({ gemini }) as any, decide: decide(plan, tier) as any });
  const chosen = { gemini: 'gemini-4-argon-high' };
  const lead = (await router({ shape: 'plan', confidence: 0.9 }).pick({ provider: 'gemini', text: 'Plan and build an export feature', where: 'work', chosen }))!;
  assert.deepEqual([lead.route!.role, lead.model, lead.yours], ['lead', 'gemini-4-argon-high', true]);
  const heavyStep = (await router({ shape: 'step', confidence: 0.9 }).pick({ provider: 'gemini', text: 'Fix this race', where: 'work', chosen }))!;
  assert.deepEqual([heavyStep.route!.role, heavyStep.model], ['lead', 'gemini-4-argon-high'], 'heavy work is the lead’s, plan or not');
  const step = (await router({ shape: 'step', confidence: 0.9 }, 'standard').pick({ provider: 'gemini', text: 'Rename a variable', where: 'work', chosen }))!;
  assert.notEqual(step.model, 'gemini-4-argon-high', 'a standard step is the builder’s, so Auto’s model');
  const chat = (await router(null).pick({ provider: 'gemini', text: 'Hello', where: 'chat', chosen }))!;
  assert.equal(chat.yours, undefined);
});

test('the window lists each provider’s own models, keeps a saved choice it can’t list, and never offers agy’s Orchestrator', () => {
  assert.deepEqual(seatModels('gemini', { gemini: gemini.map(id => ({ id, name: id })) }).map(item => item.id), gemini.filter(id => !id.includes('orchestrator')));
  assert.deepEqual(seatModels('codex', { codex: [{ id: 'gpt-6-astra', displayName: 'Astra' }, { id: 'o9' }] }), [{ id: 'gpt-6-astra', name: 'Astra' }]);
  assert.equal(seatModels('claude')[0].id, CLAUDE_MODELS[0].id);
  const options = seatOptions('gemini', {}, 'gemini-4-neon-high');
  assert.deepEqual(options.map(option => option.value), ['', 'gemini-4-neon-high']);
  assert.match(options[1].label, /not offered now/);
});
