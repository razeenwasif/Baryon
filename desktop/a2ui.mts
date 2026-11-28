import {
  A2UI_LIMITS,
  applyA2UIMessages,
  cleanId,
  cleanString,
  cleanSurface,
  extractA2UIBlocks,
  pointerSet,
  buildA2UIPrompt,
  type A2UISurface,
} from './page-kinds/a2ui-core.mjs';

export { applyA2UIMessages, buildA2UIPrompt, cleanSurface, extractA2UIBlocks };

export interface ParsedUiCommand {
  matched: boolean;
  prompt: string;
}

export interface UpdateSurfaceDataResult {
  surfaces: A2UISurface[];
  surface: A2UISurface | null;
  updated: boolean;
}

export interface FormatA2UIActionPromptOptions {
  surface?: A2UISurface | null;
  surfaceId?: string;
  actionName?: string;
  sourceComponentId?: string;
  context?: unknown;
}

export function parseUiCommand(text: unknown): ParsedUiCommand {
  const raw = String(text || '').trim();
  const match = /^\/ui(?:\s+([\s\S]+))?$/i.exec(raw);
  if (!match) return { matched: false, prompt: '' };
  return { matched: true, prompt: String(match[1] || '').trim() };
}

export function cleanSurfaceList(list: unknown): A2UISurface[] {
  if (!Array.isArray(list)) return [];
  const out: A2UISurface[] = [];
  const seen = new Set<string>();
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

export function updateSurfaceDataInList(
  list: unknown,
  surfaceId: unknown,
  path: unknown,
  value: unknown,
): UpdateSurfaceDataResult {
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

export function safeActionContextJson(context: unknown, maxChars = 8000): string {
  if (!context || typeof context !== 'object') return '{}';
  const ancestors: unknown[] = [];
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(context, function (this: unknown, key: string, val: unknown) {
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

export function formatA2UIActionPrompt({
  surface = null,
  surfaceId = '',
  actionName = 'submit',
  sourceComponentId = '',
  context = {},
}: FormatA2UIActionPromptOptions = {}): string {
  const sid = cleanId(surface?.surfaceId || surfaceId || 'surface-1') || 'surface-1';
  const title = cleanString(surface?.title || '', 120).trim();
  const action = cleanString(actionName || 'submit', 100).trim() || 'submit';
  const source = cleanId(sourceComponentId || '');
  const payload = safeActionContextJson(context);
  const header = `[A2UI Action "${action}" on surface "${sid}"${title ? ` (${title})` : ''}${source ? ` from ${source}` : ''}]`;
  return `${header}\nData: ${payload}\nUpdate this surface (${sid}) or take the requested action based on these inputs.`;
}
