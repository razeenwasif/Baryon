// What the Runs panel works out from runs, with no DOM: its columns, its order, and how a value reads.
// (docs/tracker-plan.md, stage 3.)

export type RunStep = [number, number];

export interface RunMetric {
  value?: number;
  unit?: string | null;
  steps?: RunStep[];
}

export interface RunWhere {
  kind?: string;
  job?: string;
}

export interface RunRecord {
  id: string;
  name?: string;
  command?: string;
  state?: string;
  scale?: string;
  where?: RunWhere;
  started?: string | number;
  seconds?: number | null;
  params?: Record<string, unknown>;
  metrics?: Record<string, RunMetric | undefined>;
  claims?: string[];
  tags?: string[];
  [key: string]: unknown;
}

export interface ChartBox {
  w: number;
  h: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export const STATE_WORDS = Object.freeze({ running: 'Running', done: 'Done', failed: 'Failed', 'timed-out': 'Timed out', stopped: 'Stopped' } as const);
export const SCALE_WORDS = Object.freeze({ smoke: 'Smoke', scaled: 'Scaled down', full: 'Full scale' } as const);
export const WHERE_WORDS: Readonly<Record<string, string>> = Object.freeze({ here: 'This Mac', outside: 'This Mac, outside the sandbox', atlas: 'atlas', forge: 'forge', lab: 'Lab' });
export const FILTERS = Object.freeze([['all', 'All'], ['done', 'Done'], ['failed', 'Failed'], ['running', 'Running'], ['stopped', 'Stopped']] as const);
export const MAX_COLUMNS = 6;

// The parameters and metrics worth a column: those most runs have, at most six of each, in the order first seen.
export function columnsOf(runs: ReadonlyArray<RunRecord>, max = MAX_COLUMNS): { params: string[]; metrics: string[] } {
  const pick = (field: 'params' | 'metrics'): string[] => {
    const counts = new Map<string, number>();
    for (const run of runs) for (const name of Object.keys(run[field] || {})) counts.set(name, (counts.get(name) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([name]) => name).sort((a, b) => [...counts.keys()].indexOf(a) - [...counts.keys()].indexOf(b));
  };
  return { params: pick('params'), metrics: pick('metrics') };
}

// A run's value for a column: id, state, where, started, seconds, or param:<name> / metric:<name>.
export function valueOf(run: RunRecord, key: string): unknown {
  if (key.startsWith('param:')) return run.params?.[key.slice(6)];
  if (key.startsWith('metric:')) return run.metrics?.[key.slice(7)]?.value;
  if (key === 'id') return Number(String(run.id).slice(1)) || 0;
  if (key === 'where') return run.where?.kind || '';
  return run[key];
}
// Runs in a column's order; empty values last either way.
export function sortRuns(runs: ReadonlyArray<RunRecord>, key = 'started', dir: 'asc' | 'desc' | string = 'desc'): RunRecord[] {
  const sign = dir === 'asc' ? 1 : -1;
  return runs.slice().sort((a, b) => {
    const x = valueOf(a, key), y = valueOf(b, key);
    const empty = (v: unknown): boolean => v === undefined || v === null || v === '';
    if (empty(x) || empty(y)) return Number(empty(x)) - Number(empty(y));
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * sign;
    return String(x).localeCompare(String(y), undefined, { numeric: true }) * sign;
  });
}
export const filterRuns = (runs: ReadonlyArray<RunRecord>, filter = 'all', words = ''): RunRecord[] => {
  const wanted = String(words).trim().toLowerCase();
  return runs.filter(run => (filter === 'all' || run.state === filter || (filter === 'stopped' && run.state === 'timed-out'))
    && (!wanted || [run.id, run.name, run.command, run.scale, ...(run.claims || []), ...(run.tags || [])].some(text => String(text || '').toLowerCase().includes(wanted))));
};

// 0.31, 1,234, 3e-4: short enough for a cell, and exact in its title.
export function shortValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value !== 'number') return String(value);
  if (Number.isInteger(value)) return Math.abs(value) >= 1e6 ? value.toExponential(2) : value.toLocaleString('en-AU');
  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e6)) return value.toExponential(2).replace(/\.?0+e/, 'e');
  return String(Number(value.toPrecision(4)));
}
export function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '';
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`;
  if (seconds < 90) return `${Number(seconds.toPrecision(3))} s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}
