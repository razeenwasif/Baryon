// Sweep in Fairy: the user's own disk cleaner (~/Github/TUI-Applications/sweep, a Rust CLI with a TUI, run every 5
// minutes by its LaunchAgent), read and run from Fairy's window. Fairy never cleans anything herself: she asks the
// `sweep` binary, as its TUI does. What she reads: `sweep status --json`, `sweep scan --json` (a dry run, read only),
// its config (~/.config/sweep/config.toml), its history (~/.local/share/sweep/history.jsonl) and its log
// (~/Library/Logs/sweep.log), which she follows to see a sweep start on its own, go target by target, and end.
// What she runs, only when you ask in the window: `sweep clean` (enabled targets, or a tier), stopping it, the
// auto-clean line (`sweep config --set-threshold`), a target on or off (its line in the config's [targets]), and
// `sweep service install|uninstall|trigger`.
//
// Each Mac answers for its own disk. The window asks its own Mac through the local `sweep` call; a window on the
// MacBook asks the Mac Fairy lives on through `sweep-mini`, and tells it its own summary (`sweep-peer-report`) so that
// Mac's window can show both.
import { execFile as execFileCb, spawn as spawnCb } from 'node:child_process';
import { open, readFile as readFileCb, rename, stat as statCb, writeFile } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';

export const TIERS = Object.freeze(['safe', 'moderate', 'aggressive']);
export const ACTIONS = Object.freeze(['state', 'scan', 'clean', 'stop', 'threshold', 'target', 'service', 'logs']);
export const SERVICE_ACTIONS = Object.freeze(['install', 'uninstall', 'trigger']);
const ID = /^[a-z][a-z0-9_]{1,40}$/;
const STATUS_MS = 15_000, SCAN_MS = 10 * 60_000, PEER_STALE_MS = 30 * 60_000;

// A config.toml as sweep writes it: top-level `key = value` lines and a [targets] table of `id = true|false`.
export function parseConfig(text) {
  const out = { targets: {} };
  let section = '';
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const head = /^\[([A-Za-z0-9_.-]+)\]$/.exec(line);
    if (head) { section = head[1]; continue; }
    const pair = /^([A-Za-z0-9_]+)\s*=\s*(.+)$/.exec(line);
    if (!pair) continue;
    const value = pair[2].trim();
    const parsed = value === 'true' ? true : value === 'false' ? false : /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value.replace(/^"(.*)"$/, '$1');
    if (section === 'targets') out.targets[pair[1]] = parsed === true;
    else if (!section) out[pair[1]] = parsed;
  }
  return out;
}

// The config with one target turned on or off: its line in [targets] changed, or added at the end of that table.
export function setTargetInConfig(text, id, on) {
  if (!ID.test(id)) throw new Error('That isn’t one of sweep’s targets.');
  const lines = String(text ?? '').split('\n');
  let start = lines.findIndex(line => line.trim() === '[targets]');
  if (start < 0) { lines.push('', '[targets]'); start = lines.length - 1; }
  let end = lines.findIndex((line, i) => i > start && /^\s*\[/.test(line));
  if (end < 0) end = lines.length;
  const at = lines.findIndex((line, i) => i > start && i < end && new RegExp(`^\\s*${id}\\s*=`).test(line));
  const line = `${id} = ${on ? 'true' : 'false'}`;
  if (at >= 0) lines[at] = line;
  else { let last = end; while (last - 1 > start && !lines[last - 1].trim()) last -= 1; lines.splice(last, 0, line); }
  return lines.join('\n');
}

// One line of sweep.log, as an event: a sweep starting (on its own or by hand), a target starting or done, the end.
// `[2026-11-19T02:23:29Z] cleaning cargo_cache (7/18)`. Anything else is null.
export function parseLogLine(line) {
  const m = /^\[([^\]]+)\]\s+(.*)$/.exec(String(line ?? '').trim());
  if (!m) return null;
  const at = Date.parse(m[1]) || null, text = m[2];
  let x;
  if ((x = /^batch start: trigger=(\S+) targets=(\d+)/.exec(text))) return { kind: 'start', at, trigger: x[1], total: Number(x[2]) };
  if ((x = /^triggering (AUTO|DRY-RUN) full sweep: free (.+?) < threshold ([\d.]+) GB \((\d+) targets\)/.exec(text))) return { kind: 'auto', at, dry: x[1] === 'DRY-RUN', free: x[2], threshold: Number(x[3]), total: Number(x[4]) };
  if ((x = /^cleaning ([a-z0-9_]+) \((\d+)\/(\d+)\)/.exec(text))) return { kind: 'target', at, id: x[1], index: Number(x[2]), total: Number(x[3]) };
  if ((x = /^cleaned ([a-z0-9_]+): (\d+) bytes/.exec(text))) return { kind: 'cleaned', at, id: x[1], bytes: Number(x[2]) };
  if (/^batch end:/.test(text)) return { kind: 'end', at };
  if (/^sweep complete in/.test(text) || /^manual CLI sweep: reclaimed/.test(text)) return { kind: 'complete', at };
  return null;
}

