// Up to three panes beside the chat, side by side or stacked (src/pane-layout.js, src/side-pane.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cleanLayout, leaves, remove, replace, resize, sideBySide, single, split, turn } from '../src/pane-layout.js';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

test('panes open beside or below the one you’re in, three at most, each once', () => {
  let layout = single('artifacts');
  layout = split(layout, 'artifacts', 'terminal', 'row')!;
  assert.deepEqual(leaves(layout), ['artifacts', 'terminal']);
  assert.equal(layout.dir, 'row');
  assert.ok(sideBySide(layout));
  layout = split(layout, 'terminal', 'simulator', 'col')!;
  assert.deepEqual(leaves(layout), ['artifacts', 'terminal', 'simulator']);
  assert.deepEqual(layout.items[1], { dir: 'col', items: [{ tab: 'terminal' }, { tab: 'simulator' }], sizes: [0.5, 0.5] }, 'the terminal and the Simulator stacked, beside Pages');
  assert.deepEqual(split(layout, 'artifacts', 'browser', 'row'), layout, 'a fourth isn’t added');
  assert.deepEqual(split(single('terminal'), 'terminal', 'terminal', 'row'), single('terminal'), 'nor one already open');
  const stacked = split(single('artifacts'), 'artifacts', 'terminal', 'col')!;
  assert.equal(stacked.dir, 'col');
  assert.ok(!sideBySide(stacked));
});

test('closing, replacing, resizing and turning', () => {
  let layout = split(split(single('artifacts'), 'artifacts', 'terminal', 'row'), 'terminal', 'simulator', 'col')!;
  assert.deepEqual(leaves(replace(layout, 'artifacts', 'browser')), ['browser', 'terminal', 'simulator']);
  assert.deepEqual(leaves(replace(layout, 'artifacts', 'simulator')), ['simulator', 'terminal', 'artifacts'], 'one already open swaps places');
  layout = remove(layout, 'terminal')!;
  assert.deepEqual(layout, { dir: 'row', items: [{ tab: 'artifacts' }, { tab: 'simulator' }], sizes: [0.5, 0.5] }, 'a stack of one becomes that pane');
  layout = resize(layout, [], 0, 0.2);
  assert.deepEqual(layout.sizes, [0.7, 0.3]);
  assert.deepEqual(resize(layout, [], 0, 0.9).sizes, [0.85, 0.15], 'never smaller than 15%');
  assert.equal(turn(layout, []).dir, 'col');
  assert.equal(remove(remove(layout, 'artifacts'), 'simulator'), null, 'the last one closes the panel');
});

test('a saved layout is cleaned: known panes only, once each, three at most, nested once', () => {
  const known = (tab: string) => ['artifacts', 'terminal', 'simulator', 'browser'].includes(tab);
  assert.equal(cleanLayout(null), null);
  assert.equal(cleanLayout({ dir: 'row', items: [{ tab: 'nope' }] }, known), null);
  assert.deepEqual(cleanLayout({ tab: 'terminal' }, known), single('terminal'));
  const messy = { dir: 'sideways', items: [{ tab: 'terminal' }, { tab: 'terminal' }, { dir: 'col', items: [{ tab: 'simulator' }, { tab: 'browser' }, { tab: 'artifacts' }], sizes: [5, 5, 5] }, { tab: 'artifacts' }], sizes: [1, 'x', 2] };
  const clean = cleanLayout(messy, known)!;
  assert.deepEqual(leaves(clean), ['terminal', 'simulator', 'browser']);
  assert.equal(clean.dir, 'row');
  assert.ok(Math.abs(clean.sizes.reduce((sum, n) => sum + n, 0) - 1) < 0.01);
  const deep = cleanLayout({ dir: 'row', items: [{ dir: 'col', items: [{ dir: 'row', items: [{ tab: 'terminal' }] }, { tab: 'simulator' }] }] }, known);
  assert.deepEqual(leaves(deep), ['simulator'], 'nothing nested deeper than one group');
});

test('the side panel offers ⌘-click, ⇧⌘-click and a right-click menu, and each chat saves its layout; ⌘B folds the sidebar', async () => {
  const pane = await read('../src/side-pane.ts'), sessions = await read('../desktop/sessions.mts'), app = await read('../src/app.ts');
  assert.match(pane, /if \(open && \(event\.metaKey \|\| event\.ctrlKey\)\) openBeside\(entry\.id, event\.shiftKey \? 'col' : 'row'\);/);
  assert.match(pane, /tab\.oncontextmenu = event => \{ event\.preventDefault\(\); openMenu\(entry, tab, selected\); \};/);
  assert.match(pane, /line\.addEventListener\('dblclick', \(\) => \{ (?:if \(!layout\) return; )?layout = turn\(layout, path\); changed\(\[\]\); \}\);/);
  assert.match(sessions, /layout: cleanLayout\((?:value|v)\?\.layout\)/);
  assert.match(app, /event\.metaKey && !event\.ctrlKey && !event\.altKey && !event\.shiftKey && event\.key\.toLowerCase\(\) === 'b' && !floating\) \{ event\.preventDefault\(\); setSidebarCollapsed\(/);
});
