// The seats of a work turn, against the live state of your subscriptions: who's signed in, how full each usage bar is,
// and which providers have just failed for want of sign-in or allowance. The policy is orchestrator.mjs's; this is
// where it meets the world. Each job that runs is a line in routing.jsonl (the role, the model, why, how long and how
// it ended, never what was asked or said), the data for tuning the rules.
import {
  providerTrouble,
  seatFor,
  turnStandIn,
  usageFrom,
  seatChoices,
  type Effort,
  type OfferedModelItem,
  type PlanUsageStateInput,
  type PoolProvider,
  type PoolUsageSummary,
  type ProviderTroubleResult,
  type Role,
  type SeatChoices,
  type SeatPool,
  type TurnStandInResult,
} from './orchestrator.mjs';

// Which of Fairy's connections serves each pool.
export const KIND: Record<SeatPool, PoolProvider> = { claude: 'claude', gemini: 'antigravity', agyClaude: 'antigravity', codex: 'codex' };
// A provider that failed for want of sign-in or allowance is passed over for this long.
export const DOWN_FOR = 10 * 60 * 1000;
const NAMES: Record<SeatPool, string> = { claude: 'Claude', gemini: 'Gemini', agyClaude: 'Claude through Antigravity', codex: 'Codex' };

export interface WorkSeatSettings {
  claudeViaAntigravity?: string;
  workAutoModel?: string;
  workProvider?: string;
  workStandIns?: string;
  backend?: string;
  claudeModel?: string;
  antigravityModel?: string;
  model?: string;
  [key: string]: unknown;
}

const modelOf = (used: WorkSeatSettings): string => ({ claude: used.claudeModel, antigravity: used.antigravityModel, codex: used.model })[used.backend || ''] || '';

export interface WorkSeatStatus {
  claude?: boolean;
  gemini?: boolean;
  codex?: boolean;
}

export interface WorkSeatOffered {
  claude?: OfferedModelItem[];
  gemini?: OfferedModelItem[];
  agyClaude?: OfferedModelItem[];
  codex?: OfferedModelItem[];
}

export interface WorkSeatConnection {
  provider: unknown;
  settings: WorkSeatSettings;
  pool?: SeatPool | null;
}

export interface WorkSeatMeta {
  model: string;
  role: Role;
  standIn?: string;
}

export interface WorkSeatAssignment extends WorkSeatConnection {
  pool: SeatPool | null;
  seat: WorkSeatMeta;
}

export interface WorkSeatsState {
  auto: boolean;
  home: string | null;
  available: Record<SeatPool, boolean>;
  offered: Record<string, OfferedModelItem[]>;
  usage: Record<string, PoolUsageSummary>;
  crossProvider: boolean;
  chosen: SeatChoices;
}

export interface WorkSeatsOptions {
  settings: () => WorkSeatSettings;
  status: () => WorkSeatStatus | null | undefined;
  plans?: () => Record<string, PlanUsageStateInput | null | undefined>;
  offered?: () => WorkSeatOffered | null | undefined;
  hasKey?: () => boolean;
  connect: (kind?: PoolProvider, model?: string, effort?: Effort | null) => WorkSeatConnection;
  log?: (entry: Record<string, unknown>) => void;
  now?: () => number;
}

// settings()  Fairy's settings
// status()    { claude, gemini, codex }: whether each is signed in
// plans()     the plan usage Fairy reads every five minutes
// offered()   { claude: [...], gemini: [...], agyClaude: [...] }: what each offers, Claude through Antigravity apart
// hasKey()    whether Auto can work, which needs a Gemini key
// connect(kind, model, effort) → { provider, settings }: a connection to run a job on; no arguments is your work model
// log(entry)  a line for routing.jsonl
export class WorkSeats {
  settings: () => WorkSeatSettings;
  status: () => WorkSeatStatus | null | undefined;
  plans: () => Record<string, PlanUsageStateInput | null | undefined>;
  offered: () => WorkSeatOffered | null | undefined;
  hasKey: () => boolean;
  connect: (kind?: PoolProvider, model?: string, effort?: Effort | null) => WorkSeatConnection;
  log: (entry: Record<string, unknown>) => void;
  now: () => number;
  down: Map<SeatPool, ProviderTroubleResult & { at: number }>;
  byTask?: ((info: { role: Role; kind: string; state: WorkSeatsState }) => string | null | undefined) | null;

