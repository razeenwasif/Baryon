import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  AgentSwarmManager,
  MAX_AGENTS,
  MAX_INBOX,
  cleanScopePath,
  cleanSwarmPlanReply,
  detectScopeOverlaps,
  upstreamContext,
  validateSwarmGraph,
} from '../desktop/agent-swarm.mjs';
import {
  createBlankAgent,
  elapsedWords,
  parseCommaList,
  parseDependsList,
  parseTeamworkCommand,
  swarmSummaryLine,
  swarmWorkBarBadge,
} from '../src/swarm-logic.js';

function tempDir(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), `fairy-agent-swarm-${prefix}-`));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

test('validateSwarmGraph enforces limits, cycles, unknown deps, and detects concurrent write overlaps', () => {
  assert.throws(() => validateSwarmGraph([]), /at least one agent/);
  assert.throws(() => validateSwarmGraph(Array.from({ length: MAX_AGENTS + 1 }, (_, i) => ({ id: `A${i + 1}`, task: 'work' }))), /at most/);
  assert.throws(() => validateSwarmGraph([{ id: 'A1', role: 'Dev', task: '' }]), /needs a task/);
  assert.throws(() => validateSwarmGraph([{ id: 'A1', task: 'x', dependsOn: ['A1'] }]), /can’t depend on itself/);
  assert.throws(() => validateSwarmGraph([{ id: 'A1', task: 'x', dependsOn: ['A9'] }]), /unknown agent A9/);
  assert.throws(() => validateSwarmGraph([
    { id: 'A1', task: 'x', dependsOn: ['A2'] },
    { id: 'A2', task: 'y', dependsOn: ['A1'] },
  ]), /cycle/);
  assert.throws(() => validateSwarmGraph([
    { id: 'A1', task: 'x', dependsOn: ['A3'] },
    { id: 'A2', task: 'y', dependsOn: ['A1'] },
    { id: 'A3', task: 'z', dependsOn: ['A2'] },
  ]), /cycle/);

  // Topological order + concurrent write scope overlap detection.
  const graph = validateSwarmGraph([
    { id: 'A3', role: 'Tester', kind: 'read', dependsOn: ['A2'], scope: ['src/app.js'], task: 'Test app' },
    { id: 'A1', role: 'Backend', kind: 'write', scope: ['src/api.js', 'src/shared.js'], task: 'Build API' },
    { id: 'A2', role: 'Frontend', kind: 'write', scope: ['src/ui.js', 'src/shared.js'], task: 'Build UI' },
  ]);
  assert.ok(graph.order.indexOf('A2') < graph.order.indexOf('A3'), 'A2 precedes dependent A3');
  assert.deepEqual([...graph.order].sort(), ['A1', 'A2', 'A3']);
  assert.deepEqual(graph.overlaps, [{ path: 'src/shared.js', agents: ['A1', 'A2'] }]);
  const chain = validateSwarmGraph([
    { id: 'A3', task: 'Step 3', dependsOn: ['A2'] },
    { id: 'A2', task: 'Step 2', dependsOn: ['A1'] },
    { id: 'A1', task: 'Step 1' },
  ]);
  assert.deepEqual(chain.order, ['A1', 'A2', 'A3']);

  // Sequential write agents (A2 depends on A1) or read-only agents do NOT trigger concurrent overlap warnings.
  const seq = validateSwarmGraph([
    { id: 'A1', kind: 'write', scope: ['src/shared.js'], task: 'Step 1' },
    { id: 'A2', kind: 'write', dependsOn: ['A1'], scope: ['src/shared.js'], task: 'Step 2' },
    { id: 'A3', kind: 'read', scope: ['src/shared.js'], task: 'Inspect' },
  ]);
  assert.deepEqual(seq.overlaps, []);
  assert.deepEqual(detectScopeOverlaps(seq.agents), []);
});

