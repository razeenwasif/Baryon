// After Away: AudioPulse on a face's Mac reaches the full Fairy on the other Mac through the face's own socket.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import net, { type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FaceApps, cleanContext, type CleanContext, type FaceAppEntry } from '../desktop/face-apps.mjs';
import { FaceClient } from '../desktop/face-client.mjs';
import { FaceLink } from '../desktop/face-link.mjs';
import { FaceStore } from '../desktop/face-store.mjs';
import { FACE_SOCKETS, FLUX_STEPS, GRAVITON_STEPS, fromElectron, socketFolder, startFaceSockets, type StartFaceSocketsOptions, type StepBridgeLike } from '../desktop/face-sockets.mjs';
import { forElectron, workRequest, type WorkEventInput, type WorkRequest, type WorkRequestInput } from '../desktop/electron-link.mjs';
import { PhoneLink, makeCertificate, type PhoneCertificate, type PhoneFaceLink } from '../desktop/phone-link.mjs';

const NAME = 'mini.example.ts.net';
let shared: PhoneCertificate | undefined;
const certificate = async (options: { name: string; address: string; now?: () => number }): Promise<PhoneCertificate> => { shared ??= await makeCertificate(options); return shared; };
const seal = (text: string): string => `sealed:${Buffer.from(text).toString('hex')}`, unseal = (text: string): string => Buffer.from(text.slice(7), 'hex').toString();
const until = async (check: () => boolean, ms = 4000): Promise<void> => { const end = Date.now() + ms; while (!check()) { if (Date.now() > end) throw new Error('timed out waiting'); await new Promise(resolve => setTimeout(resolve, 10)); } };

type JsonRecord = Record<string, any>;

// One line of JSON each way, as AudioPulse speaks it; resolves the replies once `count` have come.
function talk(path: string, messages: unknown[], count: number): Promise<JsonRecord[]> {
  return new Promise((resolve, reject) => {
    const replies: JsonRecord[] = [];
    let buffer = '';
    const conn = net.createConnection(path, () => { for (const message of messages) conn.write(`${JSON.stringify(message)}\n`); });
    conn.setEncoding('utf8');
    conn.on('data', chunk => {
      buffer += chunk;
      let at: number;
      while ((at = buffer.indexOf('\n')) >= 0) { replies.push(JSON.parse(buffer.slice(0, at)) as JsonRecord); buffer = buffer.slice(at + 1); }
      if (replies.length >= count) { conn.end(); resolve(replies); }
    });
    conn.on('error', reject);
  });
}

// A full Fairy whose AudioPulse answer is `assist` and whose other apps' chats are `apps`, and a face paired with it,
// its sockets in a folder not yet made.
async function setup(
  assist: (request: { instructions: unknown; prompt: unknown }) => Promise<string> = async () => '',
  apps: Record<string, FaceAppEntry> = {},
  faceOptions: Partial<StartFaceSocketsOptions> = {},
  { pingMs, workSilentMs }: { pingMs?: number; workSilentMs?: number } = {},
) {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-face-sockets-'));
  const face = new FaceLink({ ask: async () => ({ text: '' }), name: () => 'Fairy', apps: new FaceApps({ apps, ...(pingMs !== undefined ? { pingMs } : {}) }) });
  const link = new PhoneLink({ path: join(dir, 'phone-link.json'), port: 0, every: 1e7, certificate, accepts: () => true, address: () => '127.0.0.1', name: async () => NAME, reach: async () => 'open',
    overview: () => ({ chats: [], approvals: [] }), chat: async id => ({ id }), answer: () => {}, assist, face: face as unknown as PhoneFaceLink });
  await link.start(); await link.setEnabled(true);
  const store = new FaceStore({ path: join(dir, 'face', 'face.json'), seal, unseal });
  await store.load();
  const client = new FaceClient({ store, name: 'MacBook', resolve: () => '127.0.0.1', ...(workSilentMs !== undefined ? { workSilentMs } : {}) });
  await client.pair(link.pair({ kind: 'mac' }).url);
  await until(() => client.state() === 'connected');
  const folder = join(dir, 'lyra'), sockets = await startFaceSockets({ folder, client, name: () => 'Fairy', ...faceOptions });
  return { dir, folder, link, client, sockets, done: async () => { sockets.close(); client.stop(); await link.stop(); await rm(dir, { recursive: true, force: true }); } };
}

