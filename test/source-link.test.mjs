import test from 'node:test';
import assert from 'node:assert/strict';
import { describeSource, isPdf, lineLink, pageLink } from '../src/source-link.js';
import { ZOOMS, pageSize } from '../src/pdf-layout.js';
import { parseSourceLink, sourceLink } from '../desktop/local-files.mjs';

test('a citation link names its file and where in it', () => {
  const root = '123e4567-e89b-12d3-a456-426614174000';
  assert.deepEqual(describeSource(sourceLink(root, 'COMP2310/Notes on sync — week 6.md', 42)), { link: sourceLink(root, 'COMP2310/Notes on sync — week 6.md', 42), path: 'COMP2310/Notes on sync — week 6.md', name: 'Notes on sync — week 6.md', where: 'Line 42', page: null, line: 42, from: 42, to: 42 });
  const page = describeSource(sourceLink(root, 'Books/Garbage Collection Handbook.pdf', 20, true));
  assert.equal(page.where, 'Page 20'); assert.equal(page.page, 20); assert.equal(page.name, 'Garbage Collection Handbook.pdf');
  const ranged = describeSource(sourceLink(root, 'COMP2310/sync.md', 1), 'COMP2310/sync.md, lines 7-10');
  assert.deepEqual([ranged.from, ranged.to, ranged.where], [7, 10, 'Lines 7–10'], 'the range named in the link text wins');
  assert.equal(describeSource(sourceLink(root, 'a.md', 3), 'a.md, line 12').where, 'Line 12');
  assert.equal(describeSource(sourceLink(root, 'b.pdf', 4, true), 'b.pdf, lines 1-2').where, 'Page 4', 'pages ignore line ranges');
  assert.equal(describeSource('https://example.com/notes.md'), null);
  assert.equal(describeSource('not a link'), null);
});

test('a PDF is opened a page at a time, and read from a page on', () => {
  const root = '123e4567-e89b-12d3-a456-426614174000', book = 'Books/Garbage Collection Handbook.pdf';
  assert.equal(isPdf(book), true); assert.equal(isPdf('notes/a.md'), false); assert.equal(isPdf('scan.PDF'), true);
  const cited = sourceLink(root, book, 20, true);
  assert.deepEqual(parseSourceLink(pageLink(cited, 21)), { rootId: root, path: book, start: 21, page: true });
  assert.deepEqual(parseSourceLink(lineLink(cited, 21)), { rootId: root, path: book, start: 21, page: false });
  assert.equal(pageLink(sourceLink(root, book, 1), 0), sourceLink(root, book, 1, true), 'pages start at 1');
});

test('a page is drawn sharp enough for its width on screen, within the helper’s limits', () => {
  assert.deepEqual(ZOOMS.slice(0, 3), [0.5, 0.75, 1]);
  assert.equal(pageSize(500, 1, 2, 1.3), 1400, 'an upright page 500 wide on a Retina screen: 1000 across, 1300 tall');
  assert.equal(pageSize(900, 1.5, 2, 1.3), 3200, 'zoomed in, as sharp as the helper draws');
  assert.equal(pageSize(800, 1, 2, 0.7), 1600, 'a wide page needs only its width');
  assert.equal(pageSize(1400, 2, 2, 1.4), 3200, 'never more than the helper draws');
  assert.equal(pageSize(0, 1, 1), 1200, 'never less than a readable page');
});
