import test from 'node:test';
import assert from 'node:assert/strict';
import { toolKind, toolOfStep, GLYPH_KINDS, glyphFrames } from '../src/tool-glyphs.js';

test('each status says what Fairy is doing', () => {
  const cases = { 'Checking live sources…': 'search', 'Checking Gmail…': 'mail', 'Checking Google Calendar…': 'calendar', 'Looking at your screen…': 'screen',
    'Looking at the app you’re using…': 'screen', 'Transcribing on your Mac…': 'voice', 'Listening · up to 60 seconds': 'voice', 'Making a page…': 'make',
    'Checking GitHub…': 'code', 'Desktop step 2 of 12': 'code', 'Checking Google Drive…': 'files', 'Reading your files for the page…': 'files',
    'Thinking…': 'think', 'Fairy has a thought…': 'think', 'Fairy needs your OK': 'ask', 'Ready when you are': null, 'Stopped': null, '': null };
  for (const [text, kind] of Object.entries(cases)) assert.equal(toolKind(text), kind, text);
  assert.equal(toolOfStep('web_search'), 'search');
  assert.equal(toolOfStep('read_file'), 'files');
  assert.equal(toolOfStep('run_command'), 'code');
  assert.equal(toolOfStep('write_file'), 'make');
  assert.equal(toolOfStep('use_computer'), 'screen');
});

test('every glyph frame fits its 10 × 8 pixel grid', () => {
  for (const kind of GLYPH_KINDS) for (const frame of glyphFrames(kind) ?? []) {
    assert.ok(frame.length <= 8, `${kind} is too tall`);
    for (const row of frame) { assert.equal(row.length, 10, `${kind}: “${row}”`); assert.match(row, /^[#.]+$/); }
  }
});
