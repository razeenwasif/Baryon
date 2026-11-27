// Two Macs: her voice on a face, played here from the clips the other Mac made (desktop/face-main.cjs fetches them in
// order). A new turn's first clip, Stop, or Mute ends what was playing.
export function setupFaceVoice({ api, speaking = () => {}, quiet = () => {} }) {
  let queue = [], playing = null, turn = null, wait = null;
  const stop = () => {
    queue = []; clearTimeout(wait); wait = null;
    if (playing) { playing.pause(); playing = null; }
    quiet();
  };
  const next = () => {
    if (playing || wait) return;
    if (!queue.length) { quiet(); return; }
    const item = queue.shift();
    wait = setTimeout(() => {
      wait = null;
      const url = URL.createObjectURL(new Blob([item.bytes], { type: 'audio/mpeg' })), audio = new Audio(url);
      const done = () => { URL.revokeObjectURL(url); if (playing === audio) playing = null; next(); };
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
