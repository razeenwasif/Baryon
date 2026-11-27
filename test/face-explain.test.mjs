// Two Macs, step 7: Explain anything on the MacBook's screen, thought out on the mini (docs/fairy-on-two-macs-plan.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkSketch, InkScene, screenLook } from '../desktop/ink-sketch.mjs';
import { explainOnFace, keepDrawn } from '../desktop/face-explain.mjs';
import { call, events, PNG, setup, until } from './helpers/face-pair.mjs';

const shot = { url: 'data:image/png;base64,AAAA', width: 2000, height: 1000, bounds: { x: 0, y: 0, width: 1000, height: 500 } };
const ocr = { owner: 'Safari', windowTitle: 'Black hole - Wikipedia', region: { x: 0, y: 0.1, width: 0.4, height: 0.8 },
  lines: [
    { text: 'A black hole is a region of spacetime', x: 0.05, y: 0.2, width: 0.3, height: 0.02 },
    { text: 'Its boundary is called the event horizon.', x: 0.05, y: 0.3, width: 0.3, height: 0.02 },
  ] };
const look = screenLook(shot, ocr);

// Every kind of mark and card the model can draw, so nothing in a drawing's state is left untried.
const everyKind = { marks: [
  { kind: 'underline', line: 2, quote: 'event horizon' },
  { kind: 'highlight', line: 1, quote: 'black hole', tone: 'violet' },
  { kind: 'ring', line: 1, quote: 'spacetime' },
  { kind: 'label', line: 2, quote: 'boundary', text: 'the edge' },
  { kind: 'arrow', from: { line: 1, quote: 'region' }, to: { box: [800, 300, 100, 80] }, text: 'here' },
  { kind: 'card', title: 'What it is', text: 'Gravity so strong that light can’t escape: $v_{esc} = c$.', tie: { line: 1, quote: 'black hole' } },
  { kind: 'steps', title: 'How one forms', items: ['A star runs out of fuel', 'Its core collapses', 'A horizon forms'] },
  { kind: 'timeline', title: 'Discovery', events: [{ when: '1916', what: 'Schwarzschild' }, { when: '2019', what: 'First image' }] },
  { kind: 'bars', title: 'Masses', unit: 'suns', bars: [{ label: 'Sun', value: 1 }, { label: 'M87*', value: 6.5e9 }] },
  { kind: 'flow', title: 'Collapse', nodes: [{ id: 'a', text: 'Star' }, { id: 'b', text: 'Hole' }], links: [{ from: 'a', to: 'b', text: 'collapse' }] },
  { kind: 'table', title: 'Sizes', columns: ['Name', 'Radius'], rows: [['Sun', '3 km'], ['M87*', '0.0006 ly']] },
  { kind: 'math', title: 'Radius', steps: [{ tex: 'r_s = \\frac{2GM}{c^2}', note: 'Schwarzschild radius' }] },
  { kind: 'model', title: 'Merger', duration: 8, parts: [
    { shape: 'sphere', size: [0.3], at: [0.9, 0, 0], motion: 'orbit', timeline: [{ t: 0, at: [0.9, 0, 0] }, { t: 6, at: [0.05, 0, 0], opacity: 0 }] },
    { shape: 'ring', size: [1, 0.05], tilt: [12, 0], motion: 'pulse', label: 'waves' } ] },
  { kind: 'plot', title: 'Descent', x: [-2, 4], y: [-3, 3], curves: [{ fn: 'x^2 - 4*x + 3', label: 'f(x)' }], contours: { fn: '(x-1)^2 + 3*(y+1)^2', levels: 8 },
    constraints: [{ rule: 'x + 2*y <= 8', label: 'budget' }], points: [{ at: [1, -1], label: 'minimum' }], vectors: [{ from: [3, 1], to: [2, 0], label: '-∇f' }],
    path: { points: [[3, 1], [2.2, -0.2], [1.5, -0.8]], label: 'descent' }, sweep: { fn: '3*x + 2*y', from: 0, to: 12, label: 'objective' } },
  { kind: 'quiz', title: 'Practice', questions: [
    { q: 'With step 0.1 on f(x) = x^2 from x = 2, what is x_1?', answer: 1.6, tolerance: 0.001, unit: '', explain: 'x_1 = 2 - 0.1·4 = 1.6' },
    { q: 'Which holds at a constrained minimum?', options: ['∇f = 0', '∇f = λ∇g'], answer: 1, explain: 'Lagrange.' } ] },
] };

