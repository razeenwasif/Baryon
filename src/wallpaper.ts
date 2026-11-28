import { dotField } from './dot-field.js';
import type { DotFieldController, DotFieldMode } from './dot-field.js';
import { gridThumbnail } from './ascii-aurora.js';
import { auroraGrid } from './aurora-grid.js';
import type { AuroraGridController } from './aurora-grid.js';
import aurora from './wallpapers/aurora.webp';
import opal from './wallpapers/opal.jpg';
import ember from './wallpapers/ember.jpg';
import nebula from './wallpapers/nebula.jpg';
import lagoon from './wallpapers/lagoon.jpg';
// Aurora's moving version: 24 seconds made from the clean first two seconds of an animation of the wallpaper, which
// wander slowly with ripples flowing across, and loop without a seam. No sound. scripts/wallpaper-loop.swift makes it.
import auroraLoop from './wallpapers/aurora-loop.mp4';
import { wallpaperVideo } from './wallpaper-state.js';
import type { WallpaperStateResult } from './wallpaper-state.js';
import { VELVET } from './velvet-ripple.js';
import { nebulaSky } from './nebula-sky.js';
import type { NebulaMode, NebulaSkyController } from './nebula-sky.js';
export { wallpaperState } from './wallpaper-state.js';

export interface WallpaperDefinition {
  name: string;
  caption: string;
  src: string;
  video?: string;
  thumb?: string;
  bg: string;
  accent: string;
  glow: string;
  glowAt: readonly [string, string];
  flowAt: string;
  flowDeg: string;
}

type WallpaperField =
  | AuroraGridController
  | (DotFieldController & { speed?: (n: number) => void; readonly mode?: DotFieldMode });

// The user's own wallpapers. flowAt is the point each one's folds turn about, so the second copy slides along them.
export const WALLPAPERS: Record<string, WallpaperDefinition> = {
  aurora: { name: 'Aurora', caption: 'Blue and cyan arcs', src: aurora, video: auroraLoop, bg: '#000208', accent: '#3e5aec', glow: '#2d4dff', glowAt: ['44%', '30%'], flowAt: '-10% 122%', flowDeg: '1.6deg' },
  opal: { name: 'Opal', caption: 'Iridescent mint and violet', src: opal, bg: '#0a0c17', accent: '#3f9f95', glow: '#b06be0', glowAt: ['18%', '62%'], flowAt: '50% 50%', flowDeg: '2.2deg' },
  ember: { name: 'Ember', caption: 'Teal and burnt orange satin', src: ember, bg: '#030707', accent: '#c4602f', glow: '#c4602f', glowAt: ['72%', '28%'], flowAt: '50% 145%', flowDeg: '1.4deg' },
  nebula: { name: 'Nebula', caption: 'Violet and magenta folds', src: nebula, bg: '#030209', accent: '#7a45d6', glow: '#c2368a', glowAt: ['57%', '33%'], flowAt: '62% 56%', flowDeg: '2deg' },
  // The plain near-black the phone's chats settle on; the rail's velvet button pours it in.
  velvet: { name: 'Velvet', caption: 'Near-black, an aurora drawn through its grid', src: VELVET, thumb: gridThumbnail(), bg: '#030304', accent: '#3e5aec', glow: '#1b2350', glowAt: ['50%', '42%'], flowAt: '50% 50%', flowDeg: '0deg' },
  lagoon: { name: 'Lagoon', caption: 'Deep teal dunes', src: lagoon, bg: '#010504', accent: '#1f8a98', glow: '#1c7f8c', glowAt: ['82%', '78%'], flowAt: '50% 155%', flowDeg: '1.4deg' },
};

// Notebook's sky over the wallpaper, shown only while Notebook is open (wallpaper.css): Velvet's ground and glow, the
// nebula, and the shade at the edges.
export const notebookSkyLayers = '<div id="notebook-sky" aria-hidden="true"><div class="ns-glow"></div><canvas class="ns-canvas"></canvas><div class="ns-shade"></div></div>';
export const wallpaperLayers = '<div id="wallpaper" aria-hidden="true"><div class="wp-image wp-base"></div><div class="wp-image wp-flow"></div><video class="wp-video" muted loop playsinline disablepictureinpicture disableremoteplayback preload="none" tabindex="-1"></video><div class="wp-glow"></div><div class="wp-shade"></div><canvas class="wp-dots"></canvas></div>';

