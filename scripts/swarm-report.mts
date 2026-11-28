// Swarm mode's measure (stage 6): the hard work tasks run three ways, side by side. Pass rate, minutes and designer
// calls for one designer, one designer with a Second opinion, and a swarm, so Swarm earns its cost or doesn't.
//
//   node scripts/swarm-report.mjs                        the latest hard run of each way in .local-data/evals
//   node scripts/swarm-report.mjs a.json b.json c.json   these runs
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveRepoRoot } from './repo-root.mjs';

export const WAYS = { designer: 'One designer', review: 'With a Second opinion', swarm: 'Swarm' } as const;
export type SwarmWay = keyof typeof WAYS;

export interface SwarmRunTaskResult {
  id: string;
  ok: boolean;
  seconds?: number;
  designerCalls?: number | null;
}

export interface SwarmRunRecord {
  way?: string;
  provider?: string;
  model?: string;
  standIn?: boolean;
  hard?: boolean;
  commit?: string;
  started?: string | number;
  results?: readonly SwarmRunTaskResult[];
}

export interface SwarmWaySummaryRow {
  way: SwarmWay;
  name: string;
  missing?: true;
  passed?: number;
  total?: number;
  rate?: number;
  minutes?: number;
  designerCalls?: number;
  each?: { minutes: number; designerCalls: number };
  from?: string;
  started?: string | number;
}

export interface SwarmTaskWayCell {
  ok: boolean;
  seconds: number;
  designerCalls: number | null;
}

export interface SwarmTaskComparisonRow {
  id: string;
  designer: SwarmTaskWayCell | null;
  review: SwarmTaskWayCell | null;
  swarm: SwarmTaskWayCell | null;
}

export interface SwarmMeasureReport {
  rows: SwarmWaySummaryRow[];
  tasks: SwarmTaskComparisonRow[];
}

const WAY_KEYS = Object.keys(WAYS) as SwarmWay[];
const isSwarmWay = (way: string): way is SwarmWay => Object.prototype.hasOwnProperty.call(WAYS, way);

// One row per way, from saved eval runs: the latest of each, and per task how each way did.
export function measure(runs: readonly SwarmRunRecord[]): SwarmMeasureReport {
  const latest: Partial<Record<SwarmWay, SwarmRunRecord>> = {};
  for (const run of runs) {
    const way = run.way || 'designer';
    if (!isSwarmWay(way) || run.provider === 'scripted') continue;
    const prev = latest[way];
    if (!prev || String(run.started) > String(prev.started)) latest[way] = run;
  }
  const rows: SwarmWaySummaryRow[] = WAY_KEYS.map(way => {
    const run = latest[way];
    if (!run) return { way, name: WAYS[way], missing: true };
    const results = run.results || [], total = results.length, passed = results.filter(result => result.ok).length;
    const seconds = results.reduce((sum, result) => sum + (result.seconds || 0), 0), calls = results.reduce((sum, result) => sum + (result.designerCalls || 0), 0);
    return { way, name: WAYS[way], passed, total, rate: total ? Math.round(passed / total * 100) : 0, minutes: Math.round(seconds / 6) / 10, designerCalls: calls,
      each: { minutes: total ? Math.round(seconds / total / 6) / 10 : 0, designerCalls: total ? Math.round(calls / total * 10) / 10 : 0 },
      from: `${run.provider}${run.model ? ` ${run.model}` : ''}${run.standIn ? ', stand-in' : ''} at ${run.commit || '?'}`, started: run.started };
  });
  const ids = [...new Set(Object.values(latest).flatMap(run => (run?.results || []).map(result => result.id)))];
  const tasks: SwarmTaskComparisonRow[] = ids.map(id => {
    const cellFor = (way: SwarmWay): SwarmTaskWayCell | null => {
      const result = latest[way]?.results?.find(item => item.id === id);
      return result ? { ok: result.ok, seconds: result.seconds ?? 0, designerCalls: result.designerCalls ?? null } : null;
    };
    return { id, designer: cellFor('designer'), review: cellFor('review'), swarm: cellFor('swarm') };
  });
  return { rows, tasks };
}

export function reportText({ rows, tasks }: SwarmMeasureReport): string {
  const lines = [`${'Way'.padEnd(24)}${'Passed'.padStart(8)}${'Rate'.padStart(7)}${'Minutes'.padStart(10)}${'per task'.padStart(10)}${'Designer calls'.padStart(16)}${'per task'.padStart(10)}  Run`];
  for (const row of rows) {
    if (row.missing) { lines.push(`${row.name.padEnd(24)}${'not run yet'.padStart(8)}`); continue; }
    lines.push(`${row.name.padEnd(24)}${`${row.passed}/${row.total}`.padStart(8)}${`${row.rate}%`.padStart(7)}${String(row.minutes).padStart(10)}${String(row.each?.minutes).padStart(10)}${String(row.designerCalls).padStart(16)}${String(row.each?.designerCalls).padStart(10)}  ${row.from}`);
  }
  if (tasks.length) {
    lines.push('', `${'Task'.padEnd(26)}${Object.values(WAYS).map(name => name.padStart(24)).join('')}`);
    for (const task of tasks) lines.push(`${task.id.padEnd(26)}${WAY_KEYS.map(way => { const cell = task[way]; return (cell ? `${cell.ok ? 'pass' : 'FAIL'} ${Math.round(cell.seconds)}s ${cell.designerCalls ?? '?'} calls` : '—').padStart(24); }).join('')}`);
  }
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = resolveRepoRoot(import.meta.url), given = process.argv.slice(2);
  let paths = given;
  if (!paths.length) {
    const dir = join(root, '.local-data', 'evals');
    paths = (await readdir(dir).catch(() => [] as string[])).filter(name => name.endsWith('.json') && name.includes('-hard')).map(name => join(dir, name));
  }
  // A stand-in run (every seat on one provider) isn't a real comparison, so it counts only when you name its file.
  const runs = (await Promise.all(paths.map(async path => { try { return JSON.parse(await readFile(path, 'utf8')) as SwarmRunRecord; } catch { return null; } }))).filter((run): run is SwarmRunRecord => Boolean(run && (given.length || (run.hard && !run.standIn))));
  if (!runs.length) { console.log('No hard runs yet. Run node scripts/eval.mjs --provider claude --model claude-opus-5-5 --effort high --hard, then again with --way review and --way swarm.'); process.exit(0); }
  console.log(reportText(measure(runs)));
}
