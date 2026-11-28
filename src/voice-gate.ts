// Intent routing is local. This is a wake-name gate, not speaker identification.
// Apple's recognizer often writes "Fairy" as another word, and its name hint does not
// change that. Unusual spellings always count. Sound-alikes such as "Mary" or "very"
// count only straight after "hey", and "ferry" or "february" (from "hey fairy" run
// together) when called on their own, so "fairly sure…" never wakes Fairy.
const MISHEARD = {
  bare: ['Fairey', 'Faerie', 'Faery', 'Fairie'],
  afterHey: '(?:f|ph|m|b|v)(?:ai|ae|a|e)r+(?:y|ie|i|ey)|fairly|fiery|fury|furry',
  called: 'ferry|fairly|february',
} as const;

// Spoken when Fairy is called with nothing else, so the wake is heard as well as seen.
export const WAKE_REPLIES: string[] = ['Yes?', 'I’m here.', 'I’m listening.', 'What’s up?'];

export interface VoiceGateOptions {
  now?: () => number;
}

export interface VoiceGateAcceptOptions {
  name?: string;
  followups?: boolean;
  startedAt?: number;
}

export type VoiceGateResult =
  | { kind: 'pause' }
  | { kind: 'dismiss' }
  | { kind: 'wake' }
  | { kind: 'message'; text: string };

export class VoiceGate {
  now: () => number;
  until: number;
  openedAt: number;

  constructor({ now = Date.now }: VoiceGateOptions = {}) {
    this.now = now;
    this.until = 0;
    this.openedAt = 0;
  }

  close(): void {
    this.until = 0;
  }

  engage(seconds = 12): void {
    this.openedAt = this.now();
    this.until = this.openedAt + seconds * 1000;
  }

  get engaged(): boolean {
    return this.now() < this.until;
  }

  accept(
    value: string,
    { name = 'Fairy', followups = true, startedAt = this.now() }: VoiceGateAcceptOptions = {},
  ): VoiceGateResult | null {
    const text = value.trim();
    const alt = (list: string[]): string =>
      [...new Set(list.filter(Boolean))]
        .sort((a, b) => b.length - a.length)
        .map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');
    const names = alt(['Fairy', ...MISHEARD.bare, 'Robin', 'Lyra', 'Stella', 'Mavuika', 'Mav', name]);
    const greeting = '(?:hey|hi|hello|okay|ok)\\s*[,!.:]?\\s+';
    const wake = new RegExp(
      `^(?:hey\\s*[,!.:]?\\s+(?:${MISHEARD.afterHey})|(?:${MISHEARD.called})(?=\\s*(?:[,.!?]|$))|(?:${greeting})?(?:${names}))(?=$|[\\s,!.:;?])[,!.:;?\\s]*`,
      'i',
    );
    const match = text.match(wake);
    // A reply begun inside the window remains eligible while local ASR finishes.
    if (!match && !(followups && startedAt >= this.openedAt && startedAt < this.until)) return null;
    const content = (match ? text.slice(match[0].length) : text).trim();
    if (/^(?:stop listening|pause listening|microphone off)[.!?]*$/i.test(content)) {
      this.close();
      return { kind: 'pause' };
    }
    if (/^(?:never ?mind|that(?:'s| is) all|thanks[, ]+that(?:'s| is) all|goodbye)[.!?]*$/i.test(content)) {
      this.close();
      return { kind: 'dismiss' };
    }
    if (!content) {
      if (followups) this.engage();
      return { kind: 'wake' };
    }
    this.close(); // Reopen only after the reply finishes, not while it is generated.
    return { kind: 'message', text: content };
  }
}

// Bounded, adaptive energy detection; recognition filters non-speech locally.
export class UtteranceDetector {
  rate: number;
  noise: number;
  pre!: Float32Array[];
  frames!: Float32Array[];
  started!: boolean;
  loud!: number;
  voiced!: number;
  quiet!: number;
  length!: number;

  constructor(rate = 48000) {
    this.rate = rate;
    this.noise = 0.002;
    this.reset();
  }

  reset(): void {
    this.pre = [];
    this.frames = [];
    this.started = false;
    this.loud = 0;
    this.voiced = 0;
    this.quiet = 0;
    this.length = 0;
  }

  push(frame: Float32Array, blocked = false): Float32Array | null {
    if (blocked) {
      this.reset();
      return null;
    }
    const seconds = frame.length / this.rate;
    const rms = Math.sqrt(frame.reduce((sum, x) => sum + x * x, 0) / frame.length);
    const loud = rms > Math.max(0.008, this.noise * 3);
    if (!this.started) {
      if (!loud) this.noise = 0.98 * this.noise + 0.02 * Math.min(rms, 0.01);
      this.pre.push(frame);
      while (this.pre.length > Math.ceil(0.3 / seconds)) this.pre.shift();
      this.loud = loud ? this.loud + seconds : 0;
      if (this.loud < 0.1) return null;
      this.started = true;
      this.frames = this.pre;
      this.pre = [];
      this.voiced = this.loud;
      this.length = this.frames.reduce((n, f) => n + f.length, 0);
    } else {
      this.frames.push(frame);
      this.length += frame.length;
      if (loud) this.voiced += seconds;
    }
    this.quiet = loud ? 0 : this.quiet + seconds;
    if (this.quiet < 0.9 && this.length < this.rate * 20) return null;
    const result = this.voiced >= 0.24 ? new Float32Array(this.length) : null;
    if (result) {
      let at = 0;
      for (const f of this.frames) {
        result.set(f, at);
        at += f.length;
      }
    }
    this.reset();
    return result;
  }
}

// Suppress recognizable fragments of our own current spoken reply after ASR.
export function isPlaybackEcho(heard: string, spoken: string): boolean {
  const normalize = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const input = normalize(heard), output = normalize(spoken);
  return input.length >= 12 && output.includes(input);
}
