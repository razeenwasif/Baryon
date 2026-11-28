import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  collectComputeJobs,
  fetchJobLogs,
  fetchJobOutputs,
  normalizeJobStatus,
  type ComputeNexusClient,
} from '../desktop/compute-state.mjs';
import { RunStore } from '../desktop/runs.mjs';

test('normalizeJobStatus maps ticket, running, done, and failed states', () => {
  assert.equal(normalizeJobStatus('awaiting accept'), 'waiting');
  assert.equal(normalizeJobStatus('queued'), 'waiting');
  assert.equal(normalizeJobStatus('running'), 'running');
  assert.equal(normalizeJobStatus('completed'), 'done');
  assert.equal(normalizeJobStatus('failed'), 'failed');
});

test('collectComputeJobs handles offline nexus gracefully while still showing RunStore cluster runs', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'fairy-compute-off-')));
  const repoDir = join(dir, 'repo');
  await mkdir(repoDir, { recursive: true });
  try {
    const runStore = new RunStore({ dir: join(dir, 'runs'), git: async () => '' });
    const started = await runStore.start(repoDir, {
      name: 'Train eval',
      command: 'python train.py',
      where: { kind: 'forge', job: 'j-901' },
    });
    await runStore.finish(repoDir, started.id, { state: 'done', exit: 0 });

    const out = await collectComputeJobs({ nexus: null, runStore: runStore as any });
    assert.equal(out.available, false);
    assert.match(out.reason!, /Nexus isn’t set up/);
    assert.equal(out.items.length, 1);
    assert.equal(out.items[0].job, 'j-901');
    assert.equal(out.items[0].status, 'done');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('collectComputeJobs merges tickets, live jobs, and RunStore metadata and sorts active first', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'fairy-compute-')));
  const repoDir = join(dir, 'repo');
  await mkdir(repoDir, { recursive: true });
  try {
    const runStore = new RunStore({ dir: join(dir, 'runs'), git: async () => '' });
    await runStore.start(repoDir, {
      name: 'Atlas sweep',
      command: 'python sweep.py',
      where: { kind: 'atlas', job: 'job-run-1' },
    });

    const nexus: ComputeNexusClient = {
      listTickets: async () => [
        { job: 'job-wait-1', requester: 'Fairy', command: 'python big_job.py' },
      ],
      listJobs: async () => [
        { job: 'job-done-1', state: 'finished', node: 'forge', name: 'old job' },
        { job: 'job-run-1', state: 'running', node: 'atlas', name: 'sweep' },
      ],
    };

    const res = await collectComputeJobs({ nexus, runStore: runStore as any });
    assert.equal(res.available, true);
    assert.match(res.note!, /Accept stays in Nexus/);
    assert.deepEqual(res.counts, { waiting: 1, running: 1, done: 1, failed: 0, total: 3 });
    assert.equal(res.items[0].job, 'job-run-1');
    assert.equal(res.items[0].runId, 'R1');
    assert.equal(res.items[1].job, 'job-wait-1');
    assert.equal(res.items[1].status, 'waiting');
    assert.equal(res.items[2].job, 'job-done-1');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('fetchJobLogs validates id and fetchJobOutputs downloads and settles running RunStore jobs', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'fairy-compute-out-')));
  const repoDir = join(dir, 'repo');
  await mkdir(repoDir, { recursive: true });
  try {
    const runStore = new RunStore({ dir: join(dir, 'runs'), git: async () => '' });
    const r = await runStore.start(repoDir, {
      name: 'Eval job',
      command: 'python eval.py',
      where: { kind: 'atlas', job: 'job-settle-1' },
    });

    const nexus: ComputeNexusClient = {
      logs: async ({ job }) => ({ job, ended: true, exitCode: 0, log: 'accuracy=0.95\n' }),
      outputs: async ({ job, root }) => {
        const sub = join('nexus-outputs', job);
        await mkdir(join(root, sub), { recursive: true });
        await writeFile(join(root, sub, 'metrics.json'), JSON.stringify({ accuracy: 0.95 }), 'utf8');
        return { job, folder: sub, files: [{ path: `${sub}/metrics.json`, bytes: 17 }] };
      },
    };

    await assert.rejects(fetchJobLogs({ nexus, job: 'bad/id' }), /valid Nexus job id/i);
    const logs = await fetchJobLogs({ nexus, job: 'job-settle-1', seconds: 6 }) as any;
    assert.equal(logs.ended, true);
    assert.match(logs.log, /accuracy=0\.95/);

    const out = await fetchJobOutputs({ nexus, runStore: runStore as any, job: 'job-settle-1', fallbackDir: join(dir, 'fallback') });
    const settledRun = out.settledRun as any;
    assert.equal(settledRun?.id, r.id);
    assert.equal(settledRun?.state, 'done');
    assert.equal(settledRun?.metrics?.accuracy?.value, 0.95);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('compute panel IPC, remote channels, and UI pane wiring exist', async () => {
  const [mainSrc, preloadSrc, remoteSrc, appSrc, cssSrc] = await Promise.all([
    readFile(join(process.cwd(), 'build-ts', 'desktop', 'main.cjs'), 'utf8'),
    readFile(join(process.cwd(), 'desktop', 'preload.cts'), 'utf8'),
    readFile(join(process.cwd(), 'desktop', 'remote-channels.mts'), 'utf8'),
    readFile(join(process.cwd(), 'src', 'app.ts'), 'utf8'),
    readFile(join(process.cwd(), 'src', 'panels.css'), 'utf8'),
  ]);
  for (const ch of ['compute-state', 'compute-logs', 'compute-outputs']) {
    assert.match(mainSrc, new RegExp(`handle\\('${ch}'`));
    assert.match(remoteSrc, new RegExp(`'${ch}'`));
  }
  assert.match(preloadSrc, /computeState:/);
  assert.match(preloadSrc, /computeLogs:/);
  assert.match(preloadSrc, /computeOutputs:/);
  assert.match(appSrc, /computePane/);
  assert.match(appSrc, /compute:\s*'Compute'/);
  assert.match(cssSrc, /data-pane="compute"/);
});