const escape = (text: string): string => String(text).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const absolute = (src: string): string => new URL(src, document.baseURI).href;
export function wallpaperChoices(): string {
  const cards = Object.entries(WALLPAPERS).map(([id, w]) => `<label class="wallpaper-choice" style="--choice:${w.accent}"><input type="radio" name="windowWallpaper" value="${id}"><span class="wallpaper-thumb" style="background-image:url('${escape(absolute(w.thumb || w.src))}')"></span><b>${escape(w.name)}</b><small>${escape(w.caption)}</small></label>`);
  cards.push('<label class="wallpaper-choice" style="--choice:#9fb2ff"><input type="radio" name="windowWallpaper" value="none"><span class="wallpaper-thumb plain"></span><b>Plain</b><small>The dark window, no picture</small></label>');
  return cards.join('');
}

// Sets the classes and colours the stylesheet reads. Only the classes change while it runs, so nothing repaints.
let lastState: WallpaperStateResult | null = null;
// Velvet's aurora grid (src/aurora-grid.js), made the first time Velvet shows; Velvet's plain dot field
// (src/dot-field.js) where there's no WebGL.
let field: WallpaperField | null = null;
let dotsOffTimer: ReturnType<typeof setTimeout> | null = null;
let skyOffTimer: ReturnType<typeof setTimeout> | null = null;
let videoOffTimer: ReturnType<typeof setTimeout> | null = null;
let pauseTimer: ReturnType<typeof setTimeout> | null = null;
const clearTimeout = globalThis.clearTimeout as (id: ReturnType<typeof setTimeout> | null | undefined) => void;
const FADE_OUT_MS = 820;
const instantStop = (): boolean => {
  try { return Boolean(document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches); }
  catch { return Boolean(document.hidden); }
};

function applyDots(root: HTMLElement, state: WallpaperStateResult): void {
  const canvas = root.querySelector<HTMLCanvasElement>('#wallpaper .wp-dots');
  const target: DotFieldMode = state.dots ?? 'off';
  root.classList.toggle('wallpaper-dots-off', target === 'off');
  if (!canvas || (!field && target === 'off')) return;
  if (!field) { try { field = auroraGrid(canvas); } catch { field = null; } field ??= dotField(canvas); }
  if (target === 'off') {
    if (instantStop() || !state.on) {
      clearTimeout(dotsOffTimer); dotsOffTimer = null;
      field.set('off');
      return;
    }
    if (dotsOffTimer) return;
    if (field.mode !== 'live') {
      field.set('paused');
      dotsOffTimer = setTimeout(() => { dotsOffTimer = null; field?.set('off'); }, FADE_OUT_MS);
      return;
    }
    // Coast gently while CSS fades opacity to zero, then release GPU frames.
    field.speed?.(0.3);
    dotsOffTimer = setTimeout(() => { dotsOffTimer = null; field?.set('off'); }, FADE_OUT_MS);
    return;
  }
  clearTimeout(dotsOffTimer); dotsOffTimer = null;
  field.speed?.((state.on ? state.dotsSpeed : undefined) ?? 1);
  field.set(target);
}

// Notebook's sky, made the first time Notebook opens; fades smoothly off when inside a notebook chat.
let notebookSky: NebulaSkyController | null = null, notebookSkyTried = false;
export function applyNotebookSky(root: HTMLElement, mode: NebulaMode): void {
  const canvas = root.querySelector<HTMLCanvasElement>('#notebook-sky .ns-canvas');
  root.classList.toggle('notebook-sky-off', mode === 'off');
  if (!canvas || (!notebookSky && mode === 'off')) return;
  if (!notebookSkyTried) { notebookSkyTried = true; try { notebookSky = nebulaSky(canvas); } catch { notebookSky = null; } }
  if (mode === 'off') {
    if (instantStop() || root.classList.contains('bg-anim-off')) {
      clearTimeout(skyOffTimer); skyOffTimer = null;
      notebookSky?.set('off');
      return;
    }
    if (skyOffTimer) return;
    if (notebookSky?.mode !== 'live') {
      notebookSky?.set('paused');
      skyOffTimer = setTimeout(() => { skyOffTimer = null; notebookSky?.set('off'); }, FADE_OUT_MS);
      return;
    }
    notebookSky.speed?.(0.3);
    skyOffTimer = setTimeout(() => { skyOffTimer = null; notebookSky?.set('off'); }, FADE_OUT_MS);
    return;
  }
  clearTimeout(skyOffTimer); skyOffTimer = null;
  notebookSky?.speed?.(1);
  notebookSky?.set(mode);
}