test('cleanScopePath rejects traversal, absolute, and secret paths while normalizing clean relative paths', () => {
  assert.equal(cleanScopePath('./src/app.js'), 'src/app.js');
  assert.equal(cleanScopePath('src\\lib\\util.mjs'), 'src/lib/util.mjs');
  for (const bad of ['', '../secret.txt', '/etc/passwd', 'a/../../b', '.env', 'config/.env.local', '.ssh/id_rsa', 'a\0b']) {
    assert.equal(cleanScopePath(bad), '', `expected rejected: ${JSON.stringify(bad)}`);
  }
});

test('cleanSwarmPlanReply extracts fenced or prose-wrapped JSON and rejects invalid replies', () => {
  const fenced = 'Here is your plan:\n```json\n{"summary":"Split backend and UI","agents":[{"id":"A1","role":"API","kind":"write","provider":"claude","scope":["desktop/api.mjs"],"dependsOn":[],"task":"Implement API"},{"id":"A2","role":"UI","kind":"write","provider":"gemini","scope":["src/ui.js"],"dependsOn":["A1"],"task":"Wire UI"}]}\n```';
  const plan = cleanSwarmPlanReply(fenced, { maxAgents: 4 });
  assert.equal(plan.summary, 'Split backend and UI');
  assert.deepEqual(plan.order, ['A1', 'A2']);
  assert.equal(plan.agents[0].provider, 'claude');
  assert.equal(plan.agents[1].provider, 'gemini');
  assert.throws(() => cleanSwarmPlanReply('not json at all'), /valid agent swarm JSON/);
  assert.throws(() => cleanSwarmPlanReply('{"summary":"empty","agents":[]}'), /valid agent swarm JSON/);
});

test('AgentSwarmManager enforces maxParallel concurrency and completes all parallel agents', async t => {
  const root = tempDir(t, 'par-root'), place = tempDir(t, 'par-place');
  writeFileSync(join(root, 'index.js'), 'console.log(1);\n');
  let running = 0, peak = 0;
  const gates = new Map();
  const events = [];

  const mgr = new AgentSwarmManager({
    place,
    emit: (chat, snap) => events.push({ chat, status: snap?.status, active: snap?.counts?.active }),
    runRead: async ({ role }) => {
      running += 1;
      peak = Math.max(peak, running);
      const g = deferred();
      gates.set(role, g);
      await g.promise;
      running -= 1;
      return `${role} done`;
    },
    runWrite: async () => 'ok',
  });

  await mgr.deploy({
    chat: 'chat-par',
    root,
    brief: 'Run 4 researchers with maxParallel 2',
    maxParallel: 2,
    agents: [
      { id: 'A1', role: 'R1', kind: 'read', task: 'Read 1' },
      { id: 'A2', role: 'R2', kind: 'read', task: 'Read 2' },
      { id: 'A3', role: 'R3', kind: 'read', task: 'Read 3' },
      { id: 'A4', role: 'R4', kind: 'read', task: 'Read 4' },
    ],
  });

  // Wait a tick for the first 2 to start; R3 and R4 must still be queued.
  await new Promise(r => setTimeout(r, 20));
  assert.equal(running, 2);
  assert.equal(peak, 2);
  assert.equal(mgr.state('chat-par').counts.queued, 2);

  gates.get('R1').resolve();
  gates.get('R2').resolve();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(running, 2);
  assert.equal(peak, 2);

  gates.get('R3').resolve();
  gates.get('R4').resolve();
  const final = await mgr.waitAll('chat-par');
  assert.equal(peak, 2);
  assert.equal(final.status, 'done');
  assert.equal(final.counts.done, 4);
  assert.equal(readdirSync(place).length, 0, 'read-only agents create zero copies');
  assert.ok(events.length >= 4);
});

