export interface GitHubQuotaGuardOptions {
  reserveRatio?: number;
  now?: () => number;
}

export interface QuotaSnapshotInput {
  remaining?: number | string | null;
  limit?: number | string | null;
  resetAt?: number | string | null;
}

export type QuotaHeadersInput =
  | { get?: (name: string) => string | null | undefined }
  | Record<string, string | string[] | undefined>
  | null
  | undefined;

export type QuotaPriority = 'interactive' | 'background';

export interface QuotaCanRunOptions {
  priority?: QuotaPriority | string;
}

export interface QuotaVerdict {
  allowed: boolean;
  reason: string;
  remaining?: number;
  floor?: number;
  resetAt?: number;
}

export interface GitHubQuotaStatus {
  remaining: number | null;
  limit: number | null;
  floor: number;
  resetAt: number;
  backgroundAllowed: boolean;
}

/**
 * Tracks GitHub REST/GraphQL rate limits and reserves a safety headroom (default 10%)
 * by shedding low-priority background polls while keeping interactive requests unblocked.
 */
export class GitHubQuotaGuard {
  reserveRatio: number;
  now: () => number;
  remaining: number | null = null;
  limit: number | null = null;
  resetAt = 0;

  constructor({ reserveRatio = 0.10, now = Date.now }: GitHubQuotaGuardOptions = {}) {
    this.reserveRatio = Math.max(0.01, Math.min(0.5, Number(reserveRatio) || 0.10));
    this.now = now;
  }

  updateSnapshot({ remaining, limit, resetAt = 0 }: QuotaSnapshotInput = {}): void {
    if (remaining !== null && remaining !== undefined && Number.isFinite(Number(remaining))) this.remaining = Math.max(0, Number(remaining));
    if (limit !== null && limit !== undefined && Number.isFinite(Number(limit)) && Number(limit) > 0) this.limit = Number(limit);
    if (resetAt !== null && resetAt !== undefined && Number.isFinite(Number(resetAt)) && Number(resetAt) > 0) {
      const n = Number(resetAt);
      this.resetAt = n < 1e12 ? n * 1000 : n;
    }
  }

  updateFromHeaders(headers: QuotaHeadersInput = {}): void {
    if (!headers) return;
    const get = (name: string): string | string[] | null | undefined =>
      typeof (headers as { get?: unknown }).get === 'function'
        ? (headers as { get: (n: string) => string | null | undefined }).get(name)
        : (headers as Record<string, string | string[] | undefined>)[name] ?? (headers as Record<string, string | string[] | undefined>)[name.toLowerCase()];
    this.updateSnapshot({
      remaining: get('x-ratelimit-remaining') as string | null | undefined,
      limit: get('x-ratelimit-limit') as string | null | undefined,
      resetAt: get('x-ratelimit-reset') as string | null | undefined,
    });
  }

  reserveFloor(): number {
    if (this.limit === null || !Number.isFinite(this.limit) || this.limit <= 0) return 0;
    return Math.max(1, Math.ceil(this.limit * this.reserveRatio));
  }

  canRun({ priority = 'interactive' }: QuotaCanRunOptions = {}): QuotaVerdict {
    if (priority !== 'background') return { allowed: true, reason: 'interactive' };
    if (this.remaining === null || this.limit === null) return { allowed: true, reason: 'unknown' };
    if (this.resetAt > 0 && this.now() >= this.resetAt) return { allowed: true, reason: 'window-reset' };
    const floor = this.reserveFloor();
    if (this.remaining <= floor) {
      return { allowed: false, reason: 'quota-reserved', remaining: this.remaining, floor, resetAt: this.resetAt };
    }
    return { allowed: true, reason: 'within-budget' };
  }

  assertAllowed(options: QuotaCanRunOptions = {}): true {
    const verdict = this.canRun(options);
    if (!verdict.allowed) {
      const err = new Error(`GitHub background poll deferred to preserve the ${Math.round(this.reserveRatio * 100)}% interactive quota reserve (${verdict.remaining} remaining, floor ${verdict.floor}).`) as Error & { code?: string };
      err.code = 'GITHUB_QUOTA_RESERVED';
      throw err;
    }
    return true;
  }

  status(): GitHubQuotaStatus {
    const bg = this.canRun({ priority: 'background' });
    return {
      remaining: this.remaining,
      limit: this.limit,
      floor: this.reserveFloor(),
      resetAt: this.resetAt,
      backgroundAllowed: bg.allowed,
    };
  }
}
