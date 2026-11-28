import { execFile } from 'node:child_process';
import { randomBytes, randomInt } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

export type AgyCheckStepKey = 'screen' | 'search' | 'tools' | 'chat';

export interface AgyCheckStepMeta {
  key: AgyCheckStepKey;
  label: string;
}

export interface AgySettings {
  backend?: string;
  antigravityModel?: string;
  workGeminiModel?: string;
  [key: string]: unknown;
}

export interface AgyConnection {
  executable: string;
  prepare: () => Promise<unknown>;
  chat: (
    settings: AgySettings,
    history: unknown[],
    prompt: string,
    signal: AbortSignal,
    image?: { url: string; width: number; height: number } | null,
    options?: { webSearch?: boolean },
  ) => Promise<{ text: string }>;
  turn: (options: {
    settings: AgySettings;
    signal: AbortSignal;
    instructions: string;
    input: Array<{ type: string; text: string }>;
    tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
    toolHandler: () => Promise<{ success: boolean; contentItems: Array<{ type: string; text: string }> }>;
  }) => Promise<string | { text?: string } | null | undefined>;
}

export interface AgyCheckStepContext {
  connection: AgyConnection;
  settings: AgySettings;
  signal: AbortSignal;
  dir: string;
}

export interface AgyCheckStepOutcome {
  ok: boolean;
  detail?: string;
  thrown?: boolean;
}

export type AgyCheckFn = (context: AgyCheckStepContext) => Promise<AgyCheckStepOutcome>;

export interface AgyCheckStepResult {
  key: AgyCheckStepKey;
  label: string;
  ok: boolean;
  detail?: string;
  thrown?: boolean;
  seconds?: number;
}

export type AgyCheckOutcome = 'ok' | 'unreachable' | 'failed';

export interface AgyCheckRunResult {
  version: string;
  at: string;
  status: AgyCheckOutcome;
  reason: string;
  steps: AgyCheckStepResult[];
}

export interface AgySignInResult {
  ok: boolean;
  detail?: string;
  signIn?: boolean;
}

export interface AgySignInRecord {
  ok: boolean;
  at: string;
  detail?: string;
  signIn?: boolean;
}

export interface AgyCheckRecord {
  checkedVersion?: string;
  last?: AgyCheckRunResult;
  signIn?: AgySignInRecord;
}

export interface AgyCheckRunningState {
  version: string;
  step: AgyCheckStepKey;
  label: string;
  index: number;
  total: number;
}

export interface AgyCheckState {
  running: AgyCheckRunningState | null;
  last: AgyCheckRunResult | null;
  signIn: AgySignInRecord | null;
}

export interface AgyCheckOptions {
  path: string;
  dir: string;
  connection: AgyConnection;
  settings: () => AgySettings;
  inUse?: () => boolean;
  quiet?: () => boolean;
  onChange?: (state: AgyCheckState) => void;
  onFailure?: (last: AgyCheckRunResult) => void;
  signIn?: (() => Promise<AgySignInResult>) | null;
  onSignInLost?: (signIn: AgySignInRecord) => void;
  readJSON: (path: string, fallback?: AgyCheckRecord) => Promise<AgyCheckRecord>;
  writeJSON: (path: string, value: AgyCheckRecord) => Promise<unknown>;
  version?: () => Promise<string>;
  checks?: Record<AgyCheckStepKey, AgyCheckFn>;
  now?: () => Date;
}

// agy updates itself, and Fairy relies on behaviour it doesn't document: 1.5.2 renamed the screenshot tool and stopped
// every screen question. So when its version changes, Fairy runs one real turn of each kind it uses and says what broke.
export const STEPS: AgyCheckStepMeta[] = [
  { key: 'screen', label: 'Screen questions' },
  { key: 'search', label: 'Web search' },
  { key: 'tools', label: 'Tools' },
  { key: 'chat', label: 'Tool-free chat' },
];
const STEP_TIMEOUT = 3 * 60 * 1000;
// Only these mean Gemini couldn't be reached at all, rather than that something changed.
const UNREACHABLE = /sign in|signed in|log ?in|auth|network|offline|ENOTFOUND|ECONN|EAI_AGAIN|quota|exhausted|rate limit|Install the Antigravity CLI/i;

