// After Away (the plan “Fairy away from the mini”): the user's other apps on a face's Mac. AudioPulse, Tachyon, Flux and Electron
// reach Fairy through private sockets in her data folder, and on a face's Mac that folder is on the other Mac. So the
// face opens the same sockets where the apps look, and carries each request over the link to the full Fairy. They are
// local sockets (mode 0600), so the face still listens on no network port, and the apps don't change.
//
// This is the one place a face touches the data folder's path, and all it does there is make the folder (if it isn't
// there, private to this user) and its own sockets, which it removes again when it stops. It never reads or writes
// any other file in it.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// The apps look here unless told otherwise, as the full Fairy's main.cjs does; a test copy sets FAIRY_DATA_DIR.
export function socketFolder({ userData, env = process.env }) {
  return env.FAIRY_DATA_DIR || env.LYRA_DATA_DIR || join(userData, 'lyra');
}

// The sockets a face opens, by app. Only these names are ever made.
export const FACE_SOCKETS = Object.freeze({ audiopulse: 'audiopulse.sock', tachyon: 'tachyon.sock', electron: 'electron.sock', flux: 'flux.sock', graviton: 'graviton.sock', cli: 'cli.sock', vorssaint: 'vorssaint.sock' });

// The steps the other Mac may take in Flux on this Mac, by the names flux-tools.mjs calls them; Flux checks each one.
export const FLUX_STEPS = Object.freeze(['tabs', 'read', 'open', 'click', 'type']);

// The steps the other Mac may take in Graviton on this Mac, by the names graviton-tools.mjs calls them; Graviton checks each one and enforces Touch ID.
export const GRAVITON_STEPS = Object.freeze([
  'status', 'events', 'switch_host', 'navigate', 'containers', 'inspect', 'logs', 'stats',
  'container_action', 'run', 'exec', 'stack_action', 'compose', 'list_files', 'read_file',
  'copy_files', 'images', 'pull', 'build', 'tag_image', 'push_image', 'remove_image',
  'volumes', 'volume_action', 'network', 'disk_and_prune', 'snapshots',
]);

// Electron's events as the other Mac sends them (electron-link.mjs's forElectron), back in the shape of the work events
// electron-link.mjs maps for Electron here, so what reaches Electron is what the other Mac sent.
export function fromElectron(event) {
  switch (event?.type) {
    case 'step': return { type: 'tool', row: event.row };
    case 'tasks': return { type: 'tasks', tasks: event.tasks };
    case 'thinking': return { type: 'thinking' };
    case 'text': return { type: 'text', text: event.text };
    case 'approval': return { type: 'approval', id: event.approval, title: event.title, detail: event.detail };
    case 'approval-closed': return { type: 'approval-closed', id: event.approval };
    case 'done': return { type: 'done', text: event.text, failed: event.failed === true };
    default: return null;
  }
}

// A chat on the other Mac, as chat-link.mjs uses a CompanionChat: one answer at a time, stopped by stop().
// `run({ signal, onText })`, as chat-link passes an app's own way of answering, replaces the plain ask (Flux's).
export function remoteChat(client, app) {
  let controller = null;
  return {
    async send(asked, { onText, run } = {}) {
      if (controller) throw new Error('Fairy is still answering. Stop her or wait a moment.');
      const mine = controller = new AbortController();
      try { return { text: run ? await run({ signal: mine.signal, onText }) : await client.appAsk(app, asked, { onText, signal: mine.signal }) }; }
      finally { if (controller === mine) controller = null; }
    },
    stop() { controller?.abort(new Error('Stopped.')); },
  };
}

/** Start the face's sockets in `folder`. `client` is the face's FaceClient; `name()` is her name as the other Mac last
 * gave it; `voice` plays her voice here ({ play(clip), hush(), muted() }, face-main.cjs's player). Returns { close },
 * which closes them all and removes their files. */
