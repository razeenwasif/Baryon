// Step 1 of docs/fairy-on-two-macs-plan.md, the pointer test. Reads the logs that scripts/pointer-log.swift wrote on
// two Macs at once and answers one question: could each Mac tell, from its own pointer and idle time, that it was the
// one in use while you crossed between them with Universal Control?
//
//   node scripts/pointer-report.mjs macbook.jsonl mini.jsonl [--expect 20] [--offset-ms N] [--json]
//
// It replays the rule from the plan's "Presence and hand-over" over both logs and counts where she would have been
// shown. The two logs are lined up by their wall-clock times; --offset-ms is how far ahead the second Mac's clock is.
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

export type PointerRule = 'fresh' | 'latest';
export type PointerIdleKind = 'fine' | 'whole';
export type PointerMacSide = 'a' | 'b';
export type PointerChoice = 'follow' | 'follow-finer-idle' | 'follow-latest-rule' | 'manual';

export interface PointerLogLine {
  t: number;
  x: number;
  y: number;
  idle: number;
}

export interface ActiveSample {
  t: number;
  input: number;
}

export interface PointerSwitch {
  at: number;
  from: PointerMacSide;
  to: PointerMacSide;
  lagMs: number;
}

export interface PointerOverlap {
  at: number;
  ms: number;
}

export interface CrossingsResult {
  switches: PointerSwitch[];
  overlaps: PointerOverlap[];
}

export interface ReportRow {
  rule: PointerRule;
  idle: PointerIdleKind;
  crossings: number;
  worstLagMs: number;
  longestOverlapMs: number;
  longOverlaps: number;
  quickSwitches: number;
  switches: PointerSwitch[];
  pass: boolean;
}

export interface DwellSummary {
  dwell: number;
  crossings: number;
  quickSwitches: number;
}

export interface PointerReportResult {
  from: number;
  seconds: number;
  names: string[];
  expect: number | null;
  rows: ReportRow[];
  dwells: DwellSummary[];
  shortestCleanDwell: number | null;
  choice: PointerChoice;
  share: [number, number];
  samples: [number, number];
}

// The same numbers as the plan's presence rule (desktop/face-presence.mjs, step 5).
export const SAMPLE_MS = 100, FRESH_MS = 400, DWELL_MS = 1000;
// An idle time under this is the sample just after a key or a movement on the Mac itself. The idle time Electron's
// powerMonitor gives is whole seconds, so "whole" counts it as 0 to 0.99.
export const IDLE_ACTIVE_SECONDS = 0.15;
// How late, beyond the dwell, naming the Mac in use may be. Measured from that Mac's last real input.
export const LAG_LIMIT_MS = 300;
// Both Macs looking in use at once is normal for a moment at a crossing: on the first real pair of logs (15 Nov 2026,
// MacBook and mini under Universal Control) it lasted 0.6 to 1.1 s at every crossing, because the Mac holding the keyboard
// and trackpad sees them just before the pointer leaves the other. Only a stretch longer than this means a Mac is showing
// input that isn't there.
export const OVERLAP_LIMIT_MS = 2000;
// Two switches closer together than this are flapping, not a person crossing back and forth (the test asks for a pause).
export const QUICK_SWITCH_MS = 2000;
export const DWELLS = [300, 400, 500, 600, 800, 1000];

// The lines of a log, skipping a line the logger was cut off in the middle of.
export function parseLog(text: string): PointerLogLine[] {
  const lines: PointerLogLine[] = [];
  for (const raw of String(text).split('\n')) {
    let line: { t?: unknown; x?: unknown; y?: unknown; idle?: unknown } | null = null;
    try { line = JSON.parse(raw) as { t?: unknown; x?: unknown; y?: unknown; idle?: unknown }; } catch { continue; }
    if (line && Number.isFinite(line.t) && Number.isFinite(line.x) && Number.isFinite(line.y) && Number.isFinite(line.idle)) {
      lines.push({ t: line.t as number, x: line.x as number, y: line.y as number, idle: line.idle as number });
    }
  }
  return lines.sort((a, b) => a.t - b.t);
}

