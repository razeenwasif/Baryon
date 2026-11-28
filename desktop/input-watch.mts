const ANSWER_LIMIT = 3000, INPUT_LIMIT = 3000, BUSY_LIMIT = 60000, BUSY_CHECK = 2000, RELOAD_GAP = 120000, SETTLE = 1000, MOVE_LIMIT = 1500, MOVE_GAP = 100;
// When to try input after leaving floating mode, in milliseconds.
const AFTER_SWITCH = [500, 5000, 15000, 30000, 60000];
const READ_DRAFT = `[document.querySelector('#message')?.value || '', document.querySelector('#floating-message')?.value || '']`;
const restoreDraft = ([main, floating]: [string, string]): string => `for (const [id, text] of ${JSON.stringify([['#message', main], ['#floating-message', floating]])}) { const box = document.querySelector(id); if (box && text && !box.value) { box.value = text; box.dispatchEvent(new Event('input', { bubbles: true })); } }`;
const hearMove = (limit: number): string => `new Promise(done => { const heard = () => { clearTimeout(timer); done(true); }, timer = setTimeout(() => { removeEventListener('mousemove', heard, true); done(false); }, ${limit}); addEventListener('mousemove', heard, { capture: true, once: true }); })`;
const pause = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
const settled = (work: Promise<unknown>, limit: number): Promise<'answered' | 'failed' | 'silent'> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work.then((): 'answered' => 'answered', (): 'failed' => 'failed'),
    new Promise<'silent'>(resolve => { timer = setTimeout(() => resolve('silent'), limit); }),
  ]).finally(() => clearTimeout(timer));
};

export interface InputWatchPoint {
  x: number;
  y: number;
}

export interface InputWatchLimits {
  answer: number;
  input: number;
  busy: number;
  busyCheck: number;
  gap: number;
  settle: number;
  move: number;
  moveGap: number;
  afterSwitch: number[];
}

export interface InputWatchWebContents {
  on: (event: 'unresponsive', listener: () => void) => unknown;
  once: (event: 'did-finish-load', listener: () => void) => unknown;
  isDestroyed: () => boolean;
  executeJavaScript: <T = unknown>(code: string) => Promise<T>;
  sendInputEvent: (event: { type: 'mouseMove'; x: number; y: number }) => void;
  reload: () => void;
  debugger: {
    isAttached: () => boolean;
    attach: (protocolVersion?: string) => void;
    detach: () => void;
    sendCommand: (method: string, commandParams?: Record<string, unknown>) => Promise<unknown>;
  };
}

export interface InputWatchOptions {
  contents: InputWatchWebContents;
  isBusy?: () => boolean;
  pointer?: () => InputWatchPoint | null;
  log?: (entry: Record<string, unknown>) => void;
  notify?: (message: string) => void;
  limits?: Partial<InputWatchLimits>;
  now?: () => number;
}

// Chromium's input channel to a page can stall while the page keeps running and drawing, so every click
// and key is lost until the page reloads. Chromium reports this as unresponsive, as it does for a page that's
// just busy, so this checks the page answers while input doesn't before doing anything.
export class InputWatch {
  contents: InputWatchWebContents;
  isBusy: () => boolean;
  pointer: () => InputWatchPoint | null;
  log: (entry: Record<string, unknown>) => void;
  notify: (message: string) => void;
  now: () => number;
  limits: InputWatchLimits;
  checking: boolean;
  reloadedAt: number;
  switches: number;

  constructor({ contents, isBusy = () => false, pointer = () => null, log = () => {}, notify = () => {}, limits = {}, now = Date.now }: InputWatchOptions) {
    this.contents = contents;
    this.isBusy = isBusy;
    this.pointer = pointer;
    this.log = log;
    this.notify = notify;
    this.now = now;
    this.limits = { answer: ANSWER_LIMIT, input: INPUT_LIMIT, busy: BUSY_LIMIT, busyCheck: BUSY_CHECK, gap: RELOAD_GAP, settle: SETTLE, move: MOVE_LIMIT, moveGap: MOVE_GAP, afterSwitch: AFTER_SWITCH, ...limits };
    this.checking = false;
    this.reloadedAt = -Infinity;
    this.switches = 0;
  }

  start(): this { this.contents.on('unresponsive', () => void this.check().catch(error => console.warn('Could not check the window’s input:', error instanceof Error ? error.message : String(error)))); return this; }