  constructor({ settings, status, plans = () => ({}), offered = () => ({}), hasKey = () => false, connect, log = () => {}, now = Date.now }: WorkSeatsOptions) {
    this.settings = settings;
    this.status = status;
    this.plans = plans;
    this.offered = offered;
    this.hasKey = hasKey;
    this.connect = connect;
    this.log = log;
    this.now = now;
    this.down = new Map();
  }
  isDown(pool: SeatPool): boolean {
    const entry = this.down.get(pool);
    if (entry && this.now() - entry.at > DOWN_FOR) this.down.delete(pool);
    return this.down.has(pool);
  }
  markDown(pool: SeatPool, trouble: ProviderTroubleResult): void { this.down.set(pool, { ...trouble, at: this.now() }); }
  // What the policy is told. avoid: pools that already failed this job.
  state(avoid: Set<SeatPool> = new Set()): WorkSeatsState {
    const s = this.settings(), status = this.status() || {}, offered = this.offered() || {}, viaAgy = s.claudeViaAntigravity === 'on';
    const up = (pool: SeatPool, signedIn?: boolean): boolean => Boolean(signedIn) && !this.isDown(pool) && !avoid.has(pool);
    return {
      auto: s.workAutoModel === 'on' && Boolean(this.hasKey()),
      home: ({ claude: 'claude', antigravity: 'gemini', codex: 'codex' } as Record<string, string>)[s.workProvider || 'claude'] || null,
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
  seat(role: Role, turn: WorkSeatConnection | null = null, { short = false, avoid = new Set<SeatPool>(), home = null, kind = null }: { short?: boolean; avoid?: Set<SeatPool>; home?: string | null; kind?: string | null } = {}): WorkSeatAssignment {
    const state = this.state(avoid);
    // Auto by task (stage 5): the session's provider, then the job's own pick by task, become home for this seat.
    if (home && state.available[home as SeatPool] !== false) state.home = home;
    if (kind && this.byTask) { try { const chosen = this.byTask({ role, kind, state }); if (chosen && state.available[chosen as SeatPool] !== false) state.home = chosen; } catch {} }
    const picked = seatFor(role, { ...state, home: state.home ?? undefined, ...(role === 'scout' ? { auto: true } : {}), short });
    const used = picked ? this.connect(KIND[picked.pool], picked.model, picked.effort) : turn || this.connect();
    return { ...used, pool: picked?.pool || turn?.pool || null, seat: { model: picked?.model || modelOf(used.settings), role, ...(picked?.standIn ? { standIn: picked.reason } : {}) } };
  }
  // A job on its role's seat. If that provider turns out to be signed out or at its limit, it's passed over for a while
  // and, with Move work between subscriptions on, the next seat takes the job; each pool is tried once per job.
  // home: the provider this turn's session is on, when Auto by task moved it; kind: the turn's kind of task, when Auto
  // by task is on for it, so the job's provider can be picked by task (byTask, set by main).
  async run<T>(
    role: Role,
    turn: WorkSeatConnection | null,
    job: (seat: WorkSeatAssignment) => Promise<T>,
    { short = false, onSeat = () => {}, signal, chat = '', home = null, kind = null }: { short?: boolean; onSeat?: (seat: WorkSeatMeta) => void; signal?: AbortSignal; chat?: string; home?: string | null; kind?: string | null } = {},
  ): Promise<T> {
    const avoid = new Set<SeatPool>();
    let last: (Error & { trouble: ProviderTroubleResult; pool: SeatPool }) | null = null;
    for (;;) {
      const seat = this.seat(role, turn, { short, avoid, home, kind });
      if (last && (!seat.pool || avoid.has(seat.pool))) throw last;
      if (last && seat.pool) seat.seat.standIn = `Moved to ${NAMES[seat.pool]}, because ${NAMES[last.pool]} ${last.trouble.kind === 'limit' ? 'is at a usage limit' : 'is signed out'}.`;
      onSeat(seat.seat);
      const started = this.now(), line = { chat, role, provider: (seat.pool && KIND[seat.pool]) || seat.settings?.backend || '', model: seat.seat.model, ...(seat.seat.standIn ? { standIn: seat.seat.standIn } : {}) };
      try {
        const result = await job(seat);
        this.log({ ...line, ms: this.now() - started, outcome: 'done' });
        return result;
      } catch (error: unknown) {
        const msg = error && typeof error === 'object' && 'message' in error ? (error as { message?: unknown }).message : error;
        const trouble = signal?.aborted ? null : providerTrouble(msg);
        this.log({ ...line, ms: this.now() - started, outcome: signal?.aborted ? 'stopped' : trouble ? 'moved' : 'failed', ...(trouble ? { trouble: trouble.kind } : {}) });
        if (!trouble || !seat.pool) throw error;
        this.markDown(seat.pool, trouble);
        if (this.settings().workStandIns !== 'on') throw error;
        avoid.add(seat.pool); last = Object.assign(error as Error, { trouble, pool: seat.pool });
      }
    }
  }
  // Whether the turn itself goes to your other subscription, because yours is signed out, failed for want of sign-in
  // or allowance in the last few minutes, or is nearly full. Only on Auto with Move work between subscriptions on.
  turnProvider(): TurnStandInResult | null {
    const state = this.state();
    if (!state.auto || !state.crossProvider || !state.home) return null;
    return turnStandIn(state.home, state);
  }
}
