// Two Macs: her voice on a face, played here from the clips the other Mac made (desktop/face-main.cjs fetches them in
// order). A new turn's first clip, Stop, or Mute ends what was playing.

export interface FaceVoiceItem {
  turn?: unknown;
  bytes?: BlobPart;
  pauseBeforeMs?: number;
}

export interface FaceVoiceApi {
  onFaceVoice?: (callback: (item: FaceVoiceItem | null | undefined) => void) => unknown;
  onFaceHush?: (callback: () => void) => unknown;
}

export interface SetupFaceVoiceOptions {
  api: FaceVoiceApi;
  speaking?: () => void;
  quiet?: () => void;
}

export interface FaceVoiceController {
  stop: () => void;
}

export function setupFaceVoice({ api, speaking = () => {}, quiet = () => {} }: SetupFaceVoiceOptions): FaceVoiceController {
  let queue: FaceVoiceItem[] = [];
  let playing: HTMLAudioElement | null = null;
  let turn: unknown = null;
  let wait: ReturnType<typeof setTimeout> | null = null;

  const stop = (): void => {
    queue = [];
    if (wait !== null) { clearTimeout(wait); wait = null; }
    if (playing) { playing.pause(); playing = null; }
    quiet();
  };

  const next = (): void => {
    if (playing || wait) return;
    if (!queue.length) { quiet(); return; }
    const item = queue.shift()!;
    wait = setTimeout(() => {
      wait = null;
      const url = URL.createObjectURL(new Blob([item.bytes!], { type: 'audio/mpeg' })), audio = new Audio(url);
      const done = (): void => { URL.revokeObjectURL(url); if (playing === audio) playing = null; next(); };
      playing = audio; audio.onended = done; audio.onerror = done;
      speaking();
      audio.play().catch(done);
    }, Math.max(0, Math.min(1000, Number(item.pauseBeforeMs) || 0)));
  };

  api.onFaceVoice?.(item => {
    if (!item?.bytes) return;
    if (item.turn !== turn) { stop(); turn = item.turn; }
    queue.push(item);
    next();
  });
  api.onFaceHush?.(stop);
  return { stop };
}
