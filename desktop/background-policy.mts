export interface KeepAwakeLease {
  id: string;
  reason: string;
  at: number;
}

export interface KeepAwakeOptions<THandle = unknown> {
  startBlocker?: () => THandle;
  stopBlocker?: (handle: THandle) => void;
}

export interface KeepAwakeController {
  acquire(leaseId: string, reason?: string): () => boolean;
  release(leaseId: string): boolean;
  releaseAll(): void;
  activeCount(): number;
  leases(): KeepAwakeLease[];
}

export type BackgroundPolicyReason = 'low-power-mode' | 'active-work' | 'hidden-battery' | 'battery' | 'ac';

export interface BackgroundPolicyInput {
  onBattery?: boolean;
  lowPowerMode?: boolean;
  windowVisible?: boolean;
  activeRuns?: number;
  activeSwarms?: number;
}

export interface BackgroundPolicy {
  keepAwake: boolean;
  pollIntervalMs: number;
  deferNonEssential: boolean;
  reason: BackgroundPolicyReason;
}

/**
 * Ref-counted KeepAwake lease controller ensuring OS sleep prevention starts once on first lease and stops cleanly on last release.
 */
export function createKeepAwakeController<THandle = unknown>({
  startBlocker = (() => 'noop') as () => THandle,
  stopBlocker = (() => {}) as (handle: THandle) => void,
}: KeepAwakeOptions<THandle> = {}): KeepAwakeController {
  const active = new Map<string, { reason: string; at: number }>();
  let blockerHandle: THandle | null = null;

  function release(leaseId: string): boolean {
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
    acquire(leaseId: string, reason = ''): () => boolean {
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
    releaseAll(): void {
      active.clear();
      if (blockerHandle !== null) {
        const h = blockerHandle;
        blockerHandle = null;
        stopBlocker(h);
      }
    },
    activeCount: (): number => active.size,
    leases: (): KeepAwakeLease[] => [...active.entries()].map(([id, meta]) => ({ id, ...meta })),
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
}: BackgroundPolicyInput = {}): BackgroundPolicy {
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
  const reason: BackgroundPolicyReason = lowPowerMode
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
