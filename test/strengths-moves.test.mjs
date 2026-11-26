import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ModelRouter, decideTier, tierOf } from '../desktop/model-router.mjs';
import { pickByTask, shadowRecord } from '../desktop/strengths/pick.mjs';
import { byTaskMove, chatPick, chatProviderOf, workMove } from '../desktop/strengths/moves.mjs';
import { StrengthsStore } from '../desktop/strengths/store.mjs';
import { strengthsService } from '../desktop/strengths/service.mjs';
import { emptyTable } from '../desktop/strengths/table.mjs';
import { WorkSeats } from '../desktop/work-seats.mjs';
import { cleanSettings } from '../desktop/core.mjs';
import { DEFAULTS } from '../src/defaults.js';
import { autoCaption, byTaskWords } from '../src/auto-caption.js';

const OFFERED = { claude: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'], gemini: ['gemini-4-neon-high', 'gemini-4-hydrogen-high', 'gemini-4-hydrogen-low'], codex: ['gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6.1-luna'] };
const evals = (model, kind, passed, total = 10) => ({ model, level: model, kind, passed, total, provider: 'x', run: 'r', at: 'a' });
// Maths: Sol well ahead. Code: Opus ahead.
const TABLE = { ...emptyTable(), evals: [evals('gpt-6.1-sol', 'maths', 9), evals('claude-opus-5-5', 'maths', 6), evals('claude-opus-5-5', 'code', 9), evals('gpt-6.1-sol', 'code', 7)] };
const answers = kind => ({ tier: { type: 'choice', choice: 'heavy', confidence: 0.9 }, effort: { type: 'choice', choice: 'high', confidence: 0.9 }, kind: { type: 'choice', choice: kind, confidence: 0.9 }, plan: { type: 'choice', choice: 'step', confidence: 0.9 } });
function router(table = TABLE) {
  return new ModelRouter({ key: () => 'k', offered: () => OFFERED,
    decide: options => decideTier({ ...options, fetchImpl: async () => ({ ok: true, json: async () => ({ answers: answers(/solve|prove|integral/i.test(options.text) ? 'maths' : 'code') }) }) }),
    shadow: (pick, { place, spoken }) => shadowRecord(pickByTask({ decided: pick, home: pick.provider, table, offered: OFFERED, place, spoken, available: { claude: true, gemini: true, codex: true } })) });
}
const ON = { kindsOn: ['maths'], allowed: ['claude', 'gemini', 'codex'] };

test('settings: off to start, no kinds, all three providers; lists checked against the kinds and providers there are', () => {
  const defaults = cleanSettings({}, DEFAULTS);
  assert.deepEqual([defaults.autoByTask, defaults.autoKinds, defaults.autoProviders], ['off', '', 'claude,gemini,codex']);
  assert.equal(cleanSettings({ autoKinds: 'maths, circuits,maths' }, DEFAULTS).autoKinds, 'maths,circuits');
  assert.throws(() => cleanSettings({ autoKinds: 'maths,everyday' }, DEFAULTS), /Choose kinds from code, maths/);
  assert.throws(() => cleanSettings({ autoProviders: 'claude,deepseek' }, DEFAULTS), /Choose providers from claude, gemini, codex/);
  assert.throws(() => cleanSettings({ autoByTask: 'yes' }, DEFAULTS), /by the kind of task/);
});

test('done when: a new maths chat starts on the model the table favours and says so; the next message stays there', async () => {
  const r = router();
  const first = await chatPick({ router: r, yours: 'claude', text: 'Solve 3x² − 12x + 9 = 0', ...ON });
  assert.deepEqual([first.used, first.pick.model, first.pick.byTaskMoved, first.held], ['codex', 'gpt-6.1-sol', true, true]);
  const reply = { role: 'assistant', content: 'x = 1 or 3', auto: { model: first.pick.model, effort: first.pick.effort, kind: 'maths', byTaskMoved: true, byTask: first.pick.shadow, provider: first.used } };
  assert.equal(autoCaption(reply.auto), 'GPT 6.1 Sol · careful · picked for maths');
  assert.match(byTaskWords(reply.auto), /^Picked by task: Codex leads Claude by 30 on maths/);
  // The second message: held to Codex, never moved again, even for a kind that would favour another.
  const history = [{ role: 'user', content: 'Solve 3x² − 12x + 9 = 0' }, reply];
  assert.equal(chatProviderOf(history), 'codex');
  const second = await chatPick({ router: r, yours: 'claude', text: 'Now refactor my parser', context: history, history, ...ON, kindsOn: ['maths', 'code'] });
  assert.deepEqual([second.used, second.pick.model, Boolean(second.pick.byTaskMoved), second.held], ['codex', 'gpt-6.1-sol', false, true]);
});

test('nothing moves for a kind that isn’t on, with the switch off, for a spoken turn, or to a provider you don’t allow', async () => {
  const r = router();
  for (const extra of [{ kindsOn: [] }, { kindsOn: ['code'] }, { spoken: true }, { allowed: ['claude', 'gemini'] }]) {
    const result = await chatPick({ router: r, yours: 'claude', text: 'Solve x² = 4', ...ON, ...extra });
    assert.deepEqual([result.used, result.pick.model, result.held], ['claude', 'claude-opus-5-5', false], JSON.stringify(extra));
  }
  // A coding chat with code on stays on Opus, which leads it.
  const code = await chatPick({ router: r, yours: 'claude', text: 'Fix the parser', ...ON, kindsOn: ['code'] });
  assert.equal(code.used, 'claude');
  assert.equal(await chatPick({ router: r, yours: null, text: 'x', ...ON }), null, 'DeepSeek and the OpenAI API have no Auto');
});

test('Choose another answers again on the provider you chose, says so, holds the chat to it, and is logged as evidence', async () => {
  const logged = [];
  const chosen = await chatPick({ router: router(), yours: 'claude', text: 'Solve x² = 4', history: [], forced: 'gemini', ...ON, log: entry => logged.push(entry) });
  assert.deepEqual([chosen.used, chosen.pick.model, chosen.pick.chosen, chosen.held], ['gemini', 'gemini-4-neon-high', true, true]);
  assert.deepEqual(logged, [{ type: 'override', where: 'chat', kind: 'maths', from: 'claude', to: 'gemini', fromModel: null, toModel: 'gemini-4-neon-high' }]);
  assert.equal(autoCaption({ model: 'gemini-4-neon-high', effort: 'high', chosen: true }), 'Gemini 4 Neon · careful · your choice');
  assert.equal(byTaskWords({ chosen: true }), 'You chose this model with Choose another; the chat stays with it.');
  // A provider you don't allow can't be forced.
  assert.equal((await chatPick({ router: router(), yours: 'claude', text: 'Solve x² = 4', forced: 'deepseek', ...ON })).used, 'codex');
  // The other models are on the reply's shadow, for the menu.
  const first = await chatPick({ router: router(), yours: 'claude', text: 'Solve it', ...ON, kindsOn: [] });
  assert.deepEqual(first.pick.shadow.others.map(o => o.provider), ['claude', 'gemini']);
});

test('done when: a new coding session starts on the favoured provider and keeps it; a stand-in still comes first', () => {
  const codeTable = { ...emptyTable(), evals: [evals('gpt-6.1-sol', 'code', 10), evals('claude-opus-5-5', 'code', 6)] };
  const pick = { provider: 'claude', kind: 'code', tier: 'heavy', model: 'claude-opus-5-5', shadow: shadowRecord(pickByTask({ decided: { tier: 'heavy', kind: 'code', kindConfidence: 0.9 }, home: 'claude', table: codeTable, offered: OFFERED, place: 'work-start' })) };
  const start = workMove({ pick, firstTurn: true, kindsOn: ['code'], allowed: ['claude', 'gemini', 'codex'] });
  assert.deepEqual(start, { provider: 'codex', model: 'gpt-6.1-sol', moved: true });
  assert.deepEqual(workMove({ pick, sessionProvider: 'codex', firstTurn: false, kindsOn: ['code'], allowed: ['claude', 'gemini', 'codex'] }), { provider: 'codex', moved: false }, 'the session keeps it');
  assert.deepEqual(workMove({ pick, firstTurn: false, kindsOn: ['code'], allowed: ['claude', 'gemini', 'codex'] }), { provider: null, moved: false }, 'a later turn never moves');
  assert.deepEqual(workMove({ pick, firstTurn: true, kindsOn: [], allowed: ['claude', 'gemini', 'codex'] }), { provider: null, moved: false });
  assert.deepEqual(workMove({ pick, standIn: { provider: 'gemini' }, firstTurn: true, kindsOn: ['code'], allowed: ['claude', 'gemini', 'codex'] }), { provider: 'gemini', moved: false });
  assert.equal(byTaskMove(pick, { kindsOn: ['code'], allowed: ['claude', 'gemini'] }), null, 'Codex not allowed');
});

test('a job’s seat goes to the session’s provider, or to the provider by task picks for the job’s kind', () => {
  const seats = new WorkSeats({ settings: () => ({ workAutoModel: 'on', workProvider: 'claude' }), status: () => ({ claude: true, gemini: true, codex: true }), hasKey: () => true,
    offered: () => OFFERED, connect: (kind, model) => ({ provider: kind, settings: { backend: kind || 'claude', model } }) });
  assert.equal(seats.seat('builder').pool, 'claude');
  assert.equal(seats.seat('builder', null, { home: 'codex' }).pool, 'codex');
  seats.byTask = ({ role, kind }) => kind === 'maths' && role === 'scout' ? 'gemini' : null;
  assert.equal(seats.seat('scout', null, { kind: 'maths' }).pool, 'gemini');
  assert.equal(seats.seat('builder', null, { kind: 'maths' }).pool, 'claude');
  seats.byTask = () => { throw new Error('no table'); };
  assert.equal(seats.seat('scout', null, { kind: 'maths' }).pool, 'claude', 'a broken pick leaves the seat as it was');
});

test('pins: one of the models you’re offered, for a kind Auto routes; taken off with nothing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-pins-'));
  try {
    let changed = 0;
    const service = strengthsService({ store: new StrengthsStore({ path: join(dir, 'model-strengths.json') }), read: async () => ({}), ask: async () => '', offered: () => OFFERED, tierOf, onChanged: () => changed++ });
    assert.deepEqual(await service.pin('maths', 'gemini-4-neon-high'), { maths: 'gemini-4-neon' });
    assert.deepEqual((await service.state()).pinned, { maths: 'gemini-4-neon' });
    await assert.rejects(service.pin('everyday', 'gpt-6.1-sol'), /Choose a kind of task to pin/);
    await assert.rejects(service.pin('maths', 'llama-5'), /Pin one of the models you’re offered/);
    assert.deepEqual(await service.pin('maths', ''), {});
    assert.equal(changed, 2, 'main reads the table again after each pin');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('main and the window are wired: the chat’s own provider, Choose another, the session’s provider, and Settings', async () => {
  const main = await readFile(new URL('../desktop/main.cjs', import.meta.url), 'utf8'), app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const sessions = await readFile(new URL('../desktop/sessions.mjs', import.meta.url), 'utf8'), companion = await readFile(new URL('../desktop/companion-chat.mjs', import.meta.url), 'utf8');
  assert.match(main, /const provider = conversationProvider\(chatSettings\.backend\);/);
  assert.match(main, /forced: mode === 'chat' && typeof options\?\.autoProvider === 'string' \? options\.autoProvider : ''/);
  assert.match(main, /const placed = moves\.workMove\(\{ pick: workPick, standIn, sessionProvider, firstTurn: !before\.length,/);
  assert.match(main, /await sessions\.setWorkFor\(id, \{ provider: placed\.provider \}\)/);
  assert.match(main, /workSeats\.run\(role, turn, run, \{ short, onSeat, signal, chat: id, home: jobHome, kind:/);
  assert.match(sessions, /\['claude', 'gemini', 'codex'\]\.includes\(value\.provider\) \? \{ provider: value\.provider \}/);
  assert.match(companion, /this\.provider\(settings\)\.chat\(/);
  assert.match(app, /<select name="autoByTask"><option value="off">Off · Auto picks only the size, on your provider<\/option>/);
  assert.match(app, /<input type="hidden" name="autoKinds"><input type="hidden" name="autoProviders">/);
  assert.match(app, /send\(request, \{ autoProvider: other\.provider \}\)/);
});
