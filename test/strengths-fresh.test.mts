import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { tierOf } from '../desktop/model-router.mjs';
import { STALE_DAYS, dismiss, freshness, lastRead, noticeWords } from '../desktop/strengths/fresh.mjs';
import { offeredModels } from '../desktop/strengths/index.mjs';
import { StrengthsStore } from '../desktop/strengths/store.mjs';
import { strengthsService } from '../desktop/strengths/service.mjs';
import { emptyTable } from '../desktop/strengths/table.mjs';
import { cleanSettings } from '../desktop/core.mjs';
import { DEFAULTS } from '../src/defaults.js';

const NOW = '2026-11-19T12:00:00.000Z', daysAgo = (days: number) => new Date(Date.parse(NOW) - days * 86400000).toISOString();
const OFFERED = { claude: ['claude-opus-5-5'], gemini: ['gemini-4-neon-high', 'gemini-4-neon-low'], codex: ['gpt-6.1-sol'] };
const models = (offered: any) => offeredModels(offered, tierOf);
const read = (days: number) => ({ ...emptyTable(), sources: { swebench: { fetched: daysAgo(days) }, aider: { fetched: daysAgo(days + 3) } } });

test('the first look only learns what’s offered; a model that appears later is a notice, once', () => {
  const first = freshness(emptyTable(), { models: models(OFFERED), now: NOW });
  assert.deepEqual(first.notices, []);
  assert.deepEqual(first.table.known, { claude: ['claude-opus-5-5'], gemini: ['gemini-4-neon'], codex: ['gpt-6.1-sol'] }, 'thinking levels folded');
  const later = freshness(first.table, { models: models({ ...OFFERED, gemini: [...OFFERED.gemini, 'gemini-4-carbon-high'] }), now: NOW });
  assert.deepEqual(later.notices.map(n => [n.type, n.provider, n.model, n.level]), [['new-model', 'gemini', 'gemini-4-carbon', 'gemini-4-carbon-high']]);
  assert.equal(later.refresh, false, 'never read, so nothing to refresh: the first refresh is yours');
  const again = freshness(later.table, { models: models({ ...OFFERED, gemini: [...OFFERED.gemini, 'gemini-4-carbon-high'] }), now: NOW });
  assert.deepEqual(again.notices, []);
  assert.equal(again.table.notices.length, 1);
});

test('month-old web numbers: a notice when you’d be asked, a refresh when you chose they’re read on their own', () => {
  const known = { ...read(STALE_DAYS + 2), known: { claude: ['claude-opus-5-5'], gemini: ['gemini-4-neon'], codex: ['gpt-6.1-sol'] } };
  assert.equal(lastRead(known), daysAgo(STALE_DAYS + 2));
  const ask = freshness(known, { models: models(OFFERED), now: NOW, mode: 'ask' });
  assert.deepEqual([ask.refresh, ask.notices.map(n => [n.type, n.days])], [false, [['stale', STALE_DAYS + 2]]]);
  assert.deepEqual(freshness(ask.table, { models: models(OFFERED), now: NOW, mode: 'ask' }).notices, [], 'once per reading');
  const auto = freshness(known, { models: models(OFFERED), now: NOW, mode: 'auto' });
  assert.deepEqual([auto.refresh, auto.notices], [true, []]);
  const recent = { ...read(3), known: known.known };
  assert.deepEqual(freshness(recent, { models: models(OFFERED), now: NOW, mode: 'auto' }), { table: { ...recent, notices: [] }, notices: [], refresh: false });
  // A new model with numbers read before: on its own, read them again; and the notice about evals either way.
  const newer = freshness(recent, { models: models({ ...OFFERED, codex: ['gpt-6.1-sol', 'gpt-6.1-astra'] }), now: NOW, mode: 'auto' });
  assert.deepEqual([newer.refresh, newer.notices.map(n => n.model)], [true, ['gpt-6.1-astra']]);
  assert.deepEqual(dismiss(newer.table, 'new-gpt-6.1-astra').notices.map((n: any) => n.dismissed), [true]);
});

test('a notice says what to do, and evals are only ever suggested', () => {
  const words = noticeWords({ type: 'new-model', provider: 'gemini', model: 'gemini-4-carbon', level: 'gemini-4-carbon-high' }, { name: () => 'Gemini 4 Carbon' });
  assert.equal(words.title, 'New model: Gemini 4 Carbon');
  assert.match(words.body, /only what the web says until you run evals on it: node scripts\/eval\.mjs --kinds code,maths,circuits --provider gemini --model gemini-4-carbon-high$/);
  assert.match(noticeWords({ type: 'stale', days: 34 }).body, /last read 34 days ago/);
});

test('the service: keepFresh notices, refreshes on its own only when you chose, and dismisses by a notice’s id', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-fresh-'));
  try {
    let offered = OFFERED, reads = 0;
    const store = new StrengthsStore({ path: join(dir, 'model-strengths.json') });
    const service = strengthsService({ store, override: join(dir, 'none.json'), read: async () => { reads++; return { url: 'u', text: '' }; }, ask: async () => '', offered: () => offered, tierOf, now: () => NOW });
    assert.deepEqual(await service.keepFresh({ mode: 'auto' }), []);
    await store.update(table => ({ ...table, sources: { swebench: { fetched: daysAgo(40) } } }));
    const notices = await service.keepFresh({ mode: 'ask' });
    assert.deepEqual([notices.map(n => n.type), reads], [['stale'], 0]);
    assert.deepEqual((await service.state()).notices.map(n => n.id), [notices[0].id]);
    await service.dismiss(notices[0].id);
    assert.deepEqual((await service.state()).notices, []);
    await assert.rejects(service.dismiss('../x'), /isn’t a notice/);
    offered = { ...OFFERED, codex: ['gpt-6.1-sol', 'gpt-6.1-astra'] };
    assert.deepEqual((await service.keepFresh({ mode: 'auto' })).map(n => n.type), ['new-model']);
    while (service.running) await new Promise(resolve => setTimeout(resolve, 5));
    assert.ok(reads > 0, 'read again on its own');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('settings and main: ask first by default; the hourly check notifies', async () => {
  assert.equal(cleanSettings({}, DEFAULTS).strengthsRefresh, 'ask');
  assert.throws(() => cleanSettings({ strengthsRefresh: 'always' } as any, DEFAULTS), /refreshed on their own/);
  const main = await readFile(new URL('../build-ts/desktop/main.cjs', import.meta.url), 'utf8'), app = await readFile(new URL('../src/app.ts', import.meta.url), 'utf8');
  assert.match(main, /const notices = await service\.keepFresh\(\{ mode: settings\.strengthsRefresh \}\);/);
  assert.match(main, /new Notification\(\{ title: words\.title, body: words\.body \}\)\.show\(\)/);
  assert.match(app, /<select name="strengthsRefresh"><option value="ask">Ask me first<\/option>/);
});
