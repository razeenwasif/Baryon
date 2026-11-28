// Reliability plan, Part D (docs/reliability-plan.md): outside writes recorded first in outside-writes.jsonl.
// Every write tool acting outside the work folder appends an `intent` line before sending and `done` or `failed`
// after returning. On startup, any line still at `intent` becomes `unknown`. On Carry on, Fairy tells the model
// which writes are unknown and refuses to repeat a write with the same argument hash in that chat until settled —
// either by looking it up on the service or by asking the user. Only argument hashes and non-content ids are stored;
// email text, comment bodies, file contents, and prompts are never written to outside-writes.jsonl.
import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ACTIONS, WATCH_EVENTS, cleanWatcher } from './watchers.mjs';
import type { Watcher } from './watchers.mjs';

export type OutsideWriteState = 'intent' | 'done' | 'failed' | 'unknown';

export interface OutsideWriteRecord {
  id: string;
  at: string;
  chat: string;
  turn: string;
  tool: string;
  hash: string;
  clientId?: string;
  state: OutsideWriteState;
  outsideId?: string;
  reason?: string;
}

export type OutsideWriteArgs = Record<string, unknown>;

export interface OutsideWriteContext {
  folder?: string;
  github?: {
    pr?: (params: { repo: unknown; number: unknown }) => Promise<{
      url?: unknown;
      conversation?: Array<{ body?: unknown; url?: unknown }>;
      comments?: Array<{ body?: unknown; url?: unknown }>;
      reviewComments?: Array<{ body?: unknown; url?: unknown; inReplyTo?: unknown }>;
      inline?: Array<{ body?: unknown; url?: unknown; inReplyTo?: unknown }>;
      reviews?: Array<{ state?: unknown; body?: unknown }>;
    } | null | undefined>;
    issue?: (params: { repo: unknown; number: unknown }) => Promise<{
      url?: unknown;
      comments?: Array<{ body?: unknown; url?: unknown }>;
    } | null | undefined>;
    issues?: (params: { repo: unknown; state: string; limit: number }) => Promise<
      | { issues?: Array<{ title?: unknown; url?: unknown; number?: unknown }> }
      | Array<{ title?: unknown; url?: unknown; number?: unknown }>
      | null
      | undefined
    >;
    prs?: (params: { repo: unknown; state: string; limit: number }) => Promise<
      | { prs?: Array<{ title?: unknown; url?: unknown; number?: unknown; headRefName?: unknown; head?: unknown }> }
      | Array<{ title?: unknown; url?: unknown; number?: unknown; headRefName?: unknown; head?: unknown }>
      | null
      | undefined
    >;
  };
  neutrino?: {
    prs?: (params: { repo: unknown; state: string; limit: number }) => Promise<{
      prs?: Array<{ title?: unknown; source?: unknown; repo?: unknown; number?: unknown }>;
    } | null | undefined>;
    pr?: (params: { repo: unknown; number: unknown }) => Promise<{
      repo?: unknown;
      number?: unknown;
      state?: unknown;
      mergeSha?: unknown;
      notes?: Array<{ text?: unknown; path?: unknown; line?: unknown }>;
    } | null | undefined>;
    repos?: (params: { kind: string; query: unknown; limit: number }) => Promise<{
      repos?: Array<{ name?: string; id?: string }>;
    } | null | undefined>;
  };
  gmail?: {
    findReplyDraft?: (params: { messageId: unknown; body: unknown }, signal?: AbortSignal) => Promise<{ id?: unknown } | null | undefined>;
  };
  calendar?: {
    eventById?: (clientId: string, signal?: AbortSignal) => Promise<{ id?: unknown } | null | undefined>;
  };
  drive?: {
    search?: (params: { query: unknown; mimeType: unknown; pageSize: number }, signal?: AbortSignal) => Promise<{
      files?: Array<{ name?: unknown; mimeType?: unknown; id?: unknown; webViewLink?: unknown }>;
    } | null | undefined>;
  };
  nexus?: {
    listJobs?: (signal?: AbortSignal) => Promise<Array<{ state?: unknown; name?: unknown; job?: unknown }> | null | undefined>;
    listTickets?: (signal?: AbortSignal) => Promise<Array<{ command?: unknown; job?: unknown }> | null | undefined>;
  };
  watchers?: {
    list?: () => Promise<Array<Watcher | Record<string, unknown>> | null | undefined>;
  };
  [key: string]: unknown;
}

