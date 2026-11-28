import test from 'node:test';
import assert from 'node:assert/strict';
import { providerTrouble, turnStandIn, usageFrom } from '../desktop/orchestrator.mjs';
import { DOWN_FOR, WorkSeats } from '../desktop/work-seats.mjs';
import { autoCaption, autoWhy } from '../src/auto-caption.js';
import { CLAUDE_MODELS } from '../src/model-menu.js';
import { cleanSettings } from '../desktop/core.mjs';
import { DEFAULTS } from '../src/defaults.js';

const agy = ['gemini-4-argon-high', 'gemini-4-hydrogen-low', 'gemini-4-hydrogen-high', 'claude-opus-5-5-high', 'claude-sonnet-5-5-medium'];
// A world of two subscriptions, as main.cjs wires it; connect returns what a work turn would run on.
function world(overrides: any = {}) {
  const lines: any[] = [], clock = { now: 1_000_000 };
  const state = { settings: { ...DEFAULTS, workAutoModel: 'on', workStandIns: 'on', workProvider: 'claude', ...overrides.settings }, status: { claude: true, gemini: true, ...overrides.status }, plans: overrides.plans || {} };
  const seats = new WorkSeats({ settings: () => state.settings, status: () => state.status, plans: () => state.plans, hasKey: () => true, log: (line: any) => lines.push(line), now: () => clock.now,
    offered: () => ({ claude: CLAUDE_MODELS, gemini: agy.filter(id => id.startsWith('gemini-')), agyClaude: agy.filter(id => id.startsWith('claude-')), codex: [{ id: 'gpt-6-luna' }, { id: 'gpt-6-terra' }, { id: 'gpt-6-astra' }] }),
    connect: (kind = 'claude', model = 'claude-opus-5-5', effort = 'high') => ({ provider: kind, settings: kind === 'claude' ? { backend: 'claude', claudeModel: model, reasoning: effort } : kind === 'codex' ? { backend: 'codex', model, reasoning: effort } : { backend: 'antigravity', antigravityModel: model, reasoning: effort } }) });
  return { seats, lines, state, clock };
}
const turn: any = { provider: 'claude', settings: { backend: 'claude', claudeModel: 'claude-opus-5-5' }, pool: 'claude' };

test('a provider that can’t take work is told apart from a job that went wrong', () => {
  assert.equal(providerTrouble('Antigravity: Individual quota reached. Please upgrade your subscription to increase your limits.')!.kind, 'limit');
  assert.equal(providerTrouble('Claude AI usage limit reached|1763000000')!.kind, 'limit');
  assert.equal(providerTrouble('Invalid API key · Please run /login')!.kind, 'signed-out');
  assert.equal(providerTrouble('Open Terminal, run agy and sign in again')!.kind, 'signed-out');
  assert.equal(providerTrouble('Claude reply exceeded the limit.'), null, 'a reply too long is the job’s problem, not the provider’s');
  assert.equal(providerTrouble('ENOENT: no such file'), null);
});

test('usage bars become fractions, with Claude’s per-model weekly bars by model name', () => {
  const usage = usageFrom({ claude: { meters: [{ short: '5h', used: 40 }, { short: 'Week', used: 61 }, { short: '', label: 'Weekly limit: Opus', used: 97 }] }, gemini: { meters: [{ short: '5h', used: 100 }] }, codex: { meters: [{ short: '5h', used: 5 }] } });
  assert.deepEqual(usage, { claude: { all: 0.61, models: { opus: 0.97 } }, gemini: { all: 1, models: {} }, codex: { all: 0.05, models: {} } });
  assert.equal(turnStandIn('claude', { available: { claude: false, gemini: true } })!.reason, 'Gemini took this turn, because Claude isn’t available.');
  assert.match(turnStandIn('gemini', { usage: { gemini: { all: 0.99 } } })!.reason, /^Claude took this turn, because Gemini’s usage is 99%/);
  assert.equal(turnStandIn('claude', { usage: { claude: 0.9 } }), null, 'a turn moves only when yours is nearly full');
  assert.equal(turnStandIn('claude', { available: { claude: false, gemini: false } }), null);
});

