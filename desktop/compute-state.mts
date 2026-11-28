// Compute panel backend (Doc 7 #16):
// Aggregates Nexus tickets (awaiting Accept), active/finished cluster jobs, and RunStore cluster runs,
// plus live nexus_logs and nexus_outputs inspection. Accepting tickets stays in Nexus.
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;

export type ComputeJobStatus = 'waiting' | 'running' | 'failed' | 'done';

export interface NexusTicket {
  job?: string;
  command?: string;
  requester?: string;
  [key: string]: unknown;
}

export interface NexusJob {
  job?: string;
  state?: unknown;
  node?: unknown;
  name?: string;
  [key: string]: unknown;
}

export interface NexusOutputsResult {
  folder?: string;
  [key: string]: unknown;
}

export interface ComputeNexusClient {
  listTickets?: () => Promise<NexusTicket[] | null | undefined>;
  listJobs?: () => Promise<NexusJob[] | null | undefined>;
  logs?: (options: { job: string; seconds: number }, signal?: AbortSignal) => Promise<unknown>;
  outputs?: (options: { job: string; root: string }, signal?: AbortSignal) => Promise<NexusOutputsResult | null | undefined>;
}

export interface ComputeRunRecord {
  id: string;
  name?: string;
  command?: string;
  state?: string;
  started?: string;
  ended?: string;
  seconds?: number | null;
  metrics?: Record<string, unknown>;
  files?: unknown[];
  tags?: string[];
  where?: {
    job?: string;
    [key: string]: unknown;
  };
}

export interface ComputeRunProject {
  folder?: string;
  runs?: ComputeRunRecord[];
}

export interface ComputeRunStore {
  all?: () => Promise<ComputeRunProject[]>;
  findJob?: (jobId: string) => Promise<{ folder?: string; run?: ComputeRunRecord | null } | null>;
  settleJob?: (jobId: string, result: { outputs: string; exit: number | null }) => Promise<unknown>;
}

interface RunJobMeta {
  runId: string;
  folder: string;
  projectTitle: string;
  runName: string;
  command: string;
  state: string;
  started: string;
  ended: string;
  seconds: number | null;
  metrics: Record<string, unknown>;
  filesCount: number;
  tags: string[];
}

export interface ComputeJobItem {
  job: string;
  status: ComputeJobStatus;
  rawState: string;
  node: string;
  name: string;
  command: string;
  requester?: string;
  waitingAccept: boolean;
  runId?: string;
  folder?: string;
  projectTitle?: string;
  runName?: string;
  state?: string;
  started?: string;
  ended?: string;
  seconds?: number | null;
  metrics?: Record<string, unknown>;
  filesCount?: number;
  tags?: string[];
}

export interface ComputeStateResult {
  available: boolean;
  reason: string;
  note: string;
  at: string;
  counts: {
    waiting: number;
    running: number;
    done: number;
    failed: number;
    total: number;
  };
  items: ComputeJobItem[];
}

export interface CollectComputeJobsOptions {
  nexus?: ComputeNexusClient | null;
  runStore?: ComputeRunStore | null;
  now?: Date;
}

export interface FetchJobLogsOptions {
  nexus?: ComputeNexusClient | null;
  job?: unknown;
  seconds?: number;
  signal?: AbortSignal;
}

export interface FetchJobOutputsOptions {
  nexus?: ComputeNexusClient | null;
  runStore?: ComputeRunStore | null;
  job?: unknown;
  fallbackDir?: string;
  signal?: AbortSignal;
}

export function normalizeJobStatus(rawState: unknown): ComputeJobStatus {
  const s = String(rawState || '').trim().toLowerCase();
  if (/wait|pend|queue|ticket|accept|ask/.test(s)) return 'waiting';
  if (/run|start|active|exec/.test(s)) return 'running';
  if (/fail|err|cancel|stop|kill|reject|abort/.test(s)) return 'failed';
  if (/done|finish|complet|succeed|ok|exit_0/.test(s)) return 'done';
  return 'running';
}

