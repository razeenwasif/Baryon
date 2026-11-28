// Recognizes the wake phrase by its sound, because Apple's recognizer often writes a lone
// "Fairy" as another word. Setup keeps sound features of a few takes, never the audio.
const RATE = 16000, FRAME = 400, HOP = 160, FFT = 512, MELS = 26, COEFFS = 12, TRIM_DB = 32;
const WHOLE_MIN = .55, WHOLE_MAX = 1.7, MAX_SECONDS = 3;
// Measured on system voices: everyday speech stayed out of range up to about 8.5, and other
// voices up to 6. Each threshold comes from how consistent that person's own takes were.
const SETUP_MARGIN = 1.3, MIN_THRESHOLD = 5, MAX_THRESHOLD = 8.5, PREFIX_STRICTNESS = .92;

export interface WakeTakeInput {
  phrase: string;
  samples: Float32Array | number[];
  rate: number;
  heard?: string;
}

export interface WakeTemplate {
  phrase: string;
  frames: number[][];
}

export interface WakeProfile {
  version: 1;
  name: string;
  threshold: number;
  templates: WakeTemplate[];
  phrases: string[];
}

function resample(samples: ArrayLike<number>, rate: number): Float32Array {
  if (rate === RATE) return Float32Array.from(samples);
  const ratio = rate / RATE, out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const from = Math.floor(i * ratio), to = Math.max(from + 1, Math.floor((i + 1) * ratio));
    let sum = 0; for (let j = from; j < to; j++) sum += samples[j] || 0;
    out[i] = sum / (to - from);
  }
  return out;
}

function powerSpectrum(frame: Float64Array): Float64Array {
  const re = new Float64Array(FFT), im = new Float64Array(FFT);
  re.set(frame.subarray(0, FFT));
  for (let i = 1, j = 0; i < FFT; i++) {
    let bit = FFT >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; }
  }
  for (let size = 2; size <= FFT; size <<= 1) {
    const step = -2 * Math.PI / size;
    for (let start = 0; start < FFT; start += size) for (let k = 0; k < size / 2; k++) {
      const w = step * k, wr = Math.cos(w), wi = Math.sin(w), a = start + k, b = a + size / 2;
      const tr = wr * re[b] - wi * im[b], ti = wr * im[b] + wi * re[b];
      re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
    }
  }
  const power = new Float64Array(FFT / 2 + 1);
  for (let i = 0; i < power.length; i++) power[i] = re[i] * re[i] + im[i] * im[i];
  return power;
}

const toMel = (hz: number) => 2595 * Math.log10(1 + hz / 700);
const fromMel = (mel: number) => 700 * (10 ** (mel / 2595) - 1);
const melFilters: Array<[number, number, number]> = (() => {
  const low = toMel(100), high = toMel(7000), bins: number[] = [];
  for (let i = 0; i < MELS + 2; i++) bins.push(Math.floor((FFT + 1) * fromMel(low + (high - low) * i / (MELS + 1)) / RATE));
  return Array.from({ length: MELS }, (_, m) => [bins[m], bins[m + 1], bins[m + 2]]);
})();
const window_ = Float64Array.from({ length: FRAME }, (_, i) => .54 - .46 * Math.cos(2 * Math.PI * i / (FRAME - 1)));

// Cepstral frames of the speech in a clip, with the silence around it trimmed.
export function soundFrames(samples: ArrayLike<number>, rate: number, maxSeconds = MAX_SECONDS): Float32Array[] {
  const audio = resample(samples, rate), frames: Float32Array[] = [], energies: number[] = [];
  for (let start = 0; start + FRAME <= audio.length; start += HOP) {
    const frame = new Float64Array(FFT); let energy = 1e-10;
    for (let i = 0; i < FRAME; i++) { const value = audio[start + i] - .97 * (audio[start + i - 1] || 0); frame[i] = value * window_[i]; energy += value * value; }
    energies.push(10 * Math.log10(energy));
    const power = powerSpectrum(frame), logs = melFilters.map(([a, b, c]) => {
      let sum = 1e-10;
      for (let i = a; i < b; i++) sum += power[i] * (i - a) / Math.max(1, b - a);
      for (let i = b; i < c; i++) sum += power[i] * (c - i) / Math.max(1, c - b);
      return Math.log(sum);
    });
    const coeffs = new Float32Array(COEFFS);
    for (let n = 1; n <= COEFFS; n++) { let sum = 0; for (let m = 0; m < MELS; m++) sum += logs[m] * Math.cos(Math.PI * n * (m + .5) / MELS); coeffs[n - 1] = sum * Math.sqrt(2 / MELS); }
    frames.push(coeffs);
  }
  if (!frames.length) return [];
  const floor = Math.max(...energies) - TRIM_DB;
  const first = energies.findIndex(energy => energy > floor);
  let last = energies.length - 1;
  while (last > first && energies[last] <= floor) last--;
  return frames.slice(first, Math.min(last + 1, first + Math.round(maxSeconds * RATE / HOP)));
}