test('AgentSwarmManager honors DAG dependencies, passes upstream reports, and cascades upstream failures cleanly', async t => {
  const root = tempDir(t, 'dag-root'), place = tempDir(t, 'dag-place');
  writeFileSync(join(root, 'app.js'), 'export const x = 1;\n');
  const seen = [];

  const mgr = new AgentSwarmManager({
    place,
    runRead: async ({ role, task }) => {
      seen.push({ role, task });
      return `Findings from ${role}`;
    },
    runWrite: async ({ role, task }) => {
      seen.push({ role, task });
      return `Built by ${role}`;
    },
  });

  await mgr.deploy({
    chat: 'chat-dag',
    root,
    agents: [
      { id: 'A1', role: 'Scout', kind: 'read', task: 'Find files' },
      { id: 'A2', role: 'Builder', kind: 'read', dependsOn: ['A1'], task: 'Build feature' },
      { id: 'A3', role: 'Verifier', kind: 'read', dependsOn: ['A2'], task: 'Verify build' },
    ],
  });
  const done = await mgr.waitAll('chat-dag');
  assert.equal(done.status, 'done');
  assert.deepEqual(seen.map(s => s.role), ['Scout', 'Builder', 'Verifier']);
  assert.match(seen[1].task, /<<<UPSTREAM_AGENT_REPORTS/);
  assert.match(seen[1].task, /Findings from Scout/);
  assert.match(seen[2].task, /Findings from Builder/);

  // Upstream failure cascades 'stopped' to downstream agents without deadlocking.
  const failMgr = new AgentSwarmManager({
    place,
    runRead: async ({ role }) => {
      if (role === 'First') throw new Error('boom');
      return 'should not run';
    },
    runWrite: async () => 'ok',
  });
  await failMgr.deploy({
    chat: 'chat-fail',
    root,
    agents: [
      { id: 'A1', role: 'First', kind: 'read', task: 'Fail here' },
      { id: 'A2', role: 'Second', kind: 'read', dependsOn: ['A1'], task: 'Depends on First' },
      { id: 'A3', role: 'Third', kind: 'read', dependsOn: ['A2'], task: 'Depends on Second' },
    ],
  });
  const settled = await failMgr.waitAll('chat-fail');
  assert.equal(settled.status, 'done');
  assert.equal(settled.agents[0].status, 'failed');
  assert.equal(settled.agents[1].status, 'stopped');
  assert.match(settled.agents[1].error, /upstream agent A1/);
  assert.equal(settled.agents[2].status, 'stopped');
  assert.match(settled.agents[2].error, /upstream agent A2/);
});

