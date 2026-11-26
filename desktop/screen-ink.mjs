// Explain anything: Fairy looks at the screen, reads its text, answers aloud and draws beside what you're reading.
import { spawn } from 'node:child_process';
import { nativeBin } from './bundle-path.cjs';
import { checkSketch, inkInstructions, screenLook, splitSketch, visibleSpeech } from './ink-sketch.mjs';

// The words on the screen with where each line sits, read on the Mac by Vision. Fairy's own windows are skipped
// (skipPID), so this reads the window you're looking at even while Fairy's floating box has the focus.
export function readScreenText(shot, { pid, signal, timeoutMs = 9000, spawnProcess = spawn } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawnProcess(nativeBin('fairy-quiz-ocr'), [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(value); };
    const abort = () => { child.kill('SIGKILL'); finish(signal.reason || new Error('Stopped.')); };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error('Reading the screen took too long.')); }, timeoutMs);
    child.stdout.setEncoding('utf8'); child.stdout.on('data', chunk => { out += chunk; if (out.length > 600000) { child.kill('SIGKILL'); finish(new Error('Too much text on the screen.')); } });
    child.stderr.resume(); child.stdin.on('error', () => {});
    child.on('error', () => finish(new Error('The screen reader helper is missing.')));
    child.on('close', code => {
      if (code !== 0) return finish(new Error('Reading the screen failed.'));
      try { const data = JSON.parse(out); if (!Array.isArray(data.lines)) throw Error(); finish(null, data); }
      catch { finish(new Error('Reading the screen failed.')); }
    });
    signal?.addEventListener('abort', abort, { once: true });
    child.stdin.end(JSON.stringify({ image: String(shot.url).split(',')[1], display: shot.bounds, skipPID: pid, fast: false }));
  });
}

// capture(): a screenshot of the display, without Fairy's windows, with its bounds in screen points.
// read(shot): what readScreenText returns, or a failure (then she answers without marks on the text).
// scene: the InkScene on screen. show(state): sends it to the ink window.
// An area in the display's points, as screenshot pixels.
export function focusInShot(focus, look) {
  if (!focus?.rect || !focus.size?.width || !focus.size?.height) return null;
  const sx = look.width / focus.size.width, sy = look.height / focus.size.height, r = focus.rect;
  return { x: r.x * sx, y: r.y * sy, w: r.w * sx, h: r.h * sy, how: focus.how };
}
// focus: what was circled or selected while asking, in the display's points ({rect: {x, y, w, h}, how, size: {width, height}}).
export async function explainOnScreen({ provider, settings, history, text, signal, capture, read, scene, show, focus = null, onText = () => {}, onProgress = () => {} }) {
  signal.throwIfAborted(); onProgress('Looking at your screen…');
  let shot = await capture();
  try {
    signal.throwIfAborted();
    const ocr = await read(shot).catch(error => { if (signal.aborted) throw error; return null; });
    signal.throwIfAborted();
    const look = screenLook(shot, ocr);
    onProgress('Thinking…');
    const instructed = { ...settings, inkContext: inkInstructions(look, scene.describe(), focusInShot(focus, look)) };
    const result = await provider.chat(instructed, history, text, signal, shot, { onText: value => onText(visibleSpeech(value)) });
    signal.throwIfAborted();
    const { speech, sketch, error } = splitSketch(result.text);
    const notes = error ? [error] : [];
    let added = [];
    if (sketch) {
      const applied = scene.apply(checkSketch(sketch), look);
      added = applied.added; notes.push(...applied.notes);
      await show(scene.state(look));
    }
    return { text: speech || (added.length ? 'Here you go.' : result.text.trim()), added, notes };
  } finally {
    // The picture never outlives the request.
    if (shot) shot.url = '';
    shot = null;
  }
}