// When this Mac looked in use: { t, input }, where input is when its last real keyboard or mouse event was.
// Input is seen three ways: the pointer moved; the idle time fell, which is how a key or a click shows even when the
// pointer doesn't move (needed because a Mac driven from the other Mac by Universal Control reports an idle time that
// resets only to about half a second, never to 0, so "idle under 0.15 s" alone would miss it); or the idle time is
// under 0.15 s. "wholeSeconds" is what Electron's powerMonitor sees: idle time rounded down to whole seconds, plus the pointer.
// input is the same for both, the last real event, so a lag is measured against that and not against how a sample was chosen.
export function activeSamples(lines: readonly PointerLogLine[], { wholeSeconds = false }: { wholeSeconds?: boolean } = {}): ActiveSample[] {
  const found: ActiveSample[] = [];
  let lastEvent: number | null = null;
  lines.forEach((line, i) => {
    const moved = i > 0 && (line.x !== lines[i - 1].x || line.y !== lines[i - 1].y);
    const fell = i > 0 && line.idle < lines[i - 1].idle - 0.02;
    const fresh = line.idle < IDLE_ACTIVE_SECONDS;
    if (moved || fell || fresh) lastEvent = fresh ? line.t - line.idle * 1000 : line.t;
    if (wholeSeconds ? moved || Math.floor(line.idle) === 0 : moved || fell || fresh) found.push({ t: line.t, input: lastEvent ?? line.t });
  });
  return found;
}

// Replays the rule over two Macs' active samples, a tick at a time, and returns where she would have moved ('a' to 'b'
// or back) and the stretches where both Macs looked in use at once.
// rule 'fresh' is the plan's: move when the other Mac was active within 400 ms and this one has been quiet for 1 second.
// rule 'latest' moves when the other Mac was active more recently and this one has been quiet for 1 second.
export function crossings(
  a: readonly ActiveSample[],
  b: readonly ActiveSample[],
  { from, to, rule = 'fresh', dwell = DWELL_MS }: { from: number; to: number; rule?: PointerRule; dwell?: number },
): CrossingsResult {
  const switches: PointerSwitch[] = [], overlaps: PointerOverlap[] = [];
  let ia = 0, ib = 0, lastA: ActiveSample | null = null, lastB: ActiveSample | null = null;
  let owner: PointerMacSide | null = null, overlapFrom: number | null = null, overlapTo: number | null = null;
  const endOverlap = (): void => { if (overlapFrom !== null) overlaps.push({ at: overlapFrom, ms: overlapTo! - overlapFrom + SAMPLE_MS }); overlapFrom = null; };
  for (let t = from; t <= to; t += SAMPLE_MS) {
    while (ia < a.length && a[ia].t <= t) lastA = a[ia++];
    while (ib < b.length && b[ib].t <= t) lastB = b[ib++];
    const agoA = lastA ? t - lastA.t : Infinity, agoB = lastB ? t - lastB.t : Infinity;
    if (agoA <= FRESH_MS && agoB <= FRESH_MS) { overlapFrom ??= t; overlapTo = t; } else endOverlap();
    if (owner === null) { if (agoA <= FRESH_MS || agoB <= FRESH_MS) owner = agoA <= agoB ? 'a' : 'b'; continue; }
    const mine = owner === 'a' ? agoA : agoB, theirs = owner === 'a' ? agoB : agoA, old = owner === 'a' ? lastA : lastB;
    if (mine >= dwell && (rule === 'latest' ? theirs < mine : theirs <= FRESH_MS)) {
      const next: PointerMacSide = owner === 'a' ? 'b' : 'a';
      switches.push({ at: t, from: owner, to: next, lagMs: Math.max(0, t - (old!.input + dwell)) });
      owner = next;
    }
  }
  endOverlap();
  return { switches, overlaps };
}