test('AgentSwarmManager isolates write agents in APFS copies, 3-way merges cleanly, and refuses overlapping line conflicts', async t => {
  const root = tempDir(t, 'iso-root'), place = tempDir(t, 'iso-place');
  writeFileSync(join(root, 'a.txt'), 'a-before\n');
  writeFileSync(join(root, 'b.txt'), 'b-before\n');
  writeFileSync(join(root, 'shared.txt'), 'line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7\n');

  const mgr = new AgentSwarmManager({
    place,
    runRead: async () => '',
    runWrite: async ({ root: copyRoot, role, onEvent, onSeat }) => {
      onSeat({ provider: 'claude', model: 'claude-sonnet-4-6', role });
      onEvent({ id: 's1', tool: 'write', summary: `Editing for ${role}`, status: 'done' });
      if (role === 'Backend') {
        writeFileSync(join(copyRoot, 'a.txt'), 'a-after\n');
        writeFileSync(join(copyRoot, 'new-a.txt'), 'created by Backend\n');
        return 'Updated a.txt and created new-a.txt';
      }
      writeFileSync(join(copyRoot, 'b.txt'), 'b-after\n');
      // Edit top of shared.txt while disk edits bottom -> clean 3-way merge.
      writeFileSync(join(copyRoot, 'shared.txt'), 'LINE ONE BY FRONTEND\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7\n');
      return 'Updated b.txt and top of shared.txt';
    },
  });

  await mgr.deploy({
    chat: 'chat-iso',
    root,
    agents: [
      { id: 'A1', role: 'Backend', kind: 'write', scope: ['a.txt', 'new-a.txt'], task: 'Edit a' },
      { id: 'A2', role: 'Frontend', kind: 'write', scope: ['b.txt', 'shared.txt'], task: 'Edit b' },
    ],
  });
  const afterRun = await mgr.waitAll('chat-iso');
  assert.equal(afterRun.status, 'done');
  assert.equal(afterRun.counts.unmerged, 2);
  // Real project MUST remain untouched until merge.
  assert.equal(readFileSync(join(root, 'a.txt'), 'utf8'), 'a-before\n');
  assert.equal(readFileSync(join(root, 'b.txt'), 'utf8'), 'b-before\n');
  assert.equal(existsSync(join(root, 'new-a.txt')), false);

  // Inspect diff before merging.
  const diffA1 = mgr.diffAgent('chat-iso', 'A1');
  assert.equal(diffA1.changes.length, 2);
  assert.ok(diffA1.changes.some(c => c.path === 'a.txt' && c.diff.includes('+a-after')));

  // Simulate concurrent disk edit on bottom of shared.txt before merging.
  writeFileSync(join(root, 'shared.txt'), 'line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nLINE SEVEN ON DISK\n');

  const merged = await mgr.mergeAll('chat-iso');
  assert.equal(merged.results.length, 2);
  assert.ok(merged.results.every(r => r.merged));
  assert.equal(readFileSync(join(root, 'a.txt'), 'utf8'), 'a-after\n');
  assert.equal(readFileSync(join(root, 'new-a.txt'), 'utf8'), 'created by Backend\n');
  assert.equal(readFileSync(join(root, 'b.txt'), 'utf8'), 'b-after\n');
  const mergedShared = readFileSync(join(root, 'shared.txt'), 'utf8');
  assert.match(mergedShared, /LINE ONE BY FRONTEND/);
  assert.match(mergedShared, /LINE SEVEN ON DISK/);
  assert.equal(merged.swarm.counts.merged, 2);
  assert.equal(merged.swarm.counts.unmerged, 0);

  // Conflict scenario: two write agents edit the exact same line of conflict.txt.
  writeFileSync(join(root, 'conflict.txt'), 'same line\n');
  const conflictMgr = new AgentSwarmManager({
    place,
    runRead: async () => '',
    runWrite: async ({ root: copyRoot, role }) => {
      writeFileSync(join(copyRoot, 'conflict.txt'), `edited by ${role}\n`);
      return role;
    },
  });
  await conflictMgr.deploy({
    chat: 'chat-conflict',
    root,
    agents: [
      { id: 'A1', role: 'Alpha', kind: 'write', task: 'Edit conflict' },
      { id: 'A2', role: 'Beta', kind: 'write', task: 'Edit conflict differently' },
    ],
  });
  await conflictMgr.waitAll('chat-conflict');
  const m1 = await conflictMgr.mergeAgent('chat-conflict', 'A1');
  assert.equal(m1.merged, true);
  assert.equal(readFileSync(join(root, 'conflict.txt'), 'utf8'), 'edited by Alpha\n');

  const m2 = await conflictMgr.mergeAgent('chat-conflict', 'A2');
  assert.equal(m2.merged, false);
  assert.equal(m2.conflicts.length, 1);
  assert.equal(m2.conflicts[0].path, 'conflict.txt');
  assert.equal(readFileSync(join(root, 'conflict.txt'), 'utf8'), 'edited by Alpha\n', 'conflict never overwrites disk');
  await conflictMgr.clear('chat-conflict');
});

