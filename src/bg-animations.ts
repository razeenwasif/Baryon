// Global background animation toggle state, persisted per window in localStorage.
// When toggled off, animated backdrops across all modes stop rendering and settle cleanly to pure #08080a black.

export const BG_ANIM_KEY = 'fairy.bgAnimOff';

export const BG_ANIM_MODES = Object.freeze([
  'home',
  'notebook',
  'research',
  'runs',
  'diffusion',
  'analytics',
] as const);

export type BgAnimMode = (typeof BG_ANIM_MODES)[number];
export type BgAnimState = boolean | Partial<Record<BgAnimMode, boolean>>;

export const BG_MODE_LABELS: Readonly<Record<BgAnimMode, string>> = Object.freeze({
  home: 'Home',
  notebook: 'Notebooks',
  research: 'Research',
  runs: 'Experiments',
  diffusion: 'Diffusion',
  analytics: 'Analytics',
});

export function activeBgMode(classList?: { contains?: (token: string) => boolean } | null): BgAnimMode {
  if (!classList || typeof classList.contains !== 'function') return 'home';
  if (classList.contains('notebook-open')) return 'notebook';
  if (classList.contains('research-open')) return 'research';
  if (classList.contains('runs-open')) return 'runs';
  if (classList.contains('diffusion-open')) return 'diffusion';
  if (classList.contains('analytics-open')) return 'analytics';
  return 'home';
}

export function loadBgAnimOff(storage: Pick<Storage, 'getItem'> | null | undefined = globalThis.localStorage): boolean {
  if (!storage || typeof storage.getItem !== 'function') return false;
  try {
    const rawText = storage.getItem(BG_ANIM_KEY);
    if (!rawText) return false;
    const raw: unknown = JSON.parse(rawText);
    if (raw === true) return true;
    if (raw === false) return false;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const record = raw as Record<string, unknown>;
      return BG_ANIM_MODES.some(mode => record[mode] === true);
    }
  } catch {
    // Corrupt storage falls back cleanly to all animations on.
  }
  return false;
}

export function saveBgAnimOff(off: unknown, storage: Pick<Storage, 'setItem'> | null | undefined = globalThis.localStorage): void {
  if (!storage || typeof storage.setItem !== 'function') return;
  const clean = off && typeof off === 'object' && !Array.isArray(off)
    ? BG_ANIM_MODES.some(mode => Boolean((off as Record<string, unknown>)[mode]))
    : Boolean(off);
  try {
    storage.setItem(BG_ANIM_KEY, JSON.stringify(clean));
  } catch {
    // Persisting the toggle preference is best-effort.
  }
}

export function toggleBgAnimOff(off: unknown): boolean {
  return !Boolean(off);
}

export function isModeBgOff(state: unknown, mode: string): boolean {
  if (typeof state === 'boolean') return state;
  return Boolean(state && (BG_ANIM_MODES as readonly string[]).includes(mode) && (state as Record<string, unknown>)[mode]);
}

export function toggleModeBgOff(state: unknown, mode: string): BgAnimState {
  if (typeof state === 'boolean') return !state;
  const next: Partial<Record<BgAnimMode, boolean>> = {};
  if (state && typeof state === 'object') {
    const record = state as Record<string, unknown>;
    for (const m of BG_ANIM_MODES) {
      if (record[m]) next[m] = true;
    }
  }
  if (!(BG_ANIM_MODES as readonly string[]).includes(mode)) return next;
  const key = mode as BgAnimMode;
  if (next[key]) delete next[key];
  else next[key] = true;
  return next;
}

export function bgAnimOffFor(_mode?: string, storage: Pick<Storage, 'getItem'> | null | undefined = globalThis.localStorage): boolean {
  return loadBgAnimOff(storage);
}
