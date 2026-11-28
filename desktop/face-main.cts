import type {
  App,
  BrowserWindow as ElectronBrowserWindow,
  Display,
  Event as ElectronEvent,
  Input as ElectronInput,
  IpcMainInvokeEvent,
  MenuItemConstructorOptions,
  Notification as ElectronNotification,
  Rectangle,
  Tray as ElectronTray,
} from 'electron';
import type { IncomingMessage } from 'node:http';
import type { ConditionalTask } from '../src/conditional-task.js';
import type { AgentBrowser, AgentBrowserPane } from './agent-browser.mjs';
import type { AppCard, AppLauncher } from './apps.mjs';
import type { ScreenAwareness } from './awareness.mjs';
import type { BrowserPane, BrowserPaneBounds, BrowserPaneTimerHandle, BrowserPaneViewCtor, BrowserPaneWindow } from './browser-pane.mjs';
import type { ClaudeSyncSender } from './claude-sync.mjs';
import type { FaceClient, FaceLinkState, FaceStreamEvent } from './face-client.mjs';
import type { FaceSocketsHandle } from './face-sockets.mjs';
import type { FaceStore } from './face-store.mjs';
import type { FaceWindow } from './face-window.mjs';
import type { IdleReader } from './idle-reader.mjs';
import type { InkScene, InkSceneState } from './ink-sketch.mjs';
import type { PointerSampleResult, PointerSampler, ScreenPoint } from './pointer-sampler.mjs';
import type { PowerPolicyInput } from './power-awareness.mjs';
import type { QuickAsk, QuickAskElectronLike, QuickAskInkLike } from './quick-ask.mjs';
import type { QuizTarget } from './quiz-target.mjs';
import type { QuizMonitor } from './quiz.mjs';
import type { DesktopStepDeps, LastDesktopShot } from './remote-screen.mjs';
import type { ScreenHelper, ScreenPicture } from './screen-helper.mjs';
import type {
  CompactRelayState,
  CompactSweepState,
  VorssaintAlertEvent,
  VorssaintContextActionEvent,
  VorssaintFeaturesStatePayload,
  VorssaintUndockEvent,
} from './vorssaint-link.mjs';

const {
  BrowserWindow,
  Menu,
  Tray,
  ipcMain,
  nativeImage,
  safeStorage,
  screen,
  dialog,
  systemPreferences,
  powerMonitor,
  shell,
  clipboard,
  protocol,
  Notification,
  WebContentsView,
  session,
  globalShortcut,
  app: electronApp,
} = require('electron') as typeof import('electron');
const { spawn } = require('node:child_process') as typeof import('node:child_process');
const { existsSync } = require('node:fs') as typeof import('node:fs');
const { readFile, stat } = require('node:fs/promises') as typeof import('node:fs/promises');
const { homedir, hostname } = require('node:os') as typeof import('node:os');
const { join, resolve, sep } = require('node:path') as typeof import('node:path');
const { Readable } = require('node:stream') as typeof import('node:stream');
const { pathToFileURL } = require('node:url') as typeof import('node:url');
const { resolveAppRoot } = require('./app-root.cjs') as { resolveAppRoot(fromDir: string): string };
const APP_ROOT = resolveAppRoot(__dirname);
const { nativeBin, beside } = require('./bundle-path.cjs') as {
  nativeBin(name: string): string;
  beside(relative: string): string;
};
const { writeRole } = require('./role.cjs') as { writeRole(userData: string, role: string): void };
const { CompanionVisibility } = require('./companion-visibility.cjs') as {
  CompanionVisibility: new (window: ElectronBrowserWindow, changed?: (hidden: boolean) => void) => CompanionVisibilityInstance;
};
const { WindowSight } = require('./window-sight.cjs') as {
  WindowSight: new (opts: { window: ElectronBrowserWindow; changed?: (visible: boolean) => void }) => WindowSightInstance;
};
const glide = require('./glide.cjs') as {
  glideIn(win: ElectronBrowserWindow, opts: { screen: typeof screen; point?: ScreenPoint | null; opacity?: number }): Promise<void>;
  glideOut(win: ElectronBrowserWindow, opts: { screen: typeof screen; point?: ScreenPoint | null }): Promise<void>;
};
const rideCarry = require('./ride-carry.cjs') as {
  rideState(contents: ElectronBrowserWindow['webContents'] | null | undefined): Promise<unknown>;
  leaveRide(contents: ElectronBrowserWindow['webContents'] | null | undefined): Promise<void>;
  arriveRide(contents: ElectronBrowserWindow['webContents'] | null | undefined, ride: unknown): Promise<boolean>;
};
const { captureWindowRect } = require('./capture-rect.cjs') as {
  captureWindowRect(window: ElectronBrowserWindow | null | undefined, rect: Record<string, unknown> | null | undefined): Promise<string>;
};
const { makeQuitShortcutHandler } = require('./quit-hold.cjs') as {
  makeQuitShortcutHandler(options: {
    platform?: NodeJS.Platform | string;
    getMode?: () => Promise<string> | string;
    notify?: (event: { state: 'up' | 'down'; mode?: string; durationMs?: number }) => void;
    concealWindow?: () => void;
    quit?: () => void;
  }): (event: ElectronEvent, input: ElectronInput) => void;
};
const { createVorssaintCompanionHandoff } = require('./vorssaint-companion-handoff.cjs') as {
  createVorssaintCompanionHandoff(options: {
    screen: typeof screen;
    ensureWindow: () => Promise<ElectronBrowserWindow | null | undefined>;
    getWindow: () => ElectronBrowserWindow | null | undefined;
    isHidden: () => boolean;
    showWindowAt: () => void;
    hideWindowForDock: () => void;
    getVorssaint: () => FaceSocketsHandle['vorssaint'] | null;
  }): VorssaintHandoffHandle;
};

interface CompanionVisibilityInstance {
  hidden: boolean;
  hide(options?: { opacity?: number }): void;
  restore(options?: { opacity?: number }): void;
}

interface WindowSightInstance {
  visible: boolean;
  dispose(): void;
}

interface InkOverlayInstance {
  scene: InkScene;
  owner: unknown;
  showing: boolean;
  onAsk?: (text: string, owner: unknown) => void;
  onPen?: (phase: 'out' | 'in', owner: unknown) => void;
  show(state: Record<string, unknown> & { version: number; parts: unknown[] }, bounds: Rectangle, displayId: number): Promise<void>;
  clear(): void;
  close(): void;
  ride(on: boolean, display?: Display | null): Promise<void>;
  rideAt(point: ScreenPoint): void;
}

interface VorssaintHandoffHandle {
  handleUndock(event?: VorssaintUndockEvent): Promise<void>;
  onMove(): Promise<void>;
  onMoved(): Promise<void>;
}

interface ChatsStreamHandle {
  response?: IncomingMessage;
}

interface WaiterEntry {
  resolve: (value: { text: string }) => void;
  reject: (reason?: unknown) => void;
}

interface VoiceProgress {
  turn: string | null;
  fetched: number;
  want: number;
  fetching: boolean;
}

interface VoiceNotice {
  turn?: string;
  parts?: number;
}

interface DesktopTaskState {
  wasShown: boolean;
}

interface NotchHereState {
  bounds: Rectangle;
}

interface NotchNative {
  present(active: boolean): void;
  fill(handle: Buffer, active: boolean): void;
  geometry(handle: Buffer): Record<string, unknown>;
}

interface OpsServiceInstance {
  call(action: string, ...args: unknown[]): Promise<unknown>;
  follow(): void;
  summary(): Promise<unknown>;
}

interface QuizCapturedSnapshot extends ScreenPicture {
  width: number;
  height: number;
  excludedFairy: boolean;
  bounds: Rectangle;
  [key: string]: unknown;
}

// The companion's window: the eye and ring when idle; it grows upward for a reply or a question (companion-fit).
const WIDTH = 290, HEIGHT = 296, TALLEST = 620, KEEP_OUTCOMES = 10;
const LOST = 'Lost the link. The answer is saved in Quick chat on your other Mac.';
// This Mac's name as the other Mac lists it, without .local.
const deviceName = (): string => (hostname().replace(/\.local$/i, '') || 'Mac').slice(0, 40);
const page = pathToFileURL(join(APP_ROOT, 'dist/companion.html')).href, chatsPage = pathToFileURL(join(APP_ROOT, 'dist/chats.html')).href;
// Away 3: Fairy's own window page, the same file the other Mac's window loads.
const windowPage = pathToFileURL(join(APP_ROOT, 'dist/index.html')).href;
const isWindowPage = (url: string | undefined): boolean => { try { const parsed = new URL(url ?? ''); parsed.search = ''; parsed.hash = ''; return parsed.href === windowPage; } catch { return false; } };
// The companion page, opened as a face: the same file with ?role=face.
const isChatsPage = (url: string | undefined): boolean => { try { const parsed = new URL(url ?? ''); parsed.search = ''; parsed.hash = ''; return parsed.href === chatsPage; } catch { return false; } };
function isFacePage(url: string | undefined): boolean {
  try { const parsed = new URL(url ?? ''), role = parsed.searchParams.get('role'); parsed.search = ''; parsed.hash = ''; return parsed.href === page && role === 'face'; }
  catch { return false; }
}

