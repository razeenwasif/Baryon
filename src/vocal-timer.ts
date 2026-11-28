// Separate from conversation ideas: vocals never count as unanswered messages.
export type VocalChoice = 'hum' | 'sing';

export interface VocalTimerOptions {
  now?: () => number;
  random?: () => number;
  lastAttempt?: number;
}

export class VocalTimer {
  now: () => number;
  random: () => number;
  minutes: number;
  lastAttempt: number;
  nextAt: number;

  constructor({ now = Date.now, random = Math.random, lastAttempt = 0 }: VocalTimerOptions = {}) {
    this.now = now;
    this.random = random;
    this.minutes = 20;
    this.lastAttempt = lastAttempt;
    this.nextAt = 0;
    this.defer();
  }

  configure(minutes: number): void {
    if (minutes !== this.minutes) {
      this.minutes = minutes;
      this.defer();
    }
  }

  defer(): void {
    this.nextAt = Math.max(this.nextAt || 0, this.now() + this.minutes * 60000 * (1 + this.random() * 0.25));
  }

  due(blocked?: boolean): boolean {
    return !blocked && this.now() >= this.nextAt && this.now() - this.lastAttempt >= this.minutes * 60000;
  }

  attempted(): number {
    this.lastAttempt = this.now();
    this.defer();
    return this.lastAttempt;
  }

  snooze(): void {
    this.nextAt = this.now() + Math.max(30, this.minutes) * 60000;
  }

  choose(mode?: string): VocalChoice {
    return mode === 'hum' || this.random() < 0.75 ? 'hum' : 'sing';
  }
}
