import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runReader } from '../desktop/run-reader.mjs';
import { RunStore } from '../desktop/runs.mjs';
import { bytes, columnsOf, duration, filterRuns, homeShort, shortValue, sortRuns, sparkPath, whereWords } from '../src/runs-logic.js';

const temp = () => mkdtemp(join(tmpdir(), 'fairy-runs-panel-'));
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

test('the table’s columns, order and filters', () => {
  const runs = [
    { id: 'R1', state: 'done', started: '2026-11-18T01:00:00Z', seconds: 30, params: { lr: 0.1, batch: 64 }, metrics: { loss: { value: 0.5 } }, tags: ['base'] },
    { id: 'R2', state: 'failed', started: '2026-11-18T03:00:00Z', seconds: 5, params: { lr: 0.3 }, metrics: {}, name: 'big lr' },
    { id: 'R10', state: 'done', started: '2026-11-18T02:00:00Z', params: { lr: 0.01, seed: 1 }, metrics: { loss: { value: 0.2 }, acc: { value: 90 } } },
  ];
  assert.deepEqual(columnsOf(runs), { params: ['lr', 'batch', 'seed'], metrics: ['loss', 'acc'] });
  assert.deepEqual(columnsOf(runs, 1), { params: ['lr'], metrics: ['loss'] });
  assert.deepEqual(sortRuns(runs).map(r => r.id), ['R2', 'R10', 'R1'], 'newest first');
  assert.deepEqual(sortRuns(runs, 'id', 'asc').map(r => r.id), ['R1', 'R2', 'R10'], 'R10 after R2');
  assert.deepEqual(sortRuns(runs, 'metric:loss', 'asc').map(r => r.id), ['R10', 'R1', 'R2'], 'a run without the metric goes last');
  assert.deepEqual(sortRuns(runs, 'seconds', 'desc').map(r => r.id), ['R1', 'R2', 'R10']);
  assert.deepEqual(filterRuns(runs, 'failed').map(r => r.id), ['R2']);
  assert.deepEqual(filterRuns(runs, 'all', 'BASE').map(r => r.id), ['R1']);
  assert.deepEqual(filterRuns(runs, 'all', 'big').map(r => r.id), ['R2']);
});

test('values read briefly and exactly enough', () => {
  assert.deepEqual([0.0003, 3e-7, 0.123456, 1234, 12345678, 2.5e9, true, 'adam', null].map(shortValue), ['3e-4', '3e-7', '0.1235', '1,234', '1.23e+7', '2.50e+9', 'true', 'adam', '']);
  assert.deepEqual([0.25, 41.2, 600, 7200, null].map(duration), ['250 ms', '41.2 s', '10 min', '2.0 h', '']);
  assert.deepEqual([512, 2048, 48200000].map(bytes), ['512 B', '2.0 KB', '46 MB']);
  assert.equal(whereWords({ where: { kind: 'forge', job: 'j8f2c1a' } }), 'forge · j8f2c1a');
  assert.equal(homeShort('/Users/me/Github/x', '/Users/me'), '~/Github/x');
  assert.equal(sparkPath([[0, 2], [1, 1], [2, 0]], 100, 20), 'M1.0 1.0 L50.0 10.0 L99.0 19.0');
  assert.equal(sparkPath([[0, 1]]), '');
});

