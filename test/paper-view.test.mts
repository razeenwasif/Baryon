// The notebook's paper view, stage 1: opening a PDF beside the tutor moves to the paper view and closing it moves back
// (src/paper-view.js, src/notebook-view.js, src/notebook.css, src/app.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { paperKey, paperSwitch, paperTabs, sidebarFold, type PaperSwitchOptions, type PaperTransitionHandle } from '../src/paper-view.js';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

interface MockRow {
  id: string | null;
  marks: Set<string>;
  setAttribute: (name: string) => void;
  removeAttribute: (name: string) => void;
}

interface MockTransitionStep extends PaperTransitionHandle {
  update: () => Promise<void> | void;
  skipped: boolean;
  finish: () => void;
}

// Stand-ins for the document element, the sidebar's rows and document.startViewTransition.
function page() {
  const classes = new Set<string>(), rows = new Map<string | null, MockRow>(), log: string[] = [];
  const row = (id: string | null): MockRow => { if (!rows.has(id)) { const marks = new Set<string>(); rows.set(id, { id, marks, setAttribute: (name: string) => { marks.add(name); log.push(`mark ${id}`); }, removeAttribute: (name: string) => marks.delete(name) }); } return rows.get(id)!; };
  const root = { classList: { add: (...names: string[]) => names.forEach(n => classes.add(n)), remove: (...names: string[]) => names.forEach(n => classes.delete(n)) },
    querySelectorAll: () => [...rows.values()].filter(r => r.marks.has('data-paper-origin')) } as unknown as HTMLElement;
  const moves: MockTransitionStep[] = [];
  const transition = (update: () => Promise<void> | void): MockTransitionStep => {
    let finish!: () => void; const finished = new Promise<void>(resolve => { finish = resolve; });
    const step: MockTransitionStep = { update, finished, skipped: false, skipTransition() { step.skipped = true; finish(); }, finish: () => finish() };
    log.push(`move ${[...classes].sort().join(' ')}`); moves.push(step); return step;
  };
  return { classes, rows, row, root, log, moves, transition };
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test('opening a PDF moves to the paper view, growing it out of its row, and closing moves back into that row', async () => {
  const p = page(), shown: boolean[] = [];
  const view = paperSwitch({ root: p.root, transition: p.transition, show: on => { shown.push(on); p.log.push(`show ${on}`); }, rowFor: id => p.row(id) as unknown as Element });
  assert.equal(view.to(false), false, 'nothing to do while closed');
  assert.equal(view.to(true, 'S3'), true);
  // The row is marked before the move starts, so the old view's picture of it is what the paper grows from.
  assert.deepEqual(p.log, ['mark S3', 'move nb-moving nb-opening']);
  assert.deepEqual(shown, [], 'the view changes inside the move, not before it');
  assert.equal(view.moving, true);
  p.moves[0].update();
  assert.deepEqual(shown, [true]);
  p.moves[0].finish(); await tick();
  assert.deepEqual([...p.classes], [], 'the move’s classes go when it ends');
  assert.equal(p.row('S3').marks.size, 0, 'and so does the mark');
  assert.equal(view.to(true, 'S3'), false, 'a redraw with the paper still open isn’t a move');
  assert.equal(view.to(false), true);
  assert.ok(p.classes.has('nb-closing'));
  await p.moves[1].update();
  // Closing: the row is marked once the sidebar is drawn again, for the paper to shrink back into.
  assert.deepEqual(p.log.slice(-2), ['show false', 'mark S3']);
  p.moves[1].finish(); await tick();
  assert.deepEqual([...p.classes], []);
  assert.equal(view.open, false);
});

test('with Reduce Motion, or no view transitions, the views just swap', () => {
  for (const options of [{ reduced: () => true }, { transition: null }] as Partial<PaperSwitchOptions>[]) {
    const p = page(), shown: boolean[] = [];
    const view = paperSwitch({ root: p.root, transition: p.transition, show: on => { shown.push(on); }, rowFor: id => p.row(id) as unknown as Element, ...options });
    view.to(true, 'S1'); view.to(false);
    assert.deepEqual(shown, [true, false]);
    assert.equal(p.moves.length, 0);
    assert.equal(p.row('S1').marks.size, 0, 'no row is left marked');
  }
});

test('closing in the middle of opening skips to the end and moves back from there', async () => {
  const p = page(), shown: boolean[] = [];
  const view = paperSwitch({ root: p.root, transition: p.transition, show: on => { shown.push(on); }, rowFor: id => p.row(id) as unknown as Element });
  view.to(true, 'S2');
  view.to(false);
  assert.equal(p.moves[0].skipped, true);
  assert.ok(p.classes.has('nb-closing') && !p.classes.has('nb-opening'));
  await tick();
  assert.ok(p.classes.has('nb-moving'), 'the skipped move ending doesn’t take the new one’s classes');
  await p.moves[1].update(); p.moves[1].finish(); await tick();
  assert.deepEqual([...p.classes], []);
});

test('a move waits for what the new view says it’s waiting for, before the new view is pictured', async () => {
  const p = page(); let release!: () => void;
  const view = paperSwitch({ root: p.root, transition: p.transition, show: () => new Promise<void>(done => { release = done; }), rowFor: id => p.row(id) as unknown as Element });
  view.to(true, 'S1'); view.to(false);
  let finished = false;
  const updating = (p.moves.at(-1)!.update() as Promise<void>).then(() => { finished = true; });
  await tick();
  assert.equal(finished, false, 'still waiting');
  assert.equal(p.row('S1').marks.size, 0, 'the row isn’t marked until the view it’s in is drawn');
  release(); await updating;
  assert.equal(p.row('S1').marks.size, 1);
});

test('leaving the notebook with the paper open gives the sidebar back at once', () => {
  const p = page(), folds: boolean[] = [];
  const view = paperSwitch({ root: p.root, transition: null, show: () => {}, rowFor: id => p.row(id) as unknown as Element });
  view.leave(on => { folds.push(on); });
  assert.deepEqual(folds, [] as boolean[], 'nothing to give back while it’s closed');
  view.to(true, 'S1');
  view.leave(on => { folds.push(on); });
  assert.deepEqual(folds, [false]);
  assert.equal(view.open, false);
});

test('the sidebar folds for the paper view and comes back, unless it was folded already or you changed it', () => {
  let folded = false; const set: boolean[] = [];
  const fold = sidebarFold({ isFolded: () => folded, setFolded: value => { folded = value; set.push(value); } });
  fold.paper(true); fold.paper(false);
  assert.deepEqual(set, [true, false]);
  folded = true; set.length = 0;
  fold.paper(true); fold.paper(false);
  assert.deepEqual(set, [], 'already folded stays folded');
  folded = false; set.length = 0;
  fold.paper(true); fold.changed(); fold.paper(false);
  assert.deepEqual(set, [true], 'your ⌘B during the paper view stands');
});

test('the notebook, its styles and the window are wired to the paper view', async () => {
  const [view, css, app] = await Promise.all([read('../src/notebook-view.ts'), read('../src/notebook.css'), read('../src/app.ts')]);
  assert.match(view, /if \(!paperView\.to\(pdfBeside\(\), beside\?\.source \|\| null\)\) drawBook\(\);/);
  assert.match(view, /return on \? Promise\.race\(\[\.\.\.viewers\.values\(\)\]\.map\(v => v\.ready\)\.concat\(new Promise\(done => setTimeout\(done, 300\)\)\)\) : null;/, 'opening waits at most 300 ms for the first page');
  assert.match(view, /\$\{pdfBeside\(\) \? ' paper-view' : ''\}/);
  assert.match(view, /if \(!panelHidden \|\| pdfBeside\(\)\) page\.append\(sidePanel\(\)\);/, 'the paper shows even with the panel hidden');
  assert.match(view, /if \(!pdfBeside\(\)\) top\.append\(toggle\);/);
  assert.match(view, /row\.dataset\.row = s\.id;/);
  assert.match(view, /paperView\.leave\(onPaper\)/);
  // The paper on the left, the tutor kept on the right.
  assert.match(css, /\.nb-book\.paper-view>\.nb-panel\{order:-1\}/);
  assert.match(css, /\.nb-book\.paper-view,\.nb-book\.with-sources\.paper-view\{grid-template-columns:minmax\(0,1fr\) minmax\(min\(380px,44%\),34%\)\}/);
  for (const name of ['nb-tutor', 'nb-side', 'nb-paper', 'nb-sources']) assert.match(css, new RegExp(`view-transition-name:${name}\\}`), name);
  assert.match(css, /\[data-paper-origin\]\)\{view-transition-name:nb-paper\}/);
  assert.match(css, /prefers-reduced-motion:reduce\)\{html\.nb-moving::view-transition-group\(\*\)/);
  assert.doesNotMatch(css, /panel-wide/);
  // The window folds its sidebar for it without saving that as how it opens.
  assert.match(app, /onPaper: paperSidebar/);
  assert.match(app, /if \(remember\) try \{ localStorage\.setItem\('fairy-sidebar'/);
  assert.match(app, /setFolded: value => setSidebarCollapsed\(value, \{ remember: false \}\)/);
  assert.match(app, /if \(remember\) paperFold\?\.changed\(\);/);
});

test('the papers open are tabs: each opened joins them, switching keeps your page, closing shows a neighbour', () => {
  const tabs = paperTabs();
  assert.equal(tabs.open({ note: 'N001' } as any), null, 'only a source or a file the tutor wrote is a paper');
  tabs.open({ source: 'S01', page: 3 }); tabs.open({ source: 'S02' }); tabs.open({ file: 'sheet.pdf' });
  tabs.open({ source: 'S01', page: 9 });
  assert.deepEqual(tabs.list.map(e => [e.key, e.page]), [['source:S01', 3], ['source:S02', 1], ['file:sheet.pdf', 1]], 'opening one again doesn’t add it twice');
  tabs.remember('source:S02', 7); tabs.remember('source:S02', -1); tabs.remember('nowhere', 4);
  assert.equal(tabs.list[1].page, 7);
  assert.equal(tabs.close('source:S02')!.key, 'file:sheet.pdf', 'the one after it');
  assert.equal(tabs.close('file:sheet.pdf')!.key, 'source:S01', 'else the one before');
  assert.equal(tabs.close('source:S01'), null, 'none left: the paper view closes');
  assert.equal(tabs.close('source:S01'), null);
  tabs.open({ source: 'S03' }); tabs.open({ source: 'S04' });
  tabs.keep(e => e.source !== 'S03');
  assert.deepEqual(tabs.list.map(e => e.key), ['source:S04'], 'a source removed goes from the tabs');
  assert.equal(paperKey({ file: 'a.pdf' }), 'file:a.pdf');
  tabs.clear(); assert.deepEqual(tabs.list, []);
});

test('the paper view shows its papers as tabs where the panel’s tabs are, and × closes one paper', async () => {
  const [view, css] = await Promise.all([read('../src/notebook-view.ts'), read('../src/notebook.css')]);
  assert.match(view, /side\.append\(pdfBeside\(\) \? paperTabsRow\(\) : tabs\);/);
  assert.match(view, /if \(pdfBeside\(\)\) closePaper\(paperKey\(beside\)\); else \{ beside = null; render\(\); \}/);
  assert.match(view, /papers\.clear\(\); closeOverPaper\(\); for \(const viewer of viewers\.values\(\)\) viewer\.destroy\(\);/, 'leaving the paper view forgets them');
  assert.match(css, /\.nb-paper-tab\.on\{/);
});

test('a pane open beside a paper gives way to it, and the tutor narrows a little in a narrow window, until the paper closes', () => {
  const app = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
  assert.match(app, /const paperSidebar = (?:\(on(?:\s*:\s*boolean)?\)|on) => \{ paperFold\.paper\(on\); document\.documentElement\.classList\.toggle\('paper-open', !!on\); \};/);
  const workspace = readFileSync(new URL('../src/workspace.css', import.meta.url), 'utf8');
  assert.match(workspace, /&\.paper-open\.pane-open\.pane-wide:not\(\.pane-full\) main\{grid-template-columns:var\(--sidebar-column\) minmax\(760px,1fr\) minmax\(380px,\.7fr\)\}/);
  assert.match(workspace, /&\.paper-open\.pane-sized\.pane-open:not\(\.pane-full\) main\{grid-template-columns:var\(--sidebar-column\) minmax\(760px,1fr\) clamp\(380px,var\(--pane-width\),40vw\)\}/);
  const notebook = readFileSync(new URL('../src/notebook.css', import.meta.url), 'utf8');
  assert.match(notebook, /\.nb-book\.paper-view,\.nb-book\.with-sources\.paper-view\{grid-template-columns:minmax\(0,1fr\) minmax\(min\(380px,44%\),34%\)\}/);
  // Leaving the notebook leaves the paper view through the same hook, so the pane gets its room back.
  assert.match(readFileSync(new URL('../src/notebook-view.ts', import.meta.url), 'utf8'), /if \(!value\) \{ bookMode\(false\); hush\(\); paperView\.leave\(onPaper\);/);
});
