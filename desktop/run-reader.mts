// What the Runs panel reads (docs/tracker-plan.md, stage 3): the projects with runs, a project's runs, and a run's
// figures. Fairy's own runs come from the run store (desktop/runs.mjs); Research's are read from each investigation as
// Proton and Fairy's cluster runs left them (runs/R00N/run.json and .fairy/nexus-runs.json), never copied or changed.
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { cleanRun, type RunRecord, type RunStore } from './runs.mjs';

export interface ReaderRunRecord extends RunRecord {
  label?: string;
}

export interface RunReaderProject {
  folder: string;
  title: string;
  kind: 'evals' | 'project' | 'investigation';
  count: number;
  latest: string;
  running: number;
}

export interface RunReaderListResult {
  folder: string;
  kind: 'investigation' | 'project';
  runs: ReaderRunRecord[];
}

export interface RunReaderFigureResult {
  url: string;
  bytes: number;
}

export interface RunReaderOptions {
  store: Pick<RunStore, 'all' | 'list'>;
  research?: () => string;
  titles?: Record<string, string>;
}

export interface RunReader {
  projects(): Promise<RunReaderProject[]>;
  list(folder: string): Promise<RunReaderListResult>;
  figure(folder: string, id: string, path: string): Promise<RunReaderFigureResult>;
}

const IMAGE: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
export const MAX_FIGURE = 15 * 1024 * 1024, MAX_PRINTOUT = 8000;
const PROTON_STATES: Record<string, string> = { running: 'running', done: 'done', failed: 'failed', timed_out: 'timed-out', stopped: 'stopped' };
const json = async (path: string, limit = 2 * 1024 * 1024): Promise<unknown> => {
  try { const info = await stat(path); if (!info.isFile() || info.size > limit) return null; return JSON.parse(await readFile(path, 'utf8')) as unknown; } catch { return null; }
};
const tail = async (path: string, size = MAX_PRINTOUT): Promise<string> => { try { const text = await readFile(path, 'utf8'); return text.length > size ? text.slice(-size) : text; } catch { return ''; } };
const inside = (parent: string, child: string): boolean => { const rel = relative(parent, child); return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)); };

// One of Proton's Lab runs (runs/R00N/), as a run: its metrics, figures and the end of its printout.
export async function protonRun(investigation: string, dir: string): Promise<ReaderRunRecord | null> {
  const rawRecord = await json(join(investigation, 'runs', dir, 'run.json'));
  if (!rawRecord || typeof rawRecord !== 'object') return null;
  const record = rawRecord as Record<string, unknown>;
  if (typeof record.id !== 'string') return null;
  const metrics = await json(join(investigation, 'runs', dir, 'metrics.json')) || {};
  let figures: string[] = [];
  try { figures = (await readdir(join(investigation, 'runs', dir, 'figures'))).filter(name => IMAGE[extname(name).toLowerCase()]).sort().slice(0, 24); } catch {}
  const about = (record.about && typeof record.about === 'object' ? record.about : {}) as Record<string, unknown>;
  const code = record.code && typeof record.code === 'object' ? (record.code as Record<string, unknown>) : null;
  const stateKey = typeof record.state === 'string' ? record.state : '';
  const run = cleanRun({ id: /^R\d+$/.test(record.id) ? `R${Number(record.id.slice(1))}` : 'R0', name: [about.experiment, about.hypothesis].filter(Boolean).join(' · '), project: investigation,
    command: code?.file ? `python ${code.file}` : '', code: code?.sha256 ? { entry: { file: code.file || 'main.py', sha256: code.sha256 } } : {},
    metrics, files: figures.map(name => ({ path: `runs/${dir}/figures/${name}`, figure: true })), where: { kind: 'lab' },
    state: PROTON_STATES[stateKey] || 'stopped', exit: record.exit, started: record.started, ended: record.ended, seconds: record.seconds, folder: `runs/${dir}` });
  if (!run) return null;
  const labeled: ReaderRunRecord = Object.assign(run, { label: record.id });
  labeled.printout = await tail(join(investigation, 'runs', dir, 'stdout.txt'));
  return labeled;
}
// One of Fairy's cluster runs for Research (.fairy/nexus-runs.json), as a run.
export async function researchClusterRun(investigation: string, rawEntry: unknown, n: number): Promise<ReaderRunRecord | null> {
  if (!rawEntry || typeof rawEntry !== 'object') return null;
  const entry = rawEntry as Record<string, unknown>;
  if (typeof entry.job !== 'string') return null;
  const outputs = typeof entry.outputs === 'string' ? join(investigation, entry.outputs) : '';
  const metrics = outputs && inside(investigation, outputs) ? await json(join(outputs, 'metrics.json')) || {} : {};
  let figures: string[] = [];
  if (outputs && inside(investigation, outputs)) try { figures = (await readdir(join(outputs, 'figures'))).filter(name => IMAGE[extname(name).toLowerCase()]).sort().slice(0, 24); } catch {}
  const run = cleanRun({ id: `R${n}`, name: [entry.experiment, entry.hypothesis].filter(Boolean).join(' · '), project: investigation, command: 'python run_nexus.py',
    metrics, files: figures.map(name => ({ path: `${entry.outputs}/figures/${name}`, figure: true })), where: { kind: entry.machine === 'forge' ? 'forge' : 'atlas', job: entry.job },
    state: entry.state === 'done' ? 'done' : entry.state === 'failed' ? 'failed' : 'running', exit: entry.exit, started: entry.submitted, ended: entry.ended, folder: entry.outputs || entry.folder || '' });
  if (!run) return null;
  const labeled: ReaderRunRecord = Object.assign(run, { label: entry.job });
  labeled.printout = outputs && inside(investigation, outputs) ? await tail(join(outputs, 'stdout.txt')) : '';
  return labeled;
}