export type OutsideWriteLookupResult =
  | { found: true; outsideId: string }
  | { found: false }
  | { found: null };

export interface LookupOutsideWriteOptions {
  tool?: string;
  args?: OutsideWriteArgs;
  entry?: OutsideWriteRecord | null;
  context?: OutsideWriteContext;
  signal?: AbortSignal;
}

export interface OutsideWriteLedgerOptions {
  path: string;
  now?: () => string;
}

export type OutsideWriteBeforeSettleHook = (info: {
  tool: string;
  args: OutsideWriteArgs;
  entry: OutsideWriteRecord;
  result?: unknown;
  error?: unknown;
}) => boolean | void | Promise<boolean | void>;

export interface GuardAndRunOptions<T = unknown> {
  chat?: string;
  turn?: string;
  tool: string;
  args?: OutsideWriteArgs;
  context?: OutsideWriteContext;
  signal?: AbortSignal;
  beforeIntent?: (() => unknown | Promise<unknown>) | null;
  run: (ctx: { clientId: string; entry: OutsideWriteRecord }) => T | Promise<T>;
}

export type GuardAndRunResult<T = unknown> =
  | {
      blocked: true;
      outcome: 'refused';
      alreadyLanded: true;
      outsideId: string;
      error: string;
    }
  | {
      blocked: true;
      outcome: 'unknown';
      error: string;
    }
  | {
      blocked: false;
      result: T;
      entry: OutsideWriteRecord;
      crashedBeforeRecord?: boolean;
    };

const WATCH_KEYS = ['event', 'repo', 'branch', 'pr', 'job', 'path', 'query', 'action', 'folder'] as const;
const matchesWatcher = (
  a: Watcher | Record<string, unknown> | null | undefined,
  b: Watcher | Record<string, unknown> | null | undefined,
): boolean => {
  const left = a as Record<string, unknown> | null | undefined;
  const right = b as Record<string, unknown> | null | undefined;
  return WATCH_KEYS.every(key => (left?.[key] ?? '') === (right?.[key] ?? ''));
};
function watcherFromArgs(args: OutsideWriteArgs = {}, { folder = '' }: { folder?: string } = {}): Watcher | null {
  const value: Record<string, unknown> = args && typeof args === 'object' ? args : {};
  if (!(WATCH_EVENTS as readonly unknown[]).includes(value.event)) return null;
  const action = (value.action as string) || 'tell';
  if (!(ACTIONS as readonly unknown[]).includes(action)) return null;
  return cleanWatcher({
    event: value.event, repo: value.repo ?? '', branch: value.branch ?? '', pr: value.pr ?? null,
    job: value.job ?? '', path: value.path ?? '', query: value.query ?? '',
    every: value.every ?? '', action, prompt: value.prompt ?? '',
    folder: action === 'work' ? value.folder || folder : '', runOnOwn: false, title: value.title ?? '', id: 'draft', state: {},
  });
}

export const OUTSIDE_WRITE_STATES: readonly OutsideWriteState[] = Object.freeze(['intent', 'done', 'failed', 'unknown'] as const);

export const OUTSIDE_WRITE_TOOLS: Set<string> = new Set([
  'calendar_create',
  'gmail_save_reply_draft',
  'drive_create_file',
  'drive_create_doc',
  'drive_create_sheet',
  'drive_create_slides',
  'drive_update_file',
  'github_pr_comment',
  'github_review_reply',
  'github_review',
  'github_issue_create',
  'github_issue_comment',
  'github_pr_create',
  'neutrino_pr_create',
  'neutrino_pr_note',
  'neutrino_pr_resolve_note',
  'neutrino_pr_update',
  'neutrino_pr_merge',
  'neutrino_run_start',
  'neutrino_run_rerun',
  'neutrino_run_cancel',
  'neutrino_job_approve',
  'neutrino_mirror_now',
  'neutrino_create_repo',
  'neutrino_backup',
  'nexus_run',
  'watch_add',
  'research_start',
]);

export function isOutsideWriteTool(name: unknown, { connector = false }: { connector?: boolean } = {}): boolean {
  return Boolean(connector) || OUTSIDE_WRITE_TOOLS.has(String(name || ''));
}

