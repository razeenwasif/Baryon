import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { AcpRegistry, createAcpClient, encodeAcpFrame } from '../desktop/acp-runtime.mjs';
import { createKeepAwakeController, evaluateBackgroundPolicy } from '../desktop/background-policy.mjs';
import { createConnectionSupervisor } from '../desktop/connection-supervisor.mjs';
import { createDpopKeyPair, createDpopReplayCache, jwkThumbprint, signDpopProof, verifyDpopProof } from '../desktop/dpop-auth.mjs';
import { createEventLoopMonitor } from '../desktop/event-loop-monitor.mjs';
import { FailedRecordingStore } from '../desktop/failed-recordings.mjs';
import { GitHubQuotaGuard } from '../desktop/github-quota.mjs';
import { assertTrustedIpcSender } from '../desktop/ipc-sender-guard.mjs';
import { ModifierPairShortcutProcess, createModifierPairDetector } from '../desktop/modifier-pair-hotkey.mjs';
import { readProcessIdentity, reclaimOrphanedDaemon, verifyAuditTokenOwnership } from '../desktop/process-audit-token.mjs';
import { ResourceMonitorClient } from '../desktop/resource-monitor.mjs';
import { createLocalhostPreviewTunnel, isLoopbackHost, isLoopbackTarget } from '../desktop/socks-preview.mjs';
import { openSqliteWorker } from '../desktop/sqlite-worker.mjs';
import { buildSshArgs, createAskpassEnv, sanitizeHostSpec } from '../desktop/ssh-bootstrap.mjs';
import { buildStartupRecoveryDataUrl, buildStartupRecoveryHtml } from '../desktop/startup-recovery.mjs';
import { findAvailableServePath, parseServeStatus, planServeConfig } from '../desktop/tailscale-serve.mjs';
import { computeSmallestViewerSize, createGhosttyAdapter, truncateAnsiScrollback } from '../desktop/terminal-vt.mjs';
import { Terminals } from '../desktop/terminal.mjs';
import {
  WIRE_HYDRATION_BYTES,
  createLiveStreamBudget,
  createPatchHintCache,
  createThreadLiveEventCoalescer,
  createWireHydrationStore,
  hydrateTurnItem,
  paginateHistory,
  projectTurnItemForWire,
} from '../desktop/wire-projection.mjs';
import { runProveScenarios } from '../evals/prove-scenario.mjs';

const execFileAsync = promisify(execFile);

test('Wave 3.1: wire projection (>256KB), pagination, 50ms delta coalescer, stream budget & WeakMap patch cache', async () => {
  const store = createWireHydrationStore({ maxEntries: 16 });
  const small = projectTurnItemForWire({ id: 'ok', role: 'assistant', text: 'short reply' }, { store }) as any;
  assert.equal(small.text, 'short reply');
  assert.equal(small.truncated, undefined);

  const big = { id: 'big-1', role: 'assistant', type: 'output', content: 'A'.repeat(WIRE_HYDRATION_BYTES + 2048) };
  const projected = projectTurnItemForWire(big, { store }) as any;
  assert.equal(projected.truncated, true);
  assert.equal(projected.content, undefined);
  assert.equal((hydrateTurnItem(store, projected.hydrationKey) as any).content.length, big.content.length);

  const entries = Array.from({ length: 12 }, (_, i) => ({ idx: i }));
  const p1 = paginateHistory(entries, { limit: 5 });
  assert.deepEqual(p1.items.map(x => x.idx), [7, 8, 9, 10, 11]);
  assert.equal(p1.hasMore, true);
  assert.equal(p1.nextCursor, 7);
  const p2 = paginateHistory(entries, { before: p1.nextCursor, limit: 5 });
  assert.deepEqual(p2.items.map(x => x.idx), [2, 3, 4, 5, 6]);

  const flushed: any[] = [];
  const coalescer = createThreadLiveEventCoalescer({ flushMs: 30, onFlush: e => flushed.push(e) });
  coalescer.push({ session: 's1', type: 'text', text: 'one ' });
  coalescer.push({ session: 's1', type: 'text', text: 'two' });
  assert.equal(flushed.length, 0);
  coalescer.push({ session: 's1', type: 'done', text: 'final' });
  assert.equal(flushed.length, 2);
  assert.equal(flushed[0].text, 'one two');
  assert.equal(flushed[1].type, 'done');
  coalescer.dispose();

  let nowMs = 1000;
  const budget = createLiveStreamBudget({ maxBytesPerSec: 100, maxEventsPerSec: 2, now: () => nowMs });
  assert.equal(budget.check(40).allow, true);
  assert.equal(budget.check(40).allow, true);
  assert.equal(budget.check(40).dropped, true);
  assert.equal(budget.check(40, { essential: true }).allow, true);

  const cache = createPatchHintCache();
  let calls = 0;
  const obj = { diff: '+foo' };
  assert.equal(cache.getHint(obj, (o: any) => (++calls, o.diff.length)), 4);
  assert.equal(cache.getHint(obj, (o: any) => (++calls, o.diff.length)), 4);
  assert.equal(calls, 1);
});

