const MAX_TEXT = 12000, MAX_LISTED = 300, MAX_VOICE_PARTS = 60, MAX_VOICE_BYTES = 30 * 1024 * 1024;
type HttpError = Error & { status: number };
const failure = (status: number, message: string): HttpError => Object.assign(new Error(message), { status });

export interface PhoneFolder {
  id: string;
  name: string;
}

export interface PhoneSessionSummary {
  id: string;
  title: string;
  updatedAt?: string;
  pinned?: boolean;
  folder?: string;
  work?: unknown;
}

export interface PhoneState {
  folders?: readonly PhoneFolder[];
  sessions: readonly PhoneSessionSummary[];
  running?: Record<string, string>;
}

export interface PhoneChatListItem {
  id: string;
  title: string;
  updatedAt: string | undefined;
  pinned: boolean;
  folder: string | null;
  work: unknown;
  state: string;
}

// What a phone sees in its chat list, newest first with pinned chats on top.
export function phoneChatList(state: PhoneState, running: Record<string, string> = {}): PhoneChatListItem[] {
  const folders = new Map((state.folders ?? []).map(folder => [folder.id, folder.name]));
  return [...state.sessions]
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, MAX_LISTED)
    .map(({ id, title, updatedAt, pinned, folder, work }) => ({ id, title, updatedAt, pinned: Boolean(pinned), folder: folder ? (folders.get(folder) ?? null) : null, work: work || null, state: running[id] ?? (state.running?.[id]) ?? 'idle' }));
}

// Replies to a phone. A phone never chooses a mode: the Mac's route decides from the words alone, and it can only answer
// plain conversation, Gmail (reading, and a draft when asked) or Google Calendar (an event only after an OK from you).
// Nothing here reads the screen, runs a skill or starts work, whatever a message says.
export const PHONE_MODES = Object.freeze(['chat', 'gmail', 'calendar', 'page'] as const);
export type PhoneMode = (typeof PHONE_MODES)[number];

export interface ThoughtEntry {
  id: string;
  kind: string;
  text: string;
  status: string;
  durationMs?: number;
}

export interface ActiveTurn {
  id: string;
  text: string;
  thinking: string;
  thoughts: ThoughtEntry[];
  a2ui?: unknown[];
  controller: AbortController;
}

export interface SpokenTurn {
  id: string;
  parts: Buffer[];
  size: number;
  done: boolean;
  failed: string;
  controller: AbortController;
}

export interface VoicePart {
  bytes?: Uint8Array | ArrayBuffer | Buffer;
}

export interface VoiceSession {
  update(text: string): void;
  finish(text: string): Promise<string | void>;
  cancel(): void;
}

export interface ReplyChoice {
  provider?: string;
  model?: string;
  effort?: string;
}

export interface ReplyParams extends ReplyChoice {
  chat: string;
  mode: PhoneMode;
  history: unknown[];
  files: unknown[];
  text: string;
  signal: AbortSignal;
  onText: (value: unknown) => void;
  onThinking: (value: unknown) => void;
  onThought: (item: unknown) => void;
}

export type ReplyResult = string | { text?: unknown; a2ui?: unknown[] } | null | undefined;

export interface PhoneTurnsOptions {
  list: () => readonly PhoneSessionSummary[];
  read: (id: string) => Promise<unknown[]>;
  append: (id: string, messages: unknown[]) => Promise<unknown>;
  addChat: (init: { title: string; history: unknown[] }) => Promise<string>;
  reply: (params: ReplyParams) => Promise<ReplyResult>;
  attached?: (ids: readonly string[]) => Promise<unknown[]>;
  claim?: (files: readonly unknown[]) => Promise<unknown>;
  route?: (message: string, history: unknown[], hasFiles: boolean) => Promise<string>;
  makeVoice?: ((opts: { signal: AbortSignal; emit: (part: VoicePart) => void }) => VoiceSession) | null;
  busy?: (chat: string) => boolean;
  onChange?: (chat: string) => void;
  onEvent?: (event: { type: string; device: string }) => void;
  now?: () => string;
}

export interface SendMessageOptions {
  chat?: string | null;
  text: unknown;
  device?: string;
  voice?: boolean;
  attachments?: unknown;
  provider?: unknown;
  model?: unknown;
  effort?: unknown;
}

export class PhoneTurns {
  list: () => readonly PhoneSessionSummary[];
  read: (id: string) => Promise<unknown[]>;
  append: (id: string, messages: unknown[]) => Promise<unknown>;
  addChat: (init: { title: string; history: unknown[] }) => Promise<string>;
  reply: (params: ReplyParams) => Promise<ReplyResult>;
  attached: (ids: readonly string[]) => Promise<unknown[]>;
  claim: (files: readonly unknown[]) => Promise<unknown>;
  route: (message: string, history: unknown[], hasFiles: boolean) => Promise<string>;
  makeVoice: ((opts: { signal: AbortSignal; emit: (part: VoicePart) => void }) => VoiceSession) | null;
  busy: (chat: string) => boolean;
  onChange: (chat: string) => void;
  onEvent: (event: { type: string; device: string }) => void;
  now: () => string;
  turn: ActiveTurn | null;
  spoken: SpokenTurn | null;
  failures: Map<string, string>;
  asking: ({ chat: string } & Record<string, unknown>) | null;

