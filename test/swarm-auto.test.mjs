// Swarm stage 4: Auto. Each seat's line shows the model and effort Auto chose, and why.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelRouter, decideTier } from '../desktop/model-router.mjs';
import { SWARM_QUESTION, readSwarm } from '../desktop/orchestrator.mjs';
import { budgetRequest, builderFor, builderSeat, chosenPick, designerSeats, designsReply, parseDesign, swarmBudget, swarmChoice, swarmLine } from '../desktop/swarm.mjs';
import { WorkTools } from '../desktop/work-tools.mjs';
import { CLAUDE_MODELS } from '../src/model-menu.js';
import { DEFAULTS } from '../src/defaults.js';
import { cleanSettings } from '../desktop/core.mjs';

const offered = { claude: CLAUDE_MODELS, gemini: ['gemini-4-argon-medium', 'gemini-4-argon-high', 'gemini-4-hydrogen-medium', 'gemini-4-hydrogen-high'], codex: [{ id: 'gpt-6-astra' }, { id: 'gpt-6.1-sol' }, { id: 'gpt-6-terra' }] };
const choiceOf = (choice, confidence = 0.8) => ({ type: 'choice', choice, confidence });
// A Decisions API that answers with these choices and records what it was asked.
const api = (answers, asked = []) => async (url, options) => { asked.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ answers }) }; };

test('one decision for every designer: never below heavy and high, and the reason in words', async () => {
  const asked = [];
  const low = await decideTier({ key: 'k', text: 'Why does the till drift by a cent?', where: 'swarm', fetchImpl: api({ tier: choiceOf('light'), effort: choiceOf('low') }, asked) });
  assert.deepEqual([low.tier, low.effort], ['heavy', 'high'], 'the swarm surface’s floors');
  assert.match(asked[0].input, /Swarm mode: strong models from different families/);
  assert.deepEqual(Object.keys(asked[0].questions), ['tier', 'effort'], 'a swarm isn’t asked whether to plan or to swarm');
  const hard = await decideTier({ key: 'k', text: 'x', where: 'swarm', fetchImpl: api({ tier: choiceOf('extreme', 0.71), effort: choiceOf('max') }) });
  assert.deepEqual(swarmChoice(hard), { tier: 'extreme', effort: 'max', why: 'Auto rated this request extreme work (71% sure) and gave every designer the deepest thinking. A swarm’s designers never run below the heavy tier at high effort.' });
  assert.match(swarmChoice({ tier: 'heavy', effort: 'high', confidence: 0.5, unsure: true }).why, /^Auto rated this request heavy work \(50% sure, so it went by where its chances centred\) and gave every designer careful thinking\./);
  assert.deepEqual(swarmChoice(null), { tier: 'heavy', effort: 'high', why: 'Without Auto’s choice, every designer runs the heavy tier at high effort.' });
  // The router's decision on its own: no model, and nothing without a key.
  const router = new ModelRouter({ key: () => 'k', decide: async options => ({ tier: 'heavy', effort: 'high', confidence: 0.9, where: options.where }) });
  assert.deepEqual(await router.decision({ text: 'x', where: 'swarm' }), { tier: 'heavy', effort: 'high', confidence: 0.9, where: 'swarm' });
  assert.equal(await new ModelRouter({ key: () => '' }).decision({ text: 'x', where: 'swarm' }), null);
  assert.equal(await new ModelRouter({ key: () => 'k', decide: async () => { throw new Error('503'); } }).decision({ text: 'x', where: 'swarm' }), null);
});

test('the tier picks each provider’s designer, and the effort how hard it thinks', () => {
  const status = { claude: true, gemini: true, codex: true };
  const heavy = designerSeats({ status, offered, tier: 'heavy', effort: 'high' }).seats;
  assert.deepEqual(heavy.map(seat => [seat.model, seat.effort]), [['claude-opus-5-5', 'high'], ['gemini-4-argon-high', 'high'], ['gpt-6.1-sol', 'high']]);
  const extreme = designerSeats({ status, offered: { ...offered, gemini: [...offered.gemini, 'gemini-4-argon-xhigh'] }, tier: 'extreme', effort: 'max' }).seats;
  assert.deepEqual(extreme.map(seat => [seat.model, seat.effort]), [['claude-fable-5-2', 'max'], ['gemini-4-argon-xhigh', 'max'], ['gpt-6-astra', 'max']], 'Carbon falls back to Argon at its highest until your plan offers it');
  assert.equal(designerSeats({ status, offered, tier: 'extreme', effort: 'max' }).seats[1].model, 'gemini-4-argon-high', 'without xhigh, high');
});

test('the budget card: calls per provider beside its 5-hour bar, with a warning when it may run out', () => {
  const seats = designerSeats({ status: { claude: true, gemini: true }, offered }).seats;
  const plans = { claude: { meters: [{ short: '5h', label: '5-hour limit', used: 82 }, { short: 'Week', used: 30 }] }, gemini: { meters: [{ short: 'Week', used: 10 }] } };
  const budget = swarmBudget({ seats, builder: 'claude', plans });
  assert.deepEqual(budget, [{ provider: 'claude', calls: 5, five: 82, warn: true }, { provider: 'gemini', calls: 5, five: null, warn: false }],
    'each designer: its design, two rounds, the brief or a sign-off; Gemini checks Claude’s build; Claude builds');
  const card = budgetRequest({ budget, seats, choice: swarmChoice(null) });
  assert.equal(card.title, 'Start a swarm? Claude Opus 5.5 and Gemini 4 Argon design it, with careful thinking.');
  assert.equal(card.detail, 'Claude: about 5 calls, 5-hour bar at 82% · Gemini: about 5 calls');
  assert.match(card.note, /^Claude’s 5-hour bar is at 82%, so it may run out partway; a designer that does sits out\. Without Auto’s choice/);
  assert.deepEqual(card.picks.map(pick => [pick.label, pick.decision]), [['Start', 'allow'], ['Not now', 'deny']]);
  assert.equal(chosenPick(card, 'allow').start, true);
  assert.equal(chosenPick(card, 'deny'), null);
});