test('Wave 3.2: connection supervisor wake probe, sleep-aware EventLoopMonitor, worker SQLite WAL & KeepAwake/BackgroundPolicy', async () => {
  let probeOk = false;
  let reconnects = 0;
  const states: any[] = [];
  const sup = createConnectionSupervisor({
    probe: async () => probeOk,
    onReconnect: () => { reconnects++; },
    onState: s => states.push(s),
    backoffMs: [5, 10],
  });
  sup.markConnected();
  assert.equal(await sup.onWake(), false);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(reconnects >= 1, true);
  probeOk = true;
  assert.equal(await sup.onWake(), true);
  assert.equal(sup.state().status, 'connected');
  sup.stop();

  const stalls: any[] = [];
  const sleeps: any[] = [];
  const monitor = createEventLoopMonitor({
    intervalMs: 100,
    stallMs: 500,
    sleepGapMs: 10_000,
    onStall: s => stalls.push(s),
    onSleepGap: g => sleeps.push(g),
  });
  assert.equal(monitor.sampleOnce(25).kind, 'ok');
  assert.equal(monitor.sampleOnce(700).kind, 'stall');
  assert.equal(monitor.sampleOnce(35_000).kind, 'sleep-gap');
  assert.equal(stalls.length, 1);
  assert.equal(sleeps.length, 1);
  assert.equal(monitor.stats().stallCount, 1);
  assert.equal(monitor.stats().sleepGaps, 1);

  const dbDir = await mkdtemp(join(tmpdir(), 'fairy-sqlite-'));
  const dbPath = join(dbDir, 'state.sqlite');
  const db = openSqliteWorker(dbPath);
  try {
    await db.exec('CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);');
    await db.run('INSERT INTO kv (k, v) VALUES (?, ?)', ['wave', 'three']);
    const row = await db.get('SELECT v FROM kv WHERE k = ?', ['wave']);
    assert.equal(row?.v, 'three');
    const mode = await db.get('PRAGMA journal_mode;');
    assert.equal(String(mode?.journal_mode || '').toLowerCase(), 'wal');
    const sync = await db.get('PRAGMA checkpoint_fullfsync;');
    assert.equal(Number(sync?.checkpoint_fullfsync), 1);
    await db.checkpoint();
  } finally {
    await db.close();
    await rm(dbDir, { recursive: true, force: true });
  }

  let starts = 0;
  let stops = 0;
  const awake = createKeepAwakeController({
    startBlocker: () => { starts++; return starts; },
    stopBlocker: () => { stops++; },
  });
  const rel1 = awake.acquire('turn-1', 'running');
  const rel2 = awake.acquire('turn-2', 'running');
  assert.equal(starts, 1);
  rel1();
  assert.equal(stops, 0);
  rel2();
  assert.equal(stops, 1);

  assert.equal(evaluateBackgroundPolicy({ onBattery: true, windowVisible: false, activeRuns: 0 }).deferNonEssential, true);
  assert.equal(evaluateBackgroundPolicy({ onBattery: false, lowPowerMode: false, activeRuns: 1 }).keepAwake, true);
});

