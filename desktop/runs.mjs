// The experiment tracker (docs/tracker-plan.md): every experiment Fairy runs for you becomes a run you can find again,
// with the code that ran, its parameters, the numbers it found, the files it made and where it ran. Records follow
// Proton's run.json, so Research's runs read in as they are, and live in Fairy's own data folder, one file per project,
// never in the project: an agent editing the project can't rewrite a run's numbers. A run's files stay where it wrote
// them; the record keeps their hashes.
//
// Stage 1: the store, the code's state, and runs made in a work session with run_experiment (desktop/work-tools.mjs).
// Stage 2: jobs sent to atlas and forge with nexus_run, recorded when sent and settled when their outputs come back,
// fetched by nexus_outputs or by a watcher on the job (settleJob).
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { hasFeature, optionalImport } from './edition.mjs';

const reproRunsMod = hasFeature('reproduce') ? await optionalImport('./reproduce/runs.mjs', import.meta.url) : null;
const cleanLimitHours = reproRunsMod?.cleanLimitHours || (() => null);
const cleanRunClaims = reproRunsMod?.cleanRunClaims || (() => []);
const cleanRunScale = reproRunsMod?.cleanRunScale || (() => '');
const cleanScaleNote = reproRunsMod?.cleanScaleNote || (() => '');

export const STATES = Object.freeze(['running', 'done', 'failed', 'timed-out', 'stopped']);
export const MAX_RUNS = 2000, MAX_PARAMS = 100, MAX_METRICS = 200, MAX_STEPS = 10000, MAX_FILES = 500, MAX_HASHED = 200 * 1024 * 1024, MAX_JSON = 2 * 1024 * 1024;
// Where a run's own folder sits in its project; its .gitignore keeps everything in it out of git.
export const RUN_FOLDER = '.fairy/runs';
const FIGURE = /\.(?:png|jpe?g|svg|pdf|gif|webp)$/i;
const text = (value, limit) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
const STAMP = value => (typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value.slice(0, 40) : '');
const key = folder => createHash('sha256').update(folder).digest('hex').slice(0, 16);

// A parameter's value as a record keeps it: a finite number, true or false, or short text.
function value(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : String(v);
  if (typeof v === 'boolean') return v;
  if (v === null || v === undefined) return null;
  return text(typeof v === 'object' ? JSON.stringify(v) : v, 200);
}
const NAME = /^[\p{L}\p{N}_.\-/ :@]{1,80}$/u;
export function cleanParams(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter(([name]) => NAME.test(name)).slice(0, MAX_PARAMS).map(([name, v]) => [name, value(v)]));
}
// Metrics as Proton keeps them, { name: { value, unit } }, with a series of [step, value] when the run logged steps.
export function cleanMetrics(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [name, entry] of Object.entries(raw).filter(([n]) => NAME.test(n)).slice(0, MAX_METRICS)) {
    const plain = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : { value: entry };
    const m = { value: value(plain.value), unit: plain.unit == null ? null : text(plain.unit, 24) || null };
    if (Array.isArray(plain.steps)) {
      const steps = plain.steps.filter(s => Array.isArray(s) && s.length >= 2).slice(-MAX_STEPS).map(([step, v]) => [value(step), value(v)]);
      if (steps.length) m.steps = steps;
    }
    out[name] = m;
  }
  return out;
}

