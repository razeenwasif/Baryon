import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Script } from 'node:vm';
import { ArtifactStore, pagePolicy } from '../desktop/artifacts.mjs';
import { readJSON, writeJSON } from '../desktop/core.mjs';
import { buildPage, kindFiles, pagePrompt, parseSheet, parseWhiteboard } from '../desktop/page-agent.mjs';
import { sheetPage, whiteboardPage } from '../desktop/page-types.mjs';
import { addSheet, bookJSON, cleanBook, colIndex, colName, csvRows, displayValue, evaluateBook, filterTest, parseCSV, renameSheet, sheetCSV, shiftBook, typedValue, visibleRows } from '../desktop/page-kinds/sheet-core.mjs';
import { arrowEnds, cleanScene, indexItems, sceneBounds, sceneJSON, sceneSVG } from '../desktop/page-kinds/whiteboard-core.mjs';
import { changesPage, pageKind, requestMode, wantsPage } from '../src/chat-routing.js';

const shown = (book, sheet = 0) => { const values = evaluateBook(book, { today: '2026-11-11' }); return book.sheets[sheet].rows.map((row, r) => row.map((_, c) => displayValue(values.value(sheet, r, c)))); };
const grid = rows => cleanBook({ sheets: [{ name: 'S', rows }] });

test('sheet formulas follow Excel, with no eval', () => {
  const book = grid([
    ['Course', 'Date', 'Mark', 'Days'],
    ['Maths', '2026-12-01', 80, '=DAYS(B2,TODAY())'],
    ['Physics', '2026-11-20', 65, '=DAYS(B3,TODAY())'],
    ['Mean', null, '=AVERAGE(C2:C3)', '=IF(C4>=70,"pass","close")'],
    ['=-2^2', '=2+3*4', '=(2+3)*4', '=10%'],
    ['=COUNTIF(C2:C3,">70")', '=SUMIF(A2:A3,"P*",C2:C3)', '=VLOOKUP("Physics",A2:C3,3,FALSE)', '=INDEX(A2:A3,MATCH(65,C2:C3,0))'],
    ['=A1&" "&ROUND(-2.5)', '=ROUND(2.345,2)', '=MAX(C2:C3)', '=LEN("héllo")'],
    ['=1/0', '=IFERROR(A8,"none")', '=NOPE(1)', '="a"+1'],
    ['=Z99', '=SUM(A1:B1)', '=0.1+0.2', '=TRUE'],
  ]);
  assert.deepEqual(shown(book), [
    ['Course', 'Date', 'Mark', 'Days'],
    ['Maths', '2026-12-01', '80', '20'],
    ['Physics', '2026-11-20', '65', '9'],
    ['Mean', '', '72.5', 'pass'],
    ['4', '14', '20', '0.1'],
    ['1', '65', '65', 'Physics'],
    ['Course -3', '2.35', '80', '5'],
    ['#DIV/0!', 'none', '#NAME?', '#VALUE!'],
    ['0', '0', '0.3', 'TRUE'],
  ]);
});

test('broken formulas show an error instead of running anything', () => {
  const book = grid([['=A2', '=B1+1', '=SUM(', '=constructor', '=process.exit()', '="unclosed', "=Nope!A1", '=A1:B'], ['=A1']]);
  assert.deepEqual(shown(book)[0], ['#CYCLE!', '#CYCLE!', '#ERROR!', '#NAME?', '#NAME?', '#ERROR!', '#REF!', '#ERROR!']);
});

test('formulas reach other sheets by name, quoted when it has spaces', () => {
  const book = cleanBook({ sheets: [{ name: 'Exam dates', rows: [['x', 3]] }, { name: 'Sum', rows: [["='Exam dates'!B1*2", '=Sum!A1+1']] }] });
  assert.deepEqual(shown(book, 1), [['6', '7']]);
});

test('a long chain of running totals works out', () => {
  const rows = [['n', 'total'], [1, '=A2']];
  for (let r = 3; r <= 3000; r++) rows.push([1, `=B${r - 1}+A${r}`]);
  const book = grid(rows), values = evaluateBook(book);
  for (let r = 0; r < rows.length; r++) values.value(0, r, 1);
  assert.equal(values.value(0, 2999, 1), 2999);
});

