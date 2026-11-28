import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  BenchmarkStore,
  benchmarkWatcher,
  detectRegression,
  parseBenchmarkOutput,
  seriesForWatch,
} from '../desktop/benchmark-watch.mjs';
import { RunStore } from '../desktop/runs.mjs';

test('BenchmarkStore persists, validates, updates, and removes watches atomically', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'fairy-bench-store-')));
  const repoDir = join(dir, 'repo');
  await mkdir(repoDir, { recursive: true });
  try {
    const storePath = join(dir, 'benchmark-watches.json');
    const store = new BenchmarkStore({ path: storePath, checkFolder: async f => f });

    await assert.rejects(store.add({ folder: repoDir, command: '', metric: 'latency_ms' }), /command/i);
    await assert.rejects(store.add({ folder: repoDir, command: 'pytest bench.py', metric: '' }), /metric/i);

    const added = await store.add({
      folder: repoDir,
      title: 'Kernel latency',
      command: 'python bench.py',
      metric: 'latency_ms',
      direction: 'lower',
      thresholdPct: 7.5,
      machine: 'atlas',
    });
    assert.ok(added.id.startsWith('bench-'));
    assert.equal(added.direction, 'lower');
    assert.equal(added.thresholdPct, 7.5);
    assert.equal(added.machine, 'atlas');

    const reloaded = new BenchmarkStore({ path: storePath, checkFolder: async f => f });
    const list = await reloaded.list(repoDir);
    assert.equal(list.length, 1);
    assert.equal(list[0].title, 'Kernel latency');

    const updated = await reloaded.update(added.id, { enabled: false, direction: 'higher', thresholdPct: 10 });
    assert.equal(updated.enabled, false);
    assert.equal(updated.direction, 'higher');
    assert.equal(updated.thresholdPct, 10);

    await reloaded.remove(added.id);
    assert.equal((await reloaded.list()).length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('parseBenchmarkOutput handles JSON lines and key=value stdout', () => {
  const out1 = 'warmup done\n{"metrics":{"tokens_per_s":{"value":1420.5,"unit":"tok/s"},"peak_mem_mb":812}}\n';
  const m1 = parseBenchmarkOutput(out1, 'tokens_per_s');
  assert.equal(m1.tokens_per_s.value, 1420.5);
  assert.equal(m1.tokens_per_s.unit, 'tok/s');
  assert.equal(m1.peak_mem_mb.value, 812);

  const out2 = 'step 1\nlatency_ms: 18.4\np99_ms = 24.5\n';
  const m2 = parseBenchmarkOutput(out2, 'latency_ms');
  assert.equal(m2.latency_ms.value, 18.4);
  assert.equal(m2.p99_ms.value, 24.5);
});

test('seriesForWatch and detectRegression catch both latency spikes and throughput drops', () => {
  const baseRuns = [
    { id: 'R1', state: 'done', started: '2026-11-20T01:00:00Z', code: { commit: '1111111111', branch: 'main' }, tags: ['benchmark', 'bench:bench-1'], metrics: { latency_ms: { value: 10 }, tps: { value: 1000 } } },
    { id: 'R2', state: 'done', started: '2026-11-20T02:00:00Z', code: { commit: '2222222222', branch: 'main' }, tags: ['benchmark', 'bench:bench-1'], metrics: { latency_ms: { value: 10.2 }, tps: { value: 990 } } },
    { id: 'R3', state: 'done', started: '2026-11-20T03:00:00Z', code: { commit: '3333333333', branch: 'main' }, tags: ['benchmark', 'bench:bench-1'], metrics: { latency_ms: { value: 9.8 }, tps: { value: 1010 } } },
    { id: 'R4', state: 'done', started: '2026-11-20T04:00:00Z', code: { commit: '4444444444', branch: 'main' }, tags: ['benchmark', 'bench:bench-1'], metrics: { latency_ms: { value: 12.0 }, tps: { value: 840 } } },
    { id: 'R9', state: 'done', started: '2026-11-20T05:00:00Z', code: { commit: '9999999999', branch: 'main' }, tags: ['other'], metrics: { latency_ms: { value: 999 } } },
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const latSeries = seriesForWatch(baseRuns as any, { watchId: 'bench-1', metric: 'latency_ms' });
  assert.equal(latSeries.length, 4);
  const latReg = detectRegression(latSeries, { direction: 'lower', thresholdPct: 5, window: 5, metric: 'latency_ms' });
  assert.equal(latReg.regressed, true);
  assert.equal(latReg.baseline, 10);
  assert.equal(latReg.current, 12);
  assert.equal(latReg.shortCommit, '44444444');
  assert.match(latReg.summary!, /Regression on 44444444/);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tpsSeries = seriesForWatch(baseRuns as any, { watchId: 'bench-1', metric: 'tps' });
  const tpsReg = detectRegression(tpsSeries, { direction: 'higher', thresholdPct: 5, window: 5, metric: 'tps' });
  assert.equal(tpsReg.regressed, true);
  assert.equal(tpsReg.baseline, 1000);
  assert.equal(tpsReg.current, 840);

  // Improvement should never trigger a false regression.
  const okSeries = [...latSeries.slice(0, 3), { ...latSeries[3], value: 8.5 }];
  const okReg = detectRegression(okSeries, { direction: 'lower', thresholdPct: 5, metric: 'latency_ms' });
  assert.equal(okReg.regressed, false);
});

test('benchmarkWatcher submits per-commit on Atlas, settles metrics, skips unchanged commits, and fires onRegression', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'fairy-bench-engine-')));
  const repoDir = join(dir, 'repo');
  const runsDir = join(dir, 'runs');
  const outDir = join(dir, 'outputs');
  await mkdir(repoDir, { recursive: true });
  await mkdir(outDir, { recursive: true });

  try {
    const store = new BenchmarkStore({ path: join(dir, 'watches.json'), checkFolder: async f => f });
    const runStore = new RunStore({ dir: runsDir, git: async () => '' });
    const watch = await store.add({
      folder: repoDir,
      title: 'Attention benchmark',
      command: 'python bench_attn.py',
      metric: 'latency_ms',
      direction: 'lower',
      thresholdPct: 5,
      machine: 'atlas',
    });

    let currentSha = 'aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111';
    const gitHead = async () => ({ commit: currentSha, shortCommit: currentSha.slice(0, 8), branch: 'main', subject: 'commit msg', committedAt: '' });

    const jobStates = new Map<string, { ended: boolean; exitCode: number; log: string }>();
    const submittedCommits: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const alerts: any[] = [];
    const fakeNexus = {
      submit: async ({ name }: { name: string }) => {
        const job = `job-${submittedCommits.length + 1}`;
        submittedCommits.push(name);
        jobStates.set(job, { ended: false, exitCode: 0, log: '' });
        return { job };
      },
      logs: async ({ job }: { job: string }) => jobStates.get(job),
      outputs: async ({ job, root }: { job: string; root: string }) => {
        const sub = job;
        await mkdir(join(root, sub), { recursive: true });
        const val = job === 'job-1' ? 10.0 : 12.5;
        await writeFile(join(root, sub, 'metrics.json'), JSON.stringify({ latency_ms: val }), 'utf8');
        return { job, folder: sub, files: [{ path: 'metrics.json' }] };
      },
    };

    const watcher = benchmarkWatcher({
      store,
      runStore,
      nexusFactory: async () => fakeNexus as any,
      outputDir: outDir,
      gitHead,
      onRegression: payload => alerts.push(payload),
    });

    // Commit 1: submits Atlas job-1.
    const step1 = await watcher.step();
    assert.equal(step1.length, 1);
    assert.equal(step1[0].submitted, true);
    assert.equal(step1[0].job, 'job-1');

    // Same commit again with interval forced to 0: skips duplicate commit!
    await store.update(watch.id, { state: { lastCheckedAt: '2020-01-01T00:00:00Z' } });
    const skipped = await watcher.step();
    assert.equal(skipped[0].skipped, 'same-commit');

    // Finish Atlas job-1 cleanly -> latency 10.0 recorded, no alert (first point).
    jobStates.set('job-1', { ended: true, exitCode: 0, log: 'done' });
    await watcher.settlePending((await store.get(watch.id))!);
    assert.equal(alerts.length, 0);

    // Commit 2 arrives -> submits Atlas job-2.
    currentSha = 'bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222';
    await store.update(watch.id, { state: { lastCheckedAt: '2020-01-01T00:00:00Z' } });
    const step2 = await watcher.step();
    assert.equal(step2[0].submitted, true);
    assert.equal(step2[0].job, 'job-2');

    // Settle job-2 with regressed latency 12.5 (+25% > 5% threshold) -> alerts!
    jobStates.set('job-2', { ended: true, exitCode: 0, log: 'done' });
    await watcher.settlePending((await store.get(watch.id))!);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].regression.regressed, true);
    assert.equal(alerts[0].regression.shortCommit, 'bbbb2222');

    // Polling settlePending again does not duplicate the alert for the same commit.
    await watcher.settlePending((await store.get(watch.id))!);
    assert.equal(alerts.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('benchmarkWatcher errors clearly on Atlas when Nexus missing, and runs local watches', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'fairy-bench-local-')));
  try {
    const store = new BenchmarkStore({ path: join(dir, 'watches.json'), checkFolder: async f => f });
    const runStore = new RunStore({ dir: join(dir, 'runs'), git: async () => '' });
    const gitHead = async () => ({ commit: 'cccc3333cccc3333cccc3333cccc3333cccc3333', shortCommit: 'cccc3333', branch: 'main', subject: 'local', committedAt: '' });

    const atlasWatch = await store.add({ folder: dir, title: 'Atlas only', command: 'echo ok', metric: 'loss', machine: 'atlas' });
    const noNexusWatcher = benchmarkWatcher({ store, runStore, nexusFactory: async () => null, outputDir: dir, gitHead });
    await assert.rejects(noNexusWatcher.pollWatch(atlasWatch, { force: true }), /Nexus\/Atlas/);

    const localWatch = await store.add({ folder: dir, title: 'Local quick', command: 'echo "loss=0.42"', metric: 'loss', machine: 'here' });
    const localWatcher = benchmarkWatcher({
      store,
      runStore,
      outputDir: dir,
      gitHead,
      runLocal: async () => ({ exitCode: 0, output: 'loss=0.42\n' }),
    });
    const out = await localWatcher.pollWatch(localWatch, { force: true });
    assert.equal(out.finished, true);
    assert.equal(out.run!.metrics!.loss.value, 0.42);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('benchmark watch IPC, remote channels, and Runs UI wiring are in place', async () => {
  const [mainSrc, preloadSrc, remoteSrc, runsViewSrc] = await Promise.all([
    readFile(join(process.cwd(), 'build-ts', 'desktop', 'main.cjs'), 'utf8'),
    readFile(join(process.cwd(), 'desktop', 'preload.cts'), 'utf8'),
    readFile(join(process.cwd(), 'desktop', 'remote-channels.mts'), 'utf8'),
    readFile(join(process.cwd(), 'src', 'runs-view.ts'), 'utf8'),
  ]);
  for (const ch of ['benchmark-list', 'benchmark-series', 'benchmark-add', 'benchmark-set', 'benchmark-remove', 'benchmark-run']) {
    assert.match(mainSrc, new RegExp(`handle\\('${ch}'`));
    assert.match(remoteSrc, new RegExp(`'${ch}'`));
  }
  assert.match(preloadSrc, /benchmarkList:/);
  assert.match(preloadSrc, /onBenchmarkChanged:/);
  assert.match(runsViewSrc, /benchmarkSection\(/);
  assert.match(runsViewSrc, /drawBenchChart\(/);
});