// --name=value and --name value in a command, as parameters a run didn't record itself. Numbers stay numbers.
export function flagParams(command) {
  const out = {};
  // Words, quoted parts kept whole, with ; & and | as words of their own so a value never runs into the next command.
  const words = String(command ?? '').match(/(?:[^\s;&|"']|"[^"]*"|'[^']*')+|[;&|]+/g) || [];
  const plain = w => w.replace(/^(['"])(.*)\1$/, '$2');
  const typed = v => (/^-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(v) ? Number(v) : v === 'true' || v === 'false' ? v === 'true' : v);
  for (let i = 0; i < words.length; i++) {
    const m = /^--([A-Za-z][\w.-]{0,60})(?:=(.*))?$/.exec(plain(words[i]));
    if (!m) continue;
    if (m[2] !== undefined) out[m[1]] = typed(plain(m[2]));
    else if (i + 1 < words.length && !/^--?[A-Za-z]/.test(plain(words[i + 1])) && !/^[;&|]/.test(words[i + 1])) out[m[1]] = typed(plain(words[++i]));
    else out[m[1]] = true;
    if (Object.keys(out).length >= MAX_PARAMS) break;
  }
  return out;
}

export async function hashFile(path, { limit = MAX_HASHED } = {}) {
  const info = await stat(path);
  if (!info.isFile()) return null;
  if (info.size > limit) return { bytes: info.size, sha256: null };
  return new Promise((done, fail) => {
    const hash = createHash('sha256');
    createReadStream(path).on('data', chunk => hash.update(chunk)).on('error', fail).on('end', () => done({ bytes: info.size, sha256: hash.digest('hex') }));
  });
}
const git = (root, args, run) => run('git', ['-C', root, ...args]);
const execGit = (cmd, args) => new Promise(done => execFile(cmd, args, { timeout: 15000, maxBuffer: 8 * 1024 * 1024, env: { PATH: '/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin', GIT_TERMINAL_PROMPT: '0', LANG: 'en_US.UTF-8' } },
  (error, stdout) => done(error ? null : String(stdout))));
// The first file a command names that exists in the project, such as train.py: what ran, outside git.
export function entryOf(command) {
  const words = (String(command ?? '').match(/"[^"]*"|'[^']*'|\S+/g) || []).map(w => w.replace(/^(['"])(.*)\1$/, '$2'));
  return words.find(w => /\.(?:py|js|mjs|cjs|ts|sh|r|jl|rb|lua|m)$/i.test(w) && !w.startsWith('-')) || '';
}
// The code's state before a run: the commit, whether anything was uncommitted (each such file's hash), and the entry
// script's hash, so a run says exactly what ran. Outside git, only the entry script.
export async function codeState(root, command, { run = execGit } = {}) {
  const code = {};
  const commit = (await git(root, ['rev-parse', 'HEAD'], run))?.trim();
  if (commit && /^[0-9a-f]{40,64}$/.test(commit)) {
    code.commit = commit;
    const branch = (await git(root, ['rev-parse', '--abbrev-ref', 'HEAD'], run))?.trim();
    if (branch && branch !== 'HEAD') code.branch = text(branch, 200);
    const status = (await git(root, ['status', '--porcelain', '-z', '--untracked-files=all'], run)) ?? '';
    const changed = [];
    for (const entry of status.split('\0').filter(Boolean)) {
      const path = entry.slice(3);
      if (!path || path.startsWith(`${RUN_FOLDER}/`) || changed.length >= MAX_FILES) continue;
      const full = resolve(root, path);
      let hash = null;
      try { hash = await hashFile(full); } catch {}
      changed.push({ path, ...(hash ? hash : { gone: true }) });
    }
    code.dirty = changed.length > 0;
    if (changed.length) code.changed = changed;
  }
  const entry = entryOf(command);
  if (entry) {
    const full = resolve(root, entry), rel = relative(root, full);
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) {
      try { const hash = await hashFile(full); if (hash?.sha256) code.entry = { file: rel.split(sep).join('/'), sha256: hash.sha256 }; } catch {}
    }
  }
  return code;
}

// A record as it may be kept, or null when it isn't one.
export function cleanRun(raw) {
  if (!raw || typeof raw !== 'object' || !/^R\d{1,6}$/.test(raw.id)) return null;
  const where = raw.where && typeof raw.where === 'object' ? raw.where : {};
  const limitHours = cleanLimitHours(where.limitHours);
  const claims = cleanRunClaims(raw.claims);
  const scale = cleanRunScale(raw.scale);
  const scaleNote = cleanScaleNote(raw.scaleNote);
  const files = (Array.isArray(raw.files) ? raw.files : []).filter(f => f && typeof f.path === 'string').slice(0, MAX_FILES)
    .map(f => ({ path: text(f.path, 500), bytes: Number.isFinite(f.bytes) ? f.bytes : null, sha256: typeof f.sha256 === 'string' && /^[0-9a-f]{64}$/.test(f.sha256) ? f.sha256 : null, ...(f.figure ? { figure: true } : {}), ...(f.change === 'changed' ? { change: 'changed' } : {}) }));
  return { id: raw.id, name: text(raw.name, 80), project: text(raw.project, 1000), command: String(raw.command ?? '').slice(0, 8000), code: raw.code && typeof raw.code === 'object' ? raw.code : {},
    params: cleanParams(raw.params), metrics: cleanMetrics(raw.metrics), files,
    where: { kind: ['here', 'outside', 'atlas', 'forge', 'lab'].includes(where.kind) ? where.kind : 'here', ...(typeof where.job === 'string' ? { job: text(where.job, 64) } : {}), ...(limitHours ? { limitHours } : {}) },
    ...(claims.length ? { claims } : {}), ...(scale ? { scale } : {}), ...(scaleNote ? { scaleNote } : {}),
    state: STATES.includes(raw.state) ? raw.state : 'stopped', exit: Number.isInteger(raw.exit) ? raw.exit : null, started: STAMP(raw.started), ended: STAMP(raw.ended),
    seconds: Number.isFinite(raw.seconds) ? Math.round(raw.seconds * 10) / 10 : null, folder: text(raw.folder, 500),
    from: raw.from && typeof raw.from === 'object' ? { chat: text(raw.from.chat, 80), ...(raw.from.title ? { title: text(raw.from.title, 120) } : {}) } : null,
    printout: String(raw.printout ?? '').slice(-8000), notes: String(raw.notes ?? '').slice(0, 4000), tags: (Array.isArray(raw.tags) ? raw.tags : []).map(t => text(t, 40)).filter(Boolean).slice(0, 20) };
}

// Runs by project, one JSON file each in Fairy's data folder: { folder, next, runs }. Writes are queued per file.
// helperPath: fairy_track.py, copied beside each run; git: how git is asked (a stand-in in tests).
export class RunStore {
  constructor({ dir, helperPath = '', git: run = execGit, now = () => new Date() }) { Object.assign(this, { dir, helperPath, git: run, now }); this.queue = new Map(); }
  codeState(root, command) { return codeState(root, command, { run: this.git }); }
  async helper() { if (!this.helperPath) return ''; this.helperText ??= await readFile(this.helperPath, 'utf8'); return this.helperText; }
  path(folder) { return join(this.dir, `${key(folder)}.json`); }
  async read(folder) {
    try {
      const raw = JSON.parse(await readFile(this.path(folder), 'utf8'));
      return { folder, next: Number.isInteger(raw.next) && raw.next > 0 ? raw.next : 1, runs: (Array.isArray(raw.runs) ? raw.runs : []).map(cleanRun).filter(Boolean) };
    } catch { return { folder, next: 1, runs: [] }; }
  }
  // Changes one project's file under its own queue: change(project) returns what to hand back.
  change(folder, change) {
    const before = this.queue.get(folder) || Promise.resolve();
    const done = before.then(async () => {
      const project = await this.read(folder), result = await change(project);
      await mkdir(this.dir, { recursive: true, mode: 0o700 });
      const path = this.path(folder), temp = `${path}.${process.pid}.tmp`;
      await writeFile(temp, JSON.stringify(project), { mode: 0o600 });
      await rename(temp, path);
      return result;
    });
    this.queue.set(folder, done.catch(() => {}));
    return done;
  }
  // A new run, running: its id and the folder it writes to in the project.
  start(folder, { name = '', command = '', params = {}, code = {}, where = { kind: 'here' }, from = null, at = '', claims = [], scale = '', scaleNote = '', tags = [] } = {}) {
    return this.change(folder, project => {
      if (project.runs.length >= MAX_RUNS) throw new Error(`That project has ${MAX_RUNS} runs, the most Fairy keeps. Delete some in Experiments first.`);
      const id = `R${project.next++}`;
      const run = cleanRun({ id, name, project: folder, command, code, params, where, from, claims, scale, scaleNote, tags, state: 'running', started: this.now().toISOString(), folder: at || `${RUN_FOLDER}/${id}` });
      project.runs.push(run);
      return run;
    });
  }
  // A run's end. Once it has ended, its numbers stay as they are.
  // seconds: how long it ran, or null when that isn't known (a cluster job's wait for your Accept isn't its run).
  finish(folder, id, { state = 'done', exit = null, params = {}, metrics = {}, files = [], seconds, printout = '' } = {}) {
    return this.change(folder, project => {
      const run = project.runs.find(r => r.id === id);
      if (!run) throw new Error(`There’s no run ${id}.`);
      if (run.state !== 'running') throw new Error(`Run ${id} has already ended.`);
      const ended = this.now();
      Object.assign(run, cleanRun({ ...run, state: STATES.includes(state) && state !== 'running' ? state : 'stopped', exit, params: { ...run.params, ...params }, metrics, files, printout,
        ended: ended.toISOString(), seconds: seconds !== undefined ? seconds : Date.parse(run.started) ? (ended - Date.parse(run.started)) / 1000 : null }));
      return run;
    });
  }
  // What you can change on any run: its name, notes and tags. Never its numbers.
  annotate(folder, id, { name, notes, tags } = {}) {
    return this.change(folder, project => {
      const run = project.runs.find(r => r.id === id);
      if (!run) throw new Error(`There’s no run ${id}.`);
      Object.assign(run, cleanRun({ ...run, ...(name !== undefined ? { name } : {}), ...(notes !== undefined ? { notes } : {}), ...(tags !== undefined ? { tags } : {}) }));
      return run;
    });
  }
  remove(folder, id) {
    return this.change(folder, project => {
      if (!project.runs.some(r => r.id === id)) throw new Error(`There’s no run ${String(id).slice(0, 20)}.`);
      project.runs = project.runs.filter(r => r.id !== id); return project.runs.length;
    });
  }
  async list(folder) { return (await this.read(folder)).runs.slice().reverse(); }
  // Every project's runs: [{ folder, runs }].
  async all() {
    let names = [];
    try { names = (await readdir(this.dir)).filter(name => /^[0-9a-f]{16}\.json$/.test(name)); } catch { return []; }
    const out = [];
    for (const name of names) {
      try { const raw = JSON.parse(await readFile(join(this.dir, name), 'utf8')); if (typeof raw.folder === 'string') out.push({ folder: raw.folder, runs: (await this.read(raw.folder)).runs.slice().reverse() }); } catch {}
    }
    return out;
  }
  // The running run that is this Nexus job, in whichever project: { folder, run } or null.
  async findJob(job) {
    let names = [];
    try { names = (await readdir(this.dir)).filter(name => /^[0-9a-f]{16}\.json$/.test(name)); } catch { return null; }
    for (const name of names) {
      let raw;
      try { raw = JSON.parse(await readFile(join(this.dir, name), 'utf8')); } catch { continue; }
      const found = (Array.isArray(raw.runs) ? raw.runs : []).find(r => r?.where?.job === job);
      if (found && typeof raw.folder === 'string') return { folder: raw.folder, run: cleanRun(found) };
    }
    return null;
  }
  // A Nexus job's run, settled from its outputs folder once the job has ended: what it reported in params.json and
  // metrics.json, and every other file with its hash. Paths are the project's when the outputs are in it (nexus_outputs),
  // and full paths when they're in Fairy's own folder (a watcher). exit: the job's, or null when Nexus didn't say.
  async settleJob(job, { outputs = '', exit = null, printout = '', seconds = null } = {}) {
    const found = await this.findJob(job);
    if (!found || found.run.state !== 'running') return null;
    const reported = outputs ? await readRunFolder(outputs) : { params: {}, metrics: {} };
    const inside = Boolean(outputs) && !relative(found.folder, outputs).startsWith('..') && !isAbsolute(relative(found.folder, outputs));
    const files = [], walk = async (dir, depth) => {
      let entries = [];
      try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (files.length >= MAX_FILES) return;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) { if (depth < 8) await walk(path, depth + 1); continue; }
        if (!entry.isFile() || (dir === outputs && ['params.json', 'metrics.json'].includes(entry.name))) continue;
        let hash = null;
        try { hash = await hashFile(path); } catch {}
        if (hash) files.push({ path: inside ? relative(found.folder, path).split(sep).join('/') : path, bytes: hash.bytes, sha256: hash.sha256, ...(FIGURE.test(entry.name) ? { figure: true } : {}) });
      }
    };
    if (outputs) await walk(outputs, 0);
    const measured = Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
    return this.finish(found.folder, found.run.id, { state: exit === null || exit === 0 ? 'done' : 'failed', exit: Number.isInteger(exit) ? exit : null, params: reported.params, metrics: reported.metrics, files, seconds: measured, printout });
  }
  async get(folder, id) { return (await this.read(folder)).runs.find(r => r.id === id) || null; }
}