// store: the RunStore; research: () => the folder investigations live in, or '' where there's none.
// titles: a name for a folder that isn't a project's, such as Fairy's own evals folder (Saved evals).
export function runReader({ store, research = () => '', titles = {} }: RunReaderOptions): RunReader {
  async function investigations(): Promise<Array<{ folder: string; lab: string[]; cluster: unknown[] }>> {
    const root = research();
    if (!root) return [];
    let names: string[] = [];
    try { names = await readdir(root); } catch { return []; }
    const found: Array<{ folder: string; lab: string[]; cluster: unknown[] }> = [];
    for (const name of names.filter(n => !n.startsWith('.')).sort()) {
      const folder = join(root, name);
      let lab: string[] = [], cluster: unknown[] = [];
      try { lab = (await readdir(join(folder, 'runs'))).filter(n => /^R\d+$/.test(n)); } catch {}
      const sent = await json(join(folder, '.fairy', 'nexus-runs.json'));
      if (Array.isArray(sent)) cluster = sent;
      if (lab.length || cluster.length) found.push({ folder, lab, cluster });
    }
    return found;
  }
  async function researchRuns(folder: string): Promise<ReaderRunRecord[] | null> {
    const found = (await investigations()).find(entry => entry.folder === folder);
    if (!found) return null;
    const runs: ReaderRunRecord[] = [];
    for (const dir of found.lab.sort()) { const run = await protonRun(folder, dir); if (run) runs.push(run); }
    let n = 0;
    for (const entry of found.cluster) { const run = await researchClusterRun(folder, entry, ++n); if (run) { run.id = `C${n}`; runs.push(run); } }
    return runs.sort((a, b) => String(b.started).localeCompare(String(a.started)));
  }
  const latest = (runs: readonly RunRecord[]): string => runs.map(r => r.started).filter(Boolean).sort().at(-1) || '';
  return {
    // Every project with runs, newest first: { folder, title, kind: 'project' | 'investigation', count, latest, running }.
    async projects(): Promise<RunReaderProject[]> {
      const out: RunReaderProject[] = [];
      for (const { folder, runs } of await store.all()) if (runs.length) out.push({ folder, title: titles[folder] || basename(folder), kind: titles[folder] ? 'evals' : 'project', count: runs.length, latest: latest(runs), running: runs.filter(r => r.state === 'running').length });
      for (const { folder } of await investigations()) {
        const runs = await researchRuns(folder) || [];
        if (runs.length) out.push({ folder, title: basename(folder), kind: 'investigation', count: runs.length, latest: latest(runs), running: runs.filter(r => r.state === 'running').length });
      }
      return out.sort((a, b) => b.latest.localeCompare(a.latest));
    },
    // A project's runs, newest first, and whether they're Research's (read only).
    async list(folder: string): Promise<RunReaderListResult> {
      if (typeof folder !== 'string' || !isAbsolute(folder)) throw new Error('Choose a project.');
      const research = await researchRuns(folder);
      if (research) return { folder, kind: 'investigation', runs: research };
      return { folder, kind: 'project', runs: await store.list(folder) };
    },
    // A figure a run made, as a data URL for the panel: only a file the run lists as a picture, in its project or its
    // outputs, at most 15 MB.
    async figure(folder: string, id: string, path: string): Promise<RunReaderFigureResult> {
      const { runs } = await this.list(folder);
      const run = runs.find(r => r.id === id);
      const file = run?.files.find(f => f.path === path && f.figure);
      const type = IMAGE[extname(String(path)).toLowerCase()];
      if (!file || !type) throw new Error('That isn’t one of the run’s pictures.');
      const full = isAbsolute(file.path) ? file.path : resolve(folder, file.path);
      if (!isAbsolute(file.path) && !inside(folder, full)) throw new Error('That isn’t one of the run’s pictures.');
      const info = await stat(full).catch(() => null);
      if (!info?.isFile()) throw new Error('That picture isn’t there any more.');
      if (info.size > MAX_FIGURE) throw new Error('That picture is over 15 MB, too big to show here.');
      return { url: `data:${type};base64,${(await readFile(full)).toString('base64')}`, bytes: info.size };
    },
  };
}
