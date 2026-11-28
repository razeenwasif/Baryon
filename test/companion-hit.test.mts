// The companion's see-through parts let clicks through to the windows behind it (src/companion-hit.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { clickThrough, nearBox, showsHere } from '../src/companion-hit.js';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');
const element = (tagName: string, id = '') => ({ tagName, id });

test('only what the companion shows takes the mouse; its empty frame lets clicks through', () => {
  for (const target of [element('HTML'), element('BODY'), element('DIV', 'companion'), element('DIV', 'floating-ui'), null]) assert.equal(showsHere(target), false, JSON.stringify(target));
  for (const target of [element('DIV', 'eye'), element('DIV', 'reply'), element('BUTTON', 'approval-allow'), element('INPUT', ''), element('SPAN', '')]) assert.equal(showsHere(target), true, JSON.stringify(target));
});

test('the window is told when that changes, and again now and then in case it was reset', () => {
  const sent: boolean[] = [];
  let time = 0;
  const eye = { left: 130, right: 210, top: 330, bottom: 410 };
  const follow = clickThrough(value => { sent.push(value); }, { now: () => time, near: (x, y) => nearBox(eye, x as number, y as number) });
  const at = (target: { tagName: string; id: string } | null, clientX = 10, clientY = 10) => follow({ target, clientX, clientY } as any);
  at(element('BODY')); at(element('BODY')); at(element('DIV', 'companion'));
  assert.deepEqual(sent, [true], 'once while over the empty frame');
  at(element('DIV', 'eye'), 170, 370);
  assert.deepEqual(sent, [true, false]);
  time = 1500; at(element('DIV', 'eye'), 170, 370);
  assert.deepEqual(sent, [true, false, false], 'said again after a second');
  at(element('BODY'), 110, 370);
  assert.deepEqual(sent, [true, false, false], 'in the eye’s glow it still takes the mouse, before the pointer reaches the drag handle');
  at(element('BODY'), 90, 370);
  assert.deepEqual(sent, [true, false, false, true], 'further out it lets clicks through');
});

test('both Macs let the companion pass clicks through, except while she rides along, is hidden or is on the other screen', async () => {
  const main = await read('../build-ts/desktop/main.cjs'), face = await read('../desktop/face-main.cts'), page = await read('../src/companion.ts');
  assert.match(main, /fromCompanion\('passthrough', \(?value\)? => \{ if \(\(riding && rideOwner === 'companion'\) \|\| awayToFace === 'companion'\)\s*return; companionWindow\.setIgnoreMouseEvents\(value === true, \{ forward: true \}\); \}\);/);
  assert.match(face, /fromPage\('companion-passthrough', value => \{ if \(riding \|\| desktopTask \|\| visibility\?\.hidden \|\| !win \|\| win\.isDestroyed\(\)\) return; win\.setIgnoreMouseEvents\(value === true, \{ forward: true \}\); \}\);/);
  assert.match(page, /const follow = clickThrough\(value => api\.companionPassthrough\(value\), \{ near: \(x, y\) => nearBox\(\$\('#eye'\)\?\.getBoundingClientRect\(\), x, y\) \}\); document\.addEventListener\('mousemove', follow\);/);
});
