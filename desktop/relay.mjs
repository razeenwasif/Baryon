// Relay in Fairy: the user's own repo syncer (~/Github/TUI-Applications/relay, a Rust CLI with a TUI), which pushes
// the MacBook's repos to the Mac mini once a day with rsync, adding and updating only (never deleting, and keeping
// anything newer on the mini). Fairy never copies anything herself: she asks the `relay` binary, as its TUI does.
// What she reads: `relay status --json` (the mini reachable or not and its free space, the schedule, the LaunchAgent,
// the last sync), `relay diff --json` (a dry run, read only), its config (~/.config/relay/config.toml), its history
// (~/.local/share/relay/history.jsonl) and its log (~/Library/Logs/relay.log), which she follows to see a sync start
// on its own, go repo by repo, and end. What she runs, only when you ask in the window: `relay sync` (the repos that
// are on, or some), stopping it, a repo on or off (its `enabled` line in the config), the daily time
// (`relay config --set-time`, then `relay service install` to apply it), and `relay service install|uninstall|trigger`.
//
// relay lives on the MacBook: its window asks it through the local `relay` call. The Mac Fairy lives on has no relay
// of its own; its window shows the MacBook's as that Mac's window last told it (`relay-peer-report`).
import { execFile as execFileCb, spawn as spawnCb } from 'node:child_process';
import { chmod, mkdir, open, readFile as readFileCb, rename, stat as statCb, writeFile } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { macName } from './sweep.mjs';

export const ACTIONS = Object.freeze(['state', 'diff', 'sync', 'stop', 'job', 'time', 'service', 'logs', 'tui']);
export const SERVICE_ACTIONS = Object.freeze(['install', 'uninstall', 'trigger']);
const ID = /^[a-z0-9][a-z0-9_-]{0,40}$/;
const STATUS_MS = 60_000, DIFF_MS = 10 * 60_000, PEER_STALE_MS = 30 * 60_000, PATHS_SHOWN = 40;

// relay's config.toml as it writes it (toml's pretty printer): the tables it needs here, and each [[jobs]] entry.
export function parseConfig(text) {
  const out = { remote: {}, schedule: {}, sync: {}, jobs: [] };
  let section = null, job = null, list = null;
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.replace(/^\s*#.*$/, '').trim();
    if (!line) continue;
    if (list) { // a multi-line array: its strings, until the ]
      for (const m of line.matchAll(/"((?:[^"\\]|\\.)*)"/g)) list.push(m[1]);
      if (line.includes(']')) list = null;
      continue;
    }
    if (line === '[[jobs]]') { job = {}; out.jobs.push(job); section = 'job'; continue; }
    const head = /^\[([A-Za-z0-9_.-]+)\]$/.exec(line);
    if (head) { section = head[1]; job = null; continue; }
    const pair = /^([A-Za-z0-9_]+)\s*=\s*(.+)$/.exec(line);
    if (!pair) continue;
    const into = section === 'job' ? job : out[section];
    if (!into) continue;
    const value = pair[2].trim();
    if (value.startsWith('[')) {
      into[pair[1]] = [...value.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(m => m[1]);
      if (!value.includes(']')) list = into[pair[1]];
      continue;
    }
    into[pair[1]] = value === 'true' ? true : value === 'false' ? false : /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value.replace(/^"(.*)"$/, '$1');
  }
  for (const j of out.jobs) j.enabled = j.enabled !== false;
  return out;
}

// The config with one repo turned on or off: the `enabled` line of its [[jobs]] entry changed, or added to it.
export function setJobInConfig(text, id, on) {
  if (!ID.test(String(id))) throw new Error('That isn’t one of relay’s repos.');
  const lines = String(text ?? '').split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() !== '[[jobs]]') continue;
    let end = lines.findIndex((line, k) => k > i && /^\s*\[/.test(line));
    if (end < 0) end = lines.length;
    const block = lines.slice(i + 1, end);
    if (!block.some(line => new RegExp(`^\\s*id\\s*=\\s*"${id}"\\s*$`).test(line))) continue;
    start = i;
    const at = block.findIndex(line => /^\s*enabled\s*=/.test(line));
    const line = `enabled = ${on ? 'true' : 'false'}`;
    if (at >= 0) lines[i + 1 + at] = line;
    else { let last = end; while (last - 1 > i && !lines[last - 1].trim()) last -= 1; lines.splice(last, 0, line); }
    break;
  }
  if (start < 0) throw new Error('That isn’t one of relay’s repos.');
  return lines.join('\n');
}