export async function collectComputeJobs({
  nexus = null,
  runStore = null,
  now = new Date(),
}: CollectComputeJobsOptions = {}): Promise<ComputeStateResult> {
  const [ticketsRes, jobsRes, runsRes] = await Promise.allSettled([
    nexus?.listTickets ? nexus.listTickets() : Promise.resolve(null),
    nexus?.listJobs ? nexus.listJobs() : Promise.resolve(null),
    runStore?.all ? runStore.all() : Promise.resolve([]),
  ]);

  const byJob = new Map<string, RunJobMeta>();
  const projects = runsRes.status === 'fulfilled' && Array.isArray(runsRes.value) ? runsRes.value : [];
  for (const proj of projects) {
    const folder = String(proj?.folder || '');
    const projectTitle = folder.split('/').filter(Boolean).at(-1) || folder;
    for (const run of Array.isArray(proj?.runs) ? proj.runs : []) {
      const jobId = run?.where?.job;
      if (!jobId) continue;
      byJob.set(jobId, {
        runId: run.id,
        folder,
        projectTitle,
        runName: run.name || '',
        command: run.command || '',
        state: run.state || '',
        started: run.started || '',
        ended: run.ended || '',
        seconds: run.seconds ?? null,
        metrics: run.metrics || {},
        filesCount: Array.isArray(run.files) ? run.files.length : 0,
        tags: Array.isArray(run.tags) ? run.tags : [],
      });
    }
  }

  const itemsByJob = new Map<string, ComputeJobItem>();

  const tickets = ticketsRes.status === 'fulfilled' && Array.isArray(ticketsRes.value) ? ticketsRes.value : [];
  for (const t of tickets) {
    if (!t?.job) continue;
    const meta = byJob.get(t.job) || null;
    itemsByJob.set(t.job, {
      job: t.job,
      status: 'waiting',
      rawState: 'awaiting accept',
      node: 'queued',
      name: meta?.runName || t.command || t.job,
      command: t.command || meta?.command || '',
      requester: t.requester || 'Fairy',
      waitingAccept: true,
      ...(meta ? meta : {}),
    });
  }

  const jobs = jobsRes.status === 'fulfilled' && Array.isArray(jobsRes.value) ? jobsRes.value : [];
  for (const j of jobs) {
    if (!j?.job) continue;
    const meta = byJob.get(j.job) || null;
    const prev = itemsByJob.get(j.job);
    const base: ComputeJobItem = {
      ...(prev || {}),
      job: j.job,
      status: normalizeJobStatus(j.state),
      rawState: String(j.state || ''),
      node: String(j.node || ''),
      name: meta?.runName || j.name || prev?.name || j.job,
      command: meta?.command || prev?.command || '',
      waitingAccept: Boolean(prev?.waitingAccept && normalizeJobStatus(j.state) === 'waiting'),
    };
    itemsByJob.set(j.job, meta ? { ...base, ...meta } : base);
  }

  // Include tracked RunStore cluster jobs even if offline/aged out of `nexus jobs`.
  for (const [jobId, meta] of byJob) {
    if (itemsByJob.has(jobId)) continue;
    const base: ComputeJobItem = {
      job: jobId,
      status: normalizeJobStatus(meta.state),
      rawState: meta.state || 'recorded',
      node: 'cluster',
      name: meta.runName || jobId,
      command: meta.command || '',
      waitingAccept: false,
    };
    itemsByJob.set(jobId, { ...base, ...meta });
  }

  const priority: Record<ComputeJobStatus, number> = { running: 0, waiting: 1, failed: 2, done: 3 };
  const items = [...itemsByJob.values()]
    .sort((a, b) => {
      const pa = priority[a.status] ?? 9;
      const pb = priority[b.status] ?? 9;
      if (pa !== pb) return pa - pb;
      return String(b.ended || b.started || b.job).localeCompare(String(a.ended || a.started || a.job));
    })
    .slice(0, 60);

  const counts = { waiting: 0, running: 0, done: 0, failed: 0, total: items.length };
  for (const item of items) {
    if (counts[item.status] !== undefined) counts[item.status] += 1;
  }

  return {
    available: Boolean(nexus),
    reason: nexus ? '' : 'Nexus isn’t set up on this Mac (needs the nexus CLI and ~/.duet/request-token).',
    note: 'Accept stays in Nexus — Fairy inspects queued tickets, running jobs, live logs, and outputs read-only.',
    at: now.toISOString(),
    counts,
    items,
  };
}

export async function fetchJobLogs({ nexus, job, seconds = 8, signal }: FetchJobLogsOptions = {}): Promise<unknown> {
  const cleanJob = String(job || '').trim();
  if (!JOB_ID.test(cleanJob)) throw new Error('Select a valid Nexus job id.');
  if (!nexus?.logs) throw new Error('Nexus isn’t configured on this Mac.');
  return nexus.logs({ job: cleanJob, seconds: Math.min(30, Math.max(2, Number(seconds) || 8)) }, signal);
}

export async function fetchJobOutputs({
  nexus,
  runStore = null,
  job,
  fallbackDir,
  signal,
}: FetchJobOutputsOptions = {}): Promise<Record<string, unknown> & { root: string; settledRun: unknown }> {
  const cleanJob = String(job || '').trim();
  if (!JOB_ID.test(cleanJob)) throw new Error('Select a valid Nexus job id.');
  if (!nexus?.outputs) throw new Error('Nexus isn’t configured on this Mac.');
  const found = runStore?.findJob ? await runStore.findJob(cleanJob).catch(() => null) : null;
  const root = found?.folder || fallbackDir;
  if (!root) throw new Error('No output directory configured for Nexus job outputs.');
  if (!found?.folder) await mkdir(root, { recursive: true, mode: 0o700 });
  const out = await nexus.outputs({ job: cleanJob, root }, signal);
  let settledRun: unknown = null;
  if (found?.run?.state === 'running' && out?.folder && runStore?.settleJob) {
    settledRun = await runStore.settleJob(cleanJob, { outputs: join(root, out.folder), exit: null }).catch(() => null);
  }
  return { ...out, root, settledRun };
}
