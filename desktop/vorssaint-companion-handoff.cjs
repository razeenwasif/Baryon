// Shared Phase 2 controller for zero-lag Notch <-> Floating Companion handoff (both Full & Face modes).
const { glidePath, EVERY_MS } = require('./glide.cjs');

let gesturesPromise = null;
const loadGestures = () => (gesturesPromise ??= import('./vorssaint-gestures.mjs'));

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function createVorssaintCompanionHandoff({
  screen,
  ensureWindow,
  getWindow,
  isHidden,
  showWindowAt,
  hideWindowForDock,
  getVorssaint,
}) {
  let undockCooldownUntil = 0;
  let lastHoverInZone = false;
  let lastHoverAt = 0;
  let dockingOut = false;
  let settleToken = 0;
  let dragPoll = null;
  let dragPollStopAt = 0;

  function stopDragPoll() {
    if (dragPoll) {
      clearInterval(dragPoll);
      dragPoll = null;
    }
  }

  function startDragPoll() {
    dragPollStopAt = Date.now() + 900;
    if (dragPoll) return;
    dragPoll = setInterval(() => {
      if (Date.now() > dragPollStopAt || dockingOut || isHidden()) {
        stopDragPoll();
        return;
      }
      void updateHoverState();
    }, 33);
    dragPoll.unref?.();
  }

  async function handleUndock({ x = 0, y = 0, vx = 0, vy = 0 } = {}) {
    const g = await loadGestures();
    const primaryH = screen.getPrimaryDisplay().bounds.height;
    const { x: eyeX, y: eyeY } = g.cocoaToElectronPoint({ x, y }, primaryH);
    const display = screen.getDisplayNearestPoint({ x: eyeX, y: eyeY });
    const win = await ensureWindow();
    if (!win || win.isDestroyed()) return;

    const bounds = win.getBounds();
    const origin = g.windowOriginForEyeCenter({
      eyeX,
      eyeY,
      winWidth: bounds.width,
      winHeight: bounds.height,
      displayBounds: display.bounds,
    });

    undockCooldownUntil = Date.now() + 450;
    lastHoverInZone = false;
    dockingOut = false;
    const myToken = ++settleToken;

    win.setPosition(origin.x, origin.y);
    showWindowAt();
    try {
      win.webContents.send('fairy:companion-dock-hover', { active: false, docking: false });
      win.webContents.send('fairy:companion-bloom');
    } catch {}

    getVorssaint()?.sendUndockAck({ x: eyeX, y: eyeY });

    const speed = Math.hypot(Number(vx) || 0, Number(vy) || 0);
    if (speed > 60) {
      const target = g.settleTarget({
        x: origin.x,
        y: origin.y,
        vx,
        vy,
        winWidth: bounds.width,
        winHeight: bounds.height,
        workArea: display.workArea,
      });
      if (target.x !== origin.x || target.y !== origin.y) {
        const steps = glidePath(origin, target, 6);
        for (const pt of steps) {
          if (myToken !== settleToken || dockingOut || !win || win.isDestroyed()) break;
          win.setPosition(pt.x, pt.y);
          await sleep(18);
        }
      }
    }
  }

  async function evaluateZone(win) {
    if (!win || win.isDestroyed() || isHidden() || dockingOut || Date.now() < undockCooldownUntil) {
      return null;
    }
    const vorssaint = getVorssaint();
    if (!vorssaint || !vorssaint.state()?.connected) return null;
    const g = await loadGestures();
    const bounds = win.getBounds();
    const { eyeX, eyeY } = g.eyeCenterFromWindowBounds(bounds);
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint({ x: cursor.x, y: cursor.y });
    const zone = g.dockZoneProximity({
      eyeX,
      eyeY,
      cursorX: cursor.x,
      cursorY: cursor.y,
      windowBounds: bounds,
      displayBounds: display.bounds,
      workArea: display.workArea,
    });
    return { bounds, zone, vorssaint };
  }

  async function updateHoverState() {
    const res = await evaluateZone(getWindow());
    if (!res) return null;
    const { zone, vorssaint } = res;
    vorssaint.sendDockHover({ active: zone.inZone, proximity: zone.proximity });
    if (zone.inZone) lastHoverAt = Date.now();
    if (zone.inZone !== lastHoverInZone) {
      lastHoverInZone = zone.inZone;
      const win = getWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('fairy:companion-dock-hover', { active: zone.inZone, docking: false });
      }
    }
    return res;
  }

  async function onMove() {
    startDragPoll();
    await updateHoverState();
  }

  async function onMoved() {
    stopDragPoll();
    const win = getWindow();
    const res = await evaluateZone(win);
    if (!res) return;
    const { bounds, zone, vorssaint } = res;
    const recentlyHovered = lastHoverInZone && Date.now() - lastHoverAt < 250;
    if (!zone.inZone && !recentlyHovered) {
      if (lastHoverInZone) {
        lastHoverInZone = false;
        vorssaint.sendDockHover({ active: false, proximity: 0 });
        win.webContents.send('fairy:companion-dock-hover', { active: false, docking: false });
      }
      return;
    }

    const g = await loadGestures();
    dockingOut = true;
    lastHoverInZone = false;
    settleToken++;
    try {
      win.webContents.send('fairy:companion-dock-hover', { active: false, docking: true });
      const target = {
        x: Math.round(zone.anchorX - bounds.width / 2),
        y: Math.round(zone.anchorY - (bounds.height - g.EYE_OFFSET_FROM_BOTTOM_PT)),
      };
      const path = glidePath({ x: bounds.x, y: bounds.y }, target, 7);
      for (const [i, pt] of path.entries()) {
        if (!win || win.isDestroyed()) break;
        win.setPosition(pt.x, pt.y);
        win.setOpacity(Math.max(0, 1 - (i + 1) / path.length));
        await sleep(EVERY_MS);
      }
      hideWindowForDock();
      win.webContents.send('fairy:companion-dock-hover', { active: false, docking: false });
      vorssaint.sendDock({ x: zone.anchorX, y: zone.anchorY });
    } finally {
      dockingOut = false;
    }
  }

  return { handleUndock, onMove, onMoved };
}

module.exports = { createVorssaintCompanionHandoff };
