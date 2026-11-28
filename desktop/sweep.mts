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
import { execFile as execFileCb, spawn as spawnCb, type ExecFileOptions, type SpawnOptions } from 'node:child_process';
import { open, readFile as readFileCb, rename, stat as statCb, writeFile } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';

export const TIERS = Object.freeze(['safe', 'moderate', 'aggressive'] as const);
export const ACTIONS = Object.freeze(['state', 'scan', 'clean', 'stop', 'threshold', 'target', 'service', 'logs'] as const);
export const SERVICE_ACTIONS = Object.freeze(['install', 'uninstall', 'trigger'] as const);

export type SweepTier = (typeof TIERS)[number];
export type SweepAction = (typeof ACTIONS)[number];
export type SweepServiceAction = (typeof SERVICE_ACTIONS)[number];

export interface SweepConfig {
  targets: Record<string, boolean>;
  [key: string]: string | number | boolean | Record<string, boolean>;
}

export type SweepLogEvent =
  | { kind: 'start'; at: number | null; trigger: string; total: number }
  | { kind: 'auto'; at: number | null; dry: boolean; free: string; threshold: number; total: number }
  | { kind: 'target'; at: number | null; id: string; index: number; total: number }
  | { kind: 'cleaned'; at: number | null; id: string; bytes: number }
  | { kind: 'end'; at: number | null }
  | { kind: 'complete'; at: number | null };

export interface SweepHistoryTopTarget {
  id: string;
  name: string;
  bytes: number;
}

export interface SweepHistorySummary {
  at: number;
  trigger: string;
  freed: number;
  freeBefore: number;
  freeAfter: number;
  targets: number;
  items: number;
  ms: number;
  warnings: string[];
  top: SweepHistoryTopTarget[];
}

export interface SweepScanTarget {
  id: string;
  name: string;
  tier: string;
  enabled: boolean;
  bytes: number;
  items: number;
  denied: boolean;
  note: string;
  description: string;
}

export interface SweepRunningState {
  trigger: string;
  startedAt?: number;
  index: number;
  total: number;
  current: string | null;
  freed: number;
  reason?: string;
}

export interface SweepDiskInfo {
  free: number;
  total: number;
  used: number;
}

export interface SweepPeerSummary {
  host: string;
  name: string;
  at: number;
  disk: SweepDiskInfo;
  threshold: number;
  below: boolean;
  service: { loaded: boolean };
  lastSweepAt: number;
  lastFreed: number;
  ready: number | null;
  running: SweepRunningState | null;
}

export interface SweepState {
  host: string;
  name: string;
  model: string;
  at: number;
  disk: SweepDiskInfo;
  threshold: number;
  below: boolean;
  service: {
    loaded: boolean;
    installed: boolean;
    lastExit: number | null;
    pid: number | null;
  };
  lastCheckAt: number;
  lastSweepAt: number;
  lastFreed: number;
  totalFreed: number;
  autoSweeps: number;
  config: {
    interval: number;
    cooldown: number;
    emergency: number;
    notify: boolean;
  };
  history: SweepHistorySummary[];
  scan: { at: number; targets: SweepScanTarget[]; ready: number | null } | null;
  running: SweepRunningState | null;
  peer: SweepPeerSummary | null;
}

export interface SweepSummary {
  host: string;
  name: string;
  at: number;
  disk: SweepDiskInfo;
  threshold: number;
  below: boolean;
  service: SweepState['service'];
  lastSweepAt: number;
  lastFreed: number;
  ready: number | null;
  running: SweepRunningState | null;
}

export type SweepEvent =
  | { type: 'start'; running: SweepRunningState; host: string; name: string }
  | { type: 'progress'; running: SweepRunningState; host: string; name: string }
  | { type: 'done'; trigger: string; record: SweepHistorySummary | null; problem: string | null; host: string; name: string };

