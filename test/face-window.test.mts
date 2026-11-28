// Fairy away from the mini, Away 3: Fairy's own window on the face's Mac (desktop/face-window.mjs, face-main.cjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { FaceWindow, MINI_ONLY_MESSAGE, SENDS, type FaceWindowClient, type FaceWindowClientCallOptions } from '../desktop/face-window.mjs';
import type { PowerPolicyInput } from '../desktop/power-awareness.mjs';
import { LOCAL, MINI_ONLY, REMOTE } from '../desktop/remote-channels.mjs';
import { applyRemote, ELSEWHERE } from '../src/remote-window.js';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

interface SentRequest extends FaceWindowClientCallOptions {
  method: string;
  path: string;
}

// A stand-in for the face's client: answers like the other Mac's link, and notes every request.
function link({ answer = () => ({ result: null }) }: { answer?: (req: SentRequest) => unknown } = {}) {
  const sent: SentRequest[] = [];
  let tokens = 0;
  const client = { sent, async call(method: string, path: string, options: FaceWindowClientCallOptions = {}): Promise<any> {
    sent.push({ method, path, ...options });
    if (path === '/v1/face/window') return { token: `t${++tokens}`, expires: new Date(Date.now() + 3_600_000).toISOString() };
    if (path === '/v1/face/window/close') return { ok: true };
    // A ranged ask comes back as the response itself, streamed; anything else as its bytes.
    if (path.startsWith('/v1/face/page-file') && options.stream) return Object.assign(Readable.from([Buffer.from('0123'), Buffer.from('456789')]), { statusCode: 206, headers: { 'content-type': 'video/mp4', 'set-cookie': 'no', 'content-range': 'bytes 0-9/10', 'content-length': '10' } });
    if (path.startsWith('/v1/face/page-file')) return { status: 200, headers: { 'content-type': 'text/html', 'set-cookie': 'no', 'access-control-allow-origin': '*', 'content-length': '999' }, bytes: Buffer.from('<p>hi') };
    return answer({ method, path, ...options });
  } };
  return client as FaceWindowClient & { sent: SentRequest[] };
}

test('the window session is opened once, with Touch ID and the approve key, and calls carry its token', async () => {
  const client = link({ answer: ({ body }) => ({ result: { echoed: (body as any).args } }) }), asked: string[] = [];
  const window = new FaceWindow({ client, confirm: async reason => asked.push(reason), approveKey: () => 'approve-key' });
  assert.deepEqual(await window.call('state', []), { echoed: [] });
  assert.deepEqual(await window.call('session-rename', ['chat', 'new name']), { echoed: ['chat', 'new name'] });
  assert.deepEqual(asked, ['open Fairy’s window on this Mac'], 'Touch ID once');
  const opened = client.sent.filter(request => request.path === '/v1/face/window');
  assert.equal(opened.length, 1);
  assert.deepEqual(opened[0].body, { approveKey: 'approve-key' });
  const calls = client.sent.filter(request => request.path === '/v1/face/call');
  assert.deepEqual(calls.map(request => request.headers!['X-Fairy-Window']), ['t1', 't1']);
  assert.equal(calls[0].headers!['Accept-Encoding'], 'gzip');
});

test('her error comes back as the same text; an ended session is opened again, with Touch ID, once', async () => {
  let refuse = true;
  const client = link({ answer: ({ body }) => {
    if ((body as any).channel === 'session-open') return { error: 'That chat is gone.' };
    if (refuse) { refuse = false; throw Object.assign(new Error('Open Fairy’s window again to carry on.'), { status: 401 }); }
    return { result: 'ok' };
  } });
  let confirms = 0;
  const window = new FaceWindow({ client, confirm: async () => { confirms++; }, approveKey: () => 'k' });
  assert.equal(await window.call('state'), 'ok');
  assert.equal(confirms, 2, 'Touch ID again for the new session');
  await assert.rejects(window.call('session-open', ['gone']), /That chat is gone\./);
});

