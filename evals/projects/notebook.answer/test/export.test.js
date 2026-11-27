import test from 'node:test';
import assert from 'node:assert/strict';
import { toMarkdown } from '../src/export/markdown.js';
import { toCsv } from '../src/export/csv.js';
import { toHtml } from '../src/export/html.js';

const notes = [{ id: 7, title: 'A, B', tags: ['x'], body: 'Say "hi" <now>' }];
test('markdown', () => assert.equal(toMarkdown(notes), '## A, B\n\nSay "hi" <now>\n\nTags: x\n'));
test('csv', () => assert.equal(toCsv(notes), 'id,title,tags,body\n7,"A, B",x,"Say ""hi"" <now>"\n'));
test('html', () => assert.equal(toHtml(notes), '<main><article><h2>A, B</h2><p>Say &quot;hi&quot; &lt;now&gt;</p></article></main>'));