test('with moving off, every job stays with your provider; with it on, a signed-out or full one hands over', () => {
  const off = world({ settings: { workStandIns: 'off' }, status: { claude: false } });
  assert.equal(off.seats.seat('builder', turn).pool, 'claude', 'it stays, and the turn’s own model does it');
  const down = world({ status: { claude: false } }).seats.seat('builder', turn);
  assert.deepEqual([down.provider, down.settings.antigravityModel, down.seat.standIn], ['antigravity', 'gemini-4-hydrogen-high', 'Builder on Gemini, because Claude isn’t available.']);
  // Sonnet's own weekly bar is full, so builders move, while the lead (the turn) and scouts on Haiku stay.
  const sonnetFull = world({ plans: { claude: { meters: [{ short: '5h', used: 20 }, { short: '', label: 'Weekly limit: Sonnet', used: 92 }] } } }).seats;
  assert.equal(sonnetFull.seat('builder', turn).pool, 'gemini');
  assert.equal(sonnetFull.seat('scout', turn).pool, 'claude');
  assert.equal(sonnetFull.seat('lead', turn).pool, 'claude');
  // On Codex, Codex's own seats, and a stand-in only when Codex can't take it. Nothing moves to Codex from elsewhere.
  assert.equal(world({ settings: { workProvider: 'codex' }, status: { codex: true } }).seats.seat('builder', null).settings.model, 'gpt-6-terra');
  assert.equal(world({ settings: { workProvider: 'codex' }, status: { codex: false } }).seats.seat('builder', null).pool, 'claude');
  assert.ok(['claude', 'gemini'].includes(world({ status: { claude: false } }).seats.seat('builder', turn).pool!));
});

test('a quick job keeps off agy when your provider is Gemini', () => {
  const { seats } = world({ settings: { workProvider: 'antigravity' } });
  const quick = seats.seat('scout', null, { short: true });
  assert.deepEqual([quick.provider, quick.settings.claudeModel, quick.seat.standIn], ['claude', 'claude-haiku-5-5', 'Scout on Claude, because it’s a quick job, and Antigravity takes about 30 seconds to start.']);
  assert.equal(seats.seat('scout', null).pool, 'gemini', 'a longer job stays');
});

test('Claude through Antigravity is used only when you allow it', () => {
  const both = { status: { claude: false }, plans: { gemini: { meters: [{ short: '5h', used: 99 }] } } };
  assert.equal(world(both).seats.seat('builder', turn).pool, 'gemini', 'without it, a full Gemini is still the last resort');
  const allowed = world({ ...both, settings: { claudeViaAntigravity: 'on' } }).seats.seat('builder', turn);
  assert.deepEqual([allowed.pool, allowed.settings.antigravityModel], ['agyClaude', 'claude-sonnet-5-5-medium']);
  assert.equal(allowed.seat.standIn, 'Builder on Claude through Antigravity, because Claude isn’t available.');
});

test('a sign-out mid-job moves it, and the row and routing.jsonl say so', async () => {
  const { seats, lines, clock } = world(), shown: any[] = [], ran: string[] = [];
  const result = await seats.run('builder', turn, async seat => { ran.push(seat.pool!); if (seat.pool === 'claude') throw new Error('Invalid API key · Please run /login'); return 'built'; }, { onSeat: seat => shown.push(seat), chat: 'c1' });
  assert.equal(result, 'built');
  assert.deepEqual(ran, ['claude', 'gemini']);
  assert.deepEqual(shown.map(seat => [seat.model, seat.standIn || '']), [['claude-sonnet-5-5', ''], ['gemini-4-hydrogen-high', 'Moved to Gemini, because Claude is signed out.']]);
  assert.deepEqual(lines.map(line => [line.chat, line.role, line.provider, line.outcome, line.trouble || '']), [['c1', 'builder', 'claude', 'moved', 'signed-out'], ['c1', 'builder', 'antigravity', 'done', '']]);
  assert.ok(lines.every(line => Number.isFinite(line.ms) && !('brief' in line)), 'it times each job and keeps no content');
  // Claude is passed over for a while, then tried again.
  assert.equal(seats.seat('builder', turn).pool, 'gemini');
  assert.match(seats.seat('builder', turn).seat.standIn!, /Claude isn’t available/);
  clock.now += DOWN_FOR + 1;
  assert.equal(seats.seat('builder', turn).pool, 'claude');
});