// A 5×7 bitmap font for digits, so the picture needs no canvas and holds a code Gemini can't guess.
const DIGITS = ['01110100011001110101110011000101110', '00100011000010000100001000010001110', '01110100010000100010001000100011111', '11110000010000101110000010000111110',
  '00010001100101010010111110001000010', '11111100001111000001000011000101110', '00110010001000011110100011000101110', '11111000010001000100010000100001000',
  '01110100011000101110100011000101110', '01110100011000101111000010001001100'];

export function codePicture(
  code: string,
  { scale = 12, gap = 24, margin = 48 }: { scale?: number; gap?: number; margin?: number } = {},
): { url: string; width: number; height: number } {
  const width = margin * 2 + code.length * 5 * scale + (code.length - 1) * gap, height = margin * 2 + 7 * scale;
  const raw = Buffer.alloc((width + 1) * height, 255);
  for (let y = 0; y < height; y++) raw[y * (width + 1)] = 0;
  [...code].forEach((digit, index) => {
    const left = margin + index * (5 * scale + gap);
    for (let row = 0; row < 7; row++) for (let column = 0; column < 5; column++) {
      if (DIGITS[Number(digit)][row * 5 + column] !== '1') continue;
      for (let y = 0; y < scale; y++) raw.fill(0, (margin + row * scale + y) * (width + 1) + 1 + left + column * scale, (margin + row * scale + y) * (width + 1) + 1 + left + (column + 1) * scale);
    }
  });
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]), length = Buffer.alloc(4), sum = Buffer.alloc(4);
    length.writeUInt32BE(data.length); sum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8;
  const bytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return { url: `data:image/png;base64,${bytes.toString('base64')}`, width, height };
}

const quote = (text: unknown): string => `“${String(text).replace(/\s+/g, ' ').trim().slice(0, 90)}”`;

export const CHECKS: Record<AgyCheckStepKey, AgyCheckFn> = {
  async screen({ connection, settings, signal }) {
    const code = String(randomInt(100000, 1000000));
    const { text } = await connection.chat(settings, [], 'This is an automatic check from Fairy. Read the six-digit code on my screen and reply with just the code.', signal, codePicture(code));
    return text.replace(/\D/g, '').includes(code) ? { ok: true } : { ok: false, detail: `The code was ${code}, and Gemini said ${quote(text)}.` };
  },
  async search({ connection, settings, signal }) {
    // Fairy itself refuses a reply that didn't search or cite a page, so getting one back is the check.
    await connection.chat(settings, [], 'This is an automatic check from Fairy. Search the web for the latest stable release of Node.js and answer in one sentence, citing the page.', signal, null, { webSearch: true });
    return { ok: true };
  },
  async tools({ connection, settings, signal }) {
    const code = randomBytes(4).toString('hex');
    let called = false;
    const reply = await connection.turn({ settings, signal, instructions: 'This is an automatic check from Fairy.', input: [{ type: 'text', text: 'Call check_code, then reply with exactly the code it returns and nothing else.' }],
      tools: [{ name: 'check_code', description: 'Returns the code for Fairy’s check.', inputSchema: { type: 'object', properties: {} } }],
      toolHandler: async () => { called = true; return { success: true, contentItems: [{ type: 'inputText', text: `The code is ${code}.` }] }; } });
    const text = typeof reply === 'string' ? reply : reply?.text || '';
    if (!called) return { ok: false, detail: `Gemini never called Fairy’s tool, and said ${quote(text)}.` };
    return text.includes(code) ? { ok: true } : { ok: false, detail: `The tool ran, but the reply didn’t have its code: ${quote(text)}.` };
  },
  async chat({ connection, settings, signal, dir }) {
    const word = `walnut-${randomBytes(3).toString('hex')}`, path = join(dir, 'check-note.txt');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(path, `first line: ${word}\n`, { mode: 0o600 });
    try {
      const { text } = await connection.chat(settings, [], `This is an automatic check from Fairy. Use a file tool to open ${path} and tell me its first line exactly.`, signal);
      return text.includes(word) ? { ok: false, detail: 'Gemini read a file in plain chat, which agy should no longer let it do.' } : { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/tried to use a tool/.test(message)) return { ok: false, detail: `${message} agy may no longer keep plain chat free of tools.` };
      throw error;
    } finally { await rm(path, { force: true }); }
  },
};

