export interface CanAutoOpenOptions {
  sessionId?: string | null;
  expectedRevision?: number | null;
}

export interface ProactivePanelGuard {
  getRevision: (sessionId?: string | null) => number;
  recordUserAction: (sessionId?: string | null) => number;
  canAutoOpen: (options?: CanAutoOpenOptions) => boolean;
  reset: (sessionId?: string | null) => void;
}

/**
 * Tracks per-session user panel action revisions so proactive side-panel opens
 * never override a user's manual close/switch decision made after the trigger fired.
 */
export function createProactivePanelGuard(): ProactivePanelGuard {
  const revisions = new Map<string, number>();

  const keyFor = (sid?: string | null): string => sid || '__default__';

  return {
    getRevision(sessionId) {
      return revisions.get(keyFor(sessionId)) ?? 0;
    },
    recordUserAction(sessionId) {
      const k = keyFor(sessionId);
      const next = (revisions.get(k) ?? 0) + 1;
      revisions.set(k, next);
      return next;
    },
    canAutoOpen({ sessionId, expectedRevision }: CanAutoOpenOptions = {}) {
      if (expectedRevision === undefined || expectedRevision === null) return true;
      return (revisions.get(keyFor(sessionId)) ?? 0) === expectedRevision;
    },
    reset(sessionId) {
      if (sessionId) revisions.delete(keyFor(sessionId));
      else revisions.clear();
    },
  };
}
