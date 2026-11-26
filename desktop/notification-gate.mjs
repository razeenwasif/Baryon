/**
 * Gates desktop notifications using window focus, active session tracking, a post-blur grace window,
 * and per-(session, kind) deduplication.
 */
export function createNotificationGate({
  graceMs = 6_000,
  dedupeMs = 15_000,
  now = Date.now,
} = {}) {
  let focused = true;
  let activeSessionId = '';
  let lastBlurAt = 0;
  const recent = new Map();

  const prune = nowMs => {
    for (const [k, ts] of recent.entries()) {
      if (nowMs - ts >= dedupeMs) recent.delete(k);
    }
  };

  return {
    setFocus(isFocused) {
      const next = Boolean(isFocused);
      if (focused && !next) lastBlurAt = now();
      focused = next;
    },
    setActiveSession(sessionId) {
      activeSessionId = String(sessionId || '');
    },
    state() {
      return { focused, activeSessionId, lastBlurAt };
    },
    shouldNotify({ sessionId = '', kind = 'turn', urgent = false } = {}) {
      const nowMs = now();
      prune(nowMs);
      const dedupeKey = `${sessionId || '*'}:${kind}`;
      const lastSent = recent.get(dedupeKey);
      if (lastSent !== undefined && nowMs - lastSent < dedupeMs) {
        return { allow: false, reason: 'deduped' };
      }

      if (!urgent) {
        if (focused && (!sessionId || sessionId === activeSessionId)) {
          return { allow: false, reason: 'focused' };
        }
        if (!focused && lastBlurAt && nowMs - lastBlurAt < graceMs) {
          return { allow: false, reason: 'grace-window' };
        }
      }

      recent.set(dedupeKey, nowMs);
      return { allow: true, reason: '' };
    },
    reset() {
      focused = true;
      activeSessionId = '';
      lastBlurAt = 0;
      recent.clear();
    },
  };
}
