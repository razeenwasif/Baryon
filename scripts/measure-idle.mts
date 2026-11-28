// Fairy's idle cost, measured the same way each time (efficiency audit, fix 1): CPU time and memory footprint for each
// of its processes, and how often its short-lived helpers start, over a fixed window, with the state it was taken in.
//
//   node scripts/measure-idle.mjs                          five minutes, labelled from the Mac's state
//   node scripts/measure-idle.mjs --seconds 60 --label covered
//   node scripts/measure-idle.mjs compare a.json b.json    two measurements side by side
//
// Set the state up first (Fairy in front and left alone, covered by another window, floating, or on battery), start it,
// and leave the Mac alone until it finishes. Results are saved in .local-data/measure/. A helper that lives shorter than
// one poll can be missed, so starts are a floor, and a helper's own CPU ends with it and isn't counted.
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { resolveRepoRoot } from './repo-root.mjs';

export interface PsRow {
  pid: number;
  ppid: number;
  cpu: number;
  args: string;
}

export interface FootprintStats {
  min: number;
  max: number;
  last: number;
}

export interface ProcessSummaryRow {
  name: string;
  pid: number;
  cpu: number;
  share: number;
  new?: boolean;
  footprint: FootprintStats | null;
}

export interface IdleSummary {
  rows: ProcessSummaryRow[];
  total: {
    cpu: number;
    share: number;
    footprint: number;
  };
  starts: Record<string, number>;
  perMinute: Record<string, number>;
}

export interface IdleState {
  front: string | null;
  idleAtStart: number | null;
  idleAtEnd?: number | null;
  touched?: boolean;
  power: string;
  floating?: boolean;
  settings?: Record<string, unknown>;
}

export interface IdleResult extends IdleSummary {
  label: string;
  at: string;
  seconds: number;
  poll?: number;
  main?: number;
  state?: IdleState;
}

export interface SummariseInput {
  start: readonly PsRow[];
  end: readonly PsRow[];
  seconds: number;
  starts?: Record<string, number>;
  footprints?: Record<number, number[]>;
  main: number;
}

const run = promisify(execFile);
const DATA = join(homedir(), 'Library', 'Application Support', 'lyra-companion', 'lyra');

