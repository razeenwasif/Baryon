import test from 'node:test';
import assert from 'node:assert/strict';
import { actionReview } from '../desktop/action-review.mjs';
import { cleanSettings } from '../desktop/core.mjs';

const calc = { width: 1000, height: 800, bounds: { x: 0, y: 0, width: 2000, height: 1600 }, focus: { pid: 1, bundleId: 'com.apple.calculator', bundlePath: '/System/Applications/Calculator.app', window: { standard: true, hasSheet: false, x: 200, y: 200, width: 500, height: 600 } } };
const key = (...keys: string[]) => ({ type: 'keypress', keys });
const type = (text: string) => ({ type: 'type', text });
const open = (bundle_id: string) => ({ type: 'open_app', bundle_id });
const click = { type: 'click', button: 'left', x: 150, y: 150 };
const needs = (actions: any[], context: any = calc) => actionReview(actions, context).required;
test('smart approval defaults, always-review opt-in, and invalid settings rejection', () => {
  assert.equal(cleanSettings({}).desktopApproval, 'smart');
  assert.equal(cleanSettings({ desktopApproval: 'always' }).desktopApproval, 'always');
  assert.throws(() => cleanSettings({ desktopApproval: 'anything' } as any), /Choose smart desktop approval/);
});
test('verified calculator arithmetic can run without review', () => {
  assert.equal(needs([key('ESC'), type('35+7'), key('ENTER')]), false);
  assert.equal(needs([click]), false);
  assert.equal(needs([key('SHIFT', '=')]), false);
});
test('unknown apps, sheets, missing or spoofed context require review', () => {
  for (const focus of [{}, { ...calc.focus, bundlePath: '/tmp/Calculator.app' }, { ...calc.focus, bundleId: 'com.apple.Terminal' }, { ...calc.focus, window: { ...calc.focus.window, hasSheet: true } }] as any[]) {
    assert.equal(needs([type('35+7')], { ...calc, focus }), true);
  }
  for (const action of [type('rm -rf ~/Documents'), type('hello'), key('CMD', 'Q'), key('CMD', 'V'), { ...click, x: 900 }, { ...click, button: 'right' }]) assert.equal(needs([action]), true);
});
test('Spotlight safe app search is atomic and clears existing text', () => {
  assert.equal(needs([key('CMD', 'SPACE'), key('CMD', 'A'), type('Calculator'), key('ENTER')]), false);
  assert.equal(needs([key('CMD', 'SPACE'), type('Calculator'), key('ENTER')]), true);
  assert.equal(needs([key('CMD', 'SPACE'), key('CMD', 'A'), type('Calculator\n'), key('ENTER')]), true);
  assert.equal(needs([key('CMD', 'SPACE'), key('CMD', 'A'), type('Terminal'), key('ENTER')]), true);
  assert.equal(needs([key('CMD', 'SPACE'), key('ENTER')]), true);
});
test('Spotlight Return needs native evidence of a safe query', () => {
  const focus = { bundleId: 'com.apple.Spotlight', bundlePath: '/System/Library/CoreServices/Spotlight.app', query: 'Calculator' };
  assert.equal(needs([key('ENTER')], { focus }), false);
  assert.equal(needs([key('ENTER')], { focus: { ...focus, query: 'delete files' } }), true);
  assert.equal(needs([key('ENTER')], { focus: { ...focus, query: undefined } }), true);
});
test('navigation invalidates old app context and whole mixed batch needs review', () => {
  assert.equal(needs([open('com.apple.TextEdit')]), false);
  assert.equal(needs([open('com.apple.Terminal')]), true);
  assert.equal(needs([open('com.apple.TextEdit'), type('35+7')]), true);
  assert.equal(needs([key('CMD', 'SPACE'), key('CMD', 'A'), type('Calculator'), key('ENTER'), type('35+7')]), true);
  assert.equal(needs([click, key('ENTER')]), true);
  assert.equal(needs([type('35+7'), key('CMD', 'Q')]), true);
});
