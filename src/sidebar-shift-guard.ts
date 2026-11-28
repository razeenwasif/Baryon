export interface SidebarShiftGuardOptions {
  container?: HTMLElement | null;
  rowSelector?: string;
  thresholdRatio?: number;
  suppressMs?: number;
  ownInputWindowMs?: number;
  now?: () => number;
}

export interface SidebarShiftGuard {
  afterRender: () => boolean;
  isSuppressed: () => boolean;
  destroy: () => void;
}

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
}: SidebarShiftGuardOptions = {}): SidebarShiftGuard {
  let prevTops = new Map<string, number>();
  let lastOwnInputAt = -Infinity;
  let suppressUntil = 0;

  const markOwnInput = () => { lastOwnInputAt = now(); };

  const captureSwallow = (event: Event) => {
    if (now() >= suppressUntil) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  };

  const SWALLOW_EVENTS = ['pointerdown', 'click', 'auxclick', 'dblclick', 'contextmenu'] as const;
  const OWN_INPUT_EVENTS = ['pointerdown', 'wheel', 'keydown'] as const;

  if (container?.addEventListener) {
    for (const type of OWN_INPUT_EVENTS) container.addEventListener(type, markOwnInput, { capture: true, passive: true });
    for (const type of SWALLOW_EVENTS) container.addEventListener(type, captureSwallow, true);
  }

  function afterRender(): boolean {
    if (!container?.querySelectorAll) return false;
    const rows = [...container.querySelectorAll<HTMLElement>(rowSelector)];
    const nextTops = new Map<string, number>();
    const current = now();
    const userInitiated = current - lastOwnInputAt <= ownInputWindowMs;
    let shifted = false;

    for (const row of rows) {
      const id = row.dataset?.sessionId;
      if (!id) continue;
      const top = Number(row.offsetTop) || 0;
      const height = Number(row.offsetHeight) || 0;
      nextTops.set(id, top);
      const prevTop = prevTops.get(id);
      if (!userInitiated && height > 0 && prevTop !== undefined) {
        const delta = Math.abs(top - prevTop);
        if (delta > Math.max(1, height * thresholdRatio)) shifted = true;
      }
    }

    prevTops = nextTops;
    if (shifted) {
      suppressUntil = Math.max(suppressUntil, current + suppressMs);
    }
    return shifted;
  }

  const isSuppressed = (): boolean => now() < suppressUntil;

  function destroy(): void {
    if (!container?.removeEventListener) return;
    for (const type of OWN_INPUT_EVENTS) container.removeEventListener(type, markOwnInput, true);
    for (const type of SWALLOW_EVENTS) container.removeEventListener(type, captureSwallow, true);
  }

  return { afterRender, isSuppressed, destroy };
}
