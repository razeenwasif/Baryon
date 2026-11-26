import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDpopKeyPair, createDpopReplayCache, signDpopProof, verifyDpopProof } from '../desktop/dpop-auth.mjs';
import { GitHubQuotaGuard } from '../desktop/github-quota.mjs';
import { GitHub } from '../desktop/github.mjs';
import { reclaimOrphanedDaemon } from '../desktop/process-audit-token.mjs';
import { computeSmallestViewerSize, truncateAnsiScrollback } from '../desktop/terminal-vt.mjs';
import { WIRE_HYDRATION_BYTES, createThreadLiveEventCoalescer, createWireHydrationStore, hydrateTurnItem, projectTurnItemForWire } from '../desktop/wire-projection.mjs';

export const SCENARIOS = new Map([
  ['wire-projection-hydration', async () => {
    const store = createWireHydrationStore();
    const bigText = 'x'.repeat(WIRE_HYDRATION_BYTES + 4096);
    const projected = projectTurnItemForWire({ id: 'turn-1', role: 'assistant', text: bigText }, { store });
    assert.equal(projected.truncated, true);
    assert.ok(projected.hydrationKey);
    const hydrated = hydrateTurnItem(store, projected.hydrationKey);
    assert.equal(hydrated.text.length, bigText.length);

    const flushed = [];
    const coalescer = createThreadLiveEventCoalescer({ flushMs: 50, onFlush: e => flushed.push(e) });
    coalescer.push({ type: 'text', session: 's1', text: 'Hel' });
    coalescer.push({ type: 'text', session: 's1', text: 'lo' });
    coalescer.push({ type: 'done', session: 's1', text: 'Hello' });
    coalescer.dispose();
    assert.equal(flushed.length, 2);
    assert.equal(flushed[0].text, 'Hello');
    assert.equal(flushed[1].type, 'done');
  }],

  ['dpop-replay-rejection', async () => {
    const kp = createDpopKeyPair();
    const cache = createDpopReplayCache();
    const url = 'https://mini.tail.ts.net:47615/v1/face/ask';
    const proof = signDpopProof({ privateKey: kp.privateKey, publicJwk: kp.publicJwk, htm: 'POST', htu: url });

    const first = verifyDpopProof(proof, { expectedHtm: 'POST', expectedHtu: url, replayCache: cache });
    assert.equal(first.valid, true);
    assert.equal(first.thumbprint, kp.thumbprint);

    const replay = verifyDpopProof(proof, { expectedHtm: 'POST', expectedHtu: url, replayCache: cache });
    assert.equal(replay.valid, false);
    assert.equal(replay.reason, 'replayed_jti');

    const badUrl = verifyDpopProof(signDpopProof({ privateKey: kp.privateKey, publicJwk: kp.publicJwk, htm: 'POST', htu: url }), { expectedHtm: 'POST', expectedHtu: 'https://evil.example/steal', replayCache: cache });
    assert.equal(badUrl.valid, false);
    assert.equal(badUrl.reason, 'htu_mismatch');
  }],

  ['github-quota-shedding', async () => {
    const quota = new GitHubQuotaGuard({ reserveRatio: 0.10 });
    quota.updateSnapshot({ limit: 5000, remaining: 400, resetAt: Date.now() + 3600_000 });
    const gh = new GitHub({ run: async () => '{"repos":[]}', quota });

    await assert.rejects(() => gh.json(['repo', 'list'], { priority: 'background' }), /GITHUB_QUOTA_RESERVED|quota reserve/);
    const interactive = await gh.json(['repo', 'list'], { priority: 'interactive' });
    assert.deepEqual(interactive, { repos: [] });
  }],

  ['audit-token-orphan-reclaim', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fairy-reclaim-'));
    try {
      const reusedLock = join(dir, 'reused.json');
      await writeFile(reusedLock, JSON.stringify({ pid: 4242, startedAt: 'Tue Nov 24 10:00:00 2026', command: 'fairy-helper' }));
      let killed = [];
      const resReused = await reclaimOrphanedDaemon(reusedLock, {
        readIdentity: async pid => ({ pid, startedAt: 'Tue Nov 24 11:00:00 2026', command: 'unrelated-proc' }),
        kill: (pid, sig) => killed.push([pid, sig]),
      });
      assert.equal(resReused.reclaimed, false);
      assert.equal(resReused.reason, 'pid_reused');
      assert.equal(killed.length, 0);

      const ownedLock = join(dir, 'owned.json');
      await writeFile(ownedLock, JSON.stringify({ pid: 5151, auditToken: 'tok-abc' }));
      const resOwned = await reclaimOrphanedDaemon(ownedLock, {
        readIdentity: async pid => ({ pid, auditToken: 'tok-abc' }),
        kill: (pid, sig) => killed.push([pid, sig]),
      });
      assert.equal(resOwned.reclaimed, true);
      assert.equal(resOwned.reason, 'killed');
      assert.deepEqual(killed, [[5151, 'SIGTERM']]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }],

  ['ansi-scrollback-safety', async () => {
    const sample = `${'Line-A '.repeat(40)}\x1b[38;2;255;120;10mCOLORED😀\x1b[0m\nTail line`;
    const cut = truncateAnsiScrollback(sample, 42);
    assert.equal(Buffer.byteLength(cut, 'utf8') <= 42, true);
    assert.equal(/\uFFFD/.test(cut), false);
    assert.equal(/^(?:;|\d+m)/.test(cut), false);

    const dims = computeSmallestViewerSize([{ cols: 140, rows: 40 }, { cols: 90, rows: 28 }]);
    assert.deepEqual(dims, { cols: 90, rows: 28 });
  }],
]);

export async function runProveScenarios({ scenario = '' } = {}) {
  const names = scenario ? [scenario] : [...SCENARIOS.keys()];
  const results = [];
  for (const name of names) {
    const fn = SCENARIOS.get(name);
    if (!fn) {
      results.push({ name, ok: false, error: `Unknown scenario: ${name}`, ms: 0 });
      continue;
    }
    const start = Date.now();
    try {
      await fn();
      results.push({ name, ok: true, error: '', ms: Math.max(1, Date.now() - start) });
    } catch (err) {
      results.push({ name, ok: false, error: err?.message || String(err), ms: Math.max(1, Date.now() - start) });
    }
  }
  return {
    passed: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    total: results.length,
    results,
  };
}
