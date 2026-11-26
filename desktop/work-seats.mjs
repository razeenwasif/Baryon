// The seats of a work turn, against the live state of your subscriptions: who's signed in, how full each usage bar is,
// and which providers have just failed for want of sign-in or allowance. The policy is orchestrator.mjs's; this is
// where it meets the world. Each job that runs is a line in routing.jsonl (the role, the model, why, how long and how
// it ended, never what was asked or said), the data for tuning the rules.
import { providerTrouble, seatFor, turnStandIn, usageFrom, seatChoices } from './orchestrator.mjs';

// Which of Fairy's connections serves each pool.
export const KIND = { claude: 'claude', gemini: 'antigravity', agyClaude: 'antigravity', codex: 'codex' };
// A provider that failed for want of sign-in or allowance is passed over for this long.
export const DOWN_FOR = 10 * 60 * 1000;
const NAMES = { claude: 'Claude', gemini: 'Gemini', agyClaude: 'Claude through Antigravity', codex: 'Codex' };
const modelOf = used => ({ claude: used.claudeModel, antigravity: used.antigravityModel, codex: used.model })[used.backend] || '';

// settings()  Fairy's settings
// status()    { claude, gemini, codex }: whether each is signed in
// plans()     the plan usage Fairy reads every five minutes
// offered()   { claude: [...], gemini: [...], agyClaude: [...] }: what each offers, Claude through Antigravity apart
// hasKey()    whether Auto can work, which needs a Gemini key
// connect(kind, model, effort) → { provider, settings }: a connection to run a job on; no arguments is your work model
// log(entry)  a line for routing.jsonl
export class WorkSeats {
  constructor({ settings, status, plans = () => ({}), offered = () => ({}), hasKey = () => false, connect, log = () => {}, now = Date.now }) {
    Object.assign(this, { settings, status, plans, offered, hasKey, connect, log, now });
    this.down = new Map();
  }
  isDown(pool) {
    const entry = this.down.get(pool);
    if (entry && this.now() - entry.at > DOWN_FOR) this.down.delete(pool);
    return this.down.has(pool);
  }
  markDown(pool, trouble) { this.down.set(pool, { ...trouble, at: this.now() }); }
  // What the policy is told. avoid: pools that already failed this job.
  state(avoid = new Set()) {
    const s = this.settings(), status = this.status() || {}, offered = this.offered() || {}, viaAgy = s.claudeViaAntigravity === 'on';
    const up = (pool, signedIn) => Boolean(signedIn) && !this.isDown(pool) && !avoid.has(pool);
    return {
      auto: s.workAutoModel === 'on' && Boolean(this.hasKey()),
      home: { claude: 'claude', antigravity: 'gemini', codex: 'codex' }[s.workProvider || 'claude'] || null,
      available: { claude: up('claude', status.claude), gemini: up('gemini', status.gemini), agyClaude: viaAgy && up('agyClaude', status.gemini), codex: up('codex', status.codex) },
      offered: { claude: offered.claude || [], gemini: offered.gemini || [], codex: offered.codex || [], ...(viaAgy ? { agyClaude: offered.agyClaude || [] } : {}) },
      usage: usageFrom(this.plans()),
      crossProvider: s.workStandIns === 'on',
      chosen: seatChoices(s),
    };
  }
  // The connection a job runs on: its role's seat, or the turn's own model ({ provider, settings, pool }) when there's
  // no seat for it. seat says which model took it and, for a stand-in, why, for the job's row in the chat.
  // Token use, step 3: the scout's jobs are housekeeping (notes on older messages, the turn behind web_search, helper
  // searches), so they take the light seat even when work Auto is off; that seat needs no decision from Gemini, so no
  // key either. Builder and lead jobs keep the model you chose when Auto is off.
  seat(role, turn = null, { short = false, avoid = new Set(), home = null, kind = null } = {}) {
    const state = this.state(avoid);
    // Auto by task (stage 5): the session's provider, then the job's own pick by task, become home for this seat.
    if (home && state.available[home] !== false) state.home = home;
    if (kind && this.byTask) { try { const chosen = this.byTask({ role, kind, state }); if (chosen && state.available[chosen] !== false) state.home = chosen; } catch {} }
    const picked = seatFor(role, { ...state, ...(role === 'scout' ? { auto: true } : {}), short });
    const used = picked ? this.connect(KIND[picked.pool], picked.model, picked.effort) : turn || this.connect();
    return { ...used, pool: picked?.pool || turn?.pool || null, seat: { model: picked?.model || modelOf(used.settings), role, ...(picked?.standIn ? { standIn: picked.reason } : {}) } };
  }
  // A job on its role's seat. If that provider turns out to be signed out or at its limit, it's passed over for a while
  // and, with Move work between subscriptions on, the next seat takes the job; each pool is tried once per job.
  // home: the provider this turn's session is on, when Auto by task moved it; kind: the turn's kind of task, when Auto
  // by task is on for it, so the job's provider can be picked by task (byTask, set by main).
  async run(role, turn, job, { short = false, onSeat = () => {}, signal, chat = '', home = null, kind = null } = {}) {
    const avoid = new Set();
    let last = null;
    for (;;) {
      const seat = this.seat(role, turn, { short, avoid, home, kind });
      if (last && (!seat.pool || avoid.has(seat.pool))) throw last;
      if (last) seat.seat.standIn = `Moved to ${NAMES[seat.pool]}, because ${NAMES[last.pool]} ${last.trouble.kind === 'limit' ? 'is at a usage limit' : 'is signed out'}.`;
      onSeat(seat.seat);
      const started = this.now(), line = { chat, role, provider: KIND[seat.pool] || seat.settings?.backend || '', model: seat.seat.model, ...(seat.seat.standIn ? { standIn: seat.seat.standIn } : {}) };
      try {
        const result = await job(seat);
        this.log({ ...line, ms: this.now() - started, outcome: 'done' });
        return result;
      } catch (error) {
        const trouble = signal?.aborted ? null : providerTrouble(error?.message);
        this.log({ ...line, ms: this.now() - started, outcome: signal?.aborted ? 'stopped' : trouble ? 'moved' : 'failed', ...(trouble ? { trouble: trouble.kind } : {}) });
        if (!trouble || !seat.pool) throw error;
        this.markDown(seat.pool, trouble);
        if (this.settings().workStandIns !== 'on') throw error;
        avoid.add(seat.pool); last = Object.assign(error, { trouble, pool: seat.pool });
      }
    }
  }
  // Whether the turn itself goes to your other subscription, because yours is signed out, failed for want of sign-in
  // or allowance in the last few minutes, or is nearly full. Only on Auto with Move work between subscriptions on.
  turnProvider() {
    const state = this.state();
    if (!state.auto || !state.crossProvider || !state.home) return null;
    return turnStandIn(state.home, state);
  }
}