test('this Mac answers its own channels, and the rest are refused without reaching the other Mac', async () => {
  const client = link(), local = { minimize: () => 'minimised' };
  const window = new FaceWindow({ client, confirm: async () => {}, approveKey: () => 'k', local });
  assert.equal(await window.call('minimize'), 'minimised');
  assert.equal(await window.call('around-notch'), null, 'a Local channel with nothing to do here');
  await assert.rejects(window.call('subscription-login'), new RegExp(MINI_ONLY_MESSAGE));
  await assert.rejects(window.call('phone-pair'), new RegExp(MINI_ONLY_MESSAGE));
  await assert.rejects(window.call('preview-start', ['npm run dev']), new RegExp(MINI_ONLY_MESSAGE), 'a preview runs on the other Mac');
  assert.equal(client.sent.length, 0, 'nothing went to the other Mac');
});

test('allowing a step asks for Touch ID and sends the approve key; denying sends neither', async () => {
  const client = link(), asked: string[] = [];
  const window = new FaceWindow({ client, confirm: async reason => asked.push(reason), approveKey: () => 'approve-key' });
  await window.call('approval-answer', ['q1', 'deny']);
  await window.call('approval-answer', ['q1', 'allow']);
  const calls = client.sent.filter(request => request.path === '/v1/face/call');
  assert.equal((calls[0].body as any).approveKey, undefined);
  assert.equal((calls[1].body as any).approveKey, 'approve-key');
  assert.deepEqual(asked, ['open Fairy’s window on this Mac', 'allow a step Fairy asked about']);
});

test('her window’s events reach the page in order; a missed batch fetches the state afresh; ending closes the session', async () => {
  const client = link({ answer: () => ({ result: { dataDir: '/x', sessions: { active: 'c1', sessions: [] } } }) }), delivered: Array<[string, any]> = [];
  let confirms = 0;
  const window = new FaceWindow({ client, confirm: async () => { confirms++; }, approveKey: () => 'k', deliver: (channel, value) => delivered.push([channel, value]) });
  window.events({ seq: 1, events: [['reply', { text: 'early' }]] });
  assert.equal(delivered.length, 0, 'no window session yet: nothing');
  await window.session();
  window.events({ seq: 1, events: [['reply', { text: 'a' }], ['progress', 'thinking'], ['reply', { audio: { $bytes: 'AQ==' } }]] });
  window.events({ seq: 2, events: [['sessions', { list: [] }]] });
  assert.deepEqual(delivered.map(([channel]) => channel), ['reply', 'progress', 'reply', 'sessions']);
  assert.ok(Buffer.isBuffer(delivered[2][1].audio));
  window.events({ seq: 4, events: [['reply', { text: 'after a gap' }]] });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(delivered.slice(4).map(([channel, value]) => [channel, typeof value === 'string' ? value : 'list']), [['sessions', 'list'], ['session-show', 'c1']], 'nothing from after the gap is guessed at: the state is fetched');
  await window.end();
  assert.ok(client.sent.some(request => request.path === '/v1/face/window/close' && request.headers!['X-Fairy-Window'] === 't1'));
  await window.call('state');
  assert.equal(confirms, 2, 'the next call asks for Touch ID again');
});

test('a page’s files come from her with the window’s token, keeping only the headers a page needs', async () => {
  const client = link();
  const window = new FaceWindow({ client, confirm: async () => {}, approveKey: () => 'k' });
  const file = await window.file({ host: 'page', path: '/id/2/index.html' });
  assert.equal(file.status, 200);
  // Its length is the bytes it has, which a video needs to seek, and a sandboxed page can read it in CORS mode.
  assert.deepEqual(file.headers, { 'content-type': 'text/html', 'access-control-allow-origin': '*', 'content-length': '5' });
  assert.equal(file.bytes!.toString(), '<p>hi');
  const request = client.sent.find(item => item.path.startsWith('/v1/face/page-file'))!;
  assert.equal(request.path, '/v1/face/page-file?host=page&path=%2Fid%2F2%2Findex.html');
  assert.equal(request.headers!.Range, undefined);
  assert.equal(request.headers!['X-Fairy-Window'], 't1');
  // A video's range streams as it comes, with its own length and range, on a connection of its own.
  const clip = await window.file({ host: 'page', path: '/id/2/clip.mp4', range: 'bytes=0-' });
  assert.equal(clip.status, 206);
  assert.deepEqual(clip.headers, { 'content-type': 'video/mp4', 'content-range': 'bytes 0-9/10', 'content-length': '10' });
  const parts: Buffer[] = []; for await (const part of clip.stream!) parts.push(part);
  assert.equal(Buffer.concat(parts).toString(), '0123456789');
  const ranged = client.sent.filter(item => item.path.startsWith('/v1/face/page-file')).at(-1)!;
  assert.equal(ranged.stream, true); assert.equal(ranged.headers!.Range, 'bytes=0-'); assert.equal(ranged.headers!['X-Fairy-Window'], 't1');
});

