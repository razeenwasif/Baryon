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
]);

export const BG_MODE_LABELS = Object.freeze({
  home: 'Home',
  notebook: 'Notebooks',
  research: 'Research',
  runs: 'Experiments',
  diffusion: 'Diffusion',
  analytics: 'Analytics',
});

export function activeBgMode(classList) {
  if (!classList || typeof classList.contains !== 'function') return 'home';
  if (classList.contains('notebook-open')) return 'notebook';
  if (classList.contains('research-open')) return 'research';
  if (classList.contains('runs-open')) return 'runs';
  if (classList.contains('diffusion-open')) return 'diffusion';
  if (classList.contains('analytics-open')) return 'analytics';
  return 'home';
}

export function loadBgAnimOff(storage = globalThis.localStorage) {
  if (!storage || typeof storage.getItem !== 'function') return false;
  try {
    const rawText = storage.getItem(BG_ANIM_KEY);
    if (!rawText) return false;
    const raw = JSON.parse(rawText);
    if (raw === true) return true;
    if (raw === false) return false;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return BG_ANIM_MODES.some(mode => raw[mode] === true);
    }
  } catch {
    // Corrupt storage falls back cleanly to all animations on.
  }
  return false;
}

export function saveBgAnimOff(off, storage = globalThis.localStorage) {
  if (!storage || typeof storage.setItem !== 'function') return;
  const clean = off && typeof off === 'object' && !Array.isArray(off)
    ? BG_ANIM_MODES.some(mode => Boolean(off[mode]))
    : Boolean(off);
  try {
    storage.setItem(BG_ANIM_KEY, JSON.stringify(clean));
  } catch {
    // Persisting the toggle preference is best-effort.
  }
}

export function toggleBgAnimOff(off) {
  return !Boolean(off);
}

export function isModeBgOff(state, mode) {
  if (typeof state === 'boolean') return state;
  return Boolean(state && BG_ANIM_MODES.includes(mode) && state[mode]);
}

export function toggleModeBgOff(state, mode) {
  if (typeof state === 'boolean') return !state;
  const next = {};
  if (state && typeof state === 'object') {
    for (const m of BG_ANIM_MODES) {
      if (state[m]) next[m] = true;
    }
  }
  if (!BG_ANIM_MODES.includes(mode)) return next;
  if (next[mode]) delete next[mode];
  else next[mode] = true;
  return next;
}

export function bgAnimOffFor(_mode, storage = globalThis.localStorage) {
  return loadBgAnimOff(storage);
}