// One line of relay.log, as an event: a sync starting, a repo starting or done, the end, or a sync that never began.
// `[2026-11-19T02:00:04Z] syncing github (1/3)`. Anything else is null.
export function parseLogLine(line) {
  const m = /^\[([^\]]+)\]\s+(.*)$/.exec(String(line ?? '').trim());
  if (!m) return null;
  const at = Date.parse(m[1]) || null, text = m[2];
  let x;
  if ((x = /^starting (\S+) sync -> \S+ \((.+?), ([\d.]+) GB free\) across (\d+) job/.exec(text))) return { kind: 'start', at, trigger: x[1], mini: x[2], free: Math.round(Number(x[3]) * 1e9), total: Number(x[4]) };
  if ((x = /^syncing ([A-Za-z0-9_-]+) \((\d+)\/(\d+)\)/.exec(text))) return { kind: 'job', at, id: x[1], index: Number(x[2]), total: Number(x[3]) };
  if ((x = /^synced ([A-Za-z0-9_-]+): (\d+) file\(s\), (\d+) bytes(?: FAILED: (.*))?$/.exec(text))) return { kind: 'synced', at, id: x[1], files: Number(x[2]), bytes: Number(x[3]), error: x[4] || null };
  if ((x = /^sync (OK|FAILED) \((\S+)\) in /.exec(text))) return { kind: 'end', at, ok: x[1] === 'OK', trigger: x[2] };
  if ((x = /^sync FAILED \((\S+)\): (.*)$/.exec(text))) return { kind: 'failed', at, trigger: x[1], problem: x[2] };
  if ((x = /^Aborted sync: (.*)$/.exec(text))) return { kind: 'failed', at, trigger: '', problem: x[1], floor: true };
  return null;
}

// A history record (a SyncRunRecord), said briefly.
export function recordSummary(record) {
  if (!record || typeof record !== 'object' || record.dry_run) return null;
  const jobs = Array.isArray(record.jobs) ? record.jobs : [];
  return {
    at: Date.parse(record.timestamp) || 0, trigger: String(record.trigger || ''), ok: record.success === true,
    files: Number(record.total_files_transferred) || 0, bytes: Number(record.total_bytes_transferred) || 0, ms: Number(record.duration_ms) || 0,
    route: record.remote_host_used ? String(record.remote_host_used) : null, note: record.note ? String(record.note).slice(0, 300) : null,
    jobs: jobs.map(j => ({ id: String(j.id), name: String(j.name || j.id), ok: j.success === true, files: Number(j.files_transferred) || 0, bytes: Number(j.transferred_bytes) || 0, error: j.error ? String(j.error).slice(0, 200) : null })),
  };
}

// A dry run (`relay diff --json`), as the window shows it: per repo what would go, and a sample of the paths.
export function diffSummary(record) {
  const jobs = (Array.isArray(record?.jobs) ? record.jobs : []).map(j => ({
    id: String(j.id), name: String(j.name || j.id), ok: j.success !== false, error: j.error ? String(j.error).slice(0, 200) : null,
    files: Number(j.files_transferred) || 0, totalFiles: Number(j.total_files) || 0, bytes: Number(j.transferred_bytes) || 0,
    paths: (Array.isArray(j.changed_paths) ? j.changed_paths : []).slice(0, PATHS_SHOWN).map(String), listed: Array.isArray(j.changed_paths) ? j.changed_paths.length : 0,
  }));
  return { jobs, files: jobs.reduce((n, j) => n + j.files, 0), bytes: jobs.reduce((n, j) => n + j.bytes, 0), problem: record?.success === false && !jobs.length ? String(record.note || 'The mini couldn’t be reached.') : null };
}

// When the next daily sync is, from now: today at HH:MM if that's still ahead, else tomorrow.
export function nextRun(hour, minute, now = Date.now()) {
  const at = new Date(now); at.setHours(hour, minute, 0, 0);
  if (at.getTime() <= now) at.setDate(at.getDate() + 1);
  return at.getTime();
}

