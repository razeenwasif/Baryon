// Phase 2 pure geometry & coordinate mapping for Notch <-> Floating Companion drag-out and magnetic re-dock.

export const DETACH_THRESHOLD_PT = 70;
export const DOCK_ZONE_HALF_WIDTH_PT = 110;
export const DOCK_ZONE_HEIGHT_PT = 85;
export const DOCK_CURSOR_HALF_WIDTH_PT = 145;
export const DOCK_CURSOR_HEIGHT_PT = 105;
// Matches #eye in src/companion.css: bottom: 110px; height: 80px -> center is 150px above bottom.
export const EYE_OFFSET_FROM_BOTTOM_PT = 150;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function shouldDetach(pullDownPt) {
  return Number(pullDownPt) >= DETACH_THRESHOLD_PT;
}

/** Convert AppKit global screen coordinates (origin bottom-left of primary display)
 * to Electron DIP coordinates (origin top-left of primary display). */
export function cocoaToElectronPoint({ x, y }, primaryHeight) {
  const px = Number(x);
  const py = Number(y);
  const ph = Number(primaryHeight);
  return {
    x: Number.isFinite(px) ? Math.round(px) : 0,
    y: Number.isFinite(py) && Number.isFinite(ph) ? Math.round(ph - py) : 0,
  };
}

/** Compute the top-left window origin so #eye's center lands at (eyeX, eyeY),
 * softly clamped so the eye stays visible on `displayBounds`. */
export function windowOriginForEyeCenter({ eyeX, eyeY, winWidth = 290, winHeight = 296, displayBounds }) {
  const rawX = Math.round(Number(eyeX) - winWidth / 2);
  const rawY = Math.round(Number(eyeY) - (winHeight - EYE_OFFSET_FROM_BOTTOM_PT));
  if (!displayBounds) return { x: rawX, y: rawY };
  const minX = Math.round(displayBounds.x - winWidth / 2 + 24);
  const maxX = Math.round(displayBounds.x + displayBounds.width - winWidth / 2 - 24);
  const minY = Math.round(displayBounds.y - (winHeight - EYE_OFFSET_FROM_BOTTOM_PT) + 24);
  const maxY = Math.round(displayBounds.y + displayBounds.height - (winHeight - EYE_OFFSET_FROM_BOTTOM_PT) - 24);
  return {
    x: clamp(rawX, minX, maxX),
    y: clamp(rawY, minY, maxY),
  };
}

/** Compute gentle momentum settle target from Cocoa release velocity (vx, vy),
 * flipping vy into Electron's downward Y axis and clamping inside `workArea`. */
export function settleTarget({ x, y, vx = 0, vy = 0, winWidth = 290, winHeight = 296, workArea }) {
  const dx = clamp((Number(vx) || 0) * 0.045, -36, 36);
  const dy = clamp(-(Number(vy) || 0) * 0.045, -36, 36);
  const rawX = Math.round(Number(x) + dx);
  const rawY = Math.round(Number(y) + dy);
  if (!workArea) return { x: rawX, y: rawY };
  return {
    x: clamp(rawX, workArea.x, workArea.x + workArea.width - winWidth),
    y: clamp(rawY, workArea.y, workArea.y + workArea.height - winHeight),
  };
}

export function eyeCenterFromWindowBounds({ x, y, width = 290, height = 296 }) {
  return {
    eyeX: Number(x) + Number(width) / 2,
    eyeY: Number(y) + Number(height) - EYE_OFFSET_FROM_BOTTOM_PT,
  };
}

/** Check whether the dragged companion is inside the display's top-center
 * magnetic re-dock zone:
 * 1) eye center directly inside notch (+/- 110 x 85 pt)
 * 2) live pointer inside top-center notch band (+/- 145 x 105 pt)
 * 3) window top pushed against macOS menu bar under notch (+/- 145 pt horizontally) */
export function dockZoneProximity({
  eyeX,
  eyeY,
  cursorX = null,
  cursorY = null,
  windowBounds = null,
  displayBounds,
  workArea = null,
}) {
  if (!displayBounds || !Number.isFinite(eyeX) || !Number.isFinite(eyeY)) {
    return { inZone: false, proximity: 0, anchorX: 0, anchorY: 0 };
  }
  const anchorX = displayBounds.x + displayBounds.width / 2;
  const anchorY = displayBounds.y + 18;
  const candidates = [];

  const dxEye = Math.abs(eyeX - anchorX);
  const dyEyeTop = eyeY - displayBounds.y;
  if (dxEye <= DOCK_ZONE_HALF_WIDTH_PT && dyEyeTop >= -40 && dyEyeTop <= DOCK_ZONE_HEIGHT_PT) {
    const nx = dxEye / DOCK_ZONE_HALF_WIDTH_PT;
    const ny = Math.max(0, Math.abs(dyEyeTop - 18)) / (DOCK_ZONE_HEIGHT_PT - 18);
    candidates.push(1 - Math.min(1, Math.hypot(nx, ny)) * 0.85);
  }

  if (Number.isFinite(cursorX) && Number.isFinite(cursorY)) {
    const dxCur = Math.abs(cursorX - anchorX);
    const dyCurTop = cursorY - displayBounds.y;
    if (dxCur <= DOCK_CURSOR_HALF_WIDTH_PT && dyCurTop >= -40 && dyCurTop <= DOCK_CURSOR_HEIGHT_PT) {
      const nx = dxCur / DOCK_CURSOR_HALF_WIDTH_PT;
      const ny = Math.max(0, Math.abs(dyCurTop - 18)) / (DOCK_CURSOR_HEIGHT_PT - 18);
      candidates.push(1 - Math.min(1, Math.hypot(nx, ny)) * 0.85);
    }
  }

  if (windowBounds && workArea && Number.isFinite(windowBounds.x) && Number.isFinite(windowBounds.y)) {
    const winMidX = windowBounds.x + (windowBounds.width ?? 290) / 2;
    const dxWin = Math.abs(winMidX - anchorX);
    if (dxWin <= DOCK_CURSOR_HALF_WIDTH_PT && windowBounds.y <= workArea.y + 24) {
      const nx = dxWin / DOCK_CURSOR_HALF_WIDTH_PT;
      const ny = Math.max(0, windowBounds.y - workArea.y) / 24;
      candidates.push(1 - Math.min(1, Math.hypot(nx, ny)) * 0.75);
    }
  }

  if (!candidates.length) {
    return { inZone: false, proximity: 0, anchorX: Math.round(anchorX), anchorY: Math.round(anchorY) };
  }
  const best = Math.max(...candidates);
  return {
    inZone: true,
    proximity: Number(Math.max(0.15, Math.min(1, best)).toFixed(3)),
    anchorX: Math.round(anchorX),
    anchorY: Math.round(anchorY),
  };
}