test('a drawing’s state survives the trip to the other Mac unchanged', () => {
  const scene = new InkScene();
  // An answer may hold at most four cards, so they arrive over several answers, as follow-up questions draw them.
  const cards = mark => !['underline', 'highlight', 'ring', 'label', 'arrow'].includes(mark.kind);
  const answers = [everyKind.marks.filter(mark => !cards(mark))];
  for (const card of everyKind.marks.filter(cards)) { if (answers.length === 1 || answers.at(-1).length === 4) answers.push([]); answers.at(-1).push(card); }
  let drawn = 0;
  for (const marks of answers) {
    const checked = checkSketch({ marks });
    assert.deepEqual(checked.problems, []);
    const { added, notes } = scene.apply(checked, look);
    assert.deepEqual(notes, []);
    drawn += added.length;
  }
  assert.equal(drawn, everyKind.marks.length);
  // A second answer that replaces one part and removes another, as a follow-up question does.
  scene.apply(checkSketch({ remove: ['p2'], marks: [{ kind: 'card', title: 'Again', text: 'Shorter.', replaces: 'p6' }] }), look);
  const state = scene.state(look);
  assert.ok(state.parts.length > 10);
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
});

test('a face’s scene can take the drawing back from its state, so closing a card there works as usual', () => {
  const scene = new InkScene();
  scene.apply(checkSketch({ marks: [{ kind: 'underline', line: 2, quote: 'event horizon' }, { kind: 'card', title: 'Edge', text: 'No light escapes.' }] }), look);
  const state = JSON.parse(JSON.stringify(scene.state(look)));
  const there = new InkScene();
  there.load(state);
  assert.deepEqual(there.state(look), scene.state(look));
  assert.equal(there.remove('p2'), true);
  assert.deepEqual(there.state(look).parts.map(part => part.id), ['p1']);
});

test('a card closed on the face isn’t drawn again on the next answer', () => {
  const scene = new InkScene();
  scene.apply(checkSketch({ marks: [{ kind: 'card', title: 'One', text: 'a' }, { kind: 'card', title: 'Two', text: 'b' }] }), look);
  keepDrawn(scene, ['p2']);
  assert.deepEqual([...scene.parts.keys()], ['p2']);
  keepDrawn(scene, undefined);
  assert.deepEqual([...scene.parts.keys()], ['p2'], 'no list from the face leaves the scene alone');
});

// The mini's side, as main.cjs builds it: Quick chat runs the turn, a stand-in model answers with a drawing.
const quickChat = { send: async (text, { onText, run }) => ({ text: await run({ settings: {}, history: [], text, signal: new AbortController().signal, onText }) }) };
const drawing = { chat: async () => ({ text: 'That’s the edge.\n```sketch\n{"marks":[{"kind":"underline","line":1,"quote":"hello"},{"kind":"card","title":"Edge","text":"No light escapes."}]}\n```' }) };

test('Explain from a face: the face’s picture is read, the model answers here, and the drawing goes back to the face', async () => {
  const scene = new InkScene();
  let face;
  const s = await setup((text, options) => explainOnFace({ text, ...options, scene, link: face, chat: quickChat, provider: () => drawing }));
  face = s.face;
  try {
    const stream = events(s.link, s.key);
    await until(() => stream.length >= 1);
    assert.equal((await call(s.link, '/v1/face/ask', { method: 'POST', key: s.key, body: { text: 'what is this?', explain: true, drawn: [] } })).status, 200);
    await until(() => stream.some(event => event.type === 'want-picture'));
    const { id, purpose } = stream.find(event => event.type === 'want-picture').data;
    assert.equal(purpose, 'explain');
    const read = { lines: [{ text: 'hello world', x: 0.1, y: 0.1, width: 0.2, height: 0.02 }] };
    await call(s.link, '/v1/face/picture', { method: 'POST', key: s.key, body: { id, png: PNG, width: 3024, height: 1964, bounds: { x: 0, y: 0, width: 1512, height: 982 }, read } });
    await until(() => stream.some(event => event.type === 'done'));
    const ink = stream.find(event => event.type === 'ink').data;
    assert.equal(ink.id, stream.find(event => event.type === 'done').data.turn);
    assert.deepEqual(ink.state.parts.map(part => part.kind), ['underline', 'card']);
    assert.ok(ink.state.parts[0].rect.w > 0, 'the underline found “hello” in what the face read');
    assert.equal(stream.find(event => event.type === 'done').data.text, 'That’s the edge.');
    // A follow-up after the face closed the card: only the underline is kept, and "clear" wipes the face's screen.
    await call(s.link, '/v1/face/ask', { method: 'POST', key: s.key, body: { text: 'clear', explain: true, drawn: ['p1'] } });
    await until(() => stream.some(event => event.type === 'ink' && event.data.clear === true));
    assert.equal(scene.showing, false);
    stream.stop();
  } finally { await s.done(); }
});