  constructor({ list, read, append, addChat, reply, attached = async () => [], claim = async () => {}, route = async () => 'chat', makeVoice = null, busy = () => false, onChange = () => {}, onEvent = () => {}, now = () => new Date().toISOString() }: PhoneTurnsOptions) {
    this.list = list;
    this.read = read;
    this.append = append;
    this.addChat = addChat;
    this.reply = reply;
    this.attached = attached;
    this.claim = claim;
    this.route = route;
    this.makeVoice = makeVoice;
    this.busy = busy;
    this.onChange = onChange;
    this.onEvent = onEvent;
    this.now = now;
    this.turn = null;
    this.spoken = null;
    this.failures = new Map();
    this.asking = null;
  }
  running(): Record<string, string> { return this.turn ? { [this.turn.id]: this.asking?.chat === this.turn.id ? 'waiting' : 'working' } : {}; }
  // While the reply waits for an OK (a Calendar event), its chat shows as waiting. The OK itself goes out with the Mac's
  // other approvals.
  waitFor(chat: string, request: Record<string, unknown> | null): void { this.asking = request ? { ...request, chat } : null; this.onChange(chat); }
  // What's being written right now, and what last went wrong, for showing with a chat.
  live(id: string): { text: string; thinking?: string; thoughts?: ThoughtEntry[]; a2ui?: unknown[] } | null {
    return this.turn?.id === id ? { text: this.turn.text, ...(this.turn.thinking ? { thinking: this.turn.thinking } : {}), ...(this.turn.thoughts?.length ? { thoughts: this.turn.thoughts } : {}), ...(Array.isArray(this.turn.a2ui) && this.turn.a2ui.length ? { a2ui: this.turn.a2ui } : {}) } : null;
  }
  failed(id: string): string | null { return this.failures.get(id) ?? null; }
  // The latest reply's clips, kept until the next message so the phone can fetch them in turn.
  voice(id: string): { parts: number; done: boolean; failed: string } | null { return this.spoken?.id === id ? { parts: this.spoken.parts.length, done: this.spoken.done, failed: this.spoken.failed } : null; }
  voicePart(id: string, index: number): Buffer | null { return this.spoken?.id === id ? this.spoken.parts[index] ?? null : null; }
  addPart(spoken: SpokenTurn, part: VoicePart): void {
    const bytes = part?.bytes;
    if (this.spoken !== spoken || !bytes) return;
    const byteLength = bytes instanceof ArrayBuffer ? bytes.byteLength : bytes.length;
    if (!byteLength) return;
    if (spoken.parts.length >= MAX_VOICE_PARTS || spoken.size + byteLength > MAX_VOICE_BYTES) { spoken.controller.abort(); return; }
    spoken.size += byteLength;
    spoken.parts.push(bytes instanceof ArrayBuffer ? Buffer.from(bytes) : Buffer.from(bytes));
  }

