import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ModelRouter, decideTier, tierOf } from '../desktop/model-router.mjs';
import { FADE_DAYS, useRows, withUseRows } from '../desktop/strengths/evidence.mjs';
import { chatPick } from '../desktop/strengths/moves.mjs';
import { pickByTask, shadowRecord } from '../desktop/strengths/pick.mjs';
import { StrengthsStore } from '../desktop/strengths/store.mjs';
import { strengthsService } from '../desktop/strengths/service.mjs';
import { blended, emptyTable } from '../desktop/strengths/table.mjs';
import { SessionStore } from '../desktop/sessions.mjs';
import { readJSON, writeJSON } from '../desktop/core.mjs';

const NOW = '2026-11-19T12:00:00.000Z', daysAgo = (days: number) => new Date(Date.parse(NOW) - days * 86400000).toISOString();
const OFFERED = { claude: ['claude-opus-5-5', 'claude-sonnet-5-5'], gemini: ['gemini-4-neon-high'], codex: ['gpt-6.1-sol'] };

test('real use as rows: Choose another strongly both ways, a step’s check either way, a failed turn against; fading to nothing at 60 days', () => {
  const rows = useRows([
    { at: daysAgo(0), type: 'override', kind: 'maths', fromModel: 'claude-opus-5-5', toModel: 'gpt-6.1-sol', from: 'claude', to: 'codex' },
    { at: daysAgo(30), type: 'check', kind: 'code', model: 'claude-sonnet-5-5', passed: true },
    { at: daysAgo(1), type: 'check', kind: 'code', model: 'gemini-4-neon-high', passed: false },
    { at: daysAgo(2), role: 'lead', kind: 'code', model: 'claude-opus-5-5', outcome: 'failed' },
    { at: daysAgo(2), role: 'lead', kind: 'code', model: 'claude-opus-5-5', outcome: 'done' },
    { at: daysAgo(FADE_DAYS + 1), type: 'check', kind: 'code', model: 'claude-opus-5-5', passed: true },
    { at: daysAgo(1), type: 'check', kind: 'everyday', model: 'claude-opus-5-5', passed: true },
    { at: daysAgo(1), type: 'pick', kind: 'maths', model: 'claude-opus-5-5' },
    { at: daysAgo(1), type: 'check', model: 'claude-opus-5-5', passed: true },
  ], { now: NOW });
  assert.deepEqual(rows.map(r => [r.signal, r.model, r.kind, r.for, r.weight]), [
    ['override', 'claude-opus-5-5', 'maths', false, 2], ['override', 'gpt-6.1-sol', 'maths', true, 2],
    ['check', 'claude-sonnet-5-5', 'code', true, 0.5], ['check', 'gemini-4-neon', 'code', false, 0.983], ['turn', 'claude-opus-5-5', 'code', false, 0.967]]);
  assert.ok(rows.every(r => !('content' in r) && !('text' in r)));
});

test('done when: a week of Choose another visibly moves a use score, and the blend with it', () => {
  const base = { ...emptyTable(), evals: [{ model: 'claude-opus-5-5', level: 'claude-opus-5-5', kind: 'maths', passed: 8, total: 10 }, { model: 'gpt-6.1-sol', level: 'gpt-6.1-sol', kind: 'maths', passed: 8, total: 10 }] };
  const before = [blended(base, 'claude-opus-5-5', 'maths')!.score, blended(base, 'gpt-6.1-sol', 'maths')!.score];
  const week = Array.from({ length: 7 }, (_, day) => ({ at: daysAgo(day), type: 'override', kind: 'maths', fromModel: 'claude-opus-5-5', toModel: 'gpt-6.1-sol' }));
  const table = withUseRows(base, useRows(week, { now: NOW }));
  const opus = blended(table, 'claude-opus-5-5', 'maths')!, sol = blended(table, 'gpt-6.1-sol', 'maths')!;
  assert.deepEqual([opus.layers.use!.score, sol.layers.use!.score], [0, 100]);
  assert.ok(opus.score < before[0] && sol.score > before[1], `${before} → ${opus.score}, ${sol.score}`);
  assert.ok(sol.score - opus.score < 40, 'a little: evals still count most');
  assert.deepEqual(withUseRows(table, []).use, [], 'replaced whole, so faded signals leave');
});

const answers = { tier: { type: 'choice', choice: 'heavy', confidence: 0.9 }, effort: { type: 'choice', choice: 'high', confidence: 0.9 }, kind: { type: 'choice', choice: 'maths', confidence: 0.9 } };
const TABLE = { ...emptyTable(), evals: [{ model: 'gpt-6.1-sol', level: 'gpt-6.1-sol', kind: 'maths', passed: 9, total: 10 }, { model: 'claude-opus-5-5', level: 'claude-opus-5-5', kind: 'maths', passed: 6, total: 10 }] };
const router = () => new ModelRouter({ key: () => 'k', offered: () => OFFERED, decide: options => decideTier({ ...options, fetchImpl: (async () => ({ ok: true, json: async () => ({ answers }) })) as any }),
  shadow: ((pick: any, { place, spoken }: { place: string; spoken: boolean }) => shadowRecord(pickByTask({ decided: pick as any, home: pick.provider, table: TABLE, offered: OFFERED, place, spoken }))) as any });