// Deterministic JSON serialization with sorted keys so semantically identical arguments always hash identically.
export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(item => (item === undefined ? 'null' : canonicalStringify(item))).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter(key => record[key] !== undefined).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalStringify(record[key])}`).join(',')}}`;
}

export function hashArguments(tool: unknown, args: unknown = {}): string {
  return createHash('sha256')
    .update(`${String(tool || '')}\0${canonicalStringify(args && typeof args === 'object' ? args : {})}`)
    .digest('hex');
}

// Deterministic 32-char lowercase hex id for Google Calendar event creation (valid base32hex, carries zero content).
export function clientIdFor(chat: unknown, hash: unknown): string {
  return createHash('sha256').update(`cal\0${String(chat || '')}\0${String(hash || '')}`).digest('hex').slice(0, 32);
}

const squash = (text: unknown): string => String(text ?? '').replace(/\s+/g, ' ').trim();
const safeId = (value: unknown): string => (typeof value === 'string' && value.trim() ? value.trim().slice(0, 240) : '');

export function outsideIdOf(tool: string, result: unknown): string {
  if (!result || typeof result !== 'object') return '';
  const r = result as {
    event?: { id?: unknown; htmlLink?: unknown };
    id?: unknown;
    draftId?: unknown;
    file?: { id?: unknown };
    webViewLink?: unknown;
    job?: unknown;
    url?: unknown;
    repo?: unknown;
    number?: unknown;
    sha?: unknown;
    path?: unknown;
    added?: unknown;
    opened?: unknown;
  };
  if (tool === 'calendar_create') return safeId(r.event?.id || r.event?.htmlLink || r.id);
  if (tool === 'gmail_save_reply_draft') return safeId(r.draftId || r.id);
  if (tool.startsWith('drive_')) return safeId(r.file?.id || r.id || r.webViewLink);
  if (tool === 'nexus_run') return safeId(r.job);
  if (tool.startsWith('github_')) return safeId(r.url || (r.id ? String(r.id) : ''));
  if (tool.startsWith('neutrino_')) {
    if (r.repo && r.number) return safeId(`${r.repo}#${r.number}`);
    if (r.sha) return safeId(r.sha);
    return safeId(r.id ? String(r.id) : r.path || r.repo || '');
  }
  if (tool === 'watch_add') return safeId(r.id || (r.added ? 'added' : ''));
  if (tool === 'research_start') return safeId(r.id || (r.opened ? 'opened' : ''));
  return safeId(r.id || r.url || '');
}

const PHRASES: Record<string, string> = {
  calendar_create: 'created this calendar event',
  gmail_save_reply_draft: 'created this draft',
  drive_create_file: 'created this Drive file',
  drive_create_doc: 'created this Google Doc',
  drive_create_sheet: 'created this Google Sheet',
  drive_create_slides: 'created this Google Slides presentation',
  drive_update_file: 'updated this Drive file',
  github_pr_comment: 'posted this GitHub pull request comment',
  github_review_reply: 'posted this GitHub review reply',
  github_review: 'submitted this GitHub pull request review',
  github_issue_create: 'created this GitHub issue',
  github_issue_comment: 'posted this GitHub issue comment',
  github_pr_create: 'opened this GitHub pull request',
  neutrino_pr_create: 'opened this Neutrino pull request',
  neutrino_pr_note: 'added this Neutrino review note',
  neutrino_pr_resolve_note: 'updated this Neutrino review note',
  neutrino_pr_update: 'updated this Neutrino pull request',
  neutrino_pr_merge: 'merged this Neutrino pull request',
  neutrino_run_start: 'started this Neutrino CI run',
  neutrino_run_rerun: 'restarted this Neutrino CI run',
  neutrino_run_cancel: 'cancelled this Neutrino CI run',
  neutrino_job_approve: 'decided this Neutrino deploy approval',
  neutrino_mirror_now: 'synced this Neutrino mirror',
  neutrino_create_repo: 'created this Neutrino repository',
  neutrino_backup: 'triggered this Neutrino database backup',
  nexus_run: 'submitted this Nexus job',
  watch_add: 'added this watcher',
  research_start: 'opened this Research draft',
};

