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
import { cleanCheckRecord, type CheckRecord } from './work-verdict.mjs';

export type GoalState = 'active' | 'waiting-you' | 'waiting' | 'paused' | 'done' | 'dropped';
export type OpenGoalState = 'active' | 'waiting-you' | 'waiting' | 'paused';
export type DoneWhenKind = 'command' | 'metric' | 'claims' | 'say';
export type GoalMoves = 'ask' | 'own';
export type StepState = 'todo' | 'doing' | 'done' | 'skipped';
export type PaperSourceKind = 'latex' | 'pdf';
export type StateMove = 'pause' | 'resume' | 'done' | 'drop' | 'reopen';

export interface ClaimTolerance {
  kind: 'abs' | 'rel';
  value: number;
}

export interface PaperClaim {
  id: string;
  where: string;
  setting: string;
  metric: string;
  value: number;
  unit: string;
  uncertainty: number | null;
  direction: 'higher' | 'lower' | 'match';
  quote: string;
  tolerance: ClaimTolerance;
  picked: boolean;
}

export interface HoursBudget {
  forge: number;
  atlas: number;
}

export interface ClaimOutcome {
  verdict: string;
  reason: string;
  accepted: boolean;
  at: string;
}

export interface ReproductionPlan {
  status: 'pending' | 'approved';
  file: string;
  fromScratch: boolean;
  summary: string;
  code: {
    mode: 'authors-code' | 'from-scratch';
    repoUrl: string;
    pinCommit: boolean;
    notes: string;
  };
  environment: {
    summary: string;
    python: string;
    packages: string[];
    notes: string;
  };
  datasets: Array<{
    name: string;
    source: string;
    fetch: string;
    requiresLogin: boolean;
    licence: string;
    notes: string;
  }>;
  runs: Array<{
    id: string;
    title: string;
    claims: string[];
    scale: 'smoke' | 'scaled' | 'full';
    machine: 'sandbox' | 'atlas' | 'forge';
    estimatedHours: number;
    notes: string;
  }>;
  steps: Array<{
    what: string;
    machine?: 'sandbox' | 'atlas' | 'forge';
    waitsForYou: boolean;
    notes?: string;
  }>;
  hours: {
    sandbox: number;
    atlas: number;
    forge: number;
    total: number;
  };
  risks: string[];
  createdAt?: string;
  approvedAt?: string;
}

const reproClaimsMod = hasFeature('reproduce') ? await optionalImport('./reproduce/claims.mjs', import.meta.url) : null;
const reproCompareMod = hasFeature('reproduce') ? await optionalImport('./reproduce/compare.mjs', import.meta.url) : null;
const reproPlanMod = hasFeature('reproduce') ? await optionalImport('./reproduce/plan.mjs', import.meta.url) : null;
const applyClaimChoices: (claims: PaperClaim[], options?: { picks?: unknown; tolerances?: unknown }) => PaperClaim[] =
  reproClaimsMod?.applyClaimChoices || ((claims: PaperClaim[]) => (Array.isArray(claims) ? claims : []));
const cleanClaims: (claims: unknown) => PaperClaim[] =
  reproClaimsMod?.cleanClaims || ((claims: unknown) => (Array.isArray(claims) ? (claims as PaperClaim[]) : []));
const cleanHoursBudget: (value: unknown) => HoursBudget =
  reproClaimsMod?.cleanHoursBudget || (() => ({ forge: 8, atlas: 4 }));
const DEFAULT_HOURS: Readonly<HoursBudget> =
  reproClaimsMod?.DEFAULT_HOURS || Object.freeze({ forge: 8, atlas: 4 });
const validateHoursBudget: (value: unknown) => HoursBudget =
  reproClaimsMod?.validateHoursBudget || ((b: unknown) => (b as HoursBudget) || { forge: 8, atlas: 4 });
const ACCEPTED_VERDICTS: readonly string[] =
  reproCompareMod?.ACCEPTED_VERDICTS || Object.freeze(['reproduced', 'close', 'failed', 'inconclusive']);
const cleanClaimOutcomes: (raw: unknown) => Record<string, ClaimOutcome> =
  reproCompareMod?.cleanClaimOutcomes || ((o: unknown) => (o && typeof o === 'object' ? (o as Record<string, ClaimOutcome>) : {}));
const cleanSavedPlan: (
  plan: unknown,
  context?: { paper?: PaperRecord | null; claims?: readonly PaperClaim[] },
) => ReproductionPlan | null =
  reproPlanMod?.cleanSavedPlan || ((plan: unknown) => (plan as ReproductionPlan | null) || null);

export const STATES = Object.freeze(['active', 'waiting-you', 'waiting', 'paused', 'done', 'dropped'] as const);
// Open goals count towards the limit; done and dropped ones don't.
export const OPEN = Object.freeze(['active', 'waiting-you', 'waiting', 'paused'] as const);
export const MAX_OPEN = 5;
export const DONE_KINDS = Object.freeze(['command', 'metric', 'claims', 'say'] as const);
export const MOVES = Object.freeze(['ask', 'own'] as const);
const MAX_STEPS = 60, MAX_LINKS = 40, MAX_HISTORY = 80, MAX_GOALS = 200, MAX_DEVIATIONS = 50;
// A Nexus job's id, as watchers take it.
const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const DEV_ID = /^D\d{1,4}$/;

export interface GoalDeviation {
  id: string;
  what: string;
  why?: string;
  step?: string;
  at?: string;
}

