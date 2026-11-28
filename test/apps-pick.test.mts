// Opening an app by what it is ("my notes app"), on either Mac (desktop/apps.mjs), and the face's companion asking the
// other Mac's model which of its apps is meant (face-link.mjs /v1/face/app-pick).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { call, setup } from './helpers/face-pair.mjs';
import { AppLauncher, appRequest, cleanCard, notesAbout, pickPrompt, readPick, whichOne } from '../desktop/apps.mjs';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');
const APPS = ['Notes', 'Obsidian', 'Electron', 'Spotify', 'Terminal', 'Tachyon'].map(name => ({ name, path: `/Applications/${name}.app`, mine: false }));
const CARDS = APPS.map(app => cleanCard({ name: app.name, bundleId: `id.${app.name.toLowerCase()}`, category: 'productivity' })!);
function launcher() {
  const opened: string[] = [];
  const apps = new AppLauncher({ open: async path => { opened.push(path); } });
  apps.apps = async () => APPS;
  apps.cards = async () => CARDS;
  return { apps, opened };
}

test('“my … app” is an app request, and says it was the user’s own', () => {
  assert.deepEqual(appRequest('can you launch my notes app'), { name: 'notes', mine: true });
  assert.deepEqual(appRequest('launch Electron'), { name: 'Electron', mine: false });
  assert.deepEqual(appRequest('open the music player'), { name: 'music player', mine: false });
  assert.equal(appRequest('open my notes'), null, 'without “app”, notes are notes');
  assert.equal(appRequest('open a new tab'), null);
  assert.equal(appRequest('start a timer'), null);
});

test('“remember Electron is my notes app” is saved as a fact, without needing “that”', async () => {
  const { memoryCommand } = await import('../desktop/memory.mjs');
  assert.deepEqual(memoryCommand('remember Electron is my notes app'), { kind: 'remember', text: 'Electron is my notes app' });
  assert.deepEqual(memoryCommand('Please remember Tachyon and Ghostty are my terminals.'), { kind: 'remember', text: 'Tachyon and Ghostty are my terminals' });
  assert.equal(memoryCommand('remember to call Mum'), null);
  assert.equal(memoryCommand('remember what is my password'), null);
  assert.equal(memoryCommand('do you remember Electron is my notes app?'), null);
});

test('a name opens straight away; “my …” and a name no app has go to the picker, whose answer is kept', async () => {
  const { apps, opened } = launcher(), asked: string[] = [];
  const pick = async (name: string, cards: typeof CARDS) => { asked.push(name); assert.equal(cards, CARDS); return name === 'my notes' ? { app: CARDS[2] } : name === 'music player' ? { choices: [CARDS[3], CARDS[2]] } : null; };
  assert.deepEqual(await apps.resolve('open Electron', { pick }), { opened: APPS[2] });
  assert.deepEqual(asked, [], 'no model for a name');
  assert.deepEqual(await apps.resolve('can you launch my notes app', { pick }), { opened: APPS[2] });
  assert.deepEqual(await apps.resolve('launch my notes app please', { pick }), { opened: APPS[2] });
  assert.deepEqual(asked, ['my notes'], 'asked once, then kept');
  const which = await apps.resolve('open the music player', { pick }) as any;
  assert.deepEqual(which.choices.map((app: any) => app.name), ['Spotify', 'Electron']);
  assert.deepEqual(await apps.resolve('open the fax machine', { pick }), { missing: 'fax machine' });
  assert.deepEqual(await apps.resolve('what time is it', { pick }), null);
  assert.deepEqual(opened, ['/Applications/Electron.app', '/Applications/Electron.app', '/Applications/Electron.app']);
  // Without a picker only names count, as before.
  assert.deepEqual(await launcher().apps.resolve('launch my terminal'), { opened: APPS[4] });
});

test('the model’s answer is read as listed apps only; anything else is none', () => {
  assert.equal((readPick('{"app": "electron"}', CARDS) as { app: { name: string } }).app.name, 'Electron');
  assert.deepEqual((readPick('Sure! {"choices": ["Notes", "Obsidian", "Made Up"]}', CARDS) as { choices: { name: string }[] }).choices.map(card => card.name), ['Notes', 'Obsidian']);
  assert.equal((readPick('{"choices": ["Notes", "Nope"]}', CARDS) as { app: { name: string } }).app.name, 'Notes', 'one real choice is that app');
  assert.equal(readPick('{"app": "Word"}', CARDS), null);
  assert.equal(readPick('{"app": null}', CARDS), null);
  assert.equal(readPick('not json', CARDS), null);
});

