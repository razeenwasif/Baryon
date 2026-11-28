import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { SHARED_WORKSPACE_RESTORE_MESSAGE, isCheckpointRestoreIsolated, pathsOverlap } from '../desktop/checkpoint-safety.mjs';
import { createGitCheckpointStore, createUntrackedBlobCache } from '../desktop/git-checkpoints.mjs';
import { parseGitIndex, restatGitIndex, restatWorktreeIndex } from '../desktop/git-index-stat.mjs';
import { IDLE_COMPACTION_MIN_TOKENS, IdleCompactionService, idleCompactionWindow } from '../desktop/idle-compaction.mjs';
import { normalizeFanoutSeats, runModelFanout } from '../desktop/model-fanout.mjs';
import { createNotificationGate } from '../desktop/notification-gate.mjs';
import { createOnePasswordDriver, createSecretResolver, isOnePasswordRef, parseSecretRef, redactSecrets } from '../desktop/secret-providers.mjs';
import { SecretRequestManager } from '../desktop/secret-requests.mjs';
import { assertCheckoutIdle, busySessionsInCheckout } from '../desktop/shared-checkout-guard.mjs';
import { MAX_OVERDUE_ARM_MS, UsageLimitRecoveryWorker, limitRecoveryAction, parseUsageLimitReset } from '../desktop/usage-limit-recovery.mjs';
import { withCheckpointRestoreReservation, withTurnStartReservation, withWorkspaceLease } from '../desktop/workspace-lease.mjs';
import { WorkTools } from '../desktop/work-tools.mjs';
import { collectOrphanedWorktrees } from '../desktop/worktree-cache.mjs';
import { detectComposerTrigger, isCurrencyAmountQuery, isPathWord, replaceComposerTrigger, serializeComposerFileLink } from '../src/composer-triggers.js';
import { createDiffAnnotationStore, formatReviewCommentsPrompt } from '../src/diff-annotations.js';
import { buildWalkthroughPrompt, parseWalkthroughTour } from '../src/diff-walkthrough.js';
import { acquireDiffWorkerPool, diffWorkerPoolStats, highlightDiffAsync, releaseDiffWorkerPool } from '../src/diff-worker-pool.js';
import { createProactivePanelGuard } from '../src/proactive-panel-guard.js';
import { formatSnoozeRemaining, isSessionSnoozed, snoozePresets, sortInboxByReturn } from '../src/thread-inbox.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf8' });
  return stdout;
}

async function initTempRepo(prefix = 'fairy-wave2-'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  await git(dir, ['init']);
  await git(dir, ['config', 'user.email', 'test@fairy.local']);
  await git(dir, ['config', 'user.name', 'Fairy Test']);
  await writeFile(join(dir, 'app.txt'), 'v1\n', 'utf8');
  await git(dir, ['add', 'app.txt']);
  await git(dir, ['commit', '-m', 'init']);
  return dir;
}

