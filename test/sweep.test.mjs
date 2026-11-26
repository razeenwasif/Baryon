// Sweep in Fairy (desktop/sweep.mjs, src/sweep.js): reading the user's disk cleaner, running it only when asked, and
// following its log for sweeps that start on their own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { macName, parseConfig, parseLogLine, recordSummary, setTargetInConfig, sweepService } from '../desktop/sweep.mjs';
import { broomState, gb, gbFine, sweepCount, sweepTier, tierOf } from '../src/sweep-logic.js';
import { isLong, kindOf, NEEDS_APPROVAL, READS, WINDOW_EVENTS } from '../desktop/remote-channels.mjs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const CONFIG = `# sweep\nthreshold_gb = 50.0\ncheck_interval_secs = 300\ncooldown_minutes = 30\nemergency_drop_gb = 5.0\nnotify = true\ncode_roots = ["~/Github"]\n\n[targets]\napp_caches = true\ntrash = true\nxcode_archives = false\n`;
const STATUS = { below_threshold: false, disk: { free_bytes: 125.9e9, total_bytes: 494.4e9, used_bytes: 368.5e9 }, host: 'tsukuyomi', service: { loaded: true, plist_installed: true, last_exit_code: 0, pid: null },
  state: { last_check_at: '2026-11-19T02:28:29Z', last_cleanup_at: null, last_cleanup_freed_bytes: null, total_reclaimed_all_time_bytes: 0, total_auto_cleanups: 0 }, threshold_gb: 50 };
const SCAN = [{ id: 'cargo_cache', name: 'Cargo Registry & Git Cache', tier: 'Safe', enabled: true, bytes: 2.35e9, item_count: 9, permission_denied: false, note: null, description: 'd' },
  { id: 'app_caches', name: 'App Caches', tier: 'Safe', enabled: true, bytes: 3.41e9, item_count: 9, permission_denied: true, note: null, description: 'd' },
  { id: 'trash', name: 'macOS Trash', tier: 'Aggressive', enabled: true, bytes: 0.5e9, item_count: 1, permission_denied: false, note: null, description: 'd' }];
const RECORD = { timestamp: '2026-11-19T03:00:00Z', host: 'tsukuyomi', trigger: 'auto', dry_run: false, free_before_bytes: 48.2e9, free_after_bytes: 60e9, tracked_freed_bytes: 11.5e9, actual_reclaimed_bytes: 11.8e9, items_removed: 900, duration_ms: 72000,
  targets: [{ id: 'cargo_cache', name: 'Cargo Registry & Git Cache', bytes_freed: 2.6e9 }, { id: 'app_caches', name: 'App Caches (~/Library/Caches)', bytes_freed: 3.1e9 }], warnings: ['trash: TCC blocked'] };

function home() {
  const dir = mkdtempSync(join(tmpdir(), 'fairy-sweep-'));
  mkdirSync(join(dir, '.config', 'sweep'), { recursive: true }); mkdirSync(join(dir, '.local', 'share', 'sweep'), { recursive: true }); mkdirSync(join(dir, 'Library', 'Logs'), { recursive: true });
  writeFileSync(join(dir, '.config', 'sweep', 'config.toml'), CONFIG);
  writeFileSync(join(dir, 'Library', 'Logs', 'sweep.log'), '[2026-11-19T02:28:29Z] check OK: free 125.9 GB (117.3 GiB) >= threshold 50.0 GB\n');
  return dir;
}
function fakeSweep(calls = []) {
  return async (file, args) => {
    calls.push([file.split('/').pop(), ...args]);
    if (file.endsWith('system_profiler')) return { stdout: JSON.stringify({ SPHardwareDataType: [{ machine_name: 'MacBook Pro' }] }) };
    if (args[0] === 'status') return { stdout: JSON.stringify(STATUS) };
    if (args[0] === 'scan') return { stdout: JSON.stringify(SCAN) };
    return { stdout: '' };
  };
}