export async function startFaceSockets({ folder, client, name = () => 'Fairy', voice = { play() {}, hush() {}, muted: () => true }, log = () => {}, makeFolder = mkdirSync, fluxBrowser = null, gravitonBridge = null, vorssaintBinaryPath = null, vorssaintLockPath = null, onVorssaintDecision = null, onVorssaintUndock = null, onVorssaintQuickAction = null, onVorssaintContextAction = null, onVorssaintOps = null, onVorssaintCalendarRequest = null, onVorssaintAlert = null, onVorssaintFeaturesState = null }) {
  makeFolder(folder, { recursive: true, mode: 0o700 });
  const open = [];
  // AudioPulse: one music request at a time per message, answered by the other Mac's provider, as for AudioPulse on a
  // paired iPhone (/v1/assist). The provider isn't known here, so hello names none.
  const { startAudioPulseLink } = await import('./audiopulse-link.mjs');
  open.push(startAudioPulseLink({ path: join(folder, FACE_SOCKETS.audiopulse), ask: request => client.assist(request), name, log }));
  // Tachyon: its question and screen go to the other Mac as they are, where the prompt is built and the answer is kept in
  // its Terminal chat; anything the answer does happens there, in the other Mac's copies of your projects.
  const { startChatLink } = await import('./chat-link.mjs');
  const terminal = remoteChat(client, 'tachyon');
  open.push(startChatLink({ path: join(folder, FACE_SOCKETS.tachyon), chat: terminal, reset: () => client.appNew('tachyon'), name, log, label: 'tachyon',
    prompt: (text, context) => ({ text: typeof text === 'string' ? text : '', context }), record: () => '' }));
  // Electron: work in its vault starts on the other Mac, in that Mac's copy of the vault (the only one Fairy works in),
  // by that Mac's rules. Electron can't answer approvals; they're shown where Fairy's are, this face included.
  const { startElectronLink } = await import('./electron-link.mjs');
  open.push(startElectronLink({ path: join(folder, FACE_SOCKETS.electron), name, log, status: () => ({ remote: true, link: client.state() }),
    start: (request, emit) => client.appWork('electron', { folder: request.folder, prompt: request.prompt, context: request.context, chat: request.chat, mode: request.permission === 'plan' ? 'read' : 'edit' },
      event => { const raw = fromElectron(event); if (raw) emit(raw); }),
    stop: chat => { client.appStop('electron', chat).catch(error => log(`electron link: ${error.message}`)); } }));
  // CLI: full Fairy CLI over `cli.sock`, transparently proxied over the Face link to the Body Mac.
  const { startCliLink } = await import('./cli-link.mjs');
  const cliChat = remoteChat(client, 'cli');
  open.push(startCliLink({ path: join(folder, FACE_SOCKETS.cli), name, log, status: () => ({ remote: true, mode: 'face', link: client.state() }),
    rpc: (method, params) => client.appRpc('cli', method, params),
    startWork: (request, emit) => client.appWork('cli', { folder: request.folder, prompt: request.prompt, context: request.context, chat: request.chat, mode: request.permission === 'plan' ? 'read' : 'edit', ...(request.model ? { model: request.model } : {}), ...(request.provider ? { provider: request.provider } : {}) },
      event => { const raw = fromElectron(event); if (raw) emit(raw); }),
    stopWork: chat => { client.appStop('cli', chat).catch(error => log(`cli link: ${error.message}`)); },
    askChat: (request, emit) => cliChat.send(request.prompt, { onText: text => emit({ type: 'text', text }),
      run: ({ signal, onText }) => client.appAsk('cli', { text: request.prompt, context: { ...(request.context ? { text: request.context } : {}), ...(request.chat ? { section: request.chat } : {}), ...(request.model ? { url: request.model } : {}), ...(request.provider ? { host: request.provider } : {}) } }, { onText, signal }) }),
    stopChat: () => cliChat.stop() }));
  // Flux: its question and page go to the other Mac, where the prompt is built and the answer is kept in its Browser chat.
  // With Flux's tool key, each step she takes there comes back here and goes to Flux's own tool socket, where Flux checks
  // it and asks you before anything that sends, posts, buys or saves. Flux asks her to say her answer: the other Mac makes
  // her voice and it plays here, unless this face is muted; Stop in Flux quiets it.
  const { FluxBrowser } = await import('./flux-tools.mjs');
  const makeBrowser = fluxBrowser ?? (tools => new FluxBrowser(tools));
  const browserChat = remoteChat(client, 'flux');
  let speaking = null, spokenNext = null, said = 0;
  const hushFlux = () => { speaking?.abort(new Error('Stopped.')); speaking = null; voice.hush(); };
  open.push(startChatLink({ path: join(folder, FACE_SOCKETS.flux), chat: browserChat, reset: () => client.appNew('flux'), name, log, label: 'flux', onStop: hushFlux,
    prompt: (text, context) => ({ text: typeof text === 'string' ? text : '', context }), record: () => '',
    runner: message => ({ signal, onText }) => {
      let browser = null;
      if (typeof message?.tools?.socket === 'string' && typeof message?.tools?.token === 'string') browser = makeBrowser({ socket: message.tools.socket, token: message.tools.token });
      const speak = message?.speak === true && !voice.muted();
      // The request stays open after the answer while her voice comes, so its own stop outlives the answer's.
      const mine = speaking = new AbortController(), turn = `flux-${++said}`;
      signal.addEventListener('abort', () => mine.abort(signal.reason), { once: true });
      let part = 0, heard;
      spokenNext = speak ? new Promise(resolve => { heard = resolve; }) : null;
      return client.appAsk('flux', { text: typeof message?.text === 'string' ? message.text : '', context: message?.context ?? {}, tools: Boolean(browser), speak }, {
        onText, signal: mine.signal,
        onTool: (step, args, stepSignal) => (FLUX_STEPS.includes(step) && browser ? browser.call(step, args, stepSignal) : Promise.reject(new Error('Flux didn’t give that step.'))),
        onVoice: clip => { if (!mine.signal.aborted && !voice.muted()) voice.play({ turn, part: part++, bytes: clip.bytes, pauseBeforeMs: clip.pauseBeforeMs }); },
        onSpoken: () => { if (speaking === mine) speaking = null; heard?.(); },
      });
    },
    // Flux keeps its Stop up until she has said it; muted, or asked not to speak, that's at once.
    done: (text, message) => (message?.speak === true ? (spokenNext ?? Promise.resolve()) : undefined) }));
  // Graviton: its request and container context go to the other Mac, where the prompt is built and the answer is kept
  // in its Graviton chat. Each step runs back on this Mac against Graviton's tool socket (and Touch ID approvals).
  const { GravitonBridge } = await import('./graviton-tools.mjs');
  const makeGraviton = gravitonBridge ?? (tools => new GravitonBridge(tools));
  const gravitonChat = remoteChat(client, 'graviton');
  let gravSpeaking = null, gravSpokenNext = null, gravSaid = 0;
  const hushGraviton = () => { gravSpeaking?.abort(new Error('Stopped.')); gravSpeaking = null; voice.hush(); };
  open.push(startChatLink({ path: join(folder, FACE_SOCKETS.graviton), chat: gravitonChat, reset: () => client.appNew('graviton'), name, log, label: 'graviton', onStop: hushGraviton,
    prompt: (text, context) => ({ text: typeof text === 'string' ? text : '', context }), record: () => '',
    runner: message => ({ signal, onText }) => {
      let bridge = null;
      if (typeof message?.tools?.socket === 'string' && typeof message?.tools?.token === 'string') bridge = makeGraviton({ socket: message.tools.socket, token: message.tools.token });
      const speak = message?.speak === true && !voice.muted();
      const mine = gravSpeaking = new AbortController(), turn = `graviton-${++gravSaid}`;
      signal.addEventListener('abort', () => mine.abort(signal.reason), { once: true });
      let part = 0, heard;
      gravSpokenNext = speak ? new Promise(resolve => { heard = resolve; }) : null;
      return client.appAsk('graviton', { text: typeof message?.text === 'string' ? message.text : '', context: message?.context ?? {}, tools: Boolean(bridge), speak }, {
        onText, signal: mine.signal,
        onTool: (step, args, stepSignal) => (GRAVITON_STEPS.includes(step) && bridge ? bridge.call(step, args, stepSignal) : Promise.reject(new Error('Graviton didn’t give that step.'))),
        onVoice: clip => { if (!mine.signal.aborted && !voice.muted()) voice.play({ turn, part: part++, bytes: clip.bytes, pauseBeforeMs: clip.pauseBeforeMs }); },
        onSpoken: () => { if (gravSpeaking === mine) gravSpeaking = null; heard?.(); },
      });
    },
    done: (text, message) => (message?.speak === true ? (gravSpokenNext ?? Promise.resolve()) : undefined) }));
  // Vorssaint: Native OS body & Living Notch on this Mac; AI asks route over the Face link to the full Mac.
  const { startVorssaintLink } = await import('./vorssaint-link.mjs');
  const vorssaintChat = remoteChat(client, 'vorssaint');
  const vorssaint = startVorssaintLink({
    socketPath: join(folder, FACE_SOCKETS.vorssaint),
    binaryPath: vorssaintBinaryPath,
    lockPath: vorssaintLockPath,
    role: 'face',
    log,
    ask: ({ text, context, onText, signal }) => vorssaintChat.send(text, {
      onText,
      run: ({ signal: runSignal, onText: emitText }) => client.appAsk('vorssaint', { text, context }, { onText: emitText, signal: signal || runSignal }),
    }),
    onApprovalDecision: onVorssaintDecision ?? (() => {}),
    onUndock: onVorssaintUndock ?? (() => {}),
    onQuickAction: onVorssaintQuickAction ?? (() => {}),
    onContextAction: onVorssaintContextAction ?? (() => {}),
    onOps: onVorssaintOps ?? (() => {}),
    onCalendarRequest: onVorssaintCalendarRequest ?? (() => {}),
    onAlert: onVorssaintAlert ?? (() => {}),
    onFeaturesState: onVorssaintFeaturesState ?? (() => {}),
  });
  await vorssaint.ready;
  open.push({ close: () => { void vorssaint.close(); } });
  return { vorssaint, close() { hushFlux(); hushGraviton(); for (const link of open.splice(0)) link.close(); } };
}