test('Wave 2.1: git checkpoints capture clean fast-path, cache untracked blobs, diff, fork, and restore safely', async () => {
  const repo = await initTempRepo('fairy-ckpt-test-');
  try {
    const store = createGitCheckpointStore({
      blobCache: createUntrackedBlobCache({ settledMs: 0, minTotalBytes: 0 }),
    });

    // Clean HEAD uses fast-path without creating a new index.
    const clean = await store.captureCheckpoint({ cwd: repo, sessionId: 's1', turnId: 't0' });
    assert.equal(clean!.fastPath, true);

    // Turn 1 adds an untracked file.
    await writeFile(join(repo, 'notes.txt'), 'draft-one\n', 'utf8');
    const c1 = await store.captureCheckpoint({ cwd: repo, sessionId: 's1', turnId: 't1', previousRef: clean!.ref, forceCache: true });
    assert.equal(c1!.fastPath, false);
    assert.equal(store.blobCache.snapshotCount(), 1);

    // Turn 2 modifies app.txt while notes.txt is unchanged -> reuses cached blob OID for notes.txt.
    await writeFile(join(repo, 'app.txt'), 'v2\n', 'utf8');
    await writeFile(join(repo, 'ephemeral.txt'), 'remove-me-on-restore\n', 'utf8');
    const c2 = await store.captureCheckpoint({ cwd: repo, sessionId: 's1', turnId: 't2', previousRef: c1!.ref, forceCache: true });
    assert.equal(c2!.reusedBlobs >= 1, true);

    const listed = await store.listCheckpoints({ cwd: repo, sessionId: 's1' });
    assert.equal(listed.length, 3);

    const diff = await store.diffCheckpoints({ cwd: repo, fromRef: c1!.ref, toRef: c2!.ref });
    assert.match(diff, /\+v2/);

    const forked = await store.forkFromCheckpoint({ cwd: repo, ref: c1!.ref, newBranch: 'fork-from-t1' });
    assert.equal(forked.branch, 'fork-from-t1');

    // Secret .env must survive restore even though it was never committed.
    await writeFile(join(repo, '.env'), 'API_KEY=keep-me\n', 'utf8');
    const restored = await store.restoreCheckpoint({ cwd: repo, ref: c1!.ref });
    assert.equal(restored.restored, true);
    assert.equal(await readFile(join(repo, 'app.txt'), 'utf8'), 'v1\n');
    assert.equal(await readFile(join(repo, '.env'), 'utf8'), 'API_KEY=keep-me\n');
    await assert.rejects(() => readFile(join(repo, 'ephemeral.txt'), 'utf8'));
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('Wave 2.1: checkpoint restore isolation blocks shared workspace and allows dedicated worktree', () => {
  assert.equal(pathsOverlap('/tmp/repo', '/tmp/repo/packages/a'), true);
  assert.equal(pathsOverlap('/tmp/repo-a', '/tmp/repo-b'), false);

  const shared = isCheckpointRestoreIsolated({
    session: { id: 'a', work: { folder: '/tmp/repo', root: '/tmp/repo', isolate: false } },
    sessions: [
      { id: 'a', work: { folder: '/tmp/repo', root: '/tmp/repo' } },
      { id: 'b', work: { folder: '/tmp/repo', root: '/tmp/repo' }, turns: 2 },
    ],
    cwd: '/tmp/repo',
  });
  assert.equal(shared.isolated, false);
  assert.equal(shared.reason, SHARED_WORKSPACE_RESTORE_MESSAGE);
  assert.equal(shared.sharedWith.length, 1);

  const isolated = isCheckpointRestoreIsolated({
    session: { id: 'a', work: { folder: '/tmp/repo', root: '/tmp/wt-a', worktree: '/tmp/wt-a', isolate: true } },
    sessions: [
      { id: 'a', work: { folder: '/tmp/repo', root: '/tmp/wt-a', worktree: '/tmp/wt-a', isolate: true } },
      { id: 'b', work: { folder: '/tmp/repo', root: '/tmp/repo' } },
    ],
    cwd: '/tmp/wt-a',
  });
  assert.equal(isolated.isolated, true);
});

test('Wave 2.2: secret refs, batched 1Password op inject, single-flight resolver & output redaction', async () => {
  assert.equal(isOnePasswordRef('op://Vault/Item/token'), true);
  assert.equal(isOnePasswordRef('not-op://foo'), false);
  assert.deepEqual(parseSecretRef('secret-ref:onepassword/op://Vault/API/key'), { provider: 'onepassword', reference: 'op://Vault/API/key' });
  assert.equal(parseSecretRef('secret-ref:bad/with\nnewline'), null);

  let opCalls = 0;
  const driver = createOnePasswordDriver({
    exec: async (_bin, args) => {
      opCalls++;
      assert.equal(args[0], '--cache=false');
      assert.equal(args[1], 'inject');
      const tpl = await readFile(args[3], 'utf8');
      return { code: 0, stdout: tpl.replace('{{ op://V/A/k1 }}', 'secret-alpha-1').replace('{{ op://V/B/k2 }}', 'secret-beta-2'), stderr: '' };
    },
  });
  const resolver = createSecretResolver({ drivers: [driver] });
  const vals = await resolver.read([
    parseSecretRef('secret-ref:onepassword/op://V/A/k1')!,
    parseSecretRef('secret-ref:onepassword/op://V/B/k2')!,
  ]);
  assert.deepEqual(vals, ['secret-alpha-1', 'secret-beta-2']);
  assert.equal(opCalls, 1);
  // Cached second read hits memory without re-invoking op CLI.
  const cached = await resolver.read([parseSecretRef('secret-ref:onepassword/op://V/A/k1')!]);
  assert.deepEqual(cached, ['secret-alpha-1']);
  assert.equal(opCalls, 1);

  const mgr = new SecretRequestManager({ resolver, ttlMs: 60_000 });
  const req = mgr.request({ session: 's1', envVar: 'DEPLOY_TOKEN', reason: 'Deploy staging', suggestedRef: 'op://V/A/k1' });
  assert.equal(req.refHandle, 'secret-ref:session/DEPLOY_TOKEN');
  assert.throws(() => mgr.request({ session: 's1', envVar: 'PATH', reason: 'bad' }));

  const approved = await mgr.resolve(req.id, { action: 'approve', literalValue: 'top-secret-xyz-123' });
  assert.equal(approved.status, 'approved');
  const { env, secretValues } = mgr.envForCommand('s1', ['DEPLOY_TOKEN']);
  assert.equal(env.DEPLOY_TOKEN, 'top-secret-xyz-123');
  const b64 = Buffer.from('top-secret-xyz-123', 'utf8').toString('base64');
  const scrubbed = redactSecrets(`raw=top-secret-xyz-123 b64=${b64}`, secretValues);
  assert.equal(scrubbed.includes('top-secret-xyz-123'), false);
  assert.equal(scrubbed.includes(b64), false);

  // Also test WorkTools 'request_secret' & run_command secret_env injection/redaction.
  const wtRoot = await mkdtemp(join(tmpdir(), 'fairy-wt-sec-'));
  try {
    let seenEnv: Record<string, string | undefined> | undefined | null = null;
    let seenRedact: readonly unknown[] | undefined | null = null;
    const tools = new WorkTools({
      root: wtRoot,
      owner: 's1',
      permission: 'auto',
      sandboxed: true,
      secrets: mgr,
      runCommand: (async ({ extraEnv, redactValues }: { extraEnv?: Record<string, string | undefined>; redactValues?: readonly unknown[] }) => {
        seenEnv = extraEnv;
        seenRedact = redactValues;
        return { exitCode: 0, output: 'deployed cleanly' };
      }) as any,
    });
    const reqToolRes = await tools.handle({ tool: 'request_secret', arguments: { env_var: 'CI_TOKEN', reason: 'Deploy check' } });
    assert.equal(reqToolRes.success, true);
    assert.match((reqToolRes.contentItems[0] as { text: string }).text, /secret-ref:session\/CI_TOKEN/);
    const cmdRes = await tools.handle({ tool: 'run_command', arguments: { command: 'echo $DEPLOY_TOKEN', reason: 'Run deploy check', secret_env: ['DEPLOY_TOKEN'] } });
    assert.equal(cmdRes.success, true);
    assert.equal((seenEnv as Record<string, string | undefined> | null)?.DEPLOY_TOKEN, 'top-secret-xyz-123');
    assert.equal((seenRedact as readonly unknown[] | null)?.includes('top-secret-xyz-123'), true);
  } finally {
    await rm(wtRoot, { recursive: true, force: true });
  }

  assert.equal(mgr.revoke('s1', 'DEPLOY_TOKEN'), 1);
  assert.deepEqual(mgr.envForCommand('s1').env, {});
});

test('Wave 2.3: idle prompt-cache compaction window & usage-limit auto-recovery worker', async () => {
  const nowMs = new Date(2026, 10, 24, 10, 0, 0).getTime();
  const expiresAt = nowMs + 60_000;

  assert.equal(idleCompactionWindow({
    session: { id: 's1', snoozedUntil: '2026-11-24T12:00:00Z' },
    history: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }],
    usage: { usedTokens: IDLE_COMPACTION_MIN_TOKENS + 10, promptCacheExpiresAt: expiresAt },
    nowMs,
  }), null);

  const win = idleCompactionWindow({
    session: { id: 's1' },
    history: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }],
    usage: { usedTokens: IDLE_COMPACTION_MIN_TOKENS + 10, promptCacheExpiresAt: expiresAt },
    nowMs,
  });
  assert.ok(win && nowMs >= win.startMs && nowMs < win.endMs);

  let compacted = 0;
  const service = new IdleCompactionService({
    getSessions: () => [{ id: 's1', work: '/tmp/proj' }],
    getHistory: async () => [{ role: 'user', content: 'work' }, { role: 'assistant', content: 'done' }],
    compact: async () => { compacted++; },
    now: () => nowMs,
  });
  service.recordUsage('s1', { usedTokens: IDLE_COMPACTION_MIN_TOKENS + 500, promptCacheExpiresAt: new Date(expiresAt).toISOString() });
  const fired = await service.sweep();
  assert.deepEqual(fired, ['s1']);
  assert.equal(compacted, 1);
  // Deduplicates same expiry window.
  assert.deepEqual(await service.sweep(), []);

  const parsedRel = parseUsageLimitReset('Usage limit reached, try again in 30 minutes', nowMs);
  assert.equal(parsedRel, new Date(nowMs + 30 * 60_000).toISOString());
  const parsedClock = parseUsageLimitReset('Session limit resets Nov 24 at 5:39pm', nowMs);
  assert.ok(Date.parse(parsedClock!) > nowMs);

  let tick = nowMs;
  const snoozed: Array<{ id: string; until: string }> = [];
  const resumed: any[] = [];
  const worker = new UsageLimitRecoveryWorker({
    getSettings: () => ({ autoResumeLimitedThreads: 'on', snoozeLimitedThreads: 'on' }),
    onSnooze: async (id, until) => { snoozed.push({ id, until }); },
    onResume: async action => { resumed.push(action); },
    now: () => tick,
  });
  await worker.recordLimitFailure({
    sessionId: 's-limit',
    runId: 'run-1',
    errorText: 'Rate limited, retry in 10 minutes',
  });
  assert.equal(snoozed.length, 1);
  assert.equal(resumed.length, 0);

  // Too overdue (> MAX_OVERDUE_ARM_MS) is skipped by limitRecoveryAction.
  assert.equal(limitRecoveryAction({
    status: 'failed',
    lastErrorClass: 'usage_limit',
    sessionId: 's2',
    runId: 'r2',
    failedAt: new Date(nowMs - MAX_OVERDUE_ARM_MS - 120_000).toISOString(),
    resetAt: new Date(nowMs - MAX_OVERDUE_ARM_MS - 60_000).toISOString(),
  }, { autoResume: true, nowMs }), null);

  // Advance past reset + clear snooze -> auto-resumes once.
  tick = nowMs + 11 * 60_000;
  await worker.sweep();
  assert.equal(resumed.length, 1);
  assert.equal(resumed[0].deliveryId.startsWith('limit-resume:s-limit:run-1:'), true);
  assert.deepEqual(await worker.sweep(), []);
});