test('sweep’s config is read as it writes it, and a target turned on or off changes only its own line', () => {
  const config = parseConfig(CONFIG);
  assert.equal(config.threshold_gb, 50); assert.equal(config.notify, true); assert.equal(config.code_roots, '["~/Github"]');
  assert.deepEqual(config.targets, { app_caches: true, trash: true, xcode_archives: false });
  const off = setTargetInConfig(CONFIG, 'trash', false);
  assert.match(off, /^trash = false$/m);
  assert.equal(off.split('\n').length, CONFIG.split('\n').length, 'one line changed, none added');
  assert.match(setTargetInConfig(CONFIG, 'go_cache', true), /xcode_archives = false\ngo_cache = true\n/, 'a new one goes at the end of [targets]');
  assert.match(setTargetInConfig('threshold_gb = 50.0\n', 'trash', true), /\[targets\]\ntrash = true/);
  assert.throws(() => setTargetInConfig(CONFIG, 'trash = true\n[evil]', true), /isn’t one of sweep’s targets/);
});

test('the log’s lines become a sweep starting, going target by target, and ending', () => {
  assert.deepEqual(parseLogLine('[2026-11-19T03:00:00Z] triggering AUTO full sweep: free 48.2 GB (44.9 GiB) < threshold 50.0 GB (18 targets)'),
    { kind: 'auto', at: Date.parse('2026-11-19T03:00:00Z'), dry: false, free: '48.2 GB (44.9 GiB)', threshold: 50, total: 18 });
  assert.equal(parseLogLine('[2026-11-19T03:00:00Z] batch start: trigger=manual targets=12').trigger, 'manual');
  assert.deepEqual(parseLogLine('[2026-11-19T03:00:01Z] cleaning cargo_cache (7/18)'), { kind: 'target', at: Date.parse('2026-11-19T03:00:01Z'), id: 'cargo_cache', index: 7, total: 18 });
  assert.equal(parseLogLine('[2026-11-19T03:00:02Z] cleaned cargo_cache: 2600000000 bytes').bytes, 2.6e9);
  assert.equal(parseLogLine('[2026-11-19T03:01:00Z] batch end: trigger=auto').kind, 'end');
  assert.equal(parseLogLine('[2026-11-19T03:01:00Z] sweep complete in 72000ms: reclaimed 11.8 GB').kind, 'complete');
  assert.equal(parseLogLine('[2026-11-19T02:28:29Z] check OK: free 125.9 GB >= threshold 50.0 GB'), null);
  assert.equal(parseLogLine('OK: 125.9 GB free'), null);
});

test('a history record said briefly: freed (the larger of measured and tracked), before and after, what went most', () => {
  const r = recordSummary(RECORD);
  assert.equal(r.freed, 11.8e9); assert.equal(r.freeBefore, 48.2e9); assert.equal(r.freeAfter, 60e9); assert.equal(r.targets, 2); assert.equal(r.ms, 72000);
  assert.deepEqual(r.top.map(t => t.id), ['app_caches', 'cargo_cache']);
  assert.deepEqual(r.warnings, ['trash: TCC blocked']);
  assert.equal(recordSummary(null), null);
  assert.equal(macName('Mac mini'), 'Mac mini'); assert.equal(macName('MacBook Pro'), 'MacBook'); assert.equal(macName(''), 'This Mac');
});

