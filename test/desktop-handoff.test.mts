// Chat and Desktop task in one (16 Nov 2026): a chat's model answers the marker when the user asked for something done
// on the computer, and the app runs a Desktop task with their words; the marker is never shown, said or saved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CompanionChat } from '../desktop/companion-chat.mjs';
import { conversationInstructions, desktopAsked, DESKTOP_MARKER, mayBeMarker } from '../desktop/core.mjs';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

function chat(answer: string) {
  const saved: any[] = [], seen: any[] = [];
  const sessions = { sessions: [{ id: 'q' }], active: null, read: async () => [], addChat: async () => 'q', append: async (id: string, entries: any[]) => { saved.push(...entries); return entries; } };
  const quick = new CompanionChat({ sessions: sessions as any, path: '/nowhere', readJSON: (async () => ({ sessionId: 'q' })) as any, writeJSON: async () => {}, settings: () => ({ name: 'Fairy', personality: '' }) as any,
    provider: () => ({ chat: async (settings: any, _history: any, _text: any, _signal: any, _shot: any, { onText }: { onText?: (value: string) => void } = {}) => { seen.push(settings); for (const part of [answer.slice(0, 2), answer]) onText?.(part); return { text: answer }; } }) as any });
  return { quick, saved, seen };
}

test('the marker is recognised whole, and a reply that may still become it isn’t shown', () => {
  assert.equal(DESKTOP_MARKER, '[[desktop]]');
  assert.ok(desktopAsked('[[desktop]]') && desktopAsked('  [[desktop]]\n'));
  assert.ok(!desktopAsked('[[desktop]] then some words') && !desktopAsked('Sure!'));
  for (const part of ['[', '[[', '[[desk', '[[desktop]]']) assert.ok(mayBeMarker(part), part);
  for (const part of ['', 'Sure', '[x', '[[desktop]] and']) assert.ok(!mayBeMarker(part), part);
});

test('her instructions tell her to answer the marker only when the user wants something done', () => {
  const on = conversationInstructions({ name: 'Fairy', personality: '', desktopHandoff: true } as any), off = conversationInstructions({ name: 'Fairy', personality: '' } as any);
  assert.match(on, /reply with exactly \[\[desktop\]\] and nothing else/);
  assert.match(on, /not when they ask how/);
  assert.doesNotMatch(off, /\[\[desktop\]\]/);
  assert.match(off, /turn on Automatic desktop requests/);
  assert.match(conversationInstructions({ name: 'Fairy', personality: '', desktopHandoff: true, remoteWindow: true } as any), /came from the user’s MacBook/);
});

test('Quick chat runs the task when the model hands off, and saves the task’s reply as one turn', async () => {
  const { quick, saved, seen } = chat('[[desktop]]'), shown: string[] = [], asked: string[] = [];
  const reply = await quick.send('open Calculator and work out 24 × 7', { onText: value => shown.push(value), handoff: async ({ text }) => { asked.push(text); return '168, in Calculator.'; } });
  assert.equal(reply.text, '168, in Calculator.');
  assert.deepEqual(asked, ['open Calculator and work out 24 × 7']);
  assert.equal(seen[0].desktopHandoff, true);
  assert.deepEqual(shown, [], 'the marker never shows');
  assert.deepEqual(saved.map(entry => [entry.role, entry.mode, entry.content]), [['user', 'desktop', 'open Calculator and work out 24 × 7'], ['assistant', 'desktop', '168, in Calculator.']]);
});

test('an ordinary answer stays an answer, and without a hand-off the model isn’t told it can', async () => {
  const { quick, saved, seen } = chat('24 × 7 is 168.'), shown: string[] = [];
  let handed = false;
  assert.equal((await quick.send('what is 24 × 7', { onText: value => shown.push(value), handoff: async () => { handed = true; return ''; } })).text, '24 × 7 is 168.');
  assert.equal(handed, false);
  assert.deepEqual(shown, ['24', '24 × 7 is 168.']);
  assert.equal(saved[1].mode, 'chat');
  const plain = chat('Hi');
  await plain.quick.send('hello');
  assert.equal(plain.seen[0].desktopHandoff, undefined);
});

test('the window’s chat and both companions hand off; the switches show only with automatic requests off', async () => {
  const main = await read('../build-ts/desktop/main.cjs'), app = await read('../src/app.ts');
  assert.match(main, /const handoff = mode === 'chat' && !files\.length && !usesSkill && settings\.autoDesktop === 'on' && process\.platform === 'darwin';/);
  assert.match(main, /if \(handoff && mode === 'chat' && core\.desktopAsked\(reply\)\) \{\s*mode = 'desktop';[^}]*reply = await runDesktop\(\);\s*\}/);
  assert.match(main, /if \(handoff && mode === 'chat' && core\.mayBeMarker\(value\)\)\s*return;/);
  assert.match(main, /companionCalls\.run\(\{ id, onText: \(?value\)? => toCompanion\('fairy:companion-text', value\), progress: \(?value\)? => toCompanion\('fairy:companion-progress', value\) \}, \(\) => chatTurn\(text, 'chat'\)\);/, 'the companion here asks as the window does');
  assert.match(main, /if \(remoteDesktopActive\)\s*throw new Error\('Fairy is already working on your MacBook’s screen\.'\);\n\s*noteRequest\('model', 'desktop', 'face'\);\n\s*becomeTask\?\.\(\);/, 'the MacBook’s, told the turn is a task only once it can start');
  assert.match(app, /for \(const node of document\.querySelectorAll(?:<[^>]+>)?\('\.mode-switch, #floating-mode'\)\) node\.hidden = !manualDesktop;/);
});

test('a Desktop task’s report reaches later chats marked as really done, and she’s told not to take it back', async () => {
  const { conversationInput, DESKTOP_DONE } = await import('../desktop/core.mjs');
  const input = conversationInput([
    { role: 'user', mode: 'desktop', content: 'open Calculator and work out 24 × 7' },
    { role: 'assistant', mode: 'desktop', content: 'Calculator shows 168.' },
    { role: 'user', mode: 'chat', content: 'hi' }, { role: 'assistant', mode: 'chat', content: 'Hello.' },
  ], 'did you open it?');
  assert.equal(input[1].content, `${DESKTOP_DONE} Calculator shows 168.`);
  assert.equal(input[0].content, 'open Calculator and work out 24 × 7', 'only her report is marked');
  assert.equal(input[3].content, 'Hello.');
  assert.match(conversationInstructions({ name: 'Fairy', personality: '' } as any), /really happened: Fairy did that on the user’s screen in a Desktop task, so speak of it as done and never call it made up/);
});

test('a task run through Quick chat is saved as a desktop turn', async () => {
  const { quick, saved } = chat('unused');
  await quick.send('open Calculator', { mode: 'desktop', run: async () => '168 in Calculator.' });
  assert.deepEqual(saved.map(entry => entry.mode), ['desktop', 'desktop']);
  const plain = chat('unused');
  await plain.quick.send('read this page', { run: async () => 'It says hi.' });
  assert.deepEqual(plain.saved.map(entry => entry.mode), ['chat', 'chat'], 'Flux’s runs stay chat turns');
  const main = await read('../build-ts/desktop/main.cjs');
  assert.match(main, /mode: 'desktop', run: companionDesktop \}\);/);
  assert.match(main, /quickChat\.send\(text, \{ onText, mode: 'desktop', run: \(\{ text: task, signal \}\) => faceDesktop\(/);
});
