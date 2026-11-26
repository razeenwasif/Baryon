const MAX_TEXT = 12000, MAX_LISTED = 300, MAX_VOICE_PARTS = 60, MAX_VOICE_BYTES = 30 * 1024 * 1024;
const failure = (status, message) => Object.assign(new Error(message), { status });

// What a phone sees in its chat list, newest first with pinned chats on top.
export function phoneChatList(state, running = {}) {
  const folders = new Map((state.folders ?? []).map(folder => [folder.id, folder.name]));
  return [...state.sessions]
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, MAX_LISTED)
    .map(({ id, title, updatedAt, pinned, folder, work }) => ({ id, title, updatedAt, pinned: Boolean(pinned), folder: folders.get(folder) ?? null, work: work || null, state: running[id] ?? (state.running?.[id]) ?? 'idle' }));
}

// Replies to a phone. A phone never chooses a mode: the Mac's route decides from the words alone, and it can only answer
// plain conversation, Gmail (reading, and a draft when asked) or Google Calendar (an event only after an OK from you).
// Nothing here reads the screen, runs a skill or starts work, whatever a message says.
export const PHONE_MODES = Object.freeze(['chat', 'gmail', 'calendar', 'page']);
export class PhoneTurns {
  constructor({ list, read, append, addChat, reply, attached = async () => [], claim = async () => {}, route = async () => 'chat', makeVoice = null, busy = () => false, onChange = () => {}, onEvent = () => {}, now = () => new Date().toISOString() }) {
    Object.assign(this, { list, read, append, addChat, reply, attached, claim, route, makeVoice, busy, onChange, onEvent, now });
    this.turn = null;
    this.spoken = null;
    this.failures = new Map();
    this.asking = null;
  }
  running() { return this.turn ? { [this.turn.id]: this.asking?.chat === this.turn.id ? 'waiting' : 'working' } : {}; }
  // While the reply waits for an OK (a Calendar event), its chat shows as waiting. The OK itself goes out with the Mac's
  // other approvals.
  waitFor(chat, request) { this.asking = request ? { ...request, chat } : null; this.onChange(chat); }
  // What's being written right now, and what last went wrong, for showing with a chat.
  live(id) { return this.turn?.id === id ? { text: this.turn.text, ...(this.turn.thinking ? { thinking: this.turn.thinking } : {}), ...(this.turn.thoughts?.length ? { thoughts: this.turn.thoughts } : {}), ...(Array.isArray(this.turn.a2ui) && this.turn.a2ui.length ? { a2ui: this.turn.a2ui } : {}) } : null; }
  failed(id) { return this.failures.get(id) ?? null; }
  // The latest reply's clips, kept until the next message so the phone can fetch them in turn.
  voice(id) { return this.spoken?.id === id ? { parts: this.spoken.parts.length, done: this.spoken.done, failed: this.spoken.failed } : null; }
  voicePart(id, index) { return this.spoken?.id === id ? this.spoken.parts[index] ?? null : null; }
  addPart(spoken, part) {
    if (this.spoken !== spoken || !part?.bytes?.length) return;
    if (spoken.parts.length >= MAX_VOICE_PARTS || spoken.size + part.bytes.length > MAX_VOICE_BYTES) { spoken.controller.abort(); return; }
    spoken.size += part.bytes.length;
    spoken.parts.push(Buffer.from(part.bytes));
  }

  async send({ chat, text, device = 'iPhone', voice = false, attachments = [], provider = null, model = null, effort = null }) {
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) throw failure(400, `Enter a message of 1–${MAX_TEXT.toLocaleString('en-US')} characters.`);
    if (chat !== undefined && chat !== null && typeof chat !== 'string') throw failure(400, 'Not understood.');
    if (!Array.isArray(attachments) || attachments.length > 10 || attachments.some(id => typeof id !== 'string')) throw failure(400, 'Attach up to 10 files or folders to a message.');
    const cleanOpt = (v, max = 80) => (typeof v === 'string' && v.trim() && v.trim().length <= max && !/[\x00-\x1f\s]/.test(v.trim()) ? v.trim() : '');
    const choice = {
      provider: cleanOpt(provider, 32),
      model: cleanOpt(model, 80),
      effort: cleanOpt(effort, 16),
    };
    // Files the phone sent ahead with /v1/attach; a gone one is said now, before anything starts.
    let files;
    try { files = await this.attached(attachments); } catch (error) { throw failure(400, String(error.message || 'That attached file has gone. Add it again.')); }
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
    this.run(id, message, controller.signal, files, choice);
    return { chat: id };
  }
  recordThought(turn, item) {
    if (this.turn !== turn || !item || typeof item !== 'object') return;
    const id = String(item.id || `t-${turn.thoughts.length + 1}`).slice(0, 80);
    const kind = String(item.kind || 'thinking').slice(0, 24);
    const text = String(item.text || '').slice(-1200);
    const status = String(item.status || 'running').slice(0, 16);
    const durationMs = Number.isFinite(Number(item.durationMs)) ? Math.max(0, Math.round(Number(item.durationMs))) : null;
    const entry = { id, kind, text, status, ...(durationMs !== null ? { durationMs } : {}) };
    const idx = turn.thoughts.findIndex(t => t.id === id);
    if (idx >= 0) turn.thoughts[idx] = entry;
    else turn.thoughts = [...turn.thoughts, entry].slice(-40);
  }
  async run(id, message, signal, files = [], choice = {}) {
    const turn = this.turn, spoken = this.spoken;
    const voice = spoken ? this.makeVoice({ signal: AbortSignal.any([signal, spoken.controller.signal]), emit: part => this.addPart(spoken, part) }) : null;
    let history, mode = 'chat';
    try {
      history = await this.read(id);
      // Saved with the mode it was answered in, so a follow-up ("and the second one?") keeps its context.
      const routed = await this.route(message, history, files.length > 0);
      mode = PHONE_MODES.includes(routed) ? routed : 'chat';
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
      const replyA2UI = Array.isArray(result?.a2ui) && result.a2ui.length ? result.a2ui : null;
      if (replyA2UI && this.turn === turn) turn.a2ui = replyA2UI;
      await this.save(id, replyText, mode, replyA2UI ? { a2ui: replyA2UI } : null);
      // The reply is finished and saved, so the next message needn't wait for the last clips.
      if (this.turn === turn) this.turn = null;
      this.onChange(id);
      if (voice) spoken.failed = await voice.finish(String(replyText)) || '';
    } catch (error) {
      // Stopping keeps what was written so far, as it does on the Mac. Anything else is shown once, then forgotten.
      if (signal.aborted) { if (turn.text.trim()) await this.save(id, turn.text, mode).catch(() => {}); }
      else this.failures.set(id, String(error.message || 'Fairy couldn’t reply.').slice(0, 300));
    } finally {
      if (this.asking?.chat === id) this.asking = null;
      if (this.turn === turn) this.turn = null;
      voice?.cancel();
      if (spoken) spoken.done = true;
      this.onChange(id);
    }
  }
  save(id, text, mode = 'chat', extra = null) { return this.append(id, [{ role: 'assistant', content: String(text), at: this.now(), mode, ...(extra && typeof extra === 'object' ? extra : {}) }]); }
  stop(id) {
    if (this.turn?.id !== id && (this.spoken?.id !== id || this.spoken.done)) throw failure(409, 'Fairy isn’t replying in this chat.');
    if (this.turn?.id === id) this.turn.controller.abort();
    if (this.spoken?.id === id) this.spoken.controller.abort();
    return { ok: true };
  }
  stopAll() { this.turn?.controller.abort(); this.spoken?.controller.abort(); }
}
