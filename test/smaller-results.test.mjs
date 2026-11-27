// Token use, step 2: smaller tool results, keeping what matters in them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkTools, shortOutput, COMMAND_OUTPUT } from '../desktop/work-tools.mjs';

const textOf = result => result.contentItems.map(item => item.text).join('');

test('short command output is untouched', () => {
  const text = 'ok 1 - adds\nok 2 - subtracts\n# pass 2\n';
  assert.equal(shortOutput(text), text);
  assert.equal(shortOutput('x'.repeat(COMMAND_OUTPUT.whole)), 'x'.repeat(COMMAND_OUTPUT.whole));
  assert.equal(shortOutput(undefined), '');
});

test('long command output keeps its start, its end and the error lines from its middle', () => {
  const passing = Array.from({ length: 2000 }, (_, i) => `ok ${i + 1} - case ${i + 1}`);
  passing.splice(1000, 0, 'not ok 1001 - totals add quantities', '  expected: 30', '  actual: 10', '    at total (src/cart.js:12:9)');
  passing.splice(1500, 0, 'not ok 1001 - totals add quantities');
  const text = `${passing.join('\n')}\n# pass 1999\n# fail 1\n`, short = shortOutput(text);
  assert.ok(short.length < COMMAND_OUTPUT.head + COMMAND_OUTPUT.tail + COMMAND_OUTPUT.errors + 300, String(short.length));
  assert.ok(short.startsWith(text.slice(0, COMMAND_OUTPUT.head)));
  assert.ok(short.endsWith('# pass 1999\n# fail 1\n'));
  for (const line of ['not ok 1001 - totals add quantities', '  expected: 30', '    at total (src/cart.js:12:9)']) assert.ok(short.includes(line), line);
  assert.equal(short.split('not ok 1001 - totals add quantities').length, 2, 'a repeated error line is kept once');
  assert.match(short, /characters left out; from them, the lines that look like errors:/);
  // With no errors in the middle, it says only what was left out.
  assert.match(shortOutput('a'.repeat(20000)), /^a{3000}\n… 11000 characters left out \(narrow the command, with grep or tail, to see more\)\na{6000}$/);
  // Error lines from the middle are capped too, and a very long one is cut.
  const noisy = shortOutput(`${'h'.repeat(3000)}\n${Array.from({ length: 400 }, (_, i) => `Error ${i}: ${'e'.repeat(400)}`).join('\n')}\n${'t'.repeat(6000)}`);
  assert.ok(noisy.length < 13000, String(noisy.length));
});

test('searches stop at 60 matches and listings at 200 entries, and say so', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'fairy-results-')));
  await writeFile(join(root, 'many.txt'), Array.from({ length: 100 }, (_, i) => `needle ${i}`).join('\n'));
  await mkdir(join(root, 'dir'));
  for (let i = 0; i < 230; i++) await writeFile(join(root, 'dir', `f${String(i).padStart(3, '0')}.txt`), '');
  const tools = new WorkTools({ root, runCommand: async () => ({}) });
  const found = textOf(await tools.handle({ tool: 'search_files', arguments: { query: 'needle' } }));
  assert.equal(found.split('\n').filter(line => line.includes(': needle')).length, 60);
  assert.match(found, /stopped at 60 matches; narrow the query or the path/);
  assert.doesNotMatch(textOf(await tools.handle({ tool: 'search_files', arguments: { query: 'needle 7' } })), /stopped at/);
  const listed = textOf(await tools.handle({ tool: 'list_files', arguments: { path: 'dir' } }));
  assert.equal(listed.split('\n').filter(line => line.endsWith('.txt')).length, 200);
  assert.match(listed, /… and 30 more/);
});
