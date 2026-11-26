import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectTokenUsage, estimateCost, inferProvider } from '../desktop/token-usage.mjs';
import {
  buildDailySeries,
  filterUsageEvents,
  formatCost,
  formatPct,
  formatTokens,
  groupByModel,
  groupBySession,
  summarizeUsage,
} from '../src/usage-logic.js';

test('inferProvider and estimateCost calculate public API equivalent spend and cache savings', () => {
  assert.equal(inferProvider('claude-opus-5-5'), 'claude');
  assert.equal(inferProvider('gemini-4-neon-medium'), 'gemini');
  assert.equal(inferProvider('gpt-6.1-sol'), 'codex');
  assert.equal(inferProvider('deepseek-reasoner'), 'deepseek');
  assert.equal(inferProvider('custom-model', 'antigravity'), 'gemini');

  const claude = estimateCost('claude-opus-5-5', { input: 1_000_000, output: 100_000, cached: 800_000 });
  // Fresh input: 200K * $15 = $3.00, Cached: 800K * $1.50 = $1.20, Output: 100K * $75 = $7.50 => $11.70
  assert.ok(Math.abs(claude.cost - 11.7) < 1e-6);
  // Cache savings: 800K * ($15 - $1.50) = $10.80
  assert.ok(Math.abs(claude.cacheSaved - 10.8) < 1e-6);

  const neon = estimateCost('gemini-4-neon-medium', { input: 1_000_000, output: 200_000, cached: 500_000 });
  assert.ok(Math.abs(neon.cost - (0.5 * 1.25 + 0.5 * 0.125 + 0.2 * 10)) < 1e-6);
});