test('the reader lists Fairy’s projects and Research’s investigations, and shows only a run’s own pictures', async () => {
  const dir = await temp(), project = await temp(), research = await temp();
  try {
    const store = new RunStore({ dir });
    await store.start(project, { name: 'one' });
    await mkdir(join(project, 'out'), { recursive: true }); await writeFile(join(project, 'out', 'curve.png'), PNG);
    await store.finish(project, 'R1', { files: [{ path: 'out/curve.png', figure: true, sha256: null }] });
    // An investigation with a Lab run and a cluster run.
    const inv = join(research, 'sky-blue');
    await mkdir(join(inv, 'runs', 'R001', 'figures'), { recursive: true });
    await writeFile(join(inv, 'runs', 'R001', 'run.json'), JSON.stringify({ id: 'R001', about: { experiment: 'E001', hypothesis: 'H003' }, code: { file: 'main.py', sha256: 'a'.repeat(64) }, started: '2026-11-16T10:00:00Z', state: 'timed_out', exit: null, seconds: 600 }));
    await writeFile(join(inv, 'runs', 'R001', 'metrics.json'), JSON.stringify({ peak_nm: { value: 405.2, unit: 'nm' } }));
    await writeFile(join(inv, 'runs', 'R001', 'stdout.txt'), 'scattering done\n');
    await writeFile(join(inv, 'runs', 'R001', 'figures', 'spectrum.png'), PNG);
    await mkdir(join(inv, '.fairy', 'nexus', 'out', 'figures'), { recursive: true });
    await writeFile(join(inv, '.fairy', 'nexus', 'out', 'metrics.json'), JSON.stringify({ ratio: { value: 5.5, unit: null } }));
    await writeFile(join(inv, '.fairy', 'nexus-runs.json'), JSON.stringify([{ job: 'j8f2c1a', experiment: 'E002', machine: 'forge', submitted: '2026-11-17T10:00:00Z', state: 'done', exit: 0, outputs: '.fairy/nexus/out' }]));
    await mkdir(join(research, 'empty'));
    const reader = runReader({ store, research: () => research });
    const projects = await reader.projects();
    assert.deepEqual(projects.map(p => [p.title, p.kind, p.count]).sort(), [[project.split('/').at(-1), 'project', 1], ['sky-blue', 'investigation', 2]].sort());
    const lab = await reader.list(inv);
    assert.equal(lab.kind, 'investigation');
    const [cluster, proton] = lab.runs;
    assert.deepEqual([proton.id, proton.label, proton.name, proton.state, proton.where.kind, proton.metrics.peak_nm, proton.printout], ['R1', 'R001', 'E001 · H003', 'timed-out', 'lab', { value: 405.2, unit: 'nm' }, 'scattering done\n']);
    assert.deepEqual([cluster.id, cluster.label, cluster.where, cluster.metrics.ratio.value, cluster.state], ['C1', 'j8f2c1a', { kind: 'forge', job: 'j8f2c1a' }, 5.5, 'done']);
    assert.match((await reader.figure(inv, 'R1', 'runs/R001/figures/spectrum.png')).url, /^data:image\/png;base64,/);
    assert.match((await reader.figure(project, 'R1', 'out/curve.png')).url, /^data:image\/png;base64,iVBORw0KGgo/);
    await assert.rejects(reader.figure(inv, 'R1', 'runs/R001/stdout.txt'), /isn’t one of the run’s pictures/);
    assert.deepEqual((await reader.list(project)).runs.map(r => r.id), ['R1']);
    // No Research folder: only Fairy's projects.
    assert.equal((await runReader({ store, research: () => '' }).projects()).length, 1);
  } finally { for (const d of [dir, project, research]) await rm(d, { recursive: true, force: true }); }
});

