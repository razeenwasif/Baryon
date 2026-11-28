// Fairy away from the mini: a Desktop task on the MacBook's own screen. The task's model and loop stay on the Mac Fairy
// lives on; the face's Mac is its eyes and hands. Each step goes over the link (face-link.mjs desktopStep) and is run
// there: a picture of its screen, what's in front, a checked batch of actions by its own fairy-desktop, its app list, a
// question for the user (Touch ID to allow), and Fairy's window there stepping aside.
//
// remoteScreen(step) is this Mac's side, a "screen" runDesktopTask and the computer tool use in place of their own.
// runDesktopStep(step, deps) is the face's side. Nothing reaches the face's screen unless a step for a turn started in
// its own window asks, and the face checks each batch again against its own last picture before pressing anything.
import { validateActions } from './core.mjs';
import type { DesktopFocus } from './browser.mjs';

export const DESKTOP_STEPS = Object.freeze(['check', 'capture', 'context', 'run', 'apps', 'ask', 'presence'] as const);
export const PRESENCE = Object.freeze(['enter', 'review', 'passive', 'leave'] as const);

export type DesktopStepName = (typeof DESKTOP_STEPS)[number];
export type PresenceState = (typeof PRESENCE)[number];

export interface ScreenBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScreenshotFit {
  edge: number;
  area: number;
}

export interface CleanShotResult {
  url: string;
  width: number;
  height: number;
  bounds: ScreenBounds;
  excludedFairy: boolean;
  focus?: DesktopFocus;
}

export interface RemoteAskPrompt {
  message?: unknown;
  detail?: unknown;
  allow?: unknown;
  summary?: unknown;
}

export type RemoteStepFn = (tool: DesktopStepName, args: Record<string, unknown>, signal?: AbortSignal | null) => Promise<unknown>;

export interface RemoteScreenClient {
  remote: true;
  check: (signal?: AbortSignal | null) => Promise<unknown>;
  capture: (signal?: AbortSignal | null, fit?: ScreenshotFit | null, options?: { focus?: boolean }) => Promise<CleanShotResult>;
  context: (signal?: AbortSignal | null) => Promise<DesktopFocus>;
  run: (payload: Record<string, unknown>, signal?: AbortSignal | null) => Promise<unknown>;
  apps: () => Promise<string>;
  ask: (prompt: RemoteAskPrompt, signal?: AbortSignal | null) => Promise<boolean>;
  presence: (state: string) => Promise<unknown>;
}

export interface DesktopStepRequest {
  tool?: string;
  args?: Record<string, unknown>;
}

export interface DesktopStepCaptureOutput {
  url: string;
  width: number;
  height: number;
  bounds: ScreenBounds;
}

export interface DesktopStepDeps {
  helper: (payload: Record<string, unknown>, signal?: AbortSignal) => Promise<string>;
  check: (signal?: AbortSignal) => Promise<unknown> | unknown;
  capture: (options: { fit: ScreenshotFit | null; signal?: AbortSignal }) => Promise<DesktopStepCaptureOutput>;
  apps: () => Promise<string> | string;
  ask: (prompt: { message: string; detail: string; allow: string; summary: string }) => Promise<boolean> | boolean;
  presence: (state: PresenceState) => Promise<unknown> | unknown;
  allowRun?: (info: { count: number }) => Promise<unknown> | unknown;
}

export interface LastDesktopShot {
  shot: { width: number; height: number; bounds: ScreenBounds } | null;
}

export interface RunDesktopStepOptions {
  signal?: AbortSignal;
  last?: LastDesktopShot;
}

const MAX_SHOT = 24 * 1024 * 1024, MAX_FOCUS = 256 * 1024;
const finite = (value: unknown): value is number => Number.isFinite(value);
const cleanBounds = (value: unknown): ScreenBounds | null => {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  return ['x', 'y', 'width', 'height'].every(key => finite(v[key]))
    ? { x: v.x as number, y: v.y as number, width: v.width as number, height: v.height as number }
    : null;
};

// The front app as fairy-desktop reports it, kept as long as it's plain data of a sane size.
function cleanFocus(value: unknown): DesktopFocus | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  try { return JSON.stringify(value).length <= MAX_FOCUS ? JSON.parse(JSON.stringify(value)) as DesktopFocus : undefined; } catch { return undefined; }
}

// A picture from the face, checked before a model sees it or an action is placed on it.
export function cleanShot(value: unknown): CleanShotResult {
  const v = (value && typeof value === 'object' ? value : null) as Record<string, unknown> | null;
  const url = v?.url, width = v?.width, height = v?.height, bounds = cleanBounds(v?.bounds);
  if (typeof url !== 'string' || url.length > MAX_SHOT || !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(url) || typeof width !== 'number' || typeof height !== 'number' || !Number.isInteger(width) || !Number.isInteger(height)
    || width < 1 || height < 1 || width > 8192 || height > 8192 || !bounds) throw new Error('Your MacBook sent a picture that wasn’t understood.');
  const focus = cleanFocus(v!.focus);
  return { url, width, height, bounds, excludedFairy: true, ...(focus ? { focus } : {}) };
}

