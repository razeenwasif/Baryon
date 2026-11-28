import test from 'node:test';
import assert from 'node:assert/strict';
import { DECIDE_WAIT, chatRoute, pick, seatFor } from '../desktop/orchestrator.mjs';
import { ModelRouter, decideTier } from '../desktop/model-router.mjs';
import { autoCaption, autoWhy } from '../src/auto-caption.js';
import { CLAUDE_MODELS } from '../src/model-menu.js';

test('a chat message’s role follows its tier: small talk to the scout, hard questions to the lead', () => {
  assert.deepEqual(chatRoute({ tier: 'light', effort: 'low' }), { role: 'scout', tier: 'light', effort: 'low', reason: 'A quick message, so the fastest model answers.' });
  assert.equal(chatRoute({ tier: 'standard', effort: 'medium' }).role, 'builder');
  assert.deepEqual([chatRoute({ tier: 'heavy', effort: 'high' }).role, chatRoute({ tier: 'extreme', effort: 'max' }).role], ['lead', 'lead']);
});

test('a spoken message thinks less below the lead, so its first words come sooner; a hard one still thinks', () => {
  const said = chatRoute({ tier: 'standard', effort: 'high' }, { spoken: true });
  assert.equal(said.effort, 'medium');
  assert.match(said.reason, /Spoken, so it thinks a little less/);
  assert.equal(chatRoute({ tier: 'standard', effort: 'high' }).effort, 'high', 'typed, it keeps its effort');
  assert.equal(chatRoute({ tier: 'heavy', effort: 'max' }, { spoken: true }).effort, 'max');
  assert.ok(DECIDE_WAIT.spoken < DECIDE_WAIT.chat);
});

test('the router routes chat by role, waits less for a spoken message, and its line says why', async () => {
  const waits: AbortSignal[] = [];
  const fetchImpl: any = async (_url: any, options: any) => { waits.push(options.signal); return { ok: true, json: async () => ({ answers: { tier: { type: 'choice', choice: 'light', confidence: 0.9 }, effort: { type: 'choice', choice: 'low', confidence: 0.9 } } }) }; };
  const seen: Array<number | undefined> = [];
  const router = new ModelRouter({ key: () => 'k', offered: () => ({ claude: CLAUDE_MODELS }), decide: options => { seen.push(options.timeout); return decideTier({ ...options, fetchImpl }); } });
  const typed = (await router.pick({ provider: 'claude', text: 'hi!', where: 'chat' }))!;
  const said = (await router.pick({ provider: 'claude', text: 'hi!', where: 'chat', spoken: true }))!;
  assert.deepEqual(seen, [DECIDE_WAIT.chat, DECIDE_WAIT.spoken]);
  assert.deepEqual([typed.model, typed.route!.role], ['claude-haiku-5-5', 'scout']);
  assert.equal(said.route!.shape, undefined, 'chats aren’t split, so there’s no plan answer');
  const line = { model: typed.model, tier: typed.tier, effort: typed.effort, route: typed.route } as any;
  assert.equal(autoCaption(line), 'Haiku 5.5 · quick');
  assert.equal(autoWhy(line), 'The orchestrator picked the light tier. A quick message, so the fastest model answers.');
});

test('the Codex template: every role has its seat, ready for when the plan allows Codex’s models', () => {
  const offered = { codex: [{ id: 'gpt-6-luna' }, { id: 'gpt-6-terra' }, { id: 'gpt-6.1-sol' }, { id: 'gpt-6-astra' }] };
  assert.deepEqual(['lead', 'builder', 'scout'].map(role => { const seat = pick(role as any, { home: 'codex', offered, only: true })!; return [seat.provider, seat.model, seat.effort]; }),
    [['codex', 'gpt-6-astra', 'high'], ['codex', 'gpt-6-terra', 'medium'], ['codex', 'gpt-6-luna', 'low']]);
  assert.equal(pick('lead', { home: 'codex', offered: { codex: [{ id: 'gpt-6.1-sol' }] }, only: true })!.model, 'gpt-6.1-sol', 'Sol leads where Astra isn’t offered');
  assert.equal(seatFor('builder', { auto: true, home: 'codex', offered })!.model, 'gpt-6-terra');
  // The critic for Codex's work comes from another family.
  assert.equal(pick('critic', { home: 'codex', offered: { ...offered, claude: CLAUDE_MODELS }, family: 'gpt' })!.provider, 'claude');
});