test('inserting and deleting rows and columns keeps formulas on the same cells', () => {
  const book = cleanBook({ sheets: [{ name: 'A', rows: [[1, 2, 3], [4, 5, 6], ['=SUM(A1:C2)', '=B2', '=$C$1']] }, { name: 'B', rows: [['=A!B2*2']] }] });
  shiftBook(book, 0, 'row', 1, 1);
  assert.deepEqual(book.sheets[0].rows[3], ['=SUM(A1:C3)', '=B3', '=$C$1']);
  assert.deepEqual(book.sheets[1].rows[0], ['=A!B3*2']);
  shiftBook(book, 0, 'col', 1, -1);
  assert.deepEqual(book.sheets[0].rows[3], ['=SUM(A1:B3)', '=$B$1']);
  assert.equal(shiftBook(cleanBook({ sheets: [{ name: 'A', rows: [[1, 2, '=B1']] }] }), 0, 'col', 1, -1).sheets[0].rows[0][1], '=#REF!');
  assert.deepEqual(book.sheets[1].rows[0], ['=#REF!*2']);
  assert.deepEqual(shown(book, 1), [['#REF!']]);
  assert.ok(renameSheet(book, 0, 'Exam dates'));
  shiftBook(book, 0, 'row', 0, 1);
  assert.deepEqual(book.sheets[0].rows[4], ['=SUM(A2:B4)', '=$B$2']);
  assert.equal(renameSheet(book, 1, 'exam DATES'), false, 'two sheets can’t share a name');
  const named = cleanBook({ sheets: [{ name: 'A', rows: [[2]] }, { name: 'B', rows: [['=A!A1']] }] });
  renameSheet(named, 0, 'Exam dates');
  assert.deepEqual(named.sheets[1].rows[0], ["='Exam dates'!A1"]);
});

test('sorting and filtering change only what’s shown, with the headings kept on top', () => {
  const sheet = { rows: [['Name', 'Mark'], ['b', 50], ['a', 90], ['c', null], ['d', 70]], sort: { col: 1, desc: true }, filters: { 1: '>= 60' } };
  const value = (r, c) => sheet.rows[r]?.[c] ?? null;
  assert.deepEqual(visibleRows(sheet, value), [0, 2, 4]);
  delete sheet.filters;
  assert.deepEqual(visibleRows(sheet, value), [0, 2, 4, 1, 3], 'blanks sort last');
  assert.equal(filterTest('ma')('Maths'), true);
  assert.equal(filterTest('<= 2026-12-01')('2026-11-24'), true);
  assert.equal(filterTest('<> done')('done'), false);
});

test('a sheet is cleaned to its limits and written one row to a line', () => {
  const book = cleanBook({ sheets: [{ name: "Bad!'name", rows: [[1, { formula: '=A1' }, Infinity, '', null], []], sort: { col: 1, desc: true }, filters: { 0: 'x', 999: 'y' } }, { name: 'bad name' }, ...Array(30).fill({ rows: [] })] });
  assert.equal(book.sheets.length, 20);
  assert.equal(book.sheets[0].name, 'Badname');
  assert.equal(book.sheets[1].name, 'bad name');
  assert.deepEqual(book.sheets[0].rows, [[1, '=A1']]);
  assert.deepEqual(book.sheets[0].filters, { 0: 'x' });
  assert.deepEqual(cleanBook([[1, 2]]).sheets[0].rows, [[1, 2]], 'a bare grid is one sheet');
  assert.deepEqual(JSON.parse(bookJSON(book)), book);
  assert.match(bookJSON(grid([['a'], ['b']])), /\n {2}\["a"\],\n {2}\["b"\]\n/);
  assert.equal(colName(0), 'A'); assert.equal(colName(27), 'AB'); assert.equal(colIndex('AB'), 27);
  assert.equal(typedValue('12.5'), 12.5); assert.equal(typedValue('true'), true); assert.equal(typedValue(' '), null); assert.equal(typedValue('=A1'), '=A1'); assert.equal(typedValue('12 apples'), '12 apples');
});

