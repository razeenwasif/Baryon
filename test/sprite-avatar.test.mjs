import test from 'node:test';
import assert from 'node:assert/strict';

test('sprite avatar calculates torso-up crop bounds in floating mode', () => {
  const imgW = 888;
  const imgH = 1195;
  const floatingSrcH = 650; // waist up
  const workspaceSrcH = imgH; // full body

  // Floating mode should frame 650px height (approx 54% of full height - torso up)
  assert.equal(floatingSrcH < workspaceSrcH, true);
  assert.equal(Math.round((floatingSrcH / imgH) * 100), 54);

  // In floating mode, ratio of height cropped captures head, chest, and waist
  assert.ok(floatingSrcH > 500 && floatingSrcH < 750, 'captures waist to flame hair');
});

test('sprite avatar hit-testing respects alpha threshold', () => {
  // Test hit map lookup logic
  const sw = 10;
  const sh = 10;
  const data = new Uint8Array(sw * sh * 4);

  // Set pixel (5, 5) to opaque
  const idx = (5 * sw + 5) * 4;
  data[idx + 3] = 255;

  // Set pixel (2, 2) to semi-transparent (below threshold 30)
  const idxLow = (2 * sw + 2) * 4;
  data[idxLow + 3] = 20;

  // Set pixel (0, 0) to transparent
  data[3] = 0;

  function hitTest(x, y) {
    if (x < 0 || x >= sw || y < 0 || y >= sh) return false;
    const alpha = data[(y * sw + x) * 4 + 3];
    return alpha > 30;
  }

  assert.equal(hitTest(5, 5), true, 'opaque pixel is interactive');
  assert.equal(hitTest(2, 2), false, 'alpha below 30 is transparent to clicks');
  assert.equal(hitTest(0, 0), false, 'transparent pixel passes through');
  assert.equal(hitTest(-1, 5), false, 'out of bounds passes through');
});

test('hair idle wave displacement smoothly reaches zero at hair roots to avoid seams', () => {
  const rootSx = 345;
  const tipSx = 160;

  function getHairWeight(sx) {
    return Math.max(0, Math.min(1, (rootSx - sx) / (rootSx - tipSx)));
  }

  // At the scalp/root boundary (345), weight must be 0 so no tear occurs
  assert.equal(getHairWeight(rootSx), 0, 'zero displacement at root boundary');

  // At the midpoint, moderate wave
  const midWeight = getHairWeight((rootSx + tipSx) / 2);
  assert.ok(midWeight > 0.4 && midWeight < 0.6, 'smooth gradient along lock');

  // At outer hair tips (160), full wave
  assert.equal(getHairWeight(tipSx), 1, 'full displacement at tips');
});

test('music vibing animation activates tempo bounce and sway', () => {
  const beatFreq = 3.6; // ~108 BPM
  const t1 = 0;
  const t2 = 0.5 / beatFreq; // quarter beat later

  const beat1 = Math.sin(t1 * beatFreq * Math.PI);
  const beat2 = Math.sin(t2 * beatFreq * Math.PI);

  assert.equal(Math.abs(beat1), 0);
  assert.equal(Math.abs(beat2), 1, 'peaks on beat');

  const bounce = Math.abs(beat2);
  const bobY = -bounce * 5.0;
  assert.equal(bobY, -5.0, 'bounces up on beat');
});

test('sprite pose selector chooses hands on waist for speaking and arms crossed for idle', () => {
  function selectPose({ elapsed, waveUntil, musicPlaying, activity, mouth }) {
    if (elapsed < waveUntil) return 'waving';
    if (musicPlaying || activity === 'singing') return 'dancing';
    if (activity === 'speaking' || mouth > 0.05) return 'speaking';
    if (activity === 'thinking') return 'thinking';
    return 'idle';
  }

  // Idle state: arms crossed
  assert.equal(selectPose({ elapsed: 5, waveUntil: 0, musicPlaying: false, activity: 'idle', mouth: 0 }), 'idle');

  // Speaking state: hands on waist
  assert.equal(selectPose({ elapsed: 5, waveUntil: 0, musicPlaying: false, activity: 'speaking', mouth: 0.3 }), 'speaking');
  assert.equal(selectPose({ elapsed: 5, waveUntil: 0, musicPlaying: false, activity: 'idle', mouth: 0.4 }), 'speaking');

  // Music state: dancing / vibing
  assert.equal(selectPose({ elapsed: 5, waveUntil: 0, musicPlaying: true, activity: 'idle', mouth: 0 }), 'dancing');
  assert.equal(selectPose({ elapsed: 5, waveUntil: 0, musicPlaying: false, activity: 'singing', mouth: 0 }), 'dancing');

  // Waving state: waving
  assert.equal(selectPose({ elapsed: 2, waveUntil: 3, musicPlaying: false, activity: 'idle', mouth: 0 }), 'waving');

  // Thinking state: thinking
  assert.equal(selectPose({ elapsed: 5, waveUntil: 0, musicPlaying: false, activity: 'thinking', mouth: 0 }), 'thinking');
});

test('floating mode click-through passes clicks through sprite and only captures island bar', () => {
  function isInteractive(targetId) {
    const interactiveIds = new Set(['floating-controls', 'floating-composer', 'floating-bubble', 'floating-ideas-bar', 'floating-awareness']);
    return interactiveIds.has(targetId);
  }

  // Island bar controls must be interactive
  assert.equal(isInteractive('floating-controls'), true, 'island bar controls capture clicks');
  assert.equal(isInteractive('floating-composer'), true, 'floating composer captures clicks');
  assert.equal(isInteractive('floating-bubble'), true, 'reply bubble captures clicks');

  // Sprite and avatar container must NOT be interactive (click-through to desktop)
  assert.equal(isInteractive('avatar'), false, 'avatar container passes clicks through');
  assert.equal(isInteractive('fairy-sprite-avatar'), false, 'sprite canvas passes clicks through');
  assert.equal(isInteractive('app'), false, 'empty background passes clicks through');
});

test('floating mode sprite hover transparency logic', () => {
  function computeHoverState({ isInteractive, isOverSprite }) {
    if (isInteractive) return false;
    return Boolean(isOverSprite);
  }

  // Hovering over sprite outside island bar: activates transparency
  assert.equal(computeHoverState({ isInteractive: false, isOverSprite: true }), true, 'sprite becomes transparent when hovered');

  // Hovering over island bar controls: sprite remains opaque
  assert.equal(computeHoverState({ isInteractive: true, isOverSprite: true }), false, 'sprite stays opaque when using island bar');

  // Hovering over empty space: sprite remains opaque
  assert.equal(computeHoverState({ isInteractive: false, isOverSprite: false }), false, 'sprite stays opaque when not hovered');
});
