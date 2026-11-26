// Goals (docs/goals-board-plan.md): things Fairy works towards across sessions, one step at a time, until a check you
// agreed says each is done. Kept in Fairy's own data folder (goals.json), never in a project, numbered G1, G2, … and
// never reused, as runs are.
//
// Stage 1 is the board: goals you write, their steps you write and tick, their links to chats and runs, and their
// state (Active, Paused, Done, Dropped). Nothing here starts work; steps as work turns come in stage 2, moving on its
// own in stage 4. Decisions (19 Nov): its own place in the sidebar, at most five goals open at once, and a goal with no
// folder is kept and tracked only.
import { readFile, rename, writeFile } from 'node:fs/promises';
import { hasFeature, optionalImport } from './edition.mjs';
import { cleanCheckRecord } from './work-verdict.mjs';

const reproClaimsMod = hasFeature('reproduce') ? await optionalImport('./reproduce/claims.mjs', import.meta.url) : null;
const reproCompareMod = hasFeature('reproduce') ? await optionalImport('./reproduce/compare.mjs', import.meta.url) : null;
const reproPlanMod = hasFeature('reproduce') ? await optionalImport('./reproduce/plan.mjs', import.meta.url) : null;
const applyClaimChoices = reproClaimsMod?.applyClaimChoices || (claims => Array.isArray(claims) ? claims : []);
const cleanClaims = reproClaimsMod?.cleanClaims || (claims => Array.isArray(claims) ? claims : []);
const cleanHoursBudget = reproClaimsMod?.cleanHoursBudget || (() => ({ forge: 8, atlas: 4 }));
const DEFAULT_HOURS = reproClaimsMod?.DEFAULT_HOURS || Object.freeze({ forge: 8, atlas: 4 });
const validateHoursBudget = reproClaimsMod?.validateHoursBudget || (b => b || { forge: 8, atlas: 4 });
const ACCEPTED_VERDICTS = reproCompareMod?.ACCEPTED_VERDICTS || Object.freeze(['reproduced', 'close', 'failed', 'inconclusive']);
const cleanClaimOutcomes = reproCompareMod?.cleanClaimOutcomes || (o => (o && typeof o === 'object' ? o : {}));
const cleanSavedPlan = reproPlanMod?.cleanSavedPlan || (plan => plan || null);

export const STATES = Object.freeze(['active', 'waiting-you', 'waiting', 'paused', 'done', 'dropped']);
// Open goals count towards the limit; done and dropped ones don't.
export const OPEN = Object.freeze(['active', 'waiting-you', 'waiting', 'paused']);
export const MAX_OPEN = 5;
export const DONE_KINDS = Object.freeze(['command', 'metric', 'claims', 'say']);
export const MOVES = Object.freeze(['ask', 'own']);
const MAX_STEPS = 60, MAX_LINKS = 40, MAX_HISTORY = 80, MAX_GOALS = 200, MAX_DEVIATIONS = 50;
// A Nexus job's id, as watchers take it.
const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const DEV_ID = /^D\d{1,4}$/;
export function cleanDeviations(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const what = words(item.what, 300);
    if (!what) continue;
    const id = DEV_ID.test(item.id || '') && !seen.has(item.id) ? item.id : `D${out.length + 1}`;
    seen.add(id);
    const why = words(item.why, 300);
    const step = STEP_ID.test(item.step || '') ? item.step : '';
    const at = typeof item.at === 'string' && !Number.isNaN(Date.parse(item.at)) ? item.at.slice(0, 40) : '';
    out.push({ id, what, ...(why ? { why } : {}), ...(step ? { step } : {}), ...(at ? { at } : {}) });
    if (out.length >= MAX_DEVIATIONS) break;
  }
  return out;
}
function cleanSavedReport(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !raw.at) return null;
  const safeName = value => (typeof value === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(value) ? value : '');
  const mdFile = safeName(raw.mdFile) || 'REPORT.md';
  const texFile = safeName(raw.texFile) || 'REPORT.tex';
  const pdfFile = safeName(raw.pdfFile);
  return {
    at: String(raw.at).slice(0, 40),
    mdFile,
    texFile,
    ...(pdfFile ? { pdfFile } : {}),
    compiled: raw.compiled === true && Boolean(pdfFile),
    ...(raw.compileError ? { compileError: words(raw.compileError, 400) } : {}),
    reproduced: Math.max(0, Math.min(40, Number(raw.reproduced) || 0)),
    total: Math.max(0, Math.min(40, Number(raw.total) || 0)),
  };
}
// What starts a step on its own: after a good step, when a watcher it waits on fires, and a time each day (or none).
function cleanTriggers(value = {}) {
  const daily = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value?.daily || '') ? value.daily : '';
  return { afterStep: value?.afterStep !== false, onEvent: value?.onEvent !== false, daily };
}
function cleanWait(value) {
  if (value?.kind === 'watcher' && typeof value.watcher === 'string' && value.watcher) return { kind: 'watcher', watcher: value.watcher.slice(0, 64), title: words(value.title, 120) };
  if (value?.kind === 'date' && Number.isFinite(Date.parse(value.at))) return { kind: 'date', at: new Date(value.at).toISOString() };
  return null;
}
const ID = /^G\d{1,5}$/, STEP_ID = /^S\d{1,4}$/, SESSION_ID = /^[A-Za-z0-9_-]{1,80}$/, RUN_ID = /^[A-Z]{0,2}\d{1,6}$/;
const ARXIV_BASE_ID = /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})$/;
const ARXIV_VERSION = /^v\d{1,3}$/;
const PAPER_SOURCE_KINDS = Object.freeze(['latex', 'pdf']);
const words = (value, limit) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
const lines = (value, limit) => String(value ?? '').replace(/\r\n?/g, '\n').trim().slice(0, limit);