export function cleanDeviations(raw: unknown): GoalDeviation[] {
  if (!Array.isArray(raw)) return [];
  const out: GoalDeviation[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const entry = item as Record<string, unknown>;
    const what = words(entry.what, 300);
    if (!what) continue;
    const rawId = typeof entry.id === 'string' ? entry.id : '';
    const id: string = DEV_ID.test(rawId) && !seen.has(rawId) ? rawId : `D${out.length + 1}`;
    seen.add(id);
    const why = words(entry.why, 300);
    const step = typeof entry.step === 'string' && STEP_ID.test(entry.step) ? entry.step : '';
    const at = typeof entry.at === 'string' && !Number.isNaN(Date.parse(entry.at)) ? entry.at.slice(0, 40) : '';
    out.push({ id, what, ...(why ? { why } : {}), ...(step ? { step } : {}), ...(at ? { at } : {}) });
    if (out.length >= MAX_DEVIATIONS) break;
  }
  return out;
}

export interface SavedReport {
  at: string;
  mdFile: string;
  texFile: string;
  pdfFile?: string;
  compiled: boolean;
  compileError?: string;
  reproduced: number;
  total: number;
}

function cleanSavedReport(raw: unknown): SavedReport | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  if (!rec.at) return null;
  const safeName = (value: unknown): string => (typeof value === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(value) ? value : '');
  const mdFile = safeName(rec.mdFile) || 'REPORT.md';
  const texFile = safeName(rec.texFile) || 'REPORT.tex';
  const pdfFile = safeName(rec.pdfFile);
  return {
    at: String(rec.at).slice(0, 40),
    mdFile,
    texFile,
    ...(pdfFile ? { pdfFile } : {}),
    compiled: rec.compiled === true && Boolean(pdfFile),
    ...(rec.compileError ? { compileError: words(rec.compileError, 400) } : {}),
    reproduced: Math.max(0, Math.min(40, Number(rec.reproduced) || 0)),
    total: Math.max(0, Math.min(40, Number(rec.total) || 0)),
  };
}

export interface GoalTriggers {
  afterStep: boolean;
  onEvent: boolean;
  daily: string;
}

// What starts a step on its own: after a good step, when a watcher it waits on fires, and a time each day (or none).
function cleanTriggers(value: unknown = {}): GoalTriggers {
  const rec = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const dailyStr = typeof rec.daily === 'string' ? rec.daily : '';
  const daily = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(dailyStr) ? dailyStr : '';
  return { afterStep: rec.afterStep !== false, onEvent: rec.onEvent !== false, daily };
}

export type GoalWait =
  | { kind: 'watcher'; watcher: string; title: string }
  | { kind: 'date'; at: string };

function cleanWait(value: unknown): GoalWait | null {
  if (!value || typeof value !== 'object') return null;
  const rec = value as Record<string, unknown>;
  if (rec.kind === 'watcher' && typeof rec.watcher === 'string' && rec.watcher) return { kind: 'watcher', watcher: rec.watcher.slice(0, 64), title: words(rec.title, 120) };
  if (rec.kind === 'date' && typeof rec.at === 'string' && Number.isFinite(Date.parse(rec.at))) return { kind: 'date', at: new Date(rec.at).toISOString() };
  return null;
}

const ID = /^G\d{1,5}$/, STEP_ID = /^S\d{1,4}$/, SESSION_ID = /^[A-Za-z0-9_-]{1,80}$/, RUN_ID = /^[A-Z]{0,2}\d{1,6}$/;
const ARXIV_BASE_ID = /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})$/;
const ARXIV_VERSION = /^v\d{1,3}$/;
const PAPER_SOURCE_KINDS = Object.freeze(['latex', 'pdf'] as const);
const words = (value: unknown, limit: number): string => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
const lines = (value: unknown, limit: number): string => String(value ?? '').replace(/\r\n?/g, '\n').trim().slice(0, limit);

export interface PaperRecord {
  id: string;
  version: string;
  title: string;
  authors: string[];
  abstract: string;
  url: string;
  pdfUrl: string;
  sourceKind: PaperSourceKind;
  mainFile?: string;
  codeLinks: string[];
  textFile: string;
  fromScratch?: boolean;
  published?: string;
  fetchedAt?: string;
}

// A paper attached to a reproduction goal (docs/reproduce-plan.md, stage 1): id, version, metadata, source kind, code links.
export function cleanPaper(value: unknown): PaperRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  const id = typeof rec.id === 'string' && ARXIV_BASE_ID.test(rec.id.trim()) ? rec.id.trim() : '';
  const title = words(rec.title, 400);
  if (!id || !title) return null;
  const version = typeof rec.version === 'string' && ARXIV_VERSION.test(rec.version.trim()) ? rec.version.trim() : '';
  const authors = (Array.isArray(rec.authors) ? rec.authors : []).map(author => words(author, 120)).filter(Boolean).slice(0, 50);
  const abstract = lines(rec.abstract, 4000);
  const url = typeof rec.url === 'string' && /^https:\/\/arxiv\.org\/abs\/[^\s]+$/.test(rec.url.trim())
    ? rec.url.trim().slice(0, 200)
    : `https://arxiv.org/abs/${id}${version}`;
  const pdfUrl = typeof rec.pdfUrl === 'string' && /^https:\/\/arxiv\.org\/pdf\/[^\s]+$/.test(rec.pdfUrl.trim())
    ? rec.pdfUrl.trim().slice(0, 200)
    : `https://arxiv.org/pdf/${id}${version}.pdf`;
  const sourceKind: PaperSourceKind = typeof rec.sourceKind === 'string' && (PAPER_SOURCE_KINDS as readonly string[]).includes(rec.sourceKind) ? (rec.sourceKind as PaperSourceKind) : 'latex';
  const codeLinks: string[] = [];
  for (const item of Array.isArray(rec.codeLinks) ? rec.codeLinks : []) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim().slice(0, 300);
    if (/^https?:\/\/[^\s"'<>]+$/.test(trimmed) && !codeLinks.includes(trimmed)) codeLinks.push(trimmed);
    if (codeLinks.length >= 20) break;
  }
  const rawTextFile = typeof rec.textFile === 'string' ? rec.textFile.trim() : 'paper/text.txt';
  const textFile = rawTextFile && !rawTextFile.startsWith('/') && !rawTextFile.includes('..') && !rawTextFile.includes('\\')
    ? rawTextFile.slice(0, 200)
    : 'paper/text.txt';
  const mainFile = typeof rec.mainFile === 'string' && rec.mainFile.trim() && !rec.mainFile.startsWith('/') && !rec.mainFile.includes('..')
    ? rec.mainFile.trim().slice(0, 200)
    : '';
  const published = typeof rec.published === 'string' && Number.isFinite(Date.parse(rec.published)) ? new Date(rec.published).toISOString() : '';
  const fetchedAt = typeof rec.fetchedAt === 'string' && Number.isFinite(Date.parse(rec.fetchedAt)) ? new Date(rec.fetchedAt).toISOString() : '';
  return {
    id, version, title, authors, abstract, url, pdfUrl, sourceKind,
    ...(mainFile ? { mainFile } : {}),
    codeLinks, textFile,
    ...(rec.fromScratch === true ? { fromScratch: true } : {}),
    ...(published ? { published } : {}),
    ...(fetchedAt ? { fetchedAt } : {}),
  };
}

