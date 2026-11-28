export const MAX_OVERDUE_ARM_MS = 24 * 60 * 60 * 1000;

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8,
  september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

export interface ArmedRecoveryState {
  runId: string;
  resetAt: string;
  autoResume: boolean;
  snooze: boolean;
  armedAt?: string;
}

export interface UsageLimitCandidate {
  sessionId?: string;
  runId?: string;
  status?: string;
  lastErrorClass?: string;
  resetAt?: string;
  failedAt?: string;
  snoozedUntil?: string;
  pendingApproval?: boolean;
  archived?: boolean;
  armed?: ArmedRecoveryState | null;
  dispatched?: boolean;
  resumedAt?: string;
}

export interface UsageLimitItem {
  sessionId: string;
  runId: string;
  status: 'failed';
  lastErrorClass: 'usage_limit';
  resetAt: string;
  failedAt: string;
  snoozedUntil: string;
  pendingApproval: boolean;
  archived: boolean;
  armed: ArmedRecoveryState | null;
  dispatched: boolean;
  resumedAt?: string;
}

export interface LimitRecoveryOptions {
  autoResume?: boolean;
  snooze?: boolean;
  nowMs?: number;
  maxOverdueMs?: number;
}

export interface ArmRecoveryAction {
  type: 'arm';
  sessionId: string;
  runId: string;
  resetAt: string;
  autoResume: boolean;
  snooze: boolean;
}

export interface ResumeRecoveryAction {
  type: 'resume';
  sessionId: string;
  runId: string;
  deliveryId: string;
  text: string;
}

export type LimitRecoveryAction = ArmRecoveryAction | ResumeRecoveryAction;

export interface UsageLimitSettings {
  autoResumeLimitedThreads?: 'on' | 'off' | boolean;
  snoozeLimitedThreads?: 'on' | 'off' | boolean;
}

export interface UsageLimitRecoveryWorkerOptions {
  filePath?: string;
  readJSON?: (path: string, fallback: unknown) => Promise<unknown>;
  writeJSON?: (path: string, data: unknown) => Promise<unknown>;
  onSnooze?: (sessionId: string, resetAt: string) => Promise<unknown> | unknown;
  onResume?: (action: ResumeRecoveryAction) => Promise<unknown> | unknown;
  getSettings?: () => UsageLimitSettings | null | undefined;
  isBusy?: (sessionId: string) => boolean;
  everyMs?: number;
  now?: () => number;
}

export interface RecordLimitFailureInput {
  sessionId?: string;
  runId?: string;
  errorText?: string;
  resetAt?: string;
  failedAt?: string;
  snoozedUntil?: string;
  pendingApproval?: boolean;
}

function applyClock(date: Date, hourStr: string, minStr = '0', ampm = ''): Date | null {
  let h = Number(hourStr);
  const m = Number(minStr || '0');
  if (!Number.isFinite(h) || !Number.isFinite(m) || m > 59) return null;
  const ap = ampm.toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  else if (ap === 'am' && h === 12) h = 0;
  if (h > 23) return null;
  const next = new Date(date.getTime());
  next.setHours(h, m, 0, 0);
  return next;
}

/**
 * Extracts a reset ISO timestamp from provider usage-limit error messages.
 */