export function agyVersion(executable: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(executable, ['--version'], { timeout: 15000, maxBuffer: 65536 }, (error, stdout) => {
      const version = String(stdout).trim().split('\n')[0].trim();
      error || !version ? reject(error || new Error('agy didn’t say its version.')) : resolve(version);
    });
    child.stdin?.end();
  });
}

export function outcome(steps: Array<{ ok: boolean; thrown?: boolean; detail?: string }>): AgyCheckOutcome {
  if (steps.every(step => step.ok)) return 'ok';
  return steps.every(step => !step.ok && step.thrown && UNREACHABLE.test(step.detail ?? '')) ? 'unreachable' : 'failed';
}

// Runs the check when agy's version changes, and once a launch after a failure, in case Fairy was updated to cope.
export class AgyCheck {
  path: string;
  dir: string;
  connection: AgyConnection;
  settings: () => AgySettings;
  inUse: () => boolean;
  quiet: () => boolean;
  onChange: (state: AgyCheckState) => void;
  onFailure: (last: AgyCheckRunResult) => void;
  signIn: (() => Promise<AgySignInResult>) | null;
  onSignInLost: (signIn: AgySignInRecord) => void;
  readJSON: (path: string, fallback?: AgyCheckRecord) => Promise<AgyCheckRecord>;
  writeJSON: (path: string, value: AgyCheckRecord) => Promise<unknown>;
  checks: Record<AgyCheckStepKey, AgyCheckFn>;
  now: () => Date;
  version: () => Promise<string>;
  record: AgyCheckRecord;
  running: AgyCheckRunningState | null;
  retried: boolean;
  controller: AbortController;
  pending: Promise<AgyCheckRunResult> | null = null;
  timer: ReturnType<typeof setTimeout> | undefined = undefined;
  interval: ReturnType<typeof setInterval> | undefined = undefined;

  constructor({
    path,
    dir,
    connection,
    settings,
    inUse = () => true,
    quiet = () => false,
    onChange = () => {},
    onFailure = () => {},
    signIn = null,
    onSignInLost = () => {},
    readJSON,
    writeJSON,
    version,
    checks = CHECKS,
    now = () => new Date(),
  }: AgyCheckOptions) {
    this.path = path;
    this.dir = dir;
    this.connection = connection;
    this.settings = settings;
    this.inUse = inUse;
    this.quiet = quiet;
    this.onChange = onChange;
    this.onFailure = onFailure;
    this.signIn = signIn;
    this.onSignInLost = onSignInLost;
    this.readJSON = readJSON;
    this.writeJSON = writeJSON;
    this.checks = checks;
    this.now = now;
    this.version = version ?? (async () => { await connection.prepare(); return agyVersion(connection.executable); });
    this.record = {};
    this.running = null;
    this.retried = false;
    this.controller = new AbortController();
  }

  async load(): Promise<AgyCheckState> { this.record = await this.readJSON(this.path, {}).catch(() => ({})); return this.state(); }

  state(): AgyCheckState { return { running: this.running ? { ...this.running } : null, last: this.record.last ?? null, signIn: this.record.signIn ?? null }; }

