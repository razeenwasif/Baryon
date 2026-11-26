// What the Runs panel reads (docs/tracker-plan.md, stage 3): the projects with runs, a project's runs, and a run's
// figures. Fairy's own runs come from the run store (desktop/runs.mjs); Research's are read from each investigation as
// Proton and Fairy's cluster runs left them (runs/R00N/run.json and .fairy/nexus-runs.json), never copied or changed.
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { cleanRun } from './runs.mjs';

const IMAGE = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
export const MAX_FIGURE = 15 * 1024 * 1024, MAX_PRINTOUT = 8000;
const PROTON_STATES = { running: 'running', done: 'done', failed: 'failed', timed_out: 'timed-out', stopped: 'stopped' };
const json = async (path, limit = 2 * 1024 * 1024) => {
  try { const info = await stat(path); if (!info.isFile() || info.size > limit) return null; return JSON.parse(await readFile(path, 'utf8')); } catch { return null; }
};
const tail = async (path, size = MAX_PRINTOUT) => { try { const text = await readFile(path, 'utf8'); return text.length > size ? text.slice(-size) : text; } catch { return ''; } };
const inside = (parent, child) => { const rel = relative(parent, child); return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)); };

// One of Proton's Lab runs (runs/R00N/), as a run: its metrics, figures and the end of its printout.
export async function protonRun(investigation, dir) {
  const record = await json(join(investigation, 'runs', dir, 'run.json'));
  if (!record || typeof record.id !== 'string') return null;
  const metrics = await json(join(investigation, 'runs', dir, 'metrics.json')) || {};
  let figures = [];
  try { figures = (await readdir(join(investigation, 'runs', dir, 'figures'))).filter(name => IMAGE[extname(name).toLowerCase()]).sort().slice(0, 24); } catch {}
  const about = record.about && typeof record.about === 'object' ? record.about : {};
  const run = cleanRun({ id: /^R\d+$/.test(record.id) ? `R${Number(record.id.slice(1))}` : 'R0', name: [about.experiment, about.hypothesis].filter(Boolean).join(' · '), project: investigation,
    command: record.code?.file ? `python ${record.code.file}` : '', code: record.code?.sha256 ? { entry: { file: record.code.file || 'main.py', sha256: record.code.sha256 } } : {},
    metrics, files: figures.map(name => ({ path: `runs/${dir}/figures/${name}`, figure: true })), where: { kind: 'lab' },
    state: PROTON_STATES[record.state] || 'stopped', exit: record.exit, started: record.started, ended: record.ended, seconds: record.seconds, folder: `runs/${dir}` });
  if (!run) return null;
  run.label = record.id; run.printout = await tail(join(investigation, 'runs', dir, 'stdout.txt'));
  return run;
}
// One of Fairy's cluster runs for Research (.fairy/nexus-runs.json), as a run.
export async function researchClusterRun(investigation, entry, n) {
  if (!entry || typeof entry.job !== 'string') return null;
  const outputs = typeof entry.outputs === 'string' ? join(investigation, entry.outputs) : '';
  const metrics = outputs && inside(investigation, outputs) ? await json(join(outputs, 'metrics.json')) || {} : {};
  let figures = [];
  if (outputs && inside(investigation, outputs)) try { figures = (await readdir(join(outputs, 'figures'))).filter(name => IMAGE[extname(name).toLowerCase()]).sort().slice(0, 24); } catch {}
  const run = cleanRun({ id: `R${n}`, name: [entry.experiment, entry.hypothesis].filter(Boolean).join(' · '), project: investigation, command: 'python run_nexus.py',
    metrics, files: figures.map(name => ({ path: `${entry.outputs}/figures/${name}`, figure: true })), where: { kind: entry.machine === 'forge' ? 'forge' : 'atlas', job: entry.job },
    state: entry.state === 'done' ? 'done' : entry.state === 'failed' ? 'failed' : 'running', exit: entry.exit, started: entry.submitted, ended: entry.ended, folder: entry.outputs || entry.folder || '' });
  if (!run) return null;
  run.label = entry.job; run.printout = outputs && inside(investigation, outputs) ? await tail(join(outputs, 'stdout.txt')) : '';
  return run;
}

// store: the RunStore; research: () => the folder investigations live in, or '' where there's none.
// titles: a name for a folder that isn't a project's, such as Fairy's own evals folder (Saved evals).
export function runReader({ store, research = () => '', titles = {} }) {
  async function investigations() {
    const root = research();
    if (!root) return [];
    let names = [];
    try { names = await readdir(root); } catch { return []; }
    const found = [];
    for (const name of names.filter(n => !n.startsWith('.')).sort()) {
      const folder = join(root, name);
      let lab = [], cluster = [];
      try { lab = (await readdir(join(folder, 'runs'))).filter(n => /^R\d+$/.test(n)); } catch {}
      const sent = await json(join(folder, '.fairy', 'nexus-runs.json'));
      if (Array.isArray(sent)) cluster = sent;
      if (lab.length || cluster.length) found.push({ folder, lab, cluster });
    }
    return found;
  }
  async function researchRuns(folder) {
    const found = (await investigations()).find(entry => entry.folder === folder);
    if (!found) return null;
    const runs = [];
    for (const dir of found.lab.sort()) { const run = await protonRun(folder, dir); if (run) runs.push(run); }
    let n = 0;
    for (const entry of found.cluster) { const run = await researchClusterRun(folder, entry, ++n); if (run) { run.id = `C${n}`; runs.push(run); } }
    return runs.sort((a, b) => String(b.started).localeCompare(String(a.started)));
  }
  const latest = runs => runs.map(r => r.started).filter(Boolean).sort().at(-1) || '';
  return {
    // Every project with runs, newest first: { folder, title, kind: 'project' | 'investigation', count, latest, running }.
    async projects() {
      const out = [];
      for (const { folder, runs } of await store.all()) if (runs.length) out.push({ folder, title: titles[folder] || basename(folder), kind: titles[folder] ? 'evals' : 'project', count: runs.length, latest: latest(runs), running: runs.filter(r => r.state === 'running').length });
      for (const { folder } of await investigations()) {
        const runs = await researchRuns(folder) || [];
        if (runs.length) out.push({ folder, title: basename(folder), kind: 'investigation', count: runs.length, latest: latest(runs), running: runs.filter(r => r.state === 'running').length });
      }
      return out.sort((a, b) => b.latest.localeCompare(a.latest));
    },
    // A project's runs, newest first, and whether they're Research's (read only).
    async list(folder) {
      if (typeof folder !== 'string' || !isAbsolute(folder)) throw new Error('Choose a project.');
      const research = await researchRuns(folder);
      if (research) return { folder, kind: 'investigation', runs: research };
      return { folder, kind: 'project', runs: await store.list(folder) };
    },
    // A figure a run made, as a data URL for the panel: only a file the run lists as a picture, in its project or its
    // outputs, at most 15 MB.
    async figure(folder, id, path) {
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