export function relayService({
  home = homedir(), bin = join(home, '.local', 'bin', 'relay'), onEvent = () => {}, now = () => Date.now(),
  execFile = (file, args, options) => new Promise((resolve, reject) => execFileCb(file, args, options, (error, stdout, stderr) => (error ? reject(Object.assign(error, { stdout, stderr })) : resolve({ stdout, stderr })))),
  spawn = spawnCb, readFile = path => readFileCb(path, 'utf8'), stat = statCb, timers = globalThis, pollMs = 3000, kill = process.kill.bind(process),
} = {}) {
  const paths = {
    config: join(home, '.config', 'relay', 'config.toml'), history: join(home, '.local', 'share', 'relay', 'history.jsonl'),
    log: join(home, 'Library', 'Logs', 'relay.log'),
  };
  const host = hostname().replace(/\.local$/, '');
  let model = '', installed = null, status = null, statusAt = 0, reading = null, diff = null, diffAt = 0, diffing = null;
  let running = null, child = null, peer = null, offset = -1, timer = null, carry = '', polling = null;

  const relay = async (args, { timeout = 60_000 } = {}) => {
    try { return (await execFile(bin, args, { timeout, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1' } })).stdout; }
    catch (error) {
      if (error?.code === 'ENOENT') { installed = false; throw new Error('relay isn’t installed on this Mac (~/.local/bin/relay).'); }
      throw new Error(String(error?.stderr || error?.message || error).trim().replace(/^Error:\s*/, '').split('\n').slice(-2).join(' ').slice(0, 300) || 'relay didn’t answer.');
    }
  };
  async function isInstalled() {
    if (installed != null) return installed;
    try { installed = (await stat(bin)).isFile(); } catch { installed = false; }
    return installed;
  }
  async function machine() {
    if (model) return model;
    try { model = String(JSON.parse((await execFile('/usr/sbin/system_profiler', ['-json', 'SPHardwareDataType'], { timeout: 15_000 })).stdout).SPHardwareDataType?.[0]?.machine_name || ''); } catch { model = ''; }
    return model;
  }
  // relay's status asks the mini over ssh (each route in turn, 6 s each when it's away), so it's kept a minute and
  // read one at a time.
  async function readStatus({ fresh = false } = {}) {
    if (!fresh && status && now() - statusAt < STATUS_MS) return status;
    reading ??= (async () => {
      try { status = JSON.parse(await relay(['status', '--json'], { timeout: 45_000 })); statusAt = now(); return status; }
      finally { reading = null; }
    })();
    return reading;
  }
  async function readConfig() { try { return parseConfig(await readFile(paths.config)); } catch { return parseConfig(''); } }
  async function readHistory(limit = 20) {
    let text = '';
    try { text = await readFile(paths.history); } catch { return []; }
    return text.split('\n').filter(Boolean).slice(-limit * 2).map(line => { try { return recordSummary(JSON.parse(line)); } catch { return null; } }).filter(Boolean).slice(-limit).reverse();
  }
  async function logTail(lines = 40) {
    try { return (await readFile(paths.log)).split('\n').filter(Boolean).slice(-Math.min(200, Math.max(1, lines))); } catch { return []; }
  }

  // The dry run: what each repo that's on would send. A dry run of ~/Github takes a while; kept 10 minutes; one at a time.
  async function readDiff({ fresh = false } = {}) {
    if (!fresh && diff && now() - diffAt < DIFF_MS) return diff;
    diffing ??= (async () => {
      try { diff = diffSummary(JSON.parse(await relay(['diff', '--json'], { timeout: 10 * 60_000 }))); diffAt = now(); return diff; }
      finally { diffing = null; }
    })();
    return diffing;
  }

  // What the window shows: the route to the mini and its free space against relay's floor, the repos, the schedule
  // and LaunchAgent, the history, the dry run if one's been made, and a sync under way.
  async function state({ fresh = false } = {}) {
    const name = await machine();
    const base = { host, name: macName(name), at: now(), peer: peer && now() - peer.at < PEER_STALE_MS ? peer : null };
    if (!(await isInstalled())) return { ...base, installed: false };
    const [s, config, history] = await Promise.all([readStatus({ fresh }), readConfig(), readHistory()]);
    const hour = Number(config.schedule.hour ?? 2), minute = Number(config.schedule.minute ?? 0);
    return {
      ...base, installed: true, host: String(s.local_host || host),
      mini: s.remote ? { reachable: true, name: String(s.remote.remote_hostname || 'Mac mini'), route: String(s.remote.host || ''), user: String(s.remote.user || ''), free: Number(s.remote.free_bytes) || 0, total: Number(s.remote.total_bytes) || 0 }
        : { reachable: false, problem: String(s.remote_error || 'The mini didn’t answer.').split('\n')[0].slice(0, 300), free: Number(s.state?.last_remote_free_bytes) || 0, total: 0 },
      floor: Number(config.remote.min_remote_free_gb ?? 20) * 1e9, routes: (config.remote.hosts || []).map(String).slice(0, 6),
      schedule: { hour, minute, time: String(s.schedule_time || `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`), next: nextRun(hour, minute, now()), notify: config.schedule.notify !== false },
      service: { loaded: Boolean(s.service?.loaded), installed: Boolean(s.service?.plist_installed), lastExit: s.service?.last_exit_code ?? null, pid: s.service?.pid ?? null, label: String(s.service?.label || 'com.razeenwasif.relay') },
      jobs: (Array.isArray(s.jobs) ? s.jobs : config.jobs).map(j => ({ id: String(j.id), name: String(j.name || j.id), source: String(j.source || ''), dest: String(j.dest || ''), enabled: j.enabled !== false })),
      excludes: (config.sync.global_excludes || []).length,
      lastSyncAt: Date.parse(s.state?.last_sync_at) || 0, lastSuccessAt: Date.parse(s.state?.last_success_at) || 0, lastStatus: s.state?.last_status ? String(s.state.last_status).slice(0, 300) : null,
      totals: { runs: Number(s.state?.total_sync_runs) || 0, files: Number(s.state?.total_files_transferred_all_time) || 0, bytes: Number(s.state?.total_bytes_transferred_all_time) || 0 },
      history, diff: diff ? { at: diffAt, ...diff } : null, diffing: Boolean(diffing), running: running ? { ...running } : null,
    };
  }
  // Briefly, for the other Mac's window.
  async function summary() {
    const s = await state();
    if (!s.installed) return { host: s.host, name: s.name, at: s.at, installed: false };
    return { host: s.host, name: s.name, at: s.at, installed: true, mini: s.mini, floor: s.floor, schedule: s.schedule, service: { loaded: s.service.loaded },
      jobs: s.jobs, lastSyncAt: s.lastSyncAt, lastSuccessAt: s.lastSuccessAt, lastStatus: s.lastStatus, last: s.history[0] ?? null,
      pending: s.diff ? { at: s.diff.at, files: s.diff.files, bytes: s.diff.bytes, jobs: s.diff.jobs.map(({ id, name, files, bytes, ok }) => ({ id, name, files, bytes, ok })) } : null, running: s.running };
  }

  // A sync, by hand: the repos that are on, or some of them. One at a time (relay itself holds a lock too); its
  // progress comes from the log.
  async function sync({ only = null } = {}) {
    if (running || child) throw new Error('relay is already syncing.');
    const args = ['sync', '--trigger', 'manual', '--quiet'];
    if (only != null) {
      const ids = (Array.isArray(only) ? only : []).map(String);
      if (!ids.length || ids.length > 20 || !ids.every(id => ID.test(id))) throw new Error('Those aren’t relay’s repos.');
      args.push('--only', ids.join(','));
    }
    const before = diff;
    running = { trigger: 'manual', startedAt: now(), index: 0, total: 0, current: null, files: 0, bytes: 0, expected: before?.bytes ?? null, failed: [] };
    emit({ type: 'start', running: { ...running } });
    // Its own process group, so stopping it stops its rsync too.
    child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'], detached: true, env: { ...process.env, NO_COLOR: '1' } });
    let error = '';
    child.stderr?.on('data', chunk => { error = (error + chunk).slice(-600); });
    const exited = new Promise(resolve => child.on('close', code => resolve(code)));
    child.on('error', e => { error = e.message; });
    timers.setTimeout(() => poll(), 400);
    const code = await exited;
    child = null;
    await poll();
    if (running) await finish(code === 0 ? null : (error.trim().replace(/^Error:\s*/, '').split('\n').at(-1) || `relay stopped (${code ?? 'signal'}).`));
    return state({ fresh: true });
  }
  // Stopping: the sync Fairy started (its whole group, rsync too), or the LaunchAgent's run of it (rsync first).
  async function stop() {
    if (child) { try { kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); } return { stopped: true }; }
    if (!running) return { stopped: false };
    let pids = [];
    try { pids = String((await execFile('/usr/bin/pgrep', ['-f', `${bin} sync`], { timeout: 5000 })).stdout).split('\n').map(Number).filter(Boolean); } catch {}
    for (const pid of pids) { try { await execFile('/usr/bin/pkill', ['-TERM', '-P', String(pid)], { timeout: 5000 }); } catch {} try { kill(pid, 'SIGTERM'); } catch {} }
    return { stopped: pids.length > 0 };
  }
  async function job(id, on) {
    const config = await readConfig();
    if (!config.jobs.some(j => j.id === id)) throw new Error('That isn’t one of relay’s repos.');
    let text = '';
    try { text = await readFile(paths.config); } catch { throw new Error('relay has no config yet; open it once in a terminal.'); }
    const next = setJobInConfig(text, String(id), on === true), temporary = `${paths.config}.fairy-${process.pid}`;
    await writeFile(temporary, next, { mode: 0o644 }); await rename(temporary, paths.config);
    status = null; diff = null;
    return state();
  }
  // The daily time, in steps the window offers; applied to the LaunchAgent at once when it's loaded.
  async function time(value) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? ''));
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error('Pick a time like 02:00.');
    const hhmm = `${m[1].padStart(2, '0')}:${m[2]}`;
    await relay(['config', '--set-time', hhmm]);
    const s = await readStatus({ fresh: true }).catch(() => null);
    if (s?.service?.loaded || s?.service?.plist_installed) await relay(['service', 'install'], { timeout: 30_000 });
    return state({ fresh: true });
  }
  // relay's own dashboard, in a terminal window on this Mac: a .command file opened as Finder would open it, so no
  // permission to drive Terminal is needed.
  async function tui() {
    const folder = join(home, 'Library', 'Application Support', 'Lyra', 'relay'), file = join(folder, 'relay.command');
    await mkdir(folder, { recursive: true });
    await writeFile(file, `#!/bin/zsh\nclear\nexec ${JSON.stringify(bin)}\n`, { mode: 0o755 }); await chmod(file, 0o755);
    await execFile('/usr/bin/open', [file], { timeout: 10_000 });
    return { opened: true };
  }
  async function service(action) {
    if (!SERVICE_ACTIONS.includes(action)) throw new Error('Install, uninstall or trigger.');
    await relay(['service', action], { timeout: 30_000 });
    return state({ fresh: true });
  }

  // The log, followed: new whole lines since last time; a log rotated (relay renames it past 2 MB) starts from its top.
  const poll = () => (polling ??= readLog().finally(() => { polling = null; }));
  async function readLog() {
    let size;
    try { size = (await stat(paths.log)).size; } catch { return; }
    if (offset < 0) { offset = size; await catchUp(); return; }
    if (size < offset) offset = 0;
    if (size === offset) return;
    const handle = await open(paths.log, 'r');
    try {
      const length = Math.min(size - offset, 256 * 1024), buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, offset);
      offset += length;
      const text = carry + buffer.toString('utf8'), lines = text.split('\n');
      carry = lines.pop() ?? '';
      for (const line of lines) await consume(parseLogLine(line));
    } finally { await handle.close(); }
  }
  // At start, a sync already under way (its start with no end in the log's last lines) is picked up.
  async function catchUp() {
    const lines = await logTail(60);
    let begun = -1;
    lines.forEach((line, i) => { const e = parseLogLine(line); if (e?.kind === 'start') begun = i; if (e && (e.kind === 'end' || e.kind === 'failed')) begun = -1; });
    if (begun >= 0 && now() - (parseLogLine(lines[begun]).at || 0) < 60 * 60_000) for (const line of lines.slice(begun)) await consume(parseLogLine(line));
  }
  async function consume(e) {
    if (!e) return;
    if (e.kind === 'start') {
      if (!running) running = { trigger: e.trigger, startedAt: e.at || now(), index: 0, total: e.total, current: null, files: 0, bytes: 0, expected: diff?.bytes ?? null, failed: [] };
      Object.assign(running, { trigger: e.trigger, total: e.total, mini: e.mini, free: e.free });
      emit({ type: 'start', running: { ...running } });
    } else if (e.kind === 'job' && running) {
      Object.assign(running, { index: e.index, total: e.total, current: e.id });
      emit({ type: 'progress', running: { ...running } });
    } else if (e.kind === 'synced' && running) {
      running.files += e.files; running.bytes += e.bytes;
      if (e.error) running.failed = [...running.failed, { id: e.id, error: e.error }];
      emit({ type: 'progress', running: { ...running } });
    } else if (e.kind === 'end' && running && !child) {
      await finish(e.ok ? null : (running.failed[0]?.error || 'A repo didn’t finish.'));
    } else if (e.kind === 'failed') {
      // Never began: the mini out of reach, or under the floor. Said once, whether or not Fairy started it.
      if (child) return;
      const was = running;
      running = null; status = null;
      emit({ type: 'done', trigger: was?.trigger || e.trigger || 'daily', record: null, problem: e.problem, floor: Boolean(e.floor) });
    }
  }
  async function finish(problem) {
    const was = running;
    running = null; status = null; diff = null;
    const [last] = await readHistory(1);
    const record = last && last.at >= (was?.startedAt || 0) - 5000 ? last : null;
    let free = null;
    try { const s = await readStatus({ fresh: true }); free = s.remote ? Number(s.remote.free_bytes) || null : null; } catch {}
    emit({ type: 'done', trigger: was?.trigger || 'manual', record, problem: record && !record.ok ? (record.note || record.jobs.find(j => !j.ok)?.error || problem || 'A repo didn’t finish.') : problem, free });
  }
  function emit(event) { try { onEvent({ ...event, host, name: macName(model) }); } catch {} }
  function follow() {
    if (timer) return;
    const tick = async () => { try { if (await isInstalled()) await poll(); } catch {} timer = timers.setTimeout(tick, running ? 1000 : pollMs); };
    void machine().then(tick);
  }

  return {
    paths, follow,
    stopFollowing() { if (timer) timers.clearTimeout(timer); timer = null; },
    // The window's one call: an action and its arguments, each checked.
    async call(action, ...args) {
      if (!ACTIONS.includes(action)) throw new Error('Relay can’t do that.');
      if (action === 'state') return state({ fresh: args[0] === true });
      if (!(await isInstalled())) throw new Error('relay isn’t installed on this Mac (~/.local/bin/relay).');
      if (action === 'diff') { await readDiff({ fresh: args[0] === true }); return state(); }
      if (action === 'sync') { const options = args[0] && typeof args[0] === 'object' ? args[0] : {}; return sync({ only: options.only ?? null }); }
      if (action === 'stop') return stop();
      if (action === 'job') return job(String(args[0] ?? ''), args[1] === true);
      if (action === 'time') return time(args[0]);
      if (action === 'service') return service(String(args[0] ?? ''));
      if (action === 'tui') return tui();
      return { lines: await logTail(Number(args[0]) || 40) };
    },
    summary,
    // The MacBook's summary, told by its window's Fairy; kept 30 minutes.
    report(value) {
      if (!value || typeof value !== 'object' || typeof value.host !== 'string') throw new Error('Not a relay summary.');
      const n = v => Number(v) || 0, str = (v, max) => String(v ?? '').slice(0, max);
      const job = j => ({ id: str(j?.id, 40), name: str(j?.name || j?.id, 60), files: n(j?.files), bytes: n(j?.bytes), ok: j?.ok !== false, enabled: j?.enabled !== false, source: str(j?.source, 200), dest: str(j?.dest, 200) });
      const r = value.running && typeof value.running === 'object' ? value.running : null, last = value.last && typeof value.last === 'object' ? value.last : null;
      peer = {
        host: str(value.host, 80), name: str(value.name || 'MacBook', 40), at: now(), installed: value.installed === true,
        mini: value.mini && typeof value.mini === 'object' ? { reachable: value.mini.reachable === true, name: str(value.mini.name || 'Mac mini', 60), route: str(value.mini.route, 80), free: n(value.mini.free), total: n(value.mini.total), problem: value.mini.problem ? str(value.mini.problem, 300) : null } : null,
        floor: n(value.floor) || 20e9, schedule: value.schedule && typeof value.schedule === 'object' ? { time: str(value.schedule.time, 5), next: n(value.schedule.next) } : null,
        service: { loaded: value.service?.loaded === true }, jobs: (Array.isArray(value.jobs) ? value.jobs : []).slice(0, 20).map(job),
        lastSyncAt: n(value.lastSyncAt), lastSuccessAt: n(value.lastSuccessAt), lastStatus: value.lastStatus ? str(value.lastStatus, 300) : null,
        last: last ? { at: n(last.at), ok: last.ok === true, files: n(last.files), bytes: n(last.bytes), ms: n(last.ms), trigger: str(last.trigger, 20) } : null,
        pending: value.pending && typeof value.pending === 'object' ? { at: n(value.pending.at), files: n(value.pending.files), bytes: n(value.pending.bytes), jobs: (Array.isArray(value.pending.jobs) ? value.pending.jobs : []).slice(0, 20).map(job) } : null,
        running: r ? { trigger: str(r.trigger, 20), index: n(r.index), total: n(r.total), current: r.current ? str(r.current, 40) : null, files: n(r.files), bytes: n(r.bytes), expected: r.expected == null ? null : n(r.expected) } : null,
      };
      return { ok: true };
    },
  };
}
