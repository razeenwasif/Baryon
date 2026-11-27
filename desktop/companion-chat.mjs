// The floating companion's own conversation. It is saved as an ordinary chat called Quick chat,
// but never becomes the window's open chat, so it can run while the window is busy with a work session.
// Tachyon's questions use one too, saved as Terminal.
import { desktopAsked, mayBeMarker } from './core.mjs';

export class CompanionChat {
  constructor({ sessions, path, readJSON, writeJSON, provider, settings, prepare = null, onSaved = () => {}, now = () => new Date().toISOString(), title = 'Quick chat', from = 'companion' }) {
    Object.assign(this, { sessions, path, readJSON, writeJSON, provider, settings, prepare, onSaved, now, title, from });
    this.controller = null;
  }
  async sessionId() {
    const saved = await this.readJSON(this.path, {}).catch(() => ({}));
    if (saved.sessionId && this.sessions.sessions.some(session => session.id === saved.sessionId)) return saved.sessionId;
    const id = await this.sessions.addChat({ title: this.title, history: [] });
    await this.writeJSON(this.path, { sessionId: id });
    return id;
  }
  async history() {
    const id = await this.sessionId();
    return id === this.sessions.active ? this.sessions.history : this.sessions.read(id);
  }
  get busy() { return Boolean(this.controller); }
  /** Start the next message on a new chat. */
  async reset() {
    await this.writeJSON(this.path, {});
  }
  // `record` is what's saved as the message, when what's sent carries more (Tachyon's screen).
  // `run({ settings, history, text, signal, onText })` answers in place of a plain chat turn (Flux's browser tools).
  // handoff({ text, signal, onText }): when the model answers the desktop marker (core.mjs DESKTOP_MARKER), the reply
  // is that Desktop task's instead, saved as one.
  // mode: what a run turn is saved as ('desktop' for a Desktop task, so later chats know it really happened).
  async send(text, { onText, record, run, handoff, mode: runMode = 'chat', settingsOverride } = {}) {
    if (typeof text !== 'string' || !text.trim() || text.length > 12000) throw new Error('Enter a message of 1–12,000 characters.');
    if (this.controller) throw new Error('Fairy is still answering. Stop her or wait a moment.');
    const controller = this.controller = new AbortController();
    try {
      const id = await this.sessionId(), history = await this.history();
      // prepare(settings, text, history, signal): the settings this turn runs with (Auto's model, in the companion).
      const baseSettings = this.settings(settingsOverride);
      const prepared = this.prepare ? await this.prepare(baseSettings, text.trim(), history, controller.signal) : baseSettings;
      const settings = handoff && !run ? { ...prepared, desktopHandoff: true } : prepared;
      const shown = handoff && !run && onText ? value => { if (!mayBeMarker(value)) onText(value); } : onText;
      let reply = run
        ? await run({ settings, history, text: text.trim(), signal: controller.signal, onText })
        : (await this.provider(settings).chat(settings, history, text.trim(), controller.signal, null, { onText: shown })).text;
      const handedOff = Boolean(handoff && !run && desktopAsked(reply));
      if (handedOff) reply = await handoff({ text: text.trim(), signal: controller.signal, onText });
      const at = this.now(), mode = handedOff ? 'desktop' : run ? runMode : 'chat';
      const next = await this.sessions.append(id, [{ role: 'user', content: (record ?? text).trim(), at, mode, from: this.from }, { role: 'assistant', content: reply, at, mode, ...(settings.autoPick ? { auto: settings.autoPick } : {}) }]);
      this.onSaved(id, next);
      return { text: reply };
    } finally { if (this.controller === controller) this.controller = null; }
  }
  stop() { this.controller?.abort(); }
}