test('Wave 2.4: binary git index restat, workspace leases/reservations, shared checkout guard & worktree GC', async () => {
  const repo = await initTempRepo('fairy-index-');
  const gcBase = await mkdtemp(join(tmpdir(), 'fairy-gc-'));
  try {
    const raw = await readFile(join(repo, '.git', 'index'));
    const parsed = parseGitIndex(raw);
    assert.ok(parsed && parsed.entries.length === 1 && parsed.entries[0].path === 'app.txt');
    // Corrupted checksum fails verification cleanly.
    const corrupt = new Uint8Array(raw);
    corrupt[corrupt.length - 1] ^= 0xff;
    assert.equal(parseGitIndex(corrupt), null);

    // Touch mtime on tracked file -> binary restat refreshes index without spawning git.
    await utimes(join(repo, 'app.txt'), new Date(Date.now() - 5000), new Date(Date.now() - 5000));
    const ok = await restatWorktreeIndex(repo, join(repo, '.git', 'index'));
    assert.equal(ok, true);
    const updatedStatus = await git(repo, ['status', '--porcelain=v1']);
    assert.equal(updatedStatus.trim(), '');

    // Verify duplicate dev/ino protection rejects synthetic collision.
    const fakeStat = { ctimeSeconds: 1, ctimeNanoseconds: 0, mtimeSeconds: 1, mtimeNanoseconds: 0, dev: 1, ino: 42, uid: 1, gid: 1, size: 3, kind: 'file' as const };
    assert.ok(restatGitIndex(parsed, [fakeStat]) instanceof Uint8Array);
    assert.equal(restatGitIndex({ ...parsed, entries: [parsed.entries[0], parsed.entries[0]] }, [fakeStat, fakeStat]), null);

    // Reservation conflict: turn-start waits for active checkpoint restore on overlapping path.
    const events: string[] = [];
    let releaseRestore!: () => void;
    const restoreTask = withCheckpointRestoreReservation(repo, async () => {
      events.push('restore-start');
      await new Promise<void>(r => { releaseRestore = r; });
      events.push('restore-end');
    });
    const turnTask = withTurnStartReservation(join(repo, 'sub'), async () => {
      events.push('turn-start');
    });
    await new Promise(r => setTimeout(r, 15));
    assert.deepEqual(events, ['restore-start']);
    releaseRestore();
    await Promise.all([restoreTask, turnTask]);
    assert.deepEqual(events, ['restore-start', 'restore-end', 'turn-start']);

    // Workspace lease serializes mutations.
    const order: string[] = [];
    await Promise.all([
      withWorkspaceLease(repo, async () => { order.push('1a'); await new Promise(r => setTimeout(r, 10)); order.push('1b'); }),
      withWorkspaceLease(repo, async () => { order.push('2'); }),
    ]);
    assert.deepEqual(order, ['1a', '1b', '2']);

    // Shared checkout guard blocks checkout switch while peer session runs in same checkout.
    const sessions = [{ id: 's-busy', title: 'Worker', work: { folder: repo, root: repo } }];
    assert.equal(busySessionsInCheckout({ checkoutPaths: [repo], sessions, running: { 's-busy': 'working' } }).length, 1);
    await assert.rejects(() => assertCheckoutIdle({ operation: 'branch switch', cwd: repo, sessions, running: { 's-busy': 'working' } }), /Worker/);

    // Worktree GC removes stale orphans, keeps dot-dirs, live worktrees & fresh dirs.
    const staleDir = join(gcBase, 'stale-wt');
    const liveDir = join(gcBase, 'live-wt');
    const dotDir = join(gcBase, '.cow-cache');
    await mkdir(staleDir);
    await mkdir(liveDir);
    await mkdir(dotDir);
    const oldDate = new Date(Date.now() - 3600_000);
    await utimes(staleDir, oldDate, oldDate);
    await utimes(liveDir, oldDate, oldDate);
    const gcRes = await collectOrphanedWorktrees({ base: gcBase, activeWorktrees: [liveDir], graceMs: 15 * 60_000 });
    assert.deepEqual(gcRes.removed, [staleDir]);
    assert.deepEqual(gcRes.kept, [liveDir]);
    assert.equal(gcRes.skipped.includes('.cow-cache'), true);
    await assert.rejects(() => stat(staleDir));
  } finally {
    await rm(repo, { recursive: true, force: true });
    await rm(gcBase, { recursive: true, force: true });
  }
});

