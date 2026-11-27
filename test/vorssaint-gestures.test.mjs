import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  DETACH_THRESHOLD_PT,
  EYE_OFFSET_FROM_BOTTOM_PT,
  cocoaToElectronPoint,
  windowOriginForEyeCenter,
  settleTarget,
  eyeCenterFromWindowBounds,
  dockZoneProximity,
  shouldDetach,
} from '../desktop/vorssaint-gestures.mjs';
import { startVorssaintLink } from '../desktop/vorssaint-link.mjs';

test('cocoaToElectronPoint converts primary and multi-display coordinates cleanly', () => {
  const primaryH = 982;
  assert.deepEqual(cocoaToElectronPoint({ x: 756, y: 800 }, primaryH), { x: 756, y: 182 });
  // Display above primary: Cocoa y > primaryHeight -> negative Electron y
  assert.deepEqual(cocoaToElectronPoint({ x: 400, y: 1200 }, primaryH), { x: 400, y: -218 });
  // Display to the left: negative x preserved
  assert.deepEqual(cocoaToElectronPoint({ x: -300, y: 500 }, primaryH), { x: -300, y: 482 });
});

test('windowOriginForEyeCenter and eyeCenterFromWindowBounds round-trip pixel-for-pixel', () => {
  const displayBounds = { x: 0, y: 0, width: 1512, height: 982 };
  const targetEye = { eyeX: 756, eyeY: 220 };
  const origin = windowOriginForEyeCenter({ ...targetEye, winWidth: 290, winHeight: 296, displayBounds });
  const roundTrip = eyeCenterFromWindowBounds({ ...origin, width: 290, height: 296 });
  assert.deepEqual(roundTrip, targetEye);
  assert.equal(origin.x, 756 - 145);
  assert.equal(origin.y, 220 - (296 - EYE_OFFSET_FROM_BOTTOM_PT));
});

test('settleTarget maps Cocoa upward vy to downward negative offset and clamps inside workArea', () => {
  const workArea = { x: 0, y: 38, width: 1512, height: 944 };
  const settled = settleTarget({ x: 500, y: 200, vx: 200, vy: -300, winWidth: 290, winHeight: 296, workArea });
  assert.equal(settled.x, 509);
  // vy = -300 (downward in Cocoa) -> positive Electron dy (+14)
  assert.equal(settled.y, 214);

  const clamped = settleTarget({ x: 0, y: 10, vx: -5000, vy: 5000, winWidth: 290, winHeight: 296, workArea });
  assert.equal(clamped.x, 0);
  assert.equal(clamped.y, 38);
});

test('shouldDetach enforces 70 pt threshold and dockZoneProximity measures notch capture band', () => {
  assert.equal(shouldDetach(DETACH_THRESHOLD_PT - 0.1), false);
  assert.equal(shouldDetach(DETACH_THRESHOLD_PT), true);

  const displayBounds = { x: 0, y: 0, width: 1512, height: 982 };
  const center = dockZoneProximity({ eyeX: 756, eyeY: 18, displayBounds });
  assert.equal(center.inZone, true);
  assert.equal(center.proximity, 1);

  const edge = dockZoneProximity({ eyeX: 756 + 110, eyeY: 85, displayBounds });
  assert.equal(edge.inZone, true);
  assert.ok(edge.proximity > 0 && edge.proximity < 0.5);

  const outsideX = dockZoneProximity({ eyeX: 756 + 111, eyeY: 18, displayBounds });
  assert.equal(outsideX.inZone, false);
  const outsideY = dockZoneProximity({ eyeX: 756, eyeY: 86, displayBounds });
  assert.equal(outsideY.inZone, false);

  // macOS menu-bar clamp: eyeY stuck at ~184 because window.y is clamped at workArea.y (38)
  const workArea = { x: 0, y: 38, width: 1512, height: 944 };
  const clampedTop = dockZoneProximity({
    eyeX: 756,
    eyeY: 184,
    cursorX: 756,
    cursorY: 184,
    windowBounds: { x: 756 - 145, y: 38, width: 290, height: 296 },
    displayBounds,
    workArea,
  });
  assert.equal(clampedTop.inZone, true);
  assert.ok(clampedTop.proximity >= 0.8);

  // Cursor pulled directly into the notch band even while window sits lower
  const cursorInNotch = dockZoneProximity({
    eyeX: 756,
    eyeY: 190,
    cursorX: 760,
    cursorY: 22,
    windowBounds: { x: 756 - 145, y: 44, width: 290, height: 296 },
    displayBounds,
    workArea,
  });
  assert.equal(cursorInNotch.inZone, true);
  assert.ok(cursorInNotch.proximity > 0.85);
});

test('vorssaint-link routes fairy.undock and emits undockAck, dockHover, and dock', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vorssaint-gestures-'));
  const socketPath = join(dir, 'vorssaint.sock');
  const receivedUndocks = [];
  const receivedActions = [];

  const link = startVorssaintLink({
    socketPath,
    role: 'face',
    onUndock: event => receivedUndocks.push(event),
    onQuickAction: event => receivedActions.push(event),
  });
  await link.ready;

  const client = net.createConnection(socketPath);
  const inbound = [];
  client.setEncoding('utf8');
  let buf = '';
  client.on('data', chunk => {
    buf += chunk;
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (line.trim()) inbound.push(JSON.parse(line));
    }
  });

  await new Promise(resolve => client.once('connect', resolve));
  client.write(JSON.stringify({ type: 'hello', app: 'vorssaint', pid: 4321, protocol: 1 }) + '\n');
  await new Promise(r => setTimeout(r, 40));

  client.write(JSON.stringify({ type: 'fairy.undock', x: 756, y: 800, vx: 40, vy: -120, displayId: 1 }) + '\n');
  client.write(JSON.stringify({ type: 'fairy.quickAction', action: 'area' }) + '\n');
  client.write(JSON.stringify({ type: 'fairy.quickAction', action: 'box' }) + '\n');
  await new Promise(r => setTimeout(r, 40));

  assert.equal(receivedUndocks.length, 1);
  assert.deepEqual(receivedUndocks[0], { x: 756, y: 800, vx: 40, vy: -120, displayId: 1 });
  assert.deepEqual(receivedActions, [{ action: 'area' }, { action: 'box' }]);

  link.sendUndockAck({ x: 756, y: 182 });
  assert.equal(link.sendDockHover({ active: true, proximity: 0.72 }), true);
  // Small jitter < 0.03 should be deduped
  assert.equal(link.sendDockHover({ active: true, proximity: 0.73 }), false);
  assert.equal(link.sendDock({ x: 756, y: 18 }), true);

  await new Promise(r => setTimeout(r, 40));
  const types = inbound.map(m => m.type);
  assert.ok(types.includes('fairy.undockAck'));
  assert.ok(types.includes('fairy.dockHover'));
  assert.ok(types.includes('fairy.dock'));

  client.destroy();
  await link.close();
  rmSync(dir, { recursive: true, force: true });
});
