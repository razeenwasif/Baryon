import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const main = await readFile(new URL('../build-ts/desktop/main.cjs', import.meta.url), 'utf8');
const faceMain = await readFile(new URL('../desktop/face-main.cts', import.meta.url), 'utf8');
const block = (text: string, start: string, length = 900): string => { const at = text.indexOf(start); assert.ok(at >= 0, start); return text.slice(at, at + length); };

test('a face asks in Quick chat for words, or a drawing for its own screen: no app opening, drawing, guiding or reading aloud on this Mac', () => {
  const face = block(main, 'faceLink = new FaceLink({', 1200);
  assert.match(face, /: quickReply\(text, \{ from: 'face', model: \(\) => quickChat\.send\(text, \{ onText, handoff: settings\.autoDesktop === 'on' \? \(\{ text: asked, signal \}\) => faceDesktop\(asked, \{ signal, onProgress, becomeTask \}\) : undefined \}\) \}\)\),/);
  assert.match(face, /\? explainOnFace\(\{ text, drawn, focus, scene: faceScene, link: faceLink,/);
  for (const word of ['companion-speak', 'openAsked', 'companionExplain', 'companionGuide', 'runDesktopTask', 'inkOverlay']) assert.ok(!face.includes(word), word);
  assert.match(main, /phoneLink = new PhoneLink\(\{[^\n]*face: faceLink,/);
  assert.match(main, /handle\('phone-link-pair-mac', \(\) => phoneLink\.pair\(\{ kind: 'mac' \}\)/);
});

test('the companion keeps its order: a rule first, then the model, and the window reads it aloud', () => {
  const reply = block(main, 'quickReply = async (text, { from, model }) => {', 1400);
  assert.ok(reply.indexOf('quickRule(text)') < reply.indexOf("noteRequest('model', 'chat', from)"));
  // The companion here asks through the window's own handler, which opens apps and tries the rules before any model.
  const chat = block(main, "fromCompanion('chat', async (text) => {", 1600);
  assert.match(chat, /\(\) => chatTurn\(text, 'chat'\)\);/);
  assert.match(chat, /window\.webContents\.send\('fairy:companion-speak', reply\.speechText \|\| reply\.text\)/);
  const turn = block(main, 'const chatTurn = (text, mode', 5000);
  assert.ok(turn.indexOf('appLauncher.resolve(') < turn.indexOf('quickRule(text') && turn.indexOf('quickRule(text') < turn.indexOf("noteRequest('model', mode, 'chat')"));
});

test('a question for an OK goes where the companion’s goes, and her voice is the one made for a phone', () => {
  assert.match(main, /const toCompanion = [\s\S]{0,160}if \(channel === 'fairy:companion-approval'\)\s*faceLink\?\.approval\(value\);/);
  assert.match(main, /makeVoice: replyVoice,/);
  assert.match(block(main, 'faceLink = new FaceLink({', 1400), /makeVoice: replyVoice/);
});

test('a face allows only after Touch ID, never makes a test copy a login item, and plays only unmuted clips', () => {
  assert.match(faceMain, /canPromptTouchID\(\)[\s\S]{0,200}promptTouchID\([\s\S]{0,120}client!\.answer\(String\(id\), 'allow', store!\.approveKey\(\)\)/);
  assert.match(faceMain, /if \(app\.isPackaged\) app\.setLoginItemSettings/);
  assert.match(faceMain, /if \(voice\.fetching \|\| store!\.state\(\)\.muted\) return;/);
});

test('a test copy seals with a Keychain item of its own, and the real app keeps its name', () => {
  assert.match(main, /app\.setName\(separateData \? 'lyra-companion-test' : 'lyra-companion'\);/);
  assert.ok(main.indexOf('const separateData') < main.indexOf('app.setName('));
  assert.match(main, /app\.on\('will-quit', \(\) => \{ phoneLink\.stop\(\); faceLink\.close\(\); clearInterval\(presenceTimer(?:\s*\?\?\s*undefined)?\); idleReader\.stop\(\); \}\);/);
});

test('presence: the full Fairy samples only while a face is connected, hands her over by the rule, and can bring her back', () => {
  const watch = block(main, 'const watchPresence = () => {', 700);
  assert.match(watch, /if \(on && !presenceTimer\) \{\s*idleReader\.start\(\);\s*presenceTimer = setInterval\(samplePresence, PRESENCE_EVERY_MS\);/);
  assert.match(watch, /if \(!on && presenceTimer\) \{\s*clearInterval\(presenceTimer\);\s*presenceTimer = null;\s*idleReader\.stop\(\);\s*\}/);
  assert.match(main, /onChange: watchPresence, onPresence: \(?report\)? => \{ if \(report\.ride\)\s*faceRide = report\.ride; facePresence\.faceReport\(report\); decidePresence\(\); \}/);
  assert.match(main, /if \(id === 'here'\) \{\s*bringFairyHere\(\);\s*return;\s*\}/);
  // The companion glides out to the face (floating Fairy, who also could, is gone).
  assert.match(main, /if \(!rode\)\s*await glide\.glideOut\(companionWindow, \{ screen, point: homeEdges\.exit \}\);/);
  assert.ok(!main.includes("awayToFace = 'floating'"));
});

test('presence: a face samples only while connected, reports a claim even mid-report, and glides only on the other Mac’s word', () => {
  assert.match(faceMain, /if \(link === 'connected'\) void startPresence\(\); else stopPresence\(\);/);
  assert.match(faceMain, /\(sending && !extra\.claim\)/);
  assert.match(faceMain, /if \(type === 'show'\) \{ shownHere = payload\.on === true; return applyShown\(\{ glideBy: true, ride: payload\.ride \?\? null \}\); \}/);
  assert.match(faceMain, /const wanted = \(\)(?:: boolean)? => !userHidden && \(link !== 'connected' \|\| shownHere\);/);
});

test('opening Fairy again on either Mac brings her there', () => {
  assert.match(main, /app\.on\('second-instance', \(\) => \{ bringFairyHere\(\); showWindow\(\); window\?\.focus\(\); \}\);/);
  assert.match(faceMain, /app\.on\('second-instance', \(\) => bringHere\(\)\);/);
});