test('CSV goes in as values and comes out without anything a spreadsheet app would run', () => {
  assert.deepEqual(parseCSV('a,"b, c","say ""hi"""\r\n1,2\n'), [['a', 'b, c', 'say "hi"'], ['1', '2']]);
  assert.deepEqual(parseCSV('a;b\n1;2'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCSV('a\tb,c\n1\t2'), [['a', 'b,c'], ['1', '2']]);
  const rows = csvRows('name,mark,note\nAmy,90,=HYPERLINK("x")\n');
  assert.deepEqual(rows, [['name', 'mark', 'note'], ['Amy', 90, '\'=HYPERLINK("x")']]);
  const book = { sheets: [] };
  addSheet(book, 'marks', rows);
  assert.deepEqual(shown(book), [['name', 'mark', 'note'], ['Amy', '90', '=HYPERLINK("x")']], 'a formula from a file stays text');
  const out = sheetCSV(cleanBook({ sheets: [{ name: 'S', rows: [['Total', '=1+2', '-cmd', 'a, "b"', -4]] }] }));
  assert.equal(out, 'Total,3,\'-cmd,"a, ""b""",-4\r\n');
  assert.equal(addSheet(book, 'marks', [[1]]), 'marks 2');
});

test('a whiteboard is cleaned, and loose items are laid out', () => {
  const scene = cleanScene({ items: [
    { id: 'a', type: 'sticky', x: 0, y: 0, text: 'One', color: 'Grey' },
    { id: 'a', type: 'box', x: '300', y: 0, w: 99999, text: 'Two' },
    { id: 'c', type: 'circle', text: 'No position' },
    { id: 'x', type: 'arrow', from: 'a', to: 'missing' },
    { id: 'y', type: 'connector', from: 'a', to: 'c', label: 'goes' },
    { id: 'z', type: 'line', points: [[0, 0], [10, 10]] },
    { type: 'text', text: '  ' }, { type: 'unicorn' }, null,
  ] });
  assert.deepEqual(scene.items.map(item => [item.id, item.type]), [['a', 'note'], ['i1', 'rect'], ['c', 'ellipse'], ['y', 'arrow'], ['z', 'draw']]);
  assert.equal(scene.items[0].color, 'gray');
  assert.equal(scene.items[1].w, 4000);
  assert.ok(scene.items[2].y > 150, 'placed below the rest');
  const [[x1], [x2]] = arrowEnds(scene.items[3], indexItems(scene));
  assert.ok(Number.isFinite(x1) && Number.isFinite(x2));
  assert.equal(cleanScene({ items: Array(3000).fill({ type: 'note', x: 0, y: 0 }) }).items.length, 2000);
  assert.deepEqual(JSON.parse(sceneJSON(scene)), scene);
  assert.ok(sceneBounds(scene).w > 0);
});

test('a whiteboard exports as SVG with its words as text, never markup', () => {
  const svg = sceneSVG(cleanScene({ items: [{ type: 'note', x: 0, y: 0, text: '<b>hi</b> & "q"' }, { id: 'q"><x', type: 'rect', x: 300, y: 0, text: 'B' }] }));
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="-48 -48 /);
  assert.doesNotMatch(svg, /<script|<x/);
  assert.match(svg, /&lt;b&gt;hi&lt;\/b&gt; &amp; &quot;q&quot;/);
});

test('the model’s whiteboard and sheet come back as data, in a page of Fairy’s own', () => {
  const board = buildPage('whiteboard', 'TITLE: Plan board\nABOUT: The plan.\n```json\n{"items":[{"id":"n","type":"note","x":0,"y":0,"text":"</script><script>alert(1)</script>"}]}\n```');
  assert.equal(board.title, 'Plan board');
  assert.deepEqual(Object.keys(board.files).sort(), ['index.html', 'scene.json']);
  assert.doesNotMatch(board.files['index.html'], /<\/script><script>alert/);
  assert.match(board.files['index.html'], /\\u003c\/script>/);
  const sheet = buildPage('sheet', 'TITLE: Exams\nABOUT: Dates.\nHere you go: {"sheets":[{"name":"Exams","rows":[["Course","Date"],["Maths","2026-12-01"]]}]}');
  assert.equal(sheet.title, 'Exams');
  assert.match(sheet.files['sheet.json'], /\["Maths","2026-12-01"\]/);
  assert.throws(() => parseWhiteboard('TITLE: x\n```json\n{"items":[]}\n```'), /didn’t return a whiteboard/);
  assert.throws(() => parseSheet('No JSON here'), /didn’t return a sheet/);
  assert.throws(() => kindFiles('page', {}, 'x'), /Only whiteboards, sheets and interactive UIs/);
  const prompt = pagePrompt('add a column for marks', { kind: 'sheet', title: 'Exams', text: sheet.files['sheet.json'] });
  assert.match(prompt, /```json\n\{"sheets"/);
  assert.match(prompt, /COUNTIF/);
});

test('whiteboard and sheet pages are complete scripts, with the core inlined', () => {
  for (const html of [whiteboardPage(cleanScene({ items: [{ type: 'note', x: 0, y: 0 }] }), 'B'), sheetPage(grid([['a']]), 'S')]) {
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
    assert.equal(scripts.length, 1);
    assert.doesNotMatch(scripts[0], /^export /m);
    assert.doesNotThrow(() => new Script(scripts[0]));
    assert.match(html, /<script type="application\/json" id="fairy-data">/);
    assert.doesNotMatch(html, /https?:\/\/(?!www\.w3\.org)/, 'nothing remote');
  }
});

test('whiteboards and sheets get no network, and keep their data as the source for changes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fairy-kinds-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new ArtifactStore({ dir: root, readJSON, writeJSON, trash: async () => {}, id: () => 'kind-1' });
  await store.load();
  const built = buildPage('sheet', '```json\n{"sheets":[{"name":"S","rows":[["a",1]]}]}\n```');
  await store.publish({ kind: 'sheet', title: 'S', files: built.files, entry: built.entry });
  const { headers } = await store.serve('/kind-1/1/index.html');
  assert.equal(headers['content-security-policy'], pagePolicy('kind-1', '1', { strict: true }));
  assert.match(headers['content-security-policy'], /connect-src 'none'/);
  const source = await store.source('kind-1');
  assert.equal(source.kind, 'sheet');
  assert.deepEqual(JSON.parse(source.text).sheets[0].rows, [['a', 1]]);
  await store.publish({ id: 'kind-1', kind: 'sheet', title: 'S', files: kindFiles('sheet', { sheets: [{ name: 'S', rows: [['a', 1, 'marks']] }] }, 'S'), entry: 'index.html' });
  assert.deepEqual(store.state().items[0].versions.map(version => version.seq), [1, 2]);
  assert.equal(store.state().items[0].kind, 'sheet');
});

test('asking for a whiteboard or a sheet picks that kind, and other sheets stay other things', () => {
  for (const [text, kind] of [['sketch the architecture on a whiteboard', 'whiteboard'], ['make a mind map of photosynthesis', 'whiteboard'], ['brainstorm essay ideas with sticky notes', 'whiteboard'], ['make a flowchart of the login process', 'whiteboard'],
    ['put these results in a sheet', 'sheet'], ['make a sheet of my exam dates', 'sheet'], ['make a spreadsheet tracking my spending', 'sheet'], ['track my workouts in a sheet', 'sheet']]) {
    assert.equal(pageKind(text), kind, text);
    assert.equal(requestMode(text, 'chat', {}, []), 'page', text);
  }
  for (const text of ['make me a cheat sheet for calculus', 'I spilled coffee on a sheet of paper', 'what is a whiteboard?', 'fill in the worksheet']) assert.equal(wantsPage(text), false, text);
  assert.equal(requestMode('open my google sheet', 'chat', {}, []), 'drive');
  assert.equal(pageKind('make a slide deck from this sheet'), 'slides');
  assert.equal(requestMode('add a column for marks', 'chat', {}, [{ mode: 'page' }]), 'page');
  assert.equal(changesPage('add a column for marks', 'sheet'), true);
  assert.equal(changesPage('Make a sheet of my exam dates', 'whiteboard'), false, 'a new kind is a new page');
  assert.equal(changesPage('put these results in a sheet', 'sheet'), true);
  assert.equal(changesPage('make it blue', 'whiteboard'), true);
});