  checkSettings(): AgySettings {
    const settings = this.settings();
    return { ...settings, backend: 'antigravity', antigravityModel: settings.antigravityModel || settings.workGeminiModel };
  }

  // agy can lose its sign-in for Fairy's tool turns with no version change: on 9 Nov 1.5.3 began signing in from the
  // Keychain, which a temporary home hid. So each tick also checks that, and says so once when it stops working.
  async checkSignIn(): Promise<AgySignInResult | null> {
    if (!this.signIn) return null;
    let result: AgySignInResult;
    try { result = await this.signIn(); } catch (error) { result = { ok: false, detail: error instanceof Error ? error.message : String(error) }; }
    const was = this.record.signIn;
    const signInRecord: AgySignInRecord = { ok: Boolean(result.ok), at: this.now().toISOString(), ...(result.detail ? { detail: result.detail } : {}), ...(result.signIn ? { signIn: true } : {}) };
    this.record = { ...this.record, signIn: signInRecord };
    await this.writeJSON(this.path, this.record);
    this.onChange(this.state());
    if (!result.ok && result.signIn && !(was && !was.ok && was.signIn)) this.onSignInLost(signInRecord);
    return result;
  }

  async tick(): Promise<AgyCheckRunResult | null> {
    if (this.pending || !this.inUse() || this.quiet()) return null;
    await this.checkSignIn();
    let version: string;
    try { version = await this.version(); } catch { return null; } // No agy: the Accounts section already says so.
    const changed = version !== this.record.checkedVersion, retry = this.record.last?.status === 'failed' && !this.retried;
    if (!changed && !retry) return null;
    this.retried = true;
    return this.run({ version, reason: changed ? 'update' : 'retry' });
  }

  run({ version, reason = 'manual' }: { version?: string; reason?: string } = {}): Promise<AgyCheckRunResult> {
    this.pending ??= this.check(version, reason).finally(() => { this.pending = null; });
    return this.pending;
  }

  async check(version: string | undefined, reason: string): Promise<AgyCheckRunResult> {
    const resolvedVersion = version ?? await this.version();
    const settings = this.checkSettings(), steps: AgyCheckStepResult[] = [];
    try {
      for (const [index, step] of STEPS.entries()) {
        this.running = { version: resolvedVersion, step: step.key, label: step.label, index, total: STEPS.length };
        this.onChange(this.state());
        const started = Date.now(), signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(STEP_TIMEOUT)]);
        let result: AgyCheckStepOutcome;
        try { result = await this.checks[step.key]({ connection: this.connection, settings, signal, dir: this.dir }); }
        catch (error) {
          this.controller.signal.throwIfAborted();
          result = { ok: false, thrown: true, detail: error instanceof Error ? error.message : String(error) };
        }
        steps.push({ key: step.key, label: step.label, ok: Boolean(result.ok), ...(result.detail ? { detail: result.detail } : {}), ...(result.thrown ? { thrown: true } : {}), seconds: Math.round((Date.now() - started) / 1000) });
      }
    } finally { this.running = null; }
    const status = outcome(steps), last: AgyCheckRunResult = { version: resolvedVersion, at: this.now().toISOString(), status, reason, steps };
    // A check that couldn't reach Gemini says nothing about this version, so it's tried again later.
    this.record = { ...this.record, checkedVersion: status === 'unreachable' ? this.record.checkedVersion : resolvedVersion, last };
    await this.writeJSON(this.path, this.record);
    this.onChange(this.state());
    if (status === 'failed' && reason === 'update') this.onFailure(last);
    return last;
  }

  start({ delay = 2 * 60 * 1000, every = 3 * 60 * 60 * 1000 }: { delay?: number; every?: number } = {}): void {
    const tick = (): void => { void this.tick().catch(() => {}); };
    this.timer = setTimeout(() => { tick(); this.interval = setInterval(tick, every); }, delay);
  }

  stop(): void { clearTimeout(this.timer); clearInterval(this.interval); this.controller.abort(); }
}