export function parseUsageLimitReset(errorText: unknown, nowMs = Date.now()): string {
  const text = String(errorText ?? '').trim();
  if (!text) return '';

  // Direct ISO-8601 timestamp
  const iso = /\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2}))\b/i.exec(text);
  if (iso) {
    const ts = Date.parse(iso[1]);
    if (Number.isFinite(ts)) return new Date(ts).toISOString();
  }

  // Relative durations: "try again in 15 minutes", "retry in 2 hours"
  const rel = /(?:try again|retry|resets?|available)\s+in\s+(?:about\s+)?(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours)\b/i.exec(text);
  if (rel) {
    const num = Number(rel[1]);
    const unit = rel[2].toLowerCase();
    const mult = unit.startsWith('h') ? 3600_000 : unit.startsWith('m') ? 60_000 : 1000;
    if (Number.isFinite(num) && num > 0) return new Date(nowMs + Math.round(num * mult)).toISOString();
  }

  // "resets Nov 24 at 5:39pm" or "resets 24 Nov at 17:39"
  const named = /resets?\s+(?:([A-Za-z]+)\s+(\d{1,2})|(\d{1,2})\s+([A-Za-z]+))\s*(?:at|,)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(text);
  if (named) {
    const monStr = (named[1] || named[4] || '').toLowerCase();
    const day = Number(named[2] || named[3]);
    const mon = MONTHS[monStr];
    if (mon !== undefined && day >= 1 && day <= 31) {
      const ref = new Date(nowMs);
      const cand = new Date(ref.getFullYear(), mon, day, 0, 0, 0, 0);
      const withClock = applyClock(cand, named[5], named[6], named[7]);
      if (withClock) {
        if (withClock.getTime() < nowMs - 12 * 3600_000) withClock.setFullYear(withClock.getFullYear() + 1);
        return withClock.toISOString();
      }
    }
  }

  // "resets at 5:30pm" or "resets at 17:30"
  const clockOnly = /resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(text);
  if (clockOnly) {
    const base = new Date(nowMs);
    const withClock = applyClock(base, clockOnly[1], clockOnly[2], clockOnly[3]);
    if (withClock) {
      if (withClock.getTime() <= nowMs) withClock.setDate(withClock.getDate() + 1);
      return withClock.toISOString();
    }
  }

  return '';
}

/**
 * Pure decision function for arming snooze/recovery or triggering auto-resume after a usage limit resets.
 */
export function limitRecoveryAction(
  candidate: UsageLimitCandidate | null | undefined,
  { autoResume = false, snooze = true, nowMs = Date.now(), maxOverdueMs = MAX_OVERDUE_ARM_MS }: LimitRecoveryOptions = {},
): LimitRecoveryAction | null {
  if (
    !candidate ||
    candidate.status !== 'failed' ||
    candidate.lastErrorClass !== 'usage_limit' ||
    !candidate.sessionId ||
    !candidate.runId ||
    !candidate.resetAt ||
    candidate.archived ||
    candidate.pendingApproval
  ) {
    return null;
  }

  const resetMs = Date.parse(candidate.resetAt);
  const failedMs = candidate.failedAt ? Date.parse(candidate.failedAt) : 0;
  if (!Number.isFinite(resetMs)) return null;
  if (Number.isFinite(failedMs) && failedMs > 0 && resetMs <= failedMs) return null;

  const armed = candidate.armed;
  if (!armed || armed.runId !== candidate.runId || armed.resetAt !== candidate.resetAt) {
    if (nowMs - resetMs > maxOverdueMs) return null;
    if (!autoResume && (!snooze || resetMs <= nowMs)) return null;
    return {
      type: 'arm',
      sessionId: candidate.sessionId,
      runId: candidate.runId,
      resetAt: candidate.resetAt,
      autoResume: Boolean(autoResume),
      snooze: Boolean(snooze && resetMs > nowMs),
    };
  }

  if (!armed.autoResume || resetMs > nowMs || candidate.dispatched) return null;
  if (candidate.snoozedUntil && Date.parse(candidate.snoozedUntil) > nowMs) return null;

  return {
    type: 'resume',
    sessionId: candidate.sessionId,
    runId: candidate.runId,
    deliveryId: `limit-resume:${candidate.sessionId}:${candidate.runId}:${resetMs}`,
    text: 'Continue where you left off.',
  };
}

export class UsageLimitRecoveryWorker {
  filePath: string;
  readJSON: (path: string, fallback: unknown) => Promise<unknown>;
  writeJSON: (path: string, data: unknown) => Promise<unknown>;
  onSnooze: (sessionId: string, resetAt: string) => Promise<unknown> | unknown;
  onResume: (action: ResumeRecoveryAction) => Promise<unknown> | unknown;
  getSettings: () => UsageLimitSettings | null | undefined;
  isBusy: (sessionId: string) => boolean;
  everyMs: number;
  now: () => number;
  items: Map<string, UsageLimitItem>;
  timer: (ReturnType<typeof setInterval> & { unref?: () => void }) | null;
  loaded: boolean;