// A history record, said briefly.
export function recordSummary(record) {
  if (!record || typeof record !== 'object') return null;
  const freed = Math.max(Number(record.actual_reclaimed_bytes) || 0, Number(record.tracked_freed_bytes) || 0);
  return {
    at: Date.parse(record.timestamp) || 0, trigger: String(record.trigger || ''), freed,
    freeBefore: Number(record.free_before_bytes) || 0, freeAfter: Number(record.free_after_bytes) || 0,
    targets: Array.isArray(record.targets) ? record.targets.length : 0, items: Number(record.items_removed) || 0,
    ms: Number(record.duration_ms) || 0, warnings: Array.isArray(record.warnings) ? record.warnings.map(String).slice(0, 6) : [],
    top: (Array.isArray(record.targets) ? record.targets : []).map(t => ({ id: String(t.id), name: String(t.name || t.id), bytes: Number(t.bytes_freed) || 0 })).filter(t => t.bytes > 0).sort((a, b) => b.bytes - a.bytes).slice(0, 5),
  };
}

// Which Mac this is, in words: from its model, as the window names them.
export const macName = model => (/^Mac\s?mini/i.test(model) ? 'Mac mini' : /^MacBook/i.test(model) ? 'MacBook' : /^iMac/i.test(model) ? 'iMac' : /^Mac/i.test(model) ? 'Mac' : 'This Mac');