export function actionPhrase(tool: string): string {
  return PHRASES[tool] || `run ${String(tool || 'this outside action')}`;
}

export function isCancelledResult(tool: string, result: unknown): boolean {
  if (!result || typeof result !== 'object') return false;
  const r = result as {
    cancelled?: unknown;
    added?: unknown;
    already?: unknown;
    created?: unknown;
    updated?: unknown;
    posted?: unknown;
    submitted?: unknown;
    merged?: unknown;
    started?: unknown;
    rerun?: unknown;
    cancelledRun?: unknown;
    approved?: unknown;
    mirrored?: unknown;
    backedUp?: unknown;
  };
  if (r.cancelled === true) return true;
  if (tool === 'watch_add' && r.added === false && !r.already) return true;
  if (tool === 'calendar_create' && r.created === false) return true;
  if (tool.startsWith('drive_') && (r.created === false || r.updated === false)) return true;
  if (tool === 'github_pr_comment' && r.posted === false) return true;
  if (tool === 'github_review_reply' && r.posted === false) return true;
  if (tool === 'github_review' && (r.submitted === false || r.posted === false)) return true;
  if (tool === 'github_issue_create' && r.created === false) return true;
  if (tool === 'github_issue_comment' && r.posted === false) return true;
  if (tool === 'github_pr_create' && r.created === false) return true;
  if (tool === 'neutrino_pr_create' && r.created === false) return true;
  if (tool === 'neutrino_pr_note' && r.posted === false) return true;
  if ((tool === 'neutrino_pr_resolve_note' || tool === 'neutrino_pr_update') && r.updated === false) return true;
  if (tool === 'neutrino_pr_merge' && r.merged === false) return true;
  if (tool === 'neutrino_run_start' && r.started === false) return true;
  if (tool === 'neutrino_run_rerun' && r.rerun === false) return true;
  if (tool === 'neutrino_run_cancel' && r.cancelledRun === false) return true;
  if (tool === 'neutrino_job_approve' && r.approved === false) return true;
  if (tool === 'neutrino_mirror_now' && r.mirrored === false) return true;
  if (tool === 'neutrino_create_repo' && r.created === false) return true;
  if (tool === 'neutrino_backup' && r.backedUp === false) return true;
  return false;
}

const sameBody = (a: unknown, b: unknown): boolean => squash(a) !== '' && squash(a) === squash(b);

