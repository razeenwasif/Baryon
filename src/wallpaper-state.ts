import { WINDOW_WALLPAPERS } from './defaults.js';

export type WallpaperMotion = 'flowing' | 'gentle' | 'still';
export type VelvetDotsState = 'off' | 'still' | 'paused' | 'live';

export interface WallpaperSettings {
  windowWallpaper?: string;
  wallpaperMotion?: string;
  wallpaperReactive?: string;
  wallpaperDim?: string | number;
}

export interface WallpaperStateInput {
  settings?: WallpaperSettings;
  hidden?: boolean;
  focused?: boolean;
  lowPower?: boolean;
  reducedMotion?: boolean;
  reducedTransparency?: boolean;
  settingsOpen?: boolean;
  dialogOpen?: boolean;
  busy?: boolean;
  listening?: boolean;
  research?: boolean;
  notebook?: boolean;
  chatOpen?: boolean;
  animOff?: boolean;
}

export type WallpaperStateResult =
  | { on: false; dots?: 'off' }
  | {
      on: true;
      choice: string;
      motion: WallpaperMotion;
      paused: boolean;
      busy: boolean;
      listening: boolean;
      chatOpen?: true;
      veil: number;
      dots?: VelvetDotsState;
      dotsSpeed?: number;
    };

export interface NotebookSkyStateInput {
  notebook?: boolean;
  chatOpen?: boolean;
  hidden?: boolean;
  focused?: boolean;
  lowPower?: boolean;
  reducedMotion?: boolean;
  settingsOpen?: boolean;
  dialogOpen?: boolean;
  animOff?: boolean;
}

export interface WallpaperVideoResult {
  show: boolean;
  play: boolean;
  rate: number;
}

// Decides what the window background does right now. Moving it costs GPU time every frame,
// so it stops whenever nobody is looking at it or the Mac is saving power.
// research: Research or Diffusion is open, each with its own animated background, so Velvet's grid stands down there.
// notebook: Notebook is open, which has its own sky over the wallpaper (notebookSkyState), so the wallpaper rests.
// chatOpen: true whenever any chat or conversation is open (animations are active only on home screens).
export function wallpaperState({
  settings = {},
  hidden = false,
  focused = true,
  lowPower = false,
  reducedMotion = false,
  reducedTransparency = false,
  settingsOpen = false,
  dialogOpen = false,
  busy = false,
  listening = false,
  research = false,
  notebook = false,
  chatOpen = false,
  animOff = false,
}: WallpaperStateInput = {}): WallpaperStateResult {
  if (animOff) return { on: false, dots: 'off' };
  const choice = settings.windowWallpaper;
  if (!choice || !WINDOW_WALLPAPERS.includes(choice) || choice === 'none' || reducedTransparency) return { on: false };
  // Velvet is plain: it never moves, as on the phone.
  const motion: WallpaperMotion =
    reducedMotion || lowPower || choice === 'velvet'
      ? 'still'
      : settings.wallpaperMotion === 'flowing' || settings.wallpaperMotion === 'gentle' || settings.wallpaperMotion === 'still'
        ? settings.wallpaperMotion
        : 'flowing';
  const reactive = !chatOpen && settings.wallpaperReactive !== 'off' && motion !== 'still';
  const dim = Math.min(100, Math.max(0, Number(settings.wallpaperDim ?? 60) || 0));
  return {
    on: true,
    choice,
    motion,
    paused: chatOpen || motion === 'still' || hidden || !focused || settingsOpen || dialogOpen || notebook,
    busy: reactive && busy,
    listening: reactive && listening && !busy,
    ...(chatOpen ? { chatOpen: true as const } : {}),
    veil: Math.round(dim * 0.8) / 100,
    // Velvet's aurora grid (aurora-grid.js) flows and follows the pointer on home screens while you're looking at the
    // window; it fades off smoothly when a chat interface opens.
    ...(choice === 'velvet'
      ? {
          dots: (research || notebook || chatOpen
            ? 'off'
            : reducedMotion || lowPower || settings.wallpaperMotion === 'still'
              ? 'still'
              : hidden || !focused || settingsOpen || dialogOpen
                ? 'paused'
                : 'live') as VelvetDotsState,
          dotsSpeed: (settings.wallpaperMotion === 'gentle' ? 0.6 : 1) * (settings.wallpaperReactive !== 'off' && busy ? 1.6 : 1),
        }
      : {}),
  };
}

// Notebook's sky (src/nebula-sky.js): active on Notebooks Home while visible; fades off smoothly once inside a notebook chat.
export function notebookSkyState({
  notebook = false,
  chatOpen = false,
  hidden = false,
  focused = true,
  lowPower = false,
  reducedMotion = false,
  settingsOpen = false,
  dialogOpen = false,
  animOff = false,
}: NotebookSkyStateInput = {}): VelvetDotsState {
  if (!notebook || chatOpen || animOff) return 'off';
  if (reducedMotion || lowPower) return 'still';
  return hidden || !focused || settingsOpen || dialogOpen ? 'paused' : 'live';
}

// A wallpaper with a moving version plays it only on home screens; unloads cleanly when still or a chat opens.
export function wallpaperVideo(
  state: WallpaperStateResult | null | undefined,
  hasVideo: boolean,
): WallpaperVideoResult {
  if (!state?.on || !hasVideo || state.motion === 'still' || state.chatOpen) return { show: false, play: false, rate: 1 };
  return { show: true, play: !state.paused, rate: state.motion === 'gentle' ? 0.6 : 1 };
}
