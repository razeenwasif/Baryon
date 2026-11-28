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
import { execFile as execFileCb, spawn as spawnCb, type ChildProcess, type ExecFileOptions, type SpawnOptions } from 'node:child_process';
import type { Stats } from 'node:fs';
import { chmod, mkdir, open, readFile as readFileCb, rename, stat as statCb, writeFile } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { macName } from './sweep.mjs';

export const ACTIONS = Object.freeze(['state', 'diff', 'sync', 'stop', 'job', 'time', 'service', 'logs', 'tui'] as const);
export const SERVICE_ACTIONS = Object.freeze(['install', 'uninstall', 'trigger'] as const);
const ID = /^[a-z0-9][a-z0-9_-]{0,40}$/;
const STATUS_MS = 60_000, DIFF_MS = 10 * 60_000, PEER_STALE_MS = 30 * 60_000, PATHS_SHOWN = 40;

export type RelayAction = (typeof ACTIONS)[number];
export type RelayServiceAction = (typeof SERVICE_ACTIONS)[number];

export type RelayTomlValue = string | number | boolean | string[];

export interface RelayConfigJob {
  id?: string;
  name?: string;
  source?: string;
  dest?: string;
  enabled: boolean;
  [key: string]: RelayTomlValue | undefined;
}

export interface RelayConfig {
  remote: Record<string, RelayTomlValue>;
  schedule: Record<string, RelayTomlValue>;
  sync: Record<string, RelayTomlValue>;
  jobs: RelayConfigJob[];
}

export type RelayLogEvent =
  | { kind: 'start'; at: number | null; trigger: string; mini: string; free: number; total: number }
  | { kind: 'job'; at: number | null; id: string; index: number; total: number }
  | { kind: 'synced'; at: number | null; id: string; files: number; bytes: number; error: string | null }
  | { kind: 'end'; at: number | null; ok: boolean; trigger: string }
  | { kind: 'failed'; at: number | null; trigger: string; problem: string; floor?: boolean };

export interface RelayRecordJobSummary {
  id: string;
  name: string;
  ok: boolean;
  files: number;
  bytes: number;
  error: string | null;
}

export interface RelayRecordSummary {
  at: number;
  trigger: string;
  ok: boolean;
  files: number;
  bytes: number;
  ms: number;
  route: string | null;
  note: string | null;
  jobs: RelayRecordJobSummary[];
}

export interface RelayDiffJobSummary {
  id: string;
  name: string;
  ok: boolean;
  error: string | null;
  files: number;
  totalFiles: number;
  bytes: number;
  paths: string[];
  listed: number;
}

export interface RelayDiffSummary {
  jobs: RelayDiffJobSummary[];
  files: number;
  bytes: number;
  problem: string | null;
}

export interface RelayRunningState {
  trigger: string;
  startedAt: number;
  index: number;
  total: number;
  current: string | null;
  files: number;
  bytes: number;
  expected: number | null;
  failed: Array<{ id: string; error: string }>;
  mini?: string;
  free?: number;
}

export interface RelayPeerJob {
  id: string;
  name: string;
  files: number;
  bytes: number;
  ok: boolean;
  enabled: boolean;
  source: string;
  dest: string;
}

export interface RelayPeerSummary {
  host: string;
  name: string;
  at: number;
  installed: boolean;
  mini: {
    reachable: boolean;
    name: string;
    route: string;
    free: number;
    total: number;
    problem: string | null;
  } | null;
  floor: number;
  schedule: { time: string; next: number } | null;
  service: { loaded: boolean };
  jobs: RelayPeerJob[];
  lastSyncAt: number;
  lastSuccessAt: number;
  lastStatus: string | null;
  last: { at: number; ok: boolean; files: number; bytes: number; ms: number; trigger: string } | null;
  pending: { at: number; files: number; bytes: number; jobs: RelayPeerJob[] } | null;
  running: {
    trigger: string;
    index: number;
    total: number;
    current: string | null;
    files: number;
    bytes: number;
    expected: number | null;
  } | null;
}