// Service-specific lookup for an `unknown` write (Decision 4: Fairy looks first where the service supports it).
// Returns { found: true, outsideId } | { found: false } | { found: null } (unable to verify -> ask user).
export async function lookupOutsideWrite({
  tool,
  args = {},
  entry = null,
  context = {},
  signal,
}: LookupOutsideWriteOptions = {}): Promise<OutsideWriteLookupResult> {
  try {
    if (tool === 'github_pr_comment' && context.github?.pr) {
      const pr = await context.github.pr({ repo: args.repo, number: args.number });
      const comments = Array.isArray(pr?.conversation) ? pr.conversation : Array.isArray(pr?.comments) ? pr.comments : [];
      const hit = comments.find(c => sameBody(c?.body, args.body));
      return hit ? { found: true, outsideId: safeId(hit.url || pr?.url) } : { found: false };
    }
    if (tool === 'github_issue_comment' && context.github?.issue) {
      const issue = await context.github.issue({ repo: args.repo, number: args.number });
      const comments = Array.isArray(issue?.comments) ? issue.comments : [];
      const hit = comments.find(c => sameBody(c?.body, args.body));
      return hit ? { found: true, outsideId: safeId(hit.url || issue?.url) } : { found: false };
    }
    if (tool === 'github_review_reply' && context.github?.pr) {
      const pr = await context.github.pr({ repo: args.repo, number: args.number });
      const inline = Array.isArray(pr?.reviewComments) ? pr.reviewComments : Array.isArray(pr?.inline) ? pr.inline : [];
      const hit = inline.find(c => sameBody(c?.body, args.body) && (!args.comment || !c.inReplyTo || Number(c.inReplyTo) === Number(args.comment)));
      return hit ? { found: true, outsideId: safeId(hit.url || pr?.url) } : { found: false };
    }
    if (tool === 'github_review' && context.github?.pr) {
      const pr = await context.github.pr({ repo: args.repo, number: args.number });
      const reviews = Array.isArray(pr?.reviews) ? pr.reviews : [];
      const verdictMap: Record<string, string> = { approve: 'APPROVED', changes: 'CHANGES_REQUESTED', 'request-changes': 'CHANGES_REQUESTED', comment: 'COMMENTED' };
      const wanted = (typeof args.verdict === 'string' && verdictMap[args.verdict]) || '';
      const hit = reviews.find(r => (!wanted || String(r?.state || '').toUpperCase() === wanted) && (!args.body || sameBody(r?.body, args.body)));
      return hit ? { found: true, outsideId: safeId(pr?.url) } : { found: false };
    }
    if (tool === 'github_issue_create' && context.github?.issues) {
      const list = await context.github.issues({ repo: args.repo, state: 'open', limit: 30 });
      const issues = !Array.isArray(list) && Array.isArray(list?.issues) ? list.issues : Array.isArray(list) ? list : [];
      const hit = issues.find(i => sameBody(i?.title, args.title));
      return hit ? { found: true, outsideId: safeId(hit.url || (hit.number ? `#${hit.number}` : '')) } : { found: false };
    }
    if (tool === 'github_pr_create' && context.github?.prs) {
      const list = await context.github.prs({ repo: args.repo, state: 'open', limit: 30 });
      const prs = !Array.isArray(list) && Array.isArray(list?.prs) ? list.prs : Array.isArray(list) ? list : [];
      const hit = prs.find(p => sameBody(p?.title, args.title) && (!args.head || (p.headRefName || p.head) === args.head));
      return hit ? { found: true, outsideId: safeId(hit.url || (hit.number ? `#${hit.number}` : '')) } : { found: false };
    }
    if (tool === 'neutrino_pr_create' && context.neutrino?.prs) {
      const list = await context.neutrino.prs({ repo: args.repo, state: 'open', limit: 30 });
      const prs = Array.isArray(list?.prs) ? list.prs : [];
      const hit = prs.find(p => sameBody(p?.title, args.title) && (!args.source || p.source === args.source));
      return hit ? { found: true, outsideId: safeId(`${hit.repo}#${hit.number}`) } : { found: false };
    }
    if (tool === 'neutrino_pr_note' && context.neutrino?.pr) {
      const pr = await context.neutrino.pr({ repo: args.repo, number: args.number });
      const notes = Array.isArray(pr?.notes) ? pr.notes : [];
      const hit = notes.find(n => sameBody(n?.text, args.text) && (!args.path || n.path === args.path) && (!args.line || Number(n.line) === Number(args.line)));
      return hit ? { found: true, outsideId: safeId(`${pr?.repo}#${pr?.number}`) } : { found: false };
    }
    if (tool === 'neutrino_pr_merge' && context.neutrino?.pr) {
      const pr = await context.neutrino.pr({ repo: args.repo, number: args.number });
      if (pr?.state === 'merged') return { found: true, outsideId: safeId(pr.mergeSha || `${pr.repo}#${pr.number}`) };
      if (pr?.state === 'open') return { found: false };
    }
    if (tool === 'neutrino_pr_update' && context.neutrino?.pr && args.state) {
      const pr = await context.neutrino.pr({ repo: args.repo, number: args.number });
      if (pr?.state === args.state) return { found: true, outsideId: safeId(`${pr.repo}#${pr.number}`) };
      if (pr?.state) return { found: false };
    }
    if (tool === 'neutrino_create_repo' && context.neutrino?.repos && args.name) {
      const list = await context.neutrino.repos({ kind: 'server', query: args.name, limit: 20 });
      const hit = (list?.repos || []).find(r => r.name?.toLowerCase() === String(args.name).toLowerCase() || r.id?.toLowerCase() === String(args.name).toLowerCase());
      return hit ? { found: true, outsideId: safeId(hit.id) } : { found: false };
    }
    if (tool === 'gmail_save_reply_draft' && context.gmail?.findReplyDraft) {
      const hit = await context.gmail.findReplyDraft({ messageId: args.messageId, body: args.body }, signal);
      if (hit === null) return { found: false };
      if (hit?.id) return { found: true, outsideId: safeId(hit.id) };
      return { found: null };
    }
    if (tool === 'calendar_create' && context.calendar?.eventById && entry?.clientId) {
      const hit = await context.calendar.eventById(entry.clientId, signal);
      if (hit === null) return { found: false };
      if (hit?.id) return { found: true, outsideId: safeId(hit.id) };
      return { found: null };
    }
    if (tool && ['drive_create_file', 'drive_create_doc', 'drive_create_sheet', 'drive_create_slides'].includes(tool) && context.drive?.search && args.name) {
      const mimeByTool: Record<string, unknown> = {
        drive_create_file: args.mimeType,
        drive_create_doc: 'application/vnd.google-apps.document',
        drive_create_sheet: 'application/vnd.google-apps.spreadsheet',
        drive_create_slides: 'application/vnd.google-apps.presentation',
      };
      const expectedMime = mimeByTool[tool];
      const found = await context.drive.search({ query: args.name, mimeType: expectedMime, pageSize: 15 }, signal);
      const files = Array.isArray(found?.files) ? found.files : [];
      const hit = files.find(f => squash(f?.name).toLowerCase() === squash(args.name).toLowerCase() && (!expectedMime || f.mimeType === expectedMime));
      return hit ? { found: true, outsideId: safeId(hit.id || hit.webViewLink) } : { found: false };
    }
    if (tool === 'nexus_run' && context.nexus) {
      if (args.name && context.nexus.listJobs) {
        const jobs = await context.nexus.listJobs(signal);
        if (!Array.isArray(jobs)) return { found: null };
        const wanted = squash(args.name).toLowerCase();
        const shortWanted = wanted.slice(0, 32).trim();
        const hit = jobs.find(j => {
          if (['cancelled', 'declined'].includes(String(j?.state || '').toLowerCase())) return false;
          const seen = squash(j?.name).toLowerCase();
          return seen === wanted || (wanted.length > 32 && seen === shortWanted);
        });
        return hit ? { found: true, outsideId: safeId(hit.job) } : { found: false };
      }
      if (args.command && context.nexus.listTickets) {
        const tickets = await context.nexus.listTickets(signal);
        if (Array.isArray(tickets)) {
          const hit = tickets.find(t => sameBody(t?.command, args.command));
          if (hit?.job) return { found: true, outsideId: safeId(hit.job) };
        }
      }
      return { found: null };
    }
    if (tool === 'watch_add' && context.watchers?.list) {
      const draft = watcherFromArgs(args, { folder: context.folder || '' });
      if (!draft) return { found: null };
      const list = await context.watchers.list();
      const hit = (Array.isArray(list) ? list : []).find(w => matchesWatcher(w, draft));
      return hit ? { found: true, outsideId: safeId(hit.id || 'watcher') } : { found: false };
    }
  } catch {
    return { found: null };
  }
  return { found: null };
}

