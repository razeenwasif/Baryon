// Time-based policy kept independent of the UI so interruptions can be tested.
export interface ConversationTimerOptions {
  now?: () => number;
  random?: () => number;
}

export class ConversationTimer {
  now: () => number;
  random: () => number;
  minutes: number;
  unanswered: number;
  nextAt: number;

  constructor({ now = () => Date.now(), random = Math.random }: ConversationTimerOptions = {}) {
    this.now = now;
    this.random = random;
    this.minutes = 5;
    this.unanswered = 0;
    this.nextAt = 0;
    this.reset();
  }

  reset(): void {
    this.nextAt = this.now() + this.minutes * 60000 * (1 + this.random() * 0.25);
  }

  configure(minutes: number): void {
    this.minutes = minutes;
    this.reset();
  }

  engage(): void {
    this.unanswered = 0;
    this.reset();
  }

  defer(): void {
    this.nextAt = Math.max(this.nextAt, this.now() + this.minutes * 60000 * (1 + this.random() * 0.25));
  }

  snooze(): void {
    this.nextAt = this.now() + 30 * 60000;
  }

  delivered(): void {
    this.unanswered++;
    this.reset();
    if (this.unanswered === 1) this.nextAt += this.minutes * 60000;
  }

  due(blocked: boolean): boolean {
    return !blocked && this.unanswered < 2 && this.now() >= this.nextAt;
  }
}