test('Wave 2.5: diff annotations, walkthrough parser & ref-counted diff worker pool fallback', async () => {
  const store = createDiffAnnotationStore();
  const c1 = store.add('s1', { path: 'src/app.js', line: 42, snippet: '+const x = 1;', comment: 'Rename x' });
  assert.ok(c1 && store.list('s1').length === 1);
  const combined = formatReviewCommentsPrompt(store.take('s1'), 'Fix lint');
  assert.match(combined, /Review comment 1 \(src\/app\.js:42\): Rename x/);
  assert.match(combined, /Fix lint$/);
  assert.equal(store.list('s1').length, 0);

  const prompt = buildWalkthroughPrompt({ what: 'diff', diff: '+const ok = true;', files: ['src/a.js'] });
  assert.match(prompt, /Change|walkthrough/i);
  const parsed = parseWalkthroughTour('```json\n{"title":"Auth cleanup","stops":[{"path":"src/auth.js","line":12,"title":"Validate token","explanation":"Rejects expired tokens.","risk":"HIGH"}]}\n```');
  assert.equal(parsed.title, 'Auth cleanup');
  assert.equal(parsed.stops[0].risk, 'high');
  assert.equal(parseWalkthroughTour('not json').stops.length, 0);

  // Worker pool falls back cleanly to main-thread highlightCode in Node when Worker is unavailable.
  const h1 = acquireDiffWorkerPool();
  assert.equal(diffWorkerPoolStats().consumers, 1);
  const highlighted = await h1.highlightBatch([{ code: 'const answer = 42;', lang: 'javascript' }]);
  assert.equal(highlighted.length, 1);
  assert.match(highlighted[0], /42/);
  releaseDiffWorkerPool({ immediate: true });
  assert.equal(diffWorkerPoolStats().active, false);

  const direct = await highlightDiffAsync([{ code: 'let n = 1;', lang: 'js' }], { immediate: true });
  assert.equal(direct.length, 1);
});