export class OutsideWriteLedger {
  path: string;
  now: () => string;
  records: Map<string, OutsideWriteRecord>;
  loaded: boolean;
  queue: Promise<void>;
  onBeforeSettle: OutsideWriteBeforeSettleHook | null;

  constructor({ path, now = () => new Date().toISOString() }: OutsideWriteLedgerOptions) {
    this.path = path;
    this.now = now;
    this.records = new Map();
    this.loaded = false;
    this.queue = Promise.resolve();
    this.onBeforeSettle = null;
  }

  async load(): Promise<Map<string, OutsideWriteRecord>> {
    if (this.loaded) return this.records;
    this.records.clear();
    let raw = '';
    try { raw = await readFile(this.path, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error; }
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: unknown;
      try { parsed = JSON.parse(trimmed); } catch { continue; }
      if (!parsed || typeof parsed !== 'object') continue;
      const rec = parsed as Partial<OutsideWriteRecord>;
      if (!rec.id || !(OUTSIDE_WRITE_STATES as readonly unknown[]).includes(rec.state)) continue;
      const prev = this.records.get(rec.id) || ({} as OutsideWriteRecord);
      this.records.set(rec.id, { ...prev, ...rec } as OutsideWriteRecord);
    }
    this.loaded = true;
    return this.records;
  }

