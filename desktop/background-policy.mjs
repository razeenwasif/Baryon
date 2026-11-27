/**
 * Ref-counted KeepAwake lease controller ensuring OS sleep prevention starts once on first lease and stops cleanly on last release.
 */
export function createKeepAwakeController({ startBlocker = () => 'noop', stopBlocker = () => {} } = {}) {
  const active = new Map();
  let blockerHandle = null;

  function release(leaseId) {
    const key = String(leaseId ?? '');
    if (!key || !active.has(key)) return false;
    active.delete(key);
    if (active.size === 0 && blockerHandle !== null) {
      const h = blockerHandle;
      blockerHandle = null;
      stopBlocker(h);
    }
    return true;
  }

  return {
    acquire(leaseId, reason = '') {
      const key = String(leaseId ?? '').trim();
      if (!key) throw new Error('KeepAwake leaseId is required.');
      const had = active.has(key);
      active.set(key, { reason: String(reason || ''), at: Date.now() });
      if (!had && active.size === 1 && blockerHandle === null) {
        blockerHandle = startBlocker();
      }
      return () => release(key);
    },
    release,
    releaseAll() {
      active.clear();
      if (blockerHandle !== null) {
        const h = blockerHandle;
        blockerHandle = null;
        stopBlocker(h);
      }
    },
    activeCount: () => active.size,
    leases: () => [...active.entries()].map(([id, meta]) => ({ id, ...meta })),
  };
}

/**
 * Computes power-aware background polling intervals and deferral policy from power, visibility, and active runs.
 */
export function evaluateBackgroundPolicy({
  onBattery = false,
  lowPowerMode = false,
  windowVisible = true,
  activeRuns = 0,
  activeSwarms = 0,
} = {}) {
  const busy = activeRuns > 0 || activeSwarms > 0;
  const keepAwake = busy && !lowPowerMode;
  const deferNonEssential = Boolean(lowPowerMode || (onBattery && !windowVisible && !busy));
  const pollIntervalMs = lowPowerMode
    ? 30_000
    : busy || (windowVisible && !onBattery)
      ? 1_000
      : windowVisible
        ? 5_000
        : onBattery
          ? 30_000
          : 15_000;
  const reason = lowPowerMode
    ? 'low-power-mode'
    : busy
      ? 'active-work'
      : !windowVisible && onBattery
        ? 'hidden-battery'
        : onBattery
          ? 'battery'
          : 'ac';
  return { keepAwake, pollIntervalMs, deferNonEssential, reason };
}