test('Wave 3.3: compiled Rust fairy-resource-monitor sidecar reports live kernel PID tree & RSS + ring history', async () => {
  const client = new ResourceMonitorClient({ rootPid: process.pid });
  const binPath = join(process.cwd(), 'native/bin/fairy-resource-monitor');
  const info = await stat(binPath);
  assert.equal(info.isFile(), true);

  const { stdout } = await execFileAsync(binPath, ['--once', '--pid', String(process.pid)], { encoding: 'utf8' });
  const parsed = JSON.parse(stdout.trim());
  assert.equal(parsed.pid, process.pid);
  assert.ok(parsed.processCount >= 1);
  assert.ok(parsed.totalRssBytes > 0);
  assert.equal(Array.isArray(parsed.processes), true);

  const daemonSample = await client.sample(process.pid);
  assert.equal(daemonSample.pid, process.pid);
  assert.ok(daemonSample.totalRssBytes > 0);
  const hist = await client.history(10);
  assert.ok(hist.length >= 1);
  assert.equal(client.ringStats().capacity, 3600);
  client.stop();
});

test('Wave 3.4: ANSI/UTF-8 safe scrollback truncation, smallest-viewer sizing, Ghostty adapter & Terminals snapshot', async () => {
  const ansi = `${'Prefix-'.repeat(30)}\x1b[31mRED\x1b[0m \x1b]0;WinTitle\x07🚀done`;
  const truncated = truncateAnsiScrollback(ansi, 24);
  assert.equal(Buffer.byteLength(truncated, 'utf8') <= 24, true);
  assert.equal(/\uFFFD/.test(truncated), false);
  assert.equal(/^\d+m/.test(truncated), false);

  assert.deepEqual(
    computeSmallestViewerSize([
      { cols: 160, rows: 50 },
      { cols: 92, rows: 31 },
      { cols: 120, rows: 24 },
    ]),
    { cols: 92, rows: 24 },
  );

  const adapter = createGhosttyAdapter({ cols: 100, rows: 30, hasWasm: false });
  assert.equal(adapter.backend, 'xterm-fallback');
  adapter.write('hello world\n');
  assert.match(adapter.snapshot().scrollback, /hello world/);

  let dataCb: ((data: string) => void) | undefined;
  let exitCb: ((ev: { exitCode: number }) => void) | undefined;
  const resizes: Array<[number, number]> = [];
  const fakePty = {
    onData: (fn: (data: string) => void) => { dataCb = fn; },
    onExit: (fn: (ev: { exitCode: number }) => void) => { exitCb = fn; },
    resize: (c: number, r: number) => resizes.push([c, r]),
    write: () => {},
    kill: () => exitCb?.({ exitCode: 0 }),
  };
  const terminals = new Terminals({ spawn: () => fakePty, onData: () => {}, onExit: () => {} });
  const { id } = await terminals.start({ cols: 120, rows: 40, viewerId: 'desktop' });
  dataCb!('npm test ok\n');
  terminals.setViewerSize(id, 'mobile', 72, 22);
  assert.deepEqual(resizes.at(-1), [72, 22]);
  const snap = terminals.snapshot(id)!;
  assert.equal(snap.cols, 72);
  assert.equal(snap.rows, 22);
  assert.match(snap.scrollback, /npm test ok/);
  terminals.stopAll();
});

