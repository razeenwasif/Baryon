import {
  A2UI_LIMITS,
  applyA2UIMessages,
  cleanId,
  cleanString,
  cleanSurface,
  extractA2UIBlocks,
  pointerSet,
  buildA2UIPrompt,
} from './page-kinds/a2ui-core.mjs';

export { applyA2UIMessages, buildA2UIPrompt, cleanSurface, extractA2UIBlocks };

export function parseUiCommand(text) {
  const raw = String(text || '').trim();
  const match = /^\/ui(?:\s+([\s\S]+))?$/i.exec(raw);
  if (!match) return { matched: false, prompt: '' };
  return { matched: true, prompt: String(match[1] || '').trim() };
}

export function cleanSurfaceList(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    if (out.length >= A2UI_LIMITS.surfaces) break;
    if (!item || typeof item !== 'object') continue;
    const cleaned = cleanSurface(item);
    if (seen.has(cleaned.surfaceId)) continue;
    seen.add(cleaned.surfaceId);
    out.push(cleaned);
  }
  return out;
}

export function updateSurfaceDataInList(list, surfaceId, path, value) {
  const targetId = cleanId(surfaceId);
  const current = cleanSurfaceList(list);
  const idx = current.findIndex(s => s.surfaceId === targetId);
  if (idx < 0) return { surfaces: current, surface: null, updated: false };
  const prev = current[idx];
  const nextData = pointerSet(prev.dataModel || {}, typeof path === 'string' ? path : '/', value);
  const nextSurface = cleanSurface({ ...prev, dataModel: nextData });
  const next = current.map((s, i) => (i === idx ? nextSurface : s));
  return { surfaces: next, surface: nextSurface, updated: true };
}

const UNSAFE_CONTEXT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function safeActionContextJson(context, maxChars = 8000) {
  if (!context || typeof context !== 'object') return '{}';
  const ancestors = [];
  let serialized;
  try {
    serialized = JSON.stringify(context, function (key, val) {
      if (UNSAFE_CONTEXT_KEYS.has(key)) return undefined;
      if (val !== null && typeof val === 'object') {
        const parentIdx = ancestors.indexOf(this);
        if (parentIdx !== -1) ancestors.splice(parentIdx + 1);
        else ancestors.push(this);
        if (ancestors.includes(val)) return '[Circular]';
      }
      return val;
    });
  } catch {
    return '{}';
  }
  if (typeof serialized !== 'string') return '{}';
  return serialized.length > maxChars ? `${serialized.slice(0, maxChars)}… [truncated]` : serialized;
}

export function formatA2UIActionPrompt({ surface = null, surfaceId = '', actionName = 'submit', sourceComponentId = '', context = {} } = {}) {
  const sid = cleanId(surface?.surfaceId || surfaceId || 'surface-1') || 'surface-1';
  const title = cleanString(surface?.title || '', 120).trim();
  const action = cleanString(actionName || 'submit', 100).trim() || 'submit';
  const source = cleanId(sourceComponentId || '');
  const payload = safeActionContextJson(context);
  const header = `[A2UI Action "${action}" on surface "${sid}"${title ? ` (${title})` : ''}${source ? ` from ${source}` : ''}]`;
  return `${header}\nData: ${payload}\nUpdate this surface (${sid}) or take the requested action based on these inputs.`;
}
