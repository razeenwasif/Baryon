export const IDLE_COMPACTION_MIN_TOKENS = 100_000;
export const IDLE_COMPACTION_LEAD_MS = 2 * 60_000;

export interface CompactionSession {
  id: string;
  done?: boolean;
  snoozedUntil?: string | number | null;
  work?: unknown;
  [key: string]: unknown;
}

export interface CompactionHistoryEntry {
  role?: string;
  content?: unknown;
  [key: string]: unknown;
}

export interface CompactionSummary {
  through?: number;
  [key: string]: unknown;
}

export interface CompactionUsageInput {
  usedTokens?: number;
  input?: number;
  cacheRead?: number;
  cached?: number;
  promptCacheTtlMs?: number;
  promptCacheExpiresAt?: number | string | null;
  provider?: string;
}

export interface RecordedCompactionUsage {
  usedTokens: number;
  promptCacheExpiresAt: number | string;
  provider: string;
  recordedAt: number;
}

export interface IdleCompactionWindowOptions {
  session?: CompactionSession | null;
  history?: CompactionHistoryEntry[];
  summary?: CompactionSummary | null;
  usage?: CompactionUsageInput | null;
  running?: boolean;
  pendingApprovals?: boolean;
  pendingHelpers?: boolean;
  nowMs?: number;
  minTokens?: number;
  leadMs?: number;
}

export interface IdleCompactionWindowResult {
  sessionId: string;
  startMs: number;
  endMs: number;
  usedTokens: number;
  expiresAt: string;
}

export interface IdleCompactionServiceOptions {
  getSessions?: () => CompactionSession[];
  getHistory?: (sessionId: string) => Promise<CompactionHistoryEntry[]> | CompactionHistoryEntry[];
  getSummary?: (sessionId: string) => Promise<CompactionSummary | null> | CompactionSummary | null;
  isRunning?: (sessionId: string) => boolean;
  hasPending?: (sessionId: string) => boolean;
  compact?: (sessionId: string, history: CompactionHistoryEntry[]) => Promise<unknown> | unknown;
  isEnabled?: () => boolean;
  isQuiet?: () => boolean;
  everyMs?: number;
  minTokens?: number;
  leadMs?: number;
  now?: () => number;
}

export interface IdleCompactionStatus {
  running: boolean;
  trackedSessions: number;
  inFlight: string[];
  lastSweepAt: number | null;
}

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
}: IdleCompactionWindowOptions = {}): IdleCompactionWindowResult | null {
  if (!session || session.done) return null;
  if (session.snoozedUntil && Date.parse(String(session.snoozedUntil)) > nowMs) return null;
  if (running || pendingApprovals || pendingHelpers) return null;
  if (!Array.isArray(history) || history.length < 2) return null;

  const lastUser = [...history].reverse().find(entry => entry?.role === 'user');
  if (lastUser && String(lastUser.content ?? '').trim().toLowerCase() === '/compact') return null;

  if (summary && Number.isInteger(summary.through) && (summary.through as number) >= history.length - 1) {
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
  getSessions: () => CompactionSession[];
  getHistory: (sessionId: string) => Promise<CompactionHistoryEntry[]> | CompactionHistoryEntry[];
  getSummary: (sessionId: string) => Promise<CompactionSummary | null> | CompactionSummary | null;
  isRunning: (sessionId: string) => boolean;
  hasPending: (sessionId: string) => boolean;
  compact: (sessionId: string, history: CompactionHistoryEntry[]) => Promise<unknown> | unknown;
  isEnabled: () => boolean;
  isQuiet: () => boolean;
  everyMs: number;
  minTokens: number;
  leadMs: number;
  now: () => number;
  usageBySession: Map<string, RecordedCompactionUsage>;
  inFlight: Set<string>;
  attemptedWindows: Set<string>;
  lastSweepAt: number;
  timer: ReturnType<typeof setInterval> | null;

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
  }: IdleCompactionServiceOptions = {}) {
    this.getSessions = getSessions;
    this.getHistory = getHistory;
    this.getSummary = getSummary;
    this.isRunning = isRunning;
    this.hasPending = hasPending;
    this.compact = compact;
    this.isEnabled = isEnabled;
    this.isQuiet = isQuiet;
    this.everyMs = everyMs;
    this.minTokens = minTokens;
    this.leadMs = leadMs;
    this.now = now;
    this.usageBySession = new Map();
    this.inFlight = new Set();
    this.attemptedWindows = new Set();
    this.lastSweepAt = 0;
    this.timer = null;
  }

  recordUsage(sessionId: string, usage: CompactionUsageInput = {}): void {
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

  clearSession(sessionId: string): void {
    this.usageBySession.delete(sessionId);
  }

  async sweep(): Promise<string[]> {
    if (!this.isEnabled() || this.isQuiet()) return [];
    const nowMs = this.now();
    this.lastSweepAt = nowMs;
    const sessions = this.getSessions() || [];
    const triggered: string[] = [];

    for (const session of sessions) {
      if (!session?.id || !session.work || this.inFlight.has(session.id)) continue;
      const usage = this.usageBySession.get(session.id);
      if (!usage) continue;
      const running = Boolean(this.isRunning(session.id));
      const pending = Boolean(this.hasPending(session.id));
      if (running || pending) continue;

      const [history, summary] = await Promise.all([
        Promise.resolve(this.getHistory(session.id)).catch(() => [] as CompactionHistoryEntry[]),
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

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.sweep().catch(() => {});
    }, this.everyMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  status(): IdleCompactionStatus {
    return {
      running: Boolean(this.timer),
      trackedSessions: this.usageBySession.size,
      inFlight: [...this.inFlight],
      lastSweepAt: this.lastSweepAt || null,
    };
  }
}