test('the face answers every channel the window can call, for that window only, and drops the session on lock and sleep', async () => {
  const face = await read('../desktop/face-main.cts');
  assert.match(face, /for \(const channel of \[\.\.\.REMOTE, \.\.\.LOCAL, \.\.\.MINI_ONLY\]\) \{\n\s+if \(SENDS\.includes\(channel\)\) continue;/);
  assert.match(face, /if \(!fullWin \|\| fullWin\.isDestroyed\(\) \|\| event\.sender !== fullWin\.webContents \|\| !isWindowPage\(event\.senderFrame\?\.url\)\) throw new Error\('Untrusted application frame\.'\);\n\s+return faceWindow!\.call\(channel, args\);/);
  assert.match(face, /powerMonitor\.on\('lock-screen', \(\) => \{[^\n]*void faceWindow\?\.end\(\); \}\);/);
  assert.match(face, /powerMonitor\.on\('suspend', \(\) => void faceWindow\?\.end\(\)\);/);
  assert.match(face, /fullWin\.on\('closed', \(\) => \{ if \(notchHere\) \{ notchHere = null; notchNative\?\.present\(false\); \} fullWin = null; void faceWindow\?\.end\(\);/);
  // Full screen around the notch is kept as the other Mac keeps it, and ⌃⌘F is the menu's, not macOS's own full screen.
  assert.match(face, /fullscreenable: false,/);
  assert.match(face, /fullWin\.on\('minimize', \(\) => \{ if \(notchHere\) aroundNotchHere\(false\); \}\);\n\s+fullWin\.on\('focus', keepAroundNotch\);\n\s+fullWin\.on\('show', keepAroundNotch\);\n\s+keepNotchWatch\(\);\n\s+windowMenu\(\);/);
  assert.match(face, /app\.on\('did-become-active', keepAroundNotch\);/);
  assert.match(face, /screen\.on\('display-metrics-changed', /);
  assert.match(face, /\{ label: 'Full Screen Around the Notch', accelerator: 'Ctrl\+Cmd\+F', click: \(\) => \{ if \(here\(\)\) aroundNotchHere\(!notchHere\); \} \}/);
  assert.match(face, /\{ label: 'Edit', submenu: \[[^\n]*\{ role: 'paste' \}/);
  // Only a test copy run from the repo may skip Touch ID.
  assert.match(face, /if \(!app\.isPackaged && process\.env\.FAIRY_TEST_SKIP_TOUCH_ID === '1'\) return;/);
  assert.match(face, /fromPage\('companion-open-window', \(\) => openFullWindow\(\)\);/);
  for (const channel of SENDS) assert.ok([...LOCAL, ...MINI_ONLY].includes(channel), `${channel} is sorted`);
  assert.ok(REMOTE.length > 50);
});

test('open on the face’s Mac, what only the other Mac can do is shown disabled, saying where to do it', () => {
  const classes = new Set<string>(), controls: Array<Record<string, any> & { setAttribute(name: string, value: string): void }> = [{ setAttribute(name, value) { this[name] = value; } }, { setAttribute(name, value) { this[name] = value; } }];
  const root = { documentElement: { classList: { add: (name: string) => classes.add(name) } }, querySelectorAll: (selector: string) => (selector.includes('#tab-desktop') ? controls : []) };
  assert.equal(applyRemote({ remote: false }, root as unknown as Document), false);
  assert.equal(classes.size, 0);
  assert.equal(applyRemote({ remote: true }, root as unknown as Document), true);
  assert.ok(classes.has('remote-window'));
  for (const control of controls) { assert.equal(control.disabled, true); assert.equal(control['aria-disabled'], 'true'); assert.equal(control.title, ELSEWHERE); }
});

test('the window draws by this Mac’s own policy: her other window unseen, or you away from her Mac, never stills this one', async () => {
  const { seenHere } = await import('../desktop/face-window.mjs');
  // You've been at the MacBook a while: on her Mac you count as away (level 2, Low Power to the page), and her window,
  // which she left when she followed you here, is unseen. Her microphone's own say stays hers.
  const hers = { awake: true, paused: false, power: { level: 2, powerLevel: 0, away: 2, visible: false, fps: 0, optional: false, handsFree: true, label: 'Away · background paused' } };
  let seen = true, power: PowerPolicyInput = {};
  const delivered: Array<[string, any]> = [];
  const client = link({ answer: ({ body }) => ({ result: (body as any).channel === 'state' ? { settings: {}, awareness: hers } : null }) });
  const window = new FaceWindow({ client, confirm: async () => {}, approveKey: () => 'k', deliver: (channel, value) => delivered.push([channel, value]), seen: () => seen, power: () => power });
  const state = await window.call('state') as { awareness: { power: Record<string, any> } };
  assert.equal(state.awareness.power.visible, true, 'the state says this window is seen');
  assert.equal(state.awareness.power.optional, true, 'and not Low Power: you are here');
  assert.equal(state.awareness.power.fps, 30);
  assert.equal(state.awareness.power.away, 0);
  assert.equal(state.awareness.power.handsFree, true, 'what isn’t about drawing stays hers');
  window.events({ seq: 1, events: [['awareness', hers], ['reply', { text: 'hi' }]] });
  assert.deepEqual(delivered.map(([channel]) => channel), ['awareness', 'reply']);
  assert.deepEqual([delivered[0][1].power.visible, delivered[0][1].power.optional, delivered[0][1].power.fps], [true, true, 30]);
  assert.equal(hers.power.visible, false, 'her own state is left as it was');
  // This window minimized or covered: its page hears it at once, with her latest awareness.
  seen = false; window.seenChanged();
  assert.deepEqual([delivered.at(-1)![0], delivered.at(-1)![1].power.visible, delivered.at(-1)![1].power.fps], ['awareness', false, 0]);
  seen = true; window.seenChanged();
  assert.equal(delivered.at(-1)![1].power.visible, true);
  // This Mac on battery, or hot: its own policy, as Fairy would have it there.
  power = { onBattery: true }; window.seenChanged();
  assert.deepEqual([delivered.at(-1)![1].power.level, delivered.at(-1)![1].power.fps, delivered.at(-1)![1].power.optional], [1, 20, true]);
  power = { thermal: 'serious' };
  assert.equal((seenHere(hers, true, power) as any).power.optional, false, 'too warm here: the backgrounds hold still');
  assert.deepEqual(seenHere({ awake: true }, true), { awake: true });
  assert.equal(seenHere(null, true), null);
  const main = await read('../desktop/face-main.cts');
  assert.match(main, /seen: \(\) => Boolean\(fullWinSight\?\.visible\),/);
  assert.match(main, /power: \(\) => \{ const here[^=]* = \{\}; try \{ here\.onBattery = powerMonitor\.isOnBatteryPower\(\); \}/);
  assert.match(main, /fullWinSight = new WindowSight\(\{ window: fullWin, changed: \(\) => faceWindow\?\.seenChanged\(\) \}\);/);
  assert.match(main, /for \(const event of \['on-battery', 'on-ac', 'thermal-state-change', 'speed-limit-change'\](?:\s+as\s+const)?\)\s*\(?powerMonitor(?:\s+as\s+unknown\s+as\s+\{[^}]+\})?\)?\.on\(event, \(\) => faceWindow\?\.seenChanged\(\)\);/);
});
