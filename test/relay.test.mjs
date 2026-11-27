// Relay in Fairy (desktop/relay.mjs, src/relay.js): reading the user's repo syncer, running it only when asked, and
// following its log for the daily sync.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diffSummary, nextRun, parseConfig, parseLogLine, recordSummary, relayService, setJobInConfig } from '../desktop/relay.mjs';
import { bytes, nextWords, relayState, routeName, stepTime, syncLabel, syncProgress } from '../src/relay-logic.js';
import { kindOf, READS } from '../desktop/remote-channels.mjs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const CONFIG = `# relay\n\n[remote]\nuser = "me"\nhosts = [\n    "100.64.0.42",\n    "my-mac.local",\n    "192.168.1.42",\n]\nssh_key = "~/.ssh/id_ed25519"\nmin_remote_free_gb = 20.0\n\n[schedule]\nhour = 2\nminute = 0\nnotify = true\n\n[sync]\nmode = "additive"\nglobal_excludes = [\n    ".DS_Store",\n    "target/",\n    "node_modules/",\n]\n\n[[jobs]]\nid = "github"\nname = "Github"\nsource = "~/Github"\ndest = "/Users/me/Github"\nenabled = true\nextra_excludes = []\n\n[[jobs]]\nid = "research"\nname = "Research"\nsource = "~/Research"\ndest = "/Users/me/Research"\nenabled = true\nextra_excludes = []\n`;
const STATUS = { local_host: 'workstation', remote: { host: '100.64.0.42', user: 'me', remote_hostname: 'HomeMac', free_bytes: 65.6e9, total_bytes: 245.1e9, ssh_key: '/x' }, remote_error: null, schedule_time: '02:00',
  service: { label: 'com.example.relay', plist_installed: true, loaded: true, pid: null, last_exit_code: null }, state: { last_sync_at: null, last_success_at: null, total_sync_runs: 0, total_files_transferred_all_time: 0, total_bytes_transferred_all_time: 0 },
  jobs: [{ id: 'github', name: 'Github', source: '~/Github', dest: '/Users/me/Github', enabled: true }, { id: 'research', name: 'Research', source: '~/Research', dest: '/Users/me/Research', enabled: true }] };
const DIFF = { timestamp: '2026-11-19T04:00:00Z', dry_run: true, success: true, jobs: [
  { id: 'github', name: 'Github', success: true, total_files: 91520, files_transferred: 18794, total_size_bytes: 1, transferred_bytes: 10.68e9, duration_ms: 8000, changed_paths: Array.from({ length: 500 }, (_, i) => `+ a/${i}`), error: null },
  { id: 'research', name: 'Research', success: true, total_files: 14181, files_transferred: 3, total_size_bytes: 1, transferred_bytes: 66605, duration_ms: 300, changed_paths: ['+ x', '+ y', '~ z'], error: null }] };
const RECORD = { timestamp: '2026-11-19T02:06:00Z', local_host: 'workstation', remote_host_used: '100.64.0.42', remote_name: 'HomeMac', trigger: 'daily', dry_run: false, success: true, total_files_transferred: 18797, total_bytes_transferred: 10.68e9, duration_ms: 360000,
  jobs: [{ id: 'github', name: 'Github', success: true, files_transferred: 18794, transferred_bytes: 10.68e9, error: null }, { id: 'research', name: 'Research', success: true, files_transferred: 3, transferred_bytes: 66605, error: null }], note: null };

function home() {
  const dir = mkdtempSync(join(tmpdir(), 'fairy-relay-'));
  for (const folder of [['.config', 'relay'], ['.local', 'share', 'relay'], ['.local', 'bin'], ['Library', 'Logs']]) mkdirSync(join(dir, ...folder), { recursive: true });
  writeFileSync(join(dir, '.config', 'relay', 'config.toml'), CONFIG);
  writeFileSync(join(dir, '.local', 'bin', 'relay'), '#!/bin/sh\n');
  writeFileSync(join(dir, 'Library', 'Logs', 'relay.log'), '');
  return dir;
}
function fakeRelay(calls = []) {
  return async (file, args) => {
    calls.push([file.split('/').pop(), ...args]);
    if (file.endsWith('system_profiler')) return { stdout: JSON.stringify({ SPHardwareDataType: [{ machine_name: 'MacBook Pro' }] }) };
    if (args[0] === 'status') return { stdout: JSON.stringify(STATUS) };
    if (args[0] === 'diff') return { stdout: JSON.stringify(DIFF) };
    return { stdout: '' };
  };
}
const settle = ms => new Promise(resolve => setTimeout(resolve, ms));