export function applyWallpaper(root: HTMLElement, state: WallpaperStateResult): void {
  lastState = state;
  root.classList.toggle('wallpaper', state.on);
  root.classList.toggle('wallpaper-quiet', Boolean(state.on && state.chatOpen));
  applyDots(root, state);
  if (!state.on) { clearTimeout(pauseTimer); pauseTimer = null; root.classList.remove('wallpaper-paused'); delete root.dataset.wallpaper; playWallpaperVideo(root, state); return; }
  if (root.dataset.wallpaper !== state.choice) {
    const w = WALLPAPERS[state.choice], s = root.style;
    s.setProperty('--wp-image', `url("${absolute(w.src)}")`);
    for (const [name, value] of Object.entries({ bg: w.bg, accent: w.accent, glow: w.glow, 'glow-x': w.glowAt[0], 'glow-y': w.glowAt[1], 'flow-at': w.flowAt, 'flow-deg': w.flowDeg })) s.setProperty(`--wp-${name}`, value);
    root.dataset.wallpaper = state.choice;
  }
  root.style.setProperty('--wp-veil', String(state.veil));
  root.dataset.wallpaperMotion = state.motion;
  if (!state.paused) {
    clearTimeout(pauseTimer); pauseTimer = null;
    root.classList.remove('wallpaper-paused');
  } else if (state.chatOpen && !instantStop()) {
    if (!root.classList.contains('wallpaper-paused') && !pauseTimer) {
      pauseTimer = setTimeout(() => { pauseTimer = null; if (lastState?.on && lastState.paused) root.classList.add('wallpaper-paused'); }, FADE_OUT_MS);
    }
  } else {
    clearTimeout(pauseTimer); pauseTimer = null;
    root.classList.add('wallpaper-paused');
  }
  root.classList.toggle('wallpaper-busy', state.busy);
  root.classList.toggle('wallpaper-listening', state.listening);
  playWallpaperVideo(root, state);
}

// After the GPU process starts again the video can keep an empty or black frame, so it's loaded afresh; the picture
// shows until its first frame is ready, as it does at first.
export function restartWallpaperVideo(root: HTMLElement): boolean {
  const video = root.querySelector<HTMLVideoElement>('#wallpaper .wp-video');
  if (!video?.hasAttribute('src') || !lastState) return false;
  root.classList.remove('wallpaper-video');
  video.pause(); video.removeAttribute('src'); video.load();
  playWallpaperVideo(root, lastState);
  return true;
}

// The moving version sits over the picture and fades in once its first frame is ready, so the picture shows until then.
function playWallpaperVideo(root: HTMLElement, state: WallpaperStateResult): void {
  const video = root.querySelector<HTMLVideoElement>('#wallpaper .wp-video');
  if (!video) return;
  const source = state.on ? WALLPAPERS[state.choice]?.video : null, plan = wallpaperVideo(state, Boolean(source));
  if (!plan.show) {
    root.classList.remove('wallpaper-video');
    if (instantStop() || !state.on || video.paused || !video.hasAttribute('src')) {
      clearTimeout(videoOffTimer); videoOffTimer = null;
      video.pause();
      if (video.hasAttribute('src')) { video.removeAttribute('src'); video.load(); }
      return;
    }
    if (videoOffTimer) return;
    try { video.playbackRate = 0.45; } catch {}
    videoOffTimer = setTimeout(() => {
      videoOffTimer = null;
      if (!root.classList.contains('wallpaper-video')) {
        video.pause();
        if (video.hasAttribute('src')) { video.removeAttribute('src'); video.load(); }
      }
    }, FADE_OUT_MS);
    return;
  }
  clearTimeout(videoOffTimer); videoOffTimer = null;
  const src = absolute(source!);
  if (video.getAttribute('src') !== src) {
    root.classList.remove('wallpaper-video');
    video.muted = true;
    video.onloadeddata = () => root.classList.add('wallpaper-video');
    video.src = src;
  }
  video.defaultPlaybackRate = video.playbackRate = plan.rate;
  if (plan.play) video.play().catch(() => {});
  else video.pause();
}
