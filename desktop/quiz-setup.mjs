// How the quiz watcher is put together, so the full Fairy and a face on another Mac build the same one (two Macs,
// step 8, docs/fairy-on-two-macs-plan.md). It watches the screen for a question, reads and crops it, follows the heading
// you hover, and asks solve() for the answer. The full Fairy's solve calls the model; a face's posts the question to the
// full Fairy, which runs that same solve, so a face makes no model call of its own. Electron's parts are passed in.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { QuizMonitor, recognizeQuiz, cropQuiz, clearQuizRecognition, parseQuizAnswer } from './quiz.mjs';
import { QuizTarget } from './quiz-target.mjs';
import { questionChecks, questionContentRect, questionTrim, excludeBlanks } from './quiz-images.mjs';
import { shareMaxAge } from './attention.mjs';
import { ConditionalTask } from '../src/conditional-task.js';

// Opt-in local diagnosis: bounded OCR snippets and geometry only; no screenshots.
const TRACE_ON = '/tmp/fairy-quiz-trace.enabled', TRACE_FILE = '/tmp/fairy-quiz-trace.json';
export const traceQuiz = () => existsSync(TRACE_ON);

// The quiz's look at the screen: a picture (shared with screen awareness when it's recent enough), the question read
// and cropped from it, and the heading you're hovering.
// picture(): { cache, shareMs }, the ScreenAwareness to look through and how often it looks by itself (0 if only on
// request); pollMs(): the quiz's own poll now; quiz(): the QuizMonitor; target: its QuizTarget; pointer(): the pointer in
// screen points; displayId(): the display looked at; exclude(snapshot): Fairy's own windows in that picture, as
// fractions of it, when the helper didn't leave them out; nativeImage: Electron's, for the crop.
// recognize: the text reader (quiz-recognition.mjs), passed in only by tests.
export function quizObserver({ picture, pollMs, quiz, target, pointer, displayId, exclude = () => [], nativeImage, recognize = recognizeQuiz, crop = recognize === recognizeQuiz ? cropQuiz : null }) {
  let quizCrop = null;
  const quizTrace = [];
  return async signal => {
    const started = Date.now(), { cache, shareMs } = picture(), monitor = quiz();
    const snapshot = await cache.fresh(signal, shareMaxAge({ pollMs: pollMs(), shareMs, hovering: target.pendingHover, checking: Boolean(monitor.candidate || monitor.job) }));
    const capturedAt = cache.image?.at ?? Date.now(), captureMs = Date.now() - started, ocrStarted = Date.now();
    signal?.throwIfAborted();
    const left = exclude(snapshot);
    let recognized = await recognize(snapshot, left, signal);
    const at = pointer(), bounds = snapshot.bounds;
    const trace = traceQuiz() ? { at: Date.now(), app: recognized.app, windowId: recognized.windowId, windowTitle: recognized.windowTitle, fullVisualKey: recognized.visualKey, region: recognized.region, bounds, pointer: at, exclude: left, imageSize: { width: snapshot.width, height: snapshot.height }, ocrSkipped: recognized.timings?.ocrSkipped, lineCount: recognized.lines?.length, labels: recognized.lines?.slice(0, 40).map(l => ({ ...l, text: l.text.slice(0, 100) })) } : null;
    recognized = target.select({ ...recognized, displayId: displayId() }, { x: (at.x - bounds.x) / bounds.width, y: (at.y - bounds.y) / bounds.height }, { bounds, capturedAt });
    if (trace) {
      quizTrace.push({ ...trace, status: monitor.status, counts: monitor.state().counts, viewKey: monitor.viewKey, candidate: monitor.candidate, bufferedKeys: monitor.buffer.frames.map(f => f.visualKey), textKey: createHash('sha256').update(recognized.text || '').digest('hex'), heads: target.heads, selected: target.selected, hover: target.hover, waiting: target.waiting });
      if (quizTrace.length > 40) quizTrace.shift();
      await writeFile(TRACE_FILE, JSON.stringify(quizTrace), { mode: 0o600 }).catch(() => {});
    }
    const observation = { ...recognized, displayId: displayId(), capturedAt, timings: { ...recognized.timings, captureMs, ocrMs: Date.now() - ocrStarted } };
    const r = observation.region;
    if (r && r.width > 0 && r.height > 0) {
      // All of this runs where the window's input is handled. The same frame and region give the same
      // crop, so it isn't redone, and a new frame lets input through between its slow steps.
      const cropKey = `${JSON.stringify(r)}|${JSON.stringify(left)}`;
      if (quizCrop?.url === snapshot.url && quizCrop.key === cropKey) return { ...observation, visualKey: quizCrop.visualKey, scrollEvidence: quizCrop.scroll, snapshot: { ...snapshot, ...quizCrop.snapshot } };
      // Efficiency audit, fix 8B: run pixel checks, scroll evidence and PNG crop inside the native helper,
      // reusing the screenshot already decoded for OCR so Electron's main process handles zero bitmaps.
      if (crop && snapshot.width > 0 && snapshot.height > 0) {
        const x = Math.max(0, Math.floor(r.x * snapshot.width)), y = Math.max(0, Math.floor(r.y * snapshot.height));
        const width = Math.min(snapshot.width - x, Math.floor(r.width * snapshot.width)), height = Math.min(snapshot.height - y, Math.floor(r.height * snapshot.height));
        if (width > 0 && height > 0) {
          const browser = /safari|chrome|chromium|firefox|dia|arc|edge/i.test(recognized.app || '');
          const targeted = Boolean(recognized.targetQuestion);
          const pixelScale = bounds?.width ? snapshot.width / bounds.width : 1;
          const contentRect = questionContentRect(width, height, { top: y, screenHeight: snapshot.height, lines: recognized.lines, browser, targeted, pixelScale });
          const blanks = contentRect ? excludeBlanks(left, width, height, { left: x, top: y, screenWidth: snapshot.width, screenHeight: snapshot.height }) : [];
          const scrollIgnore = left.map(m => ({ from: Math.floor(m.y * snapshot.height) - y, to: Math.ceil((m.y + m.height) * snapshot.height) - y }));
          const native = await crop(snapshot, { frameToken: recognized.frameToken, region: { x, y, width, height }, contentRect, exclude: blanks, scrollIgnore, screenHeight: snapshot.height }, signal)
            .catch(err => { if (signal?.aborted) throw err; return null; });
          if (native?.url) {
            const visualKey = native.visualKey || recognized.visualKey;
            const scoped = { visualKey, url: native.url, width: native.width, height: native.height };
            quizCrop = { url: snapshot.url, key: cropKey, visualKey, scroll: native.scrollEvidence ?? null, snapshot: scoped };
            return { ...observation, visualKey, scrollEvidence: native.scrollEvidence ?? null, snapshot: { ...snapshot, ...scoped } };
          }
        }
      }
      const breathe = async () => { await new Promise(resolve => setImmediate(resolve)); signal?.throwIfAborted(); };
      const image = nativeImage.createFromDataURL(snapshot.url);
      await breathe();
      const size = image.getSize();
      const x = Math.max(0, Math.floor(r.x * size.width)), y = Math.max(0, Math.floor(r.y * size.height));
      const width = Math.min(size.width - x, Math.floor(r.width * size.width)), height = Math.min(size.height - y, Math.floor(r.height * size.height));
      if (width > 0 && height > 0) {
        // Efficiency audit, fix 8: one copy of the pixels, checked in place, and one small crop for the question at the
        // end, instead of near-full-size crops copied twice. The whole picture's pixels when the area is most of it,
        // otherwise that area's alone. The same pixels as before, so the same PNG and the same keys.
        const whole = width * height * 2 >= size.width * size.height;
        const bitmap = whole ? image.toBitmap() : image.crop({ x, y, width, height }).toBitmap();
        await breathe();
        const stride = whole ? size.width : width, origin = whole ? { x, y } : { x: 0, y: 0 }, region = { x, y, width, height };
        const { scroll, content } = questionChecks(bitmap, stride, origin, region, { screenWidth: size.width, screenHeight: size.height, lines: recognized.lines, exclude: left, browser: /safari|chrome|chromium|firefox|dia|arc|edge/i.test(recognized.app || ''), targeted: Boolean(recognized.targetQuestion), pixelScale: size.width / bounds.width, scrollIgnore: left.map(m => ({ from: Math.floor(m.y * size.height) - y, to: Math.ceil((m.y + m.height) * size.height) - y })) });
        await breathe();
        const cropped = image.crop(questionTrim(bitmap, stride, origin, region, content));
        await breathe();
        const visualKey = content?.key || recognized.visualKey, scoped = { visualKey, url: cropped.toDataURL(), ...cropped.getSize() };
        quizCrop = { url: snapshot.url, key: cropKey, visualKey, scroll, snapshot: scoped };
        return { ...observation, visualKey, scrollEvidence: scroll, snapshot: { ...snapshot, ...scoped } };
      }
    }
    return { ...observation, snapshot };
  };
}