// A few plain words for a Touch ID sheet: one line, no more than 100 characters.
export const cleanSummary = (value: unknown): string => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 100);

// The size a provider wants (Claude resizes large pictures, so capturing at its limit keeps coordinates exact).
export function cleanFit(value: unknown): ScreenshotFit | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  return finite(v.edge) && finite(v.area) && v.edge > 0 && v.area > 0 ? { edge: v.edge, area: v.area } : null;
}

export function pictureSize(display: { size: { width: number; height: number } }, fit: ScreenshotFit | null = null): { width: number; height: number } {
  let width = Math.round(Math.min(1920, display.size.width)), height = Math.round(width * display.size.height / display.size.width);
  if (fit) { const scale = Math.min(1, fit.edge / Math.max(width, height), Math.sqrt(fit.area / (width * height))); width = Math.floor(width * scale); height = Math.floor(height * scale); }
  return { width, height };
}

// This Mac's side. step(tool, args, signal) runs one step on the face's Mac.
export function remoteScreen(step: RemoteStepFn): RemoteScreenClient {
  return {
    remote: true,
    check: signal => step('check', {}, signal),
    // focus: false for a picture alone (a question about the screen), which needs no Accessibility there.
    capture: async (signal, fit = null, { focus = true } = {}) => cleanShot(await step('capture', { fit: cleanFit(fit), ...(focus ? {} : { focus: false }) }, signal)),
    context: async signal => cleanFocus(await step('context', {}, signal)) ?? {},
    run: (payload, signal) => step('run', payload, signal),
    apps: async () => String((await step('apps', {}).catch(() => '')) || '').slice(0, 8000),
    // summary: what allowing does, in a few words, for the MacBook's Touch ID sheet ("run 3 actions in Calculator").
    ask: async ({ message, detail, allow, summary }, signal) => ((await step('ask', { message: String(message).slice(0, 300), detail: String(detail ?? '').slice(0, 4000), allow: String(allow || 'Allow').slice(0, 60), summary: cleanSummary(summary) }, signal)) as { allowed?: unknown } | null | undefined)?.allowed === true,
    presence: state => ((PRESENCE as readonly string[]).includes(state) ? step('presence', { state }).catch(() => {}) : Promise.resolve()),
  };
}

// The face's side: one step from the other Mac, run with this Mac's own helpers.
// deps: helper(payload, signal) → fairy-desktop's output; check(signal); capture({ fit, signal }) → { url, width, height,
// bounds }; apps(); ask({ message, detail, allow }) → true when allowed (with Touch ID); presence(state). last holds the
// last picture's size and bounds, so a batch placed on another picture is refused here. allowRun({ count }), when given,
// is this Mac's own say on a batch: it throws unless the user allowed the task here (the other Mac's word isn't enough).
export async function runDesktopStep(
  { tool, args = {} }: DesktopStepRequest = {},
  deps: DesktopStepDeps = {} as DesktopStepDeps,
  { signal, last = { shot: null } }: RunDesktopStepOptions = {},
): Promise<unknown> {
  if (!tool || !(DESKTOP_STEPS as readonly string[]).includes(tool)) throw new Error('That isn’t a desktop step.');
  if (tool === 'check') { await deps.check(signal); return { ready: true }; }
  if (tool === 'capture') {
    const shot = await deps.capture({ fit: cleanFit(args.fit), signal });
    signal?.throwIfAborted?.();
    const focus = args.focus === false ? undefined : JSON.parse(await deps.helper({ context: true, includeBrowserText: true }, signal)) as DesktopFocus;
    last.shot = { width: shot.width, height: shot.height, bounds: shot.bounds };
    return { url: shot.url, width: shot.width, height: shot.height, bounds: shot.bounds, ...(focus ? { focus } : {}), excludedFairy: true };
  }
  if (tool === 'context') return JSON.parse(await deps.helper({ context: true }, signal));
  if (tool === 'run') {
    const { actions, width, height, focus, restoreFocus } = args, bounds = cleanBounds(args.bounds);
    const seen = last.shot;
    if (!seen || seen.width !== width || seen.height !== height || JSON.stringify(seen.bounds) !== JSON.stringify(bounds)) throw new Error('Those actions were placed on a different picture of this screen. Take a new one first.');
    const validActions = validateActions(actions, width as number, height as number);
    await deps.allowRun?.({ count: validActions.length });
    signal?.throwIfAborted?.();
    await deps.helper({ actions: validActions, width, height, bounds, ...(focus && typeof focus === 'object' ? { focus } : {}), restoreFocus: restoreFocus !== false }, signal);
    return { ok: true };
  }
  if (tool === 'apps') return String(await deps.apps() || '');
  if (tool === 'ask') return { allowed: (await deps.ask({ message: String(args.message ?? '').slice(0, 300), detail: String(args.detail ?? '').slice(0, 4000), allow: String(args.allow || 'Allow').slice(0, 60), summary: cleanSummary(args.summary) })) === true };
  if (typeof args.state !== 'string' || !(PRESENCE as readonly string[]).includes(args.state)) throw new Error('That isn’t a presence state.');
  await deps.presence(args.state as PresenceState);
  return { ok: true };
}