test('the state reads status, config, history and the scan; actions are checked before sweep is asked', async () => {
  const dir = home(), calls = [];
  appendFileSync(join(dir, '.local', 'share', 'sweep', 'history.jsonl'), `${JSON.stringify(RECORD)}\n`);
  const s = sweepService({ home: dir, execFile: fakeSweep(calls) });
  const state = await s.call('state');
  assert.equal(state.name, 'MacBook'); assert.equal(state.host, 'tsukuyomi'); assert.equal(state.threshold, 50);
  assert.equal(state.disk.free, 125.9e9); assert.equal(state.service.loaded, true); assert.equal(state.scan, null);
  assert.equal(state.history.length, 1); assert.equal(state.history[0].freed, 11.8e9);
  assert.deepEqual(state.config, { interval: 300, cooldown: 30, emergency: 5, notify: true });
  const scanned = await s.call('scan');
  assert.deepEqual(scanned.scan.targets.map(t => t.id), ['app_caches', 'cargo_cache', 'trash'], 'largest first');
  assert.equal(scanned.scan.ready, 6.26e9);
  await assert.rejects(s.call('rm -rf'), /can’t do that/);
  await assert.rejects(s.call('threshold', 2), /between 5 and 1000/);
  await assert.rejects(s.call('target', 'not_a_target', true), /isn’t one of sweep’s targets/);
  await assert.rejects(s.call('service', 'reboot'), /Install, uninstall or trigger/);
  await assert.rejects(s.call('clean', { tier: 'everything' }), /safe, moderate or aggressive/);
  await assert.rejects(s.call('clean', { only: ['ok', '../../etc'] }), /aren’t sweep’s targets/);
  await s.call('threshold', 45);
  assert.deepEqual(calls.find(c => c[1] === 'config'), ['sweep', 'config', '--set-threshold', '45']);
  await s.call('target', 'trash', false);
  assert.match(readFileSync(join(dir, '.config', 'sweep', 'config.toml'), 'utf8'), /^trash = false$/m);
  assert.equal((await s.call('state')).scan.targets.find(t => t.id === 'trash').enabled, false);
  assert.deepEqual((await s.call('logs', 5)).lines, ['[2026-11-19T02:28:29Z] check OK: free 125.9 GB (117.3 GiB) >= threshold 50.0 GB']);
});

test('a sweep that starts on its own is followed in the log: start, each target, and done with its record', async () => {
  const dir = home(), events = [], log = join(dir, 'Library', 'Logs', 'sweep.log');
  const timers = { setTimeout: () => 0, clearTimeout() {} };
  const s = sweepService({ home: dir, execFile: fakeSweep(), onEvent: e => events.push(e), timers });
  s.follow();
  await new Promise(resolve => setTimeout(resolve, 50)); // the first read: where the log ends now
  const tick = async () => { s.stopFollowing(); s.follow(); await new Promise(resolve => setTimeout(resolve, 30)); };
  appendFileSync(log, '[2026-11-19T03:00:00Z] triggering AUTO full sweep: free 48.2 GB (44.9 GiB) < threshold 50.0 GB (2 targets)\n[2026-11-19T03:00:00Z] batch start: trigger=auto targets=2\n[2026-11-19T03:00:01Z] cleaning cargo_cache (1/2)\n');
  await tick();
  assert.equal(events[0].type, 'start'); assert.equal(events[0].running.trigger, 'auto');
  assert.match(events[0].running.reason, /fell to 48\.2 GB/);
  assert.equal(events.at(-1).running.current, 'cargo_cache');
  assert.equal((await s.call('state')).running.index, 1, 'the window sees it under way');
  appendFileSync(log, '[2026-11-19T03:00:30Z] cleaned cargo_cache: 2600000000 bytes\n[2026-11-19T03:00:31Z] cleaning app_caches (2/2)\n[2026-11-19T03:00:59Z] cleaned app_caches: 3100000000 bytes\n');
  await tick();
  assert.equal(events.at(-1).running.freed, 5.7e9);
  appendFileSync(join(dir, '.local', 'share', 'sweep', 'history.jsonl'), `${JSON.stringify(RECORD)}\n`);
  appendFileSync(log, '[2026-11-19T03:01:00Z] batch end: trigger=auto\n[2026-11-19T03:01:00Z] sweep complete in 72000ms: reclaimed 11.8 GB\n');
  await tick();
  const done = events.filter(e => e.type === 'done');
  assert.equal(done.length, 1, 'one end, though the log says it twice');
  assert.equal(done[0].record.freed, 11.8e9); assert.equal(done[0].trigger, 'auto'); assert.equal(done[0].name, 'MacBook');
  assert.equal((await s.call('state')).running, null);
  s.stopFollowing();
});