test('with moving off, or for a job that simply failed, the error stands', async () => {
  const off = world({ settings: { workStandIns: 'off' } });
  await assert.rejects(off.seats.run('builder', turn, async () => { throw new Error('Claude AI usage limit reached'); }), /usage limit/);
  assert.equal(off.seats.isDown('claude'), true, 'still noted, so the next turn knows');
  const on = world(), tries: string[] = [];
  await assert.rejects(on.seats.run('builder', turn, async seat => { tries.push(seat.pool!); throw new Error('The tests failed.'); }), /tests failed/);
  assert.deepEqual(tries, ['claude']);
  assert.equal(on.lines[0].outcome, 'failed');
  // Both providers out: it tries each once, then gives up with the last error.
  const both = world(), seen: string[] = [];
  await assert.rejects(both.seats.run('builder', turn, async seat => { seen.push(seat.pool!); throw new Error('quota reached'); }), /quota reached/);
  assert.deepEqual(seen, ['claude', 'gemini']);
});

test('the turn itself moves when yours can’t take it, and its caption says so', () => {
  const { seats } = world({ status: { claude: false } });
  assert.deepEqual(seats.turnProvider(), { provider: 'gemini', reason: 'Gemini took this turn, because Claude isn’t available.' });
  assert.equal(world({ settings: { workStandIns: 'off' }, status: { claude: false } }).seats.turnProvider(), null);
  assert.equal(world({ settings: { workAutoModel: 'off' }, status: { claude: false } }).seats.turnProvider(), null, 'a model you chose stays your choice');
  const later = world();
  later.seats.markDown('claude', { kind: 'limit' } as any);
  assert.equal(later.seats.turnProvider()?.provider, 'gemini', 'a provider that just failed counts as unavailable');
  const auto = { model: 'gemini-4-argon-high', tier: 'heavy', effort: 'high', standIn: 'Gemini took this turn, because Claude isn’t available.' };
  assert.equal(autoCaption(auto), 'Gemini 4 Argon · careful · stand-in');
  assert.match(autoWhy(auto), /^Gemini took this turn, because Claude isn’t available\. The orchestrator picked the heavy tier\./);
});

test('both new settings are off until you turn them on', () => {
  assert.deepEqual([DEFAULTS.workStandIns, DEFAULTS.claudeViaAntigravity], ['off', 'off']);
  assert.equal(cleanSettings({ workStandIns: 'on', claudeViaAntigravity: 'on' }).workStandIns, 'on');
  assert.throws(() => cleanSettings({ workStandIns: 'sometimes' as any }), /move between your subscriptions/);
});

test('housekeeping takes the light seat even with work Auto off; builder and lead jobs keep your model', () => {
  // Token use, step 3: notes on older messages, the turn behind web_search and helper searches are scout jobs.
  const off = world({ settings: { workAutoModel: 'off' } });
  const scout = off.seats.seat('scout', turn);
  assert.equal(scout.settings.claudeModel, 'claude-haiku-5-5');
  assert.equal(scout.seat.model, 'claude-haiku-5-5');
  assert.equal(off.seats.seat('builder', turn).settings.claudeModel, 'claude-opus-5-5', 'the builder keeps the model you chose');
  assert.equal(off.seats.seat('lead', turn).settings.claudeModel, 'claude-opus-5-5');
  // The same on Gemini, and with no Gemini key for Auto's decisions.
  const gemini = world({ settings: { workAutoModel: 'off', workProvider: 'antigravity' } });
  assert.equal(gemini.seats.seat('scout', turn).pool, 'gemini');
  const nokey = world({ settings: { workAutoModel: 'off' } }); nokey.seats.hasKey = () => false;
  assert.equal(nokey.seats.seat('scout', turn).settings.claudeModel, 'claude-haiku-5-5');
  // A home provider with no light model offered falls back to the turn's own.
  const bare = world({ settings: { workAutoModel: 'off' } }); bare.seats.offered = () => ({ claude: [], gemini: [], codex: [] });
  assert.equal(bare.seats.seat('scout', turn).settings.claudeModel, 'claude-opus-5-5');
});
