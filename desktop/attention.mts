// Are you at the Mac? What watches the screen asks before it looks (efficiency audit, fix 2).
//
// Screen awareness and the quiz both take pictures of the screen, and each picture starts a fairy-screen process.
// Nothing on screen changes while you're away, so after two idle minutes they stop looking and keep only a slow
// heartbeat, which notices when you're back without needing anything to wake them.
//
// While you are here they share one picture instead of taking one each: whichever looks first fills the cache
// (desktop/awareness.mjs), and the other uses that picture when it's new enough for what it's doing.
// The heartbeat takes no picture and starts no process: it only asks whether you're back, so it can stay quick enough
// that the quiz notices a question within a few seconds of your return.
export const AWAY_SECONDS = 120, HEARTBEAT_MS = 5000;

export interface WatchCadenceOptions {
  base?: number;
  idleSeconds?: number;
  away?: number;
  heartbeatMs?: number;
}

export interface WatchCadenceResult {
  look: boolean;
  delay: number | null;
}

// base: how often this watcher looks while you're here, in ms; 0 when the power policy has already stopped it.
// Returns { look, delay }: whether to take a picture now, and when to ask again — null to stop, which is the policy's
// decision rather than this one, since a stopped task is only restarted from outside.
export function watchCadence({ base = 0, idleSeconds = 0, away = AWAY_SECONDS, heartbeatMs = HEARTBEAT_MS }: WatchCadenceOptions = {}): WatchCadenceResult {
  if (!Number.isFinite(base) || base <= 0) return { look: false, delay: null };
  if (!Number.isFinite(idleSeconds) || idleSeconds < 0) idleSeconds = 0;
  if (idleSeconds >= away) return { look: false, delay: heartbeatMs };
  return { look: true, delay: base };
}

export interface ShareMaxAgeOptions {
  pollMs?: number;
  shareMs?: number;
  hovering?: boolean;
  checking?: boolean;
  ceiling?: number;
}

// How old a picture the quiz can work from. It needs this moment's screen while the pointer is dwelling on an answer,
// and a recent one while it's checking a question it has found. While it's only scanning for a question it can work
// from the picture screen awareness took (shareMs, how often that looks), so the two share one instead of taking one
// each; the ceiling bounds how long a question can sit there before the quiz notices it.
export function shareMaxAge({ pollMs = 500, shareMs = 0, hovering = false, checking = false, ceiling = 2000 }: ShareMaxAgeOptions = {}): number {
  if (hovering) return 0;
  if (checking) return 100;
  const want = Math.max(Number.isFinite(pollMs) ? pollMs : 0, Number.isFinite(shareMs) ? shareMs : 0);
  return Math.max(100, Math.min(want, ceiling));
}