test('the other Mac’s summary is kept as told, its fields checked, and shown for 30 minutes', async () => {
  let clock = 1_000_000;
  const s = sweepService({ home: home(), execFile: fakeSweep(), now: () => clock });
  assert.throws(() => s.report('nope'), /Not a sweep summary/);
  s.report({ host: 'Kagutsuchi', name: 'Mac mini', disk: { free: 68.9e9, total: 245.1e9, used: 176.2e9 }, threshold: 50, service: { loaded: true }, ready: 12.4e9, running: null, extra: 'dropped' });
  const peer = (await s.call('state')).peer;
  assert.equal(peer.name, 'Mac mini'); assert.equal(peer.disk.free, 68.9e9); assert.equal(peer.ready, 12.4e9); assert.equal('extra' in peer, false);
  clock += 31 * 60_000;
  assert.equal((await s.call('state', true)).peer, null, 'stale after 30 minutes');
});

test('the window’s helpers: sizes, the broom’s state, and what a sweep by hand takes', () => {
  assert.equal(gb(125.9e9), '126 GB'); assert.equal(gb(68.94e9), '68.9 GB'); assert.equal(gbFine(0.004e9), '—'); assert.equal(gbFine(2.345e9), '2.35 GB');
  assert.equal(broomState({ here: { running: {} } }), 'sweeping');
  assert.equal(broomState({ here: {}, other: { running: {} } }), 'sweeping', 'the other Mac sweeping shows too');
  assert.equal(broomState({ here: {}, doneAt: 1000, now: 1000 + 60_000 }), 'done');
  assert.equal(broomState({ here: {}, doneAt: 1000, now: 1000 + 200_000 }), 'idle');
  assert.equal(broomState({ here: { below: true } }), 'low');
  assert.equal(broomState({ here: { service: { loaded: false } } }), 'off');
  const targets = SCAN.map(t => ({ ...t, bytes: t.bytes }));
  assert.deepEqual(sweepCount(targets, false), { count: 2, bytes: 5.76e9 }, 'Aggressive targets only when ticked');
  assert.equal(sweepCount(targets, true).count, 3);
  assert.equal(sweepTier(false), 'moderate'); assert.equal(sweepTier(true), 'aggressive');
  assert.equal(tierOf('Aggressive'), 'AGGR'); assert.equal(tierOf('OptIn'), 'OPT');
});

test('each Mac’s window asks its own Mac; the MacBook’s asks the mini with Touch ID to sweep, and is told its events', () => {
  assert.equal(kindOf('sweep'), 'local');
  assert.equal(kindOf('sweep-mini'), 'remote'); assert.equal(kindOf('sweep-peer-report'), 'remote');
  assert.equal(NEEDS_APPROVAL['sweep-mini'](['clean', {}]), true);
  assert.equal(NEEDS_APPROVAL['sweep-mini'](['service', 'uninstall']), true);
  assert.equal(NEEDS_APPROVAL['sweep-mini'](['state']), false);
  assert.equal(NEEDS_APPROVAL['sweep-mini'](['scan', true]), false);
  assert.ok(isLong('sweep-mini'), 'a sweep takes as long as the disk does');
  assert.ok(READS.includes('sweep-mini') && WINDOW_EVENTS.includes('sweep'));
  const main = read('../desktop/main.cjs'), face = read('../desktop/face-main.cjs'), preload = read('../desktop/preload.cjs'), app = read('../src/app.js');
  assert.match(main, /handle\('sweep', \(action, \.\.\.args\) => sweeper\.call\(action, \.\.\.args\), \{ refresh: false \}\);/);
  assert.match(main, /handle\('sweep-mini', \(action, \.\.\.args\) => sweeper\.call\(action, \.\.\.args\), \{ refresh: false \}\);/);
  assert.match(main, /sweepService\(\{ onEvent: event => sendToWindow\('fairy:sweep', event\) \}\)/);
  assert.match(face, /sweep: async \(action, \.\.\.args\) => \(await localSweep\(\)\)\.call\(action, \.\.\.args\)/);
  assert.match(face, /if \(!faceWindow\?\.open\) return;\s*void localSweep\(\)/, 'never opens a session (Touch ID) just to report');
  assert.match(preload, /sweep: \(action, \.\.\.args\) => ipcRenderer\.invoke\('fairy:sweep', action, \.\.\.args\)/);
  assert.match(app, /sweepView\(\{ api, rail: \$\('#action-rail'\), after: \$\('#routines'\)/);
  assert.match(app, /\.\.\.\(sweep \? \[sweep\.pane\] : \[\]\)/);
});