export function sweepService({
  home = homedir(), bin = join(home, '.local', 'bin', 'sweep'), onEvent = () => {}, now = () => Date.now(),
  execFile = (file, args, options) => new Promise((resolve, reject) => execFileCb(file, args, options, (error, stdout, stderr) => (error ? reject(Object.assign(error, { stderr })) : resolve({ stdout, stderr })))),
  spawn = spawnCb, readFile = path => readFileCb(path, 'utf8'), stat = statCb, timers = globalThis, pollMs = 3000,
} = {}) {
  const paths = {
    config: join(home, '.config', 'sweep', 'config.toml'), history: join(home, '.local', 'share', 'sweep', 'history.jsonl'),
    log: join(home, 'Library', 'Logs', 'sweep.log'),
  };
  const host = hostname().replace(/\.local$/, '');
  let model = '', status = null, statusAt = 0, scan = null, scanAt = 0, scanning = null, running = null, child = null, peer = null;
  let offset = -1, timer = null, carry = '', polling = null;

  const sweep = async (args, { timeout = 60_000 } = {}) => {
    try { return (await execFile(bin, args, { timeout, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1' } })).stdout; }
    catch (error) {
      if (error?.code === 'ENOENT') throw new Error('sweep isn’t installed on this Mac (~/.local/bin/sweep).');
      throw new Error(String(error?.stderr || error?.message || error).trim().split('\n').slice(-2).join(' ').slice(0, 300) || 'sweep didn’t answer.');
    }
  };
  async function machine() {
    if (model) return model;
    // Apple silicon's model codes (Mac14,10) don't say which kind of Mac; System Profiler's name does.
    try { model = String(JSON.parse((await execFile('/usr/sbin/system_profiler', ['-json', 'SPHardwareDataType'], { timeout: 15_000 })).stdout).SPHardwareDataType?.[0]?.machine_name || ''); } catch { model = ''; }
    return model;
  }
  async function readStatus({ fresh = false } = {}) {
    if (!fresh && status && now() - statusAt < STATUS_MS) return status;
    status = JSON.parse(await sweep(['status', '--json'], { timeout: 20_000 }));
    statusAt = now();
    return status;
  }
  async function readConfig() { try { return parseConfig(await readFile(paths.config)); } catch { return parseConfig(''); } }
  async function readHistory(limit = 20) {
    let text = '';
    try { text = await readFile(paths.history); } catch { return []; }
    return text.split('\n').filter(Boolean).slice(-limit).map(line => { try { return recordSummary(JSON.parse(line)); } catch { return null; } }).filter(Boolean).reverse();
  }
  async function logTail(lines = 40) {
    try { return (await readFile(paths.log)).split('\n').filter(Boolean).slice(-Math.min(200, Math.max(1, lines))); } catch { return []; }
  }

  // The dry run: every target, what it would free, on or off. Kept 10 minutes; one at a time.
  async function readScan({ fresh = false } = {}) {
    if (!fresh && scan && now() - scanAt < SCAN_MS) return scan;
    scanning ??= (async () => {
      try {
        const targets = JSON.parse(await sweep(['scan', '--json'], { timeout: 180_000 }));
        scan = (Array.isArray(targets) ? targets : []).map(t => ({
          id: String(t.id), name: String(t.name || t.id), tier: String(t.tier || ''), enabled: t.enabled !== false, bytes: Number(t.bytes) || 0,
          items: Number(t.item_count) || 0, denied: Boolean(t.permission_denied), note: t.note ? String(t.note) : '', description: String(t.description || ''),
        })).sort((a, b) => b.bytes - a.bytes);
        scanAt = now();
        return scan;
      } finally { scanning = null; }
    })();
    return scanning;
  }

  // What the window shows: this Mac's disk and its line, the watcher, the last sweep, the scan if one's been made,
  // and a sweep under way.
  async function state({ fresh = false } = {}) {
    const [s, config, history, name] = await Promise.all([readStatus({ fresh }), readConfig(), readHistory(), machine()]);
    const ready = scan ? scan.filter(t => t.enabled).reduce((sum, t) => sum + t.bytes, 0) : null;
    return {
      host: String(s.host || host), name: macName(name), model: name, at: now(),
      disk: { free: Number(s.disk?.free_bytes) || 0, total: Number(s.disk?.total_bytes) || 0, used: Number(s.disk?.used_bytes) || 0 },
      threshold: Number(s.threshold_gb ?? config.threshold_gb) || 50, below: Boolean(s.below_threshold),
      service: { loaded: Boolean(s.service?.loaded), installed: Boolean(s.service?.plist_installed), lastExit: s.service?.last_exit_code ?? null, pid: s.service?.pid ?? null },
      lastCheckAt: Date.parse(s.state?.last_check_at) || 0, lastSweepAt: Date.parse(s.state?.last_cleanup_at) || 0,
      lastFreed: Number(s.state?.last_cleanup_freed_bytes) || 0, totalFreed: Number(s.state?.total_reclaimed_all_time_bytes) || 0,
      autoSweeps: Number(s.state?.total_auto_cleanups) || 0,
      config: { interval: Number(config.check_interval_secs) || 300, cooldown: Number(config.cooldown_minutes) || 30, emergency: Number(config.emergency_drop_gb) || 5, notify: config.notify !== false },
      history, scan: scan ? { at: scanAt, targets: scan, ready } : null, running: running ? { ...running } : null,
      peer: peer && now() - peer.at < PEER_STALE_MS ? peer : null,
    };
  }
  // Briefly, for the other Mac's window.
  async function summary() {
    const s = await state();
    return { host: s.host, name: s.name, at: s.at, disk: s.disk, threshold: s.threshold, below: s.below, service: s.service, lastSweepAt: s.lastSweepAt, lastFreed: s.lastFreed, ready: s.scan?.ready ?? null, running: s.running };
  }

  // A sweep, by hand: the enabled targets, or those at or below a tier. One at a time; its progress comes from the log.
  async function clean({ tier = null, only = null } = {}) {
    if (running || child) throw new Error('A sweep is already running on this Mac.');
    const args = ['clean'];
    if (tier != null) { if (!TIERS.includes(tier)) throw new Error('Pick safe, moderate or aggressive.'); args.push('--tier', tier); }
    if (only != null) {
      const ids = (Array.isArray(only) ? only : []).map(String);
      if (!ids.length || ids.length > 40 || !ids.every(id => ID.test(id))) throw new Error('Those aren’t sweep’s targets.');
      args.push('--only', ids.join(','));
    }
    await state();
    running = { trigger: 'manual', startedAt: now(), index: 0, total: 0, current: null, freed: 0, reason: '' };
    emit({ type: 'start', running: { ...running } });
    child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, NO_COLOR: '1' } });
    let error = '';
    child.stderr?.on('data', chunk => { error = (error + chunk).slice(-600); });
    const exited = new Promise(resolve => child.on('close', code => resolve(code)));
    child.on('error', e => { error = e.message; });
    timers.setTimeout(() => poll(), 400);
    const code = await exited;
    child = null;
    await poll();
    if (running) await finish(code === 0 ? null : (error.trim().split('\n').at(-1) || `sweep stopped (${code ?? 'signal'}).`));
    return state({ fresh: true });
  }
  // Stopping: the sweep Fairy started, or the watcher's own run of it.
  async function stop() {
    if (child) { child.kill('SIGTERM'); return { stopped: true }; }
    if (!running) return { stopped: false };
    try { await execFile('/usr/bin/pkill', ['-TERM', '-f', `${bin} check`], { timeout: 5000 }); } catch {}
    return { stopped: true };
  }
  async function threshold(gb) {
    const value = Math.round(Number(gb) * 2) / 2;
    if (!Number.isFinite(value) || value < 5 || value > 1000) throw new Error('Pick a line between 5 and 1000 GB.');
    await sweep(['config', '--set-threshold', String(value)]);
    return state({ fresh: true });
  }
  async function target(id, on) {
    if (!ID.test(String(id))) throw new Error('That isn’t one of sweep’s targets.');
    if (scan && !scan.some(t => t.id === id)) throw new Error('That isn’t one of sweep’s targets.');
    let text = '';
    try { text = await readFile(paths.config); } catch { throw new Error('sweep has no config yet; open it once in a terminal.'); }
    const next = setTargetInConfig(text, String(id), on === true), temporary = `${paths.config}.fairy-${process.pid}`;
    await writeFile(temporary, next, { mode: 0o644 }); await rename(temporary, paths.config);
    if (scan) scan = scan.map(t => (t.id === id ? { ...t, enabled: on === true } : t));
    return state();
  }
  async function service(action) {
    if (!SERVICE_ACTIONS.includes(action)) throw new Error('Install, uninstall or trigger.');
    await sweep(['service', action], { timeout: 30_000 });
    return state({ fresh: true });
  }

  // The log, followed: new lines since last time, read whole lines only; a log rotated starts again from its top.
  // One read at a time, so two never take the same lines.
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
  // At start, a sweep already under way (its start with no end in the log's last lines) is picked up.
  async function catchUp() {
    const lines = await logTail(60);
    let open = null;
    for (const line of lines) {
      const e = parseLogLine(line);
      if (!e) continue;
      if (e.kind === 'start' || e.kind === 'auto') open = e;
      if (e.kind === 'end' || e.kind === 'complete') open = null;
    }
    if (open && now() - (open.at || 0) < 30 * 60_000) for (const line of lines.slice(lines.findIndex(l => parseLogLine(l)?.at === open.at))) await consume(parseLogLine(line));
  }
  async function consume(e) {
    if (!e) return;
    if (e.kind === 'auto' && !e.dry) {
      running ??= { trigger: 'auto', startedAt: e.at || now(), index: 0, total: e.total, current: null, freed: 0, reason: '' };
      running.reason = `Free space fell to ${e.free}, under your ${e.threshold} GB line.`;
      running.total = e.total;
      emit({ type: 'start', running: { ...running } });
    } else if (e.kind === 'start') {
      if (!running) { running = { trigger: e.trigger, startedAt: e.at || now(), index: 0, total: e.total, current: null, freed: 0, reason: '' }; emit({ type: 'start', running: { ...running } }); }
      else running.total = e.total;
    } else if (e.kind === 'target' && running) {
      Object.assign(running, { index: e.index, total: e.total, current: e.id });
      emit({ type: 'progress', running: { ...running } });
    } else if (e.kind === 'cleaned' && running) {
      running.freed += e.bytes;
      emit({ type: 'progress', running: { ...running } });
    } else if ((e.kind === 'end' || e.kind === 'complete') && running && !child) {
      await finish(null);
    }
  }
  async function finish(problem) {
    const was = running;
    running = null; status = null; scan = null;
    const [last] = await readHistory(1);
    const record = last && last.at >= (was?.startedAt || 0) - 5000 ? last : null;
    emit({ type: 'done', trigger: was?.trigger || 'manual', record, problem });
  }
  function emit(event) { try { onEvent({ ...event, host, name: macName(model) }); } catch {} }
  function follow() {
    if (timer) return;
    const tick = async () => { try { await poll(); } catch {} timer = timers.setTimeout(tick, running ? 1000 : pollMs); };
    void machine().then(tick);
  }

  return {
    paths, follow,
    stopFollowing() { if (timer) timers.clearTimeout(timer); timer = null; },
    // The window's one call: an action and its arguments, each checked.
    async call(action, ...args) {
      if (!ACTIONS.includes(action)) throw new Error('Sweep can’t do that.');
      if (action === 'state') return state({ fresh: args[0] === true });
      if (action === 'scan') { await readScan({ fresh: args[0] === true }); return state(); }
      if (action === 'clean') { const options = args[0] && typeof args[0] === 'object' ? args[0] : {}; return clean({ tier: options.tier ?? null, only: options.only ?? null }); }
      if (action === 'stop') return stop();
      if (action === 'threshold') return threshold(args[0]);
      if (action === 'target') return target(String(args[0] ?? ''), args[1] === true);
      if (action === 'service') return service(String(args[0] ?? ''));
      return { lines: await logTail(Number(args[0]) || 40) };
    },
    summary,
    // The other Mac's summary, told by its window's Fairy; kept 30 minutes.
    report(value) {
      if (!value || typeof value !== 'object' || typeof value.host !== 'string') throw new Error('Not a sweep summary.');
      const pick = ({ host: h, name, disk, threshold: t, below, service: sv, lastSweepAt, lastFreed, ready, running: r }) => ({
        host: String(h).slice(0, 80), name: String(name || 'Mac').slice(0, 40), at: now(),
        disk: { free: Number(disk?.free) || 0, total: Number(disk?.total) || 0, used: Number(disk?.used) || 0 },
        threshold: Number(t) || 50, below: Boolean(below), service: { loaded: Boolean(sv?.loaded) },
        lastSweepAt: Number(lastSweepAt) || 0, lastFreed: Number(lastFreed) || 0, ready: ready == null ? null : Number(ready) || 0,
        running: r && typeof r === 'object' ? { trigger: String(r.trigger || ''), index: Number(r.index) || 0, total: Number(r.total) || 0, current: r.current ? String(r.current) : null, freed: Number(r.freed) || 0 } : null,
      });
      peer = pick(value);
      return { ok: true };
    },
  };
}
