import { browserActions, ordinaryWebURL, safariContext, searchURL, type DesktopContextDimensions, type DesktopFocus } from './browser.mjs';

export interface DesktopPoint {
  x: number;
  y: number;
}

export interface DesktopAction {
  type?: string;
  button?: string;
  x?: number;
  y?: number;
  path?: DesktopPoint[];
  scroll_x?: number;
  scroll_y?: number;
  keys?: string[];
  text?: string;
  bundle_id?: string;
  url?: string;
  query?: string;
  direction?: string;
}

export interface DesktopBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ActionReviewDimensions extends DesktopContextDimensions {
  width?: number;
  height?: number;
  bounds?: DesktopBounds;
}

export interface ActionReviewResult {
  required: boolean;
  reason: string;
}

export interface ActionPreviewResult {
  app: string;
  steps: string[];
  text: string;
}

const safeApps = new Set(['com.apple.calculator', 'com.apple.finder', 'com.apple.Preview', 'com.apple.TextEdit', 'com.apple.Safari']);
const safeSearches = new Set(['calculator', 'finder', 'preview', 'textedit', 'safari']);
const normalized = (value: unknown): string | null => typeof value === 'string' ? value.trim().toLowerCase() : null;
const keysOf = (action: DesktopAction): string[] => (action.keys || []).map(key => key.toUpperCase().replace(/^(COMMAND|META|SUPER)$/, 'CMD'));
const sameKeys = (keys: string[], expected: string[]): boolean => keys.length === expected.length && expected.every(key => keys.includes(key));

// Deliberately use native context and a narrow allowlist, never a model's
// self-reported risk level. Any unrecognized action makes the whole batch reviewable.
export function actionReview(actions: DesktopAction[], dimensions: ActionReviewDimensions = {}): ActionReviewResult {
  const focus: DesktopFocus = dimensions.focus || {};
  let calculator = Boolean(focus.bundleId === 'com.apple.calculator' && focus.bundlePath === '/System/Applications/Calculator.app' && focus.window?.standard && !focus.window?.hasSheet);
  let windowValid = true;
  let browser = safariContext(focus);
  let spotlight = focus.bundleId === 'com.apple.Spotlight' && focus.bundlePath === '/System/Library/CoreServices/Spotlight.app';
  let query: string | null = spotlight ? normalized(focus.query) : null;
  const inside = (action: DesktopAction): boolean => {
    const window = focus.window, display = dimensions.bounds;
    if (!windowValid || !window || !display || !dimensions.width || !dimensions.height) return false;
    if (window.x == null || window.y == null || window.width == null || window.height == null) return false;
    const x = display.x + (action.x ?? NaN) * display.width / dimensions.width;
    const y = display.y + (action.y ?? NaN) * display.height / dimensions.height;
    return x >= window.x && y >= window.y && x < window.x + window.width && y < window.y + window.height;
  };
  if (!Array.isArray(actions) || !actions.length) return { required: true, reason: 'No actions could be classified.' };
  for (const action of actions) {
    if (action.type && browserActions.includes(action.type)) {
      if (!browser || actions.length !== 1) return { required: true, reason: 'Browser actions need an observed Safari window and a separate batch.' };
      if (action.type === 'browser_navigate' && ordinaryWebURL(action.url)) continue;
      if (action.type === 'browser_search') { try { searchURL(action.query); continue; } catch {} }
      if (action.type === 'browser_tab' && action.direction && ['next', 'previous'].includes(action.direction)) continue;
      return { required: true, reason: 'This address could trigger an account action, download, or other change. Review the destination before opening it.' };
    }
    if (action.type && ['wait', 'screenshot', 'move'].includes(action.type)) continue;
    if (action.type === 'open_app' && action.bundle_id && safeApps.has(action.bundle_id)) {
      calculator = false; browser = false; windowValid = false; spotlight = false; query = null; continue;
    }
    if (action.type === 'keypress') {
      const keys = keysOf(action);
      if (!spotlight && sameKeys(keys, ['CMD', 'SPACE'])) {
        calculator = false; browser = false; windowValid = false; spotlight = true; query = null; continue;
      }
      if (spotlight && sameKeys(keys, ['CMD', 'A'])) { query = ''; continue; }
      if (spotlight && keys.length === 1 && ['ENTER', 'RETURN'].includes(keys[0]) && query !== null && safeSearches.has(query)) {
        spotlight = false; windowValid = false; calculator = false; query = null; continue;
      }
      if (calculator && keys.length === 1 && /^(?:[0-9=./-]|ENTER|RETURN|ESC|ESCAPE|BACKSPACE)$/.test(keys[0])) continue;
      if (calculator && sameKeys(keys, ['SHIFT', '='])) continue;
    }
    if (action.type === 'type') {
      const textQuery = normalized(action.text);
      if (spotlight && textQuery !== null && safeSearches.has(textQuery) && typeof action.text === 'string' && !/[\r\n\t]/.test(action.text) && query === '') { query = textQuery; continue; }
      if (calculator && typeof action.text === 'string' && /^[0-9 .+−×÷*/()%=-]+$/.test(action.text)) continue;
    }
    if (calculator && action.type === 'click' && action.button === 'left' && inside(action)) {
      // A click might open a menu or dialog. Observe again before further input.
      calculator = false; browser = false; windowValid = false; continue;
    }
    if (action.type === 'scroll' && inside(action)) continue;
    return { required: true, reason: 'This action may change data or leave the verified app context. Review it before continuing.' };
  }
  return { required: false, reason: 'Recognized navigation, application launch, or calculator input.' };
}

