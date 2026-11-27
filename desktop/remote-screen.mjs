// Fairy away from the mini: a Desktop task on the MacBook's own screen. The task's model and loop stay on the Mac Fairy
// lives on; the face's Mac is its eyes and hands. Each step goes over the link (face-link.mjs desktopStep) and is run
// there: a picture of its screen, what's in front, a checked batch of actions by its own fairy-desktop, its app list, a
// question for the user (Touch ID to allow), and Fairy's window there stepping aside.
//
// remoteScreen(step) is this Mac's side, a "screen" runDesktopTask and the computer tool use in place of their own.
// runDesktopStep(step, deps) is the face's side. Nothing reaches the face's screen unless a step for a turn started in
// its own window asks, and the face checks each batch again against its own last picture before pressing anything.
import { validateActions } from './core.mjs';

export const DESKTOP_STEPS = Object.freeze(['check', 'capture', 'context', 'run', 'apps', 'ask', 'presence']);
export const PRESENCE = Object.freeze(['enter', 'review', 'passive', 'leave']);
const MAX_SHOT = 24 * 1024 * 1024, MAX_FOCUS = 256 * 1024;
const finite = value => Number.isFinite(value);
const cleanBounds = value => (value && ['x', 'y', 'width', 'height'].every(key => finite(value[key])) ? { x: value.x, y: value.y, width: value.width, height: value.height } : null);
// The front app as fairy-desktop reports it, kept as long as it's plain data of a sane size.
function cleanFocus(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  try { return JSON.stringify(value).length <= MAX_FOCUS ? JSON.parse(JSON.stringify(value)) : undefined; } catch { return undefined; }
}
// A picture from the face, checked before a model sees it or an action is placed on it.
export function cleanShot(value) {
  const url = value?.url, width = value?.width, height = value?.height, bounds = cleanBounds(value?.bounds);
  if (typeof url !== 'string' || url.length > MAX_SHOT || !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(url) || !Number.isInteger(width) || !Number.isInteger(height)
    || width < 1 || height < 1 || width > 8192 || height > 8192 || !bounds) throw new Error('Your MacBook sent a picture that wasn’t understood.');
  const focus = cleanFocus(value.focus);
  return { url, width, height, bounds, excludedFairy: true, ...(focus ? { focus } : {}) };
}
// A few plain words for a Touch ID sheet: one line, no more than 100 characters.
export const cleanSummary = value => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 100);
// The size a provider wants (Claude resizes large pictures, so capturing at its limit keeps coordinates exact).
export function cleanFit(value) {
  return value && finite(value.edge) && finite(value.area) && value.edge > 0 && value.area > 0 ? { edge: value.edge, area: value.area } : null;
}
export function pictureSize(display, fit = null) {
  let width = Math.round(Math.min(1920, display.size.width)), height = Math.round(width * display.size.height / display.size.width);
  if (fit) { const scale = Math.min(1, fit.edge / Math.max(width, height), Math.sqrt(fit.area / (width * height))); width = Math.floor(width * scale); height = Math.floor(height * scale); }
  return { width, height };
}

// This Mac's side. step(tool, args, signal) runs one step on the face's Mac.
export function remoteScreen(step) {
  return {
    remote: true,
    check: signal => step('check', {}, signal),
    // focus: false for a picture alone (a question about the screen), which needs no Accessibility there.
    capture: async (signal, fit = null, { focus = true } = {}) => cleanShot(await step('capture', { fit: cleanFit(fit), ...(focus ? {} : { focus: false }) }, signal)),
    context: async signal => cleanFocus(await step('context', {}, signal)) ?? {},
    run: (payload, signal) => step('run', payload, signal),
    apps: async () => String((await step('apps', {}).catch(() => '')) || '').slice(0, 8000),
    // summary: what allowing does, in a few words, for the MacBook's Touch ID sheet ("run 3 actions in Calculator").
    ask: async ({ message, detail, allow, summary }, signal) => (await step('ask', { message: String(message).slice(0, 300), detail: String(detail ?? '').slice(0, 4000), allow: String(allow || 'Allow').slice(0, 60), summary: cleanSummary(summary) }, signal))?.allowed === true,
    presence: state => (PRESENCE.includes(state) ? step('presence', { state }).catch(() => {}) : Promise.resolve()),
  };
}

// The face's side: one step from the other Mac, run with this Mac's own helpers.
// deps: helper(payload, signal) → fairy-desktop's output; check(signal); capture({ fit, signal }) → { url, width, height,
// bounds }; apps(); ask({ message, detail, allow }) → true when allowed (with Touch ID); presence(state). last holds the
// last picture's size and bounds, so a batch placed on another picture is refused here. allowRun({ count }), when given,
// is this Mac's own say on a batch: it throws unless the user allowed the task here (the other Mac's word isn't enough).
export async function runDesktopStep({ tool, args = {} } = {}, deps, { signal, last = { shot: null } } = {}) {
  if (!DESKTOP_STEPS.includes(tool)) throw new Error('That isn’t a desktop step.');
  if (tool === 'check') { await deps.check(signal); return { ready: true }; }
  if (tool === 'capture') {
    const shot = await deps.capture({ fit: cleanFit(args.fit), signal });
    signal?.throwIfAborted?.();
    const focus = args.focus === false ? undefined : JSON.parse(await deps.helper({ context: true, includeBrowserText: true }, signal));
    last.shot = { width: shot.width, height: shot.height, bounds: shot.bounds };
    return { url: shot.url, width: shot.width, height: shot.height, bounds: shot.bounds, ...(focus ? { focus } : {}), excludedFairy: true };
  }
  if (tool === 'context') return JSON.parse(await deps.helper({ context: true }, signal));
  if (tool === 'run') {
    const { actions, width, height, focus, restoreFocus } = args, bounds = cleanBounds(args.bounds);
    const seen = last.shot;
    if (!seen || seen.width !== width || seen.height !== height || JSON.stringify(seen.bounds) !== JSON.stringify(bounds)) throw new Error('Those actions were placed on a different picture of this screen. Take a new one first.');
    validateActions(actions, width, height);
    await deps.allowRun?.({ count: actions.length });
    signal?.throwIfAborted?.();
    await deps.helper({ actions, width, height, bounds, ...(focus && typeof focus === 'object' ? { focus } : {}), restoreFocus: restoreFocus !== false }, signal);
    return { ok: true };
  }
  if (tool === 'apps') return String(await deps.apps() || '');
  if (tool === 'ask') return { allowed: (await deps.ask({ message: String(args.message ?? '').slice(0, 300), detail: String(args.detail ?? '').slice(0, 4000), allow: String(args.allow || 'Allow').slice(0, 60), summary: cleanSummary(args.summary) })) === true };
  if (!PRESENCE.includes(args.state)) throw new Error('That isn’t a presence state.');
  await deps.presence(args.state);
  return { ok: true };
}