export type DoneWhen =
  | { kind: 'command'; command: string }
  | { kind: 'metric'; metric: string; op: '<=' | '>='; value: number }
  | { kind: 'claims' }
  | { kind: 'say' };

// What says a goal is done: a command that must pass in its folder, a run's metric past a value, or you saying so.
// Fairy's own judgement is never one of them.
export function cleanDoneWhen(value: unknown): DoneWhen {
  const rec = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const kind: DoneWhenKind = typeof rec.kind === 'string' && (DONE_KINDS as readonly string[]).includes(rec.kind)
    ? (rec.kind as DoneWhenKind)
    : 'say';
  if (kind === 'command') {
    const command = words(rec.command, 400);
    if (!command) throw new Error('Give the command that passes once the goal is done.');
    return { kind, command };
  }
  if (kind === 'metric') {
    const metric = words(rec.metric, 80), at = Number(rec.value), op: '<=' | '>=' = rec.op === '<=' ? '<=' : '>=';
    if (!metric || !Number.isFinite(at)) throw new Error('Give the run metric and the value it must reach.');
    return { kind, metric, op, value: at };
  }
  if (kind === 'claims') return { kind: 'claims' };
  return { kind: 'say' };
}

export interface GoalStep {
  id: string;
  what: string;
  state: StepState;
  note?: string;
  at: string;
  startedAt?: string;
  doneAt?: string;
  session?: string;
}

export interface GoalRunLink {
  id: string;
  folder: string;
}

export interface GoalLinks {
  sessions: string[];
  runs: GoalRunLink[];
}

export interface GoalLastCheck {
  at: string;
  kind: string;
  passed: boolean;
  detail: string;
  command?: string;
  exitCode?: number | null;
  timedOut?: boolean;
  run?: string;
  record?: CheckRecord | null;
  claims?: Array<{
    id: string;
    verdict: string;
    passed?: boolean;
    accepted?: boolean;
    run?: string;
    ours?: number;
    evidence?: unknown;
  }>;
}

export interface GoalBudget {
  steps: number;
  hours?: HoursBudget;
}

export interface GoalClaimsMeta {
  extractedAt: string;
  dropped: number;
}

export interface GoalHistoryEntry {
  at: string;
  what: string;
}

export interface Goal {
  id: string;
  outcome: string;
  doneWhen: DoneWhen;
  folder: string | null;
  state: GoalState;
  reason?: string;
  moves: GoalMoves;
  budget: GoalBudget;
  steps: GoalStep[];
  nextStep: number;
  notes: string;
  links: GoalLinks;
  session?: string;
  lastCheck?: GoalLastCheck;
  idle: number;
  ask?: string;
  waitsOn?: GoalWait;
  waitJob?: string;
  triggers: GoalTriggers;
  lastDaily?: string;
  pausedBy?: 'budget';
  ownPending?: boolean;
  paper?: PaperRecord;
  claims?: PaperClaim[];
  claimsMeta?: GoalClaimsMeta;
  plan?: ReproductionPlan;
  claimOutcomes?: Record<string, ClaimOutcome>;
  deviations?: GoalDeviation[];
  report?: SavedReport;
  created: string;
  updated: string;
  history: GoalHistoryEntry[];
}

const STEP_STATES: readonly StepState[] = ['todo', 'doing', 'done', 'skipped'];