// A paper attached to a reproduction goal (docs/reproduce-plan.md, stage 1): id, version, metadata, source kind, code links.
export function cleanPaper(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = typeof value.id === 'string' && ARXIV_BASE_ID.test(value.id.trim()) ? value.id.trim() : '';
  const title = words(value.title, 400);
  if (!id || !title) return null;
  const version = typeof value.version === 'string' && ARXIV_VERSION.test(value.version.trim()) ? value.version.trim() : '';
  const authors = (Array.isArray(value.authors) ? value.authors : []).map(author => words(author, 120)).filter(Boolean).slice(0, 50);
  const abstract = lines(value.abstract, 4000);
  const url = typeof value.url === 'string' && /^https:\/\/arxiv\.org\/abs\/[^\s]+$/.test(value.url.trim())
    ? value.url.trim().slice(0, 200)
    : `https://arxiv.org/abs/${id}${version}`;
  const pdfUrl = typeof value.pdfUrl === 'string' && /^https:\/\/arxiv\.org\/pdf\/[^\s]+$/.test(value.pdfUrl.trim())
    ? value.pdfUrl.trim().slice(0, 200)
    : `https://arxiv.org/pdf/${id}${version}.pdf`;
  const sourceKind = PAPER_SOURCE_KINDS.includes(value.sourceKind) ? value.sourceKind : 'latex';
  const codeLinks = [];
  for (const item of Array.isArray(value.codeLinks) ? value.codeLinks : []) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim().slice(0, 300);
    if (/^https?:\/\/[^\s"'<>]+$/.test(trimmed) && !codeLinks.includes(trimmed)) codeLinks.push(trimmed);
    if (codeLinks.length >= 20) break;
  }
  const rawTextFile = typeof value.textFile === 'string' ? value.textFile.trim() : 'paper/text.txt';
  const textFile = rawTextFile && !rawTextFile.startsWith('/') && !rawTextFile.includes('..') && !rawTextFile.includes('\\')
    ? rawTextFile.slice(0, 200)
    : 'paper/text.txt';
  const mainFile = typeof value.mainFile === 'string' && value.mainFile.trim() && !value.mainFile.startsWith('/') && !value.mainFile.includes('..')
    ? value.mainFile.trim().slice(0, 200)
    : '';
  const published = typeof value.published === 'string' && Number.isFinite(Date.parse(value.published)) ? new Date(value.published).toISOString() : '';
  const fetchedAt = typeof value.fetchedAt === 'string' && Number.isFinite(Date.parse(value.fetchedAt)) ? new Date(value.fetchedAt).toISOString() : '';
  return {
    id, version, title, authors, abstract, url, pdfUrl, sourceKind,
    ...(mainFile ? { mainFile } : {}),
    codeLinks, textFile,
    ...(value.fromScratch === true ? { fromScratch: true } : {}),
    ...(published ? { published } : {}),
    ...(fetchedAt ? { fetchedAt } : {}),
  };
}

// What says a goal is done: a command that must pass in its folder, a run's metric past a value, or you saying so.
// Fairy's own judgement is never one of them.
export function cleanDoneWhen(value) {
  const kind = DONE_KINDS.includes(value?.kind) ? value.kind : 'say';
  if (kind === 'command') {
    const command = words(value.command, 400);
    if (!command) throw new Error('Give the command that passes once the goal is done.');
    return { kind, command };
  }
  if (kind === 'metric') {
    const metric = words(value.metric, 80), at = Number(value.value), op = value.op === '<=' ? '<=' : '>=';
    if (!metric || !Number.isFinite(at)) throw new Error('Give the run metric and the value it must reach.');
    return { kind, metric, op, value: at };
  }
  if (kind === 'claims') return { kind: 'claims' };
  return { kind: 'say' };
}

// A goal as kept: everything checked, nothing else.
export function cleanGoal(value) {
  if (!value || !ID.test(value.id)) return null;
  const outcome = lines(value.outcome, 600);
  if (!outcome) return null;
  let doneWhen;
  try { doneWhen = cleanDoneWhen(value.doneWhen); } catch { doneWhen = { kind: 'say' }; }
  const steps = (Array.isArray(value.steps) ? value.steps : []).filter(step => STEP_ID.test(step?.id) && words(step.what, 300)).slice(0, MAX_STEPS)
    .map(step => ({ id: step.id, what: words(step.what, 300), state: ['todo', 'doing', 'done', 'skipped'].includes(step.state) ? step.state : 'todo', ...(step.note ? { note: lines(step.note, 1200) } : {}),
      at: String(step.at || ''), ...(step.startedAt ? { startedAt: String(step.startedAt) } : {}), ...(step.doneAt ? { doneAt: String(step.doneAt) } : {}), ...(SESSION_ID.test(step.session || '') ? { session: step.session } : {}) }));
  const links = { sessions: [], runs: [] };
  for (const id of Array.isArray(value.links?.sessions) ? value.links.sessions : []) if (SESSION_ID.test(id) && !links.sessions.includes(id)) links.sessions.push(id);
  for (const run of Array.isArray(value.links?.runs) ? value.links.runs : []) if (RUN_ID.test(run?.id || '') && typeof run.folder === 'string' && !links.runs.some(r => r.id === run.id && r.folder === run.folder)) links.runs.push({ id: run.id, folder: run.folder });
  links.sessions = links.sessions.slice(0, MAX_LINKS); links.runs = links.runs.slice(0, MAX_LINKS);
  const paper = cleanPaper(value.paper);
  const hours = value.budget?.hours ? cleanHoursBudget(value.budget.hours) : (paper ? { ...DEFAULT_HOURS } : null);
  const claims = Array.isArray(value.claims) ? cleanClaims(value.claims) : null;
  const claimsMeta = value.claimsMeta && typeof value.claimsMeta === 'object' && value.claimsMeta.extractedAt
    ? { extractedAt: String(value.claimsMeta.extractedAt), dropped: Math.max(0, Math.min(200, Number(value.claimsMeta.dropped) || 0)) }
    : null;
  const plan = paper ? cleanSavedPlan(value.plan, { paper, claims: claims || [] }) : null;
  const claimOutcomes = paper ? cleanClaimOutcomes(value.claimOutcomes) : {};
  const deviations = paper ? cleanDeviations(value.deviations) : [];
  const report = paper ? cleanSavedReport(value.report) : null;
  return {
    id: value.id, outcome, doneWhen, folder: typeof value.folder === 'string' && value.folder ? value.folder : null,
    state: STATES.includes(value.state) ? value.state : 'active', ...(value.reason ? { reason: words(value.reason, 300) } : {}),
    moves: MOVES.includes(value.moves) ? value.moves : 'ask', budget: { steps: Math.min(10, Math.max(1, Number(value.budget?.steps) || 3)), ...(hours ? { hours } : {}) },
    steps, nextStep: Number(value.nextStep) || steps.length + 1, notes: lines(value.notes, 4000), links,
    // Stage 2: the goal's own work chat, the last check, how many steps in a row changed nothing, and a question a step
    // left for you.
    ...(SESSION_ID.test(value.session || '') ? { session: value.session } : {}),
    ...(value.lastCheck?.at ? {
      lastCheck: {
        at: String(value.lastCheck.at),
        kind: String(value.lastCheck.kind || ''),
        passed: value.lastCheck.passed === true,
        detail: words(value.lastCheck.detail, 700),
        ...(value.lastCheck.command ? { command: words(value.lastCheck.command, 300) } : {}),
        ...(Number.isInteger(value.lastCheck.exitCode) ? { exitCode: value.lastCheck.exitCode } : {}),
        ...(value.lastCheck.timedOut === true ? { timedOut: true } : {}),
        ...(value.lastCheck.run ? { run: String(value.lastCheck.run).slice(0, 12) } : {}),
        ...(cleanCheckRecord(value.lastCheck.record) ? { record: cleanCheckRecord(value.lastCheck.record) } : {}),
      },
    } : {}),
    idle: Math.max(0, Math.min(9, Number(value.idle) || 0)), ...(value.ask ? { ask: words(value.ask, 400) } : {}),
    // Stage 3: what a waiting goal waits on (a watcher of Fairy's, or a time), and a Nexus job a step said to wait for.
    ...(cleanWait(value.waitsOn) ? { waitsOn: cleanWait(value.waitsOn) } : {}), ...(JOB_ID.test(value.waitJob || '') ? { waitJob: value.waitJob } : {}),
    // Stage 4: what starts a step on its own (each a tick), the day its daily time last started one, a pause the budget
    // made, and a trigger that came while the plan was too full.
    triggers: cleanTriggers(value.triggers), ...(/^\d{4}-\d\d-\d\d$/.test(value.lastDaily || '') ? { lastDaily: value.lastDaily } : {}),
    ...(value.pausedBy === 'budget' ? { pausedBy: 'budget' } : {}), ...(value.ownPending === true ? { ownPending: true } : {}),
    // Reproduce a paper (stages 1–6): attached paper, quote-checked claims, extraction metadata, plan, accepted verdicts, deviations, and report.
    ...(paper ? { paper } : {}),
    ...(claims ? { claims } : {}),
    ...(claimsMeta ? { claimsMeta } : {}),
    ...(plan ? { plan } : {}),
    ...(Object.keys(claimOutcomes).length ? { claimOutcomes } : {}),
    ...(deviations.length ? { deviations } : {}),
    ...(report ? { report } : {}),
    created: String(value.created || ''), updated: String(value.updated || ''),
    history: (Array.isArray(value.history) ? value.history : []).filter(item => item?.at && item.what).slice(-MAX_HISTORY).map(item => ({ at: String(item.at), what: words(item.what, 200) })),
  };
}

// The next step not yet done, or null.
export const nextOf = goal => goal.steps.find(step => step.state === 'todo') || null;
export const runningOf = goal => goal.steps.find(step => step.state === 'doing') || null;
// Two steps in a row that change nothing, and the goal waits for you rather than going round again.
export const IDLE_LIMIT = 2;
const FIRST_STEP = 'Work out the next step towards the goal, and take it';
// A goal as the board shows it: its outcome, next step, steps done, and where it is.
export function cardOf(goal) {
  const done = goal.steps.filter(step => step.state === 'done').length;
  return { id: goal.id, outcome: goal.outcome, state: goal.state, ...(goal.reason ? { reason: goal.reason } : {}), next: nextOf(goal)?.what || '', done, steps: goal.steps.length, running: Boolean(runningOf(goal)),
    folder: goal.folder, doneWhen: goal.doneWhen, moves: goal.moves,
    ...(goal.paper ? { paper: { id: goal.paper.id, version: goal.paper.version, title: goal.paper.title, sourceKind: goal.paper.sourceKind } } : {}),
    ...(goal.claims?.length ? { claims: { total: goal.claims.length, picked: goal.claims.filter(claim => claim.picked).length } } : {}),
    ...(goal.plan ? { plan: { status: goal.plan.status, runs: goal.plan.runs.length, forge: goal.plan.hours.forge, atlas: goal.plan.hours.atlas } } : {}),
    ...(goal.report ? { report: { compiled: goal.report.compiled, at: goal.report.at } } : {}),
    updated: goal.updated };
}

// The moves you can make on a goal's state, and where each goes. Stage 1's are yours alone.
const MOVES_BY_YOU = { pause: { from: ['active', 'waiting-you', 'waiting'], to: 'paused' }, resume: { from: ['paused', 'waiting-you', 'waiting'], to: 'active' },
  done: { from: OPEN, to: 'done' }, drop: { from: OPEN, to: 'dropped' }, reopen: { from: ['done', 'dropped'], to: 'active' } };
export const STATE_MOVES = Object.freeze(Object.keys(MOVES_BY_YOU));

export class GoalStore {
  // checkFolder(path): the folder a goal's steps may work in (work-sandbox.mjs' checkWorkFolder), or throws.
  constructor({ path, now = () => new Date().toISOString(), checkFolder = folder => folder }) {
    Object.assign(this, { path, now, checkFolder });
    this.queue = Promise.resolve();
  }
  async read() {
    let text;
    try { text = await readFile(this.path, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return { next: 1, goals: [] }; throw error; }
    try {
      const saved = JSON.parse(text);
      const goals = (Array.isArray(saved?.goals) ? saved.goals : []).map(cleanGoal).filter(Boolean).slice(-MAX_GOALS);
      const highest = goals.reduce((most, goal) => Math.max(most, Number(goal.id.slice(1))), 0);
      return { next: Math.max(Number(saved?.next) || 1, highest + 1), goals };
    } catch (error) {
      await rename(this.path, this.path.replace(/\.json$/, '.unreadable.json')).catch(() => {});
      return { next: 1, goals: [], problem: `goals.json couldn’t be read (${error.message}); it was kept as goals.unreadable.json.` };
    }
  }
  // One change at a time, written whole through a temporary file.
  change(fn) {
    const next = this.queue.then(async () => {
      const data = await this.read();
      const result = await fn(data);
      const temporary = `${this.path}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify({ next: data.next, goals: data.goals }, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, this.path);
      return result;
    });
    this.queue = next.catch(() => {});
    return next;
  }
  async list() { const data = await this.read(); return { goals: data.goals.map(cardOf), open: data.goals.filter(goal => OPEN.includes(goal.state)).length, max: MAX_OPEN, ...(data.problem ? { problem: data.problem } : {}) }; }
  async get(id) { const goal = (await this.read()).goals.find(item => item.id === id); if (!goal) throw new Error('There’s no such goal.'); return goal; }

  folderOf(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'string') throw new Error('Choose a folder, or none.');
    return this.checkFolder(value);
  }
  // A new goal: its outcome, done-when, folder (or none), first steps, and optional attached paper.
  async add({ outcome, doneWhen, folder = null, steps = [], moves = 'ask', paper = null } = {}) {
    const text = lines(outcome, 600);
    if (!text) throw new Error('Say what the goal is: what should be true at the end.');
    const when = cleanDoneWhen(doneWhen), place = this.folderOf(folder), attached = paper ? cleanPaper(paper) : null;
    if (paper && !attached) throw new Error('That paper record isn’t valid.');
    if (when.kind === 'command' && !place) throw new Error('A command can only be checked in a folder: choose one, or make it “I say so”.');
    if (when.kind === 'claims' && (!attached || !place)) throw new Error('Claims done-when is for a paper reproduction in a folder.');
    return this.change(data => {
      if (data.goals.filter(goal => OPEN.includes(goal.state)).length >= MAX_OPEN) throw new Error(`${MAX_OPEN} goals are open already. Finish, drop or pause one first.`);
      const at = this.now(), id = `G${data.next++}`;
      const first = (Array.isArray(steps) ? steps : String(steps || '').split('\n')).map(step => words(step, 300)).filter(Boolean).slice(0, 20);
      const goal = cleanGoal({ id, outcome: text, doneWhen: when, folder: place, moves, state: 'active', ...(attached ? { paper: attached } : {}), created: at, updated: at,
        steps: first.map((what, index) => ({ id: `S${index + 1}`, what, state: 'todo', at })), nextStep: first.length + 1, history: [{ at, what: attached ? `Made from arXiv:${attached.id}${attached.version}` : 'Made' }] });
      data.goals.push(goal);
      return goal;
    });
  }
  edit(id, fn) {
    if (typeof id !== 'string' || !ID.test(id)) return Promise.reject(new Error('There’s no such goal.'));
    return this.change(data => {
      const index = data.goals.findIndex(goal => goal.id === id);
      if (index < 0) throw new Error('There’s no such goal.');
      const goal = structuredClone(data.goals[index]), said = fn(goal, data);
      goal.updated = this.now();
      if (said) goal.history = [...goal.history, { at: goal.updated, what: said }].slice(-MAX_HISTORY);
      data.goals[index] = cleanGoal(goal);
      return data.goals[index];
    });
  }
  // Its outcome, done-when, folder, notes: only you change these.
  async set(id, patch = {}) {
    const next = {};
    if ('outcome' in patch) { next.outcome = lines(patch.outcome, 600); if (!next.outcome) throw new Error('A goal needs its outcome.'); }
    if ('doneWhen' in patch) next.doneWhen = cleanDoneWhen(patch.doneWhen);
    if ('folder' in patch) next.folder = this.folderOf(patch.folder);
    if ('notes' in patch) next.notes = lines(patch.notes, 4000);
    if ('moves' in patch) { if (!MOVES.includes(patch.moves)) throw new Error('Choose Ask first or On its own.'); next.moves = patch.moves; }
    if ('budget' in patch) { const steps = Number(patch.budget?.steps); if (!Number.isInteger(steps) || steps < 1 || steps > 10) throw new Error('Give between 1 and 10 steps a day.'); next.budget = { steps }; }
    if ('triggers' in patch) {
      const daily = String(patch.triggers?.daily ?? '');
      if (daily && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(daily)) throw new Error('Give the daily time as HH:MM, on the 24-hour clock.');
      next.triggers = cleanTriggers({ ...patch.triggers, daily });
    }
    const devOp = patch.deviation && typeof patch.deviation === 'object' && !Array.isArray(patch.deviation) ? patch.deviation : null;
    if (devOp) {
      if (devOp.op === 'add') {
        if (!words(devOp.what, 300)) throw new Error('Describe what differed from the paper.');
      } else if (devOp.op === 'remove') {
        if (!DEV_ID.test(String(devOp.id || ''))) throw new Error('There’s no such deviation.');
      } else throw new Error('Choose add or remove for deviations.');
    }
    return this.edit(id, goal => {
      if (next.budget && goal.budget?.hours) next.budget = { ...next.budget, hours: goal.budget.hours };
      Object.assign(goal, next);
      if (goal.doneWhen.kind === 'command' && !goal.folder) throw new Error('A command can only be checked in a folder: choose one, or make it “I say so”.');
      if (goal.doneWhen.kind === 'claims' && (!goal.paper || !goal.folder)) throw new Error('Claims done-when is for a paper reproduction in a folder.');
      const notes = Object.keys(next).filter(key => key !== 'notes').map(key => ({ outcome: 'Outcome changed', doneWhen: 'Done-when changed', folder: 'Folder changed', moves: next.moves === 'own' ? 'Set to move on its own' : 'Set to ask first', budget: `${next.budget?.steps} steps a day`, triggers: 'What starts a step changed' })[key]).filter(Boolean);
      if (devOp) {
        if (!goal.paper) throw new Error('This goal doesn’t have a paper attached.');
        const existing = cleanDeviations(goal.deviations);
        if (devOp.op === 'add') {
          if (existing.length >= MAX_DEVIATIONS) throw new Error(`At most ${MAX_DEVIATIONS} deviations can be kept.`);
          const maxNum = existing.reduce((m, d) => Math.max(m, Number(d.id.slice(1)) || 0), 0);
          const what = words(devOp.what, 300), why = words(devOp.why, 300);
          existing.push({ id: `D${maxNum + 1}`, what, ...(why ? { why } : {}), at: this.now() });
          goal.deviations = existing;
          notes.push(`Deviation recorded: ${what.slice(0, 80)}`);
        } else {
          const kept = existing.filter(d => d.id !== devOp.id);
          if (kept.length === existing.length) throw new Error('There’s no such deviation.');
          if (kept.length) goal.deviations = kept; else delete goal.deviations;
          notes.push(`Deviation ${devOp.id} removed`);
        }
      }
      return notes.join('; ');
    });
  }
  // Reproduce a paper (stage 2): store quote-checked extracted claims on a paper goal.
  async setClaims(id, claims, { dropped = 0, extractedAt = null } = {}) {
    const kept = cleanClaims(claims);
    return this.edit(id, goal => {
      if (!goal.paper) throw new Error('This goal doesn’t have a paper attached.');
      goal.claims = kept;
      goal.claimsMeta = { extractedAt: extractedAt || this.now(), dropped: Math.max(0, Math.min(200, Number(dropped) || 0)) };
      if (!goal.budget?.hours) goal.budget = { ...goal.budget, hours: { ...DEFAULT_HOURS } };
      return dropped > 0 ? `Extracted ${kept.length} claim${kept.length === 1 ? '' : 's'} (${dropped} dropped)` : `Extracted ${kept.length} claim${kept.length === 1 ? '' : 's'}`;
    });
  }
  // Reproduce a paper (stages 2–3): user picks up to 8 claims, edits tolerances, compute-hour budgets, and from-scratch switch.
  async pickClaims(id, { picks = null, tolerances = null, hours = null, fromScratch = null } = {}) {
    const validatedHours = hours !== null && hours !== undefined ? validateHoursBudget(hours) : null;
    if (fromScratch !== null && fromScratch !== undefined && typeof fromScratch !== 'boolean') {
      throw new Error('Always write from scratch must be true or false.');
    }
    return this.edit(id, goal => {
      if (!goal.paper) throw new Error('This goal doesn’t have a paper attached.');
      const parts = [];
      if (picks !== null || tolerances !== null) {
        goal.claims = applyClaimChoices(goal.claims || [], { picks, tolerances });
        if (picks !== null) {
          const count = goal.claims.filter(claim => claim.picked).length;
          parts.push(`Picked ${count} claim${count === 1 ? '' : 's'}`);
        }
        if (tolerances !== null && Object.keys(tolerances || {}).length) parts.push('Tolerances updated');
      }
      if (validatedHours) {
        goal.budget = { ...goal.budget, hours: validatedHours };
        parts.push(`Budget ${validatedHours.forge}h forge, ${validatedHours.atlas}h atlas`);
      }
      if (typeof fromScratch === 'boolean') {
        if (fromScratch) goal.paper.fromScratch = true;
        else delete goal.paper.fromScratch;
        parts.push(fromScratch ? 'Code set to always from scratch' : 'Code set to use public repo when linked');
      }
      if (!parts.length) throw new Error('Choose claims to pick, tolerances, compute hours, or code preference.');
      return parts.join('; ');
    });
  }
  // Reproduce a paper (stage 3): store a pending REPRODUCTION.md plan. Nothing starts and no steps are added until approvePlan().
  async setPlan(id, plan, { fromScratch = null } = {}) {
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new Error('Give a valid reproduction plan.');
    if (fromScratch !== null && fromScratch !== undefined && typeof fromScratch !== 'boolean') {
      throw new Error('Always write from scratch must be true or false.');
    }
    return this.edit(id, goal => {
      if (!goal.paper) throw new Error('This goal doesn’t have a paper attached.');
      if (runningOf(goal)) throw new Error('A step is running; wait until it ends before replacing the plan.');
      if (typeof fromScratch === 'boolean') {
        if (fromScratch) goal.paper.fromScratch = true;
        else delete goal.paper.fromScratch;
      }
      const cleaned = cleanSavedPlan({ ...plan, status: 'pending', approvedAt: '' }, { paper: goal.paper, claims: goal.claims || [] });
      if (!cleaned) throw new Error('That reproduction plan isn’t valid.');
      goal.plan = cleaned;
      if (['active', 'waiting-you'].includes(goal.state)) {
        goal.state = 'waiting-you';
        goal.reason = 'Review the reproduction plan and click Approve plan before anything starts.';
      }
      return `Plan drafted (${cleaned.runs.length} run${cleaned.runs.length === 1 ? '' : 's'}, ${cleaned.hours.forge}h forge, ${cleaned.hours.atlas}h atlas; awaiting OK)`;
    });
  }
  // Reproduce a paper (stage 3): user explicitly approves (materializing steps & unlocking execution) or discards the plan card.
  async approvePlan(id, { action = 'approve' } = {}) {
    if (!['approve', 'discard'].includes(action)) throw new Error('Choose approve or discard for the reproduction plan.');
    return this.edit(id, goal => {
      if (!goal.paper) throw new Error('This goal doesn’t have a paper attached.');
      if (!goal.plan) throw new Error('There’s no reproduction plan to review yet.');
      if (action === 'discard') {
        if (runningOf(goal)) throw new Error('A step is running; wait until it ends first.');
        const wasPending = goal.plan.status === 'pending';
        delete goal.plan;
        if (wasPending && goal.state === 'waiting-you') {
          goal.state = 'active';
          delete goal.reason;
          delete goal.ask;
        }
        return 'Reproduction plan discarded';
      }
      if (goal.plan.status === 'approved') return '';
      goal.plan = { ...goal.plan, status: 'approved', approvedAt: this.now() };
      const existingTodo = new Set(goal.steps.filter(step => step.state === 'todo').map(step => step.what.toLowerCase()));
      for (const planned of goal.plan.steps) {
        const needsPrefix = planned.waitsForYou && !/^(\[waits for you\]|wait for you)/i.test(planned.what);
        const label = words(needsPrefix ? `[Waits for you] ${planned.what}` : planned.what, 300);
        if (!label || existingTodo.has(label.toLowerCase()) || goal.steps.length >= MAX_STEPS) continue;
        existingTodo.add(label.toLowerCase());
        goal.steps.push({
          id: `S${goal.nextStep++}`,
          what: label,
          state: 'todo',
          at: this.now(),
          ...(planned.notes ? { note: lines(planned.notes, 1200) } : {}),
        });
      }
      if (goal.state === 'waiting-you') {
        goal.state = 'active';
        delete goal.reason;
        delete goal.ask;
      }
      return `Plan approved (${goal.plan.runs.length} run${goal.plan.runs.length === 1 ? '' : 's'}, ${goal.plan.hours.forge}h forge, ${goal.plan.hours.atlas}h atlas)`;
    });
  }
  // Reproduce a paper (stage 5): user accepts a failed verdict ('not-reproduced') or marks a claim 'couldnt-run' (or clears it).
  async setClaimOutcome(id, { claim, verdict, reason = '' } = {}) {
    const claimId = typeof claim === 'string' ? claim.trim().toUpperCase() : '';
    if (!/^C\d{1,3}$/.test(claimId)) throw new Error('Choose a valid claim id (such as C1).');
    if (verdict !== 'clear' && !ACCEPTED_VERDICTS.includes(verdict)) {
      throw new Error('Choose not-reproduced, couldnt-run, or clear.');
    }
    const why = words(reason, 300);
    return this.edit(id, goal => {
      if (!goal.paper) throw new Error('This goal doesn’t have a paper attached.');
      const target = (goal.claims || []).find(item => item.id === claimId);
      if (!target) throw new Error(`There’s no claim ${claimId} on this goal.`);
      if (!target.picked) throw new Error(`Claim ${claimId} isn’t one of the picked claims.`);
      const next = cleanClaimOutcomes(goal.claimOutcomes);
      if (verdict === 'clear') {
        if (!next[claimId]) return '';
        delete next[claimId];
        if (Object.keys(next).length) goal.claimOutcomes = next;
        else delete goal.claimOutcomes;
        return `${claimId} verdict cleared`;
      }
      next[claimId] = { verdict, reason: why, accepted: true, at: this.now() };
      goal.claimOutcomes = next;
      const label = verdict === 'couldnt-run' ? 'marked couldn’t run' : 'accepted as not reproduced';
      return `${claimId} ${label}${why ? `: ${why}` : ''}`;
    });
  }
  // Reproduce a paper (stage 5): close a reproduction goal once every picked claim is reproduced or explicitly accepted.
  async closeByComparison(id, { comparison, check = null } = {}) {
    if (!comparison || typeof comparison !== 'object' || !Array.isArray(comparison.rows)) {
      throw new Error('Compare the picked claims before closing.');
    }
    if (!comparison.rows.length) throw new Error('Pick at least one claim before closing.');
    if (!comparison.allSettled) {
      const pending = comparison.rows.filter(row => !row.closedOk).map(row => row.claimId);
      throw new Error(`Accept or reproduce ${pending.join(', ')} before closing this reproduction.`);
    }
    return this.edit(id, goal => {
      if (!goal.paper) throw new Error('This goal doesn’t have a paper attached.');
      if (!OPEN.includes(goal.state)) throw new Error(`A goal that’s ${goal.state.replace('-', ' ')} can’t be closed.`);
      if (runningOf(goal)) throw new Error('A step is running; wait until it ends first.');
      goal.state = 'done';
      delete goal.ask;
      delete goal.waitsOn;
      delete goal.pausedBy;
      const summary = words(comparison.summary, 300) || (comparison.passed ? 'All picked claims reproduced.' : 'Closed with accepted claim verdicts.');
      goal.reason = summary;
      if (check) goal.lastCheck = check;
      return comparison.passed ? `Done: ${summary}` : `Closed with accepted verdicts: ${summary}`;
    });
  }
  // Reproduce a paper (stage 6): store metadata for the latest generated REPORT.md / REPORT.pdf.
  async setReport(id, record) {
    const cleaned = cleanSavedReport(record);
    if (!cleaned) throw new Error('Give a valid report record.');
    return this.edit(id, goal => {
      if (!goal.paper) throw new Error('This goal doesn’t have a paper attached.');
      goal.report = cleaned;
      return cleaned.compiled ? `Report compiled (${cleaned.mdFile} + ${cleaned.pdfFile})` : `Report written (${cleaned.mdFile}; PDF not compiled)`;
    });
  }
  // A step: add one, tick or untick it, skip it, change its words, or remove it.
  async step(id, op = {}) {
    return this.edit(id, goal => {
      if (op.op === 'add') {
        const what = words(op.what, 300);
        if (!what) throw new Error('Say what the step is.');
        if (goal.steps.length >= MAX_STEPS) throw new Error('This goal has as many steps as it can keep.');
        goal.steps.push({ id: `S${goal.nextStep++}`, what, state: 'todo', at: this.now() });
        return `Step added: ${what}`;
      }
      const step = goal.steps.find(item => item.id === op.step);
      if (!step) throw new Error('There’s no such step.');
      if (step.state === 'doing') throw new Error('That step is running in its chat; stop it there first.');
      if (op.op === 'tick') { step.state = 'done'; step.doneAt = this.now(); return `Step done: ${step.what}`; }
      if (op.op === 'untick') { step.state = 'todo'; delete step.doneAt; return `Step not done: ${step.what}`; }
      if (op.op === 'skip') { step.state = 'skipped'; return `Step skipped: ${step.what}`; }
      if (op.op === 'reword') { const what = words(op.what, 300); if (!what) throw new Error('Say what the step is.'); step.what = what; return ''; }
      if (op.op === 'note') { step.note = lines(op.note, 1200); return ''; }
      if (op.op === 'remove') { goal.steps = goal.steps.filter(item => item !== step); return `Step removed: ${step.what}`; }
      throw new Error('That isn’t something a step can do.');
    });
  }
  // Pause, resume, done, drop or reopen: only you, in stage 1. Done here is your say; reopening counts towards the five.
  async state(id, move, reason = '') {
    const rule = MOVES_BY_YOU[move];
    if (!rule) return Promise.reject(new Error('That isn’t something a goal can do.'));
    return this.edit(id, (goal, data) => {
      if (!rule.from.includes(goal.state)) throw new Error(`A goal that’s ${goal.state.replace('-', ' ')} can’t ${move}.`);
      if (move === 'reopen' && data.goals.filter(item => OPEN.includes(item.state)).length >= MAX_OPEN) throw new Error(`${MAX_OPEN} goals are open already. Finish, drop or pause one first.`);
      goal.state = rule.to;
      if (move === 'resume') { delete goal.ask; delete goal.waitsOn; delete goal.pausedBy; }
      const why = words(reason, 300);
      if (why) goal.reason = why; else delete goal.reason;
      return { pause: 'Paused', resume: 'Resumed', done: 'Marked done by you', drop: 'Dropped', reopen: 'Reopened' }[move] + (why ? `: ${why}` : '');
    });
  }
  // ── stage 2: a step as a work turn ──
  // The next step begins: the goal must be active, have a folder and no step running. With no step written, the step
  // is to work out the next one and take it.
  async begin(id) {
    let started = null;
    await this.edit(id, goal => {
      if (goal.plan?.status === 'pending') throw new Error('Review and approve the reproduction plan before starting any step.');
      if (goal.state !== 'active') throw new Error(goal.state === 'waiting-you' ? `${goal.id} is waiting for you: ${goal.reason || goal.ask || 'answer it, then Resume'}.` : `${goal.id} isn’t active.`);
      if (!goal.folder) throw new Error('This goal has no folder, so it’s tracked only: its steps are yours to do.');
      if (runningOf(goal)) throw new Error(`A step of ${goal.id} is already running.`);
      delete goal.ownPending;
      let step = nextOf(goal);
      if (!step) { step = { id: `S${goal.nextStep++}`, what: FIRST_STEP, state: 'todo', at: this.now() }; goal.steps.push(step); }
      step.state = 'doing'; step.startedAt = this.now();
      delete goal.ask;
      started = { step: step.id, what: step.what };
      return `Step started: ${step.what}`;
    });
    return { goal: await this.get(id), step: started.step };
  }
  // The step's own work chat, kept on the goal and linked, so each step carries on the same conversation.
  async useSession(id, session) {
    return this.edit(id, goal => { goal.session = session; if (!goal.links.sessions.includes(session)) goal.links.sessions.push(session); return ''; });
  }
  // goal_update from the running step: what it did, what it learned, the next step, a question for you, and any deviations
  // from the paper (stage 6). Only for the step that's running, and never the outcome or done-when.
  async report(id, stepId, { did = '', learned = '', next = '', needsYou = '', waitJob = '', deviations = [] } = {}) {
    const doneText = lines(did, 1200), nextText = words(next, 300), learnedText = lines(learned, 1000), ask = words(needsYou, 400), job = String(waitJob || '').trim();
    if (!doneText) throw new Error('Say what this step did.');
    if (job && !JOB_ID.test(job)) throw new Error('That isn’t a Nexus job id.');
    const incomingDevs = (Array.isArray(deviations) ? deviations : []).slice(0, 12)
      .map(item => (typeof item === 'string' ? { what: words(item, 300), why: '' } : { what: words(item?.what, 300), why: words(item?.why, 300) }))
      .filter(item => item.what);
    return this.edit(id, goal => {
      const index = goal.steps.findIndex(step => step.id === stepId && step.state === 'doing');
      if (index < 0) throw new Error('That step isn’t running.');
      goal.steps[index].note = doneText;
      if (learnedText) goal.notes = `${goal.notes ? `${goal.notes}\n` : ''}${learnedText}`.slice(-4000);
      // The next step goes right after this one, unless the step already written next says the same.
      const following = goal.steps.slice(index + 1).find(step => step.state === 'todo');
      if (nextText && following?.what.toLowerCase() !== nextText.toLowerCase()) goal.steps.splice(index + 1, 0, { id: `S${goal.nextStep++}`, what: nextText, state: 'todo', at: this.now() });
      if (ask) goal.ask = ask;
      // A job the step sent to the cluster: once the step ends, the goal waits for it (main makes the watcher).
      if (job) goal.waitJob = job;
      // Reproduce a paper (stage 6): deviations recorded by the step that made them.
      if (goal.paper && incomingDevs.length) {
        const list = cleanDeviations(goal.deviations);
        const seenWhat = new Set(list.map(d => d.what.toLowerCase()));
        let maxNum = list.reduce((m, d) => Math.max(m, Number(d.id.slice(1)) || 0), 0);
        for (const item of incomingDevs) {
          if (list.length >= MAX_DEVIATIONS || seenWhat.has(item.what.toLowerCase())) continue;
          seenWhat.add(item.what.toLowerCase());
          list.push({ id: `D${++maxNum}`, what: item.what, ...(item.why ? { why: item.why } : {}), step: stepId, at: this.now() });
        }
        if (list.length) goal.deviations = list;
      }
      return '';
    });
  }
  // ── stage 3: waiting ──
  // An active goal with no step running waits on a watcher of Fairy's or until a time.
  async wait(id, waitsOn) {
    const wait = cleanWait(waitsOn);
    if (!wait) throw new Error('Wait on a watcher or a date and time.');
    if (wait.kind === 'date' && Date.parse(wait.at) <= Date.parse(this.now())) throw new Error('Choose a time still to come.');
    return this.edit(id, goal => {
      if (!['active', 'waiting'].includes(goal.state)) throw new Error(`${goal.id} isn’t active, so it can’t wait.`);
      if (runningOf(goal)) throw new Error('A step is running; wait until it ends.');
      goal.state = 'waiting'; goal.waitsOn = wait; delete goal.waitJob;
      goal.reason = wait.kind === 'date' ? `Waiting until ${wait.at}` : `Waiting on ${wait.title || 'a watcher'}`;
      return goal.reason;
    });
  }
  // The wait is over: the watcher fired, or the time came. Back to active, with why.
  async wake(id, why = '') {
    return this.edit(id, goal => {
      if (goal.state !== 'waiting') throw new Error(`${goal.id} isn’t waiting.`);
      goal.state = 'active'; delete goal.waitsOn; delete goal.reason;
      return `The wait is over${why ? `: ${words(why, 160)}` : ''}`;
    });
  }
  // Goals waiting on a time that has come.
  async dueWaits() {
    const now = Date.parse(this.now());
    return (await this.read()).goals.filter(goal => goal.state === 'waiting' && goal.waitsOn?.kind === 'date' && Date.parse(goal.waitsOn.at) <= now).map(goal => goal.id);
  }
  // Goals waiting on a watcher.
  async waitingOn(watcher) {
    return (await this.read()).goals.filter(goal => goal.state === 'waiting' && goal.waitsOn?.kind === 'watcher' && goal.waitsOn.watcher === watcher).map(goal => goal.id);
  }
  // The step's turn has ended: done, failed or stopped, and whether it changed any file; then the check, if one ran.
  async settle(id, stepId, { outcome = 'done', changed = 0, error = '', check = null } = {}) {
    return this.edit(id, goal => {
      const step = goal.steps.find(item => item.id === stepId);
      if (!step || step.state !== 'doing') throw new Error('That step isn’t running.');
      step.session = goal.session || step.session;
      if (outcome === 'done') { step.state = 'done'; step.doneAt = this.now(); if (!step.note) step.note = 'Ended without a report.'; }
      else { step.state = 'todo'; step.note = outcome === 'stopped' ? 'Stopped before it finished.' : `Ended with an error: ${words(error, 300) || 'no reason given'}`; }
      goal.idle = outcome === 'done' && !changed ? goal.idle + 1 : 0;
      if (check) goal.lastCheck = check;
      const said = [`Step ${outcome === 'done' ? 'done' : outcome}: ${step.what}`];
      if (check?.passed) { goal.state = 'done'; goal.reason = 'Its check passed.'; said.push('Its check passed'); }
      else {
        // Reproduce a paper (stage 5): a claim out of tolerance sets the next step when none is already queued for it.
        if (outcome === 'done' && goal.doneWhen.kind === 'claims' && Array.isArray(check?.claims) && goal.steps.length < MAX_STEPS) {
          const missed = check.claims.filter(item => item.verdict === 'not-reproduced' && !item.accepted).map(item => item.id);
          if (missed.length) {
            const stepIndex = goal.steps.indexOf(step);
            const pendingText = goal.steps.filter(item => item.state === 'todo').map(item => item.what);
            const uncovered = missed.filter(claimId => !pendingText.some(what => new RegExp(`\\b${claimId}\\b`).test(what)));
            if (uncovered.length) {
              const nextWhat = words(`Investigate why ${uncovered.join(', ')} missed tolerance and retry full-scale run`, 300);
              goal.steps.splice(stepIndex + 1, 0, { id: `S${goal.nextStep++}`, what: nextWhat, state: 'todo', at: this.now() });
              said.push(`Next step set for ${uncovered.join(', ')}`);
            }
          }
        }
        if (outcome === 'failed') { goal.state = 'waiting-you'; goal.reason = step.note; }
        else if (goal.ask) { goal.state = 'waiting-you'; goal.reason = `A step asks: ${goal.ask}`; }
        else if (goal.idle >= IDLE_LIMIT) { goal.state = 'waiting-you'; goal.reason = `${IDLE_LIMIT} steps in a row changed nothing, so it waits for you rather than going round again.`; goal.idle = 0; }
      }
      return said.join('; ');
    });
  }
  // After a restart: a step left running whose chat isn't working any more goes back to be done again.
  async recover(isRunning = () => false) {
    return this.change(data => {
      let count = 0;
      for (const goal of data.goals) for (const step of goal.steps) if (step.state === 'doing' && !isRunning(goal.session)) { step.state = 'todo'; step.note = 'Interrupted when Fairy quit; it’s ready to run again.'; count++; }
      return count;
    });
  }

  // ── stage 4: on its own ──
  // The budget is spent for today: paused until tomorrow, when it's resumed on its own.
  async budgetPause(id, why) {
    return this.edit(id, goal => {
      if (goal.state !== 'active') return '';
      goal.state = 'paused'; goal.pausedBy = 'budget'; goal.reason = words(why, 300) || 'Its steps for today are done; it goes on tomorrow.'; delete goal.ownPending;
      return 'Paused for today: its budget is spent';
    });
  }
  // A new day: goals the budget paused are active again. Answers their ids.
  async newDay() {
    const woke = [];
    await this.change(data => {
      for (const goal of data.goals) if (goal.state === 'paused' && goal.pausedBy === 'budget') {
        goal.state = 'active'; delete goal.pausedBy; delete goal.reason; goal.updated = this.now();
        goal.history = [...goal.history, { at: goal.updated, what: 'A new day: going on' }].slice(-MAX_HISTORY);
        woke.push(goal.id);
      }
    });
    return woke;
  }
  // A trigger came while the plan was too full: it's kept, and tried again each minute until there's room.
  async ownPending(id, pending = true) { return this.edit(id, goal => { if (pending) goal.ownPending = true; else delete goal.ownPending; return ''; }); }
  async markDaily(id, day) { return this.edit(id, goal => { goal.lastDaily = day; return ''; }); }

  // A chat or a run that belongs to the goal.
  async link(id, { session, run, folder, remove = false } = {}) {
    return this.edit(id, goal => {
      if (session !== undefined) {
        if (!SESSION_ID.test(String(session))) throw new Error('That isn’t a chat.');
        goal.links.sessions = remove ? goal.links.sessions.filter(item => item !== session) : [...new Set([...goal.links.sessions, session])];
        return remove ? 'A chat unlinked' : 'A chat linked';
      }
      if (run !== undefined) {
        if (!RUN_ID.test(String(run)) || typeof folder !== 'string' || !folder) throw new Error('That isn’t a run.');
        goal.links.runs = remove ? goal.links.runs.filter(item => !(item.id === run && item.folder === folder)) : [...goal.links.runs.filter(item => !(item.id === run && item.folder === folder)), { id: run, folder }];
        return remove ? `Run ${run} unlinked` : `Run ${run} linked`;
      }
      throw new Error('Link a chat or a run.');
    });
  }
}
