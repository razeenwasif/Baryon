import { execFile } from 'node:child_process';
import { randomBytes, randomInt } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

// agy updates itself, and Fairy relies on behaviour it doesn't document: 1.5.2 renamed the screenshot tool and stopped
// every screen question. So when its version changes, Fairy runs one real turn of each kind it uses and says what broke.
export const STEPS = [
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
export function codePicture(code, { scale = 12, gap = 24, margin = 48 } = {}) {
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
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]), length = Buffer.alloc(4), sum = Buffer.alloc(4);
    length.writeUInt32BE(data.length); sum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8;
  const bytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return { url: `data:image/png;base64,${bytes.toString('base64')}`, width, height };
}

const quote = text => `“${String(text).replace(/\s+/g, ' ').trim().slice(0, 90)}”`;
export const CHECKS = {
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
      if (/tried to use a tool/.test(error.message)) return { ok: false, detail: `${error.message} agy may no longer keep plain chat free of tools.` };
      throw error;
    } finally { await rm(path, { force: true }); }
  },
};

export function agyVersion(executable) {
  return new Promise((resolve, reject) => {
    const child = execFile(executable, ['--version'], { timeout: 15000, maxBuffer: 65536 }, (error, stdout) => {
      const version = String(stdout).trim().split('\n')[0].trim();
      error || !version ? reject(error || new Error('agy didn’t say its version.')) : resolve(version);
    });
    child.stdin?.end();
  });
}

export function outcome(steps) {
  if (steps.every(step => step.ok)) return 'ok';
  return steps.every(step => !step.ok && step.thrown && UNREACHABLE.test(step.detail)) ? 'unreachable' : 'failed';
}

// Runs the check when agy's version changes, and once a launch after a failure, in case Fairy was updated to cope.
export class AgyCheck {
  constructor({ path, dir, connection, settings, inUse = () => true, quiet = () => false, onChange = () => {}, onFailure = () => {}, signIn = null, onSignInLost = () => {}, readJSON, writeJSON, version, checks = CHECKS, now = () => new Date() }) {
    Object.assign(this, { path, dir, connection, settings, inUse, quiet, onChange, onFailure, signIn, onSignInLost, readJSON, writeJSON, checks, now });
    this.version = version ?? (async () => { await connection.prepare(); return agyVersion(connection.executable); });
    this.record = {}; this.running = null; this.retried = false; this.controller = new AbortController();
  }
  async load() { this.record = await this.readJSON(this.path, {}).catch(() => ({})); return this.state(); }
  state() { return { running: this.running ? { ...this.running } : null, last: this.record.last ?? null, signIn: this.record.signIn ?? null }; }
  checkSettings() {
    const settings = this.settings();
    return { ...settings, backend: 'antigravity', antigravityModel: settings.antigravityModel || settings.workGeminiModel };
  }
  // agy can lose its sign-in for Fairy's tool turns with no version change: on 9 Nov 1.5.3 began signing in from the
  // Keychain, which a temporary home hid. So each tick also checks that, and says so once when it stops working.
  async checkSignIn() {
    if (!this.signIn) return null;
    let result;
    try { result = await this.signIn(); } catch (error) { result = { ok: false, detail: error.message }; }
    const was = this.record.signIn;
    this.record = { ...this.record, signIn: { ok: Boolean(result.ok), at: this.now().toISOString(), ...(result.detail ? { detail: result.detail } : {}), ...(result.signIn ? { signIn: true } : {}) } };
    await this.writeJSON(this.path, this.record);
    this.onChange(this.state());
    if (!result.ok && result.signIn && !(was && !was.ok && was.signIn)) this.onSignInLost(this.record.signIn);
    return result;
  }
  async tick() {
    if (this.pending || !this.inUse() || this.quiet()) return null;
    await this.checkSignIn();
    let version;
    try { version = await this.version(); } catch { return null; } // No agy: the Accounts section already says so.
    const changed = version !== this.record.checkedVersion, retry = this.record.last?.status === 'failed' && !this.retried;
    if (!changed && !retry) return null;
    this.retried = true;
    return this.run({ version, reason: changed ? 'update' : 'retry' });
  }
  run({ version, reason = 'manual' } = {}) {
    this.pending ??= this.check(version, reason).finally(() => { this.pending = null; });
    return this.pending;
  }
  async check(version, reason) {
    version ??= await this.version();
    const settings = this.checkSettings(), steps = [];
    try {
      for (const [index, step] of STEPS.entries()) {
        this.running = { version, step: step.key, label: step.label, index, total: STEPS.length };
        this.onChange(this.state());
        const started = Date.now(), signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(STEP_TIMEOUT)]);
        let result;
        try { result = await this.checks[step.key]({ connection: this.connection, settings, signal, dir: this.dir }); }
        catch (error) { this.controller.signal.throwIfAborted(); result = { ok: false, thrown: true, detail: error.message }; }
        steps.push({ key: step.key, label: step.label, ok: Boolean(result.ok), ...(result.detail ? { detail: result.detail } : {}), ...(result.thrown ? { thrown: true } : {}), seconds: Math.round((Date.now() - started) / 1000) });
      }
    } finally { this.running = null; }
    const status = outcome(steps), last = { version, at: this.now().toISOString(), status, reason, steps };
    // A check that couldn't reach Gemini says nothing about this version, so it's tried again later.
    this.record = { ...this.record, checkedVersion: status === 'unreachable' ? this.record.checkedVersion : version, last };
    await this.writeJSON(this.path, this.record);
    this.onChange(this.state());
    if (status === 'failed' && reason === 'update') this.onFailure(last);
    return last;
  }
  start({ delay = 2 * 60 * 1000, every = 3 * 60 * 60 * 1000 } = {}) {
    const tick = () => this.tick().catch(() => {});
    this.timer = setTimeout(() => { tick(); this.interval = setInterval(tick, every); }, delay);
  }
  stop() { clearTimeout(this.timer); clearInterval(this.interval); this.controller.abort(); }
}