test('the face’s socket folder is where the apps look, or the test copy’s own', () => {
  assert.equal(socketFolder({ userData: '/u/lyra-companion', env: {} }), join('/u/lyra-companion', 'lyra'));
  assert.equal(socketFolder({ userData: '/u', env: { LYRA_DATA_DIR: '/old' } }), '/old');
  assert.equal(socketFolder({ userData: '/u', env: { FAIRY_DATA_DIR: '/test', LYRA_DATA_DIR: '/old' } }), '/test');
});

test('AudioPulse on the face’s Mac is answered by the other Mac’s Fairy', async () => {
  const asked: Array<{ instructions: unknown; prompt: unknown }> = [];
  const s = await setup(async request => { asked.push(request); return '{"action":"play"}'; });
  try {
    const path = join(s.folder, FACE_SOCKETS.audiopulse);
    const [hello, done] = await talk(path, [{ type: 'hello' }, { type: 'ask', id: 'a1', instructions: 'Reply with JSON.', prompt: 'something calm' }], 2);
    assert.deepEqual(hello, { type: 'hello', name: 'Fairy', provider: '' });
    assert.deepEqual(done, { type: 'done', id: 'a1', text: '{"action":"play"}' });
    // The other Mac got AudioPulse's words, checked by its own rules.
    assert.deepEqual(asked, [{ instructions: 'Reply with JSON.', prompt: 'something calm' }]);
    // The folder is private, and holds the face's socket and nothing else.
    assert.equal((await stat(s.folder)).mode & 0o777, 0o700);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.deepEqual((await readdir(s.folder)).sort(), Object.values(FACE_SOCKETS).sort());
  } finally { await s.done(); }
});

test('the other Mac’s refusal reaches AudioPulse as its error, and closing leaves no socket behind', async () => {
  const s = await setup(async () => { throw Object.assign(new Error('AudioPulse needs a subscription provider.'), { status: 503 }); });
  try {
    const path = join(s.folder, FACE_SOCKETS.audiopulse);
    const [reply] = await talk(path, [{ type: 'ask', id: 'b', instructions: 'i', prompt: 'p' }], 1);
    assert.deepEqual(reply, { type: 'error', id: 'b', message: 'AudioPulse needs a subscription provider.' });
    s.sockets.close();
    assert.deepEqual(await readdir(s.folder), []);
  } finally { await s.done(); }
});

test('unpaired, AudioPulse hears why rather than waiting', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-face-sockets-'));
  const store = new FaceStore({ path: join(dir, 'face', 'face.json'), seal, unseal });
  await store.load();
  const sockets = await startFaceSockets({ folder: join(dir, 'lyra'), client: new FaceClient({ store }) });
  try {
    const [reply] = await talk(join(dir, 'lyra', FACE_SOCKETS.audiopulse), [{ type: 'ask', id: 'c', instructions: 'i', prompt: 'p' }], 1);
    assert.equal(reply.type, 'error');
    assert.match(reply.message, /Not paired/);
  } finally { sockets.close(); await rm(dir, { recursive: true, force: true }); }
});