test('when the face won’t share its screen, the turn ends saying so, and nothing is drawn', async () => {
  const scene = new InkScene();
  let face;
  const s = await setup((text, options) => explainOnFace({ text, ...options, scene, link: face, chat: quickChat, provider: () => drawing }));
  face = s.face;
  try {
    const stream = events(s.link, s.key);
    await until(() => stream.length >= 1);
    await call(s.link, '/v1/face/ask', { method: 'POST', key: s.key, body: { text: 'what is this?', explain: true } });
    await until(() => stream.some(event => event.type === 'want-picture'));
    await call(s.link, '/v1/face/picture', { method: 'POST', key: s.key, body: { id: stream.find(event => event.type === 'want-picture').data.id, refused: true } });
    await until(() => stream.some(event => event.type === 'failed'));
    assert.match(stream.find(event => event.type === 'failed').data.message, /isn’t sharing its screen/);
    assert.ok(!stream.some(event => event.type === 'ink'));
    stream.stop();
  } finally { await s.done(); }
});

test('a face’s Explain never uses this Mac’s own screen picture or ink window', async () => {
  const main = await readFile(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  const wiring = main.match(/ask: \(text, \{ onText, onProgress, explain, drawn, focus, task, becomeTask \}\) => \(explain\n?([\s\S]*?)\)\),/);
  assert.ok(wiring, 'the face’s ask chooses Explain');
  assert.match(wiring[1], /explainOnFace\(\{ text, drawn, focus, scene: faceScene, link: faceLink, chat: quickChat, provider: conversationProvider, onText \}\)/);
  assert.doesNotMatch(wiring[1], /inkOverlay|inkCapture|inkScene|screenHelper|screenCapture/);
  const module = await readFile(new URL('../desktop/face-explain.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(module, /ink-overlay|screen-helper|electron|readScreenText|node:fs/);
  assert.match(module, /capture: \(\) => link\.picture\('explain', \{ signal \}\)/);
});

test('a face draws what the other Mac sends, and its pen asks for a drawn answer', async () => {
  const source = await readFile(new URL('../desktop/face-main.cjs', import.meta.url), 'utf8');
  assert.match(source, /if \(type === 'ink'\) return void drawOn\(data\)/);
  assert.match(source, /ink\.scene\.load\(state\);/);
  assert.match(source, /fromPage\('companion-explain', text => ask\([^\n]*\{ explain: true \}\)\);/);
  assert.match(source, /drawn: ink\?\.showing \? \[\.\.\.ink\.scene\.parts\.keys\(\)\] : \[\]/);
  assert.match(source, /ink\.onAsk = text => send\('fairy:companion-ask', text\);/);
  assert.match(source, /ink\.onPen = phase => send\('fairy:companion-morph', phase\);/);
});

test('an area selected on the face with ⌃⌥A reaches the mini’s Explain as plain numbers, and nothing else does', async () => {
  const asked = [];
  const s = await setup(async (text, options) => { asked.push(options); return { text: 'ok' }; });
  try {
    const stream = events(s.link, s.key);
    await until(() => stream.length >= 1);
    const focus = { rect: { x: 100, y: 80, w: 300, h: 120 }, how: 'selected', size: { width: 1512, height: 982 }, extra: 'dropped' };
    await call(s.link, '/v1/face/ask', { method: 'POST', key: s.key, body: { text: 'what is this?', explain: true, drawn: [], focus } });
    await until(() => stream.some(event => event.type === 'done'));
    assert.deepEqual(asked[0].focus, { rect: { x: 100, y: 80, w: 300, h: 120 }, how: 'selected', size: { width: 1512, height: 982 } });
    await call(s.link, '/v1/face/ask', { method: 'POST', key: s.key, body: { text: 'and this?', explain: true, focus: { rect: { x: 'a' }, size: { width: 1 } } } });
    await until(() => asked.length === 2);
    assert.equal(asked[1].focus, null);
    stream.stop();
  } finally { await s.done(); }
});

test('a face listens for ⌃⌥A and ⌥⌘ but not for holding ⌃⌥, and sends what was selected with its question', async () => {
  const source = await readFile(new URL('../desktop/face-main.cjs', import.meta.url), 'utf8');
  assert.match(source, /keys: \(\) => \(\{ hold: 'off', tap: 'option\+command', area: true \}\)/);
  assert.match(source, /ink: await ensureInk\(\), voice: \(\) => win, asker: \(\) => win,/);
  assert.match(source, /quickAsk\?\.takeFocus\(screen\.getDisplayNearestPoint\(screen\.getCursorScreenPoint\(\)\)\)/);
  assert.match(source, /await startQuickKeys\(\);/);
  assert.match(source, /quickAsk\?\.stop\(\);/);
  const main = await readFile(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /explainOnFace\(\{ text, drawn, focus, scene: faceScene,/);
});