// "1:05.22", "12:01:05.22" or "1-02:03:04" (days) as seconds.
export function cpuSeconds(text = ''): number {
  const [days, rest] = String(text).trim().includes('-') ? String(text).trim().split('-') : ['0', String(text).trim()];
  const parts = rest.split(':').map(Number);
  if (parts.some(Number.isNaN)) return 0;
  return Number(days) * 86400 + parts.reduce((total, part) => total * 60 + part, 0);
}
// ps -axo pid=,ppid=,time=,args= lines.
export function parsePs(text = ''): PsRow[] {
  return String(text)
    .split('\n')
    .map(line => /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map(([, pid, ppid, time, args]) => ({ pid: Number(pid), ppid: Number(ppid), cpu: cpuSeconds(time), args: args.trim() }));
}
// Everything descended from Fairy's main process, the main process included.
export function family(rows: readonly PsRow[], main: number): PsRow[] {
  const ids = new Set([main]);
  for (let grew = true; grew;) { grew = false; for (const row of rows) if (!ids.has(row.pid) && ids.has(row.ppid)) { ids.add(row.pid); grew = true; } }
  return rows.filter(row => ids.has(row.pid));
}
// A process's name in the audit's terms, from its command line.
export function classify(args = '', main = false): string {
  if (main) return 'Main';
  const type = /--type=([a-z-]+)/.exec(args)?.[1], sub = /--utility-sub-type=([\w.]+)/.exec(args)?.[1] || '';
  if (type === 'renderer') return 'Renderer';
  if (type === 'gpu-process') return 'GPU';
  if (type === 'utility') return /network/i.test(sub) ? 'Network service' : /audio/i.test(sub) ? 'Audio service' : 'Utility';
  if (/codex/.test(args) && /app-server/.test(args)) return 'Codex server';
  const program = basename(args.split(/\s+/)[0] || '');
  if (/codex/.test(program)) return 'Codex server';
  return program || 'unknown';
}
// "Footprint: 421 MB" from footprint's output, in MB.
export function footprintMB(text = ''): number | null {
  const found = /Footprint:\s*([\d.]+)\s*(KB|MB|GB|B)\b/i.exec(text);
  if (!found) return null;
  const value = Number(found[1]), unit = found[2].toUpperCase();
  return Math.round((unit === 'GB' ? value * 1024 : unit === 'KB' ? value / 1024 : unit === 'B' ? value / 1048576 : value) * 10) / 10;
}

// The result: for each process alive at both ends, its CPU over the window and share of one core; footprints as
// sampled; and the helpers that started during it. Renderers are numbered when there's more than one.
export function summarise({ start, end, seconds, starts = {}, footprints = {}, main }: SummariseInput): IdleSummary {
  const before = new Map(start.map(row => [row.pid, row])), named = new Map<string, number>(), rows: ProcessSummaryRow[] = [];
  for (const row of end) {
    const earlier = before.get(row.pid);
    let name = classify(row.args, row.pid === main);
    named.set(name, (named.get(name) || 0) + 1);
    if (named.get(name)! > 1) name = `${name} ${named.get(name)}`;
    const cpu = Math.max(0, row.cpu - (earlier ? earlier.cpu : 0)), mem = footprints[row.pid] || [];
    rows.push({ name, pid: row.pid, cpu: Math.round(cpu * 100) / 100, share: Math.round(cpu / seconds * 1000) / 10, ...(earlier ? {} : { new: true }),
      footprint: mem.length ? { min: Math.min(...mem), max: Math.max(...mem), last: mem.at(-1)! } : null });
  }
  rows.sort((a, b) => b.cpu - a.cpu || a.name.localeCompare(b.name));
  const cpu = rows.reduce((sum, row) => sum + row.cpu, 0);
  const footprint = rows.reduce((sum, row) => sum + (row.footprint?.last || 0), 0);
  return { rows, total: { cpu: Math.round(cpu * 100) / 100, share: Math.round(cpu / seconds * 1000) / 10, footprint: Math.round(footprint) }, starts, perMinute: Object.fromEntries(Object.entries(starts).map(([name, n]) => [name, Math.round(n / seconds * 600) / 10])) };
}

export function tableText(result: IdleResult): string {
  const { seconds, state, label } = result, lines = [`${label}: ${seconds} s${state ? ` · ${state.front ? `${state.front} in front` : 'front app unknown'} · idle ${state.idleAtStart} s at the start${state.touched ? ' (the Mac was touched during it)' : ''} · ${state.power}${state.floating ? ' · floating' : ''}` : ''}`];
  if (state?.settings) lines.push(`settings: ${Object.entries(state.settings).map(([key, value]) => `${key} ${value}`).join(', ')}`);
  lines.push('', `${'Process'.padEnd(24)}${'CPU'.padStart(9)}${'Core'.padStart(8)}${'Footprint'.padStart(16)}`);
  for (const row of result.rows) lines.push(`${`${row.name}${row.new ? ' (new)' : ''}`.padEnd(24)}${`${row.cpu} s`.padStart(9)}${`${row.share}%`.padStart(8)}${(row.footprint ? (row.footprint.min === row.footprint.max ? `${row.footprint.last} MB` : `${row.footprint.min}–${row.footprint.max} MB`) : '–').padStart(16)}`);
  lines.push(`${'Total'.padEnd(24)}${`${result.total.cpu} s`.padStart(9)}${`${result.total.share}%`.padStart(8)}${`${result.total.footprint} MB`.padStart(16)}`);
  const starts = Object.entries(result.starts || {});
  lines.push('', starts.length ? `Helper starts: ${starts.map(([name, n]) => `${name} ${n} (${result.perMinute[name]}/min)`).join(', ')}` : 'Helper starts: none');
  return lines.join('\n');
}

// Two results side by side, by process name.
export function compareText(a: IdleResult, b: IdleResult): string {
  const names = [...new Set([...a.rows.map(row => row.name), ...b.rows.map(row => row.name)])];
  const find = (result: IdleResult, name: string): ProcessSummaryRow | undefined => result.rows.find(row => row.name === name);
  const lines = [`${a.label} (${a.at}) → ${b.label} (${b.at})`, '', `${'Process'.padEnd(24)}${'Core'.padStart(16)}${'Footprint'.padStart(20)}`];
  for (const name of names) {
    const x = find(a, name), y = find(b, name);
    lines.push(`${name.padEnd(24)}${`${x ? `${x.share}%` : '–'} → ${y ? `${y.share}%` : '–'}`.padStart(16)}${`${x?.footprint ? `${x.footprint.last}` : '–'} → ${y?.footprint ? `${y.footprint.last} MB` : '–'}`.padStart(20)}`);
  }
  lines.push(`${'Total'.padEnd(24)}${`${a.total.share}% → ${b.total.share}%`.padStart(16)}${`${a.total.footprint} → ${b.total.footprint} MB`.padStart(20)}`);
  const helpers = [...new Set([...Object.keys(a.perMinute || {}), ...Object.keys(b.perMinute || {})])];
  if (helpers.length) lines.push('', `Helper starts a minute: ${helpers.map(name => `${name} ${a.perMinute?.[name] ?? 0} → ${b.perMinute?.[name] ?? 0}`).join(', ')}`);
  return lines.join('\n');
}

async function psRows(): Promise<PsRow[]> { return parsePs((await run('ps', ['-axo', 'pid=,ppid=,time=,args='], { maxBuffer: 16 * 1024 * 1024 })).stdout); }
async function idleSeconds(): Promise<number | null> {
  try { const out = (await run('ioreg', ['-c', 'IOHIDSystem'], { maxBuffer: 8 * 1024 * 1024 })).stdout; return Math.floor(Number(/"HIDIdleTime" = (\d+)/.exec(out)?.[1] || 0) / 1e9); } catch { return null; }
}
async function frontApp(): Promise<string | null> {
  try { const asn = (await run('lsappinfo', ['front'])).stdout.trim(); return /"([^"]+)"/.exec((await run('lsappinfo', ['info', '-only', 'name', asn])).stdout)?.[1] || null; } catch { return null; }
}
async function powerSource(): Promise<string> { try { return /'([^']+)'/.exec((await run('pmset', ['-g', 'batt'])).stdout)?.[1] || 'unknown'; } catch { return 'unknown'; } }
async function fairyState(): Promise<{ floating: boolean; settings: Record<string, unknown> }> {
  const read = async (name: string): Promise<Record<string, unknown>> => { try { return JSON.parse(await readFile(join(DATA, name), 'utf8')) as Record<string, unknown>; } catch { return {}; } };
  const settings = await read('settings.json'), window = await read('window.json');
  return { floating: Boolean(window.floating), settings: Object.fromEntries(['screenAwareness', 'awarenessPaused', 'handsFree', 'wallpaperMotion', 'reflectionMode'].filter(key => key in settings).map(key => [key, settings[key]])) };
}
async function footprintOf(pid: number): Promise<number | null> { try { return footprintMB((await run('footprint', ['--pid', String(pid)], { maxBuffer: 8 * 1024 * 1024 })).stdout); } catch { return null; } }
const pause = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values: flags, positionals } = parseArgs({ allowPositionals: true, options: { seconds: { type: 'string', default: '300' }, label: { type: 'string', default: '' }, poll: { type: 'string', default: '100' }, pid: { type: 'string', default: '' }, out: { type: 'string', default: '' } } });
  const root = resolveRepoRoot(import.meta.url);
  if (positionals[0] === 'compare') {
    const [a, b] = await Promise.all(positionals.slice(1, 3).map(async path => JSON.parse(await readFile(path, 'utf8')) as IdleResult));
    console.log(compareText(a, b));
    process.exit(0);
  }
  const main = Number(flags.pid) || Number((await run('pgrep', ['-x', 'Fairy']).catch(() => ({ stdout: '' }))).stdout.trim().split('\n')[0]);
  if (!main) { console.error('Fairy isn’t running.'); process.exit(1); }
  const seconds = Math.max(5, Number(flags.seconds) || 300), poll = Math.max(20, Number(flags.poll) || 100);
  const front = await frontApp(), idleAtStart = await idleSeconds(), power = await powerSource(), fairy = await fairyState();
  const label = flags.label || `${front === 'Fairy' ? 'front' : 'covered'}${fairy.floating ? '-floating' : ''}-${/battery/i.test(power) ? 'battery' : 'mains'}`;
  console.log(`Measuring Fairy (pid ${main}) for ${seconds} s as “${label}”. Leave the Mac alone until it finishes.`);
  const start = family(await psRows(), main), seen = new Set(start.map(row => row.pid)), starts: Record<string, number> = {}, footprints: Record<number, number[]> = {};
  const sampleFootprints = async (rows: readonly PsRow[]): Promise<void> => { for (const row of rows) { const mb = await footprintOf(row.pid); if (mb !== null) (footprints[row.pid] ||= []).push(mb); } };
  await sampleFootprints(start);
  const began = Date.now();
  let nextFootprint = began + 15000;
  while (Date.now() - began < seconds * 1000) {
    await pause(poll);
    let rows: PsRow[];
    try { rows = family(await psRows(), main); } catch { continue; }
    // A restart (an install, a crash) ends the process being measured, and anything after it would be misleading.
    if (!rows.some(row => row.pid === main)) { console.error(`Fairy (pid ${main}) quit or restarted after ${Math.round((Date.now() - began) / 1000)} s, so nothing was saved. Run it again.`); process.exit(1); }
    for (const row of rows) if (!seen.has(row.pid)) { seen.add(row.pid); const name = classify(row.args); starts[name] = (starts[name] || 0) + 1; }
    if (Date.now() >= nextFootprint) { nextFootprint += 15000; await sampleFootprints(rows.filter(row => start.some(item => item.pid === row.pid))); }
  }
  const elapsed = Math.round((Date.now() - began) / 100) / 10;
  const end = family(await psRows(), main);
  await sampleFootprints(end.filter(row => start.some(item => item.pid === row.pid)));
  // Long-lived processes that started during the window count as processes, not as starts.
  for (const row of end) if (!start.some(item => item.pid === row.pid)) { const name = classify(row.args); if (starts[name]) starts[name] -= 1; if (!starts[name]) delete starts[name]; }
  const idleAtEnd = await idleSeconds();
  const state: IdleState = { front, idleAtStart, idleAtEnd, touched: idleAtEnd !== null && idleAtEnd < elapsed - 2, power, ...fairy };
  const result: IdleResult = { label, at: new Date().toISOString(), seconds: elapsed, poll, main, state, ...summarise({ start, end, seconds: elapsed, starts, footprints, main }) };
  console.log(`\n${tableText(result)}`);
  const stamp = new Date().toLocaleString('sv-SE').replace(/[-:]/g, '').replace(' ', '-');
  const out = flags.out || join(root, '.local-data', 'measure', `${stamp}-${label}.json`);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`\nSaved ${out}${state.touched ? '\nThe Mac was used during the measurement, so it isn’t an idle sample.' : ''}`);
}
