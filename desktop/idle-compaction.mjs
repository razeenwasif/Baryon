export const IDLE_COMPACTION_MIN_TOKENS = 100_000;
export const IDLE_COMPACTION_LEAD_MS = 2 * 60_000;

/**
 * Computes the idle prompt-cache compaction window for a session, or returns `null` if skipped.
 * Compacting just before the cache TTL expires avoids an uncached full-context re-read on wake.
 */
export function idleCompactionWindow({
  session,
  history = [],
  summary = null,
  usage = null,
  running = false,
  pendingApprovals = false,
  pendingHelpers = false,
  nowMs = Date.now(),
  minTokens = IDLE_COMPACTION_MIN_TOKENS,
  leadMs = IDLE_COMPACTION_LEAD_MS,
} = {}) {
  if (!session || session.done) return null;
  if (session.snoozedUntil && Date.parse(session.snoozedUntil) > nowMs) return null;
  if (running || pendingApprovals || pendingHelpers) return null;
  if (!Array.isArray(history) || history.length < 2) return null;

  const lastUser = [...history].reverse().find(entry => entry?.role === 'user');
  if (lastUser && String(lastUser.content ?? '').trim().toLowerCase() === '/compact') return null;

  if (summary && Number.isInteger(summary.through) && summary.through >= history.length - 1) {
    return null;
  }

  const usedTokens = Number(usage?.usedTokens ?? usage?.input ?? 0) || 0;
  if (usedTokens < minTokens) return null;

  const expiresAt = usage?.promptCacheExpiresAt;
  const endMs = typeof expiresAt === 'number' ? expiresAt : Date.parse(String(expiresAt || ''));
  if (!Number.isFinite(endMs) || nowMs >= endMs) return null;

  return {
    sessionId: session.id,
    startMs: endMs - leadMs,
    endMs,
    usedTokens,
    expiresAt: new Date(endMs).toISOString(),
  };
}

export class IdleCompactionService {
  constructor({
    getSessions = () => [],
    getHistory = async () => [],
    getSummary = async () => null,
    isRunning = () => false,
    hasPending = () => false,
    compact = async () => {},
    isEnabled = () => true,
    isQuiet = () => false,
    everyMs = 30_000,
    minTokens = IDLE_COMPACTION_MIN_TOKENS,
    leadMs = IDLE_COMPACTION_LEAD_MS,
    now = Date.now,
  } = {}) {
    Object.assign(this, {
      getSessions,
      getHistory,
      getSummary,
      isRunning,
      hasPending,
      compact,
      isEnabled,
      isQuiet,
      everyMs,
      minTokens,
      leadMs,
      now,
    });
    this.usageBySession = new Map();
    this.inFlight = new Set();
    this.attemptedWindows = new Set();
    this.lastSweepAt = 0;
    this.timer = null;
  }

  recordUsage(sessionId, usage = {}) {
    if (!sessionId) return;
    const input = Number(usage.usedTokens ?? usage.input ?? 0) || 0;
    const cacheRead = Number(usage.cacheRead ?? usage.cached ?? 0) || 0;
    const total = input + cacheRead;
    const prev = this.usageBySession.get(sessionId);
    const ttlMs = usage.promptCacheTtlMs || (usage.provider === 'claude' ? 60 * 60_000 : 5 * 60_000);
    const expiresAt = usage.promptCacheExpiresAt || new Date(this.now() + ttlMs).toISOString();
    this.usageBySession.set(sessionId, {
      usedTokens: total || prev?.usedTokens || 0,
      promptCacheExpiresAt: expiresAt,
      provider: usage.provider || prev?.provider || '',
      recordedAt: this.now(),
    });
  }

  clearSession(sessionId) {
    this.usageBySession.delete(sessionId);
  }

  async sweep() {
    if (!this.isEnabled() || this.isQuiet()) return [];
    const nowMs = this.now();
    this.lastSweepAt = nowMs;
    const sessions = this.getSessions() || [];
    const triggered = [];

    for (const session of sessions) {
      if (!session?.id || !session.work || this.inFlight.has(session.id)) continue;
      const usage = this.usageBySession.get(session.id);
      if (!usage) continue;
      const running = Boolean(this.isRunning(session.id));
      const pending = Boolean(this.hasPending(session.id));
      if (running || pending) continue;

      const [history, summary] = await Promise.all([
        Promise.resolve(this.getHistory(session.id)).catch(() => []),
        Promise.resolve(this.getSummary(session.id)).catch(() => null),
      ]);
      const win = idleCompactionWindow({
        session,
        history,
        summary,
        usage,
        running,
        pendingApprovals: pending,
        pendingHelpers: false,
        nowMs,
        minTokens: this.minTokens,
        leadMs: this.leadMs,
      });
      if (!win || nowMs < win.startMs) continue;
      const windowKey = `${win.sessionId}:${win.endMs}`;
      if (this.attemptedWindows.has(windowKey)) continue;

      this.attemptedWindows.add(windowKey);
      this.inFlight.add(win.sessionId);
      triggered.push(win.sessionId);
      try {
        await this.compact(win.sessionId, history);
      } catch {
        // Non-fatal; skip retrying the same expiry window
      } finally {
        this.inFlight.delete(win.sessionId);
      }
    }
    return triggered;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.sweep().catch(() => {});
    }, this.everyMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  status() {
    return {
      running: Boolean(this.timer),
      trackedSessions: this.usageBySession.size,
      inFlight: [...this.inFlight],
      lastSweepAt: this.lastSweepAt || null,
    };
  }
}