// A goal as kept: everything checked, nothing else.
export function cleanGoal(value: unknown): Goal | null {
  if (!value || typeof value !== 'object') return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.id !== 'string' || !ID.test(rec.id)) return null;
  const outcome = lines(rec.outcome, 600);
  if (!outcome) return null;
  let doneWhen: DoneWhen;
  try { doneWhen = cleanDoneWhen(rec.doneWhen); } catch { doneWhen = { kind: 'say' }; }
  const steps: GoalStep[] = (Array.isArray(rec.steps) ? rec.steps : [])
    .filter((step): step is Record<string, unknown> => Boolean(step && typeof step === 'object' && typeof (step as Record<string, unknown>).id === 'string' && STEP_ID.test((step as Record<string, unknown>).id as string) && words((step as Record<string, unknown>).what, 300)))
    .slice(0, MAX_STEPS)
    .map(step => {
      const state: StepState = typeof step.state === 'string' && (STEP_STATES as readonly string[]).includes(step.state) ? (step.state as StepState) : 'todo';
      const stepSession = typeof step.session === 'string' && SESSION_ID.test(step.session) ? step.session : '';
      return {
        id: step.id as string,
        what: words(step.what, 300),
        state,
        ...(step.note ? { note: lines(step.note, 1200) } : {}),
        at: String(step.at || ''),
        ...(step.startedAt ? { startedAt: String(step.startedAt) } : {}),
        ...(step.doneAt ? { doneAt: String(step.doneAt) } : {}),
        ...(stepSession ? { session: stepSession } : {}),
      };
    });
  const links: GoalLinks = { sessions: [], runs: [] };
  const rawLinks = rec.links && typeof rec.links === 'object' ? (rec.links as Record<string, unknown>) : null;
  for (const id of Array.isArray(rawLinks?.sessions) ? rawLinks.sessions : []) {
    if (typeof id === 'string' && SESSION_ID.test(id) && !links.sessions.includes(id)) links.sessions.push(id);
  }
  for (const run of Array.isArray(rawLinks?.runs) ? rawLinks.runs : []) {
    const r = run && typeof run === 'object' ? (run as Record<string, unknown>) : null;
    if (r && typeof r.id === 'string' && RUN_ID.test(r.id) && typeof r.folder === 'string' && !links.runs.some(item => item.id === r.id && item.folder === r.folder)) {
      links.runs.push({ id: r.id, folder: r.folder });
    }
  }
  links.sessions = links.sessions.slice(0, MAX_LINKS); links.runs = links.runs.slice(0, MAX_LINKS);
  const paper = cleanPaper(rec.paper);
  const rawBudget = rec.budget && typeof rec.budget === 'object' ? (rec.budget as Record<string, unknown>) : null;
  const hours = rawBudget?.hours ? cleanHoursBudget(rawBudget.hours) : (paper ? { ...DEFAULT_HOURS } : null);
  const claims = Array.isArray(rec.claims) ? cleanClaims(rec.claims) : null;
  const rawClaimsMeta = rec.claimsMeta && typeof rec.claimsMeta === 'object' ? (rec.claimsMeta as Record<string, unknown>) : null;
  const claimsMeta: GoalClaimsMeta | null = rawClaimsMeta && rawClaimsMeta.extractedAt
    ? { extractedAt: String(rawClaimsMeta.extractedAt), dropped: Math.max(0, Math.min(200, Number(rawClaimsMeta.dropped) || 0)) }
    : null;
  const plan = paper ? cleanSavedPlan(rec.plan, { paper, claims: claims || [] }) : null;
  const claimOutcomes = paper ? cleanClaimOutcomes(rec.claimOutcomes) : {};
  const deviations = paper ? cleanDeviations(rec.deviations) : [];
  const report = paper ? cleanSavedReport(rec.report) : null;
  const state: GoalState = typeof rec.state === 'string' && (STATES as readonly string[]).includes(rec.state) ? (rec.state as GoalState) : 'active';
  const moves: GoalMoves = typeof rec.moves === 'string' && (MOVES as readonly string[]).includes(rec.moves) ? (rec.moves as GoalMoves) : 'ask';
  const goalSession = typeof rec.session === 'string' && SESSION_ID.test(rec.session) ? rec.session : '';
  const lc = rec.lastCheck && typeof rec.lastCheck === 'object' ? (rec.lastCheck as Record<string, unknown>) : null;
  const lcRecord = lc ? cleanCheckRecord(lc.record) : null;
  const waitsOn = cleanWait(rec.waitsOn);
  const waitJob = typeof rec.waitJob === 'string' && JOB_ID.test(rec.waitJob) ? rec.waitJob : '';
  const lastDaily = typeof rec.lastDaily === 'string' && /^\d{4}-\d\d-\d\d$/.test(rec.lastDaily) ? rec.lastDaily : '';
  return {
    id: rec.id, outcome, doneWhen, folder: typeof rec.folder === 'string' && rec.folder ? rec.folder : null,
    state, ...(rec.reason ? { reason: words(rec.reason, 300) } : {}),
    moves, budget: { steps: Math.min(10, Math.max(1, Number(rawBudget?.steps) || 3)), ...(hours ? { hours } : {}) },
    steps, nextStep: Number(rec.nextStep) || steps.length + 1, notes: lines(rec.notes, 4000), links,
    // Stage 2: the goal's own work chat, the last check, how many steps in a row changed nothing, and a question a step
    // left for you.
    ...(goalSession ? { session: goalSession } : {}),
    ...(lc?.at ? {
      lastCheck: {
        at: String(lc.at),
        kind: String(lc.kind || ''),
        passed: lc.passed === true,
        detail: words(lc.detail, 700),
        ...(lc.command ? { command: words(lc.command, 300) } : {}),
        ...(Number.isInteger(lc.exitCode) ? { exitCode: lc.exitCode as number } : {}),
        ...(lc.timedOut === true ? { timedOut: true } : {}),
        ...(lc.run ? { run: String(lc.run).slice(0, 12) } : {}),
        ...(lcRecord ? { record: lcRecord } : {}),
      },
    } : {}),
    idle: Math.max(0, Math.min(9, Number(rec.idle) || 0)), ...(rec.ask ? { ask: words(rec.ask, 400) } : {}),
    // Stage 3: what a waiting goal waits on (a watcher of Fairy's, or a time), and a Nexus job a step said to wait for.
    ...(waitsOn ? { waitsOn } : {}), ...(waitJob ? { waitJob } : {}),
    // Stage 4: what starts a step on its own (each a tick), the day its daily time last started one, a pause the budget
    // made, and a trigger that came while the plan was too full.
    triggers: cleanTriggers(rec.triggers), ...(lastDaily ? { lastDaily } : {}),
    ...(rec.pausedBy === 'budget' ? { pausedBy: 'budget' as const } : {}), ...(rec.ownPending === true ? { ownPending: true } : {}),
    // Reproduce a paper (stages 1–6): attached paper, quote-checked claims, extraction metadata, plan, accepted verdicts, deviations, and report.
    ...(paper ? { paper } : {}),
    ...(claims ? { claims } : {}),
    ...(claimsMeta ? { claimsMeta } : {}),
    ...(plan ? { plan } : {}),
    ...(Object.keys(claimOutcomes).length ? { claimOutcomes } : {}),
    ...(deviations.length ? { deviations } : {}),
    ...(report ? { report } : {}),
    created: String(rec.created || ''), updated: String(rec.updated || ''),
    history: (Array.isArray(rec.history) ? rec.history : [])
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && (item as Record<string, unknown>).at && (item as Record<string, unknown>).what))
      .slice(-MAX_HISTORY)
      .map(item => ({ at: String(item.at), what: words(item.what, 200) })),
  };
}