test('relay’s config is read as toml writes it, and a repo turned on or off changes only its own line', () => {
  const config = parseConfig(CONFIG);
  assert.deepEqual(config.remote.hosts, ['100.64.0.42', 'my-mac.local', '192.168.1.42']);
  assert.equal(config.remote.min_remote_free_gb, 20); assert.equal(config.schedule.hour, 2); assert.equal(config.sync.global_excludes.length, 3);
  assert.deepEqual(config.jobs.map(j => [j.id, j.enabled]), [['github', true], ['research', true]]);
  const off = setJobInConfig(CONFIG, 'research', false);
  assert.deepEqual(parseConfig(off).jobs.map(j => [j.id, j.enabled]), [['github', true], ['research', false]]);
  assert.equal(off.split('\n').length, CONFIG.split('\n').length, 'one line changed, none added');
  assert.throws(() => setJobInConfig(CONFIG, 'nope', false), /isn’t one of relay’s repos/);
  assert.throws(() => setJobInConfig(CONFIG, 'git"hub', false), /isn’t one of relay’s repos/);
});

test('relay’s log lines become events: a sync starting, each repo, the end, and one that never began', () => {
  assert.deepEqual(parseLogLine('[2026-11-19T02:00:04Z] starting daily sync -> me@100.64.0.42 (HomeMac, 65.6 GB free) across 3 job(s)'), { kind: 'start', at: Date.parse('2026-11-19T02:00:04Z'), trigger: 'daily', mini: 'HomeMac', free: 65.6e9, total: 3 });
  assert.deepEqual(parseLogLine('[2026-11-19T02:00:05Z] syncing github (1/3)'), { kind: 'job', at: Date.parse('2026-11-19T02:00:05Z'), id: 'github', index: 1, total: 3 });
  assert.equal(parseLogLine('[2026-11-19T02:05:05Z] synced github: 18794 file(s), 10680000000 bytes').bytes, 10.68e9);
  assert.equal(parseLogLine('[2026-11-19T02:05:05Z] synced research: 0 file(s), 0 bytes FAILED: rsync exit 23: denied').error, 'rsync exit 23: denied');
  assert.equal(parseLogLine('[2026-11-19T02:06:00Z] sync OK (daily) in 6m 0s: 18797 file(s), 10.7 GB transferred -> HomeMac').ok, true);
  assert.equal(parseLogLine('[2026-11-19T02:01:00Z] sync FAILED (daily): no host reachable').kind, 'failed');
  assert.equal(parseLogLine('[2026-11-19T02:01:00Z] Aborted sync: HomeMac free space (18.2 GB) is below min_remote_free_gb (20.0 GB)').floor, true);
  assert.equal(parseLogLine('[2026-11-19T02:01:00Z] sync skipped: another relay instance is already running'), null);
});

test('records and dry runs are said briefly; a dry run’s own record is not history', () => {
  const r = recordSummary(RECORD);
  assert.equal(r.ok, true); assert.equal(r.files, 18797); assert.equal(r.jobs.length, 2); assert.equal(r.route, '100.64.0.42');
  assert.equal(recordSummary({ ...RECORD, dry_run: true }), null);
  const d = diffSummary(DIFF);
  assert.equal(d.files, 18797); assert.equal(d.jobs[0].paths.length, 40, 'a sample of the paths, not all 500'); assert.equal(d.jobs[0].listed, 500);
  assert.match(diffSummary({ success: false, jobs: [], note: 'All hosts failed' }).problem, /All hosts failed/);
  const at = new Date(2026, 10, 19, 15, 0).getTime();
  assert.equal(new Date(nextRun(2, 0, at)).getDate(), 20, 'after 02:00 today, tomorrow');
  assert.equal(new Date(nextRun(16, 30, at)).getDate(), 19);
});

test('the window reads the route, the mini’s space, repos and schedule; runs a preview, a repo off and the time only when asked', async () => {
  const dir = home(), calls = [];
  const r = relayService({ home: dir, execFile: fakeRelay(calls) });
  const s = await r.call('state');
  assert.equal(s.installed, true); assert.equal(s.name, 'MacBook'); assert.equal(s.mini.reachable, true); assert.equal(s.mini.free, 65.6e9);
  assert.equal(s.floor, 20e9); assert.equal(s.schedule.time, '02:00'); assert.equal(s.service.loaded, true); assert.equal(s.jobs.length, 2); assert.equal(s.diff, null);
  assert.deepEqual(calls.filter(c => c[0] === 'relay').map(c => c.slice(1).join(' ')), ['status --json'], 'only status: no sync, no dry run');
  await r.call('state');
  assert.equal(calls.filter(c => c[1] === 'status').length, 1, 'status (which asks the mini over ssh) kept a minute');
  const d = await r.call('diff', true);
  assert.equal(d.diff.bytes, 10.68e9 + 66605);
  await r.call('job', 'research', false);
  assert.match(readFileSync(join(dir, '.config', 'relay', 'config.toml'), 'utf8'), /id = "research"[\s\S]*enabled = false/);
  await assert.rejects(r.call('job', 'nope', true), /isn’t one of relay’s repos/);
  await r.call('time', '2:30');
  assert.deepEqual(calls.filter(c => c[1] === 'config' || (c[1] === 'service' && c[2] === 'install')).map(c => c.slice(1).join(' ')), ['config --set-time 02:30', 'service install'], 'the new time applied to the loaded LaunchAgent');
  await assert.rejects(r.call('time', '25:00'), /like 02:00/);
  await assert.rejects(r.call('service', 'rm'), /Install, uninstall or trigger/);
  await assert.rejects(r.call('rsync'), /can’t do that/);
  await assert.rejects(r.call('sync', { only: ['../x'] }), /aren’t relay’s repos/);
});

