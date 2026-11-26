import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ModelRouter, decideTier, pickLine } from '../desktop/model-router.mjs';
import { MARGIN, pickByTask, shadowRecord } from '../desktop/strengths/pick.mjs';
import { comparison, offeredFromTable } from '../desktop/strengths/compare.mjs';
import { emptyTable } from '../desktop/strengths/table.mjs';
import { CLAUDE_MODELS } from '../src/model-menu.js';
import { autoWhy, byTaskWords } from '../src/auto-caption.js';

const OFFERED = { claude: ['claude-fable-5-2', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'], gemini: ['gemini-4-neon-high', 'gemini-4-hydrogen-high'], codex: ['gpt-6.1-sol', 'gpt-6.1-terra'] };
const evals = (model, kind, passed, total = 10) => ({ model, level: model, kind, passed, total, provider: 'x', run: 'r', at: 'a' });
const web = (model, kind, score, source) => ({ model, kind, score, value: score, scale: 'percent', source, benchmark: 'B', url: 'https://x.example/', quote: `${model} ${score}`, fetched: 'f' });
// Maths: Sol 9/10, Neon 8/10, Opus 6/10. Code: Opus 9/10, Sol 8/10.
const TABLE = { ...emptyTable(), evals: [evals('gpt-6.1-sol', 'maths', 9), evals('gemini-4-neon', 'maths', 8), evals('claude-opus-5-5', 'maths', 6), evals('claude-opus-5-5', 'code', 9), evals('gpt-6.1-sol', 'code', 8)] };
const maths = { tier: 'heavy', effort: 'high', kind: 'maths', kindConfidence: 0.9 };
const pick = (extra = {}) => pickByTask({ decided: maths, home: 'claude', table: TABLE, offered: OFFERED, available: { claude: true, gemini: true, codex: true }, place: 'new-chat', ...extra });

test('where a move is free and the lead is clear and sure, by task picks the leader; otherwise your provider stays', () => {
  const moved = pick();
  assert.deepEqual([moved.provider, moved.model, moved.moved, moved.margin], ['codex', 'gpt-6.1-sol', true, 30]);
  assert.match(moved.reason, /Codex leads Claude by 30 on maths \(your evals, 10 tasks\)/);
  assert.equal(moved.runnerUp.model, 'claude-opus-5-5');
  for (const place of ['work-start', 'job']) assert.equal(pick({ place }).model, 'gpt-6.1-sol', place);
  const home = pick({ decided: { ...maths, kind: 'code' } });
  assert.deepEqual([home.provider, home.moved], ['claude', false]);
  assert.match(home.reason, /Claude leads on code/);
  // A lead under the margin stays.
  const close = { ...TABLE, evals: [evals('gpt-6.1-sol', 'maths', 7), evals('claude-opus-5-5', 'maths', 6.7)] };
  const stays = pick({ table: close });
  assert.deepEqual([stays.provider, stays.moved, stays.margin], ['claude', false, 3]);
  assert.match(stays.reason, new RegExp(`under the ${MARGIN.move} needed`));
});

test('today’s pick stands for a spoken turn, everyday, an unsure or missing kind, and nothing known about your model', () => {
  for (const [extra, why] of [[{ spoken: true }, /spoken/], [{ decided: { ...maths, kind: 'everyday' } }, /Everyday/], [{ decided: { ...maths, kindUnsure: true, kindConfidence: 0.4 } }, /Not sure enough it’s maths \(40%\)/],
    [{ decided: { tier: 'heavy' } }, /No kind/], [{ place: 'research-round' }, /isn’t picked by task/], [{ table: { ...TABLE, evals: TABLE.evals.filter(row => row.model !== 'claude-opus-5-5') } }, /Nothing sure is known about Claude’s model on maths/]]) {
    const result = pick(extra);
    assert.deepEqual([result.provider, result.model, result.moved], ['claude', 'claude-opus-5-5', false], JSON.stringify(extra));
    assert.match(result.reason, why);
  }
  assert.match(pick({ table: emptyTable() }).reason, /Nothing sure enough is known about maths yet/);
});

test('mid-chat a clear lead is offered, not made; a smaller one isn’t even offered', () => {
  const offered = pick({ place: 'chat' });
  assert.deepEqual([offered.provider, offered.moved, offered.offer?.model], ['claude', false, 'gpt-6.1-sol']);
  assert.match(offered.reason, /mid-chat that’s an offer/);
  const near = { ...TABLE, evals: [evals('gpt-6.1-sol', 'maths', 7), evals('claude-opus-5-5', 'maths', 6.2)] };
  const quiet = pick({ place: 'chat', table: near });
  assert.deepEqual([quiet.offer, quiet.margin], [null, 8]);
  assert.equal(pick({ place: 'work' }).moved, false, 'a later work turn stays with its session');
});

test('a pin wins, but not over a provider that can’t take it', () => {
  const pinned = { ...TABLE, pinned: { maths: 'gemini-4-neon-high' } };
  const result = pick({ table: pinned });
  assert.deepEqual([result.model, result.pinned, result.moved], ['gemini-4-neon-high', true, true]);
  assert.match(result.reason, /Pinned for maths/);
  assert.equal(pick({ table: pinned, available: { claude: true, gemini: false, codex: true } }).model, 'gpt-6.1-sol', 'pinned Gemini signed out: the scores decide');
});

test('allowance, your provider list, sign-in and a missing model all outrank the table', () => {
  const full = pick({ usage: { codex: { all: 0.9, models: {} } } });
  assert.equal(full.model, 'gemini-4-neon-high', 'Sol’s bar is past Balanced (0.85), so the next best');
  assert.match(full.candidates.find(c => c.provider === 'codex').out, /past your allowance/);
  assert.equal(pick({ usage: { codex: { all: 0.9, models: {} } }, bias: 'quality' }).model, 'gpt-6.1-sol', 'Quality lets it run to 0.95');
  assert.equal(pick({ allowed: ['claude', 'gemini'] }).model, 'gemini-4-neon-high', 'Codex not allowed');
  assert.equal(pick({ available: { claude: true, gemini: true, codex: false } }).model, 'gemini-4-neon-high');
  const noCodex = pick({ offered: { ...OFFERED, codex: [] } });
  assert.equal(noCodex.model, 'gemini-4-neon-high');
  assert.ok(!noCodex.candidates.some(c => c.provider === 'codex'));
  const homeOut = pick({ available: { claude: false, gemini: true, codex: true } });
  assert.deepEqual([homeOut.model, homeOut.moved], ['gpt-6.1-sol', true]);
  assert.match(homeOut.reason, /Claude can’t take it here/);
});

test('a critic is never of its author’s family, whatever the scores', () => {
  const codeTable = { ...TABLE, evals: [evals('claude-opus-5-5', 'code', 10), evals('gpt-6.1-sol', 'code', 8), evals('gemini-4-neon', 'code', 7)] };
  const critic = pick({ place: 'critic', author: 'claude', decided: { ...maths, kind: 'code' }, table: codeTable });
  assert.deepEqual([critic.provider, critic.model], ['codex', 'gpt-6.1-sol']);
  assert.match(critic.candidates.find(c => c.provider === 'claude').out, /same family as the author/);
  assert.equal(pick({ place: 'critic', author: 'gpt', decided: { ...maths, kind: 'code' }, table: codeTable }).provider, 'claude');
});

test('web numbers alone need two sources before they can lead', () => {
  const one = { ...emptyTable(), public: [web('gpt-6.1-sol', 'maths', 95, 's1'), web('claude-opus-5-5', 'maths', 60, 's1'), web('claude-opus-5-5', 'maths', 62, 's2')] };
  assert.equal(pick({ table: one }).provider, 'claude', 'Sol from one page isn’t sure enough');
  const two = { ...one, public: [...one.public, web('gpt-6.1-sol', 'maths', 93, 's2')] };
  assert.deepEqual([pick({ table: two }).provider, pick({ table: two }).margin], ['codex', 33]);
  // Once your evals cover the kind, the web alone can't lead it: Sol has only web numbers, Opus and Neon have evals.
  const covered = { ...two, evals: [evals('claude-opus-5-5', 'maths', 6), evals('gemini-4-neon', 'maths', 8)] };
  const result = pick({ table: covered });
  assert.deepEqual([result.provider, result.model], ['gemini', 'gemini-4-neon-high']);
});

test('stage 4 changes no pick: the shadow rides along, and a broken one is only logged', async () => {
  const decide = options => decideTier({ ...options, fetchImpl: async () => ({ ok: true, json: async () => ({ answers: { tier: { type: 'choice', choice: 'heavy', confidence: 0.9 }, effort: { type: 'choice', choice: 'high', confidence: 0.9 }, kind: { type: 'choice', choice: 'maths', confidence: 0.9 } } }) }) });
  const seen = [], logs = [];
  const router = new ModelRouter({ key: () => 'k', offered: () => ({ claude: CLAUDE_MODELS, ...OFFERED }), decide, log: line => logs.push(line),
    shadow: (picked, context) => { seen.push(context); return shadowRecord(pickByTask({ decided: picked, home: picked.provider, table: TABLE, offered: { ...OFFERED }, place: context.place, spoken: context.spoken })); } });
  const first = await router.pick({ provider: 'claude', text: 'Solve it', where: 'chat', place: 'new-chat' });
  assert.equal(first.model, 'claude-opus-5-5', 'Opus still answers');
  assert.deepEqual([first.shadow.model, first.shadow.moved, first.shadow.margin], ['gpt-6.1-sol', true, 30]);
  await router.pick({ provider: 'claude', text: 'And this?', where: 'chat' });
  await router.pick({ provider: 'claude', text: 'Fix it', where: 'work', place: 'work-start' });
  assert.deepEqual(seen.map(c => c.place), ['new-chat', 'chat', 'work-start']);
  const line = pickLine(first);
  assert.deepEqual(line.byTask, { provider: 'codex', model: 'gpt-6.1-sol', moved: true, margin: 30 });
  assert.ok(!JSON.stringify(line).includes('Solve it'));
  const broken = new ModelRouter({ key: () => 'k', offered: () => ({ claude: CLAUDE_MODELS }), decide, log: line => logs.push(line), shadow: () => { throw new Error('no table'); } });
  const still = await broken.pick({ provider: 'claude', text: 'Solve it', where: 'chat' });
  assert.deepEqual([still.model, still.shadow], ['claude-opus-5-5', undefined]);
  assert.match(logs.at(-1), /pick by task couldn’t be worked out: no table/);
});

test('the reply’s tooltip says what by task would have done, and that it isn’t used yet', async () => {
  assert.equal(byTaskWords({ byTask: { provider: 'codex', model: 'gpt-6.1-sol', moved: true, margin: 30 } }), 'By task: would pick GPT 6.1 Sol, leading by 30. Not used yet.');
  assert.equal(byTaskWords({ byTask: { provider: 'claude', model: 'claude-opus-5-5', moved: false, offer: { model: 'gpt-6.1-sol' }, margin: 12 } }), 'By task: would offer a move to GPT 6.1 Sol, leading by 12. Not used yet.');
  assert.equal(byTaskWords({ byTask: { provider: 'claude', model: 'claude-opus-5-5', moved: false, reason: 'Claude leads on code.' } }), 'By task: the same, Opus 5.5. Claude leads on code.');
  assert.match(autoWhy({ model: 'claude-opus-5-5', tier: 'heavy', kind: 'maths', kindConfidence: 0.9, byTask: { model: 'gpt-6.1-sol', moved: true, margin: 30 } }), /Read as maths \(90% sure\)\. By task: would pick GPT 6\.1 Sol/);
  const main = await readFile(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  const moves = await readFile(new URL('../desktop/strengths/moves.mjs', import.meta.url), 'utf8');
  assert.match(main, /chatPick\(\{ router: modelRouter, yours, text, context, history, where, signal, spoken, forced,/);
  assert.match(moves, /place: where === 'chat' && !context\.length && !chosen \? 'new-chat' : 'chat'/);
  assert.match(main, /place: before\.length \? 'work' : 'work-start'/);
  assert.match(main, /modelRouter = new ModelRouter\(\{ key: \(\) => keys\.gemini \|\| '', log: message => console\.warn\(message\), shadow,/);
});

test('the comparison: each kind’s pass rate today beside by task’s, and whether it meets the bar to turn on', () => {
  const offered = offeredFromTable(TABLE);
  assert.deepEqual(offered.codex, ['gpt-6.1-sol']);
  const rows = Object.fromEntries(comparison(TABLE, { home: 'claude', tier: 'heavy', offered }).map(row => [row.kind, row]));
  assert.deepEqual([rows.maths.today.passed, rows.maths.byTask.model, rows.maths.byTask.passed, rows.maths.ahead], [6, 'gpt-6.1-sol', 9, 3]);
  assert.match(rows.maths.verdict, /better by 3 tasks: meets the bar to turn on/);
  assert.match(rows.code.verdict, /the same model/);
  assert.match(rows.circuits.verdict, /the same model \(Nothing sure enough/);
  const worse = comparison({ ...TABLE, pinned: { code: 'gpt-6.1-sol' } }, { home: 'claude', offered });
  assert.match(worse.find(row => row.kind === 'code').verdict, /worse by 1 task$/);
});
