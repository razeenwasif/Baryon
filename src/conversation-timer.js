// Time-based policy kept independent of the UI so interruptions can be tested.
export class ConversationTimer {
  constructor({ now = () => Date.now(), random = Math.random } = {}) {
    this.now = now; this.random = random; this.minutes = 5; this.unanswered = 0;
    this.reset();
  }
  reset() { this.nextAt = this.now() + this.minutes * 60000 * (1 + this.random() * .25); }
  configure(minutes) { this.minutes = minutes; this.reset(); }
  engage() { this.unanswered = 0; this.reset(); }
  defer() { this.nextAt = Math.max(this.nextAt, this.now() + this.minutes * 60000 * (1 + this.random() * .25)); }
  snooze() { this.nextAt = this.now() + 30 * 60000; }
  delivered() { this.unanswered++; this.reset(); if (this.unanswered === 1) this.nextAt += this.minutes * 60000; }
  due(blocked) { return !blocked && this.unanswered < 2 && this.now() >= this.nextAt; }
}
