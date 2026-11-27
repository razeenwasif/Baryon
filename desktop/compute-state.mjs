// Compute panel backend (Doc 7 #16):
// Aggregates Nexus tickets (awaiting Accept), active/finished cluster jobs, and RunStore cluster runs,
// plus live nexus_logs and nexus_outputs inspection. Accepting tickets stays in Nexus.
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;

export function normalizeJobStatus(rawState) {
  const s = String(rawState || '').trim().toLowerCase();
  if (/wait|pend|queue|ticket|accept|ask/.test(s)) return 'waiting';
  if (/run|start|active|exec/.test(s)) return 'running';
  if (/fail|err|cancel|stop|kill|reject|abort/.test(s)) return 'failed';
  if (/done|finish|complet|succeed|ok|exit_0/.test(s)) return 'done';
  return 'running';
}

export async function collectComputeJobs({ nexus = null, runStore = null, now = new Date() } = {}) {
  const [ticketsRes, jobsRes, runsRes] = await Promise.allSettled([
    nexus?.listTickets ? nexus.listTickets() : Promise.resolve(null),
    nexus?.listJobs ? nexus.listJobs() : Promise.resolve(null),
    runStore?.all ? runStore.all() : Promise.resolve([]),
  ]);

  const byJob = new Map();
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

  const itemsByJob = new Map();

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
    itemsByJob.set(j.job, {
      ...(prev || {}),
      job: j.job,
      status: normalizeJobStatus(j.state),
      rawState: String(j.state || ''),
      node: String(j.node || ''),
      name: meta?.runName || j.name || prev?.name || j.job,
      command: meta?.command || prev?.command || '',
      waitingAccept: prev?.waitingAccept && normalizeJobStatus(j.state) === 'waiting',
      ...(meta ? meta : {}),
    });
  }

  // Include tracked RunStore cluster jobs even if offline/aged out of `nexus jobs`.
  for (const [jobId, meta] of byJob) {
    if (itemsByJob.has(jobId)) continue;
    itemsByJob.set(jobId, {
      job: jobId,
      status: normalizeJobStatus(meta.state),
      rawState: meta.state || 'recorded',
      node: 'cluster',
      name: meta.runName || jobId,
      command: meta.command || '',
      waitingAccept: false,
      ...meta,
    });
  }

  const priority = { running: 0, waiting: 1, failed: 2, done: 3 };
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

export async function fetchJobLogs({ nexus, job, seconds = 8, signal } = {}) {
  const cleanJob = String(job || '').trim();
  if (!JOB_ID.test(cleanJob)) throw new Error('Select a valid Nexus job id.');
  if (!nexus?.logs) throw new Error('Nexus isn’t configured on this Mac.');
  return nexus.logs({ job: cleanJob, seconds: Math.min(30, Math.max(2, Number(seconds) || 8)) }, signal);
}

export async function fetchJobOutputs({ nexus, runStore = null, job, fallbackDir, signal } = {}) {
  const cleanJob = String(job || '').trim();
  if (!JOB_ID.test(cleanJob)) throw new Error('Select a valid Nexus job id.');
  if (!nexus?.outputs) throw new Error('Nexus isn’t configured on this Mac.');
  const found = runStore?.findJob ? await runStore.findJob(cleanJob).catch(() => null) : null;
  const root = found?.folder || fallbackDir;
  if (!root) throw new Error('No output directory configured for Nexus job outputs.');
  if (!found?.folder) await mkdir(root, { recursive: true, mode: 0o700 });
  const out = await nexus.outputs({ job: cleanJob, root }, signal);
  let settledRun = null;
  if (found?.run?.state === 'running' && out?.folder && runStore?.settleJob) {
    settledRun = await runStore.settleJob(cleanJob, { outputs: join(root, out.folder), exit: null }).catch(() => null);
  }
  return { ...out, root, settledRun };
}