test('a Mac without relay says so, and shows the MacBook’s summary as told, for 30 minutes', async () => {
  let clock = 1_000_000;
  const r = relayService({ home: mkdtempSync(join(tmpdir(), 'fairy-relay-none-')), execFile: fakeRelay(), now: () => clock });
  const s = await r.call('state');
  assert.equal(s.installed, false); assert.equal(s.peer, null);
  await assert.rejects(r.call('sync'), /isn’t installed on this Mac/);
  assert.throws(() => r.report('nope'), /Not a relay summary/);
  r.report({ host: 'workstation', name: 'MacBook', installed: true, mini: { reachable: true, name: 'HomeMac', route: '100.64.0.42', free: 65.6e9, total: 245.1e9 }, floor: 20e9,
    schedule: { time: '02:00', next: 5 }, jobs: [{ id: 'github', name: 'Github', enabled: true }], pending: { at: 1, files: 3, bytes: 66605, jobs: [] }, running: null, extra: 'dropped' });
  const peer = (await r.call('state')).peer;
  assert.equal(peer.mini.free, 65.6e9); assert.equal(peer.pending.bytes, 66605); assert.equal(peer.jobs[0].name, 'Github'); assert.equal('extra' in peer, false);
  clock += 31 * 60_000;
  assert.equal((await r.call('state')).peer, null, 'stale after 30 minutes');
});

test('the daily sync is followed in the log: start, each repo, and done with its record; a sync that never began is said once', async () => {
  const dir = home(), events = [], log = join(dir, 'Library', 'Logs', 'relay.log');
  const r = relayService({ home: dir, execFile: fakeRelay(), onEvent: e => events.push(e), timers: { setTimeout: () => 0, clearTimeout() {} } });
  r.follow(); await settle(50);
  const tick = async () => { r.stopFollowing(); r.follow(); await settle(30); };
  appendFileSync(log, '[2026-11-19T02:00:04Z] starting daily sync -> me@100.64.0.42 (HomeMac, 65.6 GB free) across 2 job(s)\n[2026-11-19T02:00:05Z] syncing github (1/2)\n');
  await tick();
  assert.equal(events[0].type, 'start'); assert.equal(events[0].running.trigger, 'daily'); assert.equal(events.at(-1).running.current, 'github');
  assert.equal((await r.call('state')).running.index, 1, 'the window sees it under way');
  appendFileSync(log, '[2026-11-19T02:05:05Z] synced github: 18794 file(s), 10680000000 bytes\n[2026-11-19T02:05:06Z] syncing research (2/2)\n[2026-11-19T02:05:07Z] synced research: 3 file(s), 66605 bytes\n');
  await tick();
  assert.equal(events.at(-1).running.bytes, 10.68e9 + 66605); assert.equal(events.at(-1).running.files, 18797);
  appendFileSync(join(dir, '.local', 'share', 'relay', 'history.jsonl'), `${JSON.stringify(RECORD)}\n`);
  appendFileSync(log, '[2026-11-19T02:06:00Z] sync OK (daily) in 6m 0s: 18797 file(s), 10.7 GB transferred -> HomeMac\n');
  await tick();
  const done = events.filter(e => e.type === 'done');
  assert.equal(done.length, 1); assert.equal(done[0].problem, null); assert.equal(done[0].record.bytes, 10.68e9); assert.equal(done[0].free, 65.6e9);
  assert.equal((await r.call('state')).running, null);
  assert.equal((await r.call('state')).history[0].trigger, 'daily');
  appendFileSync(log, '[2026-11-20T02:00:40Z] sync FAILED (daily): Could not reach any Mac mini host\n');
  await tick();
  const failed = events.filter(e => e.type === 'done').at(-1);
  assert.match(failed.problem, /Could not reach/); assert.equal(failed.floor, false);
  r.stopFollowing();
});