const later = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello', auto: { model: 'claude-opus-5-5' } }];
const ON = { kindsOn: ['maths'], allowed: ['claude', 'gemini', 'codex'] };

test('mid-chat a clear lead is offered for a kind that’s on, and not again once you said not now', async () => {
  const offered = (await chatPick({ router: router() as any, yours: 'claude', text: 'Solve x² = 4', context: later, history: later, ...ON }))!;
  assert.deepEqual([offered.used, offered.pick.shadow!.offer?.provider], ['claude', 'codex'], 'offered, not moved');
  for (const extra of [{ kindsOn: [] }, { declined: ['maths'] }, { allowed: ['claude', 'gemini'] }]) {
    const quiet = (await chatPick({ router: router() as any, yours: 'claude', text: 'Solve x² = 4', context: later, history: later, ...ON, ...extra }))!;
    assert.equal(quiet.pick.shadow!.offer, undefined, JSON.stringify(extra));
  }
  // Moving answers again there, which is Choose another: logged with the models, for the use layer.
  const logged: any[] = [];
  await chatPick({ router: router() as any, yours: 'claude', text: 'Solve x² = 4', context: later, history: later, forced: 'codex', ...ON, log: entry => logged.push(entry) });
  assert.deepEqual(logged, [{ type: 'override', where: 'chat', kind: 'maths', from: 'claude', to: 'codex', fromModel: 'claude-opus-5-5', toModel: 'gpt-6.1-sol' }]);
});

test('a declined offer is kept on the chat, read back, and shown to the window', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-declined-'));
  try {
    let ids = 0;
    const make = () => new SessionStore({ dir: join(dir, 'sessions'), legacyDir: dir, readJSON, writeJSON, trash: async () => {}, id: () => `id-${++ids}` });
    const sessions = make();
    await sessions.load();
    const id = await sessions.addChat({ title: 'Maths', history: later });
    await sessions.declineOffer(id, 'maths'); await sessions.declineOffer(id, 'maths');
    await assert.rejects(sessions.declineOffer(id, 'everyday'), /isn’t a kind of task/);
    assert.deepEqual(sessions.find(id)!.declined, ['maths']);
    const again = make();
    await again.load();
    assert.deepEqual(again.find(id)!.declined, ['maths']);
    again.active = id;
    assert.deepEqual(again.state().declined, ['maths'], 'the window is told, so it hides the offer');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the service folds routing.jsonl into the table when it’s stale, and on its own each hour in main', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-fold-'));
  try {
    const routing = join(dir, 'routing.jsonl');
    await writeFile(routing, [{ at: daysAgo(1), type: 'override', kind: 'maths', fromModel: 'claude-opus-5-5', toModel: 'gpt-6.1-sol' }, 'not json', { at: daysAgo(1), role: 'builder', model: 'x', outcome: 'done' }].map(line => typeof line === 'string' ? line : JSON.stringify(line)).join('\n'));
    let changed = 0;
    const service = strengthsService({ store: new StrengthsStore({ path: join(dir, 'model-strengths.json') }), read: async () => ({}), ask: async () => '', offered: () => OFFERED, tierOf, routing, now: () => NOW, onChanged: () => { changed++; } });
    const state = await service.state();
    const heavy = state.view.find(tier => tier.tier === 'heavy')!;
    assert.equal(heavy.rows.find(r => r.kind === 'maths')!.cells.find(c => c.model === 'gpt-6.1-sol')!.layers.use!.score, 100);
    assert.equal(changed, 1);
    await service.state();
    assert.equal(changed, 1, 'not again within ten minutes');
    assert.equal(await service.fold(), 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
  const main = await readFile(new URL('../build-ts/desktop/main.cjs', import.meta.url), 'utf8'), tools = await readFile(new URL('../desktop/work-tools.mts', import.meta.url), 'utf8'), app = await readFile(new URL('../src/app.ts', import.meta.url), 'utf8');
  assert.match(main, /setInterval\(foldUse, 60 \* 60 \* 1000\)/);
  assert.match(main, /onCheck: \(\{ model, passed \}\) => \{\s*if \(workPick\?\.kind && model\)\s*logRouting\(\{ type: 'check', chat: id, kind: workPick\.kind, model, passed \}\);\s*\}/);
  assert.match(main, /pool: turn\.pool, \.\.\.\(workPick\?\.kind \? \{ kind: workPick\.kind \} : \{\}\)/);
  assert.match(tools, /if \(passed !== null\) \{ try \{ this\.onCheck\(\{ model: row\.seat\?\.model \|\| '', passed \}\); \} catch \{\} \}/);
  assert.match(app, /no\.onclick = async \(\) => \{ chip\.remove\(\); try \{ await api!?\s*\.chatOfferDecline\(auto\.kind!?\);/);
});