function start({ app }: { app: App }): void {
  // Away 3: pages in Fairy's window load from fairy-artifact:, as on the other Mac, so the scheme is set up before ready.
  protocol.registerSchemesAsPrivileged([{ scheme: 'fairy-artifact', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  let win: ElectronBrowserWindow | null = null, tray: ElectronTray | null = null, store: FaceStore | null = null, presence: typeof import('./presence.mjs') | null = null, visibility: CompanionVisibilityInstance | null = null, client: FaceClient | null = null, quitting = false, link: FaceLinkState = 'unpaired';
  // Turns this face asked for, waiting for their answer; answers that came before the ask's reply did; her voice for the
  // latest turn (which clips are fetched); and a voice notice that came before its turn was known.
  const waiters = new Map<string, WaiterEntry>(), outcomes = new Map<string, { text: string } | Error>();
  let voice: VoiceProgress = { turn: null, fetched: 0, want: 0, fetching: false }, lateVoice: VoiceNotice | null = null, helloTurn: string | null = null;
  // Step 5: whether the other Mac says to show her here, whether you hid her yourself, this Mac's pointer sampler and
  // idle reader, and where the pointer came in and went out.
  let shownHere = true, userHidden = false, moving: Promise<void> = Promise.resolve(), pointer: PointerSampler | null = null, idleReader: IdleReader | null = null, presenceTimer: ReturnType<typeof setInterval> | null = null;
  let edges: { entry: ScreenPoint | null; exit: ScreenPoint | null } = { entry: null, exit: null }, lastSample: PointerSampleResult | null = null, reportedAt = 0, wasActive = false, sending = false, faceLocked = false;
  // Ride along: her eye on the pointer while she's idle, drawn by the ink window on this Mac, as on the full Fairy.
  let ink: InkOverlayInstance | null = null, riding = false, rideWatch: ReturnType<typeof setInterval> | null = null;
  // The chats window: the phone link's chats, read and written as a phone does, in a window of its own.
  let chatsWin: ElectronBrowserWindow | null = null, chatsStream: ChatsStreamHandle | null = null, chatsFor: string | null = null, chatsRetry: ReturnType<typeof setTimeout> | null = null, eventParser: typeof import('./face-client.mjs').eventParser | null = null;
  // Pictures of this screen for the other Mac (step 6): one helper takes them, at most two a second.
  // Step 7: the display the last picture was of, where the other Mac's drawing for it goes, and the ink window's start.
  let screenHelper: ScreenHelper | null = null, lastPictureAt = 0, pictureDisplay: Display | null = null, inkReady: Promise<InkOverlayInstance> | null = null, routing: typeof import('../src/chat-routing.js') | null = null;
  // Quicker ways to ask (quick-ask.mjs): ⌃⌥A over an area and ⌥⌘ for a box, as on the full Fairy.
  let quickAsk: QuickAsk | null = null;
  // Apps on this Mac, opened by name from the companion (apps.mjs).
  let localApps: AppLauncher | null = null;
  // Away 3: Fairy's own window here (face-window.mjs), and whether its handlers are registered.
  let fullWin: ElectronBrowserWindow | null = null, fullWinSight: WindowSightInstance | null = null, powerHereWatched = false, faceWindow: FaceWindow | null = null, windowRegistered = false;
  // Sweep here (sweep.mjs), made when the window first asks; its events go to this Mac's window.
  let sweepHere: OpsServiceInstance | null = null, sweepReport: ReturnType<typeof setInterval> | null = null, relayHere: OpsServiceInstance | null = null, compactSweepStateRef: (s?: unknown) => CompactSweepState = s => s as CompactSweepState, compactRelayStateRef: (s?: unknown) => CompactRelayState = s => s as CompactRelayState;
  const localSweep = async (): Promise<OpsServiceInstance> => {
    if (!sweepHere) {
      const { sweepService } = await import('./sweep.mjs');
      sweepHere ??= sweepService({ onEvent: event => {
        if (fullWin && !fullWin.isDestroyed()) fullWin.webContents.send('fairy:sweep', event);
        void sweepHere?.call('state').then(s => sockets?.vorssaint?.pushOpsState({ sweep: compactSweepStateRef(s) })).catch(() => {});
      } }) as unknown as OpsServiceInstance;
      sweepHere.follow();
    }
    return sweepHere;
  };
  // Relay here (relay.mjs), the same way: the repo syncer lives on this Mac (the MacBook).
  const localRelay = async (): Promise<OpsServiceInstance> => {
    if (!relayHere) {
      const { relayService } = await import('./relay.mjs');
      relayHere ??= relayService({ onEvent: event => {
        if (fullWin && !fullWin.isDestroyed()) fullWin.webContents.send('fairy:relay', event);
        void relayHere?.call('state').then(s => sockets?.vorssaint?.pushOpsState({ relay: compactRelayStateRef(s) })).catch(() => {});
      } }) as unknown as OpsServiceInstance;
      relayHere.follow();
    }
    return relayHere;
  };
  // Claude sync (claude-sync.mjs): Claude Code is used on this Mac, and Fairy's chats and pages live on the other, so this
  // Mac sends what's new in Claude Code's history there: 90 seconds after the link first comes up, then every 10 minutes
  // while it's up, and when the window's Sync now asks. Its progress goes to this Mac's window.
  let claudeSender: ClaudeSyncSender | null = null, claudeTimer: ReturnType<typeof setTimeout> | null = null;
  const localClaudeSync = async (): Promise<ClaudeSyncSender> => {
    if (!claudeSender) {
      const { ClaudeSyncSender } = await import('./claude-sync.mjs');
      const { atomicJSON } = await import('./json-store.mjs');
      const folder = join(app.getPath('userData'), 'face');
      claudeSender ??= new ClaudeSyncSender({ name: deviceName(), cacheFile: join(folder, 'claude-sync-cache.json'), stageDir: join(folder, 'claude-sync-stage'), dropDir: join(folder, 'claude-sync-drop'), brainDir: join(homedir(), '.gemini', 'antigravity', 'brain'),
        readJSON: async (path, fallback) => { try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; } },
        writeJSON: (path, value) => atomicJSON(path, JSON.stringify(value)),
        post: (path, body, timeoutMs) => connected().call('POST', path, { body, timeoutMs }),
        log: message => console.warn(message),
        onState: state => { if (fullWin && !fullWin.isDestroyed()) fullWin.webContents.send('fairy:claude-sync', state); } });
    }
    return claudeSender;
  };
  const syncClaude = (): void => { if (client?.state() === 'connected') void localClaudeSync().then(sender => sender.run()).catch((error: unknown) => console.warn('Claude sync:', (error as Error)?.message ?? error)); };
  function scheduleClaudeSync(): void {
    if (claudeTimer) return;
    claudeTimer = setTimeout(function again() { syncClaude(); claudeTimer = setTimeout(again, 10 * 60_000); }, 90_000);
  }
  // Its browser pane, with this Mac's own sign-ins, and her steps in it for turns started in that window (remote-browser.mjs),
  // each stoppable by id.
  let browserPane: BrowserPane<BrowserPaneTimerHandle> | null = null, faceBrowser: AgentBrowser | null = null;
  const browserRuns = new Map<string, AbortController>();
  // A Desktop task on this Mac's screen, run by the other Mac (remote-screen.mjs): its steps in flight, by id; the last
  // picture's size, which a batch of actions must match; and the task while it runs (Fairy's window steps aside).
  const desktopRuns = new Map<string, AbortController>(), desktopLast: LastDesktopShot = { shot: null };
  // companionAsking: how many of the companion's questions are waiting on the other Mac. A task one of them turned into
  // needs no window, and its steps come marked via 'turn' and are answered over the link itself; desktopVia is the last
  // step's, 'turn' or 'window'.
  let desktopTask: DesktopTaskState | null = null, companionAsking = 0, desktopVia: 'turn' | 'window' = 'window';
  // This Mac's own say on a task acting here: Touch ID on this Mac at least once per task (the other Mac's question
  // counts when it's answered here), good for 15 minutes and ended when the task leaves. A step is run only for a turn
  // or task started on this Mac, whatever the other Mac sends.
  let desktopOkUntil = 0, openingWindow: Promise<void> | null = null;
  const DESKTOP_OK_MS = 15 * 60_000;
  const SCREEN_OFF = 'Your MacBook isn’t sharing its screen. Turn on Let Fairy see this screen in Fairy’s menu bar there, then ask again.';
  // After Away: sockets for the user's other apps on this Mac (face-sockets.mjs), and her name as the other Mac gave it.
  let sockets: FaceSocketsHandle | null = null, herName = 'Fairy';
  // Away 1: how Tailscale reaches the other Mac, 'direct' or 'relayed', looked up now and then while connected.
  let linkPath = '', pathTimer: ReturnType<typeof setInterval> | null = null, vorssaintCalendarTimer: ReturnType<typeof setInterval> | null = null, vorssaintUsageTimer: ReturnType<typeof setInterval> | null = null, refreshVorssaintCalendar: () => Promise<void> | void = () => {}, refreshVorssaintUsage: () => Promise<void> | void = () => {};
  // Step 8: quiz hints for a question open on this Mac (setUpQuiz).
  let quiz: QuizMonitor | null = null, quizTarget: QuizTarget | null = null, quizAwareness: ScreenAwareness<QuizCapturedSnapshot> | null = null, quizTimers: { poll: ConditionalTask; hover: ConditionalTask } | null = null, quizPollMs = 500, quizDisplayId: number | null = null;
  const send = (channel: string, value?: unknown): void => { if (win && !win.isDestroyed()) win.webContents.send(channel, value); };
  const state = () => ({ ...store!.state(), link, visible: !visibility?.hidden });
  const changed = (): void => { send('fairy:face-state', state()); refreshTray(); };

  // Opening Fairy again on this Mac brings her here.
  app.on('second-instance', () => bringHere());
  // A face lives in the menu bar: closing its window hides it.
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => { quitting = true; if (pathTimer) clearInterval(pathTimer); if (vorssaintCalendarTimer) clearInterval(vorssaintCalendarTimer); if (vorssaintUsageTimer) clearInterval(vorssaintUsageTimer); quickAsk?.stop(); quiz?.enable(false); quizTimers?.poll.dispose(); quizTimers?.hover.dispose(); client?.stop(); if (presenceTimer) clearInterval(presenceTimer); idleReader?.stop(); if (rideWatch) clearInterval(rideWatch); ink?.close(); stopChatsStream(); screenHelper?.dispose(); });

  // Shown unless you hid her, or unless the other Mac shows her (while connected; unconnected, she stays to say so). By the
  // other Mac's word she glides in and out at the screen's edge; by yours she just appears or goes.
  const wanted = (): boolean => !userHidden && (link !== 'connected' || shownHere);
  // ride: the other Mac's Ride along as she crosses (ride-carry.cjs). Riding there, she rides on here at the pointer
  // instead of gliding in; riding here, she leaves with the pointer instead of gliding out.
  function applyShown({ glideBy = false, ride = null }: { glideBy?: boolean; ride?: unknown } = {}): void {
    moving = moving.then(async () => {
      if (!visibility || !win || win.isDestroyed()) return;
      const want = wanted();
      if (want && visibility.hidden) {
        visibility.restore(glideBy ? { opacity: 0 } : {});
        win.showInactive();
        const rode = await rideCarry.arriveRide(win.webContents, glideBy ? ride : null);
        if (glideBy && !rode) await glide.glideIn(win, { screen, point: edges.entry });
      } else if (!want && !visibility.hidden) {
        await rideCarry.leaveRide(win.webContents);
        const rode = riding;
        if (riding) await setRide(false, { hidden: glideBy });
        if (glideBy && !rode) await glide.glideOut(win, { screen, point: edges.exit });
        visibility.hide(glideBy ? { opacity: 1 } : {});
      }
      changed();
    }).catch((error: unknown) => console.warn('Couldn’t move her:', (error as Error)?.message ?? error));
  }
  // Hiding her yourself wipes what she drew, as on the full Fairy; gliding to the other Mac leaves it.
  function hide(): void { userHidden = true; ink?.clear(); applyShown(); sockets?.vorssaint?.sendDock(); }

  // The chats window, opened from the ring's ↗ or the menu bar. It has a Dock icon while it's open.
  const chatsState = () => ({ link, host: store!.state().host });
  const sendChats = (channel: string, value?: unknown): void => { if (chatsWin && !chatsWin.isDestroyed()) chatsWin.webContents.send(channel, value); };
  function openChats(): void {
    if (chatsWin && !chatsWin.isDestroyed()) { chatsWin.show(); chatsWin.focus(); return; }
    chatsWin = new BrowserWindow({ width: 1000, height: 700, minWidth: 640, minHeight: 440, title: 'Baryon', show: false, backgroundColor: '#08080a', titleBarStyle: 'hiddenInset',
      webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    // Links in her replies open in your browser; nothing else opens or navigates.
    chatsWin.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) void shell.openExternal(url); return { action: 'deny' }; });
    chatsWin.webContents.on('will-navigate', event => event.preventDefault());
    chatsWin.webContents.on('before-input-event', makeQuitShortcutHandler({
      platform: process.platform,
      getMode: async () => 'hold',
      notify: payload => { if (chatsWin && !chatsWin.isDestroyed()) chatsWin.webContents.send('fairy:quit-shortcut', payload); },
      concealWindow: () => { if (chatsWin && !chatsWin.isDestroyed()) chatsWin.hide(); },
      quit: () => app.quit(),
    }));
    chatsWin.on('closed', () => { chatsWin = null; stopChatsStream(); if (!fullWin) app.dock?.hide(); });
    chatsWin.once('ready-to-show', () => { chatsWin?.show(); chatsWin?.focus(); });
    app.dock?.show();
    void chatsWin.loadFile(join(APP_ROOT, 'dist/chats.html'));
  }
  // Follows one chat (or none, for just the list and the questions waiting) on the phone link's live stream.
  function watchChats(chat?: unknown): void {
    chatsFor = typeof chat === 'string' && chat ? chat.slice(0, 80) : null;
    stopChatsStream();
    if (!chatsWin || chatsWin.isDestroyed() || !client || client.state() !== 'connected') { sendChats('fairy:face-chats-state', chatsState()); return; }
    const mine: ChatsStreamHandle = {};
    chatsStream = mine;
    const again = (delay: number): void => { if (chatsStream === mine) { chatsStream = null; chatsRetry = setTimeout(() => watchChats(chatsFor), delay); } };
    client.chatsStream(chatsFor ?? undefined).then(response => {
      if (chatsStream !== mine) { response.destroy(); return; }
      if (response.statusCode !== 200) { response.resume(); again(3000); return; }
      mine.response = response;
      const parser = eventParser!();
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => { for (const { data } of parser.feed(chunk)) sendChats('fairy:face-chats', data); });
      response.on('error', () => {});
      response.on('close', () => again(2000));
    }, () => again(3000));
  }
  function stopChatsStream(): void { if (chatsRetry) clearTimeout(chatsRetry); chatsRetry = null; const stream = chatsStream; chatsStream = null; stream?.response?.destroy(); }
  function fromChats(channel: string, run: (...args: any[]) => unknown): void {
    ipcMain.handle(`fairy:${channel}`, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (!chatsWin || chatsWin.isDestroyed() || event.sender !== chatsWin.webContents || !isChatsPage(event.senderFrame?.url)) throw new Error('Untrusted application frame.');
      return run(...args);
    });
  }
  const connected = (): FaceClient => { if (!client || client.state() !== 'connected') throw new Error(presence!.faceStatus(client?.state() ?? 'unpaired', store!.state().host)); return client; };

  // The face's mute, shown on the ring's mute button through the mirror the companion page already reads.
  function sendMirror(): void {
    const muted = store!.state().muted, words = muted ? 'Turn her voice back on' : 'Mute voice';
    const hints = Boolean(quiz?.enabled), auto = Boolean(quizTarget?.automatic);
    send('fairy:companion-mirror', [{ id: 'floating-mute', label: words, title: words, pressed: muted ? 'true' : 'false', disabled: false, hidden: false },
      // The quiz's buttons are this Mac's own: its quiz watches this screen (step 8).
      { id: 'floating-quiz-hints', label: hints ? 'Turn quiz hints off' : 'Quiz hints', title: hints ? `Quiz hints: ${quizStatus()}` : 'Hints for a quiz question on this screen', pressed: String(hints), disabled: !quiz, hidden: false },
      { id: 'floating-quiz-auto', label: 'Auto hints', title: auto ? 'Hints for any question on screen' : 'Hints for the question heading you hover', pressed: String(auto), disabled: !hints, hidden: false }]);
  }
  async function toggleMute(): Promise<void> { const muted = !store!.state().muted; await store!.set('muted', muted); if (muted) hush(); sendMirror(); changed(); }

  // The ink window, made once, for Ride along and for drawings from the other Mac. A card asking for more (a quiz's "more
  // like this") is asked as another drawn answer, and the pen leaving and coming back turns her into it and back.
  function ensureInk(): Promise<InkOverlayInstance> {
    inkReady ??= (async () => {
      const { InkScene } = await import('./ink-sketch.mjs');
      const { InkOverlay } = require('./ink-overlay.cjs') as {
        InkOverlay: new (opts: { scene: InkScene; onChange?: (showing: boolean) => void }) => InkOverlayInstance;
      };
      ink = new InkOverlay({ scene: new InkScene() });
      ink.onAsk = (text: string) => send('fairy:companion-ask', text);
      ink.onPen = (phase: 'out' | 'in') => send('fairy:companion-morph', phase);
      return ink;
    })();
    return inkReady;
  }
  // A drawing from the other Mac (step 7), on the display the picture was taken of, kept clear of her window, the pen
  // starting from her eye, as the full Fairy draws for the companion.
  async function drawOn({ state, clear }: { state?: { parts?: Array<{ id?: unknown } & Record<string, unknown>>; version?: number } & Record<string, unknown>; clear?: boolean } = {}): Promise<void> {
    if (clear === true) return ink?.clear();
    if (!state || !Array.isArray(state.parts)) return;
    const overlay = await ensureInk();
    const display = screen.getAllDisplays().find(each => each.id === pictureDisplay?.id) ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    overlay.scene.load(state);
    const shown = win && !win.isDestroyed() && win.isVisible() && !visibility?.hidden, own = shown ? win!.getBounds() : null;
    const avoid = own ? [{ x: own.x - display.bounds.x, y: own.y - display.bounds.y, w: own.width, h: own.height }] : [];
    const home = shown ? await eyeOn(display) : null;
    overlay.owner = 'companion';
    await overlay.show({ ...state, avoid, ...(home ? { home } : {}), version: typeof state.version === 'number' ? state.version : overlay.scene.version, parts: state.parts as InkSceneState['parts'] }, display.bounds, display.id);
  }
  async function eyeOn(display: Display): Promise<[number, number] | null> {
    if (!win || win.isDestroyed()) return null;
    const eye = await win.webContents.executeJavaScript(`(() => { const r = document.querySelector('#eye')?.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; })()`, true).catch(() => null) as { x?: unknown; y?: unknown } | null;
    if (!eye || typeof eye.x !== 'number' || typeof eye.y !== 'number' || !Number.isFinite(eye.x) || !Number.isFinite(eye.y)) return null;
    const content = win.getContentBounds();
    return [content.x + eye.x - display.bounds.x, content.y + eye.y - display.bounds.y];
  }

  // ⌃⌥A drags over an area on the face's own ink window and asks about it in a box beside it, drawn here from the other
  // Mac's answer; ⌥⌘ opens the box at the pointer. Holding ⌃⌥ to talk stays off: a face has no microphone of its own
  // yet. The keys need Accessibility for Fairy on this Mac; until it's granted the watcher retries every half minute.
  async function startQuickKeys(): Promise<void> {
    if (process.platform !== 'darwin' || quickAsk) return;
    const { QuickAsk } = await import('./quick-ask.mjs');
    quickAsk = new QuickAsk({ electron: { app, BrowserWindow, screen, ipcMain } as unknown as QuickAskElectronLike, ink: (await ensureInk()) as unknown as QuickAskInkLike, voice: () => win, asker: () => win,
      allowed: () => !faceLocked && client?.state() === 'connected', keys: () => ({ hold: 'off', tap: 'option+command', area: true }),
      preload: join(__dirname, 'quick-preload.cjs'), page: join(APP_ROOT, 'dist/quickask.html') });
    quickAsk.start();
  }

  // Away 3: Fairy's own window on this Mac, the page her window loads on the other Mac, every call it makes answered there
  // by her own handlers (face-window.mjs). Opening it, and allowing a step from it, ask for Touch ID.
  // One at a time: a second click while Touch ID is up waits for the first, rather than opening a second window.
  function openFullWindow(): Promise<void> { openingWindow ??= openFullWindowOnce().finally(() => { openingWindow = null; }); return openingWindow; }
  async function openFullWindowOnce(): Promise<void> {
    if (fullWin && !fullWin.isDestroyed()) { fullWin.show(); fullWin.focus(); return; }
    const { FaceWindow } = await import('./face-window.mjs');
    faceWindow ??= new FaceWindow({ client: connected(), approveKey: () => store!.approveKey(),
      // Whether this window is seen is this Mac's own, never the other Mac's (face-window.mjs seenHere).
      seen: () => Boolean(fullWinSight?.visible),
      power: () => { const here: PowerPolicyInput = {}; try { here.onBattery = powerMonitor.isOnBatteryPower(); } catch {} try { here.thermal = powerMonitor.getCurrentThermalState(); } catch {} return here; },
      // A test copy run from the repo (never the installed app) may skip Touch ID, so it can be driven without anyone there.
      confirm: async reason => { if (!app.isPackaged && process.env.FAIRY_TEST_SKIP_TOUCH_ID === '1') return; if (!systemPreferences.canPromptTouchID()) throw new Error('Opening Fairy’s window here needs Touch ID.'); await systemPreferences.promptTouchID(reason); },
      local: windowLocal(), deliver: (channel, value) => {
        if (fullWin && !fullWin.isDestroyed()) fullWin.webContents.send(`fairy:${channel}`, value);
        // While a Desktop task has Fairy's window out of the way, its progress shows under her eye.
        if (desktopTask && channel === 'progress' && typeof value === 'string' && value) send('fairy:companion-progress', value);
      },
      // Away 5: how the link is, for the page's dimmed state and its waiting line; and a work session's folder, picked here.
      status: value => { if (fullWin && !fullWin.isDestroyed()) fullWin.webContents.send('fairy:remote-link', { ...value, tailscale: value.down && tailscaleDown }); },
      // A scratch session (Fairy Scratch, scratch.mjs) or a folder picked in the Obsidian SSH modal passes straight through.
      choose: {
        'session-new-work': args => (args?.[0] === 'scratch' || (typeof args?.[0] === 'string' && args[0].startsWith('/')) ? args : chooseWorkFolder()),
        'session-to-work': async args => {
          if (args?.[1] === 'scratch' || (typeof args?.[1] === 'string' && args[1].startsWith('/'))) return args;
          const picked = await chooseWorkFolder();
          return picked ? [args?.[0] ?? null, picked[0]] : null;
        },
      } });
    faceWindow.linkChanged(link);
    await faceWindow.session();
    await registerWindowHandlers();
    // This Mac's sweep summary, told to the Mac Fairy lives on each minute while this window's session is open, so its
    // window shows this Mac too. Never opens a session itself (that would ask for Touch ID).
    sweepReport ??= setInterval(() => {
      if (!faceWindow?.open) return;
      void localSweep().then(sweep => sweep.summary()).then(summary => faceWindow!.call('sweep-peer-report', [summary])).catch(() => {});
      // Relay's too, so the mini's window shows the MacBook's syncing.
      void localRelay().then(relay => relay.summary()).then(summary => faceWindow!.call('relay-peer-report', [summary])).catch(() => {});
    }, 60_000);
    if (!browserPane) {
      const { BrowserPane } = await import('./browser-pane.mjs'), { AgentBrowser } = await import('./agent-browser.mjs');
      browserPane = new BrowserPane({ getWindow: () => fullWin as unknown as BrowserPaneWindow, WebContentsView: WebContentsView as unknown as BrowserPaneViewCtor, session, onState: value => { if (fullWin && !fullWin.isDestroyed()) fullWin.webContents.send('fairy:browser', value); } });
      faceBrowser = new AgentBrowser({ pane: browserPane as unknown as AgentBrowserPane, reveal: () => {} });
    }
    // fullscreenable: false, as macOS's own full screen would give the window a Space of its own, below the menu bar;
    // full screen here is around the notch (⌃⌘F in the menu below).
    fullWin = new BrowserWindow({ width: 1280, height: 820, minWidth: 820, minHeight: 650, title: 'Baryon', show: false, frame: false, transparent: true, backgroundColor: '#00000000', fullscreenable: false,
      webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
    fullWin.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) void shell.openExternal(url); return { action: 'deny' }; });
    fullWin.webContents.on('will-navigate', event => event.preventDefault());
    fullWin.webContents.on('before-input-event', makeQuitShortcutHandler({
      platform: process.platform,
      getMode: async () => 'hold',
      notify: payload => { if (fullWin && !fullWin.isDestroyed()) fullWin.webContents.send('fairy:quit-shortcut', payload); },
      concealWindow: () => { if (fullWin && !fullWin.isDestroyed()) fullWin.hide(); },
      quit: () => app.quit(),
    }));
    fullWin.once('ready-to-show', () => { fullWin?.show(); fullWin?.focus(); });
    // The pane's page belongs to this window, so it goes with it; a chat using it lets go.
    fullWin.on('close', () => { if (desktopVia !== 'turn') { if (desktopTask) { desktopTask.wasShown = false; void desktopPresence('leave'); } for (const run of desktopRuns.values()) run.abort(); } if (browserPane) { browserPane.close(); browserPane.visible = false; } if (faceBrowser) faceBrowser.owner = null; for (const run of browserRuns.values()) run.abort(); });
    fullWin.on('closed', () => { if (notchHere) { notchHere = null; notchNative?.present(false); } fullWin = null; void faceWindow?.end(); fullWinSight?.dispose(); fullWinSight = null; if (!chatsWin) app.dock?.hide(); });
    // Shown, hidden, minimized or covered, the page hears it, so its backgrounds move only while it's seen here.
    fullWinSight = new WindowSight({ window: fullWin, changed: () => faceWindow?.seenChanged() });
    if (!powerHereWatched) { powerHereWatched = true; for (const event of ['on-battery', 'on-ac', 'thermal-state-change', 'speed-limit-change'] as const) (powerMonitor as unknown as { on(e: string, fn: () => void): void }).on(event, () => faceWindow?.seenChanged()); }
    // Full screen around the notch is kept as the other Mac keeps it (main.cjs): going to the Dock gives the screen
    // back; coming back from another app or Space, where macOS put the menu bar back and may have moved the window
    // below it, it's put back.
    fullWin.on('minimize', () => { if (notchHere) aroundNotchHere(false); });
    fullWin.on('focus', keepAroundNotch);
    fullWin.on('show', keepAroundNotch);
    keepNotchWatch();
    windowMenu();
    app.dock?.show();
    await fullWin.loadFile(join(APP_ROOT, 'dist/index.html'));
  }
  // Away 4: what the other Mac would show as a notification, shown here too while her window is open here.
  const notices = new Set<ElectronNotification>();
  function showNotice({ title, body }: { title?: unknown; body?: unknown } = {}): void {
    if (!fullWin || typeof title !== 'string' || !Notification.isSupported()) return;
    const notice = new Notification({ title, body: String(body ?? '') });
    notices.add(notice);
    notice.on('close', () => notices.delete(notice));
    notice.on('click', () => { notices.delete(notice); if (fullWin && !fullWin.isDestroyed()) { fullWin.show(); fullWin.focus(); } });
    notice.show();
  }
  // Away 4: the window filling the screen around this Mac's notch, through the same native helper the other Mac uses.
  let notchHere: NotchHereState | null = null;
  const notchNative = ((): NotchNative | null => { if (process.platform !== 'darwin') return null; try { return require(nativeBin('fairy-notch.node')) as NotchNative; } catch { return null; } })();
  const notchStateHere = (): Record<string, unknown> => (notchHere && notchNative && fullWin && !fullWin.isDestroyed() ? { on: true, ...notchNative.geometry(fullWin.getNativeWindowHandle()) } : { on: false, available: Boolean(notchNative) });
  function aroundNotchHere(value?: unknown): Record<string, unknown> {
    if (value === undefined || !notchNative || !fullWin || fullWin.isDestroyed() || Boolean(value) === Boolean(notchHere)) return notchStateHere();
    if (value) {
      if (fullWin.isMinimized()) fullWin.restore();
      notchHere = { bounds: fullWin.getBounds() };
      notchNative.present(true);
      fullWin.setMovable(false); fullWin.setMaximizable(false);
      notchNative.fill(fullWin.getNativeWindowHandle(), true);
      fullWin.focus();
    } else {
      const { bounds } = notchHere!; notchHere = null;
      notchNative.present(false);
      notchNative.fill(fullWin.getNativeWindowHandle(), false);
      fullWin.setMovable(true); fullWin.setMaximizable(true);
      fullWin.setBounds(bounds);
    }
    fullWin.webContents.send('fairy:around-notch', notchStateHere());
    return notchStateHere();
  }
  function keepAroundNotch(): void {
    if (!notchHere || !notchNative || !fullWin || fullWin.isDestroyed() || !fullWin.isVisible() || fullWin.isMinimized()) return;
    notchNative.present(true);
    notchNative.fill(fullWin.getNativeWindowHandle(), true);
    fullWin.webContents.send('fairy:around-notch', notchStateHere());
  }
  // Once: a new resolution or arrangement moves the notch, so the screen is covered again and the band redrawn.
  let notchWatched = false;
  function keepNotchWatch(): void {
    if (notchWatched) return;
    notchWatched = true;
    screen.on('display-metrics-changed', () => { if (notchHere && notchNative && fullWin && !fullWin.isDestroyed()) { notchNative.fill(fullWin.getNativeWindowHandle(), true); fullWin.webContents.send('fairy:around-notch', notchStateHere()); } });
    screen.on('display-removed', () => { if (notchHere) aroundNotchHere(false); });
    app.on('did-become-active', keepAroundNotch);
  }
  // The menu bar while her window is open here: without one, Electron's own would take ⌃⌘F for macOS's full screen.
  function windowMenu(): void {
    const here = (): boolean => Boolean(fullWin && !fullWin.isDestroyed());
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'Baryon', submenu: [{ label: 'About Baryon', role: 'about' }, { type: 'separator' }, { label: 'Quit Baryon', role: 'quit' }] },
      { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: 'Window', submenu: [
        { label: 'Minimize', accelerator: 'Cmd+M', click: () => { if (here()) fullWin!.minimize(); } },
        ...(notchNative ? [{ label: 'Full Screen Around the Notch', accelerator: 'Ctrl+Cmd+F', click: () => { if (here()) aroundNotchHere(!notchHere); } }] : []),
        { label: 'Close', accelerator: 'Cmd+W', click: () => { if (here()) fullWin!.close(); } },
      ] },
    ]));
  }
  // Away 5: a work session started here goes in a folder already worked in on the other Mac, as from the phone, picked
  // from a menu at the pointer. Resolves [path], or null when the menu closes without a choice.
  async function chooseWorkFolder(): Promise<[string] | null> {
    const state = await faceWindow!.call('state') as { workFolders?: Array<{ path?: unknown; name?: unknown; default?: unknown }> } | null | undefined;
    const folders = Array.isArray(state?.workFolders) ? state.workFolders.filter((item): item is { path: string; name?: unknown; default?: unknown } => typeof item?.path === 'string') : [];
    if (!folders.length) throw new Error('Start your first work session on your other Mac; after that you can start one here in the same folder.');
    return new Promise(resolve => {
      let chosen: [string] | null = null;
      const menu = Menu.buildFromTemplate([{ label: 'Work in a folder on your other Mac', enabled: false },
        ...folders.map(item => ({ label: `${String(item.name || item.path)}${item.default === true ? ' · default' : ''}`, sublabel: item.path, click: () => { chosen = [item.path]; } }))]);
      // The click comes before or just after the menu closes, depending on the macOS version: wait a moment for it.
      const closed = (): void => { setTimeout(() => resolve(chosen), 50); };
      if (fullWin && !fullWin.isDestroyed()) menu.popup({ window: fullWin, callback: closed }); else resolve(null);
    });
  }
  // Away 5: whether this Mac's Tailscale is connected at all, so a dropped link can say so rather than blame the other Mac.
  let tailscaleDown = false;
  async function checkTailscale(): Promise<void> {
    const { runCommand, TAILSCALE } = await import('./home-health.mjs');
    const { code, stdout } = await runCommand(TAILSCALE, ['status', '--json'], { timeoutMs: 4000 } as never);
    tailscaleDown = presence!.tailscaleOffline(stdout, code);
  }
  let miniSshBrowser: { browse(opts: Record<string, unknown>): Promise<unknown> } | null = null;
  async function browseMiniDir(options: unknown): Promise<unknown> {
    if (!miniSshBrowser) {
      const { createMiniSshBrowser } = await import('./mini-ssh-browse.mjs');
      miniSshBrowser = createMiniSshBrowser({ pairedHost: () => store?.state?.().host || '' });
    }
    return miniSshBrowser.browse(options && typeof options === 'object' ? (options as Record<string, unknown>) : {});
  }
  // This Mac's own answers for its window: its size, the pointer.
  function windowLocal(): Record<string, (...args: any[]) => unknown> {
    const here = (): boolean => Boolean(fullWin && !fullWin.isDestroyed());
    let boardsFilesPromise: Promise<Record<string, (...args: any[]) => Promise<unknown>>> | null = null;
    const boardsFiles = () => (boardsFilesPromise ??= import('./boards.mjs').then(({ createBoardsFileHandlers }) =>
      createBoardsFileHandlers({ dialog: dialog as unknown as Parameters<typeof createBoardsFileHandlers>[0]['dialog'], getWindow: () => fullWin, createBoard: payload => faceWindow!.call('boards-create', [payload]) }) as unknown as Record<string, (...args: any[]) => Promise<unknown>>));
    return {
      minimize: () => { if (here()) fullWin!.minimize(); },
      close: () => { if (here()) fullWin!.close(); },
      'mini-browse-dir': options => browseMiniDir(options),
      'boards-export-file': async payload => (await boardsFiles())['boards-export-file'](payload),
      'boards-import-image': async () => (await boardsFiles())['boards-import-image'](),
      'boards-open-file': async () => (await boardsFiles())['boards-open-file'](),
      'open-in-proton': async (folder, fallbackName = '') => (await import('./proton-open.mjs')).openFolderInProton(folder, { fallbackName }),
      // Full screen around the notch, as the other Mac's window does it (main.cjs setAroundNotch), for this window.
      'around-notch': value => aroundNotchHere(value),
      // A web link in a reply opens in this Mac's browser; anything else isn't this Mac's to open.
      'open-source': async value => {
        let url: URL;
        try { url = new URL(String(value ?? '')); } catch { throw new Error('Invalid source link.'); }
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Only web links open on this Mac.');
        await shell.openExternal(url.href);
      }, ride: () => false, 'sprite-hidden': () => false,
      'walk-start': () => null, 'walk-step': () => null, 'walk-stop': () => null,
      // Away 4: files you choose here are read here and added on the other Mac.
      'attach-choose': async () => {
        const { ATTACHABLE_EXTENSIONS } = await import('../src/local-file-types.js');
        const chosen = await dialog.showOpenDialog(fullWin!, { title: 'Add files', buttonLabel: 'Add', properties: ['openFile', 'multiSelections'],
          filters: [{ name: 'Text, code, PDFs and pictures', extensions: ATTACHABLE_EXTENSIONS.map(extension => extension.slice(1)) }] });
        if (chosen.canceled) return { added: [], failed: [] };
        return faceWindow!.attachFiles(chosen.filePaths, { stat, readFile });
      },
      // Its own browser pane: pages load on this Mac, with its own sign-ins.
      'browser-state': () => browserPane?.state() ?? { url: '', title: '', loading: false, canBack: false, canForward: false, note: '' },
      'browser-go': input => browserPane!.go(input),
      'browser-command': name => browserPane!.command(name),
      'browser-place': bounds => { if (here()) browserPane!.place(bounds as BrowserPaneBounds); return null; },
      'browser-show': value => { browserPane?.show(value === true && here()); return null; },
      // Sweep: this Mac's own disk cleaner (sweep.mjs), followed while Fairy runs here.
      sweep: async (action, ...args) => (await localSweep()).call(String(action ?? ''), ...args),
      // Relay: this Mac's repo syncer (relay.mjs).
      relay: async (action, ...args) => (await localRelay()).call(String(action ?? ''), ...args),
      // Claude sync: this Mac's sender. 'run' starts a run (Sync now) and answers at once; its progress follows.
      'claude-sync': async action => {
        const sender = await localClaudeSync();
        if (action === 'run') sender.run({ manual: true }).catch((error: unknown) => console.warn('Claude sync:', (error as Error)?.message ?? error));
        return sender.state();
      },
      // Antigravity artifacts live on this Mac (~/.gemini/antigravity/brain); push them to the mini and refresh Pages.
      'artifacts-import-antigravity': async () => {
        const sender = await localClaudeSync();
        const counts = await sender.syncAntigravity({ manual: true });
        const artifacts = await faceWindow!.call('artifacts-state', []);
        return { counts, artifacts };
      },
      // ChatGPT (Codex) artifacts/PDFs may live on the mini and/or this MacBook; import from both and refresh Pages.
      'artifacts-import-codex': async () => {
        const sender = await localClaudeSync();
        const [miniRes, localCounts] = await Promise.all([
          (faceWindow!.call('artifacts-import-codex', []) as Promise<{ counts?: { found?: number; copied?: number; updated?: number; skipped?: number; failed?: number } } | null>).catch(() => ({ counts: { found: 0, copied: 0, updated: 0, skipped: 0, failed: 0 } })),
          sender.syncCodex({ manual: true }).catch(() => ({ found: 0, copied: 0, updated: 0, skipped: 0, failed: 0 })),
        ]);
        const mc = miniRes?.counts || {};
        const counts = {
          found: (mc.found || 0) + (localCounts.found || 0),
          copied: (mc.copied || 0) + (localCounts.copied || 0),
          updated: (mc.updated || 0) + (localCounts.updated || 0),
          skipped: (mc.skipped || 0) + (localCounts.skipped || 0),
          failed: (mc.failed || 0) + (localCounts.failed || 0),
        };
        const artifacts = await faceWindow!.call('artifacts-state', []);
        return { counts, artifacts };
      },
      'capture-rect': rect => captureWindowRect(fullWin, rect as Record<string, unknown> | null | undefined),
      'cursor-position': () => { if (!here()) return null; const point = screen.getCursorScreenPoint(), bounds = fullWin!.getContentBounds(); return { x: point.x - bounds.x, y: point.y - bounds.y }; },
      'vorssaint-status': () => {
        const link = sockets?.vorssaint;
        if (link?.state?.()?.connected) link.sendFeaturesCommand({ action: 'status' });
        return {
          ...(link?.featuresState?.() || { connected: false }),
          helperBundled: existsSync(nativeBin('baryon-vorssaint')),
          role: 'face',
        };
      },
      'vorssaint-action': async payload => {
        const link = sockets?.vorssaint;
        if (link?.state?.()?.connected && payload && typeof payload === 'object') {
          const obj = payload as Record<string, unknown>;
          if (obj.action === 'applyPreset' && obj.preset) {
            link.pushPreset(String(obj.preset), obj);
          }
          link.sendFeaturesCommand(obj);
          await new Promise(resolve => setTimeout(resolve, 120));
        }
        return {
          ...(link?.featuresState?.() || { connected: false }),
          helperBundled: existsSync(nativeBin('baryon-vorssaint')),
          role: 'face',
        };
      },
    };
  }
  // Every channel the window page can call gets a handler here, for that window only: a Remote one goes to the other
  // Mac, a Local one is answered here, and the rest say "Do this on your other Mac".
  async function registerWindowHandlers(): Promise<void> {
    if (windowRegistered) return;
    windowRegistered = true;
    const { REMOTE, LOCAL, MINI_ONLY } = await import('./remote-channels.mjs'), { SENDS } = await import('./face-window.mjs');
    const localFolderStats = new Map<string, { at: number; value: unknown }>();
    const LOCAL_FOLDER_STATS_TTL_MS = 20_000;
    const homePrefix = resolve(homedir()) + sep;
    ipcMain.handle('fairy:folder-project-stats', async (event: IpcMainInvokeEvent, paths: unknown) => {
      if (!fullWin || fullWin.isDestroyed() || event.sender !== fullWin.webContents || !isWindowPage(event.senderFrame?.url)) throw new Error('Untrusted application frame.');
      let result: Record<string, { isRepo?: boolean } & Record<string, unknown>> | undefined;
      try { result = await faceWindow!.call('folder-project-stats', [paths]) as typeof result; } catch {}
      const requested = Array.isArray(paths) ? paths.filter((p): p is string => typeof p === 'string' && Boolean(p)).slice(0, 30) : [];
      const out: Record<string, { isRepo?: boolean } & Record<string, unknown>> = result && typeof result === 'object' ? { ...result } : {};
      const missing = [...new Set(requested)].filter(p => !out[p]?.isRepo);
      if (!missing.length) return out;
      const { projectBrief } = await import('./git-tools.mjs');
      const now = Date.now();
      await Promise.all(missing.map(async p => {
        const full = resolve(p);
        if (!full.startsWith(homePrefix)) return;
        const hit = localFolderStats.get(p);
        const brief = hit && now - hit.at < LOCAL_FOLDER_STATS_TTL_MS ? (hit.value as { isRepo?: boolean } & Record<string, unknown> | null) : ((await projectBrief(p)) as unknown as ({ isRepo?: boolean } & Record<string, unknown> | null));
        if (!hit || now - hit.at >= LOCAL_FOLDER_STATS_TTL_MS) localFolderStats.set(p, { at: now, value: brief });
        if (brief?.isRepo) out[p] = brief;
      }));
      return out;
    });
    for (const channel of [...REMOTE, ...LOCAL, ...MINI_ONLY]) {
      if (SENDS.includes(channel)) continue;
      if (channel === 'folder-project-stats') continue;
      try {
        ipcMain.handle(`fairy:${channel}`, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
          if (!fullWin || fullWin.isDestroyed() || event.sender !== fullWin.webContents || !isWindowPage(event.senderFrame?.url)) throw new Error('Untrusted application frame.');
          return faceWindow!.call(channel, args);
        });
      } catch (error: unknown) { console.warn(`Fairy’s window: ${channel} is already answered here:`, (error as Error)?.message ?? error); }
    }
    // Her pages and animations, from the other Mac, for this window only; offline bundled scientific viewers
    // (fairy-artifact://viewer/...) are served locally directly from this Mac's app bundle.
    const { optionalImport } = (await import('./edition.mjs')) as unknown as {
      optionalImport: (specifier: string, parentUrl: URL) => Promise<{
        serveViewerAsset?: (pathname: string, options?: { roots?: string[] }) => Promise<{ status: number; headers: Record<string, string>; body: Buffer | string }>;
      } | null>;
    };
    const viewerAssetsMod = await optionalImport('./research/viewer-assets.mjs', require('node:url').pathToFileURL(__filename));
    const serveViewerAsset = viewerAssetsMod?.serveViewerAsset || (async () => ({ status: 404, headers: {}, body: 'Not found' }));
    const viewerAssetRoots = [join(APP_ROOT, 'dist', 'viewers'), join(APP_ROOT, 'public', 'viewers')];
    protocol.handle('fairy-artifact', async request => {
      const url = new URL(request.url);
      if (url.hostname === 'viewer' && ['GET', 'HEAD'].includes(request.method)) {
        const { status, headers, body } = await serveViewerAsset(url.pathname, { roots: viewerAssetRoots });
        return new Response(request.method === 'HEAD' ? null : (body as BodyInit), { status, headers });
      }
      if (!faceWindow || !['page', 'anim'].includes(url.hostname) || !['GET', 'HEAD'].includes(request.method)) return new Response('Not found', { status: 404 });
      const { status, headers, bytes, stream } = await faceWindow.file({ host: url.hostname, path: url.pathname, range: request.headers.get('range') });
      const normalizedHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(headers)) {
        if (typeof v === 'string') normalizedHeaders[k] = v;
        else if (Array.isArray(v)) normalizedHeaders[k] = v.join(', ');
      }
      // A video's range streams in from the other Mac as it plays; cancelling it (a seek) closes that connection.
      if (stream) { if (request.method === 'HEAD') { stream.destroy(); return new Response(null, { status, headers: normalizedHeaders }); } return new Response(Readable.toWeb(stream) as BodyInit, { status, headers: normalizedHeaders }); }
      return new Response(request.method === 'HEAD' ? null : (bytes as BodyInit | undefined), { status, headers: normalizedHeaders });
    });
  }

  // Away 1: "Check before you leave": each of the other Mac's checks with a tick, a cross and its fix, or a dot for
  // something to know. The fixes can be copied, as some are commands to run there.
  async function checkBeforeLeaving(): Promise<void> {
    let checks: Array<{ ok?: boolean | null; label?: unknown; fix?: unknown }>;
    try { checks = (await connected().health()) as typeof checks; }
    catch (error: unknown) { await dialog.showMessageBox({ type: 'warning', message: 'Couldn’t check your other Mac', detail: String((error as Error)?.message || error) }); return; }
    const mark = (check: { ok?: boolean | null }): string => (check.ok === true ? '✓' : check.ok === false ? '✗' : '•');
    const detail = checks.map(check => `${mark(check)}  ${check.label}${check.fix ? `\n      ${check.fix}` : ''}`).join('\n');
    const fixes = checks.filter(check => check.ok === false && Boolean(check.fix)).map(check => String(check.fix));
    const failing = checks.filter(check => check.ok === false).length;
    const { response } = await dialog.showMessageBox({ type: failing ? 'warning' : 'info', message: failing ? `Before you leave: ${failing} to fix on your other Mac` : 'Your other Mac will look after itself',
      detail, buttons: fixes.length ? ['OK', 'Copy the fixes'] : ['OK'], defaultId: 0 });
    if (response === 1) clipboard.writeText(fixes.join('\n'));
  }
  // Away 1: Fairy started again on the other Mac, with Touch ID, as allowing a step needs. The link drops and comes back.
  async function restartOtherMac(): Promise<void> {
    const { response } = await dialog.showMessageBox({ type: 'question', buttons: ['Restart', 'Cancel'], defaultId: 0, cancelId: 1, message: 'Restart Fairy on your other Mac?',
      detail: 'Use this if she’s stuck there. A reply she’s writing is stopped; her chats and work are kept.' });
    if (response !== 0) return;
    try {
      if (!systemPreferences.canPromptTouchID()) throw new Error('Restarting her from this Mac needs Touch ID.');
      await systemPreferences.promptTouchID('restart Fairy on your other Mac');
      await connected().restart(store!.approveKey());
      send('fairy:companion-say', 'Starting again on your other Mac. I’ll be back in a moment.');
    } catch (error: unknown) { if (!/cancel/i.test(String((error as Error)?.message))) await dialog.showMessageBox({ type: 'warning', message: 'Fairy wasn’t restarted', detail: String((error as Error)?.message || error) }); }
  }
  // Away 1: "direct" or "relayed" beside the link's state, from this Mac's Tailscale, every minute while connected.
  function watchPath(): void {
    if (pathTimer) clearInterval(pathTimer); pathTimer = null;
    if (link !== 'connected') { linkPath = ''; return; }
    const look = async (): Promise<void> => {
      const { runCommand, TAILSCALE } = await import('./home-health.mjs');
      const { stdout } = await runCommand(TAILSCALE, ['status', '--json']);
      const next = presence!.tailscalePath(stdout, store!.state().host);
      if (next !== linkPath) { linkPath = next; refreshTray(); }
    };
    void look().catch(() => {});
    pathTimer = setInterval(() => void look().catch(() => {}), 60_000);
    pathTimer.unref?.();
  }

  // Step 8: quiz hints for a question open on this Mac. The watcher is the full Fairy's (quiz-setup.mjs) and runs here,
  // on this screen: it takes the pictures and reads the text itself. What it recognises goes to the other Mac, whose own
  // quiz solve answers it, so no model is called from this Mac. The hint shows beside Fairy's menu-bar icon. It needs Let
  // Fairy see this screen, since the question's picture goes with it, and Screen Recording for Fairy here.
  const quizBase = (): number => (powerMonitor.isOnBatteryPower?.() ? 1000 : 500);
  const quizAllowed = (): boolean => Boolean(store?.state().screen) && !faceLocked && client?.state() === 'connected' && systemPreferences.getMediaAccessStatus('screen') === 'granted';
  const quizStatus = (): string => (!quiz?.enabled ? 'Off' : !store!.state().screen ? 'Turn on Let Fairy see this screen'
    : systemPreferences.getMediaAccessStatus('screen') !== 'granted' ? 'Allow Screen Recording for Fairy' : client?.state() !== 'connected' ? 'Waiting for your other Mac' : String(quiz.state().status || ''));
  async function setUpQuiz(): Promise<void> {
    if (process.platform !== 'darwin' || quiz) return;
    const { buildQuiz, quizTasks } = await import('./quiz-setup.mjs');
    const { ScreenAwareness } = await import('./awareness.mjs');
    const { watchCadence } = await import('./attention.mjs');
    quizAwareness = new ScreenAwareness<QuizCapturedSnapshot>({ capture: () => quizPicture(), allowed: () => Boolean(quiz?.enabled) && quiz!.allowed() });
    ({ quiz, target: quizTarget } = buildQuiz({
      allowed: quizAllowed, publish: answer => showHint(answer),
      changed: () => {
        if (!quiz?.enabled) quizAwareness?.clear();
        const hintText = quiz?.state().thinking ? '…' : quiz?.shown || '';
        showHint(hintText);
        syncQuiz();
        sendMirror();
        refreshTray();
        if (quiz?.enabled) {
          sockets?.vorssaint?.pushState({ state: 'quiz', title: quiz.state().thinking ? 'Thinking…' : (quiz.shown || 'Quiz mode') });
        } else {
          sockets?.vorssaint?.pushState({ state: 'idle' });
        }
      },
      solve: (observation, signal) => client!.quiz(observation, { signal }),
      picture: () => ({ cache: quizAwareness!, shareMs: 0 }), pollMs: () => quizPollMs,
      pointer: () => screen.getCursorScreenPoint(), displayId: () => quizDisplayId, nativeImage: nativeImage as unknown as import('./quiz-setup.mjs').QuizNativeImageApi,
    }));
    const idle = (): number => { try { return powerMonitor.getSystemIdleTime(); } catch { return 0; } };
    quizTimers = quizTasks({ quiz, target: quizTarget, enabled: () => Boolean(quiz?.enabled) && quiz!.allowed(),
      cadence: () => watchCadence({ base: quizBase(), idleSeconds: idle() }), pointer: () => screen.getCursorScreenPoint(),
      pollDelay: () => (quizPollMs = quiz!.nextPollMs(quizBase(), { idleSeconds: idle(), focused: false })) });
    sendMirror(); refreshTray();
  }
  function syncQuiz(): void { quizTimers?.poll.sync(); quizTimers?.hover.sync(); }
  // The display the pointer is on, at the quiz's size (Retina text, at most 3,072 wide), without Fairy's own windows.
  async function quizPicture(): Promise<QuizCapturedSnapshot> {
    const { ScreenHelper } = await import('./screen-helper.mjs');
    screenHelper ??= new ScreenHelper({ path: nativeBin('fairy-screen') });
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    quizDisplayId = display.id;
    const width = Math.round(Math.min(3072, display.size.width * Math.min(2, display.scaleFactor || 1))), height = Math.round(width * display.size.height / display.size.width);
    const image = await screenHelper.capture({ displayID: display.id, excludePID: process.pid, foregroundOnly: 1, width, height });
    return { ...image!, width: image?.width ?? width, height: image?.height ?? height, excludedFairy: true, bounds: display.bounds };
  }
  // The hint, beside Fairy's menu-bar icon.
  function showHint(answer: unknown): void { if (tray && !tray.isDestroyed?.()) tray.setTitle(answer ? ` ${String(answer).slice(0, 40)}` : ''); }
  function toggleQuiz(on = !quiz?.enabled): void {
    if (!quiz) return;
    if (on && !store!.state().screen) { send('fairy:companion-say', 'Turn on Let Fairy see this screen in my menu bar first, so I can see the quiz.'); return; }
    quiz.enable(on);
  }
  function toggleQuizAuto(): void {
    if (!quiz || !quizTarget) return;
    quizTarget.setAutomatic(!quizTarget.automatic);
    quiz.reset(quizTarget.automatic ? 'Waiting for a question' : 'Hover a question heading to select it', { keepQuestionHistory: true });
    sendMirror();
  }

  // Ride along, as setRiding does it on the full Fairy: the window goes see-through and click-through, and the ink window
  // draws her beside the pointer on whichever display it's on, about 30 times a second.
  async function setRide(on: boolean, { hidden = false }: { hidden?: boolean } = {}): Promise<boolean> {
    on = Boolean(on) && process.platform === 'darwin' && Boolean(win) && !win!.isDestroyed() && Boolean(visibility) && !visibility!.hidden && win!.isVisible();
    if (on === riding) return riding;
    if (rideWatch) clearInterval(rideWatch); rideWatch = null;
    if (on) {
      const overlay = await ensureInk();
      riding = true; win!.setOpacity(0); win!.setIgnoreMouseEvents(true, { forward: true });
      let shownOn: number | null = null, lastX: number | null = null, lastY: number | null = null, moving = false;
      const follow = async (): Promise<void> => {
        if (!riding || moving) return;
        moving = true;
        try {
          const point = screen.getCursorScreenPoint(), display = screen.getDisplayNearestPoint(point);
          if (shownOn !== display.id) { shownOn = display.id; lastX = null; await overlay.ride(true, display); }
          if (point.x !== lastX || point.y !== lastY) { lastX = point.x; lastY = point.y; overlay.rideAt({ x: point.x - display.bounds.x, y: point.y - display.bounds.y }); }
        } finally { moving = false; }
      };
      await follow();
      rideWatch = setInterval(() => void follow().catch(() => {}), 33);
      report();
    } else {
      riding = false;
      // Leaving for the other Mac, she stays hidden rather than flashing back for a moment.
      if (win && !win.isDestroyed()) { win.setOpacity(hidden ? 0 : 1); win.setIgnoreMouseEvents(false); }
      await ink?.ride(false);
      report();
    }
    return riding;
  }

  // Whether this Mac is the one in use, every 200 ms while connected, reported to the other Mac at once when input starts
  // after a pause, every second while it goes on, and every 5 seconds otherwise.
  async function startPresence(): Promise<void> {
    if (presenceTimer) return;
    const { PointerSampler, SAMPLE_MS } = await import('./pointer-sampler.mjs');
    const { IdleReader } = await import('./idle-reader.mjs');
    const { FRESH_MS, HEARTBEAT_MS } = await import('./face-presence.mjs');
    pointer ??= new PointerSampler();
    idleReader ??= new IdleReader({ path: nativeBin('fairy-idle'), every: SAMPLE_MS, fallback: () => powerMonitor.getSystemIdleTime() });
    idleReader.start();
    presenceTimer = setInterval(() => {
      lastSample = pointer!.sample({ point: screen.getCursorScreenPoint(), idle: idleReader!.idle() });
      edges = { entry: lastSample.entry, exit: lastSample.exit };
      const now = Date.now(), active = lastSample.activeAgoMs <= FRESH_MS;
      if ((active && !wasActive) || (active && now - reportedAt >= 1000) || now - reportedAt >= HEARTBEAT_MS) report();
      wasActive = active;
    }, SAMPLE_MS);
    presenceTimer.unref?.();
  }
  function stopPresence(): void { if (presenceTimer) clearInterval(presenceTimer); presenceTimer = null; idleReader?.stop(); }
  function report(extra: { claim?: boolean } = {}): void {
    if (!client || client.state() !== 'connected' || (sending && !extra.claim)) return;
    sending = true; reportedAt = Date.now();
    // Her Ride along, while she's shown here, so she rides on at the other Mac if she crosses riding.
    const shown = wanted() && Boolean(visibility) && !visibility!.hidden;
    (shown ? rideCarry.rideState(win?.webContents) : Promise.resolve(null))
      .then(ride => client!.presence({ activeAgoMs: lastSample?.activeAgoMs ?? 3_600_000, locked: faceLocked, follow: store!.state().follow, ...(ride ? { ride } : {}), ...extra }))
      .catch(() => {}).finally(() => { sending = false; });
  }
  // "Bring Fairy here", or Show Fairy while she's on the other Mac.
  function bringHere(): void { userHidden = false; report({ claim: true }); applyShown(); }

  function placeFor(saved: { x: number; y: number } | null): { x: number; y: number } {
    const fits = saved && screen.getAllDisplays().some(({ workArea: a }) => saved.x >= a.x && saved.y >= a.y && saved.x + WIDTH <= a.x + a.width && saved.y + HEIGHT <= a.y + a.height);
    if (fits) return saved;
    const area = screen.getPrimaryDisplay().workArea;
    return { x: area.x + area.width - WIDTH - 20, y: area.y + area.height - HEIGHT - 20 };
  }

  const vorssaintHandoff = createVorssaintCompanionHandoff({
    screen,
    ensureWindow: async () => {
      if (!win || win.isDestroyed()) await makeWindow();
      return win;
    },
    getWindow: () => win,
    isHidden: () => Boolean(!win || win.isDestroyed() || visibility?.hidden),
    showWindowAt: () => {
      userHidden = false;
      visibility?.restore({ opacity: 1 });
      if (win && !win.isDestroyed()) {
        win.setOpacity(1);
        win.setIgnoreMouseEvents(false);
        win.showInactive();
      }
      changed();
    },
    hideWindowForDock: () => {
      userHidden = true;
      ink?.clear();
      visibility?.hide({ opacity: 1 });
      changed();
    },
    getVorssaint: () => sockets?.vorssaint ?? null,
  });

  async function makeWindow(): Promise<void> {
    // As the companion window is made on the full Fairy (main.cjs setCompanion).
    win = new BrowserWindow({ ...placeFor(store!.state().place), width: WIDTH, height: HEIGHT, minWidth: 100, minHeight: 100, title: 'Baryon', show: false,
      frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, alwaysOnTop: true, skipTaskbar: true, fullscreenable: false,
      webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    win.setAlwaysOnTop(true, 'floating');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.on('close', event => { if (!quitting) { event.preventDefault(); hide(); } });
    win.on('move', () => { void vorssaintHandoff.onMove(); });
    win.on('moved', () => {
      const [x, y] = win!.getPosition();
      void store!.set('place', { x, y }).catch(() => {});
      void vorssaintHandoff.onMoved();
    });
    visibility = new CompanionVisibility(win, () => refreshTray());
    await win.loadFile(join(APP_ROOT, 'dist/companion.html'), { query: { role: 'face' } });
    win.showInactive();
  }

  function refreshTray(): void {
    if (!tray || !presence || !store) return;
    const { host, muted, openAtLogin } = store.state();
    const template = presence.faceTrayTemplate({ link, host, visible: !visibility?.hidden, muted, openAtLogin, here: link === 'connected' ? shownHere : null, follow: store.state().follow, screen: store.state().screen,
      quiz: quiz ? { enabled: quiz.enabled, status: quizStatus() } : null, path: linkPath });
    tray.setToolTip(presence.faceStatus(link, host));
    tray.setContextMenu(Menu.buildFromTemplate(template.map(item => (item.type === 'separator' || item.enabled === false
      ? item
      : { ...item, click: () => void trayAction(item.id).catch((error: unknown) => console.warn('Face menu:', (error as Error)?.message ?? error)) })) as MenuItemConstructorOptions[]));
  }

  async function trayAction(id?: string): Promise<void> {
    if (id === 'show') { if (!visibility!.hidden) hide(); else if (link === 'connected' && !shownHere) bringHere(); else { userHidden = false; applyShown(); } }
    if (id === 'here') bringHere();
    if (id === 'chats') openChats();
    if (id === 'window') return openFullWindow();
    if (id === 'screen') { await store!.set('screen', !store!.state().screen); if (!store!.state().screen && quiz?.enabled) quiz.enable(false); changed(); syncQuiz(); }
    if (id === 'quiz') toggleQuiz();
    if (id === 'follow') { await store!.set('follow', store!.state().follow === 'pointer' ? 'manual' : 'pointer'); report(); changed(); }
    if (id === 'mute') await toggleMute();
    // As on the full Fairy, only an installed copy is made a login item, never a test copy run from the repo.
    if (id === 'login') { const on = !store!.state().openAtLogin; if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: on }); await store!.set('openAtLogin', on); changed(); }
    if (id === 'forget') {
      const { response } = await dialog.showMessageBox({ type: 'question', buttons: ['Forget', 'Cancel'], defaultId: 1, cancelId: 1, message: 'Forget your other Mac?', detail: 'This Mac stops being paired with it, and the other Mac removes it too if it can be reached. You can pair again with a new link from that Mac.' });
      if (response === 0) { hush(); await client!.forget(); changed(); }
    }
    if (id === 'check') return checkBeforeLeaving();
    if (id === 'restart') return restartOtherMac();
    if (id === 'home') {
      const { response } = await dialog.showMessageBox({ type: 'question', buttons: ['Switch back', 'Cancel'], defaultId: 1, cancelId: 1, message: 'Switch back to the full Fairy on this Mac?', detail: 'Fairy will restart as she was on this Mac, with the data she had here. The pairing with your other Mac is kept in case you switch again.' });
      if (response === 0) { writeRole(app.getPath('userData'), 'home'); app.relaunch(); app.quit(); }
    }
    if (id === 'quit') app.quit();
  }

  // The companion page's calls, from this window's page only, as fromCompanion checks them on the full Fairy.
  function fromPage(channel: string, run: (...args: any[]) => unknown): void {
    ipcMain.handle(`fairy:${channel}`, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (!win || win.isDestroyed() || event.sender !== win.webContents || !isFacePage(event.senderFrame?.url)) throw new Error('Untrusted application frame.');
      return run(...args);
    });
  }
  // What the other Mac sends (face-link.mjs), passed to the page as the companion's own events.
  const vorssaintApprovals = new Map<string, { id: string; title: string; detail: string }>();
  const syncVorssaintApprovals = (): void => { sockets?.vorssaint?.syncApprovals([...vorssaintApprovals.values()]); };
  function onEvent({ type, data = {} }: FaceStreamEvent): void {
    const payload = data as Record<string, any>;
    if (type === 'show') { shownHere = payload.on === true; return applyShown({ glideBy: true, ride: payload.ride ?? null }); }
    if (type === 'hello') {
      helloTurn = typeof payload.turn?.id === 'string' ? payload.turn.id : null; herName = String(payload.name || 'Fairy');
      shownHere = payload.show === true; applyShown();
      vorssaintApprovals.clear();
      for (const item of Array.isArray(payload.approvals) ? (payload.approvals as Array<Record<string, unknown>>) : []) {
        const mapped = approvalFor(item);
        send('fairy:companion-approval', mapped);
        vorssaintApprovals.set(mapped.id, mapped);
      }
      syncVorssaintApprovals();
      return;
    }
    if (type === 'lost') { for (const waiter of waiters.values()) waiter.reject(new Error(LOST)); waiters.clear(); return; }
    if (type === 'text') return send('fairy:companion-text', String(payload.text ?? ''));
    if (type === 'progress') {
      const text = String(payload.text ?? '');
      sockets?.vorssaint?.pushState({ state: text ? 'working' : 'idle', title: text });
      return send('fairy:companion-progress', text);
    }
    if (type === 'done') {
      sockets?.vorssaint?.pushState({ state: quiz?.enabled ? 'quiz' : 'idle' });
      return settle(String(payload.turn), { text: String(payload.text ?? '') });
    }
    if (type === 'failed') {
      sockets?.vorssaint?.pushState({ state: quiz?.enabled ? 'quiz' : 'idle' });
      return settle(String(payload.turn), new Error(String(payload.message || 'Fairy couldn’t answer.')));
    }
    if (type === 'voice') {
      sockets?.vorssaint?.pushState({ state: 'speaking', title: 'Speaking' });
      return void hear(payload as VoiceNotice);
    }
    if (type === 'approval') {
      const mapped = approvalFor(payload);
      vorssaintApprovals.set(mapped.id, mapped);
      syncVorssaintApprovals();
      return send('fairy:companion-approval', mapped);
    }
    if (type === 'approval-closed') {
      const id = String(payload.id);
      vorssaintApprovals.delete(id);
      syncVorssaintApprovals();
      return send('fairy:companion-approval', { id, closed: true });
    }
    if (type === 'say') return send('fairy:companion-say', String(payload.text ?? ''));
    if (type === 'want-picture') return void answerPicture(payload as { id?: unknown; purpose?: unknown });
    if (type === 'ink') return void drawOn(payload as Parameters<typeof drawOn>[0]).catch((error: unknown) => console.warn('Couldn’t draw:', (error as Error)?.message ?? error));
    if (type === 'window') return void faceWindow?.events(payload as Parameters<FaceWindow['events']>[0]);
    if (type === 'browser-step') return void answerBrowserStep(payload as { id?: unknown; tool?: unknown; args?: unknown });
    if (type === 'browser-step-stop') return void browserRuns.get(String(payload.id))?.abort();
    if (type === 'desktop-step') return void answerDesktopStep(payload as { id?: unknown; tool?: unknown; args?: unknown; via?: unknown });
    if (type === 'desktop-step-stop') return void desktopRuns.get(String(payload.id))?.abort();
    if (type === 'notice') return void showNotice(payload as { title?: unknown; body?: unknown });
  }
  const approvalFor = (item: Record<string, unknown>) => ({ id: String(item.id), title: String(item.title || 'Fairy needs your OK'),
    detail: `${String(item.detail || '')}${item.macOnly ? '\n\nThis one can only be allowed on your other Mac.' : item.tooBig ? '\n\nThis one is too long to answer here. Answer it on your other Mac.' : ''}`.trim() });
  function settle(turn: string, outcome: { text: string } | Error): void {
    const waiter = waiters.get(turn);
    if (waiter) { waiters.delete(turn); return outcome instanceof Error ? waiter.reject(outcome) : waiter.resolve(outcome); }
    outcomes.set(turn, outcome);
    for (const old of [...outcomes.keys()].slice(0, -KEEP_OUTCOMES)) outcomes.delete(old);
    // A turn that was running when this face reconnected: its answer is shown when it comes.
    if (turn === helloTurn && !(outcome instanceof Error)) send('fairy:companion-say', outcome.text);
  }

  // explain: a drawn answer, telling the other Mac which parts of the last drawing are still showing here.
  // task: a Desktop task on this Mac's screen, from the companion's Task mode.
  async function ask(text: string, options: { explain?: boolean; task?: boolean } = {}): Promise<{ text: string }> {
    companionAsking++;
    try { return await askOnce(text, options); }
    finally {
      companionAsking--;
      // A task it turned into ends with it: Fairy's window comes back, and nothing of it is left running here.
      if (!companionAsking && desktopVia === 'turn') { for (const run of desktopRuns.values()) run.abort(); await desktopPresence('leave'); desktopVia = 'window'; }
    }
  }
  async function askOnce(text: string, { explain = false, task = false }: { explain?: boolean; task?: boolean } = {}): Promise<{ text: string }> {
    if (!client || client.state() !== 'connected') throw new Error(presence!.faceStatus(client?.state() ?? 'unpaired', store!.state().host));
    hush();
    // What you selected with ⌃⌥A, in the points of the display the picture will be of, so "this" means it there.
    const focus = explain ? quickAsk?.takeFocus(screen.getDisplayNearestPoint(screen.getCursorScreenPoint())) ?? null : null;
    const { turn } = await client.ask(text, explain ? { explain: true, drawn: ink?.showing ? [...ink.scene.parts.keys()] : [], ...(focus ? { focus } : {}) } : task ? { task: true } : {}) as { turn: string };
    voice = { turn, fetched: 0, want: 0, fetching: false };
    if (lateVoice?.turn === turn) void hear(lateVoice);
    lateVoice = null;
    if (outcomes.has(turn)) { const early = outcomes.get(turn)!; outcomes.delete(turn); if (early instanceof Error) throw early; return early; }
    return new Promise((resolve, reject) => waiters.set(turn, { resolve, reject }));
  }
  // Her voice for the latest turn: each clip fetched in order as the other Mac says it's ready, unless muted.
  async function hear(news: VoiceNotice): Promise<void> {
    if (news.turn !== voice.turn) { lateVoice = news; return; }
    voice.want = Math.max(voice.want, Number(news.parts) || 0);
    if (voice.fetching || store!.state().muted) return;
    const current = voice;
    current.fetching = true;
    try {
      while (voice === current && current.fetched < current.want && !store!.state().muted) {
        const index = current.fetched++;
        const clip = await client!.voicePart(current.turn!, index).catch(() => null);
        if (!clip || voice !== current) break;
        send('fairy:face-voice', { turn: current.turn, part: index, bytes: clip.bytes, pauseBeforeMs: clip.pauseBeforeMs });
      }
    } finally { current.fetching = false; }
  }
  // The other Mac asks for a picture of this screen during a turn asked from here. It gets one only with the switch on,
  // Screen Recording allowed and the screen unlocked; otherwise it's told no straight away.
  // One of her browser steps for a turn started in Fairy's window here, run in its pane, the answer sent back.
  async function answerBrowserStep({ id, tool, args }: { id?: unknown; tool?: unknown; args?: unknown } = {}): Promise<void> {
    if (typeof id !== 'string' || !faceWindow) return;
    const controller = new AbortController();
    browserRuns.set(id, controller);
    let answer: { id: string; result?: unknown; error?: string };
    try {
      if (!fullWin || fullWin.isDestroyed() || !faceBrowser) throw new Error('Fairy’s window on your MacBook isn’t open, so its browser can’t be used.');
      if (!faceWindow.acting()) throw new Error('Nothing asked from Fairy’s window on your MacBook is running, so its browser wasn’t used.');
      const { runBrowserStep } = await import('./remote-browser.mjs');
      const result = await runBrowserStep(faceBrowser, { tool: tool as string | undefined, args: args as Record<string, unknown> | undefined }, { signal: controller.signal,
        reveal: owner => { if (fullWin && !fullWin.isDestroyed()) fullWin.webContents.send('fairy:work', { type: 'browser-open', session: owner }); } });
      answer = { id, result: result ?? null };
    } catch (error: unknown) { answer = { id, error: String((error as Error)?.message || 'The browser step didn’t work.') }; }
    finally { browserRuns.delete(id); }
    if (!controller.signal.aborted) await faceWindow.answerBrowser(answer);
  }
  // One step of a Desktop task on this Mac's screen, for a turn started in Fairy's window here; the answer goes back.
  // A task the companion's question turned into needs no window; its answers go over the link itself, and only while
  // that question is waiting here.
  async function answerDesktopStep({ id, tool, args, via }: { id?: unknown; tool?: unknown; args?: unknown; via?: unknown } = {}): Promise<void> {
    const forCompanion = via === 'turn';
    if (typeof id !== 'string' || (!forCompanion && !faceWindow)) return;
    const controller = new AbortController();
    desktopRuns.set(id, controller);
    desktopVia = forCompanion ? 'turn' : 'window';
    let answer: { id: string; result?: unknown; error?: string };
    try {
      if (forCompanion && !companionAsking) throw new Error('Fairy on your MacBook isn’t waiting on a task.');
      if (!forCompanion && (!fullWin || fullWin.isDestroyed())) throw new Error('Fairy’s window on your MacBook isn’t open, so the task can’t use its screen.');
      if (!forCompanion && !faceWindow!.acting()) throw new Error('Nothing asked from Fairy’s window on your MacBook is running, so its screen wasn’t used.');
      if (faceLocked && tool !== 'presence') throw new Error('Your MacBook is locked, so the task can’t use its screen.');
      const { runDesktopStep } = await import('./remote-screen.mjs');
      const result = await runDesktopStep({ tool: tool as string | undefined, args: args as Record<string, unknown> | undefined }, desktopDeps(), { signal: controller.signal, last: desktopLast });
      answer = { id, result: result ?? null };
    } catch (error: unknown) { answer = { id, error: String((error as Error)?.message || 'That desktop step didn’t work.') }; }
    finally { desktopRuns.delete(id); }
    if (!controller.signal.aborted) await (forCompanion ? client?.desktopAnswer(answer) : faceWindow?.answerDesktop(answer));
  }
  // fairy-desktop on this Mac, as the other Mac runs its own: one process per call, JSON in, its answer out.
  function desktopHelper(payload: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(nativeBin('fairy-desktop'), [], { stdio: ['pipe', 'pipe', 'pipe'], signal });
      let out = '', err = '';
      const timeout = setTimeout(() => child.kill(), 15000);
      child.stdout.on('data', chunk => { out += chunk; });
      child.stderr.on('data', chunk => { err += chunk; });
      child.on('error', (error: NodeJS.ErrnoException) => { clearTimeout(timeout); reject(new Error(error.code === 'ENOENT' ? 'Fairy’s desktop helper is missing on this Mac.' : error.message)); });
      child.on('close', code => { clearTimeout(timeout); if (code !== 0) reject(new Error(err.trim() || 'The desktop helper stopped.')); else resolve(out.trim()); });
      child.stdin.on('error', () => {});
      child.stdin.end(JSON.stringify(payload));
    });
  }
  // Touch ID for allowing a batch of actions here, as for any step allowed from this Mac.
  async function touchId(reason: string): Promise<void> {
    if (!electronApp.isPackaged && process.env.FAIRY_TEST_SKIP_TOUCH_ID === '1') return;
    if (!systemPreferences.canPromptTouchID()) throw new Error('Allowing this needs Touch ID.');
    await systemPreferences.promptTouchID(reason);
  }
  const stopDesktopTask = (): void => { for (const run of desktopRuns.values()) run.abort(); void (desktopVia === 'turn' ? client?.stopTurn() : faceWindow?.call('stop'))?.catch(() => {}); };
  // Fairy stops being the app in front: fairy-desktop brings forward the app whose window is frontmost under hers, so
  // the task sees and works yours. Her companion stays where it is, showing the progress.
  // (Fairy can be the active app with none of her windows focused, so the helper decides.)
  async function stepAside(): Promise<void> {
    await desktopHelper({ yield: true }).catch((error: unknown) => console.warn('Couldn’t step aside:', (error as Error)?.message ?? error));
  }
  // While the task works, clicks go through the companion to what's under it; for a question, and after, she takes them.
  const companionClicks = (take: boolean): void => { if (!riding && win && !win.isDestroyed()) win.setIgnoreMouseEvents(!take, { forward: true }); };
  async function desktopPresence(state: string): Promise<void> {
    const here = (): boolean => Boolean(fullWin && !fullWin.isDestroyed());
    if (state === 'enter' && !desktopTask) {
      // Fairy's window steps aside so the task can see and use what's under it; her companion says what's happening.
      desktopTask = { wasShown: here() && fullWin!.isVisible() };
      if (here()) fullWin!.hide();
      try { globalShortcut.register('CommandOrControl+Shift+Escape', stopDesktopTask); } catch {}
      send('fairy:companion-progress', 'Working on this screen · ⌘⇧Esc stops');
      await stepAside(); companionClicks(false);
    } else if (state === 'review' && desktopTask) { companionClicks(true); electronApp.focus({ steal: true }); }
    else if (state === 'passive' && desktopTask) { await stepAside(); companionClicks(false); }
    else if (state === 'leave' && desktopTask) {
      const { wasShown } = desktopTask;
      desktopTask = null; desktopOkUntil = 0;
      try { globalShortcut.unregister('CommandOrControl+Shift+Escape'); } catch {}
      send('fairy:companion-progress', '');
      companionClicks(true);
      if (wasShown && here()) fullWin!.show();
    }
  }
  function desktopDeps(): DesktopStepDeps {
    return {
      helper: desktopHelper,
      check: async signal => {
        if (process.platform !== 'darwin') throw new Error('Desktop tasks need macOS.');
        if (!store!.state().screen) throw new Error(SCREEN_OFF);
        if (systemPreferences.getMediaAccessStatus('screen') !== 'granted') throw new Error('Fairy on your MacBook can’t see its screen. Allow her in System Settings → Privacy & Security → Screen & System Audio Recording there.');
        await desktopHelper({ check: true }, signal);
      },
      // The display Fairy's window is on, without any of her windows in the picture.
      // Only with Let Fairy see this screen on, as for any other picture of this screen.
      capture: async ({ fit, signal }) => {
        if (!store!.state().screen) throw new Error(SCREEN_OFF);
        const { ScreenHelper } = await import('./screen-helper.mjs'), { pictureSize } = await import('./remote-screen.mjs');
        screenHelper ??= new ScreenHelper({ path: nativeBin('fairy-screen') });
        // The display the window is on, or for a task from the companion, the companion's.
        const anchor = desktopVia !== 'turn' && fullWin && !fullWin.isDestroyed() ? fullWin : win && !win.isDestroyed() ? win : null;
        const display = anchor ? screen.getDisplayMatching(anchor.getBounds()) : screen.getPrimaryDisplay();
        const { width, height } = pictureSize(display, fit);
        const picture = await screenHelper.capture({ displayID: display.id, excludePID: process.pid, foregroundOnly: 0, width, height }, signal);
        if (!picture?.url) throw new Error('Fairy couldn’t take a picture of this screen.');
        return { url: picture.url, width: picture.width ?? width, height: picture.height ?? height, bounds: display.bounds };
      },
      apps: async () => { const apps = await import('./apps.mjs'); localApps ??= new apps.AppLauncher(); return localApps.catalog(); },
      // Touch ID alone: its sheet says what it allows, and the companion shows it too. Cancel stops the task.
      ask: async ({ summary }) => {
        const what = summary || 'use this Mac';
        send('fairy:companion-progress', `Touch ID to ${what}`);
        try { await touchId(what); desktopOkUntil = Date.now() + DESKTOP_OK_MS; return true; } catch { return false; }
      },
      // A batch of actions with no Touch ID on this Mac yet for this task: asked for here, in this Mac's own words.
      allowRun: async ({ count }) => {
        if (Date.now() < desktopOkUntil) return;
        const what = `let Fairy work on this Mac’s screen (${count === 1 ? 'an action' : `${count} actions`})`;
        send('fairy:companion-progress', `Touch ID to ${what}`);
        try { await touchId(what); } catch { throw new Error('That wasn’t allowed on your MacBook.'); }
        desktopOkUntil = Date.now() + DESKTOP_OK_MS;
      },
      presence: async state => desktopPresence(state),
    };
  }
  async function answerPicture({ id, purpose }: { id?: unknown; purpose?: unknown } = {}): Promise<void> {
    if (typeof id !== 'string' || !client) return;
    // A refusal says why (off, locked, busy, permission, failed), so the other Mac's message says what to do.
    const now = Date.now(), refuse = (reason: string) => client!.picture({ id, refused: true, reason }).catch(() => {});
    if (!store!.state().screen) return void refuse('off');
    if (faceLocked) return void refuse('locked');
    if (now - lastPictureAt < 500) return void refuse('busy');
    if (systemPreferences.getMediaAccessStatus('screen') !== 'granted') return void refuse('permission');
    lastPictureAt = now;
    try {
      const { ScreenHelper } = await import('./screen-helper.mjs');
      screenHelper ??= new ScreenHelper({ path: nativeBin('fairy-screen') });
      // The display you're looking at: the one the pointer is on.
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      pictureDisplay = display;
      const scale = Math.min(2, display.scaleFactor || 1), width = Math.round(Math.min(2048, display.size.width * scale)), height = Math.round(width * display.size.height / display.size.width);
      const picture = await screenHelper.capture({ displayID: display.id, excludePID: process.pid, foregroundOnly: 0, width, height });
      if (!picture?.url) return void refuse('failed');
      let read: unknown;
      if (purpose === 'explain') {
        const { readScreenText } = await import('./screen-ink.mjs');
        read = await readScreenText({ ...picture, bounds: display.bounds }, { pid: process.pid }).catch(() => undefined);
      }
      await client.picture({ id, png: picture.url.split(',')[1], width: picture.width, height: picture.height, bounds: display.bounds, ...(read ? { read } : {}) });
    } catch { return void refuse('failed'); }
  }
  async function companionTask(text: unknown): Promise<{ text: string }> {
    if (typeof text !== 'string' || !text.trim() || text.length > 12000) throw new Error('Describe the task in 1–12,000 characters.');
    if (process.platform !== 'darwin') throw new Error('Desktop tasks need macOS.');
    if (desktopTask) throw new Error('Fairy is already working on this screen.');
    return ask(text, { task: true });
  }
  function hush(): void { voice = { turn: null, fetched: 0, want: 0, fetching: false }; send('fairy:face-hush'); }

  // Allowing needs Touch ID, as the phone needs Face ID; denying needs neither.
  async function answer(id: unknown, decision: unknown): Promise<Record<string, unknown>> {
    if (decision !== 'allow' && decision !== 'deny') throw new Error('Unknown answer.');
    if (decision === 'deny') return client!.answer(String(id), 'deny');
    if (!systemPreferences.canPromptTouchID()) throw new Error('Allowing from this Mac needs Touch ID. Answer it on your other Mac or your iPhone.');
    await systemPreferences.promptTouchID('allow a step Fairy asked about');
    return client!.answer(String(id), 'allow', store!.approveKey());
  }

  function handlers(): void {
    fromPage('face-state', () => state());
    fromPage('face-pair', async pairLink => { await client!.pair(String(pairLink ?? ''), deviceName()); return state(); });
    fromPage('companion-cursor', () => { const point = screen.getCursorScreenPoint(), bounds = win!.getContentBounds(); return { x: point.x - bounds.x, y: point.y - bounds.y }; });
    // The buttons that belong to the full Fairy's window are hidden on a face's page, so there's nothing to mirror.
    fromPage('companion-mirror-request', () => sendMirror());
    // Of the full Fairy's buttons, a face works only Mute, its own; the others are hidden on its page.
    fromPage('companion-action', name => { if (name === 'floating-mute' || name === 'mute') return toggleMute(); if (name === 'floating-quiz-hints') return toggleQuiz(); if (name === 'floating-quiz-auto') return toggleQuizAuto(); });
    fromPage('companion-history', async () => (client?.state() === 'connected' ? client.history().catch(() => ({ name: 'Fairy', history: [] })) : { name: 'Fairy', history: [] }));
    // As on the full Fairy, a question that asks for a drawing, or one asked while a drawing is showing, is drawn.
    fromPage('companion-chat', async text => {
      // "Open Flux" or "open my notes app": an app on this Mac, opened here. A name no app has is looked up by what it is,
      // by the other Mac's model; when nothing fits, a Desktop task here finds it, as the companion's Task mode would.
      const apps = await import('./apps.mjs');
      localApps ??= new apps.AppLauncher();
      const pick = async (asked: string, cards: AppCard[]) => {
        const answer = connected() ? await client!.pickApp(asked, cards) : {};
        const byName = (name: unknown) => cards.find(card => card.name === name);
        return answer?.app && byName(answer.app) ? { app: byName(answer.app)! } : Array.isArray(answer?.choices) ? { choices: answer.choices.map(byName).filter((card): card is AppCard => Boolean(card)) } : null;
      };
      const asked = await localApps.resolve(text, { pick }).catch(() => null);
      if (asked && 'opened' in asked) return { text: `Opening ${asked.opened.name}.` };
      if (asked && 'choices' in asked && asked.choices.length >= 2) return { text: apps.whichOne(asked.choices, asked.name) };
      if (asked && 'missing' in asked) return process.platform === 'darwin' && !desktopTask ? companionTask(text) : { text: `I couldn’t find an app for “${asked.missing}” on this Mac.` };
      routing ??= await import('../src/chat-routing.js'); return ask(String(text ?? ''), { explain: process.platform === 'darwin' && (ink?.showing || routing.wantsSketch(String(text ?? ''))) }); });
    // The pen: the other Mac thinks it out from a picture of this screen, and the answer is drawn here (step 7).
    fromPage('companion-explain', text => ask(typeof text === 'string' && text.trim() ? text : 'Explain what I’m looking at.', { explain: true }));
    // Task mode: a Desktop task on this Mac's own screen, thought out by the other Mac (remote-screen.mjs).
    fromPage('companion-task', text => companionTask(text));
    // Stop with nothing running wipes the drawing, as on the full Fairy.
    fromPage('companion-stop', async () => { hush(); if (!waiters.size) ink?.clear(); await client?.stopTurn().catch(() => {}); });
    fromPage('companion-answer', (id, decision) => answer(id, decision));
    fromPage('companion-close', () => hide());
    fromPage('companion-fit', height => {
      if (!win || win.isDestroyed()) return;
      const next = Math.max(HEIGHT, Math.min(TALLEST, Math.round(Number(height) || HEIGHT))), now = win.getBounds();
      if (next !== now.height) win.setBounds({ x: now.x, y: now.y + now.height - next, width: now.width, height: next });
    });
    // The companion's see-through parts let clicks through to the windows behind it, unless she's riding along or hidden.
    fromPage('companion-passthrough', value => { if (riding || desktopTask || visibility?.hidden || !win || win.isDestroyed()) return; win.setIgnoreMouseEvents(value === true, { forward: true }); });
    // ↗ opens Fairy's own window here (Away 3); the chats window stays in the menu bar as the lighter one.
    fromPage('companion-open-window', () => openFullWindow());
    fromChats('face-chats-state', () => chatsState());
    fromChats('face-chats-watch', chat => watchChats(chat));
    fromChats('face-chats-list', async () => (await connected().get('/v1/chats')).chats ?? []);
    fromChats('face-chats-send', ({ chat, text }: { chat?: unknown; text?: unknown } = {}) => connected().post('/v1/send', { chat: typeof chat === 'string' && chat ? chat : null, text: String(text ?? '') }));
    fromChats('face-chats-stop', chat => connected().post('/v1/stop', { chat: String(chat ?? '') }));
    fromChats('face-chats-answer', (id, decision) => answer(id, decision));
    fromPage('companion-ride', on => setRide(on === true));
  }

  app.whenReady().then(async () => {
    app.dock?.hide();
    const { FaceStore } = await import('./face-store.mjs');
    presence = await import('./presence.mjs');
    store = new FaceStore({ path: join(app.getPath('userData'), 'face', 'face.json'),
      seal: text => safeStorage.encryptString(text).toString('base64'), unseal: text => safeStorage.decryptString(Buffer.from(text, 'base64')) });
    await store.load();
    const faceClientModule = await import('./face-client.mjs'), { FaceClient } = faceClientModule;
    eventParser = faceClientModule.eventParser;
    client = new FaceClient({ store, name: deviceName(), onEvent, onState: value => {
      link = value;
      // Away 5: Fairy's window here dims while the link is down, saying whether Tailscale is the reason, and catches up
      // when it's back.
      if (faceWindow) { if (link !== 'connected' && fullWin) void checkTailscale().catch(() => {}).then(() => faceWindow!.linkChanged(link)); else faceWindow.linkChanged(link); }
      if (link === 'connected') void startPresence(); else stopPresence();
      if (link === 'connected') scheduleClaudeSync();
      if (link === 'connected') void refreshVorssaintCalendar();
      if (link === 'connected') void refreshVorssaintUsage();
      sendChats('fairy:face-chats-state', chatsState());
      if (link === 'connected' && chatsWin && !chatsStream) watchChats(chatsFor);
      applyShown(); changed(); syncQuiz(); watchPath();
    } });
    link = client.state();
    handlers();
    let icon = nativeImage.createFromPath(beside('assets/tray/trayPairTemplate.png'));
    if (icon.isEmpty()) icon = nativeImage.createFromPath(beside('assets/tray/trayTemplate.png'));
    icon.setTemplateImage(true);
    tray = new Tray(icon);
    await makeWindow();
    changed();
    client.start();
    // Back from sleep or the lock screen: probe a quiet socket at once rather than waiting out a TCP timeout.
    for (const event of ['resume', 'unlock-screen'] as const) (powerMonitor as unknown as { on(e: string, fn: () => void): void }).on(event, () => { void client!.probeNow(); });
    powerMonitor.on('lock-screen', () => { faceLocked = true; report(); syncQuiz(); void faceWindow?.end(); });
    // Away 3: locking or sleeping ends the window's session; Touch ID opens the next one.
    powerMonitor.on('suspend', () => void faceWindow?.end());
    powerMonitor.on('unlock-screen', () => { faceLocked = false; report(); syncQuiz(); });
    await startQuickKeys();
    await setUpQuiz();
    // AudioPulse on this Mac looks for Fairy's socket where it always has; the face answers there.
    const { startFaceSockets, socketFolder } = await import('./face-sockets.mjs');
    const { formatVorssaintPrompt, createOpsHandler, compactRelayState, compactSweepState } = await import('./vorssaint-link.mjs');
    compactRelayStateRef = compactRelayState;
    compactSweepStateRef = compactSweepState;
    refreshVorssaintCalendar = async () => {
      try {
        if (!client || client.state() !== 'connected') return;
        const payload = await client.appRpc('vorssaint', 'calendarEvents', {});
        if (payload && typeof payload === 'object') {
          sockets?.vorssaint?.pushCalendarEvents(payload as { connected?: boolean; events?: unknown[]; updatedAt?: number });
        }
      } catch {}
    };
    const handleVorssaintOps = createOpsHandler({
      getRelay: () => localRelay(),
      getSweep: () => localSweep(),
      getLink: () => sockets?.vorssaint ?? null,
    });
    sockets = await startFaceSockets({ folder: socketFolder({ userData: app.getPath('userData') }), client, name: () => herName, log: message => console.warn(message),
      vorssaintBinaryPath: process.env.FAIRY_VORSSAINT_AUTOSTART === '0' ? null : (electronApp.isPackaged || process.env.FAIRY_VORSSAINT_AUTOSTART === '1' ? nativeBin('baryon-vorssaint') : null),
      vorssaintLockPath: join(app.getPath('userData'), 'face', 'vorssaint.lock'),
      voice: { play: clip => send('fairy:face-voice', clip), hush, muted: () => store!.state().muted },
      onVorssaintDecision: async ({ id, decision }) => {
        if (decision === 'inspect') { void openFullWindow(); return; }
        if (id && (decision === 'allow' || decision === 'deny')) await answer(id, decision);
      },
      onVorssaintUndock: (event: VorssaintUndockEvent) => vorssaintHandoff.handleUndock(event),
      onVorssaintQuickAction: ({ action }: { action: string }) => {
        if (action === 'area') void quickAsk?.askArea();
        else if (action === 'box') quickAsk?.openBox();
        else if (action === 'quiz') toggleQuiz();
        else if (action === 'talk') {
          if (win && !win.isDestroyed()) {
            if (visibility?.hidden) {
              userHidden = false;
              visibility.restore({ opacity: 1 });
              win.showInactive();
              changed();
              sockets?.vorssaint?.sendUndockAck?.();
            }
            send('fairy:quick-ask', { text: 'Explain what I’m looking at.', mode: 'explain' });
          }
        }
      },
      onVorssaintContextAction: async ({ action, text, files, imagePath, source }: VorssaintContextActionEvent) => {
        if (action === 'openChat') {
          void openFullWindow();
          if (text) sockets?.vorssaint?.pushToast({ title: 'Opened in Baryon', detail: text.slice(0, 120), accent: 'blue' });
          return;
        }
        if (action === 'attach') void openFullWindow();
        const promptMap: Record<string, string> = {
          notebook: formatVorssaintPrompt(text ? `Add this to my Notebook and summarize the key points:\n${text}` : 'Add these files to my Notebook.', { files, source }),
          goal: formatVorssaintPrompt(text ? `Turn this into a clear, actionable Goal:\n${text}` : 'Turn these files into an actionable Goal.', { files, source }),
          attach: formatVorssaintPrompt(text ? `Keep this attached for context and summarize briefly:\n${text}` : 'Keep these attached files in context and summarize them.', { files, source }),
          memory: formatVorssaintPrompt(text ? `Save this to Memory concisely:\n${text}` : 'Save this to Memory.', { source }),
          flashcard: formatVorssaintPrompt(text ? `Create a concise Q&A flashcard from this:\n${text}` : 'Create a concise Q&A flashcard.', { source }),
          screenshot: formatVorssaintPrompt('Analyze this captured screenshot and help me with what it shows.', { files, imagePath, ocrText: text, source }),
          ask: formatVorssaintPrompt(text || 'Inspect these items and help me with them.', { files, imagePath, source }),
        };
        const titleMap: Record<string, string> = {
          notebook: 'Added to Notebook',
          goal: 'Goal Created',
          attach: 'Attached to Chat',
          memory: 'Saved to Memory',
          flashcard: 'Flashcard Created',
          screenshot: 'Fairy Screenshot Insight',
          ask: 'Fairy',
        };
        const prompt = promptMap[action];
        if (!prompt) return;
        try {
          const reply = await client!.appAsk('vorssaint', { text: prompt, context: { section: source || action } });
          const detail = String(reply || '').replace(/\s+/g, ' ').trim().slice(0, 140) || 'Done.';
          sockets?.vorssaint?.pushToast({ title: titleMap[action] || 'Fairy', detail, accent: 'blue', durationMs: 6500 });
        } catch (err: unknown) {
          sockets?.vorssaint?.pushToast({ title: 'Fairy', detail: String((err as Error)?.message || err), accent: 'orange', durationMs: 5000 });
        }
      },
      onVorssaintOps: payload => handleVorssaintOps(payload),
      onVorssaintCalendarRequest: () => { void refreshVorssaintCalendar(); },
      onVorssaintAlert: (alert: VorssaintAlertEvent) => {
        sockets?.vorssaint?.pushToast({
          title: alert.title || 'System Alert',
          detail: alert.detail || 'Sustained resource load detected.',
          accent: 'orange',
          durationMs: 6500,
        });
      },
      onVorssaintFeaturesState: (state: VorssaintFeaturesStatePayload & { connected: boolean }) => {
        if (fullWin && !fullWin.isDestroyed()) {
          fullWin.webContents.send('fairy:vorssaint-features', {
            ...state,
            helperBundled: existsSync(nativeBin('baryon-vorssaint')),
            role: 'face',
          });
        }
      } })
      .catch((error: unknown) => { console.warn('Couldn’t open the sockets for your other apps:', (error as Error)?.message ?? error); return null; });
    refreshVorssaintUsage = async () => {
      try {
        if (!client || client.state() !== 'connected') return;
        const summary = await client.appRpc('vorssaint', 'usage', {});
        if (summary && typeof summary === 'object') {
          sockets?.vorssaint?.pushUsage(summary as Record<string, unknown>);
        }
      } catch {}
    };
    if (link === 'connected') {
      void refreshVorssaintCalendar();
      void refreshVorssaintUsage();
    }
    vorssaintCalendarTimer = setInterval(() => { if (link === 'connected') void refreshVorssaintCalendar(); }, 10 * 60_000);
    vorssaintUsageTimer = setInterval(() => { if (link === 'connected') void refreshVorssaintUsage(); }, 5 * 60_000);
    app.on('will-quit', () => sockets?.close());
    app.on('will-quit', () => { if (claudeTimer) clearTimeout(claudeTimer); });
  }).catch((error: unknown) => { console.error('Fairy couldn’t start as a face:', error); app.quit(); });
}

module.exports = { start };