  async send({ chat, text, device = 'iPhone', voice = false, attachments = [], provider = null, model = null, effort = null }: SendMessageOptions): Promise<{ chat: string }> {
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) throw failure(400, `Enter a message of 1–${MAX_TEXT.toLocaleString('en-US')} characters.`);
    if (chat !== undefined && chat !== null && typeof chat !== 'string') throw failure(400, 'Not understood.');
    if (!Array.isArray(attachments) || attachments.length > 10 || attachments.some(id => typeof id !== 'string')) throw failure(400, 'Attach up to 10 files or folders to a message.');
    const cleanOpt = (v: unknown, max = 80): string => (typeof v === 'string' && v.trim() && v.trim().length <= max && !/[\x00-\x1f\s]/.test(v.trim()) ? v.trim() : '');
    const choice: ReplyChoice = {
      provider: cleanOpt(provider, 32),
      model: cleanOpt(model, 80),
      effort: cleanOpt(effort, 16),
    };
    // Files the phone sent ahead with /v1/attach; a gone one is said now, before anything starts.
    let files: unknown[];
    try { files = await this.attached(attachments as string[]); } catch (error) {
      const msg = error instanceof Error ? error.message : (error && typeof error === 'object' && 'message' in error ? String((error as { message: unknown }).message) : '');
      throw failure(400, String(msg || 'That attached file has gone. Add it again.'));
    }
    // One at a time keeps a phone from starting a pile of replies on your subscription.
    if (this.turn) throw failure(409, 'Baryon is still replying. Wait for it to finish, or stop it.');
    const message = text.trim();
    if (chat) {
      const found = this.list().find(item => item.id === chat);
      if (!found) throw failure(404, 'That chat is no longer here.');
      if (found.work) throw failure(409, 'This is a work session, so it needs your Mac.');
      if (this.busy(chat)) throw failure(409, 'Baryon is busy in this chat on your Mac. Try again in a moment.');
    }
    const id = chat || await this.addChat({ title: message.replace(/\s+/g, ' ').slice(0, 60), history: [] });
    const controller = new AbortController();
    this.turn = { id, text: '', thinking: '', thoughts: [], controller };
    this.failures.delete(id);
    this.spoken?.controller.abort();
    this.spoken = null;
    if (voice === true && this.makeVoice) this.spoken = { id, parts: [], size: 0, done: false, failed: '', controller: new AbortController() };
    this.onChange(id);
    this.onEvent({ type: 'chat', device });
    void this.run(id, message, controller.signal, files, choice);
    return { chat: id };
  }
  recordThought(turn: ActiveTurn, item: unknown): void {
    if (this.turn !== turn || !item || typeof item !== 'object') return;
    const raw = item as Record<string, unknown>;
    const id = String(raw.id || `t-${turn.thoughts.length + 1}`).slice(0, 80);
    const kind = String(raw.kind || 'thinking').slice(0, 24);
    const text = String(raw.text || '').slice(-1200);
    const status = String(raw.status || 'running').slice(0, 16);
    const durationMs = Number.isFinite(Number(raw.durationMs)) ? Math.max(0, Math.round(Number(raw.durationMs))) : null;
    const entry: ThoughtEntry = { id, kind, text, status, ...(durationMs !== null ? { durationMs } : {}) };
    const idx = turn.thoughts.findIndex(t => t.id === id);
    if (idx >= 0) turn.thoughts[idx] = entry;
    else turn.thoughts = [...turn.thoughts, entry].slice(-40);
  }
  async run(id: string, message: string, signal: AbortSignal, files: unknown[] = [], choice: ReplyChoice = {}): Promise<void> {
    const turn = this.turn!, spoken = this.spoken;
    const voice = spoken ? this.makeVoice!({ signal: AbortSignal.any([signal, spoken.controller.signal]), emit: part => this.addPart(spoken, part) }) : null;
    let history: unknown[], mode: PhoneMode = 'chat';
    try {
      history = await this.read(id);
      // Saved with the mode it was answered in, so a follow-up ("and the second one?") keeps its context.
      const routed = await this.route(message, history, files.length > 0);
      mode = (PHONE_MODES as readonly string[]).includes(routed) ? (routed as PhoneMode) : 'chat';
      await this.append(id, [{ role: 'user', content: message, at: this.now(), mode, from: 'phone', ...(files.length ? { attachments: files } : {}) }]);
      // Saved with the message, the files stay for later turns in this chat.
      if (files.length) await this.claim(files);
      this.onChange(id);
      const result = await this.reply({
        chat: id, mode, history, files, text: message, signal,
        ...(choice.provider ? { provider: choice.provider } : {}),
        ...(choice.model ? { model: choice.model } : {}),
        ...(choice.effort ? { effort: choice.effort } : {}),
        onText: value => { if (typeof value === 'string' && this.turn === turn) { turn.text = value; voice?.update(value); } },
        onThinking: value => { if (typeof value === 'string' && this.turn === turn) turn.thinking = value; },
        onThought: item => this.recordThought(turn, item),
      });
      const replyText = typeof result === 'string' ? result : String(result?.text ?? '');
      const replyA2UI = result && typeof result === 'object' && Array.isArray(result.a2ui) && result.a2ui.length ? result.a2ui : null;
      if (replyA2UI && this.turn === turn) turn.a2ui = replyA2UI;
      await this.save(id, replyText, mode, replyA2UI ? { a2ui: replyA2UI } : null);
      // The reply is finished and saved, so the next message needn't wait for the last clips.
      if (this.turn === turn) this.turn = null;
      this.onChange(id);
      if (voice) spoken!.failed = (await voice.finish(String(replyText))) || '';
    } catch (error) {
      // Stopping keeps what was written so far, as it does on the Mac. Anything else is shown once, then forgotten.
      if (signal.aborted) { if (turn.text.trim()) await this.save(id, turn.text, mode).catch(() => {}); }
      else {
        const msg = error instanceof Error ? error.message : (error && typeof error === 'object' && 'message' in error ? String((error as { message: unknown }).message) : '');
        this.failures.set(id, String(msg || 'Fairy couldn’t reply.').slice(0, 300));
      }
    } finally {
      if (this.asking?.chat === id) this.asking = null;
      if (this.turn === turn) this.turn = null;
      voice?.cancel();
      if (spoken) spoken.done = true;
      this.onChange(id);
    }
  }
  save(id: string, text: string, mode: PhoneMode = 'chat', extra: Record<string, unknown> | null = null): Promise<unknown> {
    return this.append(id, [{ role: 'assistant', content: String(text), at: this.now(), mode, ...(extra && typeof extra === 'object' ? extra : {}) }]);
  }
  stop(id: string): { ok: true } {
    if (this.turn?.id !== id && (this.spoken?.id !== id || this.spoken.done)) throw failure(409, 'Fairy isn’t replying in this chat.');
    if (this.turn?.id === id) this.turn.controller.abort();
    if (this.spoken?.id === id) this.spoken.controller.abort();
    return { ok: true };
  }
  stopAll(): void { this.turn?.controller.abort(); this.spoken?.controller.abort(); }
}