// What a run left: its own params.json and metrics.json, read as data (at most 2 MB each), never run.
export async function readRunFolder(dir) {
  const json = async name => {
    try {
      const path = join(dir, name), info = await stat(path);
      if (!info.isFile() || info.size > MAX_JSON) return {};
      const value = JSON.parse(await readFile(path, 'utf8'));
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch { return {}; }
  };
  return { params: cleanParams(await json('params.json')), metrics: cleanMetrics(await json('metrics.json')) };
}

// The files a run made or changed: what differs between two snapshots of the project (desktop/watchers.mjs), each with
// its size and hash. Its own params.json and metrics.json are the record already.
export async function madeFiles(root, before, after, { runFolder = '' } = {}) {
  const out = [];
  const own = new Set(['params.json', 'metrics.json', 'fairy_track.py', '.gitignore'].map(name => `${runFolder}/${name}`));
  const touched = [...after].filter(([name, mark]) => before.get(name) !== mark).map(([name]) => name).filter(name => !own.has(name) && !name.endsWith('.tmp'));
  for (const path of touched.sort().slice(0, MAX_FILES)) {
    let hash = null;
    try { hash = await hashFile(join(root, path)); } catch {}
    if (!hash) continue;
    out.push({ path, bytes: hash.bytes, sha256: hash.sha256, ...(FIGURE.test(path) ? { figure: true } : {}), ...(before.has(path) ? { change: 'changed' } : {}) });
  }
  return out;
}

// The run's folder in the project, with the helper beside it and everything in it kept out of git.
export async function prepareRunFolder(root, id, helper) {
  const base = join(root, RUN_FOLDER), dir = join(base, id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(base, '.gitignore'), '*\n').catch(() => {});
  if (helper) await writeFile(join(dir, 'fairy_track.py'), helper);
  return dir;
}
export const removeRunFolder = dir => rm(dir, { recursive: true, force: true });

// A run in a line, for a tool's answer and a notification: R12 “lr 3e-4” done in 41 s: loss 0.31, acc 92.4 %.
export function runLine(run) {
  const metrics = Object.entries(run.metrics || {}).slice(0, 8).map(([name, m]) => `${name} ${m.value}${m.unit ? ` ${m.unit}` : ''}`);
  const repro = [run.scale ? `[${run.scale}]` : '', Array.isArray(run.claims) && run.claims.length ? `claims ${run.claims.join(', ')}` : ''].filter(Boolean).join(' ');
  return `${run.id}${run.name ? ` “${run.name}”` : ''}${repro ? ` ${repro}` : ''} ${run.state}${run.exit !== null && run.exit !== undefined && run.state !== 'done' ? ` (exit ${run.exit})` : ''}${run.seconds !== null && run.seconds !== undefined ? ` in ${run.seconds} s` : ''}${metrics.length ? `: ${metrics.join(', ')}` : ''}`;
}
export const runName = (name, command) => text(name, 80) || text(basename(entryOf(command) || '') || String(command ?? '').split(/\s+/)[0], 80);

// ── In chats (stage 5): runs read as text for a model, and runs named in an answer linked to their page ──

const short = v => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(4)))) : v === null || v === undefined ? '–' : String(v).slice(0, 40));
// A project's runs, newest first, one line each: what a model needs to pick runs to look at or compare.
export function runsListText(runs, { state = '', search = '', limit = 20 } = {}) {
  const words = String(search || '').toLowerCase();
  const shown = runs.filter(r => (!state || r.state === state) && (!words || [r.id, r.name, r.command, r.scale, ...(r.claims || []), ...(r.tags || [])].some(t => String(t || '').toLowerCase().includes(words))));
  if (!shown.length) return runs.length ? 'No runs match.' : 'This project has no runs yet.';
  const lines = shown.slice(0, Math.max(1, Math.min(100, Number(limit) || 20))).map(r => {
    const params = Object.entries(r.params || {}).slice(0, 8).map(([k, v]) => `${k}=${short(v)}`).join(' ');
    const metrics = Object.entries(r.metrics || {}).slice(0, 8).map(([k, m]) => `${k} ${short(m.value)}${m.unit ? ` ${m.unit}` : ''}`).join(', ');
    const repro = [r.scale ? `scale ${r.scale}` : '', r.claims?.length ? `claims ${r.claims.join(', ')}` : ''].filter(Boolean).join(' · ');
    return `${r.id}${r.name ? ` “${r.name}”` : ''} · ${r.state}${repro ? ` · ${repro}` : ''}${r.where?.kind && r.where.kind !== 'here' ? ` on ${r.where.kind}` : ''} · ${(r.started || '').slice(0, 16).replace('T', ' ')}${params ? ` · ${params}` : ''}${metrics ? ` · ${metrics}` : ''}${r.tags?.length ? ` · tags ${r.tags.join(', ')}` : ''}`;
  });
  return `${lines.join('\n')}${shown.length > lines.length ? `\n… and ${shown.length - lines.length} more` : ''}`;
}
// Two to eight runs side by side as a Markdown table: every parameter and metric, those that differ marked *.
export function runsCompareText(runs) {
  const names = field => [...new Set(runs.flatMap(r => Object.keys(r[field] || {})))];
  const cell = v => short(v).replace(/\|/g, '/');
  const row = (label, values) => { const differs = !values.every(v => JSON.stringify(v ?? null) === JSON.stringify(values[0] ?? null)); return `| ${differs ? '*' : ''}${label} | ${values.map(cell).join(' | ')} |`; };
  const lines = [`| | ${runs.map(r => `${r.id}${r.name ? ` ${r.name.slice(0, 30)}` : ''}`).join(' | ')} |`, `|---|${runs.map(() => '---').join('|')}|`];
  for (const name of names('params')) lines.push(row(name, runs.map(r => r.params?.[name])));
  for (const name of names('metrics')) { const unit = runs.map(r => r.metrics?.[name]?.unit).find(Boolean); lines.push(row(`${name}${unit ? ` (${unit})` : ''}`, runs.map(r => r.metrics?.[name]?.value))); }
  if (runs.some(r => r.scale)) lines.push(row('scale', runs.map(r => r.scale || '–')));
  if (runs.some(r => r.claims?.length)) lines.push(row('claims', runs.map(r => (r.claims || []).join(', ') || '–')));
  lines.push(row('state', runs.map(r => r.state)), row('where', runs.map(r => r.where?.kind || 'here')), row('seconds', runs.map(r => r.seconds)), row('commit', runs.map(r => (r.code?.commit || '').slice(0, 10) + (r.code?.dirty ? '+changes' : ''))));
  return `${lines.join('\n')}\n\n* marks what differs. Values are data the runs recorded.`;
}
// A run named in an answer (R12) becomes a link that opens its page in Runs, when the project has that run. Words like
// "R2 score" or "R²" are left alone, as is anything already in a link or in code.
export const RUN_LINK = /^fairy-run:R\d{1,6}$/;
export async function linkRuns(text, { root, store }) {
  if (typeof text !== 'string' || !store || !/\bR\d/.test(text)) return text;
  const ids = new Set((await store.list(root).catch(() => [])).map(r => r.id));
  if (!ids.size) return text;
  // Code and links are kept out of reach while the rest is linked.
  const kept = [];
  const masked = text.replace(/```[\s\S]*?```|`[^`\n]*`|\[[^\]\n]*\]\([^)\s]*\)/g, all => { kept.push(all); return `\u0000${kept.length - 1}\u0000`; });
  const linked = masked.replace(/(?<![\w/#-])R(\d{1,6})\b(?![-\w²]|\s*(?:score|squared|value)\b)/gi, (all, n) => (all.startsWith('R') && ids.has(`R${Number(n)}`) && String(Number(n)) === n ? `[${all}](fairy-run:R${n})` : all));
  return linked.replace(/\u0000(\d+)\u0000/g, (_, i) => kept[Number(i)]);
}