  // A mouse move to where the pointer already is tries input with no debugger and nothing changing on screen.
  // 'heard', 'silent', or 'unknown' when the pointer isn't over the window or the page is too busy to say.
  async moveHeard(point = this.pointer()): Promise<'heard' | 'silent' | 'unknown'> {
    const { contents, limits } = this;
    if (!point || contents.isDestroyed()) return 'unknown';
    let result: 'heard' | 'silent' | 'unknown' | null = null;
    contents.executeJavaScript<boolean>(hearMove(limits.move)).then(heard => { result = heard ? 'heard' : 'silent'; }, () => { result = 'unknown'; });
    // The first move can overtake the listener, so they keep going until one is heard.
    for (let sent = 0; result === null && sent * limits.moveGap < limits.move + limits.answer && !contents.isDestroyed(); sent += 1) {
      contents.sendInputEvent({ type: 'mouseMove', x: point.x + sent % 2, y: point.y });
      await pause(limits.moveGap);
    }
    return result ?? 'unknown';
  }

  // Whether input was already dead shows if floating mode or the switch itself is to blame.
  beforeLeavingFloating(): void {
    void this.moveHeard(this.pointer() ?? { x: 1, y: 1 }).then(answer => { if (answer === 'silent') this.log({ event: 'input-silent-before-switch' }); }).catch(() => {});
  }

  // Freezes often begin soon after leaving floating mode. Trying input then catches one in seconds,
  // rather than after a click is lost and Chromium has waited 15 seconds to report it.
  switched(floating: boolean): void {
    const serial = ++this.switches, started = this.now();
    if (floating) return;
    void (async () => {
      let waited = 0;
      for (const at of this.limits.afterSwitch) {
        await pause(at - waited); waited = at;
        if (serial !== this.switches) return;
        if (this.checking || await this.moveHeard() !== 'silent' || serial !== this.switches) continue;
        this.log({ event: 'input-silent', afterSwitchMs: this.now() - started });
        await this.check();
      }
    })().catch(error => console.warn('Could not check the window’s input:', error instanceof Error ? error.message : String(error)));
  }

  // 'answered', 'silent', or 'unknown' when it can't be tried, such as with DevTools open.
  async inputAnswers(): Promise<'answered' | 'silent' | 'unknown'> {
    const tool = this.contents.debugger, wasAttached = tool.isAttached();
    try { if (!wasAttached) tool.attach('1.3'); } catch { return 'unknown'; }
    try {
      const answer = await settled(tool.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 }), this.limits.input);
      return answer === 'failed' ? 'unknown' : answer;
    } finally { if (!wasAttached) { try { tool.detach(); } catch {} } }
  }

  async check(): Promise<void> {
    if (this.checking || this.contents.isDestroyed()) return;
    this.checking = true;
    try {
      if (await settled(this.contents.executeJavaScript('1'), this.limits.answer) !== 'answered') return;
      if (await this.inputAnswers() !== 'silent') return;
      this.log({ event: 'input-lost' });
      if (this.now() - this.reloadedAt < this.limits.gap) { this.log({ event: 'input-lost-again' }); return; }
      for (let waited = 0; this.isBusy() && waited < this.limits.busy; waited += this.limits.busyCheck) await pause(this.limits.busyCheck);
      await this.recover('Fairy’s window stopped taking clicks and keys, so it reloaded. Your chats are safe.');
    } finally { this.checking = false; }
  }

  // A reload gives the page a new channel. What you were typing comes with it.
  async recover(message = ''): Promise<void> {
    const { contents } = this;
    if (contents.isDestroyed()) return;
    const draft = await Promise.race([contents.executeJavaScript<[string, string]>(READ_DRAFT).catch(() => null), pause(this.limits.answer).then(() => null)]);
    this.reloadedAt = this.now();
    const loaded = new Promise<void>(resolve => contents.once('did-finish-load', () => resolve()));
    contents.reload();
    await Promise.race([loaded, pause(30000)]);
    await pause(this.limits.settle);
    if (contents.isDestroyed()) return;
    if (draft) await contents.executeJavaScript(restoreDraft(draft)).catch(() => {});
    this.log({ event: 'input-recovered' });
    if (message) this.notify(message);
  }
}
