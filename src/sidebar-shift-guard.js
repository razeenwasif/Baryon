/**
 * Prevents background sidebar reorders (e.g. a running thread settling or waking up) from causing accidental
 * clicks when a row shifts unexpectedly right under the user's pointer.
 */
export function createSidebarShiftGuard({
  container,
  rowSelector = '[data-session-id]',
  thresholdRatio = 0.5,
  suppressMs = 500,
  ownInputWindowMs = 500,
  now = Date.now,
} = {}) {
  let prevTops = new Map();
  let lastOwnInputAt = -Infinity;
  let suppressUntil = 0;

  const markOwnInput = () => { lastOwnInputAt = now(); };

  const captureSwallow = event => {
    if (now() >= suppressUntil) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  };

  const SWALLOW_EVENTS = ['pointerdown', 'click', 'auxclick', 'dblclick', 'contextmenu'];
  const OWN_INPUT_EVENTS = ['pointerdown', 'wheel', 'keydown'];

  if (container?.addEventListener) {
    for (const type of OWN_INPUT_EVENTS) container.addEventListener(type, markOwnInput, { capture: true, passive: true });
    for (const type of SWALLOW_EVENTS) container.addEventListener(type, captureSwallow, true);
  }

  function afterRender() {
    if (!container?.querySelectorAll) return false;
    const rows = [...container.querySelectorAll(rowSelector)];
    const nextTops = new Map();
    const current = now();
    const userInitiated = current - lastOwnInputAt <= ownInputWindowMs;
    let shifted = false;

    for (const row of rows) {
      const id = row.dataset?.sessionId;
      if (!id) continue;
      const top = Number(row.offsetTop) || 0;
      const height = Number(row.offsetHeight) || 0;
      nextTops.set(id, top);
      if (!userInitiated && height > 0 && prevTops.has(id)) {
        const delta = Math.abs(top - prevTops.get(id));
        if (delta > Math.max(1, height * thresholdRatio)) shifted = true;
      }
    }

    prevTops = nextTops;
    if (shifted) {
      suppressUntil = Math.max(suppressUntil, current + suppressMs);
    }
    return shifted;
  }

  const isSuppressed = () => now() < suppressUntil;

  function destroy() {
    if (!container?.removeEventListener) return;
    for (const type of OWN_INPUT_EVENTS) container.removeEventListener(type, markOwnInput, true);
    for (const type of SWALLOW_EVENTS) container.removeEventListener(type, captureSwallow, true);
  }

  return { afterRender, isSuppressed, destroy };
}