export interface SweepChildProcess {
  stderr?: { on(event: 'data', listener: (chunk: unknown) => void): unknown } | null;
  on(event: 'close', listener: (code: number | null) => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
  kill(signal?: NodeJS.Signals | number): unknown;
}

export interface SweepTimers<TTimer = ReturnType<typeof setTimeout>> {
  setTimeout: (fn: () => void, ms: number) => TTimer;
  clearTimeout: (id: TTimer) => void;
}

export interface SweepServiceOptions<TTimer = ReturnType<typeof setTimeout>> {
  home?: string;
  bin?: string;
  onEvent?: (event: SweepEvent) => void;
  now?: () => number;
  execFile?: (file: string, args: readonly string[], options?: ExecFileOptions) => Promise<{ stdout: string; stderr: string }>;
  spawn?: (file: string, args: readonly string[], options: SpawnOptions) => SweepChildProcess;
  readFile?: (path: string) => Promise<string>;
  stat?: (path: string) => Promise<{ size: number }>;
  timers?: SweepTimers<TTimer>;
  pollMs?: number;
}

interface RawSweepStatus {
  host?: string;
  disk?: { free_bytes?: unknown; total_bytes?: unknown; used_bytes?: unknown };
  threshold_gb?: unknown;
  below_threshold?: unknown;
  service?: { loaded?: unknown; plist_installed?: unknown; last_exit_code?: number | null; pid?: number | null };
  state?: {
    last_check_at?: string;
    last_cleanup_at?: string;
    last_cleanup_freed_bytes?: unknown;
    total_reclaimed_all_time_bytes?: unknown;
    total_auto_cleanups?: unknown;
  };
}

const ID = /^[a-z][a-z0-9_]{1,40}$/;
const STATUS_MS = 15_000, SCAN_MS = 10 * 60_000, PEER_STALE_MS = 30 * 60_000;

// A config.toml as sweep writes it: top-level `key = value` lines and a [targets] table of `id = true|false`.
export function parseConfig(text: string): SweepConfig {
  const out: SweepConfig = { targets: {} };
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
export function setTargetInConfig(text: string, id: string, on: boolean): string {
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
export function parseLogLine(line: string): SweepLogEvent | null {
  const m = /^\[([^\]]+)\]\s+(.*)$/.exec(String(line ?? '').trim());
  if (!m) return null;
  const at = Date.parse(m[1]) || null, text = m[2];
  let x: RegExpExecArray | null;
  if ((x = /^batch start: trigger=(\S+) targets=(\d+)/.exec(text))) return { kind: 'start', at, trigger: x[1], total: Number(x[2]) };
  if ((x = /^triggering (AUTO|DRY-RUN) full sweep: free (.+?) < threshold ([\d.]+) GB \((\d+) targets\)/.exec(text))) return { kind: 'auto', at, dry: x[1] === 'DRY-RUN', free: x[2], threshold: Number(x[3]), total: Number(x[4]) };
  if ((x = /^cleaning ([a-z0-9_]+) \((\d+)\/(\d+)\)/.exec(text))) return { kind: 'target', at, id: x[1], index: Number(x[2]), total: Number(x[3]) };
  if ((x = /^cleaned ([a-z0-9_]+): (\d+) bytes/.exec(text))) return { kind: 'cleaned', at, id: x[1], bytes: Number(x[2]) };
  if (/^batch end:/.test(text)) return { kind: 'end', at };
  if (/^sweep complete in/.test(text) || /^manual CLI sweep: reclaimed/.test(text)) return { kind: 'complete', at };
  return null;
}

// A history record, said briefly.
export function recordSummary(record: unknown): SweepHistorySummary | null {
  if (!record || typeof record !== 'object') return null;
  const rec = record as Record<string, unknown>;
  const freed = Math.max(Number(rec.actual_reclaimed_bytes) || 0, Number(rec.tracked_freed_bytes) || 0);
  const rawTargets = Array.isArray(rec.targets) ? rec.targets : [];
  return {
    at: Date.parse(String(rec.timestamp ?? '')) || 0, trigger: String(rec.trigger || ''), freed,
    freeBefore: Number(rec.free_before_bytes) || 0, freeAfter: Number(rec.free_after_bytes) || 0,
    targets: Array.isArray(rec.targets) ? rec.targets.length : 0, items: Number(rec.items_removed) || 0,
    ms: Number(rec.duration_ms) || 0, warnings: Array.isArray(rec.warnings) ? rec.warnings.map(String).slice(0, 6) : [],
    top: rawTargets.map(item => {
      const t = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      return { id: String(t.id), name: String(t.name || t.id), bytes: Number(t.bytes_freed) || 0 };
    }).filter(t => t.bytes > 0).sort((a, b) => b.bytes - a.bytes).slice(0, 5),
  };
}

// Which Mac this is, in words: from its model, as the window names them.
export const macName = (model: string): string =>
  (/^Mac\s?mini/i.test(model) ? 'Mac mini' : /^MacBook/i.test(model) ? 'MacBook' : /^iMac/i.test(model) ? 'iMac' : /^Mac/i.test(model) ? 'Mac' : 'This Mac');

export function sweepService<TTimer = ReturnType<typeof setTimeout>>({
  home = homedir(),
  bin = join(home, '.local', 'bin', 'sweep'),
  onEvent = () => {},
  now = () => Date.now(),
  execFile = (file, args, options) => new Promise((resolve, reject) =>
    execFileCb(file, args, { ...options, encoding: 'utf8' }, (error, stdout, stderr) =>
      (error ? reject(Object.assign(error, { stderr })) : resolve({ stdout, stderr })))),
  spawn = spawnCb,
  readFile = path => readFileCb(path, 'utf8'),
  stat = statCb,
  timers = globalThis as unknown as SweepTimers<TTimer>,
  pollMs = 3000,
}: SweepServiceOptions<TTimer> = {}) {
  const paths = {
    config: join(home, '.config', 'sweep', 'config.toml'), history: join(home, '.local', 'share', 'sweep', 'history.jsonl'),
    log: join(home, 'Library', 'Logs', 'sweep.log'),
  };
  const host = hostname().replace(/\.local$/, '');
  let model = '', status: RawSweepStatus | null = null, statusAt = 0, scan: SweepScanTarget[] | null = null, scanAt = 0;
  let scanning: Promise<SweepScanTarget[]> | null = null, running: SweepRunningState | null = null, child: SweepChildProcess | null = null, peer: SweepPeerSummary | null = null;
  let offset = -1, timer: TTimer | null = null, carry = '', polling: Promise<void> | null = null;

  const sweep = async (args: readonly string[], { timeout = 60_000 }: { timeout?: number } = {}): Promise<string> => {
    try {
      return (await execFile(bin, args, { timeout, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1' } })).stdout;
    } catch (error: unknown) {
      const errObj = error && typeof error === 'object' ? (error as { code?: unknown; stderr?: unknown; message?: unknown }) : null;
      if (errObj?.code === 'ENOENT') throw new Error('sweep isn’t installed on this Mac (~/.local/bin/sweep).');
      throw new Error(String(errObj?.stderr || errObj?.message || error).trim().split('\n').slice(-2).join(' ').slice(0, 300) || 'sweep didn’t answer.');
    }
  };
  async function machine(): Promise<string> {
    if (model) return model;
    // Apple silicon's model codes (Mac14,10) don't say which kind of Mac; System Profiler's name does.
    try {
      const parsed = JSON.parse((await execFile('/usr/sbin/system_profiler', ['-json', 'SPHardwareDataType'], { timeout: 15_000 })).stdout) as {
        SPHardwareDataType?: Array<{ machine_name?: unknown }>;
      };
      model = String(parsed.SPHardwareDataType?.[0]?.machine_name || '');
    } catch { model = ''; }
    return model;
  }
  async function readStatus({ fresh = false }: { fresh?: boolean } = {}): Promise<RawSweepStatus> {
    if (!fresh && status && now() - statusAt < STATUS_MS) return status;
    status = JSON.parse(await sweep(['status', '--json'], { timeout: 20_000 })) as RawSweepStatus;
    statusAt = now();
    return status;
  }
  async function readConfig(): Promise<SweepConfig> { try { return parseConfig(await readFile(paths.config)); } catch { return parseConfig(''); } }
  async function readHistory(limit = 20): Promise<SweepHistorySummary[]> {
    let text = '';
    try { text = await readFile(paths.history); } catch { return []; }
    return text.split('\n').filter(Boolean).slice(-limit).map(line => { try { return recordSummary(JSON.parse(line)); } catch { return null; } }).filter((entry): entry is SweepHistorySummary => entry !== null).reverse();
  }
  async function logTail(lines = 40): Promise<string[]> {
    try { return (await readFile(paths.log)).split('\n').filter(Boolean).slice(-Math.min(200, Math.max(1, lines))); } catch { return []; }
  }

  // The dry run: every target, what it would free, on or off. Kept 10 minutes; one at a time.
  async function readScan({ fresh = false }: { fresh?: boolean } = {}): Promise<SweepScanTarget[]> {
    if (!fresh && scan && now() - scanAt < SCAN_MS) return scan;
    scanning ??= (async () => {
      try {
        const targets = JSON.parse(await sweep(['scan', '--json'], { timeout: 180_000 })) as unknown;
        scan = (Array.isArray(targets) ? targets : []).map(item => {
          const t = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
          return {
            id: String(t.id), name: String(t.name || t.id), tier: String(t.tier || ''), enabled: t.enabled !== false, bytes: Number(t.bytes) || 0,
            items: Number(t.item_count) || 0, denied: Boolean(t.permission_denied), note: t.note ? String(t.note) : '', description: String(t.description || ''),
          };
        }).sort((a, b) => b.bytes - a.bytes);
        scanAt = now();
        return scan;
      } finally { scanning = null; }
    })();
    return scanning;
  }

  // What the window shows: this Mac's disk and its line, the watcher, the last sweep, the scan if one's been made,
  // and a sweep under way.
  async function state({ fresh = false }: { fresh?: boolean } = {}): Promise<SweepState> {
    const [s, config, history, name] = await Promise.all([readStatus({ fresh }), readConfig(), readHistory(), machine()]);
    const ready = scan ? scan.filter(t => t.enabled).reduce((sum, t) => sum + t.bytes, 0) : null;
    return {
      host: String(s.host || host), name: macName(name), model: name, at: now(),
      disk: { free: Number(s.disk?.free_bytes) || 0, total: Number(s.disk?.total_bytes) || 0, used: Number(s.disk?.used_bytes) || 0 },
      threshold: Number(s.threshold_gb ?? config.threshold_gb) || 50, below: Boolean(s.below_threshold),
      service: { loaded: Boolean(s.service?.loaded), installed: Boolean(s.service?.plist_installed), lastExit: s.service?.last_exit_code ?? null, pid: s.service?.pid ?? null },
      lastCheckAt: Date.parse(s.state?.last_check_at || '') || 0, lastSweepAt: Date.parse(s.state?.last_cleanup_at || '') || 0,
      lastFreed: Number(s.state?.last_cleanup_freed_bytes) || 0, totalFreed: Number(s.state?.total_reclaimed_all_time_bytes) || 0,
      autoSweeps: Number(s.state?.total_auto_cleanups) || 0,
      config: { interval: Number(config.check_interval_secs) || 300, cooldown: Number(config.cooldown_minutes) || 30, emergency: Number(config.emergency_drop_gb) || 5, notify: config.notify !== false },
      history, scan: scan ? { at: scanAt, targets: scan, ready } : null, running: running ? { ...running } : null,
      peer: peer && now() - peer.at < PEER_STALE_MS ? peer : null,
    };
  }
  // Briefly, for the other Mac's window.
  async function summary(): Promise<SweepSummary> {
    const s = await state();
    return { host: s.host, name: s.name, at: s.at, disk: s.disk, threshold: s.threshold, below: s.below, service: s.service, lastSweepAt: s.lastSweepAt, lastFreed: s.lastFreed, ready: s.scan?.ready ?? null, running: s.running };
  }

  // A sweep, by hand: the enabled targets, or those at or below a tier. One at a time; its progress comes from the log.
  async function clean({ tier = null, only = null }: { tier?: string | null; only?: unknown } = {}): Promise<SweepState> {
    if (running || child) throw new Error('A sweep is already running on this Mac.');
    const args = ['clean'];
    if (tier != null) { if (!(TIERS as readonly string[]).includes(tier)) throw new Error('Pick safe, moderate or aggressive.'); args.push('--tier', tier); }
    if (only != null) {
      const ids = (Array.isArray(only) ? only : []).map(String);
      if (!ids.length || ids.length > 40 || !ids.every(id => ID.test(id))) throw new Error('Those aren’t sweep’s targets.');
      args.push('--only', ids.join(','));
    }
    await state();
    running = { trigger: 'manual', startedAt: now(), index: 0, total: 0, current: null, freed: 0, reason: '' };
    emit({ type: 'start', running: { ...running } });
    const activeChild = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, NO_COLOR: '1' } });
    child = activeChild;
    let error = '';
    activeChild.stderr?.on('data', chunk => { error = (error + String(chunk)).slice(-600); });
    const exited = new Promise<number | null>(resolve => activeChild.on('close', code => resolve(code)));
    activeChild.on('error', e => { error = e.message; });
    timers.setTimeout(() => { void poll(); }, 400);
    const code = await exited;
    child = null;
    await poll();
    if (running) await finish(code === 0 ? null : (error.trim().split('\n').at(-1) || `sweep stopped (${code ?? 'signal'}).`));
    return state({ fresh: true });
  }
  // Stopping: the sweep Fairy started, or the watcher's own run of it.
  async function stop(): Promise<{ stopped: boolean }> {
    if (child) { child.kill('SIGTERM'); return { stopped: true }; }
    if (!running) return { stopped: false };
    try { await execFile('/usr/bin/pkill', ['-TERM', '-f', `${bin} check`], { timeout: 5000 }); } catch {}
    return { stopped: true };
  }
  async function threshold(gb: unknown): Promise<SweepState> {
    const value = Math.round(Number(gb) * 2) / 2;
    if (!Number.isFinite(value) || value < 5 || value > 1000) throw new Error('Pick a line between 5 and 1000 GB.');
    await sweep(['config', '--set-threshold', String(value)]);
    return state({ fresh: true });
  }
  async function target(id: string, on: boolean): Promise<SweepState> {
    if (!ID.test(String(id))) throw new Error('That isn’t one of sweep’s targets.');
    if (scan && !scan.some(t => t.id === id)) throw new Error('That isn’t one of sweep’s targets.');
    let text = '';
    try { text = await readFile(paths.config); } catch { throw new Error('sweep has no config yet; open it once in a terminal.'); }
    const next = setTargetInConfig(text, String(id), on === true), temporary = `${paths.config}.fairy-${process.pid}`;
    await writeFile(temporary, next, { mode: 0o644 }); await rename(temporary, paths.config);
    if (scan) scan = scan.map(t => (t.id === id ? { ...t, enabled: on === true } : t));
    return state();
  }
  async function service(action: string): Promise<SweepState> {
    if (!(SERVICE_ACTIONS as readonly string[]).includes(action)) throw new Error('Install, uninstall or trigger.');
    await sweep(['service', action], { timeout: 30_000 });
    return state({ fresh: true });
  }

  // The log, followed: new lines since last time, read whole lines only; a log rotated starts again from its top.
  // One read at a time, so two never take the same lines.
  const poll = (): Promise<void> => (polling ??= readLog().finally(() => { polling = null; }));
  async function readLog(): Promise<void> {
    let size: number;
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
  async function catchUp(): Promise<void> {
    const lines = await logTail(60);
    let openEvent: SweepLogEvent | null = null;
    for (const line of lines) {
      const e = parseLogLine(line);
      if (!e) continue;
      if (e.kind === 'start' || e.kind === 'auto') openEvent = e;
      if (e.kind === 'end' || e.kind === 'complete') openEvent = null;
    }
    const opened = openEvent;
    if (opened && now() - (opened.at || 0) < 30 * 60_000) {
      for (const line of lines.slice(lines.findIndex(l => parseLogLine(l)?.at === opened.at))) {
        await consume(parseLogLine(line));
      }
    }
  }
  async function consume(e: SweepLogEvent | null): Promise<void> {
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
  async function finish(problem: string | null): Promise<void> {
    const was = running;
    running = null; status = null; scan = null;
    const [last] = await readHistory(1);
    const record = last && last.at >= (was?.startedAt || 0) - 5000 ? last : null;
    emit({ type: 'done', trigger: was?.trigger || 'manual', record, problem });
  }
  function emit(
    event:
      | { type: 'start'; running: SweepRunningState }
      | { type: 'progress'; running: SweepRunningState }
      | { type: 'done'; trigger: string; record: SweepHistorySummary | null; problem: string | null },
  ): void {
    try { onEvent({ ...event, host, name: macName(model) }); } catch {}
  }
  function follow(): void {
    if (timer) return;
    const tick = async (): Promise<void> => { try { await poll(); } catch {} timer = timers.setTimeout(() => { void tick(); }, running ? 1000 : pollMs); };
    void machine().then(tick);
  }

  return {
    paths, follow,
    stopFollowing(): void { if (timer) timers.clearTimeout(timer); timer = null; },
    // The window's one call: an action and its arguments, each checked.
    async call(action: string, ...args: unknown[]): Promise<unknown> {
      if (!(ACTIONS as readonly string[]).includes(action)) throw new Error('Sweep can’t do that.');
      if (action === 'state') return state({ fresh: args[0] === true });
      if (action === 'scan') { await readScan({ fresh: args[0] === true }); return state(); }
      if (action === 'clean') {
        const options = (args[0] && typeof args[0] === 'object' ? args[0] : {}) as { tier?: string | null; only?: unknown };
        return clean({ tier: options.tier ?? null, only: options.only ?? null });
      }
      if (action === 'stop') return stop();
      if (action === 'threshold') return threshold(args[0]);
      if (action === 'target') return target(String(args[0] ?? ''), args[1] === true);
      if (action === 'service') return service(String(args[0] ?? ''));
      return { lines: await logTail(Number(args[0]) || 40) };
    },
    summary,
    // The other Mac's summary, told by its window's Fairy; kept 30 minutes.
    report(value: unknown): { ok: true } {
      if (!value || typeof value !== 'object' || typeof (value as Record<string, unknown>).host !== 'string') throw new Error('Not a sweep summary.');
      const pick = ({ host: h, name, disk, threshold: t, below, service: sv, lastSweepAt, lastFreed, ready, running: r }: Record<string, unknown>): SweepPeerSummary => {
        const d = (disk && typeof disk === 'object' ? disk : {}) as Record<string, unknown>;
        const s = (sv && typeof sv === 'object' ? sv : {}) as Record<string, unknown>;
        const run = r && typeof r === 'object' ? (r as Record<string, unknown>) : null;
        return {
          host: String(h).slice(0, 80), name: String(name || 'Mac').slice(0, 40), at: now(),
          disk: { free: Number(d.free) || 0, total: Number(d.total) || 0, used: Number(d.used) || 0 },
          threshold: Number(t) || 50, below: Boolean(below), service: { loaded: Boolean(s.loaded) },
          lastSweepAt: Number(lastSweepAt) || 0, lastFreed: Number(lastFreed) || 0, ready: ready == null ? null : Number(ready) || 0,
          running: run ? { trigger: String(run.trigger || ''), index: Number(run.index) || 0, total: Number(run.total) || 0, current: run.current ? String(run.current) : null, freed: Number(run.freed) || 0 } : null,
        };
      };
      peer = pick(value as Record<string, unknown>);
      return { ok: true };
    },
  };
}