// The next step not yet done, or null.
export const nextOf = (goal: Pick<Goal, 'steps'>): GoalStep | null => goal.steps.find(step => step.state === 'todo') || null;
export const runningOf = (goal: Pick<Goal, 'steps'>): GoalStep | null => goal.steps.find(step => step.state === 'doing') || null;
// Two steps in a row that change nothing, and the goal waits for you rather than going round again.
export const IDLE_LIMIT = 2;
const FIRST_STEP = 'Work out the next step towards the goal, and take it';

export interface GoalCard {
  id: string;
  outcome: string;
  state: GoalState;
  reason?: string;
  next: string;
  done: number;
  steps: number;
  running: boolean;
  folder: string | null;
  doneWhen: DoneWhen;
  moves: GoalMoves;
  paper?: {
    id: string;
    version: string;
    title: string;
    sourceKind: PaperSourceKind;
  };
  claims?: {
    total: number;
    picked: number;
  };
  plan?: {
    status: 'pending' | 'approved';
    runs: number;
    forge: number;
    atlas: number;
  };
  report?: {
    compiled: boolean;
    at: string;
  };
  updated: string;
}

// A goal as the board shows it: its outcome, next step, steps done, and where it is.
export function cardOf(goal: Goal): GoalCard {
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
const MOVES_BY_YOU: Record<StateMove, { from: readonly GoalState[]; to: GoalState }> = { pause: { from: ['active', 'waiting-you', 'waiting'], to: 'paused' }, resume: { from: ['paused', 'waiting-you', 'waiting'], to: 'active' },
  done: { from: OPEN, to: 'done' }, drop: { from: OPEN, to: 'dropped' }, reopen: { from: ['done', 'dropped'], to: 'active' } };
export const STATE_MOVES = Object.freeze(Object.keys(MOVES_BY_YOU) as StateMove[]);

export interface GoalStoreOptions {
  path: string;
  now?: () => string;
  checkFolder?: (folder: string) => string;
}

export interface GoalStoreData {
  next: number;
  goals: Goal[];
  problem?: string;
}

export interface AddGoalInput {
  outcome?: unknown;
  doneWhen?: unknown;
  folder?: unknown;
  steps?: unknown;
  moves?: unknown;
  paper?: unknown;
}

export interface GoalSetPatch {
  outcome?: unknown;
  doneWhen?: unknown;
  folder?: unknown;
  notes?: unknown;
  moves?: unknown;
  budget?: unknown;
  triggers?: unknown;
  deviation?: unknown;
  [key: string]: unknown;
}

export interface ComparisonRowLike {
  claimId: string;
  closedOk?: boolean;
}

export interface ComparisonLike {
  rows: ComparisonRowLike[];
  allSettled?: boolean;
  passed?: boolean;
  summary?: string;
}

export interface GoalStepOp {
  op?: unknown;
  what?: unknown;
  step?: unknown;
  note?: unknown;
}

export interface GoalReportInput {
  did?: unknown;
  learned?: unknown;
  next?: unknown;
  needsYou?: unknown;
  waitJob?: unknown;
  deviations?: unknown;
}

export interface GoalSettleInput {
  outcome?: string;
  changed?: number;
  error?: string;
  check?: GoalLastCheck | null;
}

export class GoalStore {
  path: string;
  now: () => string;
  checkFolder: (folder: string) => string;
  queue: Promise<unknown>;

  // checkFolder(path): the folder a goal's steps may work in (work-sandbox.mjs' checkWorkFolder), or throws.
  constructor({ path, now = () => new Date().toISOString(), checkFolder = folder => folder }: GoalStoreOptions) {
    this.path = path;
    this.now = now;
    this.checkFolder = checkFolder;
    this.queue = Promise.resolve();
  }
  async read(): Promise<GoalStoreData> {
    let text: string;
    try { text = await readFile(this.path, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return { next: 1, goals: [] }; throw error; }
    try {
      const saved = JSON.parse(text) as { goals?: unknown; next?: unknown } | null;
      const goals = (Array.isArray(saved?.goals) ? saved.goals : []).map(cleanGoal).filter((goal): goal is Goal => Boolean(goal)).slice(-MAX_GOALS);
      const highest = goals.reduce((most, goal) => Math.max(most, Number(goal.id.slice(1))), 0);
      return { next: Math.max(Number(saved?.next) || 1, highest + 1), goals };
    } catch (error) {
      await rename(this.path, this.path.replace(/\.json$/, '.unreadable.json')).catch(() => {});
      const message = error instanceof Error ? error.message : String(error);
      return { next: 1, goals: [], problem: `goals.json couldn’t be read (${message}); it was kept as goals.unreadable.json.` };
    }
  }
  // One change at a time, written whole through a temporary file.
  change<T>(fn: (data: GoalStoreData) => T | Promise<T>): Promise<T> {
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
  async list(): Promise<{ goals: GoalCard[]; open: number; max: number; problem?: string }> {
    const data = await this.read();
    return { goals: data.goals.map(cardOf), open: data.goals.filter(goal => (OPEN as readonly string[]).includes(goal.state)).length, max: MAX_OPEN, ...(data.problem ? { problem: data.problem } : {}) };
  }
  async get(id: string): Promise<Goal> {
    const goal = (await this.read()).goals.find(item => item.id === id);
    if (!goal) throw new Error('There’s no such goal.');
    return goal;
  }

  folderOf(value: unknown): string | null {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'string') throw new Error('Choose a folder, or none.');
    return this.checkFolder(value);
  }
  // A new goal: its outcome, done-when, folder (or none), first steps, and optional attached paper.
  async add({ outcome, doneWhen, folder = null, steps = [], moves = 'ask', paper = null }: AddGoalInput = {}): Promise<Goal> {
    const text = lines(outcome, 600);
    if (!text) throw new Error('Say what the goal is: what should be true at the end.');
    const when = cleanDoneWhen(doneWhen), place = this.folderOf(folder), attached = paper ? cleanPaper(paper) : null;
    if (paper && !attached) throw new Error('That paper record isn’t valid.');
    if (when.kind === 'command' && !place) throw new Error('A command can only be checked in a folder: choose one, or make it “I say so”.');
    if (when.kind === 'claims' && (!attached || !place)) throw new Error('Claims done-when is for a paper reproduction in a folder.');
    return this.change(data => {
      if (data.goals.filter(goal => (OPEN as readonly string[]).includes(goal.state)).length >= MAX_OPEN) throw new Error(`${MAX_OPEN} goals are open already. Finish, drop or pause one first.`);
      const at = this.now(), id = `G${data.next++}`;
      const first = (Array.isArray(steps) ? steps : String(steps || '').split('\n')).map(step => words(step, 300)).filter(Boolean).slice(0, 20);
      const goal = cleanGoal({ id, outcome: text, doneWhen: when, folder: place, moves, state: 'active', ...(attached ? { paper: attached } : {}), created: at, updated: at,
        steps: first.map((what, index) => ({ id: `S${index + 1}`, what, state: 'todo', at })), nextStep: first.length + 1, history: [{ at, what: attached ? `Made from arXiv:${attached.id}${attached.version}` : 'Made' }] })!;
      data.goals.push(goal);
      return goal;
    });
  }
  edit(id: string, fn: (goal: Goal, data: GoalStoreData) => string | void): Promise<Goal> {
    if (typeof id !== 'string' || !ID.test(id)) return Promise.reject(new Error('There’s no such goal.'));
    return this.change(data => {
      const index = data.goals.findIndex(goal => goal.id === id);
      if (index < 0) throw new Error('There’s no such goal.');
      const goal = structuredClone(data.goals[index]), said = fn(goal, data);
      goal.updated = this.now();
      if (said) goal.history = [...goal.history, { at: goal.updated, what: said }].slice(-MAX_HISTORY);
      data.goals[index] = cleanGoal(goal)!;
      return data.goals[index];
    });
  }
  // Its outcome, done-when, folder, notes: only you change these.
  async set(id: string, patch: GoalSetPatch = {}): Promise<Goal> {
    const next: {
      outcome?: string;
      doneWhen?: DoneWhen;
      folder?: string | null;
      notes?: string;
      moves?: GoalMoves;
      budget?: GoalBudget;
      triggers?: GoalTriggers;
    } = {};
    if ('outcome' in patch) { next.outcome = lines(patch.outcome, 600); if (!next.outcome) throw new Error('A goal needs its outcome.'); }
    if ('doneWhen' in patch) next.doneWhen = cleanDoneWhen(patch.doneWhen);
    if ('folder' in patch) next.folder = this.folderOf(patch.folder);
    if ('notes' in patch) next.notes = lines(patch.notes, 4000);
    if ('moves' in patch) { if (typeof patch.moves !== 'string' || !(MOVES as readonly string[]).includes(patch.moves)) throw new Error('Choose Ask first or On its own.'); next.moves = patch.moves as GoalMoves; }
    if ('budget' in patch) { const budgetObj = patch.budget && typeof patch.budget === 'object' ? (patch.budget as Record<string, unknown>) : null; const steps = Number(budgetObj?.steps); if (!Number.isInteger(steps) || steps < 1 || steps > 10) throw new Error('Give between 1 and 10 steps a day.'); next.budget = { steps }; }
    if ('triggers' in patch) {
      const trigObj = patch.triggers && typeof patch.triggers === 'object' ? (patch.triggers as Record<string, unknown>) : {};
      const daily = String(trigObj.daily ?? '');
      if (daily && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(daily)) throw new Error('Give the daily time as HH:MM, on the 24-hour clock.');
      next.triggers = cleanTriggers({ ...trigObj, daily });
    }
    const devOp = patch.deviation && typeof patch.deviation === 'object' && !Array.isArray(patch.deviation) ? (patch.deviation as Record<string, unknown>) : null;
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
      const labels: Record<string, string | undefined> = { outcome: 'Outcome changed', doneWhen: 'Done-when changed', folder: 'Folder changed', moves: next.moves === 'own' ? 'Set to move on its own' : 'Set to ask first', budget: `${next.budget?.steps} steps a day`, triggers: 'What starts a step changed' };
      const notes = Object.keys(next).filter(key => key !== 'notes').map(key => labels[key]).filter((item): item is string => Boolean(item));
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
          notes.push(`Deviation ${String(devOp.id)} removed`);
        }
      }
      return notes.join('; ');
    });
  }
  // Reproduce a paper (stage 2): store quote-checked extracted claims on a paper goal.
  async setClaims(id: string, claims: unknown, { dropped = 0, extractedAt = null }: { dropped?: number; extractedAt?: string | null } = {}): Promise<Goal> {
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
  async pickClaims(id: string, { picks = null, tolerances = null, hours = null, fromScratch = null }: { picks?: unknown; tolerances?: unknown; hours?: unknown; fromScratch?: unknown } = {}): Promise<Goal> {
    const validatedHours = hours !== null && hours !== undefined ? validateHoursBudget(hours) : null;
    if (fromScratch !== null && fromScratch !== undefined && typeof fromScratch !== 'boolean') {
      throw new Error('Always write from scratch must be true or false.');
    }
    return this.edit(id, goal => {
      if (!goal.paper) throw new Error('This goal doesn’t have a paper attached.');
      const parts: string[] = [];
      if (picks !== null || tolerances !== null) {
        goal.claims = applyClaimChoices(goal.claims || [], { picks, tolerances });
        if (picks !== null) {
          const count = goal.claims.filter(claim => claim.picked).length;
          parts.push(`Picked ${count} claim${count === 1 ? '' : 's'}`);
        }
        if (tolerances !== null && Object.keys((tolerances as Record<string, unknown>) || {}).length) parts.push('Tolerances updated');
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
  async setPlan(id: string, plan: unknown, { fromScratch = null }: { fromScratch?: unknown } = {}): Promise<Goal> {
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
      const cleaned = cleanSavedPlan({ ...(plan as Record<string, unknown>), status: 'pending', approvedAt: '' }, { paper: goal.paper, claims: goal.claims || [] });
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
  async approvePlan(id: string, { action = 'approve' }: { action?: unknown } = {}): Promise<Goal> {
    if (typeof action !== 'string' || !['approve', 'discard'].includes(action)) throw new Error('Choose approve or discard for the reproduction plan.');
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
  async setClaimOutcome(id: string, { claim, verdict, reason = '' }: { claim?: unknown; verdict?: unknown; reason?: unknown } = {}): Promise<Goal> {
    const claimId = typeof claim === 'string' ? claim.trim().toUpperCase() : '';
    if (!/^C\d{1,3}$/.test(claimId)) throw new Error('Choose a valid claim id (such as C1).');
    if (verdict !== 'clear' && (typeof verdict !== 'string' || !ACCEPTED_VERDICTS.includes(verdict))) {
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
  async closeByComparison(id: string, { comparison, check = null }: { comparison?: unknown; check?: GoalLastCheck | null } = {}): Promise<Goal> {
    if (!comparison || typeof comparison !== 'object' || !Array.isArray((comparison as ComparisonLike).rows)) {
      throw new Error('Compare the picked claims before closing.');
    }
    const comp = comparison as ComparisonLike;
    if (!comp.rows.length) throw new Error('Pick at least one claim before closing.');
    if (!comp.allSettled) {
      const pending = comp.rows.filter(row => !row.closedOk).map(row => row.claimId);
      throw new Error(`Accept or reproduce ${pending.join(', ')} before closing this reproduction.`);
    }
    return this.edit(id, goal => {
      if (!goal.paper) throw new Error('This goal doesn’t have a paper attached.');
      if (!(OPEN as readonly string[]).includes(goal.state)) throw new Error(`A goal that’s ${goal.state.replace('-', ' ')} can’t be closed.`);
      if (runningOf(goal)) throw new Error('A step is running; wait until it ends first.');
      goal.state = 'done';
      delete goal.ask;
      delete goal.waitsOn;
      delete goal.pausedBy;
      const summary = words(comp.summary, 300) || (comp.passed ? 'All picked claims reproduced.' : 'Closed with accepted claim verdicts.');
      goal.reason = summary;
      if (check) goal.lastCheck = check;
      return comp.passed ? `Done: ${summary}` : `Closed with accepted verdicts: ${summary}`;
    });
  }
  // Reproduce a paper (stage 6): store metadata for the latest generated REPORT.md / REPORT.pdf.
  async setReport(id: string, record: unknown): Promise<Goal> {
    const cleaned = cleanSavedReport(record);
    if (!cleaned) throw new Error('Give a valid report record.');
    return this.edit(id, goal => {
      if (!goal.paper) throw new Error('This goal doesn’t have a paper attached.');
      goal.report = cleaned;
      return cleaned.compiled ? `Report compiled (${cleaned.mdFile} + ${cleaned.pdfFile})` : `Report written (${cleaned.mdFile}; PDF not compiled)`;
    });
  }
  // A step: add one, tick or untick it, skip it, change its words, or remove it.
  async step(id: string, op: GoalStepOp = {}): Promise<Goal> {
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
  async state(id: string, move: string, reason = ''): Promise<Goal> {
    const rule = (MOVES_BY_YOU as Record<string, { from: readonly GoalState[]; to: GoalState } | undefined>)[move];
    if (!rule) return Promise.reject(new Error('That isn’t something a goal can do.'));
    return this.edit(id, (goal, data) => {
      if (!rule.from.includes(goal.state)) throw new Error(`A goal that’s ${goal.state.replace('-', ' ')} can’t ${move}.`);
      if (move === 'reopen' && data.goals.filter(item => (OPEN as readonly string[]).includes(item.state)).length >= MAX_OPEN) throw new Error(`${MAX_OPEN} goals are open already. Finish, drop or pause one first.`);
      goal.state = rule.to;
      if (move === 'resume') { delete goal.ask; delete goal.waitsOn; delete goal.pausedBy; }
      const why = words(reason, 300);
      if (why) goal.reason = why; else delete goal.reason;
      const moveLabels: Record<StateMove, string> = { pause: 'Paused', resume: 'Resumed', done: 'Marked done by you', drop: 'Dropped', reopen: 'Reopened' };
      return moveLabels[move as StateMove] + (why ? `: ${why}` : '');
    });
  }
  // ── stage 2: a step as a work turn ──
  // The next step begins: the goal must be active, have a folder and no step running. With no step written, the step
  // is to work out the next one and take it.
  async begin(id: string): Promise<{ goal: Goal; step: string }> {
    let started: { step: string; what: string } | null = null;
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
    return { goal: await this.get(id), step: started!.step };
  }
  // The step's own work chat, kept on the goal and linked, so each step carries on the same conversation.
  async useSession(id: string, session: string): Promise<Goal> {
    return this.edit(id, goal => { goal.session = session; if (!goal.links.sessions.includes(session)) goal.links.sessions.push(session); return ''; });
  }
  // goal_update from the running step: what it did, what it learned, the next step, a question for you, and any deviations
  // from the paper (stage 6). Only for the step that's running, and never the outcome or done-when.
  async report(id: string, stepId: string, { did = '', learned = '', next = '', needsYou = '', waitJob = '', deviations = [] }: GoalReportInput = {}): Promise<Goal> {
    const doneText = lines(did, 1200), nextText = words(next, 300), learnedText = lines(learned, 1000), ask = words(needsYou, 400), job = String(waitJob || '').trim();
    if (!doneText) throw new Error('Say what this step did.');
    if (job && !JOB_ID.test(job)) throw new Error('That isn’t a Nexus job id.');
    const incomingDevs = (Array.isArray(deviations) ? deviations : []).slice(0, 12)
      .map(item => {
        if (typeof item === 'string') return { what: words(item, 300), why: '' };
        const obj = item && typeof item === 'object' ? (item as Record<string, unknown>) : null;
        return { what: words(obj?.what, 300), why: words(obj?.why, 300) };
      })
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
  async wait(id: string, waitsOn: unknown): Promise<Goal> {
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
  async wake(id: string, why = ''): Promise<Goal> {
    return this.edit(id, goal => {
      if (goal.state !== 'waiting') throw new Error(`${goal.id} isn’t waiting.`);
      goal.state = 'active'; delete goal.waitsOn; delete goal.reason;
      return `The wait is over${why ? `: ${words(why, 160)}` : ''}`;
    });
  }
  // Goals waiting on a time that has come.
  async dueWaits(): Promise<string[]> {
    const now = Date.parse(this.now());
    return (await this.read()).goals.filter(goal => goal.state === 'waiting' && goal.waitsOn?.kind === 'date' && Date.parse(goal.waitsOn.at) <= now).map(goal => goal.id);
  }
  // Goals waiting on a watcher.
  async waitingOn(watcher: string): Promise<string[]> {
    return (await this.read()).goals.filter(goal => goal.state === 'waiting' && goal.waitsOn?.kind === 'watcher' && goal.waitsOn.watcher === watcher).map(goal => goal.id);
  }
  // The step's turn has ended: done, failed or stopped, and whether it changed any file; then the check, if one ran.
  async settle(id: string, stepId: string, { outcome = 'done', changed = 0, error = '', check = null }: GoalSettleInput = {}): Promise<Goal> {
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
  async recover(isRunning: (session?: string) => boolean = () => false): Promise<number> {
    return this.change(data => {
      let count = 0;
      for (const goal of data.goals) for (const step of goal.steps) if (step.state === 'doing' && !isRunning(goal.session)) { step.state = 'todo'; step.note = 'Interrupted when Fairy quit; it’s ready to run again.'; count++; }
      return count;
    });
  }

  // ── stage 4: on its own ──
  // The budget is spent for today: paused until tomorrow, when it's resumed on its own.
  async budgetPause(id: string, why?: string): Promise<Goal> {
    return this.edit(id, goal => {
      if (goal.state !== 'active') return '';
      goal.state = 'paused'; goal.pausedBy = 'budget'; goal.reason = words(why, 300) || 'Its steps for today are done; it goes on tomorrow.'; delete goal.ownPending;
      return 'Paused for today: its budget is spent';
    });
  }
  // A new day: goals the budget paused are active again. Answers their ids.
  async newDay(): Promise<string[]> {
    const woke: string[] = [];
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
  async ownPending(id: string, pending = true): Promise<Goal> { return this.edit(id, goal => { if (pending) goal.ownPending = true; else delete goal.ownPending; return ''; }); }
  async markDaily(id: string, day: string): Promise<Goal> { return this.edit(id, goal => { goal.lastDaily = day; return ''; }); }

  // A chat or a run that belongs to the goal.
  async link(id: string, { session, run, folder, remove = false }: { session?: unknown; run?: unknown; folder?: unknown; remove?: boolean } = {}): Promise<Goal> {
    return this.edit(id, goal => {
      if (session !== undefined) {
        const sessionId = String(session);
        if (!SESSION_ID.test(sessionId)) throw new Error('That isn’t a chat.');
        goal.links.sessions = remove ? goal.links.sessions.filter(item => item !== sessionId) : [...new Set([...goal.links.sessions, sessionId])];
        return remove ? 'A chat unlinked' : 'A chat linked';
      }
      if (run !== undefined) {
        const runId = String(run);
        if (!RUN_ID.test(runId) || typeof folder !== 'string' || !folder) throw new Error('That isn’t a run.');
        goal.links.runs = remove ? goal.links.runs.filter(item => !(item.id === runId && item.folder === folder)) : [...goal.links.runs.filter(item => !(item.id === runId && item.folder === folder)), { id: runId, folder }];
        return remove ? `Run ${runId} unlinked` : `Run ${runId} linked`;
      }
      throw new Error('Link a chat or a run.');
    });
  }
}
