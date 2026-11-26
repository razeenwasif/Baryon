import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTurnTrace, formatDuration, readJsonlTail, traceMarkdown, tracesForSession } from '../desktop/run-trace.mjs';
import { WorkTools } from '../desktop/work-tools.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

test('buildTurnTrace builds timeline with per-step timing, model seats, handoffs, tool breakdown, and routing events', () => {
  const start = Date.parse('2026-11-21T10:00:00.000Z');
  const trace = buildTurnTrace({
    session: 's1',
    at: '2026-11-21T10:00:00.000Z',
    replyAt: '2026-11-21T10:00:12.500Z',
    request: 'Refactor parser and run unit tests',
    seat: { provider: 'claude', model: 'claude-opus-5-5', role: 'lead' },
    auto: { model: 'claude-opus-5-5', provider: 'claude', effort: 'high', kind: 'code', shape: 'plan', why: 'Multi-file refactor needs a plan.' },
    outcome: 'done',
    ms: 12500,
    usage: { input: 14200, output: 1850, cached: 8000 },
    ledger: { steps: 4, sent: 42000, images: 0, byTool: { read_file: { calls: 1, chars: 1200, images: 0 }, build_step: { calls: 1, chars: 800, images: 0 } } },
    verdict: { status: 'checked', line: 'Checked · node --test passed', tooltip: 'Exit 0' },
    toolCalls: [
      { name: 'read_file', risk: 'read', outcome: 'ok', ms: 12 },
      { name: 'build_step', risk: 'write', outcome: 'ok', ms: 6200 },
      { name: 'ask_critic', risk: 'read', outcome: 'ok', ms: 3400 },
    ],
    activity: [
      { id: 't0', tool: 'thought', summary: 'Thinking…', status: 'done' },
      { id: 'r1', tool: 'read', summary: 'src/parser.js', status: 'done', startedAt: start + 200, ms: 12 },
      {
        id: 'b1', tool: 'step', summary: 'Rewrite tokenizer', status: 'done', detail: 'Done',
        startedAt: start + 500, ms: 6200,
        seat: { model: 'claude-sonnet-5', role: 'builder', effort: 'medium' },
        handoff: { kind: 'builder', brief: 'Update src/parser.js tokenizer.', report: 'Updated src/parser.js; tests pass.', attempt: 1, outcome: 'done', check: 'node --test', passed: true },
      },
      {
        id: 'c1', tool: 'critic', summary: 'Review of 42 changed lines', status: 'done',
        startedAt: start + 7000, ms: 3400,
        seat: { model: 'gemini-4-argon-medium', role: 'critic' },
        handoff: { kind: 'critic', brief: 'Check edge cases', report: 'No bugs found.' },
      },
    ],
    routing: [
      { at: '2026-11-21T10:00:06.700Z', type: 'check', chat: 's1', kind: 'code', model: 'claude-sonnet-5', passed: true },
      { at: '2026-11-21T10:00:12.500Z', chat: 's1', role: 'lead', provider: 'claude', model: 'claude-opus-5-5', outcome: 'done', ms: 12500 },
    ],
  });

  assert.equal(trace.ms, 12500);
  assert.equal(trace.stepCount, 3, 'ephemeral thought rows are excluded from timeline steps');
  assert.equal(trace.handoffCount, 2);
  assert.equal(trace.failedCount, 0);
  assert.equal(trace.timeline[0].offsetMs, 200);
  assert.equal(trace.timeline[1].kind, 'handoff');
  assert.equal(trace.timeline[1].handoff.brief, 'Update src/parser.js tokenizer.');
  assert.equal(trace.timeline[1].handoff.report, 'Updated src/parser.js; tests pass.');
  assert.equal(trace.timeline[1].handoff.passed, true);
  assert.equal(trace.timeline[2].seat.model, 'gemini-4-argon-medium');
  assert.equal(trace.models.length, 3);
  assert.equal(trace.byTool.build_step.ms, 6200);
  assert.equal(trace.byTool.build_step.chars, 800);
  assert.equal(trace.routing.length, 2);

  const md = traceMarkdown(trace);
  assert.match(md, /claude-opus-5-5/);
  assert.match(md, /Checked · node --test passed/);
  assert.match(md, /Brief: Update src\/parser\.js tokenizer/);
  assert.match(md, /Report: Updated src\/parser\.js; tests pass/);
  assert.equal(formatDuration(850), '850 ms');
  assert.equal(formatDuration(12500), '12.5 s');
  assert.equal(formatDuration(125000), '2m 5s');
});