  append(record: OutsideWriteRecord): Promise<void> {
    const line = `${JSON.stringify(record)}\n`;
    const run = async () => {
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      await appendFile(this.path, line, { encoding: 'utf8', mode: 0o600 });
    };
    this.queue = this.queue.then(run, run);
    return this.queue;
  }

  // At startup (or after a simulated crash), every write left at `intent` becomes `unknown`.
  async recoverOnStart(): Promise<OutsideWriteRecord[]> {
    this.loaded = false;
    await this.load();
    const marked: OutsideWriteRecord[] = [];
    for (const entry of this.records.values()) {
      if (entry.state !== 'intent') continue;
      const next: OutsideWriteRecord = {
        id: entry.id,
        at: this.now(),
        chat: entry.chat,
        turn: entry.turn,
        tool: entry.tool,
        hash: entry.hash,
        ...(entry.clientId ? { clientId: entry.clientId } : {}),
        state: 'unknown',
      };
      this.records.set(entry.id, { ...entry, ...next });
      await this.append(next);
      const saved = this.records.get(entry.id);
      if (saved) marked.push(saved);
    }
    return marked;
  }

  async recordIntent({
    chat = '',
    turn = '',
    tool,
    hash,
    clientId = '',
  }: {
    chat?: string;
    turn?: string;
    tool: string;
    hash: string;
    clientId?: string;
  }): Promise<OutsideWriteRecord> {
    await this.load();
    const entry: OutsideWriteRecord = {
      id: `ow-${randomUUID()}`,
      at: this.now(),
      chat: String(chat || '').slice(0, 120),
      turn: String(turn || '').slice(0, 60),
      tool: String(tool || '').slice(0, 120),
      hash: String(hash || '').slice(0, 128),
      ...(clientId ? { clientId: String(clientId).slice(0, 64) } : {}),
      state: 'intent',
    };
    this.records.set(entry.id, entry);
    await this.append(entry);
    return entry;
  }

  async settle(
    id: string,
    {
      state,
      outsideId = '',
      reason = '',
    }: {
      state: 'done' | 'failed';
      outsideId?: string;
      reason?: string;
    },
  ): Promise<OutsideWriteRecord | null> {
    await this.load();
    if (!['done', 'failed'].includes(state)) throw new Error('Settle an outside write as done or failed.');
    const prev = this.records.get(id);
    if (!prev) return null;
    const next: OutsideWriteRecord = {
      id: prev.id,
      at: this.now(),
      chat: prev.chat,
      turn: prev.turn,
      tool: prev.tool,
      hash: prev.hash,
      ...(prev.clientId ? { clientId: prev.clientId } : {}),
      state,
      ...(state === 'done' && outsideId ? { outsideId: safeId(outsideId) } : {}),
      ...(state === 'failed' && reason ? { reason: squash(reason).slice(0, 80) } : {}),
    };
    this.records.set(id, { ...prev, ...next });
    await this.append(next);
    return this.records.get(id) ?? null;
  }

  async recordDone(id: string, { outsideId = '' }: { outsideId?: string } = {}): Promise<OutsideWriteRecord | null> {
    return this.settle(id, { state: 'done', outsideId });
  }
  async recordFailed(id: string, { reason = '' }: { reason?: string } = {}): Promise<OutsideWriteRecord | null> {
    return this.settle(id, { state: 'failed', reason });
  }

  async unknownForChat(chat = ''): Promise<OutsideWriteRecord[]> {
    await this.load();
    const key = String(chat || '');
    return [...this.records.values()].filter(entry => entry.state === 'unknown' && (!key || entry.chat === key));
  }

