import { WINDOW_WALLPAPERS } from './defaults.js';

// Decides what the window background does right now. Moving it costs GPU time every frame,
// so it stops whenever nobody is looking at it or the Mac is saving power.
// research: Research or Diffusion is open, each with its own animated background, so Velvet's grid stands down there.
// notebook: Notebook is open, which has its own sky over the wallpaper (notebookSkyState), so the wallpaper rests.
// chatOpen: true whenever any chat or conversation is open (animations are active only on home screens).
export function wallpaperState({ settings = {}, hidden = false, focused = true, lowPower = false, reducedMotion = false, reducedTransparency = false, settingsOpen = false, dialogOpen = false, busy = false, listening = false, research = false, notebook = false, chatOpen = false, animOff = false } = {}) {
  if (animOff) return { on: false, dots: 'off' };
  const choice = settings.windowWallpaper;
  if (!WINDOW_WALLPAPERS.includes(choice) || choice === 'none' || reducedTransparency) return { on: false };
  // Velvet is plain: it never moves, as on the phone.
  const motion = reducedMotion || lowPower || choice === 'velvet' ? 'still' : ['flowing', 'gentle', 'still'].includes(settings.wallpaperMotion) ? settings.wallpaperMotion : 'flowing';
  const reactive = !chatOpen && settings.wallpaperReactive !== 'off' && motion !== 'still';
  const dim = Math.min(100, Math.max(0, Number(settings.wallpaperDim ?? 60) || 0));
  return {
    on: true, choice, motion,
    paused: chatOpen || motion === 'still' || hidden || !focused || settingsOpen || dialogOpen || notebook,
    busy: reactive && busy, listening: reactive && listening && !busy,
    ...(chatOpen ? { chatOpen: true } : {}),
    veil: Math.round(dim * 0.8) / 100,
    // Velvet's aurora grid (aurora-grid.js) flows and follows the pointer on home screens while you're looking at the
    // window; it fades off smoothly when a chat interface opens.
    ...(choice === 'velvet' ? {
      dots: research || notebook || chatOpen ? 'off' : reducedMotion || lowPower || settings.wallpaperMotion === 'still' ? 'still' : hidden || !focused || settingsOpen || dialogOpen ? 'paused' : 'live',
      dotsSpeed: (settings.wallpaperMotion === 'gentle' ? 0.6 : 1) * (settings.wallpaperReactive !== 'off' && busy ? 1.6 : 1),
    } : {}),
  };
}

// Notebook's sky (src/nebula-sky.js): active on Notebooks Home while visible; fades off smoothly once inside a notebook chat.
export function notebookSkyState({ notebook = false, chatOpen = false, hidden = false, focused = true, lowPower = false, reducedMotion = false, settingsOpen = false, dialogOpen = false, animOff = false } = {}) {
  if (!notebook || chatOpen || animOff) return 'off';
  if (reducedMotion || lowPower) return 'still';
  return hidden || !focused || settingsOpen || dialogOpen ? 'paused' : 'live';
}

// A wallpaper with a moving version plays it only on home screens; unloads cleanly when still or a chat opens.
export function wallpaperVideo(state, hasVideo) {
  if (!state?.on || !hasVideo || state.motion === 'still' || state.chatOpen) return { show: false, play: false, rate: 1 };
  return { show: true, play: !state.paused, rate: state.motion === 'gentle' ? 0.6 : 1 };
}
