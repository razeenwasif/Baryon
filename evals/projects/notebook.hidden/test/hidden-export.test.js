import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toMarkdown } from '../src/export/markdown.js';
import { toCsv } from '../src/export/csv.js';
import { toHtml } from '../src/export/html.js';
import { loadNotes } from '../src/notes.js';

const notes = [
  { id: 1, title: 'Plain', tags: ['a', 'b'], body: 'Hello' },
  { id: 2, title: 'Tricky, "quoted"', tags: [], body: "Line one\nLine two <b>&</b> it's" },
];
const root = fileURLToPath(new URL('..', import.meta.url)), cli = join(root, 'src/cli.js');

test('Markdown', () => {
  assert.equal(toMarkdown(notes), "## Plain\n\nHello\n\nTags: a, b\n\n## Tricky, \"quoted\"\n\nLine one\nLine two <b>&</b> it's\n");
});
test('CSV', () => {
  assert.equal(toCsv(notes), 'id,title,tags,body\n1,Plain,a;b,Hello\n2,"Tricky, ""quoted""",,"Line one\nLine two <b>&</b> it\'s"\n');
});
test('HTML', () => {
  assert.equal(toHtml(notes), '<main><article><h2>Plain</h2><p>Hello</p></article><article><h2>Tricky, &quot;quoted&quot;</h2><p>Line one\nLine two &lt;b&gt;&amp;&lt;/b&gt; it&#39;s</p></article></main>');
});
test('the command line prints, or writes to --out', () => {
  assert.equal(execFileSync(process.execPath, [cli, '--format', 'csv'], { cwd: root, encoding: 'utf8' }), toCsv(loadNotes()));
  const out = join(mkdtempSync(join(tmpdir(), 'notebook-')), 'notes.html');
  execFileSync(process.execPath, [cli, '--format', 'html', '--out', out], { cwd: root, encoding: 'utf8' });
  assert.equal(readFileSync(out, 'utf8'), toHtml(loadNotes()));
  assert.equal(execFileSync(process.execPath, [cli, '--format', 'md'], { cwd: root, encoding: 'utf8' }), toMarkdown(loadNotes()));
});