  async findUnsettled(chat: string, tool: string, hash: string): Promise<OutsideWriteRecord | null> {
    await this.load();
    const key = String(chat || '');
    const list = [...this.records.values()];
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const entry = list[i];
      if (entry.chat === key && entry.tool === tool && entry.hash === hash && entry.state === 'unknown') {
        return entry;
      }
    }
    return null;
  }

  // Concise prompt note for Carry on (never includes argument content — only tool, time, and short hash).
  async unknownNotice(chat = ''): Promise<string> {
    const items = await this.unknownForChat(chat);
    if (!items.length) return '';
    const lines = items.map(item => `- ${item.tool} (started ${item.at}, hash ${item.hash.slice(0, 10)})`);
    return `Outside writes from an earlier turn in this chat may have already landed before Fairy closed (status: unknown):\n${lines.join('\n')}\nDo not blindly repeat these writes. Check the service first if possible, or ask the user to confirm whether they already landed.`;
  }

  // Settles unknown writes in this chat when the user explicitly answers "send it again" or "leave it".
  async applyUserDecision(chat = '', text = ''): Promise<OutsideWriteRecord[]> {
    const items = await this.unknownForChat(chat);
    if (!items.length || !text) return [];
    const cleaned = String(text).replace(/[’']/g, "'").trim();
    const negatedRetry = /\b(?:don't|do not|never)\b[^.,;—–\-!?\n]{0,16}\b(?:send|post|create|run|try|submit|resend|retry)\b/i.test(cleaned);
    const wantsLeave = negatedRetry || /\b(?:leave it|skip it|don't resend|already (?:sent|posted|created|saved|landed|submitted|there|went through))\b/i.test(cleaned);
    const wantsRetry = !wantsLeave && /\b(?:send it again|resend(?: it)?|post it again|create it again|submit it again|run it again|try(?: it)? again|retry(?: it)?|go ahead and (?:send|post|create|submit|run))\b/i.test(cleaned);
    if (!wantsLeave && !wantsRetry) return [];
    const settled: OutsideWriteRecord[] = [];
    for (const item of items) {
      const updated = wantsRetry
        ? await this.recordFailed(item.id, { reason: 'user-retry' })
        : await this.recordDone(item.id, { outsideId: 'user-confirmed' });
      if (updated) settled.push(updated);
    }
    return settled;
  }

  // Unified guard + intent/done/failed wrapper for any outside write tool.
  async guardAndRun<T = unknown>({
    chat = '',
    turn = '',
    tool,
    args = {},
    context = {},
    signal,
    beforeIntent = null,
    run,
  }: GuardAndRunOptions<T>): Promise<GuardAndRunResult<T>> {
    const hash = hashArguments(tool, args);
    const unsettled = await this.findUnsettled(chat, tool, hash);
    if (unsettled) {
      const lookup = await lookupOutsideWrite({ tool, args, entry: unsettled, context, signal });
      if (lookup.found === true) {
        await this.recordDone(unsettled.id, { outsideId: lookup.outsideId });
        const where = lookup.outsideId ? ` (${lookup.outsideId})` : '';
        return {
          blocked: true,
          outcome: 'refused',
          alreadyLanded: true,
          outsideId: lookup.outsideId || '',
          error: `Already ${actionPhrase(tool)}${where} before Fairy closed. Not repeating it.`,
        };
      }
      if (lookup.found === false) {
        await this.recordFailed(unsettled.id, { reason: 'not-found-on-lookup' });
      } else {
        return {
          blocked: true,
          outcome: 'unknown',
          error: `I may already have ${actionPhrase(tool)}. Check, then tell me to send it again or leave it.`,
        };
      }
    }

    if (typeof beforeIntent === 'function') await beforeIntent();
    const clientId = tool === 'calendar_create' ? clientIdFor(chat, hash) : '';
    const entry = await this.recordIntent({ chat, turn, tool, hash, clientId });
    try {
      const result = await run({ clientId, entry });
      if (typeof this.onBeforeSettle === 'function') {
        const keepAtIntent = await this.onBeforeSettle({ tool, args, entry, result });
        if (keepAtIntent === true) return { blocked: false, result, entry, crashedBeforeRecord: true };
      }
      if (isCancelledResult(tool, result)) {
        await this.recordFailed(entry.id, { reason: 'cancelled' });
      } else if (result && typeof result === 'object' && 'error' in result && (result as { error?: unknown }).error) {
        await this.recordFailed(entry.id, { reason: 'error' });
      } else {
        await this.recordDone(entry.id, { outsideId: outsideIdOf(tool, result) });
      }
      return { blocked: false, result, entry };
    } catch (error) {
      if (typeof this.onBeforeSettle === 'function') {
        const keepAtIntent = await this.onBeforeSettle({ tool, args, entry, error });
        if (keepAtIntent === true) throw error;
      }
      await this.recordFailed(entry.id, { reason: (error as { outcome?: unknown } | null | undefined)?.outcome === 'refused' ? 'refused' : 'failed' });
      throw error;
    }
  }
}
