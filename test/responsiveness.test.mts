import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QuizRecognizer } from '../desktop/quiz-recognition.mjs';
import { QuizMonitor } from '../desktop/quiz.mjs';
import { StallLog, mainStall } from '../desktop/stall-log.mjs';

const recognizer = (clock = { at: 1000 }) => {
  const calls: any[] = [];
  const instance = new QuizRecognizer({ now: () => clock.at, attempt: async (snapshot: any, exclude: any, signal: any, options: any) => { calls.push(options); return { text: `read ${snapshot.url}`, visualKey: `key-${snapshot.url}` }; } } as any);
  return { instance, calls, clock };
};
test('an unchanged screen doesn’t wake the recognition helper', async () => {
  const { instance, calls, clock } = recognizer();
  const first = await instance.recognize({ url: 'same' } as any);
  assert.equal(first.timings!.ocrSkipped, false);
  clock.at += 500;
  const second = await instance.recognize({ url: 'same' } as any);
  assert.equal(calls.length, 1, 'the helper ran once');
  assert.equal(second.text, 'read same');
  assert.equal(second.timings!.ocrIdentical, true);
  clock.at += 20000;
  await instance.recognize({ url: 'same' } as any);
  assert.equal(calls.length, 1, 'identical bytes stay valid past the short cache');
});
test('any change, or a long enough wait, still reads the screen again', async () => {
  const { instance, calls, clock } = recognizer();
  await instance.recognize({ url: 'one' } as any);
  await instance.recognize({ url: 'two' } as any);
  assert.equal(calls.length, 2);
  await instance.recognize({ url: 'two' } as any, [{ x: 1 }] as any);
  assert.equal(calls.length, 3, 'a different exclusion is a different reading');
  clock.at += 61000;
  await instance.recognize({ url: 'two' } as any, [{ x: 1 }] as any);
  assert.equal(calls.length, 4);
  instance.clear();
  await instance.recognize({ url: 'two' } as any, [{ x: 1 }] as any);
  assert.equal(calls.length, 5);
});
test('a screen with no recognized key is never treated as already read', async () => {
  const calls: number[] = [];
  const instance = new QuizRecognizer({ now: () => 1000, attempt: async () => { calls.push(1); return { text: '', visualKey: '' }; } } as any);
  await instance.recognize({ url: 'x' } as any);
  await instance.recognize({ url: 'x' } as any);
  assert.equal(calls.length, 2);
});
const monitor = () => new QuizMonitor({ observe: async () => ({}), solve: async () => ({}), allowed: () => true, publish() {}, changed() {}, now: () => 100000 } as any);
test('scanning slows while you’re away or typing in Fairy, unless something needs checking', () => {
  const quiz = monitor();
  quiz.changedViewAt = 0;
  assert.equal(quiz.nextPollMs(500, { idleSeconds: 45 }), 4000);
  assert.equal(quiz.nextPollMs(500, { focused: true }), 4000);
  assert.equal(quiz.nextPollMs(500, { idleSeconds: 10 }), 500, 'in use, a first question is still spotted quickly');
  quiz.shown = 'B';
  assert.equal(quiz.nextPollMs(500), 1500, 'a settled answered page is checked less often');
  quiz.changedViewAt = 99000;
  assert.equal(quiz.nextPollMs(500), 500, 'a view that just moved is checked quickly');
  quiz.job = {} as any;
  assert.equal(quiz.nextPollMs(500, { idleSeconds: 45 }), 500, 'a running question still gets verified');
  quiz.job = null;
  assert.equal(quiz.nextPollMs(0), 0, 'power policy can still turn it off');
});
test('recognition that keeps failing backs off instead of holding a CPU core', () => {
  const quiz = monitor(), waits: number[] = [];
  const warn = console.warn; let warned = 0; console.warn = () => { warned++; };
  try { for (let i = 0; i < 10; i++) { quiz.recoverRecognition(Object.assign(new Error('Local quiz recognition timed out.'), { code: 'QUIZ_OCR_TIMEOUT' })); waits.push(quiz.ocrRetryAt - 100000); } } finally { console.warn = warn; }
  assert.deepEqual(waits, [1000, 2000, 4000, 8000, 16000, 32000, 64000, 120000, 120000, 120000]);
  assert.equal(warned, 1, 'the reason is logged once per run of failures');
});
test('a timer running late counts as a stall, and sleep doesn’t', () => {
  assert.equal(mainStall(50), false);
  assert.equal(mainStall(1200), true);
  assert.equal(mainStall(1200, { suspended: true }), false);
  assert.equal(mainStall(3600000), false);
});
test('the stall log stays small and records only what it’s given', async (t: TestContext) => {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-stalls-')), path = join(dir, 'stalls.jsonl');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const log = new StallLog({ path, now: () => '2026-11-03T00:00:00.000Z' });
  await log.add({ where: 'main', ms: 1200 });
  assert.deepEqual(JSON.parse((await readFile(path, 'utf8')).trim()), { at: '2026-11-03T00:00:00.000Z', where: 'main', ms: 1200 });
  await writeFile(path, `${JSON.stringify({ old: 'x'.repeat(100) })}\n`.repeat(3000));
  await log.add({ where: 'renderer', ms: 900 });
  const text = await readFile(path, 'utf8');
  assert.ok((await stat(path)).size <= 140 * 1024);
  for (const line of text.trim().split('\n')) JSON.parse(line);
  assert.match(text, /renderer/);
});
test('a test copy keeps its own browser storage, and a missing avatar choice means Fairy', () => {
  const main = readFileSync(new URL('../build-ts/desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /separateData \? join\(separateData, 'browser'\)/);
  assert.match(main, /if \(!quitting && !window\?\.isDestroyed\(\)\)\s*dialog\.showErrorBox/, 'quitting during startup isn’t an error');
  assert.match(readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8'), /getItem\('lyra-avatar-choice'\) \|\| 'fairy'/);
});
test('a helper that has to start up gets time to load before it counts as too slow', () => {
  const source = readFileSync(new URL('../desktop/quiz-recognition.mts', import.meta.url), 'utf8');
  assert.match(source, /\(options\.timeoutMs\s*\?\?\s*2500\)\s*\+\s*\(cold\s*\?\s*COLD_START_MS\s*:\s*0\)/);
});
test('quiz image work isn’t repeated for an unchanged frame, and lets input through otherwise', () => {
  const main = readFileSync(new URL('../desktop/quiz-setup.mts', import.meta.url), 'utf8');
  const section = main.slice(main.indexOf('const cropKey ='), main.indexOf('return { ...observation, snapshot };'));
  assert.ok(section.indexOf('quizCrop?.url === snapshot.url') < section.indexOf('nativeImage.createFromDataURL'), 'the reuse check comes before any decoding');
  assert.ok((section.match(/await breathe\(\);/g) || []).length >= 4);
});
test('background captures avoid encoding in the main process', () => {
  const main = readFileSync(new URL('../build-ts/desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /if \(desktopPresence\?\.active \|\| quiz\?\.enabled \|\| passive\) \{/);
});
