// Efficiency audit, fix 12: what a launch no longer loads until it's needed, and the launch timeline that times it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const engineLoaded = () => Object.keys(require.cache).some(path => path.includes('/speech-rule-engine/'));

// This file runs in its own process, so nothing has loaded the engine before these first tests.
test('importing the speech code and the providers no longer loads the maths speech engine', async () => {
  const { speechText } = await import('../desktop/speech.mjs');
  await import('../desktop/core.mjs');
  const { mathSpeechLoaded } = await import('../desktop/math-speech.mjs');
  assert.equal(mathSpeechLoaded(), false);
  assert.equal(engineLoaded(), false);
  assert.equal(speechText('No maths here, just words.'), 'No maths here, just words.');
  assert.equal(mathSpeechLoaded(), false, 'plain text never loads it');
});

test('before the engine has loaded, maths reads as a pointer to the screen, and that stand-in is not kept', async () => {
  const { mathSpeech, loadMathSpeech } = await import('../desktop/math-speech.mjs');
  assert.equal(mathSpeech('x^2'), 'the equation shown on screen');
  await loadMathSpeech();
  assert.match(mathSpeech('x^2'), /x squared/);
});

test('hasMath matches the delimiters spokenMath reads and nothing else', async () => {
  const { hasMath } = await import('../desktop/math-speech.mjs');
  for (const text of [String.raw`see \(x\)`, String.raw`\[y\]`, '$z$', '$$w$$']) assert.equal(hasMath(text), true, text);
  for (const text of ['plain words', '', null, undefined, 'a (bracket) and [list]']) assert.equal(hasMath(text as any), false, String(text));
});

test('a reply with maths loads the engine before it is turned into speech', async () => {
  const { ReplyVoice } = await import('../desktop/reply-voice.mjs');
  const parts: any[] = [];
  const voice = new ReplyVoice({ signal: new AbortController().signal, speak: async () => new Uint8Array([1]), emit: part => parts.push(part) });
  await voice.finish(String.raw`The area is \(\pi r^2\).`);
  assert.equal(parts.length, 1);
  assert.match(parts[0].text, /pi r squared/);
});

test('the providers wait for the engine before speaking maths', () => {
  const core = readFileSync(new URL('../desktop/core.mts', import.meta.url), 'utf8');
  assert.match(core, /if \(hasMath\(text\)\) await loadMathSpeech\(\)\.catch\(\(\) => \{\}\);\n\s*text = voiceText\(text, settings\);/);
  const calls = readFileSync(new URL('../build-ts/desktop/notebook/calls.mjs', import.meta.url), 'utf8');
  assert.match(calls, /if \(hasMath\(turn\.answer\)\)\s*await loadMathSpeech\(\)\.catch\(\(\) => \{\s*\}\);\n\s*const failed = await said\.finish\(tutorSpeech/);
});

test('the launch timeline keeps each step once, places the window’s marks on its clock, and keeps 50 launches', async () => {
  const { StartupTimes, KEEP } = require('../desktop/startup-times.cjs');
  let clock = 100;
  const times = new StartupTimes({ now: () => clock, wall: () => Date.UTC(2026, 10, 14) });
  times.mark('ready'); clock = 250; times.mark('ready'); times.mark('load-start');
  times.pageMarks({ script: 40.4, usable: 300, 'Bad name': 1, huge: 1e9, negative: -1 }, times.marks['load-start']);
  assert.deepEqual(times.marks, { ready: 100, 'load-start': 250, 'page-script': 290, 'page-usable': 550 });
  const path = join(mkdtempSync(join(tmpdir(), 'fairy-startup-')), 'startup.jsonl');
  await writeFile(path, Array.from({ length: 60 }, (_, i) => JSON.stringify({ old: i })).join('\n') + '\n');
  const line = await times.finish({ path, readFile, writeFile });
  assert.equal(line.at, '2026-11-14T00:00:00.000Z');
  const kept = readFileSync(path, 'utf8').trim().split('\n').map(JSON.parse as any);
  assert.equal(kept.length, KEEP);
  assert.deepEqual(kept.at(-1), line);
  assert.deepEqual(kept[0], { old: 11 });
  times.mark('late');
  assert.equal(await times.finish({ path, readFile, writeFile }), null);
  assert.equal('late' in times.marks, false);
});

test('the main process marks its launch steps and records the window’s once it is usable', () => {
  const main = readFileSync(new URL('../build-ts/desktop/main.cjs', import.meta.url), 'utf8');
  const order = ["startupTimes.mark('ready')", "startupTimes.mark('modules')", "startupTimes.mark('load-start')", "startupTimes.mark('page-loaded')"].map(text => main.indexOf(text));
  assert(order.every(index => index > 0) && order.every((index, i) => i === 0 || index > order[i - 1]), 'marks in launch order');
  assert.match(main, /ipcMain\.on\('fairy:startup-usable', \(event, page\) => \{\n\s*if \(!window \|\| window\.isDestroyed\(\) \|\| event\.sender !== window\.webContents\)\s*return;/);
  const app = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
  assert.match(app, /initialized = true; updateState\(\); activityPopover\?\.refresh\(\); if \(api\) \{ api\.startupUsable\?\.\(\{ script: startupScript, state: startupState, usable: Math\.round\(performance\.now\(\)\) \}\);/);
});

test('nothing shown at launch takes its look from the notebook view’s stylesheet, which loads with the view', () => {
  const app = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
  const notebookCss = readFileSync(new URL('../src/notebook.css', import.meta.url), 'utf8');
  // Elements in the window's markup that aren't hidden at first: their rules must live in a stylesheet loaded up front.
  const shown = [...app.matchAll(/<[a-z]+\b[^>]*\bid="([\w-]+)"[^>]*>/g)].filter(([tag]) => !/\shidden\b/.test(tag)).map(([, id]) => id);
  assert(shown.includes('sidebar-study'), 'the Study notebooks button is in the markup');
  const styled = shown.filter(id => new RegExp(`^#${id}(?![\\w-])`, 'm').test(notebookCss));
  assert.deepEqual(styled, []);
  const workspaceCss = readFileSync(new URL('../src/workspace.css', import.meta.url), 'utf8');
  assert.match(workspaceCss, /^#sidebar-study\{--icon:url\(/m);
});
