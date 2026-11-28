// The floating companion's own conversation. It is saved as an ordinary chat called Quick chat,
// but never becomes the window's open chat, so it can run while the window is busy with a work session.
// Tachyon's questions use one too, saved as Terminal.
import { desktopAsked, mayBeMarker, type ConversationHistoryEntry, type ProviderSettings } from './core.mjs';

export interface CompanionSettings extends ProviderSettings {
  autoPick?: unknown;
  desktopHandoff?: boolean;
}

export interface CompanionSessions {
  sessions: ReadonlyArray<{ id: string }>;
  active: string | null;
  history?: readonly ConversationHistoryEntry[];
  read(id: string): Promise<ConversationHistoryEntry[]> | ConversationHistoryEntry[];
  addChat(options: { title: string; history: ConversationHistoryEntry[] }): Promise<string>;
  append(id: string, entries: Array<Record<string, unknown>>): Promise<unknown[]>;
}

export interface CompanionProvider {
  chat(
    settings: CompanionSettings,
    history: readonly ConversationHistoryEntry[],
    text: string,
    signal: AbortSignal,
    screenshot: null,
    options: { onText?: (value: string) => void },
  ): Promise<{ text: string }>;
}

export type CompanionPrepareFn = (
  settings: CompanionSettings,
  text: string,
  history: readonly ConversationHistoryEntry[],
  signal: AbortSignal,
) => Promise<CompanionSettings> | CompanionSettings;

export interface CompanionChatOptions {
  sessions: CompanionSessions;
  path: string;
  readJSON: <T = { sessionId?: string }>(path: string, fallback: T) => Promise<T>;
  writeJSON: (path: string, value: unknown) => Promise<unknown>;
  provider: (settings: CompanionSettings) => CompanionProvider;
  settings: (override?: unknown) => CompanionSettings;
  prepare?: CompanionPrepareFn | null;
  onSaved?: (id: string, next: unknown[]) => void;
  now?: () => string;
  title?: string;
  from?: string;
}

export interface CompanionRunArgs {
  settings: CompanionSettings;
  history: readonly ConversationHistoryEntry[];
  text: string;
  signal: AbortSignal;
  onText?: (value: string) => void;
}

export interface CompanionHandoffArgs {
  text: string;
  signal: AbortSignal;
  onText?: (value: string) => void;
}

export interface CompanionSendOptions {
  onText?: (value: string) => void;
  record?: string;
  run?: (args: CompanionRunArgs) => Promise<string>;
  handoff?: (args: CompanionHandoffArgs) => Promise<string>;
  mode?: string;
  settingsOverride?: unknown;
}

export class CompanionChat {
  sessions: CompanionSessions;
  path: string;
  readJSON: <T = { sessionId?: string }>(path: string, fallback: T) => Promise<T>;
  writeJSON: (path: string, value: unknown) => Promise<unknown>;
  provider: (settings: CompanionSettings) => CompanionProvider;
  settings: (override?: unknown) => CompanionSettings;
  prepare: CompanionPrepareFn | null;
  onSaved: (id: string, next: unknown[]) => void;
  now: () => string;
  title: string;
  from: string;
  controller: AbortController | null;

  constructor({ sessions, path, readJSON, writeJSON, provider, settings, prepare = null, onSaved = () => {}, now = () => new Date().toISOString(), title = 'Quick chat', from = 'companion' }: CompanionChatOptions) {
    this.sessions = sessions;
    this.path = path;
    this.readJSON = readJSON;
    this.writeJSON = writeJSON;
    this.provider = provider;
    this.settings = settings;
    this.prepare = prepare;
    this.onSaved = onSaved;
    this.now = now;
    this.title = title;
    this.from = from;
    this.controller = null;
  }
  async sessionId(): Promise<string> {
    const saved = await this.readJSON<{ sessionId?: string }>(this.path, {}).catch(() => ({ sessionId: undefined }));
    if (saved.sessionId && this.sessions.sessions.some(session => session.id === saved.sessionId)) return saved.sessionId;
    const id = await this.sessions.addChat({ title: this.title, history: [] });
    await this.writeJSON(this.path, { sessionId: id });
    return id;
  }
  async history(): Promise<readonly ConversationHistoryEntry[]> {
    const id = await this.sessionId();
    return id === this.sessions.active ? (this.sessions.history ?? []) : this.sessions.read(id);
  }
  get busy(): boolean { return Boolean(this.controller); }
  /** Start the next message on a new chat. */
  async reset(): Promise<void> {
    await this.writeJSON(this.path, {});
  }
  // `record` is what's saved as the message, when what's sent carries more (Tachyon's screen).
  // `run({ settings, history, text, signal, onText })` answers in place of a plain chat turn (Flux's browser tools).
  // handoff({ text, signal, onText }): when the model answers the desktop marker (core.mjs DESKTOP_MARKER), the reply
  // is that Desktop task's instead, saved as one.
  // mode: what a run turn is saved as ('desktop' for a Desktop task, so later chats know it really happened).
  async send(text: string, { onText, record, run, handoff, mode: runMode = 'chat', settingsOverride }: CompanionSendOptions = {}): Promise<{ text: string }> {
    if (typeof text !== 'string' || !text.trim() || text.length > 12000) throw new Error('Enter a message of 1–12,000 characters.');
    if (this.controller) throw new Error('Fairy is still answering. Stop her or wait a moment.');
    const controller = this.controller = new AbortController();
    try {
      const id = await this.sessionId(), history = await this.history();
      // prepare(settings, text, history, signal): the settings this turn runs with (Auto's model, in the companion).
      const baseSettings = this.settings(settingsOverride);
      const prepared = this.prepare ? await this.prepare(baseSettings, text.trim(), history, controller.signal) : baseSettings;
      const settings: CompanionSettings = handoff && !run ? { ...prepared, desktopHandoff: true } : prepared;
      const shown = handoff && !run && onText ? (value: string) => { if (!mayBeMarker(value)) onText(value); } : onText;
      let reply = run
        ? await run({ settings, history, text: text.trim(), signal: controller.signal, onText })
        : (await this.provider(settings).chat(settings, history, text.trim(), controller.signal, null, { onText: shown })).text;
      const handedOff = Boolean(handoff && !run && desktopAsked(reply));
      if (handedOff) reply = await handoff!({ text: text.trim(), signal: controller.signal, onText });
      const at = this.now(), mode = handedOff ? 'desktop' : run ? runMode : 'chat';
      const next = await this.sessions.append(id, [{ role: 'user', content: (record ?? text).trim(), at, mode, from: this.from }, { role: 'assistant', content: reply, at, mode, ...(settings.autoPick ? { auto: settings.autoPick } : {}) }]);
      this.onSaved(id, next);
      return { text: reply };
    } finally { if (this.controller === controller) this.controller = null; }
  }
  stop(): void { this.controller?.abort(); }
}