const quick = (switches: readonly PointerSwitch[]): number => switches.filter((item, i) => i > 0 && item.at - switches[i - 1].at < QUICK_SWITCH_MS).length;

// Four replays: the plan's rule and the "latest input" rule, each with idle time to the fraction of a second (what the
// logger saw) and in whole seconds (what Electron's powerMonitor.getSystemIdleTime gives).
export function report(
  linesA: readonly PointerLogLine[],
  linesB: readonly PointerLogLine[],
  { offsetMs = 0, expect = null, names = ['A', 'B'] }: { offsetMs?: number; expect?: number | null; names?: string[] } = {},
): PointerReportResult {
  if (linesA.length < 2 || linesB.length < 2) throw new Error('Each log needs at least two samples.');
  const second = linesB.map(line => ({ ...line, t: line.t - offsetMs }));
  const from = Math.max(linesA[0].t, second[0].t), to = Math.min(linesA.at(-1)!.t, second.at(-1)!.t);
  if (to - from < 5000) throw new Error('The two logs overlap for less than 5 seconds. Were they run at the same time? If one Mac’s clock is off, pass --offset-ms.');
  const rows: ReportRow[] = [];
  for (const rule of ['fresh', 'latest'] as const) {
    for (const [idle, wholeSeconds] of [['fine', false], ['whole', true]] as const) {
      const { switches, overlaps } = crossings(activeSamples(linesA, { wholeSeconds }), activeSamples(second, { wholeSeconds }), { from, to, rule });
      const worstLagMs = Math.max(0, ...switches.map(item => item.lagMs)), longestOverlapMs = Math.max(0, ...overlaps.map(item => item.ms));
      const longOverlaps = overlaps.filter(item => item.ms > OVERLAP_LIMIT_MS).length, quickSwitches = quick(switches);
      rows.push({ rule, idle, crossings: switches.length, worstLagMs, longestOverlapMs, longOverlaps, quickSwitches, switches,
        pass: switches.length > 0 && (expect === null || switches.length === expect) && worstLagMs <= LAG_LIMIT_MS && longOverlaps === 0 && quickSwitches === 0 });
    }
  }
  const row = (rule: PointerRule, idle: PointerIdleKind): ReportRow => rows.find(item => item.rule === rule && item.idle === idle)!;
  const choice: PointerChoice = row('fresh', 'fine').pass ? (row('fresh', 'whole').pass ? 'follow' : 'follow-finer-idle') : row('latest', 'fine').pass ? 'follow-latest-rule' : 'manual';
  // The plan's rule with fine idle time, at shorter dwells: how many switches and how many are flapping. The shortest dwell
  // that gives the same switches as the full dwell, with no flapping, is how soon she could follow.
  const fine: readonly [ActiveSample[], ActiveSample[]] = [activeSamples(linesA), activeSamples(second)], full = row('fresh', 'fine').crossings;
  const dwells = DWELLS.map(dwell => { const { switches } = crossings(...fine, { from, to, dwell }); return { dwell, crossings: switches.length, quickSwitches: quick(switches) }; });
  const shortestCleanDwell = dwells.find(item => item.crossings === full && item.quickSwitches === 0)?.dwell ?? null;
  const share = (lines: readonly PointerLogLine[]): number => Math.round(activeSamples(lines).length / lines.length * 100);
  return { from, seconds: Math.round((to - from) / 100) / 10, names, expect, rows, dwells, shortestCleanDwell, choice, share: [share(linesA), share(second)], samples: [linesA.length, second.length] };
}

const CHOICES: Record<PointerChoice, string> = {
  follow: 'Follow the pointer. Each Mac can tell it is the one in use, even with Electron’s whole-second idle time.',
  'follow-finer-idle': 'Follow the pointer, but the sampler in step 5 must read idle time to the fraction of a second, as this logger does through a native call, because Electron’s powerMonitor gives whole seconds and she would be late.',
  'follow-latest-rule': 'Follow the pointer, but with the "latest input" rule, not the plan’s "active within 400 ms" rule: someone who stops moving after crossing is otherwise missed. Change the plan’s presence table before step 5.',
  manual: 'Do not follow the pointer. Build only "Bring Fairy here" (the plan’s fallback in Presence and hand-over).',
};
const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