test('AgentSwarmManager supports live steering, per-agent stop, dynamic addAgent, and discardAgent', async t => {
  const root = tempDir(t, 'ctrl-root'), place = tempDir(t, 'ctrl-place');
  writeFileSync(join(root, 'file.txt'), 'v0\n');
  const gate1 = deferred(), gate2 = deferred();
  let steered = [];

  const mgr = new AgentSwarmManager({
    place,
    runRead: async () => 'read report',
    runWrite: async ({ root: copyRoot, role, signal, messages }) => {
      if (role === 'Keeper') {
        await gate1.promise;
        steered = messages();
        writeFileSync(join(copyRoot, 'file.txt'), `v1:${steered.map(m => m.text).join('|')}\n`);
        return 'Keeper done';
      }
      if (role === 'Stoppable') {
        await new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
          gate2.promise.then(resolve);
        });
        return 'should have stopped';
      }
      writeFileSync(join(copyRoot, 'added.txt'), 'dynamic\n');
      return 'Added done';
    },
  });

  await mgr.deploy({
    chat: 'chat-ctrl',
    root,
    agents: [
      { id: 'A1', role: 'Keeper', kind: 'write', task: 'Keep running' },
      { id: 'A2', role: 'Stoppable', kind: 'write', task: 'Will be stopped' },
      { id: 'A3', role: 'Reader', kind: 'read', task: 'Read only' },
    ],
  });

  // Wait until A1 and A2 enter running state.
  for (let i = 0; i < 40 && mgr.state('chat-ctrl').agents[0].status !== 'running'; i += 1) {
    await new Promise(r => setTimeout(r, 15));
  }

  // Live steering works for running write agents, rejects bad inputs / overflow / read-only agents.
  const queued = mgr.messageAgent('chat-ctrl', 'A1', 'Also add error handling');
  assert.deepEqual(queued, { queued: true, waiting: 1 });
  assert.throws(() => mgr.messageAgent('chat-ctrl', 'A1', '   '), /1 and 2,000/);
  assert.throws(() => mgr.messageAgent('chat-ctrl', 'A3', 'hello'), /read-only/);
  for (let i = 1; i < MAX_INBOX; i += 1) mgr.messageAgent('chat-ctrl', 'A1', `note ${i}`);
  assert.throws(() => mgr.messageAgent('chat-ctrl', 'A1', 'too many'), /messages waiting/);

  // Stop only A2; A1 keeps running.
  mgr.stopAgent('chat-ctrl', 'A2');
  gate1.resolve();
  const settled = await mgr.waitAll('chat-ctrl');
  assert.equal(settled.agents[0].status, 'done');
  assert.equal(settled.agents[1].status, 'stopped');
  assert.equal(steered[0].text, 'Also add error handling');

  // Cannot merge a read-only agent.
  await assert.rejects(() => mgr.mergeAgent('chat-ctrl', 'A3'), /read-only/);

  // Dynamically add a 4th agent into the settled swarm.
  await mgr.addAgent('chat-ctrl', { role: 'Dynamic', kind: 'write', task: 'Add added.txt' });
  const afterAdd = await mgr.waitAll('chat-ctrl');
  assert.equal(afterAdd.agents.length, 4);
  assert.equal(afterAdd.agents[3].id, 'A4');
  assert.equal(afterAdd.agents[3].status, 'done');

  // Discard A4 -> cleans its copy and marks discarded.
  const afterDiscard = await mgr.discardAgent('chat-ctrl', 'A4');
  assert.equal(afterDiscard.agents[3].status, 'discarded');
  assert.equal(afterDiscard.agents[3].changes.length, 0);

  await mgr.clear('chat-ctrl');
  assert.equal(mgr.state('chat-ctrl'), null);
});