export function when(stamp: string | number | Date, now = new Date()): string {
  const at = new Date(stamp);
  if (Number.isNaN(at.getTime())) return '';
  const day = at.toDateString() === now.toDateString() ? '' : at.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', ...(at.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) });
  const time = at.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
  return day ? `${day}, ${time}` : `Today, ${time}`;
}
export function bytes(n: number): string {
  if (!Number.isFinite(n)) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0, v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${i ? v.toFixed(v < 10 ? 1 : 0) : v} ${units[i]}`;
}
export const shortHash = (hash: unknown): string => (typeof hash === 'string' ? hash.slice(0, 10) : '');
export const whereWords = (run: RunRecord): string => `${(run.where?.kind && WHERE_WORDS[run.where.kind]) || 'This Mac'}${run.where?.job ? ` · ${run.where.job}` : ''}`;
// A line through a metric's steps, in a box w × h: the path's d, or '' with fewer than two finite values.
export function sparkPath(steps: ReadonlyArray<readonly [unknown, unknown]> | null | undefined, w = 120, h = 28): string {
  const points = (Array.isArray(steps) ? steps : []).map(([x, y]): [number, number] => [Number(x), Number(y)]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (points.length < 2) return '';
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const sx = (x: number): number => (x1 === x0 ? w / 2 : ((x - x0) / (x1 - x0)) * (w - 2) + 1);
  const sy = (y: number): number => (y1 === y0 ? h / 2 : h - 1 - ((y - y0) / (y1 - y0)) * (h - 2));
  return points.map(([x, y], i) => `${i ? 'L' : 'M'}${sx(x).toFixed(1)} ${sy(y).toFixed(1)}`).join(' ');
}
// A folder as the panel shows it: under your home folder as ~/…
export const homeShort = (folder: unknown, home = ''): string => (home && String(folder).startsWith(`${home}/`) ? `~${String(folder).slice(home.length)}` : String(folder));

// ── Compare (stage 4): two to eight runs side by side, and three charts drawn in inline SVG ──

// One colour per run in a comparison, in this fixed order (validated for the panel's dark surface: every adjacent pair
// clear for colour-blind readers, all at least 3:1). A run keeps its colour while the comparison is open.
export const SERIES = Object.freeze(['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c', '#9085e9', '#e66767'] as const);
export const MAX_COMPARE = SERIES.length;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const same = (values: ReadonlyArray<unknown>): boolean => values.every(v => JSON.stringify(v ?? null) === JSON.stringify(values[0] ?? null));

// The rows of the side-by-side table: every parameter and metric any of the runs has, each with whether they differ.
export function compareRows(runs: ReadonlyArray<RunRecord>): {
  params: Array<{ name: string; values: unknown[]; differs: boolean }>;
  metrics: Array<{ name: string; unit: string | null; values: Array<number | undefined>; differs: boolean }>;
} {
  const names = (field: 'params' | 'metrics'): string[] => [...new Set(runs.flatMap(r => Object.keys(r[field] || {})))];
  return {
    params: names('params').map(name => { const values = runs.map(r => r.params?.[name]); return { name, values, differs: !same(values) }; }),
    metrics: names('metrics').map(name => {
      const entries = runs.map(r => r.metrics?.[name]), values = entries.map(m => m?.value);
      return { name, unit: entries.find(m => m?.unit)?.unit || null, values, differs: !same(values) };
    }),
  };
}
// What can be drawn: metrics with a number in at least one run, those with steps, and parameters that are numbers in two or more.
export function chartable(runs: ReadonlyArray<RunRecord>): { metrics: string[]; stepped: string[]; params: string[] } {
  const { params, metrics } = compareRows(runs);
  return {
    metrics: metrics.filter(m => m.values.some(finite)).map(m => m.name),
    stepped: metrics.filter(m => runs.some(r => (r.metrics?.[m.name]?.steps || []).filter(([x, y]) => finite(x) && finite(y)).length >= 2)).map(m => m.name),
    params: params.filter(p => p.values.filter(finite).length >= 2 && new Set(p.values.filter(finite)).size >= 2).map(p => p.name),
  };
}

// Round ticks covering lo..hi: { lo, hi, ticks }.
export function niceTicks(min: number, max: number, count = 5): { lo: number; hi: number; ticks: number[] } {
  if (!finite(min) || !finite(max)) return { lo: 0, hi: 1, ticks: [0, 0.5, 1] };
  if (min === max) { const pad = Math.abs(min) || 1; min -= pad / 2; max += pad / 2; }
  const raw = (max - min) / Math.max(1, count - 1), mag = 10 ** Math.floor(Math.log10(raw)), frac = raw / mag;
  const step = (frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 2.5 ? 2.5 : frac <= 5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toPrecision(12)));
  return { lo, hi, ticks };
}
export const CHART: Readonly<ChartBox> = Object.freeze({ w: 640, h: 272, left: 56, right: 16, top: 30, bottom: 30 });
const plot = (c: ChartBox = CHART): { x0: number; x1: number; y0: number; y1: number } => ({ x0: c.left, x1: c.w - c.right, y0: c.h - c.bottom, y1: c.top });

// A metric across the runs, as bars from zero: one per run with a number, in the comparison's order.
export function barGeometry(runs: ReadonlyArray<RunRecord>, metric: string, c: ChartBox = CHART): {
  ticks: Array<{ value: number; y: number }>;
  zero: number;
  slot: number;
  x0: number;
  x1: number;
  bars: Array<{ id: string; series: number; value: number; x: number; width: number; y: number; height: number; mid: number }>;
} {
  const p = plot(c);
  const have = runs.map((run, i) => ({ run, i, value: run.metrics?.[metric]?.value }))
    .filter((e): e is { run: RunRecord; i: number; value: number } => finite(e.value));
  const { lo, hi, ticks } = niceTicks(Math.min(0, ...have.map(e => e.value)), Math.max(0, ...have.map(e => e.value)));
  const y = (v: number): number => p.y0 - ((v - lo) / (hi - lo || 1)) * (p.y0 - p.y1), slot = (p.x1 - p.x0) / Math.max(1, runs.length);
  const width = Math.min(56, slot * 0.6), zero = y(0);
  return { ticks: ticks.map(v => ({ value: v, y: y(v) })), zero, slot, x0: p.x0, x1: p.x1,
    bars: have.map(({ run, i, value }) => ({ id: run.id, series: i, value, x: p.x0 + slot * (i + 0.5) - width / 2, width, y: Math.min(y(value), zero), height: Math.max(1, Math.abs(zero - y(value))), mid: p.x0 + slot * (i + 0.5) })) };
}
// A metric against a numeric parameter: one point per run that has both.
// A parameter spread over orders of magnitude (a learning rate from 1e-4 to 1e-2) goes on a log axis, its ticks powers of ten.
export function scatterGeometry(runs: ReadonlyArray<RunRecord>, param: string, metric: string, c: ChartBox = CHART): {
  log: boolean;
  xTicks: Array<{ value: number; x: number }>;
  yTicks: Array<{ value: number; y: number }>;
  points: Array<{ id: string; series: number; xValue: number; yValue: number; x: number; y: number }>;
  labels: Array<{ x: number; y: number; ids: string[] }>;
} {
  const p = plot(c);
  const have = runs.map((run, i) => ({ run, i, x: run.params?.[param], y: run.metrics?.[metric]?.value }))
    .filter((e): e is { run: RunRecord; i: number; x: number; y: number } => finite(e.x) && finite(e.y));
  const xs = have.map(e => e.x), log = xs.length > 1 && Math.min(...xs) > 0 && Math.max(...xs) / Math.min(...xs) >= 20;
  const X = log ? (() => { const lo = Math.floor(Math.log10(Math.min(...xs))), hi = Math.ceil(Math.log10(Math.max(...xs))); return { lo, hi, ticks: Array.from({ length: hi - lo + 1 }, (_, k) => lo + k) }; })()
    : niceTicks(Math.min(...xs), Math.max(...xs));
  const Y = niceTicks(Math.min(...have.map(e => e.y)), Math.max(...have.map(e => e.y)));
  const at = (v: number): number => (log ? Math.log10(v) : v);
  const sx = (v: number): number => p.x0 + ((at(v) - X.lo) / (X.hi - X.lo || 1)) * (p.x1 - p.x0);
  const sy = (v: number): number => p.y0 - ((v - Y.lo) / (Y.hi - Y.lo || 1)) * (p.y0 - p.y1);
  const points = have.map(({ run, i, x, y }) => ({ id: run.id, series: i, xValue: x, yValue: y, x: sx(x), y: sy(y) }));
  // Points within 10 px of each other share one label, so names never sit on top of each other.
  const labels: Array<{ x: number; y: number; ids: string[] }> = [];
  for (const point of points) { const near = labels.find(l => Math.hypot(l.x - point.x, l.y - point.y) < 10); if (near) near.ids.push(point.id); else labels.push({ x: point.x, y: point.y, ids: [point.id] }); }
  return { log, xTicks: X.ticks.map(v => (log ? { value: Number((10 ** v).toPrecision(12)), x: p.x0 + ((v - X.lo) / (X.hi - X.lo || 1)) * (p.x1 - p.x0) } : { value: v, x: sx(v) })), yTicks: Y.ticks.map(v => ({ value: v, y: sy(v) })), points, labels };
}
// A metric's steps, one line per run that logged them, on shared axes.
export function lineGeometry(runs: ReadonlyArray<RunRecord>, metric: string, c: ChartBox = CHART): {
  xTicks: Array<{ value: number; x: number }>;
  yTicks: Array<{ value: number; y: number }>;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  stepAt: (px: number) => number;
  xOf: (v: number) => number;
  lines: Array<{
    id: string;
    series: number;
    steps: RunStep[];
    d: string;
    points: Array<{ step: number; value: number; x: number; y: number }>;
  }>;
} {
  const p = plot(c);
  const series = runs.map((run, i) => ({ run, i, steps: (run.metrics?.[metric]?.steps || []).filter(([x, y]) => finite(x) && finite(y)) })).filter(s => s.steps.length >= 2);
  const xs = series.flatMap(s => s.steps.map(([x]) => x)), ys = series.flatMap(s => s.steps.map(([, y]) => y));
  const X = niceTicks(Math.min(...xs), Math.max(...xs)), Y = niceTicks(Math.min(...ys), Math.max(...ys));
  const sx = (v: number): number => p.x0 + ((v - X.lo) / (X.hi - X.lo || 1)) * (p.x1 - p.x0);
  const sy = (v: number): number => p.y0 - ((v - Y.lo) / (Y.hi - Y.lo || 1)) * (p.y0 - p.y1);
  return { xTicks: X.ticks.map(v => ({ value: v, x: sx(v) })), yTicks: Y.ticks.map(v => ({ value: v, y: sy(v) })), x0: p.x0, x1: p.x1, y0: p.y0, y1: p.y1,
    // For hover: from a position on the x axis back to a step.
    stepAt: px => X.lo + ((px - p.x0) / (p.x1 - p.x0)) * (X.hi - X.lo), xOf: sx,
    lines: series.map(({ run, i, steps }) => ({ id: run.id, series: i, steps, d: steps.map(([x, y], k) => `${k ? 'L' : 'M'}${sx(x).toFixed(1)} ${sy(y).toFixed(1)}`).join(' '), points: steps.map(([x, y]) => ({ step: x, value: y, x: sx(x), y: sy(y) })) })) };
}
// The point of a line nearest a step, for the crosshair's readout.
export function nearestStep<T extends { step: number }>(points: ReadonlyArray<T>, step: number): T | null {
  let best: T | null = null;
  for (const point of points) if (!best || Math.abs(point.step - step) < Math.abs(best.step - step)) best = point;
  return best;
}
