import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AGENT_EYE_PALETTE,
  COORDINATOR_EYE_COLOR,
  buildCircuitModel,
  buildCircuitTimeline,
  colorForAgent,
  computeCircuitStages,
  escapeXml,
  eyeStateForAgent,
  fairyEyeSVG,
  pathMidpoint,
  pcbPath,
  renderCircuitSVG,
} from '../src/swarm-circuit.js';

const SAMPLE_SWARM = {
  chat: 'chat-1',
  status: 'running',
  startedAt: '2026-11-22T03:00:00Z',
  agents: [
    {
      id: 'A1',
      role: 'Backend Engineer',
      kind: 'write',
      provider: 'claude',
      seat: { provider: 'claude', model: 'claude-sonnet-4-6' },
      scope: ['desktop/work-folders.mjs'],
      dependsOn: [],
      task: 'Implement repo discovery without the 10-item cap.',
      status: 'done',
      startedAt: '2026-11-22T03:00:01Z',
      endedAt: '2026-11-22T03:01:10Z',
      steps: [{ tool: 'writeFile', summary: 'Created desktop/work-folders.mjs', status: 'done' }],
      changes: [{ path: 'desktop/work-folders.mjs', kind: 'added', added: 140, removed: 0 }],
    },
    {
      id: 'A2',
      role: 'Frontend UI',
      kind: 'write',
      provider: 'gemini',
      scope: ['src/work-folder-picker.js'],
      dependsOn: [],
      task: 'Build Obsidian work folder picker with SSH tab.',
      status: 'running',
      startedAt: '2026-11-22T03:00:02Z',
      steps: [{ tool: 'editFile', summary: 'Wire SSH breadcrumb bar', status: 'running' }],
      changes: [],
    },
    {
      id: 'A3',
      role: 'Read-only Verifier',
      kind: 'read',
      provider: 'codex',
      scope: ['test/*.test.mjs'],
      dependsOn: ['A1', 'A2'],
      task: 'Run build and full test suite after authors complete.',
      status: 'queued',
      steps: [],
      changes: [],
    },
  ],
};

test('fairyEyeSVG renders distinct colored eyes across idle, working, done, and error states', () => {
  assert.equal(colorForAgent({ id: 'A1', kind: 'write', role: 'Author' }, 0), AGENT_EYE_PALETTE[0]);
  assert.equal(colorForAgent({ id: 'A9', kind: 'read', role: 'Read-only Verifier' }, 8), AGENT_EYE_PALETTE[3]);

  assert.equal(eyeStateForAgent('running'), 'working');
  assert.equal(eyeStateForAgent('copying'), 'working');
  assert.equal(eyeStateForAgent('done'), 'done');
  assert.equal(eyeStateForAgent('merged'), 'done');
  assert.equal(eyeStateForAgent('failed'), 'error');
  assert.equal(eyeStateForAgent('queued'), 'idle');

  const workingSvg = fairyEyeSVG(COORDINATOR_EYE_COLOR, { size: 32, state: 'working', uid: 'u1' });
  const doneSvg = fairyEyeSVG(AGENT_EYE_PALETTE[1], { size: 32, state: 'done', uid: 'u2' });
  const errSvg = fairyEyeSVG(AGENT_EYE_PALETTE[4], { size: 32, state: 'error', uid: 'u3' });

  assert.match(workingSvg, /id="u1-halo"/);
  assert.match(workingSvg, /stroke-dasharray="4 3"/, 'working state includes dashed scanning iris');
  assert.match(doneSvg, /Q40 28 54 44/, 'done state draws happy ^ squint');
  assert.match(errSvg, /L51 50/, 'error state draws alert mark');
});

test('computeCircuitStages lays out DAG dependencies linearly across stages', () => {
  const { nodes, maxStage, maxLanes, stageLabels } = computeCircuitStages(SAMPLE_SWARM.agents);
  assert.equal(nodes.get('coordinator').stage, 0);
  assert.equal(nodes.get('A1').stage, 1);
  assert.equal(nodes.get('A2').stage, 1);
  assert.equal(nodes.get('A3').stage, 2);
  assert.equal(maxStage, 2);
  assert.equal(maxLanes, 2);
  assert.equal(stageLabels[0], '01 DISPATCH');
  assert.equal(stageLabels[1], '02 PARALLEL BRANCHES');
  assert.match(stageLabels[2], /^03 /);
});

test('pcbPath, buildCircuitTimeline, buildCircuitModel, and renderCircuitSVG produce safe interactive circuit graphics', () => {
  const timeline = buildCircuitTimeline(SAMPLE_SWARM);
  assert.ok(timeline.length >= 6);
  assert.equal(timeline[0].from, 'coordinator');
  assert.equal(timeline[0].kind, 'direct');
  assert.ok(timeline.some(e => e.from === 'A1' && e.to[0] === 'A3' && e.kind === 'handoff'));
  assert.ok(timeline.some(e => e.from === 'A1' && e.to[0] === 'coordinator' && e.kind === 'return'));

  const dH = pcbPath({ x: 40, y: 80 }, { x: 300, y: 160 }, { from: 'coordinator', target: 'A1', kind: 'direct' }, { vertical: false });
  const dV = pcbPath({ x: 40, y: 80 }, { x: 160, y: 240 }, { from: 'coordinator', target: 'A1', kind: 'direct' }, { vertical: true });
  assert.match(dH, /^M \d+ \d+ L \d+ \d+ L \d+ \d+ L \d+ \d+$/);
  assert.match(dV, /^M \d+ \d+ L \d+ \d+ L \d+ \d+ L \d+ \d+$/);
  assert.equal(typeof pathMidpoint({ x: 40, y: 80 }, { x: 300, y: 160 }, { from: 'coordinator', target: 'A1', kind: 'direct' }).x, 'number');

  const model = buildCircuitModel(SAMPLE_SWARM, { step: 3 });
  const svg = renderCircuitSVG(model, { selectedId: 'A1' });
  assert.match(svg, /<svg viewBox="/);
  assert.match(svg, /sw-ic-node[^"]*is-selected/);
  assert.match(svg, /sw-trace-pulse/);

  // XSS sanitization inside SVG output:
  assert.equal(escapeXml('<script>alert("x")</script>'), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  const unsafeSwarm = {
    status: 'running',
    agents: [{ id: 'A1', role: '<img onerror=alert(1)>', kind: 'read', task: 'check', dependsOn: [], status: 'running', steps: [], changes: [] }],
  };
  const unsafeSvg = renderCircuitSVG(buildCircuitModel(unsafeSwarm));
  assert.ok(!unsafeSvg.includes('<img'), 'HTML/script characters escaped in SVG nodes');
  assert.ok(unsafeSvg.includes('&lt;img onerror=al'));
});

test('swarm-pane and workspace.css integrate Circuit Graph tabs and styles', () => {
  const paneSrc = readFileSync(new URL('../src/swarm-pane.js', import.meta.url), 'utf8');
  assert.match(paneSrc, /buildCircuitModel/);
  assert.match(paneSrc, /Circuit Graph/);
  assert.match(paneSrc, /'Board'/);
  assert.match(paneSrc, /'Members'/);

  const cssSrc = readFileSync(new URL('../src/workspace.css', import.meta.url), 'utf8');
  assert.match(cssSrc, /\.sw-pcb-stage\{/);
  assert.match(cssSrc, /\.sw-ic-node/);
  assert.match(cssSrc, /\.sw-tabs\{/);
});