test('collectTokenUsage aggregates sessions, deduplicates token-ledger/routing, and handles empty dirs', async t => {
  const emptyDir = mkdtempSync(join(tmpdir(), 'fairy-usage-empty-'));
  t.after(() => rmSync(emptyDir, { recursive: true, force: true }));
  const empty = await collectTokenUsage({ sessionsDir: join(emptyDir, 'missing') });
  assert.deepEqual(empty.events, []);

  const root = mkdtempSync(join(tmpdir(), 'fairy-usage-data-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sessionsDir = join(root, 'sessions');
  mkdirSync(sessionsDir, { recursive: true });

  writeFileSync(join(sessionsDir, 'index.json'), JSON.stringify({
    sessions: [
      { id: 's1', title: 'Build Usage View', work: { folder: '/code/Lyra', provider: 'claude' } },
      { id: 's2', title: 'Research Chat', work: null },
    ],
  }));

  // Assistant turn with usage + auto model, plus a duplicate in routing at the same minute.
  writeFileSync(join(sessionsDir, 's1.json'), JSON.stringify([
    { role: 'user', content: 'hi', at: '2026-11-23T10:00:00.000Z' },
    {
      role: 'assistant',
      content: 'done',
      at: '2026-11-23T10:01:20.000Z',
      mode: 'work',
      auto: { model: 'claude-opus-5-5' },
      usage: { input: 50_000, output: 2_000, cached: 30_000 },
    },
    {
      role: 'assistant',
      content: 'no usage measured',
      at: '2026-11-23T10:02:00.000Z',
      mode: 'work',
    },
  ]));

  // Session turn with usage but no model on message -> recovered from routing hint.
  writeFileSync(join(sessionsDir, 's2.json'), JSON.stringify([
    {
      role: 'assistant',
      content: 'ok',
      at: '2026-11-23T11:05:10.000Z',
      mode: 'chat',
      usage: { input: 10_000, output: 1_000, cached: 2_000 },
    },
  ]));

  const ledgerPath = join(root, 'token-ledger.jsonl');
  writeFileSync(ledgerPath, [
    // Standalone research turn (no session id) -> included.
    JSON.stringify({ at: '2026-11-23T12:00:00.000Z', session: '', provider: 'claude', model: 'claude-sonnet-5-5', role: 'research:reviewer', sent: 6_000, parts: { reply: 800 } }),
    // Duplicate minute for s1 -> deduplicated.
    JSON.stringify({ at: '2026-11-23T10:01:45.000Z', session: 's1', provider: 'claude', model: 'claude-opus-5-5', sent: 49_000, parts: { reply: 2_000 } }),
    'not-valid-json',
  ].join('\n'));

  const routingPath = join(root, 'routing.jsonl');
  writeFileSync(routingPath, [
    // Hint for s2 at 11:05 -> shouldn't duplicate s2 turn, should supply model to s2 event.
    JSON.stringify({ at: '2026-11-23T11:05:05.000Z', chat: 's2', provider: 'gemini', model: 'gemini-4-hydrogen-high', tokens: { input: 10_000, output: 1_000 } }),
    // Standalone routing turn -> included.
    JSON.stringify({ at: '2026-11-23T13:00:00.000Z', chat: 's3', provider: 'codex', model: 'gpt-6.1-sol', tokens: { input: 20_000, output: 3_000 } }),
  ].join('\n'));

  const collected = await collectTokenUsage({ sessionsDir, ledgerPath, routingPath, plans: { claude: { meters: [] } } });
  assert.equal(collected.events.length, 4);
  assert.equal(collected.events[0].sessionId, 's1');
  assert.equal(collected.events[0].project, 'Lyra');
  assert.equal(collected.events[0].total, 52_000);
  assert.equal(collected.events[1].sessionId, 's2');
  assert.equal(collected.events[1].model, 'gemini-4-hydrogen-high');
  assert.equal(collected.events[1].provider, 'gemini');
  assert.equal(collected.events[2].title, 'research · reviewer');
  assert.equal(collected.events[2].project, 'Research');
  assert.equal(collected.events[3].provider, 'codex');
});

test('usage-logic filtering, KPI summary, daily series, and groupings compute accurately', () => {
  const now = new Date('2026-11-24T12:00:00');
  const events = [
    { id: '1', at: '2026-11-24T09:00:00', sessionId: 'a', title: 'Alpha', project: 'Lyra', provider: 'claude', model: 'claude-opus-5-5', input: 100_000, output: 10_000, cached: 60_000, total: 110_000, cost: 1.5, cacheSaved: 0.8 },
    { id: '2', at: '2026-11-23T14:00:00', sessionId: 'a', title: 'Alpha', project: 'Lyra', provider: 'gemini', model: 'gemini-4-neon-medium', input: 50_000, output: 5_000, cached: 20_000, total: 55_000, cost: 0.1, cacheSaved: 0.02 },
    { id: '3', at: '2026-10-01T10:00:00', sessionId: 'b', title: 'Old Session', project: 'Old', provider: 'codex', model: 'gpt-6.1-sol', input: 200_000, output: 20_000, cached: 0, total: 220_000, cost: 1.4, cacheSaved: 0 },
  ];

  const r30 = filterUsageEvents(events, { range: '30d', now });
  assert.equal(r30.length, 2);
  const summary = summarizeUsage(r30);
  assert.equal(summary.totalTokens, 165_000);
  assert.equal(summary.cachedTokens, 80_000);
  assert.equal(summary.turns, 2);
  assert.equal(summary.activeDays, 2);
  assert.ok(Math.abs(summary.cacheHitRate - 80_000 / 150_000) < 1e-6);

  const seriesSplit = buildDailySeries(r30, { range: '7d', metric: 'tokens', groupBy: 'split', now });
  assert.equal(seriesSplit.days.length, 7);
  assert.equal(seriesSplit.days.at(-1).total, 110_000);
  assert.equal(seriesSplit.days.at(-2).total, 55_000);
  assert.equal(seriesSplit.days[0].total, 0);

  const seriesCostProv = buildDailySeries(events, { range: 'all', metric: 'cost', groupBy: 'provider', now });
  assert.ok(seriesCostProv.days.length >= 55);
  assert.ok(Math.abs(seriesCostProv.totalValue - 3.0) < 1e-6);

  const models = groupByModel(events, 'tokens');
  assert.equal(models[0].model, 'gpt-6.1-sol');
  assert.equal(models.length, 3);

  const sessions = groupBySession(events, 'cost', 10);
  assert.equal(sessions[0].title, 'Alpha');
  assert.equal(sessions[0].turns, 2);

  assert.equal(formatTokens(12_450_000), '12.4M');
  assert.equal(formatTokens(845), '845');
  assert.equal(formatCost(1.234), '$1.23');
  assert.equal(formatPct(0.5333), '53%');
});

test('usage page is wired across main, preload, remote-channels, app.js, and workspace.css', () => {
  const mainSrc = readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(mainSrc, /handle\('token-usage'/);
  const preloadSrc = readFileSync(new URL('../desktop/preload.cjs', import.meta.url), 'utf8');
  assert.match(preloadSrc, /tokenUsage:/);
  const channelsSrc = readFileSync(new URL('../desktop/remote-channels.mjs', import.meta.url), 'utf8');
  assert.match(channelsSrc, /'token-usage'/);
  const appSrc = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(appSrc, /id="sidebar-usage"/);
  assert.match(appSrc, /id="action-rail"[^>]*>[^<]*.*id="sidebar-usage"/);
  assert.doesNotMatch(appSrc, /class="side-group side-tools"[^>]*>.*id="sidebar-usage"/);
  assert.match(appSrc, /id="sidebar-analytics"/);
  assert.match(appSrc, /id="usage-view"/);
  assert.match(appSrc, /\.\/usage-view\.js/);
  const cssSrc = readFileSync(new URL('../src/workspace.css', import.meta.url), 'utf8');
  assert.match(cssSrc, /#sidebar-usage\{--icon:url\("data:image\/svg\+xml,.*M4\.5 15\.5l4\.5-4\.5 4 3 6\.5-7\.5/);
  assert.match(cssSrc, /#action-rail \.side-item\.current\{/);
  assert.match(cssSrc, /#sidebar-analytics\{--icon:url\("data:image\/svg\+xml,/);
});