export function format(result: PointerReportResult): string {
  const [a, b] = result.names, { rows } = result;
  const label = (row: ReportRow): string => `${row.rule === 'fresh' ? 'plan rule' : 'latest-input rule'}, ${row.idle === 'fine' ? 'fine idle time' : 'whole-second idle time'}`;
  const width = Math.max(...rows.map(row => label(row).length)) + 2;
  const lines = [
    `Pointer test: ${result.seconds} s of both logs together (${a}: ${result.samples[0]} samples, ${b}: ${result.samples[1]}).`,
    `Share of the time each Mac looked in use: ${a} ${result.share[0]}%, ${b} ${result.share[1]}%.`,
    result.expect === null ? 'Crossings expected: not given (pass --expect 20 for ten each way).' : `Crossings expected: ${result.expect}.`,
    '', `${'Replay'.padEnd(width)}${'crossings'.padEnd(11)}${'worst lag'.padEnd(11)}${'longest overlap'.padEnd(17)}${'double'.padEnd(8)}result`,
    ...rows.map(row => `${label(row).padEnd(width)}${String(row.crossings).padEnd(11)}${seconds(row.worstLagMs).padEnd(11)}${seconds(row.longestOverlapMs).padEnd(17)}${String(row.quickSwitches).padEnd(8)}${row.pass ? 'pass' : 'FAIL'}`),
    '', 'Lag is how long after the old Mac’s last real input, plus the 1-second dwell, she would have moved. Overlap is time both Macs looked in use at once; a crossing normally has 0.6 to 1.1 s of it, so only more than 2 s counts. Double is a switch less than 2 s after the previous one (flapping).',
    '', `Shorter dwells, plan rule with fine idle time: ${result.dwells.map(item => `${item.dwell} ms ${item.crossings} switches${item.quickSwitches ? ` (${item.quickSwitches} double)` : ''}`).join('; ')}.`,
    result.shortestCleanDwell === null ? 'No dwell gave the same switches as the full dwell without flapping.' : `The shortest clean dwell is ${result.shortestCleanDwell} ms; the plan’s 1,000 ms leaves a margin.`,
    '', `Choice: ${CHOICES[result.choice]}`,
  ];
  const first = rows[0].switches.slice(0, 40).map(item => `  ${((item.at - result.from) / 1000).toFixed(1).padStart(6)}  ${item.from === 'a' ? a : b} -> ${item.to === 'a' ? a : b}  lag ${seconds(item.lagMs)}`);
  if (first.length) lines.push('', 'Crossings the plan rule found, in seconds from the start of the overlap:', ...first);
  return lines.join('\n');
}

async function main(argv: readonly string[]): Promise<void> {
  const files: string[] = [];
  const options: { json?: boolean; expect?: number; 'offset-ms'?: number } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') options.json = true;
    else if (argv[i] === '--expect') options.expect = Number(argv[++i]);
    else if (argv[i] === '--offset-ms') options['offset-ms'] = Number(argv[++i]);
    else files.push(argv[i]);
  }
  if (files.length !== 2 || [options.expect, options['offset-ms']].some(value => value !== undefined && !Number.isFinite(value))) {
    console.error('Usage: node scripts/pointer-report.mjs <first-mac.jsonl> <second-mac.jsonl> [--expect 20] [--offset-ms N] [--json]');
    process.exit(2);
  }
  const [first, second] = await Promise.all(files.map(async file => parseLog(await readFile(file, 'utf8'))));
  const result = report(first, second, { offsetMs: options['offset-ms'] ?? 0, expect: options.expect ?? null, names: files.map(file => basename(file, extname(file))) });
  console.log(options.json ? JSON.stringify(result, null, 2) : format(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