test('the picker is told each app’s card and what the user said about their apps, and asks back by name', () => {
  const notes = notesAbout('Electron is my notes app\nI like tea\nTachyon is my terminal\nmy electrons are excited', CARDS);
  assert.deepEqual(notes, ['Electron is my notes app', 'Tachyon is my terminal'], 'whole names only');
  const prompt = pickPrompt('my notes', CARDS, notes);
  assert.match(prompt, /Request: open my notes/);
  assert.match(prompt, /- Electron is my notes app/);
  assert.match(prompt, /- Electron · id id\.electron · productivity/);
  assert.equal(whichOne([APPS[0], APPS[1], APPS[2]], 'my notes'), 'Which one: Notes, Obsidian or Electron? Whichever it is, even one not listed, say “remember [its name] is my notes app” and I’ll know next time.');
  assert.equal(cleanCard({ name: '', bundleId: 'x' }), null);
  assert.deepEqual(cleanCard({ name: 'A', mine: 'yes' as any, copyright: 'x'.repeat(300) })!.copyright.length, 100);
});

test('the face’s companion asks the other Mac which of its apps is meant, sending only the apps’ cards', async () => {
  const s = await setup(async () => ({ text: '' })), asked: any[] = [];
  s.face.pickApp = async (name, cards) => { asked.push({ name, cards }); return name === 'my notes' ? { app: cards[2] } : { choices: [cards[0], cards[1]] }; };
  try {
    const pick = (body: unknown) => call(s.link, '/v1/face/app-pick', { method: 'POST', key: s.key, body });
    assert.deepEqual((await pick({ asked: 'my notes', apps: [...CARDS, { name: 'X', script: 'no' }] })).json, { app: 'Electron' });
    assert.deepEqual(asked[0].cards.at(-1), { name: 'X', bundleId: '', category: '', mine: false, copyright: '' });
    assert.deepEqual((await pick({ asked: 'music', apps: CARDS })).json, { choices: ['Notes', 'Obsidian'] });
    assert.equal((await pick({ asked: '', apps: CARDS })).status, 400);
    assert.equal((await pick({ asked: 'x', apps: [] })).status, 400);
  } finally { await s.done(); }
});

test('both companions and the mini’s window use the picker; the face opens its own apps, the mini falls back to a Desktop task', async () => {
  const main = await read('../build-ts/desktop/main.cjs'), face = await read('../desktop/face-main.cts');
  // The companion here asks through the window's own chat handler, so one call serves both.
  assert.equal((main.match(/appLauncher\??\.resolve\(text, \{ pick: \(?pickApp(?:\s*\?\?\s*undefined)?\)? \}\)/g) || []).length, 1);
  assert.match(main, /\(\) => chatTurn\(text, 'chat'\)\);/);
  assert.match(main, /pickApp: \(asked, cards\) => pickApp\(asked, cards\),/);
  assert.match(face, /const asked = await localApps\.resolve\(text, \{ pick \}\)/);
  assert.match(face, /await client!?\??\.pickApp\(asked, cards\)/);
});

test('“remember Electron is my notes app” said to the companion is saved, on either Mac, before any rule or model', async () => {
  const main = await read('../build-ts/desktop/main.cjs');
  const quick = main.slice(main.indexOf('quickReply = async (text, { from, model }) => {'), main.indexOf("fromCompanion('chat', async (text) => {"));
  assert.ok(quick.indexOf('memory.memoryCommand(') < quick.indexOf('quickRule(text)'));
  assert.match(quick, /settings = core\.cleanSettings\(\{ rememberedFacts: update\.facts \}, settings\);/);
  assert.match(quick, /window\.webContents\.send\('fairy:settings', settings\)/);
  // The face's companion asks through the same quick reply.
  assert.match(main, /: quickReply\(text, \{ from: 'face', model: \(\) => quickChat\.send\(text, \{ onText, handoff: settings\.autoDesktop === 'on' \? \(\{ text: asked, signal \}\) => faceDesktop\(asked, \{ signal, onProgress, becomeTask \}\) : undefined \}\) \}\)\),/);
});