test('swarm-logic pure helpers and UI/backend wiring', () => {
  assert.deepEqual(parseTeamworkCommand('/swarm Split backend and tests'), { matched: true, brief: 'Split backend and tests' });
  assert.deepEqual(parseTeamworkCommand('/swarm'), { matched: true, brief: '' });
  assert.deepEqual(parseTeamworkCommand('/teamwork Split backend and tests'), { matched: true, brief: 'Split backend and tests' });
  assert.deepEqual(parseTeamworkCommand('/agents'), { matched: true, brief: '' });
  assert.deepEqual(parseTeamworkCommand('/AGENTS  build docs '), { matched: true, brief: 'build docs' });
  assert.deepEqual(parseTeamworkCommand('/council compare designs'), { matched: false, brief: '' });
  assert.deepEqual(parseTeamworkCommand('hello world'), { matched: false, brief: '' });

  assert.equal(swarmWorkBarBadge(null), 'Swarm');
  assert.equal(swarmWorkBarBadge({ counts: { active: 3, unmerged: 0 } }), 'Swarm · 3 running');
  assert.equal(swarmWorkBarBadge({ counts: { active: 0, unmerged: 2 } }), 'Swarm · 2 to merge');
  assert.equal(swarmSummaryLine({ counts: { active: 2, queued: 1, done: 1, unmerged: 1, total: 4 } }), '2 running · 1 queued · 1 done · 1 ready to merge');
  assert.equal(elapsedWords('2026-11-21T10:00:00Z', '2026-11-21T10:02:05Z'), '2m 5s');
  assert.deepEqual(parseCommaList(' src/a.js, src/b.js , '), ['src/a.js', 'src/b.js']);
  assert.deepEqual(parseDependsList('a1, A2, bogus, a1'), ['A1', 'A2']);
  assert.equal(createBlankAgent([{ id: 'A1' }, { id: 'A2' }]).id, 'A3');

  // upstreamContext fences reports as untrusted peer data.
  const ctx = upstreamContext({ dependsOn: ['A1'] }, new Map([['A1', { id: 'A1', role: 'Scout', status: 'done', changes: [{ kind: 'modified', path: 'src/x.js' }], report: 'Found bug' }]]));
  assert.match(ctx, /<<<UPSTREAM_AGENT_REPORTS/);
  assert.match(ctx, /Found bug/);

  // Wiring checks in app.js, main.cjs, workspace.css, preload.cjs, and remote-channels.mjs.
  const appSrc = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(appSrc, /import \{ swarmPane \} from '\.\/swarm-pane\.js'/);
  assert.match(appSrc, /id="work-swarm-btn"/);
  assert.match(appSrc, /api\?\.onAgentSwarm\?\./);
  assert.match(appSrc, /parseTeamworkCommand\(text\)/);
  assert.match(appSrc, /swarm: 'Swarm'/);
  assert.match(appSrc, /box\.value = `\/council \$\{request\}`/);

  const mainSrc = readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(mainSrc, /councilAsk = \/\^\\\/council\\s\+\(\[\^\]\+\)\$\/i\.exec/);

  const cssSrc = readFileSync(new URL('../src/workspace.css', import.meta.url), 'utf8');
  assert.match(cssSrc, /#pane-rail button\[data-pane="swarm"\]/);
  assert.match(cssSrc, /#work-swarm-btn/);

  const preloadSrc = readFileSync(new URL('../desktop/preload.cjs', import.meta.url), 'utf8');
  assert.match(preloadSrc, /agentSwarmDeploy:/);
  assert.match(preloadSrc, /onAgentSwarm:/);
});

test('AgentSwarmManager.summary reports active running swarms and unmerged finished swarms', async t => {
  const repo = tempDir(t, 'summary-repo');
  const place = tempDir(t, 'summary-place');
  writeFileSync(join(repo, 'app.txt'), 'v1\n');

  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const mgr = new AgentSwarmManager({
    place,
    runRead: async ({ signal }) => {
      await new Promise((resolve, reject) => {
        if (signal.aborted) return reject(new Error('aborted'));
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        gate.then(resolve);
      });
      return { text: 'read ok' };
    },
    runWrite: async ({ root }) => {
      writeFileSync(join(root, 'app.txt'), 'v2\n');
      return { text: 'write ok' };
    },
  });

  await mgr.deploy({
    chat: 'chat-run',
    root: repo,
    brief: 'Run',
    agents: [
      { id: 'A1', role: 'Scout 1', kind: 'read', task: 'read' },
      { id: 'A2', role: 'Scout 2', kind: 'read', task: 'read' },
    ],
  });
  assert.deepEqual(mgr.summary(), {
    'chat-run': { status: 'running', active: 2, total: 2 },
  });
  release();
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.deepEqual(mgr.summary(), {});

  await mgr.deploy({
    chat: 'chat-write',
    root: repo,
    brief: 'Write',
    agents: [{ id: 'A1', role: 'Builder', kind: 'write', task: 'write' }],
  });
  for (let i = 0; i < 40 && mgr.get('chat-write')?.status === 'running'; i++) {
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.deepEqual(mgr.summary(), {
    'chat-write': { status: 'done', active: 0, total: 1, unmerged: 1 },
  });
});