  constructor({
    filePath = '',
    readJSON = async (_p, fb) => fb,
    writeJSON = async () => {},
    onSnooze = async () => {},
    onResume = async () => {},
    getSettings = () => ({ autoResumeLimitedThreads: 'off', snoozeLimitedThreads: 'on' }),
    isBusy = () => false,
    everyMs = 30_000,
    now = Date.now,
  }: UsageLimitRecoveryWorkerOptions = {}) {
    this.filePath = filePath;
    this.readJSON = readJSON;
    this.writeJSON = writeJSON;
    this.onSnooze = onSnooze;
    this.onResume = onResume;
    this.getSettings = getSettings;
    this.isBusy = isBusy;
    this.everyMs = everyMs;
    this.now = now;
    this.items = new Map();
    this.timer = null;
    this.loaded = false;
  }

  async load(): Promise<void> {
    if (!this.filePath || this.loaded) return;
    this.loaded = true;
    const saved = await this.readJSON(this.filePath, null).catch(() => null) as { items?: unknown } | null;
    if (Array.isArray(saved?.items)) {
      for (const item of saved.items) {
        if (item && typeof item === 'object' && (item as UsageLimitItem).sessionId && (item as UsageLimitItem).runId) {
          this.items.set((item as UsageLimitItem).sessionId, item as UsageLimitItem);
        }
      }
    }
  }

  async persist(): Promise<void> {
    if (!this.filePath) return;
    await this.writeJSON(this.filePath, { items: [...this.items.values()] }).catch(() => {});
  }

  list(): UsageLimitItem[] {
    return [...this.items.values()].map(item => ({ ...item }));
  }

  async recordLimitFailure({ sessionId, runId, errorText = '', resetAt = '', failedAt = '', snoozedUntil = '', pendingApproval = false }: RecordLimitFailureInput = {}): Promise<UsageLimitItem | null> {
    if (!sessionId || !runId) return null;
    await this.load();
    const nowMs = this.now();
    const parsedReset = resetAt || parseUsageLimitReset(errorText, nowMs);
    if (!parsedReset) return null;
    const item: UsageLimitItem = {
      sessionId,
      runId,
      status: 'failed',
      lastErrorClass: 'usage_limit',
      resetAt: parsedReset,
      failedAt: failedAt || new Date(nowMs).toISOString(),
      snoozedUntil: snoozedUntil || '',
      pendingApproval: Boolean(pendingApproval),
      archived: false,
      armed: null,
      dispatched: false,
    };
    this.items.set(sessionId, item);
    await this.persist();
    await this.sweep();
    return this.items.get(sessionId) || item;
  }

  async cancel(sessionId: string): Promise<boolean> {
    const had = this.items.delete(sessionId);
    if (had) await this.persist();
    return had;
  }

  async sweep(): Promise<LimitRecoveryAction[]> {
    await this.load();
    const nowMs = this.now();
    const cfg = this.getSettings() || {};
    const autoResume = cfg.autoResumeLimitedThreads === 'on' || cfg.autoResumeLimitedThreads === true;
    const snooze = cfg.snoozeLimitedThreads !== 'off' && cfg.snoozeLimitedThreads !== false;
    const acted: LimitRecoveryAction[] = [];

    for (const candidate of this.items.values()) {
      if (this.isBusy(candidate.sessionId)) continue;
      const action = limitRecoveryAction(candidate, { autoResume, snooze, nowMs });
      if (!action) continue;
      if (action.type === 'arm') {
        candidate.armed = {
          runId: action.runId,
          resetAt: action.resetAt,
          autoResume: action.autoResume,
          snooze: action.snooze,
          armedAt: new Date(nowMs).toISOString(),
        };
        if (action.snooze) {
          candidate.snoozedUntil = action.resetAt;
          await this.onSnooze(action.sessionId, action.resetAt);
        }
        await this.persist();
        acted.push(action);
      } else if (action.type === 'resume') {
        candidate.dispatched = true;
        candidate.resumedAt = new Date(nowMs).toISOString();
        await this.persist();
        try {
          await this.onResume(action);
          this.items.delete(candidate.sessionId);
          await this.persist();
          acted.push(action);
        } catch {
          candidate.dispatched = false;
          await this.persist();
        }
      }
    }
    return acted;
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
}