// Removes the microphone's fixed colouring, then adds how each coefficient is changing.
function normalize(frames: ArrayLike<number>[]): Float32Array[] {
  if (!frames.length) return [];
  const mean = new Float32Array(COEFFS);
  for (const frame of frames) for (let i = 0; i < COEFFS; i++) mean[i] += frame[i] / frames.length;
  const flat = frames.map(frame => Float32Array.from(frame, (value, i) => value - mean[i]));
  return flat.map((frame, t) => {
    const before = flat[Math.max(0, t - 2)], after = flat[Math.min(flat.length - 1, t + 2)], full = new Float32Array(COEFFS * 2);
    full.set(frame); for (let i = 0; i < COEFFS; i++) full[COEFFS + i] = (after[i] - before[i]) * .5;
    return full;
  });
}

// Dynamic time warping, so speaking faster or slower doesn't change the match.
function warp(template: Float32Array[], clip: Float32Array[], freeEnd: boolean): number {
  const n = template.length, m = clip.length; if (!n || !m) return Infinity;
  const band = Math.max(Math.abs(n - m), Math.round(Math.max(n, m) * .35)) + 2;
  let previous = new Float64Array(m + 1).fill(Infinity), current = new Float64Array(m + 1);
  previous[0] = 0;
  for (let i = 1; i <= n; i++) {
    current.fill(Infinity);
    for (let j = Math.max(1, i - band); j <= Math.min(m, i + band); j++) {
      let cost = 0; const a = template[i - 1], b = clip[j - 1];
      for (let k = 0; k < a.length; k++) { const d = a[k] - b[k]; cost += d * d; }
      current[j] = Math.sqrt(cost) + Math.min(previous[j], previous[j - 1], current[j - 1]);
    }
    [previous, current] = [current, previous];
  }
  if (!freeEnd) return previous[m] / (n + m) * 2;
  let best = Infinity;
  for (let j = Math.floor(n * .7); j <= m; j++) best = Math.min(best, previous[j] / (n + j) * 2);
  return best;
}

const closest = (distances: number[], keep = 2): number => {
  const sorted = distances.filter(Number.isFinite).sort((a, b) => a - b).slice(0, keep);
  return sorted.length ? sorted.reduce((a, b) => a + b) / sorted.length : Infinity;
};

// Turns recorded takes into a saved profile. takes: [{ phrase: 'hey'|'name', samples, rate, heard }].
export function buildWakeProfile(takes: WakeTakeInput[], name: string): WakeProfile {
  const templates = takes.map(({ phrase, samples, rate }) => ({ phrase, frames: soundFrames(samples, rate) })).filter(take => take.frames.length >= 12);
  if (templates.length < 3) throw new Error('Those takes were too quiet or too short. Try again a little closer to the microphone.');
  const normalized = templates.map(take => normalize(take.frames)), spreads: number[] = [];
  templates.forEach((take, i) => {
    const others = normalized.filter((_, j) => j !== i && templates[j].phrase === take.phrase).map(other => warp(other, normalized[i], false));
    if (others.length) spreads.push(closest(others));
  });
  const spread = spreads.length ? Math.max(...spreads) : MIN_THRESHOLD;
  return {
    version: 1,
    name,
    threshold: Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, spread * SETUP_MARGIN)),
    templates: templates.map(take => ({ phrase: take.phrase, frames: take.frames.map(frame => Array.from(frame, value => Math.round(value * 100) / 100 || 0)) })),
    phrases: learnedPhrases(takes, name),
  };
}