// The watcher itself: its target (a hovered heading, or any question when automatic is on), the monitor, and how it
// looks. allowed(), publish(answer), changed(state), solve(observation, signal, onText), writtenAnswers() and
// copyWritten(text) are each Mac's own; the rest is quizObserver's.
export function buildQuiz({ allowed, publish, changed = () => {}, solve, writtenAnswers = () => false, copyWritten = () => { throw new Error('Written quiz answers are disabled.'); }, ...look }) {
  const target = new QuizTarget();
  target.setAutomatic(false);
  let quiz = null;
  const observe = quizObserver({ ...look, target, quiz: () => quiz });
  quiz = new QuizMonitor({
    allowed, publish, requestSettleMs: 650, retryAbstentions: false,
    changed: state => { if (!state.enabled || /^Paused/.test(state.status)) { clearQuizRecognition(); target.clear(); } changed(state); },
    parseAnswer: text => parseQuizAnswer(text, { symbols: true, writtenAnswers: writtenAnswers() }),
    copyWritten, observe, solve,
  });
  return { quiz, target, observe };
}

// How often it looks: the poll (cadence(): { look, delay } from attention.watchCadence; pollDelay(): the next poll in ms)
// and, between polls, the pointer over a heading, which wakes the poll when a hover settles. Returns both tasks.
export function quizTasks({ quiz, target, enabled, cadence, pollDelay, pointer, Task = ConditionalTask }) {
  const poll = new Task({ enabled,
    delay: () => { const now = cadence(); return now.look ? pollDelay() : now.delay; },
    run: () => { if (!cadence().look) return; return quiz.tick(); } });
  const hover = new Task({ enabled,
    delay: () => { const now = cadence(); return now.look ? target.hoverEveryMs() : now.delay; },
    run: () => { if (!cadence().look) return; if (target.sampleScreenPoint(pointer())) void quiz.tick(); } });
  // A heading seen: the hover sampler, looking once a second while there was nothing to hover, looks quickly again.
  target.onHeadings = () => { if (hover.at != null && hover.at - Date.now() > 150) hover.sync(true); };
  return { poll, hover };
}