test('the window has an Experiments place in the sidebar, beside the others, and its calls reach main', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8'), preload = await readFile(new URL('../desktop/preload.cjs', import.meta.url), 'utf8');
  assert.match(app, /<button id="sidebar-runs" class="side-item" aria-pressed="false" title="Experiments: [^"]+">Experiments<\/button>/);
  assert.match(app, /<section id="runs-view" aria-label="Experiments" hidden><\/section>/);
  assert.match(app, /\$\('#sidebar-runs'\)\.onclick = \(\) => \{ if \(api\?\.runsProjects\) \{ hideNotebooks\(\); hideResearch\(\); hideDiffusion\(\); hideGoals\(\); void openRuns\(\)/);
  assert.equal((app.match(/hideRuns\(\)/g) || []).length, 8, 'every other place in the sidebar hides Runs, and so does opening a run’s chat');
  for (const call of ['runsProjects', 'runsList', 'runsFigure', 'runsAnnotate', 'runsRemove']) assert.match(preload, new RegExp(`${call}: `));
});

test('compare: the side-by-side rows, what can be drawn, and the three charts’ geometry', async () => {
  const { CHART, MAX_COMPARE, SERIES, barGeometry, chartable, compareRows, lineGeometry, nearestStep, niceTicks, scatterGeometry } = await import('../src/runs-logic.js');
  assert.equal(MAX_COMPARE, 8); assert.equal(new Set(SERIES).size, 8);
  const runs = [
    { id: 'R1', params: { lr: 0.001, batch: 64, opt: 'adam' }, metrics: { loss: { value: 0.52, steps: [[0, 2], [100, 0.52]] }, acc: { value: 88, unit: '%' } } },
    { id: 'R2', params: { lr: 0.0003, batch: 64, opt: 'adam' }, metrics: { loss: { value: 0.41, steps: [[0, 2.1], [50, 1], [100, 0.41]] } } },
    { id: 'R3', params: { lr: 0.01, batch: 64 }, metrics: { loss: { value: -0.2 } } },
  ];
  const rows = compareRows(runs);
  assert.deepEqual(rows.params.map(r => [r.name, r.differs]), [['lr', true], ['batch', false], ['opt', true]], 'a parameter one run lacks differs');
  assert.deepEqual(rows.metrics.map(r => [r.name, r.unit, r.values]), [['loss', null, [0.52, 0.41, -0.2]], ['acc', '%', [88, undefined, undefined]]]);
  assert.deepEqual(chartable(runs), { metrics: ['loss', 'acc'], stepped: ['loss'], params: ['lr'] }, 'batch is the same everywhere, opt isn’t a number');
  assert.deepEqual(niceTicks(0.2, 0.5).ticks, [0.2, 0.3, 0.4, 0.5]);
  assert.deepEqual(niceTicks(3, 3).ticks.length > 1, true, 'one value still gets an axis');
  // Bars from zero, a negative one below it, one slot per run in the comparison's order.
  const bars = barGeometry(runs, 'loss');
  assert.deepEqual(bars.bars.map(b => [b.id, b.series]), [['R1', 0], ['R2', 1], ['R3', 2]]);
  const [r1, , r3] = bars.bars;
  assert.ok(r1.y + r1.height <= bars.zero + 0.01 && r3.y >= bars.zero - 0.01, 'up from the baseline, and down from it');
  assert.ok(bars.ticks.some(t => t.value === 0));
  assert.deepEqual(barGeometry(runs, 'acc').bars.map(b => b.id), ['R1'], 'a run without the metric has no bar');
  // A learning rate across two orders of magnitude goes on a log axis; close points share a label.
  const points = scatterGeometry([...runs, { id: 'R4', params: { lr: 0.0003 }, metrics: { loss: { value: 0.41 } } }], 'lr', 'loss');
  assert.equal(points.log, true);
  assert.deepEqual(points.xTicks.map(t => t.value), [1e-4, 1e-3, 1e-2]);
  assert.ok(points.labels.some(l => l.ids.join() === 'R2,R4'));
  assert.equal(scatterGeometry(runs.map((r, i) => ({ ...r, params: { lr: i + 1 } })), 'lr', 'loss').log, false);
  // Lines only for runs with steps; the crosshair reads the nearest step.
  const lines = lineGeometry(runs, 'loss');
  assert.deepEqual(lines.lines.map(l => [l.id, l.points.length]), [['R1', 2], ['R2', 3]]);
  assert.match(lines.lines[0].d, /^M\d+(\.\d)? \d+(\.\d)? L/);
  assert.equal(nearestStep(lines.lines[1].points, 60).step, 50);
  assert.ok(lines.lines.every(l => l.points.every(p => p.x >= CHART.left && p.x <= CHART.w - CHART.right && p.y >= CHART.top && p.y <= CHART.h - CHART.bottom)), 'every point inside the plot');
});