// A batch in words, for the approval card in the window, the companion and a paired phone ("Improving existing
// features", item 8): one line a step, the app it happens in and the screen's size, instead of the batch's JSON.
const quoted = (text: unknown, limit = 160): string => { const flat = String(text ?? '').replace(/\s+/g, ' '); return `“${flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat}”${flat.length > limit ? ` (${flat.length} characters)` : ''}`; };
const at = (action: { x?: number; y?: number } = {}): string => `${Math.round(action.x ?? NaN)}, ${Math.round(action.y ?? NaN)}`;
export function actionStep(action: DesktopAction = {}): string {
  switch (action.type) {
    case 'click': return `${(action.button ? { right: 'Right-click', middle: 'Middle-click' }[action.button] : undefined) || 'Click'} at ${at(action)}`;
    case 'double_click': return `Double-click at ${at(action)}`;
    case 'move': return `Move the pointer to ${at(action)}`;
    case 'drag': { const path = Array.isArray(action.path) ? action.path : []; return path.length ? `Drag from ${at(path[0])} to ${at(path.at(-1))}` : 'Drag'; }
    case 'scroll': { const down = Number(action.scroll_y) || 0, right = Number(action.scroll_x) || 0; return `Scroll ${down ? (down > 0 ? 'down' : 'up') : right > 0 ? 'right' : 'left'} at ${at(action)}`; }
    case 'keypress': return `Press ${(action.keys || []).join(' + ')}`;
    case 'type': return `Type ${quoted(action.text)}`;
    case 'wait': return 'Wait a moment';
    case 'screenshot': return 'Take a screenshot';
    case 'open_app': return `Open ${action.bundle_id}`;
    case 'browser_navigate': return `Go to ${action.url}`;
    case 'browser_search': return `Search the web for ${quoted(action.query, 120)}`;
    case 'browser_tab': return `Switch to the ${action.direction === 'previous' ? 'previous' : 'next'} tab`;
    default: return String(action.type || 'Unknown step');
  }
}
export function actionPreview(actions: DesktopAction[] = [], dimensions: ActionReviewDimensions = {}): ActionPreviewResult {
  const steps = actions.map(actionStep), bundle = dimensions.focus?.bundlePath;
  const app = typeof bundle === 'string' ? (bundle.split('/').filter(Boolean).pop() ?? '').replace(/\.app$/, '') : '';
  const where = [app && `In ${app}`, dimensions.width && dimensions.height && `on a ${dimensions.width} × ${dimensions.height} screen`].filter(Boolean).join(', ');
  return { app, steps, text: `${steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}${where ? `\n${where[0].toUpperCase()}${where.slice(1)}.` : ''}` };
}
