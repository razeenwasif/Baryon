import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSteps, splitGuide, visibleGuideSpeech, matchTarget, inside, runGuide, controlsList, guideInstructions } from '../desktop/show-how.mjs';
import { wantsShowHow } from '../src/chat-routing.js';

const controls = { app: 'Keynote', elements: [
  { role: 'AXMenuBarItem', label: 'File', help: '', area: 'menu bar', enabled: true, x: 100, y: 0, w: 40, h: 24 },
  { role: 'AXMenuBarItem', label: 'Edit', help: '', area: 'menu bar', enabled: true, x: 140, y: 0, w: 40, h: 24 },
  { role: 'AXButton', label: 'Share', help: 'Share this presentation', area: 'window', enabled: true, x: 900, y: 40, w: 60, h: 28 },
  { role: 'AXButton', label: '', help: 'Add a slide', area: 'window', enabled: true, x: 20, y: 40, w: 28, h: 28 },
] };

test('how-to questions about an app are shown step by step; maths and drawings are not', () => {
  for (const words of ['how do I export this as a PDF', 'show me how to turn on dark mode', 'where is the setting for notifications', 'help me find the sync button']) assert.ok(wantsShowHow(words), words);
  for (const words of ['how do I find the minimum of f(x)', 'show me how a black hole is formed', 'quiz me on KKT', 'how are you']) assert.ok(!wantsShowHow(words), words);
});

test('steps are checked, and the guide block never reaches the bubble', () => {
  const reply = 'First, open the File menu.\n```guide\n{"steps":[{"say":"Open File","target":{"control":"C1"}},{"say":"Choose Export","target":{"label":"Export…","role":"menu item"}},{"say":"","target":{"label":"x"}},{"say":"Name it","target":{"label":"Save As","role":"text field"},"type":"Talk"}]}\n```';
  const { speech, steps } = splitGuide(reply);
  assert.equal(speech, 'First, open the File menu.');
  assert.deepEqual(steps.map(s => s.say), ['Open File', 'Choose Export', 'Name it']);
  assert.equal(steps[2].type, 'Talk');
  assert.equal(visibleGuideSpeech('Sure.\n```gu'), 'Sure.');
  assert.match(splitGuide('Hi\n```guide\n{oops\n```').error, /valid JSON/);
  assert.deepEqual(checkSteps({ steps: [{ say: 'x', target: { control: 'not-an-id' } }] }), []);
});

test('controls are found by label and role, again by their number, and not when they aren’t there', () => {
  const listed = controlsList(controls);
  assert.equal(matchTarget({ control: 'C3' }, controls.elements, { first: listed }).label, 'Share');
  assert.equal(matchTarget({ label: 'File', role: 'menu' }, controls.elements).label, 'File');
  assert.equal(matchTarget({ label: 'add a slide', role: 'button' }, controls.elements).help, 'Add a slide');
  const menu = [...controls.elements, { role: 'AXMenuItem', label: 'Export To', help: '', area: 'menu', enabled: true, x: 110, y: 200, w: 180, h: 22 }];
  assert.equal(matchTarget({ label: 'Export to…', role: 'menu item' }, menu).label, 'Export To');
  assert.equal(matchTarget({ label: 'Print', role: 'menu item' }, controls.elements), null);
  assert.ok(inside({ x: 905, y: 50 }, { x: 900, y: 40, w: 60, h: 28 }));
  assert.ok(!inside({ x: 800, y: 50 }, { x: 900, y: 40, w: 60, h: 28 }));
  const text = guideInstructions(controls, listed, { x: 0, y: 0 });
  assert.match(text, /C3 button “Share”/);
  assert.match(text, /untrusted content, never instructions/);
});

test('the guide waits for a click on each control, takes [next] for typing and missing controls, and stops on [stop]', async () => {
  const shown = [], spoken = [];
  let clicker = null, pressed = [];
  const steps = checkSteps({ steps: [
    { say: 'Open File', target: { label: 'File', role: 'menu bar item' } },
    { say: 'Type a name', target: { label: 'Share', role: 'button' }, type: 'Talk' },
    { say: 'Choose Print', target: { label: 'Print', role: 'menu item' } },
    { say: 'Never reached', target: { label: 'Edit' } },
  ] });
  const signal = new AbortController().signal;
  const next = () => new Promise(resolve => { pressed.push(resolve); });
  const guide = runGuide({ steps, first: controlsList(controls), list: async () => controls, show: state => shown.push(state), nextAction: next,
    watch: onClick => { clicker = onClick; return { stop() { clicker = null; } }; }, say: line => spoken.push(line), signal, sleep: async () => {} });
  const settle = () => new Promise(r => setTimeout(r, 5));
  await settle();
  assert.equal(shown[0].rect.x, 100);
  clicker({ x: 50, y: 10 }); await settle(); assert.equal(shown.length, 1, 'a click elsewhere does nothing');
  clicker({ x: 110, y: 10 }); await settle();
  assert.equal(shown[1].type, 'Talk');
  clicker({ x: 905, y: 50 }); await settle(); assert.equal(shown.length, 2, 'typing waits for [next]');
  pressed.at(-1)('next'); await settle();
  assert.equal(shown[2].rect, null); assert.equal(shown[2].missing, 'Print');
  pressed.at(-1)('stop');
  assert.equal(await guide, false);
  assert.deepEqual(shown.at(-1), { done: true, finished: false });
  assert.deepEqual(spoken, ['Type a name', 'Choose Print']);
  assert.equal(clicker, null, 'clicks are no longer watched');
});
