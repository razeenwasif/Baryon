import { browserActions, ordinaryWebURL, safariContext, searchURL } from './browser.mjs';
const safeApps = new Set(['com.apple.calculator', 'com.apple.finder', 'com.apple.Preview', 'com.apple.TextEdit', 'com.apple.Safari']);
const safeSearches = new Set(['calculator', 'finder', 'preview', 'textedit', 'safari']);
const normalized = value => typeof value === 'string' ? value.trim().toLowerCase() : null;
const keysOf = action => (action.keys || []).map(key => key.toUpperCase().replace(/^(COMMAND|META|SUPER)$/, 'CMD'));
const sameKeys = (keys, expected) => keys.length === expected.length && expected.every(key => keys.includes(key));

// Deliberately use native context and a narrow allowlist, never a model's
// self-reported risk level. Any unrecognized action makes the whole batch reviewable.
export function actionReview(actions, dimensions = {}) {
  const focus = dimensions.focus || {};
  let calculator = focus.bundleId === 'com.apple.calculator' && focus.bundlePath === '/System/Applications/Calculator.app' && focus.window?.standard && !focus.window?.hasSheet;
  let windowValid = true;
  let browser = safariContext(focus);
  let spotlight = focus.bundleId === 'com.apple.Spotlight' && focus.bundlePath === '/System/Library/CoreServices/Spotlight.app';
  let query = spotlight ? normalized(focus.query) : null;
  const inside = action => {
    const window = focus.window, display = dimensions.bounds;
    if (!windowValid || !window || !display || !dimensions.width || !dimensions.height) return false;
    const x = display.x + action.x * display.width / dimensions.width;
    const y = display.y + action.y * display.height / dimensions.height;
    return x >= window.x && y >= window.y && x < window.x + window.width && y < window.y + window.height;
  };
  if (!Array.isArray(actions) || !actions.length) return { required: true, reason: 'No actions could be classified.' };
  for (const action of actions) {
    if (browserActions.includes(action.type)) {
      if (!browser || actions.length !== 1) return { required: true, reason: 'Browser actions need an observed Safari window and a separate batch.' };
      if (action.type === 'browser_navigate' && ordinaryWebURL(action.url)) continue;
      if (action.type === 'browser_search') { try { searchURL(action.query); continue; } catch {} }
      if (action.type === 'browser_tab' && ['next', 'previous'].includes(action.direction)) continue;
      return { required: true, reason: 'This address could trigger an account action, download, or other change. Review the destination before opening it.' };
    }
    if (['wait', 'screenshot', 'move'].includes(action.type)) continue;
    if (action.type === 'open_app' && safeApps.has(action.bundle_id)) {
      calculator = false; browser = false; windowValid = false; spotlight = false; query = null; continue;
    }
    if (action.type === 'keypress') {
      const keys = keysOf(action);
      if (!spotlight && sameKeys(keys, ['CMD', 'SPACE'])) {
        calculator = false; browser = false; windowValid = false; spotlight = true; query = null; continue;
      }
      if (spotlight && sameKeys(keys, ['CMD', 'A'])) { query = ''; continue; }
      if (spotlight && keys.length === 1 && ['ENTER', 'RETURN'].includes(keys[0]) && safeSearches.has(query)) {
        spotlight = false; windowValid = false; calculator = false; query = null; continue;
      }
      if (calculator && keys.length === 1 && /^(?:[0-9=./-]|ENTER|RETURN|ESC|ESCAPE|BACKSPACE)$/.test(keys[0])) continue;
      if (calculator && sameKeys(keys, ['SHIFT', '='])) continue;
    }
    if (action.type === 'type') {
      if (spotlight && safeSearches.has(normalized(action.text)) && !/[\r\n\t]/.test(action.text) && query === '') { query = normalized(action.text); continue; }
      if (calculator && /^[0-9 .+−×÷*/()%=-]+$/.test(action.text)) continue;
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
const quoted = (text, limit = 160) => { const flat = String(text ?? '').replace(/\s+/g, ' '); return `“${flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat}”${flat.length > limit ? ` (${flat.length} characters)` : ''}`; };
const at = action => `${Math.round(action.x)}, ${Math.round(action.y)}`;
export function actionStep(action = {}) {
  switch (action.type) {
    case 'click': return `${{ right: 'Right-click', middle: 'Middle-click' }[action.button] || 'Click'} at ${at(action)}`;
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
export function actionPreview(actions = [], dimensions = {}) {
  const steps = actions.map(actionStep), bundle = dimensions.focus?.bundlePath;
  const app = typeof bundle === 'string' ? bundle.split('/').filter(Boolean).pop().replace(/\.app$/, '') : '';
  const where = [app && `In ${app}`, dimensions.width && dimensions.height && `on a ${dimensions.width} × ${dimensions.height} screen`].filter(Boolean).join(', ');
  return { app, steps, text: `${steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}${where ? `\n${where[0].toUpperCase()}${where.slice(1)}.` : ''}` };
}