test('Wave 2.6: composer triggers, /fanout runner, thread inbox snooze, panel guard & notification gate', async () => {
  // Triggers
  assert.equal(detectComposerTrigger('/review', 7)?.kind, 'slash-command');
  assert.equal(detectComposerTrigger('/usr/local/bin', 14), null);
  assert.equal(isPathWord('/usr/local', 0, 10), true);
  assert.equal(detectComposerTrigger('open @desktop/main', 18)?.kind, 'path');
  assert.equal(detectComposerTrigger('use $pymol', 10)?.kind, 'skill');
  assert.equal(detectComposerTrigger('pay $10.50k', 11), null);
  assert.equal(isCurrencyAmountQuery('25k'), true);
  assert.equal(detectComposerTrigger('check (#42', 10)?.query, '42');
  assert.equal(serializeComposerFileLink('dir/my file (v1).js'), '[my file (v1).js](dir/my%20file%20%28v1%29.js)');
  const replaced = replaceComposerTrigger('inspect @app here', { rangeStart: 8, rangeEnd: 12 }, '[app.js](app.js)');
  assert.equal(replaced.text, 'inspect [app.js](app.js) here');

  // Fanout
  assert.deepEqual(normalizeFanoutSeats(['claude', 'gemini', 'claude', 'unknown'], ['claude', 'gemini', 'codex']), ['claude', 'gemini']);
  const fanoutRes = await runModelFanout({
    prompt: 'Compare architectures',
    seats: ['claude', 'gemini'],
    runSeat: async seat => {
      if (seat === 'gemini') throw new Error('quota');
      return { text: 'Use hexagonal ports.', model: 'claude-5' };
    },
  });
  assert.equal(fanoutRes.results[0].ok, true);
  assert.equal(fanoutRes.results[1].ok, false);
  assert.equal(fanoutRes.results[1].error, 'quota');

  // Thread inbox / snooze
  const now = Date.parse('2026-11-24T10:00:00Z');
  const presets = snoozePresets(now);
  assert.equal(presets.length, 3);
  assert.equal(isSessionSnoozed({ snoozedUntil: presets[0].until }, now), true);
  assert.equal(formatSnoozeRemaining(presets[0].until, now), '1h');
  const sorted = sortInboxByReturn(
    [
      { id: 'snoozed', updatedAt: '2026-11-24T09:59:00Z', snoozedUntil: presets[0].until },
      { id: 'old-wait', updatedAt: '2026-11-24T08:00:00Z' },
      { id: 'finished', updatedAt: '2026-11-24T09:00:00Z' },
    ],
    { nowMs: now, running: { 'old-wait': 'waiting' }, finished: ['finished'] },
  );
  assert.deepEqual(sorted.map(s => s.id), ['old-wait', 'finished']);

  // Proactive panel guard
  const guard = createProactivePanelGuard();
  const rev = guard.getRevision('s1');
  assert.equal(guard.canAutoOpen({ sessionId: 's1', expectedRevision: rev }), true);
  guard.recordUserAction('s1');
  assert.equal(guard.canAutoOpen({ sessionId: 's1', expectedRevision: rev }), false);

  // Notification gate: focused + post-blur grace window + dedupe + urgent bypass
  let t = 10_000;
  const gate = createNotificationGate({ graceMs: 6_000, dedupeMs: 15_000, now: () => t });
  gate.setActiveSession('s1');
  gate.setFocus(true);
  assert.equal(gate.shouldNotify({ sessionId: 's1', kind: 'turn' }).reason, 'focused');
  assert.equal(gate.shouldNotify({ sessionId: 's1', kind: 'approval', urgent: true }).allow, true);

  gate.setFocus(false);
  assert.equal(gate.shouldNotify({ sessionId: 's1', kind: 'turn' }).reason, 'grace-window');
  t += 6_500;
  assert.equal(gate.shouldNotify({ sessionId: 's1', kind: 'turn' }).allow, true);
  assert.equal(gate.shouldNotify({ sessionId: 's1', kind: 'turn' }).reason, 'deduped');
});