test('the builder: your work provider, or the one with the most room, and Auto’s second decision on the brief', async () => {
  const plans = { claude: { meters: [{ short: '5h', used: 70 }] }, gemini: { meters: [{ short: '5h', used: 20 }] }, codex: { meters: [{ short: '5h', used: 5 }] } };
  assert.equal(builderFor({ setting: 'work', workProvider: 'antigravity', plans }), 'gemini');
  assert.equal(builderFor({ setting: 'room', workProvider: 'claude', status: { claude: true, gemini: true }, plans }), 'gemini', 'Codex has more room but isn’t signed in');
  assert.equal(builderFor({ setting: 'room', workProvider: 'claude', status: { claude: true, gemini: true }, plans: {} }), 'claude', 'level, so your work provider');
  assert.deepEqual(builderSeat({ provider: 'claude', offered: offered.claude }), { provider: 'claude', kind: 'claude', model: 'claude-sonnet-5-5', effort: 'medium', why: 'Without Auto’s choice, the builder runs the standard tier at medium effort.' });
  const asked = [];
  const decided = await decideTier({ key: 'k', text: '# Brief\n## Steps\n1. x', where: 'build', fetchImpl: api({ tier: choiceOf('light', 0.9), effort: choiceOf('low') }, asked) });
  assert.deepEqual([decided.tier, decided.effort], ['standard', 'medium'], 'the builder’s floor is the standard tier');
  assert.match(asked[0].input, /a builder in a work session following a written brief/);
  assert.deepEqual(builderSeat({ provider: 'gemini', decided, offered: offered.gemini }), { provider: 'gemini', kind: 'antigravity', model: 'gemini-4-hydrogen-medium', effort: 'medium', why: 'Auto read the brief as standard work (90% sure), with some thought.' });
  assert.equal(builderSeat({ provider: 'codex', decided: { tier: 'heavy', effort: 'high', confidence: 0.8 }, offered: offered.codex }).model, 'gpt-6.1-sol', 'a heavy brief gets a heavy builder');
  assert.equal(builderSeat({ provider: 'codex', offered: [] }), null);
  assert.equal(DEFAULTS.swarmBuilder, 'work');
  assert.equal(cleanSettings({ swarmBuilder: 'room' }).swarmBuilder, 'room');
  assert.throws(() => cleanSettings({ swarmBuilder: 'whoever' }), /which provider builds a swarm’s design/);
});

test('Auto suggests a swarm only for hard work it’s sure about, in the same call as the plan question', async () => {
  const asked = [];
  const work = await decideTier({ key: 'k', text: 'Migrate the ledger to integer cents', where: 'work', fetchImpl: api({ tier: choiceOf('heavy'), effort: choiceOf('high'), plan: choiceOf('plan'), swarm: choiceOf('yes', 0.74) }, asked) });
  assert.deepEqual(work.swarm, { suggest: true, confidence: 0.74 });
  assert.deepEqual(Object.keys(asked[0].questions), ['tier', 'effort', 'kind', 'plan', 'swarm']);
  assert.deepEqual(asked[0].questions.swarm, SWARM_QUESTION);
  assert.deepEqual(readSwarm(choiceOf('yes', 0.5), 'heavy'), { suggest: false, confidence: 0.5 }, 'unsure isn’t a suggestion');
  assert.equal(readSwarm(choiceOf('yes', 0.9), 'standard').suggest, false, 'nor is everyday work');
  assert.equal(readSwarm(choiceOf('no', 0.9), 'extreme').suggest, false);
  assert.equal(readSwarm(null), null);
});

test('each seat’s row carries the effort and why, and the build’s line names who designed and built it', () => {
  const tools = new WorkTools({ root: '/tmp', runCommand: async () => ({}) }), row = tools.begin('step', 'Build: x');
  tools.seated(row)({ model: 'claude-sonnet-5-5', role: 'builder', effort: 'medium', why: 'Auto read the brief as standard work (90% sure), with some thought.' });
  assert.deepEqual(row.seat, { model: 'claude-sonnet-5-5', role: 'builder', effort: 'medium', why: 'Auto read the brief as standard work (90% sure), with some thought.' });
  const seats = designerSeats({ status: { claude: true, gemini: true }, offered }).seats;
  assert.equal(swarmLine({ designers: seats, builder: 'claude-sonnet-5-5', rounds: 1 }), 'Designed by Claude Opus 5.5 and Gemini 4 Argon · built by Claude Sonnet 5.5 · 1 round');
  const designs = seats.map((seat, i) => ({ seat, letter: 'AB'[i], text: '## Finding\nx', parsed: parseDesign('## Finding\nx') }));
  assert.match(designsReply({ designs, convening: true, choice: swarmChoice({ tier: 'heavy', effort: 'high', confidence: 0.8 }) }), /^\*\*Swarm: 2 designs, made separately\*\*\n\n\*Auto rated this request heavy work \(80% sure\) and gave every designer careful thinking\./);
});