test('Wave 3.5: audit-token PID-reuse protection, startup recovery HTML escaping, IPC guard & double-modifier hotkey', async () => {
  const identity = await readProcessIdentity(process.pid);
  assert.equal(identity?.pid, process.pid);
  assert.ok(identity?.startedAt);

  assert.equal(verifyAuditTokenOwnership({ pid: 10, auditToken: 'a' }, { pid: 10, auditToken: 'b' }).owned, false);
  assert.equal(verifyAuditTokenOwnership({ pid: 10, startedAt: 'T1', command: 'foo' }, { pid: 10, startedAt: 'T2', command: 'bar' }).owned, false);
  assert.equal(verifyAuditTokenOwnership({ pid: 10, startedAt: 'T1', command: '/usr/bin/foo' }, { pid: 10, startedAt: 'T1', command: 'foo' }).owned, true);

  const dir = await mkdtemp(join(tmpdir(), 'fairy-audit-'));
  try {
    const lock = join(dir, 'daemon.lock');
    const fs = await import('node:fs/promises');
    await fs.writeFile(lock, JSON.stringify({ pid: 999999, auditToken: 'secret-token' }));
    let killed = false;
    const reused = await reclaimOrphanedDaemon(lock, {
      readIdentity: async () => ({ pid: 999999, auditToken: 'other-process' }),
      kill: () => { killed = true; },
    });
    assert.equal(reused.reclaimed, false);
    assert.equal(killed, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  const html = buildStartupRecoveryHtml({ error: '<script>alert(1)</script>', version: '1.2.3' });
  assert.equal(html.includes('<script>alert(1)</script>'), false);
  assert.equal(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), true);
  assert.match(buildStartupRecoveryDataUrl({ error: 'boom' }), /^data:text\/html;charset=utf-8,/);

  const wc = { mainFrame: { url: 'app://index.html' } };
  assert.equal(assertTrustedIpcSender({ sender: wc, senderFrame: wc.mainFrame } as any, { expectedWebContents: wc as any, expectedUrl: 'app://index.html' }), true);
  assert.throws(() => assertTrustedIpcSender({ sender: {}, senderFrame: wc.mainFrame } as any, { expectedWebContents: wc as any }), /Untrusted/);

  let t = 1000;
  let fired = 0;
  const det = createModifierPairDetector({ modifier: 'option', maxGapMs: 300, maxHoldMs: 350, now: () => t, onTrigger: () => fired++ });
  det.handleEvent({ key: 'option', down: true });
  t += 60;
  det.handleEvent({ key: 'option', down: false });
  t += 120;
  det.handleEvent({ key: 'option', down: true });
  t += 60;
  assert.equal(det.handleEvent({ key: 'option', down: false }).triggered, true);
  assert.equal(fired, 1);

  const proc = new ModifierPairShortcutProcess({ modifier: 'option', onTrigger: () => fired++ });
  assert.equal(proc.feed({ key: 'option', down: true }).triggered, false);
  proc.start();
  assert.equal(proc.isRunning(), true);
  proc.stop();
});

test('Wave 3.6: FailedRecordingStore, ACP runtime framing/cancel, GitHub 10% quota, Tailscale serve & SSH args', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-rec-'));
  try {
    const store = new FailedRecordingStore({ dir, maxItems: 2 });
    const rec = await store.save({ buffer: Buffer.from('FAKE_AUDIO'), mime: 'audio/webm', ext: '.webm', reason: 'timeout' });
    assert.equal((await store.list()).length, 1);
    const failedRetry = await store.retry(rec.id, async () => { throw new Error('still down'); });
    assert.equal(failedRetry.ok, false);
    const okRetry = await store.retry(rec.id, async ({ buffer }) => buffer.toString('utf8'));
    assert.equal(okRetry.ok, true);
    assert.equal(okRetry.result, 'FAKE_AUDIO');
    assert.equal((await store.list()).length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  const reg = new AcpRegistry();
  reg.register('helper', { command: '/usr/local/bin/acp-helper', args: ['--stdio'] });
  assert.equal(reg.get('helper')?.command, '/usr/local/bin/acp-helper');
  assert.throws(() => reg.register('bad', { command: 'sh; rm -rf /' }), /Unsafe/);

  const sentFrames: string[] = [];
  const acp = createAcpClient({ write: frame => sentFrames.push(frame), format: 'content-length' });
  const reqP = acp.request('tools/list', { cursor: null });
  const sentObj = JSON.parse(sentFrames[0].split('\r\n\r\n')[1]);
  acp.receive(encodeAcpFrame({ jsonrpc: '2.0', id: sentObj.id, result: { tools: ['read'] } }));
  assert.deepEqual(await reqP, { tools: ['read'] });

  const ctrl = new AbortController();
  const abortedP = acp.request('slow/op', {}, { signal: ctrl.signal });
  ctrl.abort();
  await assert.rejects(() => abortedP, /aborted/);
  assert.match(sentFrames.at(-1)!, /\$\/cancelRequest/);
  acp.close();

  const quota = new GitHubQuotaGuard({ reserveRatio: 0.10 });
  quota.updateFromHeaders({ 'x-ratelimit-limit': '1000', 'x-ratelimit-remaining': '90' });
  assert.equal(quota.canRun({ priority: 'background' }).allowed, false);
  assert.equal(quota.canRun({ priority: 'interactive' }).allowed, true);
  quota.updateSnapshot({ limit: 1000, remaining: 250 });
  assert.equal(quota.canRun({ priority: 'background' }).allowed, true);

  const serveJson = { Web: { 'm.ts.net:443': { Handlers: { '/fairy': { Proxy: 'http://127.0.0.1:9999' } } } } };
  assert.equal(parseServeStatus(serveJson).length, 1);
  assert.equal(findAvailableServePath(parseServeStatus(serveJson), '/fairy', 'http://127.0.0.1:47615').mountPath, '/fairy-2');
  const planned = planServeConfig({ statusInput: serveJson, preferredPath: '/fairy', localPort: 47615 });
  assert.equal(planned.collisionAvoided, true);
  assert.equal(planned.args.includes('/fairy-2'), true);

  assert.throws(() => sanitizeHostSpec('-oProxyCommand=evil'), /Unsafe/);
  const sshArgs = buildSshArgs({ host: 'razeen@mini', command: 'echo ok' });
  assert.equal(sshArgs.includes('--'), true);
  const ask = await createAskpassEnv('my-pass');
  try {
    assert.equal(ask.env.SSH_ASKPASS_REQUIRE, 'force');
    assert.equal(ask.env.FAIRY_ASKPASS_SECRET, 'my-pass');
  } finally {
    await ask.cleanup();
  }
});

test('Wave 3.7: ES256 DPoP proofs + replay rejection, loopback-only SOCKS policy & prove-scenario suite', async () => {
  const kp = createDpopKeyPair();
  assert.ok(jwkThumbprint(kp.publicJwk));
  const replay = createDpopReplayCache();
  const token = signDpopProof({ privateKey: kp.privateKey, publicJwk: kp.publicJwk, htm: 'POST', htu: 'https://mini.ts.net/v1/ask' });
  const ok = verifyDpopProof(token, { expectedHtm: 'POST', expectedHtu: 'https://mini.ts.net/v1/ask', replayCache: replay });
  assert.equal(ok.valid, true);
  assert.equal((verifyDpopProof(token, { expectedHtm: 'POST', expectedHtu: 'https://mini.ts.net/v1/ask', replayCache: replay }) as any).reason, 'replayed_jti');

  assert.equal(isLoopbackHost('127.0.0.1'), true);
  assert.equal(isLoopbackHost('169.254.169.254'), false);
  assert.equal(isLoopbackTarget('localhost', 3000, new Set([3000, 5173])), true);
  assert.equal(isLoopbackTarget('192.168.1.50', 3000), false);
  const tunnel = createLocalhostPreviewTunnel({ allowedPorts: [5173] });
  assert.throws(() => tunnel.assertAllowedTarget('10.0.0.2', 5173), /only allowed localhost/i);

  const scenarios = await runProveScenarios();
  assert.equal(scenarios.failed, 0);
  assert.equal(scenarios.passed, scenarios.total);
});