export interface RelayServiceOptions {
  home?: string;
  bin?: string;
  onEvent?: (event: Record<string, unknown>) => void;
  now?: () => number;
  execFile?: (file: string, args: readonly string[], options?: ExecFileOptions) => Promise<{ stdout: string; stderr: string }>;
  spawn?: (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
  readFile?: (path: string) => Promise<string>;
  stat?: (path: string) => Promise<Pick<Stats, 'isFile' | 'size'>>;
  timers?: Pick<typeof globalThis, 'setTimeout' | 'clearTimeout'>;
  pollMs?: number;
  kill?: (pid: number, signal?: NodeJS.Signals | number) => boolean;
}

interface RawRelayStatus {
  local_host?: string;
  remote?: {
    remote_hostname?: string;
    host?: string;
    user?: string;
    free_bytes?: number;
    total_bytes?: number;
  } | null;
  remote_error?: string;
  schedule_time?: string;
  service?: {
    loaded?: boolean;
    plist_installed?: boolean;
    last_exit_code?: number | null;
    pid?: number | null;
    label?: string;
  };
  jobs?: Array<{ id?: unknown; name?: unknown; source?: unknown; dest?: unknown; enabled?: boolean }>;
  state?: {
    last_remote_free_bytes?: number;
    last_sync_at?: string;
    last_success_at?: string;
    last_status?: string;
    total_sync_runs?: number;
    total_files_transferred_all_time?: number;
    total_bytes_transferred_all_time?: number;
  };
}

// relay's config.toml as it writes it (toml's pretty printer): the tables it needs here, and each [[jobs]] entry.
export function parseConfig(text: string): RelayConfig {
  const out: RelayConfig = { remote: {}, schedule: {}, sync: {}, jobs: [] };
  let section: string | null = null, job: Record<string, RelayTomlValue> | null = null, list: string[] | null = null;
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.replace(/^\s*#.*$/, '').trim();
    if (!line) continue;
    if (list) { // a multi-line array: its strings, until the ]
      for (const m of line.matchAll(/"((?:[^"\\]|\\.)*)"/g)) list.push(m[1]);
      if (line.includes(']')) list = null;
      continue;
    }
    if (line === '[[jobs]]') { job = {}; out.jobs.push(job as RelayConfigJob); section = 'job'; continue; }
    const head = /^\[([A-Za-z0-9_.-]+)\]$/.exec(line);
    if (head) { section = head[1]; job = null; continue; }
    const pair = /^([A-Za-z0-9_]+)\s*=\s*(.+)$/.exec(line);
    if (!pair) continue;
    const into = section === 'job'
      ? job
      : section && (section === 'remote' || section === 'schedule' || section === 'sync')
        ? out[section]
        : null;
    if (!into) continue;
    const value = pair[2].trim();
    if (value.startsWith('[')) {
      const items = [...value.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(m => m[1]);
      into[pair[1]] = items;
      if (!value.includes(']')) list = items;
      continue;
    }
    into[pair[1]] = value === 'true' ? true : value === 'false' ? false : /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value.replace(/^"(.*)"$/, '$1');
  }
  for (const j of out.jobs) j.enabled = j.enabled !== false;
  return out;
}

// The config with one repo turned on or off: the `enabled` line of its [[jobs]] entry changed, or added to it.
export function setJobInConfig(text: string, id: string, on: boolean): string {
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
export function parseLogLine(line: string): RelayLogEvent | null {
  const m = /^\[([^\]]+)\]\s+(.*)$/.exec(String(line ?? '').trim());
  if (!m) return null;
  const at = Date.parse(m[1]) || null, text = m[2];
  let x: RegExpExecArray | null;
  if ((x = /^starting (\S+) sync -> \S+ \((.+?), ([\d.]+) GB free\) across (\d+) job/.exec(text))) return { kind: 'start', at, trigger: x[1], mini: x[2], free: Math.round(Number(x[3]) * 1e9), total: Number(x[4]) };
  if ((x = /^syncing ([A-Za-z0-9_-]+) \((\d+)\/(\d+)\)/.exec(text))) return { kind: 'job', at, id: x[1], index: Number(x[2]), total: Number(x[3]) };
  if ((x = /^synced ([A-Za-z0-9_-]+): (\d+) file\(s\), (\d+) bytes(?: FAILED: (.*))?$/.exec(text))) return { kind: 'synced', at, id: x[1], files: Number(x[2]), bytes: Number(x[3]), error: x[4] || null };
  if ((x = /^sync (OK|FAILED) \((\S+)\) in /.exec(text))) return { kind: 'end', at, ok: x[1] === 'OK', trigger: x[2] };
  if ((x = /^sync FAILED \((\S+)\): (.*)$/.exec(text))) return { kind: 'failed', at, trigger: x[1], problem: x[2] };
  if ((x = /^Aborted sync: (.*)$/.exec(text))) return { kind: 'failed', at, trigger: '', problem: x[1], floor: true };
  return null;
}

// A history record (a SyncRunRecord), said briefly.
export function recordSummary(record: unknown): RelayRecordSummary | null {
  if (!record || typeof record !== 'object') return null;
  const r = record as Record<string, unknown>;
  if (r.dry_run) return null;
  const jobs = Array.isArray(r.jobs) ? (r.jobs as Array<Record<string, unknown>>) : [];
  return {
    at: Date.parse(String(r.timestamp ?? '')) || 0, trigger: String(r.trigger || ''), ok: r.success === true,
    files: Number(r.total_files_transferred) || 0, bytes: Number(r.total_bytes_transferred) || 0, ms: Number(r.duration_ms) || 0,
    route: r.remote_host_used ? String(r.remote_host_used) : null, note: r.note ? String(r.note).slice(0, 300) : null,
    jobs: jobs.map(j => ({ id: String(j.id), name: String(j.name || j.id), ok: j.success === true, files: Number(j.files_transferred) || 0, bytes: Number(j.transferred_bytes) || 0, error: j.error ? String(j.error).slice(0, 200) : null })),
  };
}

// A dry run (`relay diff --json`), as the window shows it: per repo what would go, and a sample of the paths.
export function diffSummary(record: unknown): RelayDiffSummary {
  const r = record && typeof record === 'object' ? (record as Record<string, unknown>) : null;
  const rawJobs = Array.isArray(r?.jobs) ? (r.jobs as Array<Record<string, unknown>>) : [];
  const jobs: RelayDiffJobSummary[] = rawJobs.map(j => ({
    id: String(j.id), name: String(j.name || j.id), ok: j.success !== false, error: j.error ? String(j.error).slice(0, 200) : null,
    files: Number(j.files_transferred) || 0, totalFiles: Number(j.total_files) || 0, bytes: Number(j.transferred_bytes) || 0,
    paths: (Array.isArray(j.changed_paths) ? j.changed_paths : []).slice(0, PATHS_SHOWN).map(String), listed: Array.isArray(j.changed_paths) ? j.changed_paths.length : 0,
  }));
  return { jobs, files: jobs.reduce((n, j) => n + j.files, 0), bytes: jobs.reduce((n, j) => n + j.bytes, 0), problem: r?.success === false && !jobs.length ? String(r.note || 'The mini couldn’t be reached.') : null };
}

// When the next daily sync is, from now: today at HH:MM if that's still ahead, else tomorrow.
export function nextRun(hour: number, minute: number, now = Date.now()): number {
  const at = new Date(now); at.setHours(hour, minute, 0, 0);
  if (at.getTime() <= now) at.setDate(at.getDate() + 1);
  return at.getTime();
}

export function relayService({
  home = homedir(), bin = join(home, '.local', 'bin', 'relay'), onEvent = () => {}, now = () => Date.now(),
  execFile = (file, args, options) => new Promise((resolve, reject) => execFileCb(file, args, options ?? {}, (error, stdout, stderr) => (error ? reject(Object.assign(error, { stdout, stderr })) : resolve({ stdout: String(stdout), stderr: String(stderr) })))),
  spawn = spawnCb, readFile = path => readFileCb(path, 'utf8'), stat = statCb, timers = globalThis, pollMs = 3000, kill = process.kill.bind(process),
}: RelayServiceOptions = {}) {
  const paths = {
    config: join(home, '.config', 'relay', 'config.toml'), history: join(home, '.local', 'share', 'relay', 'history.jsonl'),
    log: join(home, 'Library', 'Logs', 'relay.log'),
  };
  const host = hostname().replace(/\.local$/, '');
  let model = '', installed: boolean | null = null, status: RawRelayStatus | null = null, statusAt = 0, reading: Promise<RawRelayStatus> | null = null, diff: RelayDiffSummary | null = null, diffAt = 0, diffing: Promise<RelayDiffSummary> | null = null;
  let running: RelayRunningState | null = null, child: ChildProcess | null = null, peer: RelayPeerSummary | null = null, offset = -1, timer: ReturnType<typeof setTimeout> | null = null, carry = '', polling: Promise<void> | null = null;

  const relay = async (args: readonly string[], { timeout = 60_000 }: { timeout?: number } = {}): Promise<string> => {
    try { return (await execFile(bin, args, { timeout, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1' } })).stdout; }
    catch (error: unknown) {
      const err = error as { code?: string; stderr?: unknown; message?: unknown } | null;
      if (err?.code === 'ENOENT') { installed = false; throw new Error('relay isn’t installed on this Mac (~/.local/bin/relay).'); }
      throw new Error(String(err?.stderr || err?.message || error).trim().replace(/^Error:\s*/, '').split('\n').slice(-2).join(' ').slice(0, 300) || 'relay didn’t answer.');
    }
  };
  async function isInstalled(): Promise<boolean> {
    if (installed != null) return installed;
    try { installed = (await stat(bin)).isFile(); } catch { installed = false; }
    return installed;
  }
  async function machine(): Promise<string> {
    if (model) return model;
    try {
      const parsed = JSON.parse((await execFile('/usr/sbin/system_profiler', ['-json', 'SPHardwareDataType'], { timeout: 15_000 })).stdout) as { SPHardwareDataType?: Array<{ machine_name?: string }> };
      model = String(parsed.SPHardwareDataType?.[0]?.machine_name || '');
    } catch { model = ''; }
    return model;
  }
  // relay's status asks the mini over ssh (each route in turn, 6 s each when it's away), so it's kept a minute and
  // read one at a time.
  async function readStatus({ fresh = false }: { fresh?: boolean } = {}): Promise<RawRelayStatus> {
    if (!fresh && status && now() - statusAt < STATUS_MS) return status;
    reading ??= (async () => {
      try { status = JSON.parse(await relay(['status', '--json'], { timeout: 45_000 })) as RawRelayStatus; statusAt = now(); return status; }
      finally { reading = null; }
    })();
    return reading;
  }
  async function readConfig(): Promise<RelayConfig> { try { return parseConfig(await readFile(paths.config)); } catch { return parseConfig(''); } }
  async function readHistory(limit = 20): Promise<RelayRecordSummary[]> {
    let text = '';
    try { text = await readFile(paths.history); } catch { return []; }
    return text.split('\n').filter(Boolean).slice(-limit * 2).map(line => { try { return recordSummary(JSON.parse(line)); } catch { return null; } }).filter((r): r is RelayRecordSummary => Boolean(r)).slice(-limit).reverse();
  }
  async function logTail(lines = 40): Promise<string[]> {
    try { return (await readFile(paths.log)).split('\n').filter(Boolean).slice(-Math.min(200, Math.max(1, lines))); } catch { return []; }
  }

  // The dry run: what each repo that's on would send. A dry run of ~/Github takes a while; kept 10 minutes; one at a time.
  async function readDiff({ fresh = false }: { fresh?: boolean } = {}): Promise<RelayDiffSummary> {
    if (!fresh && diff && now() - diffAt < DIFF_MS) return diff;
    diffing ??= (async () => {
      try { diff = diffSummary(JSON.parse(await relay(['diff', '--json'], { timeout: 10 * 60_000 }))); diffAt = now(); return diff; }
      finally { diffing = null; }
    })();
    return diffing;
  }

  // What the window shows: the route to the mini and its free space against relay's floor, the repos, the schedule
  // and LaunchAgent, the history, the dry run if one's been made, and a sync under way.
  async function state({ fresh = false }: { fresh?: boolean } = {}) {
    const name = await machine();
    const base = { host, name: macName(name), at: now(), peer: peer && now() - peer.at < PEER_STALE_MS ? peer : null };
    if (!(await isInstalled())) return { ...base, installed: false as const };
    const [s, config, history] = await Promise.all([readStatus({ fresh }), readConfig(), readHistory()]);
    const hour = Number(config.schedule.hour ?? 2), minute = Number(config.schedule.minute ?? 0);
    return {
      ...base, installed: true as const, host: String(s.local_host || host),
      mini: s.remote ? { reachable: true as const, name: String(s.remote.remote_hostname || 'Mac mini'), route: String(s.remote.host || ''), user: String(s.remote.user || ''), free: Number(s.remote.free_bytes) || 0, total: Number(s.remote.total_bytes) || 0 }
        : { reachable: false as const, problem: String(s.remote_error || 'The mini didn’t answer.').split('\n')[0].slice(0, 300), free: Number(s.state?.last_remote_free_bytes) || 0, total: 0 },
      floor: Number(config.remote.min_remote_free_gb ?? 20) * 1e9, routes: (Array.isArray(config.remote.hosts) ? config.remote.hosts : []).map(String).slice(0, 6),
      schedule: { hour, minute, time: String(s.schedule_time || `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`), next: nextRun(hour, minute, now()), notify: config.schedule.notify !== false },
      service: { loaded: Boolean(s.service?.loaded), installed: Boolean(s.service?.plist_installed), lastExit: s.service?.last_exit_code ?? null, pid: s.service?.pid ?? null, label: String(s.service?.label || 'com.razeenwasif.relay') },
      jobs: (Array.isArray(s.jobs) ? s.jobs : config.jobs).map(j => ({ id: String(j.id), name: String(j.name || j.id), source: String(j.source || ''), dest: String(j.dest || ''), enabled: j.enabled !== false })),
      excludes: (Array.isArray(config.sync.global_excludes) ? config.sync.global_excludes : []).length,
      lastSyncAt: Date.parse(s.state?.last_sync_at ?? '') || 0, lastSuccessAt: Date.parse(s.state?.last_success_at ?? '') || 0, lastStatus: s.state?.last_status ? String(s.state.last_status).slice(0, 300) : null,
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
  async function sync({ only = null }: { only?: unknown[] | null } = {}) {
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
    const spawned = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'], detached: true, env: { ...process.env, NO_COLOR: '1' } });
    child = spawned;
    let error = '';
    spawned.stderr?.on('data', (chunk: Buffer | string) => { error = (error + chunk).slice(-600); });
    const exited = new Promise<number | null>(resolve => spawned.on('close', code => resolve(code)));
    spawned.on('error', e => { error = e.message; });
    timers.setTimeout(() => poll(), 400);
    const code = await exited;
    child = null;
    await poll();
    if (running) await finish(code === 0 ? null : (error.trim().replace(/^Error:\s*/, '').split('\n').at(-1) || `relay stopped (${code ?? 'signal'}).`));
    return state({ fresh: true });
  }
  // Stopping: the sync Fairy started (its whole group, rsync too), or the LaunchAgent's run of it (rsync first).
  async function stop(): Promise<{ stopped: boolean }> {
    if (child) { try { kill(-child.pid!, 'SIGTERM'); } catch { child.kill('SIGTERM'); } return { stopped: true }; }
    if (!running) return { stopped: false };
    let pids: number[] = [];
    try { pids = String((await execFile('/usr/bin/pgrep', ['-f', `${bin} sync`], { timeout: 5000 })).stdout).split('\n').map(Number).filter(Boolean); } catch {}
    for (const pid of pids) { try { await execFile('/usr/bin/pkill', ['-TERM', '-P', String(pid)], { timeout: 5000 }); } catch {} try { kill(pid, 'SIGTERM'); } catch {} }
    return { stopped: pids.length > 0 };
  }
  async function job(id: string, on: boolean) {
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
  async function time(value: unknown) {
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
  async function tui(): Promise<{ opened: boolean }> {
    const folder = join(home, 'Library', 'Application Support', 'Lyra', 'relay'), file = join(folder, 'relay.command');
    await mkdir(folder, { recursive: true });
    await writeFile(file, `#!/bin/zsh\nclear\nexec ${JSON.stringify(bin)}\n`, { mode: 0o755 }); await chmod(file, 0o755);
    await execFile('/usr/bin/open', [file], { timeout: 10_000 });
    return { opened: true };
  }
  async function service(action: string) {
    if (!(SERVICE_ACTIONS as readonly string[]).includes(action)) throw new Error('Install, uninstall or trigger.');
    await relay(['service', action], { timeout: 30_000 });
    return state({ fresh: true });
  }

  // The log, followed: new whole lines since last time; a log rotated (relay renames it past 2 MB) starts from its top.
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
  // At start, a sync already under way (its start with no end in the log's last lines) is picked up.
  async function catchUp(): Promise<void> {
    const lines = await logTail(60);
    let begun = -1;
    lines.forEach((line, i) => { const e = parseLogLine(line); if (e?.kind === 'start') begun = i; if (e && (e.kind === 'end' || e.kind === 'failed')) begun = -1; });
    if (begun >= 0 && now() - (parseLogLine(lines[begun])?.at || 0) < 60 * 60_000) for (const line of lines.slice(begun)) await consume(parseLogLine(line));
  }
  async function consume(e: RelayLogEvent | null): Promise<void> {
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
  async function finish(problem: string | null): Promise<void> {
    const was = running;
    running = null; status = null; diff = null;
    const [last] = await readHistory(1);
    const record = last && last.at >= (was?.startedAt || 0) - 5000 ? last : null;
    let free: number | null = null;
    try { const s = await readStatus({ fresh: true }); free = s.remote ? Number(s.remote.free_bytes) || null : null; } catch {}
    emit({ type: 'done', trigger: was?.trigger || 'manual', record, problem: record && !record.ok ? (record.note || record.jobs.find(j => !j.ok)?.error || problem || 'A repo didn’t finish.') : problem, free });
  }
  function emit(event: Record<string, unknown>): void { try { onEvent({ ...event, host, name: macName(model) }); } catch {} }
  function follow(): void {
    if (timer) return;
    const tick = async () => { try { if (await isInstalled()) await poll(); } catch {} timer = timers.setTimeout(tick, running ? 1000 : pollMs); };
    void machine().then(tick);
  }

  return {
    paths, follow,
    stopFollowing(): void { if (timer) timers.clearTimeout(timer); timer = null; },
    // The window's one call: an action and its arguments, each checked.
    async call(action: string, ...args: unknown[]) {
      if (!(ACTIONS as readonly string[]).includes(action)) throw new Error('Relay can’t do that.');
      if (action === 'state') return state({ fresh: args[0] === true });
      if (!(await isInstalled())) throw new Error('relay isn’t installed on this Mac (~/.local/bin/relay).');
      if (action === 'diff') { await readDiff({ fresh: args[0] === true }); return state(); }
      if (action === 'sync') { const options = (args[0] && typeof args[0] === 'object' ? args[0] : {}) as { only?: unknown }; return sync({ only: (options.only as unknown[] | null | undefined) ?? null }); }
      if (action === 'stop') return stop();
      if (action === 'job') return job(String(args[0] ?? ''), args[1] === true);
      if (action === 'time') return time(args[0]);
      if (action === 'service') return service(String(args[0] ?? ''));
      if (action === 'tui') return tui();
      return { lines: await logTail(Number(args[0]) || 40) };
    },
    summary,
    // The MacBook's summary, told by its window's Fairy; kept 30 minutes.
    report(value: unknown): { ok: true } {
      if (!value || typeof value !== 'object' || typeof (value as Record<string, unknown>).host !== 'string') throw new Error('Not a relay summary.');
      const v = value as Record<string, unknown>;
      const n = (x: unknown): number => Number(x) || 0, str = (x: unknown, max: number): string => String(x ?? '').slice(0, max);
      const job = (j: unknown): RelayPeerJob => {
        const item = (j && typeof j === 'object' ? j : {}) as Record<string, unknown>;
        return { id: str(item.id, 40), name: str(item.name || item.id, 60), files: n(item.files), bytes: n(item.bytes), ok: item.ok !== false, enabled: item.enabled !== false, source: str(item.source, 200), dest: str(item.dest, 200) };
      };
      const r = v.running && typeof v.running === 'object' ? (v.running as Record<string, unknown>) : null;
      const last = v.last && typeof v.last === 'object' ? (v.last as Record<string, unknown>) : null;
      const miniRaw = v.mini && typeof v.mini === 'object' ? (v.mini as Record<string, unknown>) : null;
      const schedRaw = v.schedule && typeof v.schedule === 'object' ? (v.schedule as Record<string, unknown>) : null;
      const serviceRaw = v.service && typeof v.service === 'object' ? (v.service as Record<string, unknown>) : null;
      const pendingRaw = v.pending && typeof v.pending === 'object' ? (v.pending as Record<string, unknown>) : null;
      peer = {
        host: str(v.host, 80), name: str(v.name || 'MacBook', 40), at: now(), installed: v.installed === true,
        mini: miniRaw ? { reachable: miniRaw.reachable === true, name: str(miniRaw.name || 'Mac mini', 60), route: str(miniRaw.route, 80), free: n(miniRaw.free), total: n(miniRaw.total), problem: miniRaw.problem ? str(miniRaw.problem, 300) : null } : null,
        floor: n(v.floor) || 20e9, schedule: schedRaw ? { time: str(schedRaw.time, 5), next: n(schedRaw.next) } : null,
        service: { loaded: serviceRaw?.loaded === true }, jobs: (Array.isArray(v.jobs) ? v.jobs : []).slice(0, 20).map(job),
        lastSyncAt: n(v.lastSyncAt), lastSuccessAt: n(v.lastSuccessAt), lastStatus: v.lastStatus ? str(v.lastStatus, 300) : null,
        last: last ? { at: n(last.at), ok: last.ok === true, files: n(last.files), bytes: n(last.bytes), ms: n(last.ms), trigger: str(last.trigger, 20) } : null,
        pending: pendingRaw ? { at: n(pendingRaw.at), files: n(pendingRaw.files), bytes: n(pendingRaw.bytes), jobs: (Array.isArray(pendingRaw.jobs) ? pendingRaw.jobs : []).slice(0, 20).map(job) } : null,
        running: r ? { trigger: str(r.trigger, 20), index: n(r.index), total: n(r.total), current: r.current ? str(r.current, 40) : null, files: n(r.files), bytes: n(r.bytes), expected: r.expected == null ? null : n(r.expected) } : null,
      };
      return { ok: true };
    },
  };
}