test('tracesForSession reconstructs both newly recorded turns and legacy saved turns with routing & ledger correlation', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-trace-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const routingPath = join(dir, 'routing.jsonl');
  await writeFile(routingPath, [
    JSON.stringify({ at: '2026-11-21T09:00:08.000Z', chat: 's-hist', role: 'turn', provider: 'claude', model: 'claude-haiku-5-5', outcome: 'done', ms: 8000, tokens: { input: 3000, output: 400 } }),
    JSON.stringify({ at: '2026-11-21T09:05:00.000Z', chat: 'other-chat', role: 'turn', provider: 'gemini', model: 'gemini-4-argon-medium', outcome: 'done', ms: 4000 }),
    'malformed-json-line',
  ].join('\n') + '\n');

  const routingLines = await readJsonlTail(routingPath);
  assert.equal(routingLines.length, 2);

  const history = [
    { role: 'user', mode: 'work', at: '2026-11-21T09:00:00.000Z', content: 'Older work request before run trace existed' },
    {
      role: 'assistant', mode: 'work', at: '2026-11-21T09:00:08.000Z', replyTo: '2026-11-21T09:00:00.000Z', content: 'Done.',
      activity: [
        { id: 'a1', tool: 'step', summary: 'Legacy builder step', status: 'done', reason: 'Fix a.js', output: 'Fixed a.js', seat: { model: 'claude-sonnet-5', role: 'builder' } },
      ],
    },
    { role: 'user', mode: 'work', at: '2026-11-21T09:10:00.000Z', content: 'Second request that stopped' },
    {
      role: 'assistant', mode: 'work', at: '2026-11-21T09:10:04.000Z', replyTo: '2026-11-21T09:10:00.000Z', content: 'Stopped.',
      unfinished: true, ended: 'you', durationMs: 4100,
      seat: { provider: 'antigravity', model: 'gemini-4-hydrogen-medium', role: 'turn', standIn: 'Claude at limit' },
      activity: [{ id: 'a2', tool: 'run', summary: 'npm test', status: 'failed', ms: 2100, output: 'Error: failed' }],
    },
  ];
  const ledgerLines = [
    { at: '2026-11-21T09:00:07.500Z', session: 's-hist', steps: 2, sent: 12000, images: 0, byTool: { read_file: { calls: 1, chars: 500, images: 0 } } },
  ];

  const traces = tracesForSession({ session: 's-hist', history, routingLines, ledgerLines });
  assert.equal(traces.length, 2);
  // Newest first
  assert.equal(traces[0].outcome, 'stopped');
  assert.equal(traces[0].seat.standIn, 'Claude at limit');
  assert.equal(traces[0].failedCount, 1);

  // Older legacy turn gets seat, routing, tokens, and handoff extracted automatically
  assert.equal(traces[1].seat.model, 'claude-haiku-5-5');
  assert.equal(traces[1].tokens.input, 3000);
  assert.equal(traces[1].ledger.sent, 12000);
  assert.equal(traces[1].routing.length, 1);
  assert.equal(traces[1].timeline[0].kind, 'handoff');
  assert.equal(traces[1].timeline[0].handoff.brief, 'Fix a.js');
  assert.equal(traces[1].timeline[0].handoff.report, 'Fixed a.js');
});

test('WorkTools stamps startedAt/ms and captures brief + report handoffs on build_step, ask_helper, and ask_critic', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'fairy-trace-wt-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'a.txt'), 'hello\n');

  const tools = new WorkTools({
    root,
    permission: 'auto',
    sandboxed: true,
    runCommand: async () => ({ exitCode: 0, output: 'ok', timedOut: false }),
    approve: async () => 'allow',
    helper: async ({ onSeat }) => { onSeat({ model: 'gemini-3.8-flash-low', role: 'scout' }); return 'Found a.txt'; },
    builder: async ({ onSeat, handle }) => {
      onSeat({ model: 'claude-sonnet-5', role: 'builder' });
      await handle({ tool: 'read_file', arguments: { path: 'a.txt' } });
      await handle({ tool: 'edit_file', arguments: { path: 'a.txt', old_text: 'hello', new_text: 'world' } });
      return 'Edited a.txt to world.';
    },
    critic: async ({ onSeat }) => { onSeat({ model: 'gemini-4-argon-medium', role: 'critic' }); return 'Looks clean.'; },
  });

  await tools.handle({ tool: 'ask_helper', arguments: { task: 'Inspect a.txt' } });
  await tools.handle({ tool: 'build_step', arguments: { title: 'Update greeting', brief: 'Change hello to world in a.txt', files: ['a.txt'], check: 'echo ok' } });
  await tools.handle({ tool: 'ask_critic', arguments: { focus: 'Check greeting change' } });

  const helperRow = tools.activity.find(r => r.tool === 'helper');
  const stepRow = tools.activity.find(r => r.tool === 'step');
  const criticRow = tools.activity.find(r => r.tool === 'critic');

  for (const row of [helperRow, stepRow, criticRow]) {
    assert.ok(typeof row.startedAt === 'number' && row.startedAt > 0);
    assert.ok(typeof row.ms === 'number' && row.ms >= 0);
    assert.ok(row.handoff?.brief);
    assert.ok(row.handoff?.report);
  }
  assert.equal(helperRow.handoff.kind, 'helper');
  assert.equal(stepRow.handoff.kind, 'builder');
  assert.equal(stepRow.handoff.passed, true);
  assert.equal(criticRow.handoff.kind, 'critic');
});

test('main.cjs, preload.cjs, remote-channels.mjs, and src/app.js wire run-trace cleanly', async () => {
  const [main, preload, remote, app] = await Promise.all([
    readFile(join(repoRoot, 'desktop/main.cjs'), 'utf8'),
    readFile(join(repoRoot, 'desktop/preload.cjs'), 'utf8'),
    readFile(join(repoRoot, 'desktop/remote-channels.mjs'), 'utf8'),
    readFile(join(repoRoot, 'src/app.js'), 'utf8'),
  ]);
  assert.match(main, /handle\('run-trace'/);
  assert.match(preload, /runTrace:/);
  assert.match(remote, /'run-trace'/);
  assert.match(app, /tracePane/);
  assert.match(app, /name: 'trace'/);
  assert.match(app, /message-trace-btn/);
});