test('the face reads and writes no file in the data folder, and listens only on its own sockets', async () => {
  const source = await readFile(new URL('../desktop/face-sockets.mts', import.meta.url), 'utf8');
  assert.ok(!/readFile|writeFile|appendFile|createWriteStream|createReadStream|\brm\(|unlink|copyFile|rename/.test(source), 'no file reads or writes of its own');
  assert.ok(!/createServer|\.listen\(|https?:/.test(source), 'no server of its own: the links listen on their socket paths');
  assert.deepEqual(Object.values(FACE_SOCKETS), ['audiopulse.sock', 'tachyon.sock', 'electron.sock', 'flux.sock', 'graviton.sock', 'cli.sock', 'vorssaint.sock']);
  const main = await readFile(new URL('../desktop/face-main.cts', import.meta.url), 'utf8');
  assert.match(main, /startFaceSockets\(\{ folder: socketFolder\(\{ userData: app\.getPath\('userData'\) \}\), client,/);
  assert.match(main, /app\.on\('will-quit', \(\) => sockets\?\.close\(\)\)/);
});

test('CLI on the face’s Mac forwards RPC and work over cli.sock to Body', async () => {
  const cliEntry: FaceAppEntry = {
    rpc: async (method, params) => ({ echoed: method, params }),
    work: async (asked, emit) => {
      setTimeout(() => {
        emit({ type: 'step', row: { id: 's1', tool: 'read', summary: 'README.md', status: 'done' } });
        emit({ type: 'done', text: `Face work done in ${asked.folder}`, failed: false });
      }, 15);
      return { chat: 'cli-face-1' };
    },
    stop: async () => {},
    ask: async ({ text }) => ({ text: `CLI answer: ${text}` }),
    reset: () => {},
  };
  const s = await setup(undefined, { cli: cliEntry });
  try {
    const cliSock = join(s.folder, FACE_SOCKETS.cli);
    const [hello, rpcRes] = await talk(cliSock, [
      { type: 'hello' },
      { type: 'rpc', id: 'r1', method: 'models.list', params: { ok: true } },
    ], 2);
    assert.equal(hello.type, 'hello');
    assert.equal(hello.remote, true);
    assert.equal(hello.mode, 'face');
    assert.deepEqual(rpcRes, { type: 'result', id: 'r1', data: { echoed: 'models.list', params: { ok: true } } });

    const workReplies = await electron(cliSock, [{ type: 'work', id: 'w-cli', folder: '/repo', prompt: 'check' }], got => got.some(m => m.type === 'done'));
    assert.equal(workReplies[0].chat, 'cli-face-1');
    assert.equal(workReplies.at(-1)!.text, 'Face work done in /repo');
  } finally { await s.done(); }
});

interface TerminalMock {
  asked: Array<{ text: string; context: CleanContext }>;
  resets: number;
  stops: number;
  release: (() => void) | null;
  entry: FaceAppEntry;
}

// A Terminal chat on the full Fairy that answers in two steps, or waits until stopped.
function terminal({ wait = false }: { wait?: boolean } = {}): TerminalMock {
  const chat: TerminalMock = {
    asked: [],
    resets: 0,
    stops: 0,
    release: null,
    entry: {
      ask: async ({ text, context, onText }) => {
        chat.asked.push({ text, context });
        if (wait) { await new Promise<void>(resolve => { chat.release = resolve; }); throw Object.assign(new Error('aborted'), { name: 'AbortError' }); }
        onText('Make'); onText('Make failed');
        return { text: `Make failed: exit ${context.exit}` };
      },
      stop: () => { chat.stops += 1; chat.release?.(); },
      reset: async () => { chat.resets += 1; },
    },
  };
  return chat;
}

test('Tachyon on the face’s Mac asks into the other Mac’s Terminal chat, sees the answer grow, and can start afresh', async () => {
  const chat = terminal(), s = await setup(undefined, { tachyon: chat.entry });
  try {
    const path = join(s.folder, FACE_SOCKETS.tachyon);
    const replies = await talk(path, [{ type: 'hello' }, { type: 'ask', text: 'why?', context: { command: 'make', exit: 2, screen: '$ make\nerror', sneaky: { a: 1 } } }], 4);
    assert.deepEqual(replies, [{ type: 'hello', name: 'Fairy' }, { type: 'text', text: 'Make' }, { type: 'text', text: 'Make failed' }, { type: 'done', text: 'Make failed: exit 2' }]);
    // Only the app's own words and context fields went over; the prompt is built on the other Mac.
    assert.deepEqual(chat.asked, [{ text: 'why?', context: { command: 'make', screen: '$ make\nerror', exit: 2 } }]);
    assert.deepEqual(await talk(path, [{ type: 'new' }], 1), [{ type: 'ok' }]);
    assert.equal(chat.resets, 1);
  } finally { await s.done(); }
});

test('stopping Tachyon on the face’s Mac stops the answer on the other Mac', async () => {
  const chat = terminal({ wait: true }), s = await setup(undefined, { tachyon: chat.entry });
  try {
    const path = join(s.folder, FACE_SOCKETS.tachyon);
    const replies = await new Promise<JsonRecord[]>((resolve, reject) => {
      const got: JsonRecord[] = [];
      const conn = net.createConnection(path, () => conn.write(`${JSON.stringify({ type: 'ask', text: 'go', context: {} })}\n`));
      conn.setEncoding('utf8');
      conn.on('data', (chunk: string | Buffer) => { for (const line of String(chunk).split('\n').filter(Boolean)) got.push(JSON.parse(line) as JsonRecord); if (got.length) { conn.end(); resolve(got); } });
      conn.on('error', reject);
      until(() => chat.asked.length === 1).then(() => conn.write(`${JSON.stringify({ type: 'stop' })}\n`), reject);
    });
    assert.deepEqual(replies, [{ type: 'error', message: 'Stopped.' }]);
    await until(() => chat.stops === 1);
  } finally { await s.done(); }
});

test('an app the other Mac doesn’t answer for, and context it doesn’t know, go no further', async () => {
  assert.deepEqual(cleanContext({ cwd: '/p', exit: 1.5, screen: 7, url: 'https://x', other: 'no' }), { cwd: '/p', url: 'https://x' });
  assert.deepEqual(cleanContext(['a']), {});
  const s = await setup();
  try {
    await assert.rejects(s.client.appAsk('tachyon', { text: 'hi', context: {} }), /isn’t answered here/);
    await assert.rejects(s.client.appNew('flux'), /isn’t answered here/);
  } finally { await s.done(); }
});

test('the full Fairy answers a face’s Tachyon in its Terminal chat, by Tachyon’s own prompt', async () => {
  const main = await readFile(new URL('../build-ts/desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /faceAppChats\.tachyon = \{ ask: \(\{ text, context, onText \}\) => terminalChat\.send\(terminalPrompt\(text, context\), \{ onText, record: terminalRecord\(text\) \}\)/);
  assert.match(main, /apps: new FaceApps\(\{ apps: faceAppChats \}\)/);
});

interface VaultWorkMock {
  started: WorkRequest[];
  stopped: Array<string | undefined>;
  emit: ((event: Record<string, unknown> | null) => void) | null;
  entry: FaceAppEntry;
}

// Electron's work on the full Fairy: checked by electron-link's own rules, then events as a work session sends them.
function vaultWork({ refuse = null }: { refuse?: string | null } = {}): VaultWorkMock {
  const work: VaultWorkMock = {
    started: [],
    stopped: [],
    emit: null,
    entry: {
      ask: async () => ({ text: '' }),
      reset: () => {},
      work: async (asked, emit) => {
        const request = workRequest(asked as WorkRequestInput);
        if (refuse) throw new Error(refuse);
        work.started.push(request); work.emit = emit as (event: Record<string, unknown> | null) => void;
        // One event comes before the work says it started; it must still follow 'started'.
        emit(forElectron({ type: 'text', text: 'Reading the vault' })!);
        return { chat: 'c1' };
      },
      stop: chat => { work.stopped.push(chat); },
    },
  };
  return work;
}
type ElectronReplies = JsonRecord[] & { dropped?: boolean };
// Electron's side: send `messages`, collect replies; `step(replies, conn)` may send more, and says when it's enough.
function electron(path: string, messages: unknown[], step: (replies: ElectronReplies, conn: Socket) => boolean): Promise<ElectronReplies> {
  return new Promise((resolve, reject) => {
    const got: ElectronReplies = [];
    let buffer = '';
    const conn = net.createConnection(path, () => { for (const message of messages) conn.write(`${JSON.stringify(message)}\n`); });
    conn.setEncoding('utf8');
    conn.on('data', chunk => {
      buffer += chunk;
      let at: number;
      while ((at = buffer.indexOf('\n')) >= 0) { got.push(JSON.parse(buffer.slice(0, at)) as JsonRecord); buffer = buffer.slice(at + 1); }
      if (step(got, conn)) { conn.end(); resolve(got); }
    });
    conn.on('error', reject);
  });
}

test('Electron on the face’s Mac starts work in the vault on the other Mac and follows it to the end', async () => {
  const work = vaultWork(), s = await setup(undefined, { electron: work.entry });
  try {
    const path = join(s.folder, FACE_SOCKETS.electron);
    let sent = false;
    const replies = await electron(path, [{ type: 'hello' }, { type: 'work', id: 'w1', folder: '/vault', prompt: 'link these notes', context: 'Vault rules', mode: 'read' }], (got, _conn) => {
      if (!sent && got.some(item => item.type === 'started')) {
        sent = true;
        work.emit!(forElectron({ type: 'tool', row: { id: 'r1', tool: 'read', summary: 'Read note.md', status: 'done', secret: 'x' } as WorkEventInput['row'] }));
        work.emit!(forElectron({ type: 'approval', id: 'q1', title: 'Edit note.md', command: 'write note.md' }));
        work.emit!(forElectron({ type: 'approval-closed', id: 'q1' }));
        work.emit!(forElectron({ type: 'done', text: 'Linked 3 notes.' }));
      }
      return got.some(item => item.type === 'done');
    });
    assert.deepEqual(replies, [
      { type: 'hello', name: 'Fairy', provider: '', remote: true, link: 'connected' },
      { type: 'started', id: 'w1', chat: 'c1' },
      { type: 'text', id: 'w1', text: 'Reading the vault' },
      { type: 'step', id: 'w1', row: { id: 'r1', tool: 'read', summary: 'Read note.md', status: 'done' } },
      { type: 'approval', id: 'w1', approval: 'q1', title: 'Edit note.md', detail: 'write note.md' },
      { type: 'approval-closed', id: 'w1', approval: 'q1' },
      { type: 'done', id: 'w1', text: 'Linked 3 notes.', failed: false },
    ]);
    // The other Mac checked it by Electron's own rules: read mode is plan mode there.
    assert.deepEqual(work.started, [{ prompt: 'link these notes', context: 'Vault rules', folder: '/vault', chat: null, permission: 'plan' }]);
  } finally { await s.done(); }
});

test('Electron’s stop on the face’s Mac stops the work there, and a refusal there is Electron’s error', async () => {
  const work = vaultWork(), s = await setup(undefined, { electron: work.entry });
  try {
    const path = join(s.folder, FACE_SOCKETS.electron);
    await electron(path, [{ type: 'work', id: 'w2', folder: '/vault', prompt: 'go' }], (got, conn) => {
      const started = got.some(item => item.type === 'started');
      if (started) conn.write(`${JSON.stringify({ type: 'stop', id: 'w2' })}\n`);
      return started;
    });
    await until(() => work.stopped.length === 1);
    assert.deepEqual(work.stopped, ['c1']);
  } finally { await s.done(); }
  const refused = vaultWork({ refuse: 'Your vault isn’t at /vault on the Mac Fairy runs on.' }), r = await setup(undefined, { electron: refused.entry });
  try {
    const replies = await electron(join(r.folder, FACE_SOCKETS.electron), [{ type: 'work', id: 'w3', folder: '/vault', prompt: 'go' }], got => got.length >= 1);
    assert.deepEqual(replies, [{ type: 'error', id: 'w3', message: 'Your vault isn’t at /vault on the Mac Fairy runs on.' }]);
    const bad = await electron(join(r.folder, FACE_SOCKETS.electron), [{ type: 'work', id: 'w4', folder: 'vault', prompt: 'go' }], got => got.length >= 1);
    assert.equal(bad[0].type, 'error');
  } finally { await r.done(); }
});

test('if the link drops mid-work, Electron hears that it carries on on the other Mac', async () => {
  const work = vaultWork(), s = await setup(undefined, { electron: work.entry });
  try {
    const replies = await electron(join(s.folder, FACE_SOCKETS.electron), [{ type: 'work', id: 'w5', folder: '/vault', prompt: 'go' }], (got) => {
      if (got.length === 2 && !got.dropped) { got.dropped = true; void s.link.stop(); }
      return got.some(item => item.type === 'done');
    });
    assert.deepEqual(replies.at(-1), { type: 'done', id: 'w5', text: 'Lost the link to your other Mac. The work carries on there, in Fairy’s sidebar.', failed: true });
  } finally { await s.done(); }
});

test('Electron’s events cross unchanged, and the full Fairy checks a face’s Electron as its own', async () => {
  for (const event of [{ type: 'tool', row: { id: 'a', tool: 'edit', summary: 's', status: 'running' } }, { type: 'tasks', tasks: [{ title: 't' }] }, { type: 'thinking' }, { type: 'text', text: 'x' },
    { type: 'approval', id: 'q', title: 'T', command: 'c' }, { type: 'approval-closed', id: 'q' }, { type: 'done', text: 'd', failed: true }] as WorkEventInput[]) {
    const sent = forElectron(event);
    assert.deepEqual(forElectron(fromElectron(sent)), sent, event.type);
  }
  assert.equal(fromElectron({ type: 'started' }), null);
  const main = await readFile(new URL('../build-ts/desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /faceAppChats\.electron = \{\s+work: async \(asked, emit\) => \{\s+const request = workRequest\(asked\);/);
  assert.match(main, /return startLinkedWork\(request, \(?event\)? => \{ const out = forElectron\(event\); if \(out\)\s*emit\(out\); \}\);/);
});

interface BrowserChatMock {
  asked: Array<{ text: string; context: CleanContext; tools: boolean }>;
  stops: number;
  said: string[];
  results: Array<{ result: unknown } | { error: string }>;
  release: (() => void) | null;
  entry: FaceAppEntry;
}

// Flux's Browser chat on the full Fairy: it may take steps in Flux through `tools`, and says its answer in two clips.
function browserChat({ steps = [], wait = false }: { steps?: Array<[string, Record<string, unknown>]>; wait?: boolean } = {}): BrowserChatMock {
  const chat: BrowserChatMock = {
    asked: [],
    stops: 0,
    said: [],
    results: [],
    release: null,
    entry: {
      ask: async ({ text, context, onText, tools }) => {
        chat.asked.push({ text, context, tools: Boolean(tools) });
        for (const [step, args] of steps) chat.results.push(await tools!.call(step, args).then(result => ({ result }), (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) })));
        if (wait) { await new Promise<void>(resolve => { chat.release = resolve; }); throw Object.assign(new Error('aborted'), { name: 'AbortError' }); }
        onText('Found');
        return { text: 'Found 2 links.' };
      },
      stop: () => { chat.stops += 1; chat.release?.(); },
      reset: async () => {},
      say: async (text, { part }) => { chat.said.push(text); part({ bytes: Buffer.from('clip one'), pauseBeforeMs: 0 }); part({ bytes: Buffer.from('clip two'), pauseBeforeMs: 160 }); },
    },
  };
  return chat;
}
// Flux's tool socket, as the face reaches it: what each step was, and Flux's answer.
function fluxTools(answers: Record<string, unknown>) {
  const calls: Array<{ tools: { socket: string; token: string }; step: string; args: Record<string, unknown> | undefined }> = [];
  return {
    calls,
    make: (tools: { socket: string; token: string }): StepBridgeLike => ({
      call: async (step, args) => {
        calls.push({ tools, step, args });
        const answer = answers[step];
        if (answer instanceof Error) throw answer;
        return answer;
      },
    }),
  };
}
const player = (muted = false) => {
  const voice: {
    clips: Array<{ turn: string; part: number; bytes: string; pauseBeforeMs: number }>;
    hushes: number;
    play: (clip: { turn: string; part: number; bytes: Buffer; pauseBeforeMs: number }) => void;
    hush: () => void;
    muted: () => boolean;
  } = {
    clips: [],
    hushes: 0,
    play: clip => { voice.clips.push({ ...clip, bytes: Buffer.from(clip.bytes).toString() }); },
    hush: () => { voice.hushes += 1; },
    muted: () => muted,
  };
  return voice;
};

test('Flux on the face’s Mac asks into the other Mac’s Browser chat, and her steps in Flux come back to Flux here', async () => {
  const chat = browserChat({ steps: [['read', { tab: 3 }], ['click', { ref: '3:e1', reason: 'open it' }], ['run_shell', {}]] });
  const tools = fluxTools({ read: { tree: 'link: Docs [3:e1]' }, click: new Error('Flux refused: that control deletes.') });
  const s = await setup(undefined, { flux: chat.entry }, { fluxBrowser: tools.make });
  try {
    const replies = await talk(join(s.folder, FACE_SOCKETS.flux), [{ type: 'ask', text: 'links?', context: { title: 'Docs', url: 'https://x.dev/a', text: 'Body', other: 1 }, tools: { socket: '/f/fairy-tools.sock', token: 'tok' } }], 2);
    assert.deepEqual(replies, [{ type: 'text', text: 'Found' }, { type: 'done', text: 'Found 2 links.' }]);
    // Only Flux's words and page fields crossed, and the other Mac knew it could use Flux's tools.
    assert.deepEqual(chat.asked, [{ text: 'links?', context: { url: 'https://x.dev/a', title: 'Docs', text: 'Body' }, tools: true }]);
    // Each step reached Flux's tool socket here with Flux's own key; Flux's refusal went back as an error; a step Flux
    // doesn't have never reached it.
    assert.deepEqual(tools.calls.map(call => [call.tools.socket, call.tools.token, call.step, call.args]), [['/f/fairy-tools.sock', 'tok', 'read', { tab: 3 }], ['/f/fairy-tools.sock', 'tok', 'click', { ref: '3:e1', reason: 'open it' }]]);
    assert.deepEqual(chat.results, [{ result: { tree: 'link: Docs [3:e1]' } }, { error: 'Flux refused: that control deletes.' }, { error: 'Flux didn’t give that step.' }]);
    assert.deepEqual(FLUX_STEPS, ['tabs', 'read', 'open', 'click', 'type']);
  } finally { await s.done(); }
});

test('Flux’s answer is said in her voice on the face’s Mac, made on the other, and Flux hears when it’s all come', async () => {
  const chat = browserChat(), voice = player();
  const s = await setup(undefined, { flux: chat.entry }, { voice });
  try {
    const replies = await talk(join(s.folder, FACE_SOCKETS.flux), [{ type: 'ask', text: 'hi', context: {}, speak: true }], 3);
    assert.deepEqual(replies.map(item => item.type), ['text', 'done', 'spoken']);
    assert.deepEqual(chat.said, ['Found 2 links.']);
    assert.deepEqual(voice.clips.map(clip => [clip.part, clip.bytes, clip.pauseBeforeMs]), [[0, 'clip one', 0], [1, 'clip two', 160]]);
    assert.ok(voice.clips.every(clip => clip.turn === voice.clips[0].turn && clip.turn.startsWith('flux-')));
  } finally { await s.done(); }
});

test('muted, the face asks for no voice and Flux hears at once that she’s done', async () => {
  const chat = browserChat(), voice = player(true);
  const s = await setup(undefined, { flux: chat.entry }, { voice });
  try {
    const replies = await talk(join(s.folder, FACE_SOCKETS.flux), [{ type: 'ask', text: 'hi', context: {}, speak: true }], 3);
    assert.deepEqual(replies.map(item => item.type), ['text', 'done', 'spoken']);
    assert.deepEqual(chat.said, []);
    assert.deepEqual(voice.clips, []);
  } finally { await s.done(); }
});

test('Stop in Flux on the face’s Mac stops her on the other Mac and quiets her voice here', async () => {
  const chat = browserChat({ wait: true }), voice = player();
  const s = await setup(undefined, { flux: chat.entry }, { voice });
  try {
    const path = join(s.folder, FACE_SOCKETS.flux);
    const replies = await new Promise<JsonRecord[]>((resolve, reject) => {
      const got: JsonRecord[] = [];
      const conn = net.createConnection(path, () => conn.write(`${JSON.stringify({ type: 'ask', text: 'go', context: {} })}\n`));
      conn.setEncoding('utf8');
      conn.on('data', (chunk: string | Buffer) => { for (const line of String(chunk).split('\n').filter(Boolean)) got.push(JSON.parse(line) as JsonRecord); if (got.length) { conn.end(); resolve(got); } });
      conn.on('error', reject);
      until(() => chat.asked.length === 1).then(() => conn.write(`${JSON.stringify({ type: 'stop' })}\n`), reject);
    });
    assert.deepEqual(replies, [{ type: 'error', message: 'Stopped.' }]);
    await until(() => chat.stops === 1);
    assert.equal(voice.hushes, 1);
  } finally { await s.done(); }
});

test('the full Fairy answers a face’s Flux in its Browser chat, by Flux’s own prompt and tools task', async () => {
  const main = await readFile(new URL('../build-ts/desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /ask: \(\{ text, context, onText, tools \}\) => browserChat\.send\(pagePrompt\(text, context\), \{ onText, record: pageRecord\(text, context\), run: tools \? \(?args\)? => fluxTask\(\{ \.\.\.args, browser: tools \}\) : undefined \}\)/);
  assert.match(main, /say: \(text, \{ signal, part \}\) => replyVoice\(\{ signal, emit: part \}\)\.finish\(text\)/);
  assert.match(main, /runTools: async \(\{ tools, model, effort, \.\.\.args \}\) => fluxTask\(\{ \.\.\.args, model, effort, browser: new \(await import\('\.\/flux-tools\.mjs'\)\)\.FluxBrowser\(tools\) \}\)/);
  const face = await readFile(new URL('../desktop/face-main.cts', import.meta.url), 'utf8');
  assert.match(face, /voice: \{ play: clip => send\('fairy:face-voice', clip\), hush, muted: \(\) => store!\.state\(\)\.muted \}/);
});

test('Electron’s hello reports when the face isn’t paired', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-face-unpaired-'));
  const store = new FaceStore({ path: join(dir, 'face', 'face.json'), seal, unseal });
  await store.load();
  const sockets = await startFaceSockets({ folder: join(dir, 'lyra'), client: new FaceClient({ store }) });
  try {
    const [hello] = await electron(join(dir, 'lyra', FACE_SOCKETS.electron), [{ type: 'hello' }], got => got.length >= 1);
    assert.deepEqual(hello, { type: 'hello', name: 'Fairy', provider: '', remote: true, link: 'unpaired' });
  } finally { sockets.close(); await rm(dir, { recursive: true, force: true }); }
});

test('work keepalive pings prevent idle drop, while a truly silent stream fails cleanly instead of hanging', async () => {
  const work = vaultWork(), alive = await setup(undefined, { electron: work.entry }, {}, { pingMs: 25, workSilentMs: 120 });
  try {
    let sent = false;
    const replies = await electron(join(alive.folder, FACE_SOCKETS.electron), [{ type: 'work', id: 'w-keep', folder: '/vault', prompt: 'think' }], got => {
      if (!sent && got.some(item => item.type === 'started')) {
        sent = true;
        setTimeout(() => work.emit!(forElectron({ type: 'done', text: 'Still alive.' })), 240);
      }
      return got.some(item => item.type === 'done');
    });
    assert.equal(replies.some(item => item.type === 'ping'), false);
    assert.deepEqual(replies.at(-1), { type: 'done', id: 'w-keep', text: 'Still alive.', failed: false });
  } finally { await alive.done(); }

  const hung = vaultWork(), dead = await setup(undefined, { electron: hung.entry }, {}, { pingMs: 0, workSilentMs: 80 });
  try {
    const replies = await electron(join(dead.folder, FACE_SOCKETS.electron), [{ type: 'work', id: 'w-silent', folder: '/vault', prompt: 'hang' }], got => got.some(item => item.type === 'done'));
    assert.deepEqual(replies.at(-1), { type: 'done', id: 'w-silent', text: 'Lost the link to your other Mac. The work carries on there, in Fairy’s sidebar.', failed: true });
  } finally { await dead.done(); }
});

test('Graviton on the face’s Mac asks into the other Mac’s Graviton chat, and her steps come back to Graviton here', async () => {
  const chat = browserChat({ steps: [['containers', { filter: 'running' }], ['container_action', { container: 'api', action: 'stop', reason: 'stop api' }], ['rm_rf', {}]] });
  const tools = fluxTools({ containers: [{ name: 'api', status: 'running' }], container_action: new Error('Touch ID was cancelled.') });
  const s = await setup(undefined, { graviton: chat.entry }, { gravitonBridge: tools.make });
  try {
    const replies = await talk(join(s.folder, FACE_SOCKETS.graviton), [{ type: 'ask', text: 'check containers', context: { host: 'This Mac', section: 'Containers', other: 1 }, tools: { socket: '/g/fairy-tools.sock', token: 'tok' } }], 2);
    assert.deepEqual(replies, [{ type: 'text', text: 'Found' }, { type: 'done', text: 'Found 2 links.' }]);
    assert.deepEqual(chat.asked, [{ text: 'check containers', context: { host: 'This Mac', section: 'Containers' }, tools: true }]);
    assert.deepEqual(tools.calls.map(call => [call.tools.socket, call.tools.token, call.step, call.args]), [
      ['/g/fairy-tools.sock', 'tok', 'containers', { filter: 'running' }],
      ['/g/fairy-tools.sock', 'tok', 'container_action', { container: 'api', action: 'stop', reason: 'stop api' }],
    ]);
    assert.deepEqual(chat.results, [
      { result: [{ name: 'api', status: 'running' }] },
      { error: 'Touch ID was cancelled.' },
      { error: 'Graviton didn’t give that step.' },
    ]);
    assert.equal(GRAVITON_STEPS.length, 27);
  } finally { await s.done(); }
});