test('a sync by hand runs relay in its own process group, so Stop ends its rsync too', async () => {
  const dir = home(), events = [], spawned = [], killed = [];
  const child = Object.assign(new EventEmitter(), { pid: 4242, stderr: new EventEmitter(), kill() {} });
  const r = relayService({ home: dir, execFile: fakeRelay(), onEvent: e => events.push(e), spawn: (file, args, options) => { spawned.push({ args, options }); return child; }, kill: (pid, signal) => killed.push([pid, signal]), timers: { setTimeout: () => 0, clearTimeout() {} } });
  const running = r.call('sync', {});
  await settle(20);
  assert.deepEqual(spawned[0].args, ['sync', '--trigger', 'manual', '--quiet']); assert.equal(spawned[0].options.detached, true);
  await assert.rejects(r.call('sync', {}), /already syncing/);
  assert.deepEqual(await r.call('stop'), { stopped: true }); assert.deepEqual(killed, [[-4242, 'SIGTERM']]);
  child.emit('close', null);
  await running;
  const done = events.filter(e => e.type === 'done');
  assert.equal(done.length, 1); assert.match(done[0].problem, /relay stopped/);
});

test('the window’s helpers: sizes, the next run, the time steps, routes and the icon’s state', () => {
  assert.equal(bytes(66605), '66.6 KB'); assert.equal(bytes(10.68e9), '10.7 GB'); assert.equal(bytes(414e6), '414 MB'); assert.equal(bytes(245.1e9), '245 GB');
  assert.equal(stepTime('02:00', -30), '01:30'); assert.equal(stepTime('23:30', 30), '00:00'); assert.equal(stepTime('00:00', -30), '23:30');
  assert.equal(routeName('100.64.0.42'), 'Tailscale'); assert.equal(routeName('my-mac.local'), 'Bonjour'); assert.equal(routeName('192.168.1.42'), 'home network');
  const evening = new Date(2026, 10, 19, 20, 0).getTime();
  assert.equal(nextWords(nextRun(2, 0, evening), evening), 'Tonight 02:00');
  assert.equal(nextWords(nextRun(9, 0, evening), evening), 'Tomorrow 09:00');
  const mac = { installed: true, mini: { reachable: true, free: 65.6e9, total: 245.1e9 }, floor: 20e9, service: { loaded: true }, history: [] };
  assert.equal(relayState({ mac }), 'idle');
  assert.equal(relayState({ mac: { ...mac, running: {} } }), 'syncing');
  assert.equal(relayState({ mac, doneAt: 1000, now: 61_000 }), 'done');
  assert.equal(relayState({ mac: { ...mac, history: [{ ok: false }] } }), 'failed');
  assert.equal(relayState({ mac: { ...mac, mini: { reachable: false } } }), 'waiting');
  assert.equal(relayState({ mac: { ...mac, mini: { reachable: true, free: 18e9, total: 245e9 } } }), 'waiting', 'under the floor');
  assert.equal(relayState({ mac: { ...mac, service: { loaded: false } } }), 'off');
  assert.equal(syncProgress({ bytes: 4.2e9, expected: 10.7e9 }).toFixed(2), '0.39');
  assert.equal(syncLabel({ jobs: [{ enabled: true }, { enabled: true }, { enabled: false }] }), 'Sync 2 repos now');
});

test('each Mac’s window asks its own relay; the MacBook tells the mini its summary without asking for Touch ID', () => {
  assert.equal(kindOf('relay'), 'local'); assert.equal(kindOf('relay-peer-report'), 'remote'); assert.ok(READS.includes('relay-peer-report'));
  const main = read('../desktop/main.cjs'), face = read('../desktop/face-main.cjs'), preload = read('../desktop/preload.cjs'), app = read('../src/app.js');
  assert.match(main, /handle\('relay', \(action, \.\.\.args\) => relayer\.call\(action, \.\.\.args\), \{ refresh: false \}\);/);
  assert.match(main, /handle\('relay-peer-report', value => relayer\.report\(value\), \{ refresh: false \}\);/);
  assert.match(face, /relay: async \(action, \.\.\.args\) => \(await localRelay\(\)\)\.call\(action, \.\.\.args\)/);
  assert.match(face, /if \(!faceWindow\?\.open\) return;[\s\S]{0,400}faceWindow\.call\('relay-peer-report'/, 'only while the window’s session is open');
  assert.match(preload, /relay: \(action, \.\.\.args\) => ipcRenderer\.invoke\('fairy:relay', action, \.\.\.args\)/);
  assert.match(app, /relayView\(\{ api, rail: \$\('#action-rail'\), after: sweep\?\.button/);
  assert.match(app, /\.\.\.\(relay \? \[relay\.pane\] : \[\]\)/);
});
