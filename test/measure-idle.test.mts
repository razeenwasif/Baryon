// The efficiency audit's measuring script (scripts/measure-idle.mjs): reading ps and footprint, naming Fairy's
// processes, and summing a window's CPU, memory and helper starts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, compareText, cpuSeconds, family, footprintMB, parsePs, summarise, tableText } from '../scripts/measure-idle.mjs';

const APP = '/Users/me/Applications/Fairy.app/Contents';
const ps = (rows: Array<[number, number, string, string]>) => rows.map(([pid, ppid, time, args]) => `${String(pid).padStart(6)} ${String(ppid).padStart(5)} ${time.padStart(10)} ${args}`).join('\n');
const snapshot = (times: [string, string, string]) => parsePs(ps([
  [100, 1, times[0], `${APP}/MacOS/Fairy`],
  [101, 100, times[1], `${APP}/Frameworks/Fairy Helper.app/Contents/MacOS/Fairy Helper --type=gpu-process --user-data-dir=/x`],
  [102, 100, times[2], `${APP}/Frameworks/Fairy Helper (Renderer).app/Contents/MacOS/Fairy Helper (Renderer) --type=renderer --app-path=/x`],
  [103, 100, '0:00.10', `${APP}/Frameworks/Fairy Helper.app/Contents/MacOS/Fairy Helper --type=utility --utility-sub-type=network.mojom.NetworkService`],
  [104, 100, '0:04.12', `${APP}/Resources/app/native/bin/fairy-quiz-overlay`],
  [105, 100, '0:00.36', `${APP}/Resources/app/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/codex/codex app-server`],
  [200, 1, '9:59.00', '/Applications/Other.app/Contents/MacOS/Other'],
]));

test('ps times, rows and footprints are read', () => {
  assert.equal(cpuSeconds('1:05.22'), 65.22);
  assert.equal(cpuSeconds('2:01:05.50'), 7265.5);
  assert.equal(cpuSeconds('1-00:00:01'), 86401);
  assert.equal(cpuSeconds('nonsense'), 0);
  const rows = snapshot(['1:00.00', '0:42.00', '1:05.00']);
  assert.deepEqual(rows[0], { pid: 100, ppid: 1, cpu: 60, args: `${APP}/MacOS/Fairy` });
  assert.equal(family(rows, 100).length, 6, 'Fairy and its own processes, nobody else’s');
  assert.equal(footprintMB('Fairy [15370]: 64-bit    Footprint: 421 MB (16384 bytes per page)'), 421);
  assert.equal(footprintMB('Footprint: 1.5 GB'), 1536);
  assert.equal(footprintMB('Footprint: 512 KB'), 0.5);
  assert.equal(footprintMB('nothing'), null);
});

test('Fairy’s processes get the audit’s names', () => {
  const names = family(snapshot(['1:00.00', '0:42.00', '1:05.00']), 100).map(row => classify(row.args, row.pid === 100));
  assert.deepEqual(names, ['Main', 'GPU', 'Renderer', 'Network service', 'fairy-quiz-overlay', 'Codex server']);
  assert.equal(classify('/x/native/bin/fairy-screen --capture'), 'fairy-screen');
  assert.equal(classify('/x/Fairy Helper --type=utility --utility-sub-type=audio.mojom.AudioService'), 'Audio service');
});

test('a window’s CPU, share of a core, footprint and helper starts, and two side by side', () => {
  const start = family(snapshot(['1:00.00', '0:42.00', '1:05.00']), 100), end = family(snapshot(['1:06.00', '0:43.20', '1:06.80']), 100);
  const result = { label: 'covered-mains', at: 'then', seconds: 60, state: { front: 'Claude', idleAtStart: 69, power: 'AC Power', settings: { screenAwareness: 'on' } },
    ...summarise({ start, end, seconds: 60, main: 100, starts: { 'fairy-screen': 17, 'fairy-quiz-ocr': 3 }, footprints: { 100: [340, 436, 410], 101: [250] } }) };
  assert.deepEqual(result.rows.slice(0, 3).map(row => [row.name, row.cpu, row.share]), [['Main', 6, 10], ['Renderer', 1.8, 3], ['GPU', 1.2, 2]]);
  assert.deepEqual(result.rows[0].footprint, { min: 340, max: 436, last: 410 });
  assert.deepEqual(result.total, { cpu: 9, share: 15, footprint: 660 });
  assert.deepEqual(result.perMinute, { 'fairy-screen': 17, 'fairy-quiz-ocr': 3 });
  const text = tableText(result);
  assert.match(text, /^covered-mains: 60 s · Claude in front · idle 69 s at the start · AC Power\nsettings: screenAwareness on/);
  assert.match(text, /Main\s+6 s\s+10%\s+340–436 MB/);
  assert.match(text, /Total\s+9 s\s+15%\s+660 MB/);
  assert.match(text, /Helper starts: fairy-screen 17 \(17\/min\), fairy-quiz-ocr 3 \(3\/min\)/);
  const after = { ...result, label: 'after', at: 'now', rows: result.rows.map(row => row.name === 'Main' ? { ...row, share: 1.2, footprint: { ...row.footprint!, last: 250 } } : row), total: { cpu: 3, share: 5, footprint: 500 }, perMinute: { 'fairy-screen': 0 } };
  const compared = compareText(result, after);
  assert.match(compared, /Main\s+10% → 1\.2%\s+410 → 250 MB/);
  assert.match(compared, /Total\s+15% → 5%\s+660 → 500 MB/);
  assert.match(compared, /fairy-screen 17 → 0, fairy-quiz-ocr 3 → 0/);
});

test('a process that started during the window is marked new and counted from zero', () => {
  const start = family(snapshot(['1:00.00', '0:42.00', '1:05.00']), 100);
  const end = [...family(snapshot(['1:01.00', '0:42.00', '1:05.00']), 100), { pid: 106, ppid: 100, cpu: 2, args: '/x/native/bin/fairy-notes' }];
  const { rows } = summarise({ start, end, seconds: 10, main: 100 });
  assert.deepEqual(rows.find(row => row.name === 'fairy-notes'), { name: 'fairy-notes', pid: 106, cpu: 2, share: 20, new: true, footprint: null });
});
