import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { formatInspectSummary, inspectDataFile, listDataFiles, parseDelimited } from '../desktop/data-inspect.mjs';
import { WorkTools } from '../desktop/work-tools.mjs';

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

test('parseDelimited handles quoted commas, doubled quotes, and embedded newlines', () => {
  const csv = 'name,note,score\n"Ada, Lovelace","She said ""hello""\nworld",98.5\nBob,plain,72\n';
  const { rows, truncated } = parseDelimited(csv, ',');
  assert.equal(truncated, false);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1], ['Ada, Lovelace', 'She said "hello"\nworld', '98.5']);
});

test('inspectDataFile profiles CSV, TSV, JSON, JSONL, and SQLite with stats, histograms, and samples', async t => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'fairy-data-')));
  t.after(() => rm(dir, { recursive: true, force: true }));

  // CSV with missing values, ints, floats, booleans, dates, and categorical strings
  const csvPath = join(dir, 'experiments.csv');
  await writeFile(csvPath, [
    'id,model,acc,ok,date',
    '1,mlp,0.85,true,2026-11-20',
    '2,rf,0.88,true,2026-11-21',
    '3,mlp,0.87,false,2026-11-21',
    '4,svm,,false,2026-11-21',
  ].join('\n') + '\n');

  const csvProf = await inspectDataFile(csvPath, { relPath: 'experiments.csv', sampleRows: 3 });
  assert.equal(csvProf.format, 'csv');
  assert.equal(csvProf.rows, 4);
  assert.equal(csvProf.columnCount, 5);
  assert.equal(csvProf.sample.length, 3);
  assert.deepEqual(csvProf.numericColumns, ['id', 'acc']);
  const acc = csvProf.columns.find(c => c.name === 'acc');
  assert.equal(acc.type, 'number');
  assert.equal(acc.missing, 1);
  assert.equal(acc.missingPct, 25);
  assert.equal(acc.min, 0.85);
  assert.equal(acc.max, 0.88);
  assert.ok(acc.histogram.length >= 1);
  assert.equal(csvProf.columns.find(c => c.name === 'id').type, 'integer');
  assert.equal(csvProf.columns.find(c => c.name === 'ok').type, 'boolean');
  assert.equal(csvProf.columns.find(c => c.name === 'date').type, 'date');
  assert.equal(csvProf.columns.find(c => c.name === 'model').topValues[0].value, 'mlp');
  assert.equal(csvProf.columns.find(c => c.name === 'model').topValues[0].count, 2);

  // JSON wrapper object with nested array
  const jsonPath = join(dir, 'metrics.json');
  await writeFile(jsonPath, JSON.stringify({ meta: 'v1', records: [{ step: 1, loss: 1.2 }, { step: 2, loss: 0.6 }] }));
  const jsonProf = await inspectDataFile(jsonPath, { relPath: 'metrics.json' });
  assert.equal(jsonProf.format, 'json');
  assert.equal(jsonProf.rows, 2);
  assert.equal(jsonProf.columns.find(c => c.name === 'loss').mean, 0.9);

  // JSONL
  const jsonlPath = join(dir, 'events.jsonl');
  await writeFile(jsonlPath, '{"k":"a","v":10}\n{"k":"b","v":20}\n{"k":"a","v":30}\n');
  const jsonlProf = await inspectDataFile(jsonlPath, { relPath: 'events.jsonl' });
  assert.equal(jsonlProf.format, 'jsonl');
  assert.equal(jsonlProf.rows, 3);
  assert.equal(jsonlProf.columns.find(c => c.name === 'v').median, 20);

  // SQLite multi-table via stdlib python3 sqlite3
  const dbPath = join(dir, 'results.sqlite');
  await execFileAsync('python3', ['-c', `
import sqlite3, sys
conn = sqlite3.connect(sys.argv[1])
conn.execute("CREATE TABLE alpha (id INTEGER, score REAL)")
conn.execute("CREATE TABLE beta (name TEXT, count INTEGER)")
conn.executemany("INSERT INTO alpha VALUES (?, ?)", [(1, 0.5), (2, 0.9)])
conn.executemany("INSERT INTO beta VALUES (?, ?)", [("x", 3), ("y", 7)])
conn.commit()
`, dbPath]);
  const dbProf1 = await inspectDataFile(dbPath, { relPath: 'results.sqlite' });
  assert.equal(dbProf1.format, 'sqlite');
  assert.deepEqual(dbProf1.tables, ['alpha', 'beta']);
  assert.equal(dbProf1.table, 'alpha');
  assert.equal(dbProf1.rows, 2);
  const dbProf2 = await inspectDataFile(dbPath, { relPath: 'results.sqlite', table: 'beta' });
  assert.equal(dbProf2.table, 'beta');
  assert.equal(dbProf2.columns.find(c => c.name === 'count').mean, 5);

  const summary = formatInspectSummary(csvProf);
  assert.match(summary, /experiments\.csv \(CSV/);
  assert.match(summary, /acc \(number, 1 missing/);
  assert.match(summary, /Sample \(first 3 rows/);
});

test('listDataFiles skips secrets and dependency directories, and WorkTools inspect_data enforces path confinement & schema', async t => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'fairy-data-wt-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'node_modules', 'pkg'), { recursive: true });
  await mkdir(join(dir, 'data'), { recursive: true });
  await writeFile(join(dir, 'data', 'train.csv'), 'x,y\n1,2\n3,4\n');
  await writeFile(join(dir, 'secrets.json'), '{"api_key":"nope"}');
  await writeFile(join(dir, 'node_modules', 'pkg', 'big.json'), '[1,2,3]');

  const listed = await listDataFiles(dir);
  assert.deepEqual(listed.map(f => f.path), ['data/train.csv']);

  const tools = new WorkTools({ root: dir, permission: 'auto', sandboxed: true, runCommand: async () => ({ exitCode: 0, output: '' }), approve: async () => 'allow' });
  const okRes = await tools.handle({ tool: 'inspect_data', arguments: { path: 'data/train.csv', sample_rows: 2 } });
  assert.equal(okRes.outcome, 'ok');
  assert.match(okRes.contentItems[0].text, /2 rows × 2 columns/);

  // Secret file refused
  const secretRes = await tools.handle({ tool: 'inspect_data', arguments: { path: 'secrets.json' } });
  assert.equal(secretRes.outcome, 'refused');

  // Path traversal refused
  const escapeRes = await tools.handle({ tool: 'inspect_data', arguments: { path: '../outside.csv' } });
  assert.equal(escapeRes.outcome, 'refused');

  // Part A argument schema enforced (sample_rows out of bounds & extra property)
  const badRes = await tools.handle({ tool: 'inspect_data', arguments: { path: 'data/train.csv', sample_rows: 999 } });
  assert.equal(badRes.outcome, 'invalid');
});

test('main.cjs, preload.cjs, remote-channels.mjs, and src/app.js wire Data pane cleanly', async () => {
  const [main, preload, remote, app] = await Promise.all([
    readFile(join(repoRoot, 'desktop/main.cjs'), 'utf8'),
    readFile(join(repoRoot, 'desktop/preload.cjs'), 'utf8'),
    readFile(join(repoRoot, 'desktop/remote-channels.mjs'), 'utf8'),
    readFile(join(repoRoot, 'src/app.js'), 'utf8'),
  ]);
  assert.match(main, /handle\('data-files'/);
  assert.match(main, /handle\('data-inspect'/);
  assert.match(preload, /dataFiles:/);
  assert.match(preload, /dataInspect:/);
  assert.match(remote, /'data-files', 'data-inspect'/);
  assert.match(app, /dataPane/);
  assert.match(app, /name: 'data'/);
});
