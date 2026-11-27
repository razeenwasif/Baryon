import test from 'node:test';
import assert from 'node:assert/strict';
import { paintFairy, fairyHit, FAIRY_GRID, FAIRY_COLORS, OPEN_EXPRESSION, FAIRY_CENTER } from '../src/fairy-pixels.js';

const count = (data, color) => { let n = 0; for (let i = 0; i < data.length; i += 4) if (data[i] === color[0] && data[i + 1] === color[1] && data[i + 2] === color[2] && data[i + 3]) n++; return n; };
const frame = (e, extras) => paintFairy(new Uint8ClampedArray(FAIRY_GRID * FAIRY_GRID * 4), { ...OPEN_EXPRESSION, ...e }, extras);

test('the open eye shows sclera, iris, pupil and highlight; a closed lid hides them all', () => {
  const open = frame({}), closed = frame({ lid: 1.15 });
  for (const color of [FAIRY_COLORS.sclera, FAIRY_COLORS.lavender, FAIRY_COLORS.iris, FAIRY_COLORS.pupil, FAIRY_COLORS.spark]) {
    assert(count(open, color) > 0, `open eye shows ${color}`);assert.equal(count(closed, color), 0, `closed eye hides ${color}`);
  }
  assert(count(frame({ lid: -.2 }), FAIRY_COLORS.sclera) < count(open, FAIRY_COLORS.sclera), 'a half lid covers part of the eye');
});

test('squint, gaze, heart and glyphs change only what they describe', () => {
  const squint = frame({ squint: 1 });assert.equal(count(squint, FAIRY_COLORS.pupil), 0);assert(count(squint, FAIRY_COLORS.spark) > 0);
  assert.notDeepEqual(frame({ gx: 3 }), frame({ gx: -3 }));
  assert(count(frame({ heart: 1 }), FAIRY_COLORS.heart) > 0);assert.equal(count(frame({}), FAIRY_COLORS.heart), 0);
  assert(count(frame({}, [{ glyph: 'z', x: 70, y: 10 }]), FAIRY_COLORS.z) >= 8);
});

test('the hit area is the disc, not the transparent corners', () => {
  assert(fairyHit(FAIRY_CENTER.x, FAIRY_CENTER.y));assert(!fairyHit(1, 1));assert(!fairyHit(FAIRY_GRID - 1, FAIRY_GRID - 1));
});