// Is this clip the wake phrase, or does it start with it? Returns 'whole', 'prefix' or null.
export function matchWake(profile: WakeProfile | null | undefined, samples: Float32Array | number[], rate: number): 'whole' | 'prefix' | null {
  if (!profile?.templates?.length) return null;
  // The opening seconds decide this; a long sentence needn't be measured in full.
  const slice = samples.length > rate * 8
    ? (samples instanceof Float32Array ? samples.subarray(0, rate * 8) : samples.slice(0, rate * 8))
    : samples;
  const clip = soundFrames(slice, rate, 8);
  if (clip.length < 12) return null;
  const whole: number[] = [], prefix: number[] = [];
  for (const template of profile.templates) {
    const size = template.frames.length, ratio = clip.length / size;
    if (ratio >= WHOLE_MIN && ratio <= WHOLE_MAX) whole.push(warp(normalize(template.frames), normalize(clip), false));
    // A lone word also starts many sentences ("very good"), so only "hey …" takes can open one.
    if (template.phrase === 'hey' && ratio > WHOLE_MAX) prefix.push(warp(normalize(template.frames), normalize(clip.slice(0, Math.round(size * 1.35))), true));
  }
  if (closest(whole) <= profile.threshold) return 'whole';
  if (closest(prefix) <= profile.threshold * PREFIX_STRICTNESS) return 'prefix';
  return null;
}

// Profiles come from disk, so check their shape before trusting them.
export function cleanWakeProfile(raw: unknown): WakeProfile | null {
  const value = raw as Partial<WakeProfile> | null | undefined;
  if (!value || value.version !== 1 || typeof value.name !== 'string' || !Number.isFinite(value.threshold)) return null;
  if (!Array.isArray(value.templates) || !value.templates.length || value.templates.length > 12) return null;
  const templates = value.templates.filter(take => ['hey', 'name'].includes(take?.phrase) && Array.isArray(take.frames) && take.frames.length >= 12 && take.frames.length <= 400 && take.frames.every(frame => Array.isArray(frame) && frame.length === COEFFS && frame.every(Number.isFinite)));
  if (templates.length !== value.templates.length) return null;
  const phrases = Array.isArray(value.phrases) ? value.phrases.filter(phrase => typeof phrase === 'string' && phrase.length <= 60 && couldBeName(phrase, value.name)).slice(0, 12) : [];
  return { version: 1, name: value.name.slice(0, 160), threshold: Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, value.threshold as number)), templates, phrases };
}

const clean = (text: unknown): string => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s']+/gu, ' ').replace(/\s+/g, ' ').trim();

function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}

const GREETING = /^(?:hey|hi|hello|okay|ok|a) /;

// Could these words be the name, misheard? "Hey Siri" and "very" could. "Mhm" and "thank you" couldn't.
export function couldBeName(text: unknown, name = 'Fairy'): boolean {
  const heard = clean(text).replace(GREETING, '').replace(/ /g, ''), own = clean(name).replace(/ /g, '');
  return Boolean(heard) && editDistance(heard, own) <= Math.ceil(own.length * .6);
}

// A sound match can't stand alone, because doors, music and other people's speech reach it too.
// It only settles what the recognizer wrote when those words could be the name.
export function soundAgrees(wake: string | null | undefined, text: unknown, name?: string): boolean {
  if (wake === 'whole') return couldBeName(text, name);
  if (wake !== 'prefix') return false;
  const words = clean(text).split(' ');
  return couldBeName(words.slice(0, GREETING.test(`${words[0]} `) ? 2 : 1).join(' '), name);
}

// What the recognizer wrote for this person's takes, so those spellings count from now on.
export function learnedPhrases(takes: Array<{ heard?: string }>, name: string): string[] {
  const own = clean(name), phrases = new Set<string>();
  for (const { heard } of takes) {
    const phrase = clean(heard);
    if (phrase && phrase !== own && phrase !== `hey ${own}` && phrase.split(' ').length <= 3 && couldBeName(phrase, name)) phrases.add(phrase);
  }
  return [...phrases].slice(0, 12);
}

// Rewrites a learned mishearing to the real name. "hey …" phrases can open a sentence;
// anything else must be the whole utterance, so "very good" stays ordinary speech.
export function restoreName(text: string, profile: WakeProfile | null | undefined): string {
  if (!profile?.phrases?.length) return text;
  const value = String(text || ''), heard = clean(value), name = profile.name || 'Fairy';
  if (profile.phrases.includes(heard)) return name;
  for (const phrase of profile.phrases) {
    if (!/^(?:hey|hi|hello|okay|ok) /.test(phrase) || !heard.startsWith(`${phrase} `)) continue;
    const words = phrase.split(' ').length, rest = value.trim().split(/\s+/).slice(words).join(' ');
    return `${name}, ${rest}`;
  }
  return text;
}

// With the sound matched, the recognizer's first words were the name, however it spelled them.
export function dropOpeningWords(text: unknown): string {
  return String(text || '').trim().replace(/^(?:(?:hey|hi|hello|okay|ok|a)\b[,!.:]?\s+)?[^\s,!.:;?]+[,!.:;?]*\s*/i, '');
}
