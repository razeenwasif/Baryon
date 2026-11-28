// A pretend Mac for working on the iPhone app: the real phone link, with made-up work sessions and questions.
// Nothing here touches your real chats, and answers only change this script's own list.
// Run: node scripts/phone-link-demo.mjs (it needs Tailscale, and shows a pairing link)
import { execFile, execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import qrcode from 'qrcode-generator';
import { ArtifactStore } from '../desktop/artifacts.mjs';
import { LongTermMemory, type LastReflection, type ReflectionChange } from '../desktop/long-term-memory.mjs';
import { phoneChat, phoneOverview, type PhoneApprovalRequest, type PhoneHistoryMessage, type PhoneLiveSnapshot } from '../desktop/phone-access.mjs';
import { phoneAbout, phoneMemory, phonePageFile, phonePages, type ArtifactStoreLike, type PhoneMemoryInput, type PhonePageFileRequest } from '../desktop/phone-pages.mjs';
import { PhoneLink } from '../desktop/phone-link.mjs';
import { PhoneTurns, phoneChatList, type PhoneSessionSummary, type SendMessageOptions } from '../desktop/phone-turns.mjs';
import { ReplyVoice } from '../desktop/reply-voice.mjs';

interface DemoSession extends PhoneSessionSummary {
  updatedAt: string;
  work: string;
}

// Kept between runs, so a phone stays paired with the demo.
const dir = join(tmpdir(), 'fairy-demo');
await mkdir(dir, { recursive: true });
// Shaped like what desktop/sessions.mjs gives phoneOverview, and passed through the real phoneOverview and phoneChat,
// so the demo can't send the app anything Fairy itself wouldn't.
const sessions: DemoSession[] = [
  { id: 'compact', title: 'Add compaction to work sessions', updatedAt: '2026-11-03T02:00:00Z', work: 'Fairy' },
  { id: 'today', title: 'Add a Today panel', updatedAt: '2026-11-03T01:50:00Z', work: 'Fairy' },
  { id: 'monday', title: 'Fix the routine that skips Mondays', updatedAt: '2026-11-03T01:40:00Z', work: 'Fairy' },
  { id: 'tidy', title: 'Tidy the phone pairing words', updatedAt: '2026-11-03T00:20:00Z', work: 'Fairy' },
  { id: 'week', title: 'Plan my week', updatedAt: '2026-11-03T03:12:00Z', pinned: true, work: '' },
  { id: 'read', title: 'What I should read on decomposition', updatedAt: '2026-11-03T02:40:00Z', folder: 'study', work: '' },
];
const folders = [{ id: 'study', name: 'Study' }];
const histories: Record<string, PhoneHistoryMessage[]> = {
  week: [{ role: 'user', at: '2026-11-03T03:10:00Z', content: 'What should I do first this week?' }, { role: 'assistant', at: '2026-11-03T03:10:05Z', content: 'Start with the **write-up**. It’s the thing with a real deadline, and the rest can move.' }],
  read: [{ role: 'user', at: '2026-11-03T02:39:00Z', content: 'What should I read on decomposition?' }, { role: 'assistant', at: '2026-11-03T02:39:05Z', content: 'Start with the second chapter.' }],
};
const turns = new PhoneTurns({ list: () => sessions, read: async id => histories[id] ?? [],
  append: async (id, entries) => { histories[id] = [...(histories[id] ?? []), ...(entries as PhoneHistoryMessage[])]; const session = sessions.find(item => item.id === id); if (session) session.updatedAt = new Date().toISOString(); },
  addChat: async ({ title }) => { const id = `chat-${sessions.length}`; sessions.push({ id, title, updatedAt: new Date().toISOString(), work: '' }); return id; },
  // The Mac's built-in voice stands in for yours. A message mentioning silence shows what the phone does with no voice set up.
  makeVoice: ({ signal, emit }) => new ReplyVoice({ signal, emit, speak: async words => {
    if (/You said: .*silen/i.test(words)) throw new Error('Demo: no voice is set up.');
    const clip = join(dir, 'clip.aiff');
    execFileSync('/usr/bin/say', ['-o', clip, words]);
    const bytes = readFileSync(clip);
    rmSync(clip);
    return bytes;
  } }),
  reply: async ({ text, signal, onText }) => {
    if (/fail/i.test(text)) throw new Error('Demo: Fairy couldn’t reach its provider.');
    const words = `You said: ${text}. This is the demo Mac, writing one word at a time so you can watch it arrive, and stop it if you like.`.split(' ');
    let written = '';
    for (const word of words) { signal.throwIfAborted(); written += `${word} `; onText(written); await new Promise<void>(done => setTimeout(done, 350)); }
    return written.trim();
  },
  onEvent: event => console.log(event) });
const approvals: Record<string, PhoneApprovalRequest[]> = {
  compact: [
    { id: 'a1', kind: 'command', title: 'Run a command', command: 'npm test -- work-compact', note: 'It runs in the sandbox, which can only write in this folder.' },
    { id: 'a3', kind: 'edit', title: 'Edit a large file', command: 'x'.repeat(300 * 1024) },
    { id: 'a5', kind: 'edit', title: 'Change desktop/work-agent.mjs', detail: 'Edit: +1 −1', diff: { added: 1, removed: 1, rows: [{ type: '-', line: 4, text: 'const history = session.messages;' }, { type: '+', line: 4, text: 'const history = await compact(session);' }] } },
  ],
  today: [{ id: 'a2', kind: 'plan', title: 'Approve this plan?', plan: '1. Add a Today panel beside the chat, opened from a new icon on the right edge.\n2. Show the next event and unread count from your Calendar and Gmail connections.\n3. List running work sessions, with the same blue and amber dots as the sidebar.\n4. Test it with both connections off.' }],
  monday: [{ id: 'a4', kind: 'outside', title: 'Run this outside the sandbox?', command: 'launchctl list | grep fairy', note: 'This runs with your full access.' }],
};
const live: Record<string, Omit<PhoneLiveSnapshot, 'approvals'>> = {
  compact: { tasks: [{ text: 'Read how sessions are saved', status: 'done' }, { text: 'Write work-compact.mjs', status: 'done' }, { text: 'Hook it into the agent', status: 'done' }, { text: 'Run the tests', status: 'in_progress' }, { text: 'Write the summary', status: 'pending' }], rows: [{ id: 'r1', tool: 'edit', summary: 'desktop/work-agent.mjs', status: 'done', detail: '+1 −1' }, { id: 'r2', tool: 'run', summary: 'npm test', status: 'running' }], text: '' },
  today: { tasks: [], rows: [], text: '' },
  monday: { tasks: [{ text: 'Find why Mondays are skipped', status: 'done' }, { text: 'Fix the date check', status: 'in_progress' }, { text: 'Add a test', status: 'pending' }], rows: [{ id: 'r3', tool: 'read', summary: 'desktop/automation.mjs', status: 'done' }], text: '' },
};
const stateOf = (id: string): string => (approvals[id]?.length ? 'waiting' : live[id] ? 'working' : 'idle');
const snapshot = (id: string): PhoneLiveSnapshot | null => live[id] ? { ...live[id], approvals: approvals[id] ?? [] } : null;
const state = () => ({ sessions, folders, running: Object.fromEntries(sessions.filter(({ id }) => stateOf(id) !== 'idle').map(({ id }) => [id, stateOf(id)])) });
// Real stores, starting fresh each run, so the app gets what Fairy would send it.
const pageDir = join(dir, 'pages');
rmSync(pageDir, { recursive: true, force: true });
const artifacts = new ArtifactStore({ dir: pageDir, readJSON: async <T,>(_path: string, fallback: T): Promise<T> => fallback, writeJSON: async () => {}, trash: async () => {} });
const week = (wednesday: string, friday: string): string => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;background:#f4f5fa;color:#171a2b;font:14px -apple-system,sans-serif}h2{margin:0;font-size:26px}p{margin:2px 0 12px;font-size:13px;color:#4b4f66}div{display:grid;grid-template-columns:40px 1fr;gap:10px;padding:10px 0;border-top:1px solid #d6d8e6}</style></head><body><h2>This week</h2><p>2 to 6 November</p><div><b>Mon</b><span>Lab meeting, 10:00</span></div><div><b>Tue</b><span>Writing time, 1:00</span></div><div><b>Wed</b><span>${wednesday}</span></div><div><b>Thu</b><span>Supervisor, 2:00</span></div><div><b>Fri</b><span>${friday}</span></div></body></html>`;
// Every way out a page might try, each saying on the page whether it got through.
const lockedIn = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;background:#fff;color:#111;font:15px -apple-system,sans-serif}li{margin:6px 0}</style></head><body><h2>Ways out</h2><ul id="out"></ul><img id="pic" src="own.png" width="1" height="1"><script>
const say = (name, result) => { const line = document.createElement('li'); line.textContent = name + ': ' + result; document.getElementById('out').append(line); };
const attempt = async (name, work) => { try { say(name, await work()); } catch (error) { say(name, 'blocked'); } };
const REMOTE = 'https://example.com/';
attempt('fetch', () => fetch(REMOTE, { mode: 'no-cors' }).then(() => 'GOT OUT'));
attempt('image', () => new Promise((yes, no) => { const image = new Image(); image.onload = () => yes('GOT OUT'); image.onerror = no; image.src = 'https://www.apple.com/favicon.ico'; }));
attempt('script', () => new Promise((yes, no) => { const tag = document.createElement('script'); tag.onload = () => yes('GOT OUT'); tag.onerror = no; tag.src = 'https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js'; document.head.append(tag); }));
attempt('websocket', () => new Promise((yes, no) => { const socket = new WebSocket('wss://echo.websocket.org'); socket.onopen = () => yes('GOT OUT'); socket.onerror = no; }));
attempt('webrtc', async () => { if (!window.RTCPeerConnection) throw new Error('gone'); return 'GOT OUT'; });
attempt('another page', () => fetch('fairy-artifact://page/' + 'other/1/index.html').then(() => 'GOT OUT'));
attempt('own file', () => fetch('data.json').then(reply => reply.json()).then(value => value.ok ? 'reads its own file' : 'wrong'));
attempt('camera', () => navigator.mediaDevices.getUserMedia({ video: true }).then(() => 'GOT OUT'));
attempt('microphone', () => navigator.mediaDevices.getUserMedia({ audio: true }).then(() => 'GOT OUT'));
attempt('location', () => new Promise((yes, no) => navigator.geolocation.getCurrentPosition(() => yes('GOT OUT'), no)));
attempt('speech', async () => { new webkitSpeechRecognition().start(); return 'GOT OUT'; });
attempt('share sheet', () => navigator.share({ text: 'hello' }).then(() => 'GOT OUT'));
attempt('clipboard', () => navigator.clipboard.readText().then(() => 'GOT OUT'));
attempt('beacon', async () => { if (navigator.sendBeacon('https://example.com/')) return 'GOT OUT'; throw new Error('no'); });
attempt('calling the app', async () => { window.webkit.messageHandlers.fairy.postMessage('hi'); return 'GOT OUT'; });
attempt('saved data', async () => { localStorage.setItem('x', '1'); return 'kept only until this page closes'; });
setTimeout(() => { location.href = 'https://example.com/?left=1'; }, 1500);
setTimeout(() => say('leaving the page', 'blocked'), 2500);
</script></body></html>`;
await artifacts.publish({ title: 'Week at a glance', description: 'The week ahead.', html: week('Reading group, 3:00', 'Open after lunch'), session: 'week' });
await artifacts.publish({ id: artifacts.state().items[0].id, title: 'Week at a glance', html: week('Nothing booked', 'Reading group, 3:00') });
await artifacts.publish({ title: 'Ways out', description: 'Tests that a page stays locked in.', files: { 'index.html': lockedIn, 'data.json': '{"ok":true}' } });
await artifacts.publish({ title: 'Needs a chart library', files: { 'index.html': '<!doctype html><html><head><script src="https://cdn.jsdelivr.net/npm/chart.js"></script></head><body><p>A chart would be here.</p></body></html>' } });
await artifacts.publish({ kind: 'dashboard', title: 'Today dashboard', sources: ['calendar'], html: '<!doctype html><html><body>Reads your calendar.</body></html>' });
const memory = new LongTermMemory({ read: async () => null, write: async () => {} });
await memory.add('you', 'Prefers the short answer first, then the detail.');
await memory.add('projects', 'Adding compaction to work sessions.');
await memory.add('self', 'Said it would bring up the reading group on Friday.');
memory.items[0].source = 'reflection';
memory.used = [memory.items[1].id];
memory.lastReflection = { at: new Date().toISOString(), changes: [{ action: 'added', text: 'Prefers the short answer first, then the detail.' } as unknown as ReflectionChange] } as LastReflection;
const link = new PhoneLink({ path: join(dir, 'phone-link.json'), port: 47618,
  overview: () => phoneOverview(state(), snapshot),
  chats: () => phoneChatList(state(), turns.running()),
  send: message => turns.send(message as unknown as SendMessageOptions),
  stopTurn: id => turns.stop(id as string),
  voicePart: (id, index) => turns.voicePart(id as string, index),
  pages: () => phonePages(artifacts.state()),
  pageFile: async request => await phonePageFile(artifacts as unknown as ArtifactStoreLike, request as unknown as PhonePageFileRequest) as { status: number; headers: Record<string, string | number | string[]>; body: Buffer | string },
  memory: () => phoneMemory(memory.state() as unknown as PhoneMemoryInput, 'on'),
  about: () => phoneAbout({ pages: artifacts.state(), memory: memory.state(), schedules: [{ enabled: true }, { enabled: true }, { enabled: false }], workProvider: 'claude' }),
  chat: async id => {
    const session = sessions.find(item => item.id === id);
    if (!session || id === null) throw Object.assign(new Error('That chat is no longer here.'), { status: 404 });
    if (!session.work) { const now = turns.live(id); return { ...phoneChat(session, histories[id] ?? [], now ? { rows: [], tasks: [], text: now.text } : null, now ? 'working' : 'idle', 60), failure: turns.failed(id), voice: turns.voice(id) }; }
    return phoneChat(session, [{ role: 'user', at: '2026-11-03T02:00:00Z', content: 'Please do this next.' }, { role: 'assistant', at: '2026-11-03T02:00:05Z', content: 'On it. I’ll ask before I change anything.' }], snapshot(id), stateOf(id));
  },
  answer: (id, decision) => { console.log(`Answered ${id}: ${decision}`); for (const key of Object.keys(approvals)) approvals[key] = approvals[key].filter(item => item.id !== id); },
  onEvent: event => console.log(event),
});
// To try alerts: kill -USR2 <this process> asks a new question in the first session.
process.on('SIGUSR2', () => {
  const id = `new-${Date.now()}`;
  (approvals.compact ??= []).push({ id, kind: 'command', title: 'Run a command', command: 'npm test', note: 'It runs in the sandbox.' });
  console.log(`Asked ${id}`);
});
await link.start();
await link.setEnabled(true);
if (!link.server) { console.error(link.problem || 'Tailscale isn’t running on this Mac.'); process.exit(1); }
const { url } = link.pair(), code = qrcode(0, 'L');
code.addData(url, 'Byte');
code.make();
// A picture, as the gaps between a terminal's lines can stop a dense code being read.
function qrPicture(path: string): void {
  const count = code.getModuleCount(), cell = 14, edge = 4, side = (count + edge * 2) * cell, raw = Buffer.alloc((side + 1) * side, 255);
  for (let y = 0; y < side; y++) {
    raw[y * (side + 1)] = 0;
    for (let x = 0; x < side; x++) {
      const row = Math.floor(y / cell) - edge, column = Math.floor(x / cell) - edge;
      if (row >= 0 && column >= 0 && row < count && column < count && code.isDark(row, column)) raw[y * (side + 1) + 1 + x] = 0;
    }
  }
  const crcs = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (bytes: Uint8Array): number => { let x = -1; for (const v of bytes) x = crcs[(x ^ v) & 255] ^ (x >>> 8); return (x ^ -1) >>> 0; };
  const chunk = (type: string, data: Uint8Array): Buffer => { const length = Buffer.alloc(4), sum = Buffer.alloc(4), body = Buffer.concat([Buffer.from(type), data]); length.writeUInt32BE(data.length); sum.writeUInt32BE(crc(body)); return Buffer.concat([length, body, sum]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(side, 0); header.writeUInt32BE(side, 4); header[8] = 8;
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
const picture = join(dir, 'pair.png');
qrPicture(picture);
if (!process.argv.includes('--no-picture')) execFile('/usr/bin/open', [picture]);
console.log(`The code is at ${picture}. Scan it in the Fairy app.\n\n${url}\n\nPress Ctrl-C to stop.`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, async () => { await link.stop(); process.exit(0); });
