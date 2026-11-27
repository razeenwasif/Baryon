// Separate from conversation ideas: vocals never count as unanswered messages.
export class VocalTimer {
  constructor({ now = Date.now, random = Math.random, lastAttempt = 0 } = {}) {
    this.now = now; this.random = random; this.minutes = 20; this.lastAttempt = lastAttempt; this.defer();
  }
  configure(minutes) { if (minutes !== this.minutes) { this.minutes = minutes; this.defer(); } }
  defer() { this.nextAt = Math.max(this.nextAt || 0, this.now() + this.minutes * 60000 * (1 + this.random() * .25)); }
  due(blocked) { return !blocked && this.now() >= this.nextAt && this.now() - this.lastAttempt >= this.minutes * 60000; }
  attempted() { this.lastAttempt = this.now(); this.defer(); return this.lastAttempt; }
  snooze() { this.nextAt = this.now() + Math.max(30, this.minutes) * 60000; }
  choose(mode) { return mode === 'hum' || this.random() < .75 ? 'hum' : 'sing'; }
}
