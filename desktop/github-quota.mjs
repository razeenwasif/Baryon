/**
 * Tracks GitHub REST/GraphQL rate limits and reserves a safety headroom (default 10%)
 * by shedding low-priority background polls while keeping interactive requests unblocked.
 */
export class GitHubQuotaGuard {
  constructor({ reserveRatio = 0.10, now = Date.now } = {}) {
    this.reserveRatio = Math.max(0.01, Math.min(0.5, Number(reserveRatio) || 0.10));
    this.now = now;
    this.remaining = null;
    this.limit = null;
    this.resetAt = 0;
  }

  updateSnapshot({ remaining, limit, resetAt = 0 } = {}) {
    if (Number.isFinite(Number(remaining))) this.remaining = Math.max(0, Number(remaining));
    if (Number.isFinite(Number(limit)) && Number(limit) > 0) this.limit = Number(limit);
    if (Number.isFinite(Number(resetAt)) && Number(resetAt) > 0) {
      const n = Number(resetAt);
      this.resetAt = n < 1e12 ? n * 1000 : n;
    }
  }

  updateFromHeaders(headers = {}) {
    if (!headers) return;
    const get = name => (typeof headers.get === 'function' ? headers.get(name) : headers[name] ?? headers[name.toLowerCase()]);
    this.updateSnapshot({
      remaining: get('x-ratelimit-remaining'),
      limit: get('x-ratelimit-limit'),
      resetAt: get('x-ratelimit-reset'),
    });
  }

  reserveFloor() {
    if (!Number.isFinite(this.limit) || this.limit <= 0) return 0;
    return Math.max(1, Math.ceil(this.limit * this.reserveRatio));
  }

  canRun({ priority = 'interactive' } = {}) {
    if (priority !== 'background') return { allowed: true, reason: 'interactive' };
    if (this.remaining === null || this.limit === null) return { allowed: true, reason: 'unknown' };
    if (this.resetAt > 0 && this.now() >= this.resetAt) return { allowed: true, reason: 'window-reset' };
    const floor = this.reserveFloor();
    if (this.remaining <= floor) {
      return { allowed: false, reason: 'quota-reserved', remaining: this.remaining, floor, resetAt: this.resetAt };
    }
    return { allowed: true, reason: 'within-budget' };
  }

  assertAllowed(options = {}) {
    const verdict = this.canRun(options);
    if (!verdict.allowed) {
      const err = new Error(`GitHub background poll deferred to preserve the ${Math.round(this.reserveRatio * 100)}% interactive quota reserve (${verdict.remaining} remaining, floor ${verdict.floor}).`);
      err.code = 'GITHUB_QUOTA_RESERVED';
      throw err;
    }
    return true;
  }

  status() {
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
