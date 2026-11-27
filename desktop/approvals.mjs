import { randomUUID } from 'node:crypto';
import { appendFile, readFile } from 'node:fs/promises';

// One way for anything Fairy does to ask first. A request says what will change, how risky it is, and on whose behalf
// (which chat, provider and model); it's answered from the window, the companion or a paired phone, and the answer,
// or Stop, or eight minutes with none, ends it. Something that reaches past the sandbox can be refused from a phone but
// only allowed on the Mac; one marked miniOnly (a Lab run with no sandbox) only on the Mac Fairy lives on, not from the
// MacBook's window either. Each request and answer goes in a local log, which keeps what was asked, never a file's
// contents or a diff, with anything that looks like a key hidden.
export const DECISIONS = ['allow', 'always', 'auto', 'deny'];
export const WAIT = 8 * 60 * 1000;
// Kinds of work-session step that run with more than the sandbox allows.
export const macOnlyKind = kind => /^(?:outside|computer|screen|browser:)/.test(String(kind || ''));

const SECRET = /\b(?:sk-[A-Za-z0-9_-]{12,}|sk-ant-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|ya29\.[0-9A-Za-z_-]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,})|\bBearer\s+[A-Za-z0-9._~+/-]{12,}|(?<=\b(?:password|passwd|secret|token|api[_-]?key)\s*[=:]\s*)\S+/gi;
export const redact = text => String(text ?? '').replace(SECRET, '[hidden]');
const clip = (text, limit) => { const flat = redact(text).replace(/\s+/g, ' ').trim(); return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat; };

// What the log keeps of a request.
export function auditSummary(request = {}) {
  const files = request.diff?.files ?? request.diff?.rows?.length;
  return {
    kind: String(request.kind || 'step'), ...(request.tool ? { tool: String(request.tool) } : {}), risk: request.risk === 'read' ? 'read' : 'write',
    title: clip(request.title || '', 160), ...(request.detail || request.command ? { detail: clip(request.command || request.detail, 240) } : {}),
    ...(files ? { changes: files } : {}), source: String(request.source || 'chat'), ...(request.chat ? { chat: String(request.chat) } : {}),
    ...(request.provider ? { provider: String(request.provider) } : {}), ...(request.model ? { model: String(request.model) } : {}),
  };
}

// approvals.jsonl, a line for each request and answer, newest last.
export class AuditLog {
  constructor({ path, append = appendFile, read = readFile }) { Object.assign(this, { path, append, read }); this.queue = Promise.resolve(); }
  add(entry) {
    const line = `${JSON.stringify(entry)}\n`;
    this.queue = this.queue.then(() => this.append(this.path, line, { mode: 0o600 })).catch(() => {});
    return this.queue;
  }
  async recent(limit = 50) {
    await this.queue;
    let text = '';
    try { text = await this.read(this.path, 'utf8'); } catch { return []; }
    return text.trim().split('\n').slice(-Math.max(1, limit)).reverse().flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  }
}

export class Approvals {
  constructor({ log = null, now = () => new Date(), wait = WAIT, onChange = () => {} } = {}) {
    Object.assign(this, { log, now, wait, onChange });
    this.waiting = new Map();
  }
  // Resolves with the decision, or `unanswered` ('deny' unless asked otherwise) when no one answers in time; rejects with "Stopped." when the work is stopped.
  // shown(id) and closed(id) let the caller draw and take down its own card, as a work session's chat does.
  ask(request, { signal, choices = ['allow', 'deny'], wait = this.wait, unanswered = 'deny', shown = () => {}, closed = () => {} } = {}) {
    signal?.throwIfAborted();
    if (!choices.length || choices.some(choice => !DECISIONS.includes(choice))) throw new Error('Unknown answers for an approval.');
    return new Promise((resolve, reject) => {
      const id = randomUUID(), entry = { id, choices, request: { ...request, id, macOnly: Boolean(request.macOnly || request.miniOnly || macOnlyKind(request.kind)), ...(request.miniOnly ? { miniOnly: true } : {}), asked: this.now().toISOString() } };
      const finish = (event, via) => {
        if (this.waiting.get(id) !== entry) return false;
        this.waiting.delete(id); clearTimeout(timer); signal?.removeEventListener('abort', stopped);
        this.record(entry, event, via);
        try { closed(id); } finally { this.onChange(this.pending()); }
        return true;
      };
      const stopped = () => { if (finish('stopped')) reject(new Error('Stopped.')); };
      const timer = setTimeout(() => { if (finish('timed-out')) resolve(unanswered); }, wait);
      entry.settle = (decision, via) => { if (finish(decision === 'deny' ? 'denied' : decision === 'allow' ? 'allowed' : `allowed-${decision}`, via)) resolve(decision); };
      this.waiting.set(id, entry);
      signal?.addEventListener('abort', stopped, { once: true });
      this.record(entry, 'asked');
      try { shown(id); } finally { this.onChange(this.pending()); }
    });
  }
  answer(id, decision, via = 'window') {
    const entry = this.waiting.get(id);
    if (!entry) throw new Error('That question has already been answered.');
    if (!entry.choices.includes(decision)) throw new Error('Unknown answer.');
    if (via === 'phone' && decision !== 'deny' && entry.request.macOnly) throw new Error('This one can only be allowed on the Mac.');
    if (via === 'face' && decision !== 'deny' && entry.request.miniOnly) throw new Error('This one can only be allowed on the Mac Fairy lives on.');
    entry.settle(decision, via);
    return true;
  }
  // A write that didn't need asking, such as an unsent Gmail draft, still goes in the log.
  note(request, event = 'done') { this.record({ id: randomUUID(), request }, event); }
  pending(test = () => true) { return [...this.waiting.values()].filter(entry => test(entry.request)).map(entry => ({ ...entry.request, choices: entry.choices })); }
  record(entry, event, via) {
    void this.log?.add({ at: this.now().toISOString(), id: entry.id, event, ...(via ? { via } : {}), ...auditSummary(entry.request) });
  }
}
