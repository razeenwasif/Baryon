// Doc 7, #6: Run trace — structured timeline of one work turn: each step, tool, model seat, duration,
// tokens, handoff brief/report (builders, helpers, workers, critic), and matching routing.jsonl events.
// Works both on newly recorded turns (with startedAt/ms/handoff/toolCalls) and on older saved work turns.
import { readFile } from 'node:fs/promises';

export interface SeatInput {
  model?: unknown;
  provider?: unknown;
  role?: unknown;
  effort?: unknown;
  standIn?: unknown;
  why?: unknown;
}

export interface SeatInfo {
  model: string;
  provider?: string;
  role?: string;
  effort?: string;
  standIn?: string;
  why?: string;
}

export interface HandoffInput {
  kind?: unknown;
  brief?: unknown;
  report?: unknown;
  attempt?: unknown;
  outcome?: unknown;
  check?: unknown;
  passed?: unknown;
  status?: unknown;
}

export interface HandoffInfo {
  kind: string;
  brief: string;
  report: string;
  attempt?: number;
  outcome?: string;
  check?: string;
  passed?: boolean;
  status?: string;
}

export interface ActivityRow {
  id?: unknown;
  tool?: unknown;
  summary?: unknown;
  reason?: unknown;
  output?: unknown;
  status?: unknown;
  detail?: unknown;
  ms?: unknown;
  startedAt?: unknown;
  run?: unknown;
  seat?: SeatInput | null;
  handoff?: HandoffInput | null;
  steps?: unknown[];
}

export interface ToolCallInput {
  name?: unknown;
  ms?: unknown;
  outcome?: unknown;
}

export type ToolOutcome = 'ok' | 'failed' | 'refused' | 'invalid' | 'unknown';

export interface ToolCallSummary {
  calls: number;
  ms: number;
  ok: number;
  failed: number;
  refused: number;
  invalid: number;
  unknown: number;
}

export interface ToolLedgerStats {
  calls?: number;
  chars?: number;
  images?: number;
}

export interface MergedToolStats {
  calls: number;
  chars: number;
  images: number;
  ms: number;
  failed: number;
}

export interface TokenUsageCounts {
  input?: unknown;
  output?: unknown;
  cached?: unknown;
}

export interface NormalizedTokens {
  input: number;
  output: number;
  cached: number;
}

export interface RoutingLine {
  at?: string;
  chat?: string;
  type?: string;
  role?: string;
  provider?: string;
  model?: string;
  kind?: string;
  outcome?: string;
  ms?: unknown;
  standIn?: string;
  why?: string;
  passed?: unknown;
  tokens?: TokenUsageCounts | null;
}

export interface RoutingEvent {
  at: string;
  type: string;
  role: string;
  provider: string;
  model: string;
  kind: string;
  outcome: string;
  ms: number | null;
  standIn: string;
  why: string;
  passed: boolean | null;
  tokens: TokenUsageCounts | null;
}

export interface LedgerInput {
  at?: unknown;
  session?: unknown;
  steps?: unknown;
  sent?: unknown;
  images?: unknown;
  parts?: Record<string, unknown> | null;
  reported?: TokenUsageCounts | null;
  byTool?: Record<string, ToolLedgerStats>;
}

export interface LedgerSummary {
  steps: number;
  sent: number;
  images: number;
  parts: Record<string, unknown> | null;
}

export interface AutoInput {
  model?: unknown;
  provider?: unknown;
  role?: unknown;
  effort?: unknown;
  standIn?: unknown;
  why?: unknown;
  kind?: unknown;
  shape?: unknown;
  route?: { shape?: unknown } | null;
}

export interface AutoSummary {
  model: string;
  provider: string;
  effort: string;
  kind: string;
  shape: string;
  why: string;
  standIn: string;
}

export interface VerdictInput {
  status?: string;
  line?: string;
  tooltip?: string;
}

export interface VerdictSummary {
  status: string;
  line: string;
  tooltip: string;
}

export interface ModelSeen {
  role: string;
  model: string;
  provider?: string;
  effort?: string;
  standIn?: string;
  count: number;
}

export interface TraceStep {
  index: number;
  id: string;
  kind: 'handoff' | 'tool';
  tool: string;
  summary: string;
  status: string;
  detail: string;
  ms: number | null;
  offsetMs: number | null;
  seat: SeatInfo | null;
  run?: string;
  handoff?: HandoffInfo;
  output?: string;
  substeps?: number;
}

export interface TurnTrace {
  id: string;
  session: string;
  at: string;
  replyAt: string;
  request: string;
  outcome: string;
  ended: string;
  ms: number;
  seat: SeatInfo | null;
  auto: AutoSummary | null;
  verdict: VerdictSummary | null;
  tokens: NormalizedTokens | null;
  ledger: LedgerSummary | null;
  byTool: Record<string, MergedToolStats>;
  models: ModelSeen[];
  stepCount: number;
  handoffCount: number;
  failedCount: number;
  timeline: TraceStep[];
  routing: RoutingEvent[];
}

export interface BuildTurnTraceOptions {
  session?: string;
  at?: string;
  replyAt?: string;
  request?: string;
  seat?: SeatInput | null;
  auto?: AutoInput | null;
  outcome?: string;
  ended?: string;
  ms?: number;
  usage?: TokenUsageCounts | null;
  ledger?: LedgerInput | null;
  verdict?: VerdictInput | null;
  activity?: ActivityRow[];
  toolCalls?: ToolCallInput[];
  routing?: RoutingLine[];
}

export interface SessionHistoryEntry {
  role?: string;
  mode?: string;
  at?: string;
  replyTo?: string;
  content?: string;
  seat?: SeatInput | null;
  auto?: AutoInput | null;
  unfinished?: boolean;
  ended?: string;
  durationMs?: number;
  usage?: TokenUsageCounts | null;
  ledger?: LedgerInput | null;
  verdict?: VerdictInput | null;
  activity?: ActivityRow[];
  toolCalls?: ToolCallInput[];
}

export interface TracesForSessionOptions {
  session?: string;
  history?: SessionHistoryEntry[];
  routingLines?: RoutingLine[];
  ledgerLines?: LedgerInput[];
}

const clip = (text: unknown, limit = 1500): string => {
  const value = String(text ?? '');
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
};

const toMs = (iso: unknown): number => {
  if (typeof iso === 'number' && Number.isFinite(iso)) return iso;
  const parsed = Date.parse(String(iso || ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

export async function readJsonlTail(path: string, { limit = 2000 }: { limit?: number } = {}): Promise<Record<string, unknown>[]> {
  let raw = '';
  try { raw = await readFile(path, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return []; throw error; }
  const lines = raw.split('\n').filter(Boolean);
  const slice = limit > 0 && lines.length > limit ? lines.slice(-limit) : lines;
  const out: Record<string, unknown>[] = [];
  for (const line of slice) {
    try { const parsed: unknown = JSON.parse(line); if (parsed && typeof parsed === 'object') out.push(parsed as Record<string, unknown>); } catch {}
  }
  return out;
}

const HANDOFF_TOOLS = new Set(['step', 'helper', 'worker', 'critic']);
const TOOL_KIND_MAP: Record<string, string> = { step: 'builder', helper: 'helper', worker: 'worker', critic: 'critic' };
const VALID_OUTCOMES: readonly ToolOutcome[] = ['ok', 'failed', 'refused', 'invalid', 'unknown'];

function normalizeSeat(seat: SeatInput | null | undefined): SeatInfo | null {
  if (!seat || typeof seat !== 'object' || !seat.model) return null;
  return {
    model: String(seat.model),
    ...(seat.provider ? { provider: String(seat.provider) } : {}),
    ...(seat.role ? { role: String(seat.role) } : {}),
    ...(seat.effort ? { effort: String(seat.effort) } : {}),
    ...(seat.standIn ? { standIn: String(seat.standIn) } : {}),
    ...(seat.why ? { why: String(seat.why) } : {}),
  };
}

function extractHandoff(row: ActivityRow | null | undefined): HandoffInfo | null {
  if (row?.handoff && typeof row.handoff === 'object') {
    return {
      kind: String(row.handoff.kind || row.tool || 'handoff'),
      brief: clip(row.handoff.brief || '', 2000),
      report: clip(row.handoff.report || '', 4000),
      ...(row.handoff.attempt ? { attempt: Number(row.handoff.attempt) } : {}),
      ...(row.handoff.outcome ? { outcome: String(row.handoff.outcome) } : {}),
      ...(row.handoff.check ? { check: clip(row.handoff.check, 400) } : {}),
      ...(typeof row.handoff.passed === 'boolean' ? { passed: row.handoff.passed } : {}),
      ...(row.handoff.status ? { status: String(row.handoff.status) } : {}),
    };
  }
  if (typeof row?.tool !== 'string' || !HANDOFF_TOOLS.has(row.tool)) return null;
  const brief = row.tool === 'helper' ? (row.summary || '') : (row.reason || '');
  const report = row.output || '';
  if (!brief && !report) return null;
  const kind = TOOL_KIND_MAP[row.tool] || row.tool;
  return { kind, brief: clip(brief, 2000), report: clip(report, 4000) };
}

function summarizeCalls(calls: ToolCallInput[] = []): Record<string, ToolCallSummary> {
  const byTool: Record<string, ToolCallSummary> = {};
  for (const call of Array.isArray(calls) ? calls : []) {
    if (!call?.name) continue;
    const name = String(call.name);
    const item = byTool[name] ||= { calls: 0, ms: 0, ok: 0, failed: 0, refused: 0, invalid: 0, unknown: 0 };
    item.calls += 1;
    item.ms += Math.max(0, Number(call.ms) || 0);
    const out: ToolOutcome = VALID_OUTCOMES.includes(call.outcome as ToolOutcome) ? (call.outcome as ToolOutcome) : 'ok';
    item[out] += 1;
  }
  return byTool;
}

export function buildTurnTrace({
  session = '',
  at = '',
  replyAt = '',
  request = '',
  seat = null,
  auto = null,
  outcome = 'done',
  ended = 'done',
  ms = 0,
  usage = null,
  ledger = null,
  verdict = null,
  activity = [],
  toolCalls = [],
  routing = [],
}: BuildTurnTraceOptions = {}): TurnTrace {
  const startEpoch = toMs(at);
  const endEpoch = toMs(replyAt);
  const computedMs = Number.isFinite(Number(ms)) && Number(ms) > 0
    ? Math.round(Number(ms))
    : (startEpoch && endEpoch && endEpoch >= startEpoch ? endEpoch - startEpoch : 0);

  const primarySeat = normalizeSeat(seat) || (auto?.model ? normalizeSeat({
    model: auto.model,
    provider: auto.provider,
    role: auto.role || 'turn',
    effort: auto.effort,
    standIn: auto.standIn,
    why: auto.why,
  }) : null);

  const steps: TraceStep[] = [];
  let nonThoughtIndex = 0;
  let totalStepMs = 0;
  const modelsSeen = new Map<string, ModelSeen>();
  const noteModel = (s: SeatInfo | null | undefined, fallbackRole = 'turn'): void => {
    if (!s?.model) return;
    const role = s.role || fallbackRole;
    const key = `${role}:${s.model}`;
    let entry = modelsSeen.get(key);
    if (!entry) {
      entry = {
        role,
        model: s.model,
        ...(s.provider ? { provider: s.provider } : {}),
        ...(s.effort ? { effort: s.effort } : {}),
        ...(s.standIn ? { standIn: s.standIn } : {}),
        count: 0,
      };
      modelsSeen.set(key, entry);
    }
    entry.count += 1;
  };
  if (primarySeat) noteModel(primarySeat, primarySeat.role || 'turn');

  const rawActivity = Array.isArray(activity) ? activity : [];
  for (const row of rawActivity) {
    if (!row || typeof row !== 'object') continue;
    if (row.tool === 'thought') continue;
    const stepSeat = normalizeSeat(row.seat);
    if (stepSeat) noteModel(stepSeat, row.tool === 'step' ? 'builder' : row.tool === 'critic' ? 'critic' : 'helper');
    const handoff = extractHandoff(row);
    const stepMs = Number.isFinite(Number(row.ms)) && Number(row.ms) >= 0 ? Math.round(Number(row.ms)) : null;
    if (stepMs !== null) totalStepMs += stepMs;
    const startedAt = Number.isFinite(Number(row.startedAt)) ? Number(row.startedAt) : null;
    const offsetMs = startedAt && startEpoch ? Math.max(0, startedAt - startEpoch) : null;
    nonThoughtIndex += 1;
    steps.push({
      index: nonThoughtIndex,
      id: String(row.id || `step-${nonThoughtIndex}`),
      kind: handoff ? 'handoff' : 'tool',
      tool: String(row.tool || 'step'),
      summary: clip(row.summary || '', 240),
      status: String(row.status || 'done'),
      detail: clip(row.detail || '', 160),
      ms: stepMs,
      offsetMs,
      seat: stepSeat,
      ...(row.run ? { run: String(row.run) } : {}),
      ...(handoff ? { handoff } : {}),
      ...(row.output && !handoff ? { output: clip(row.output, 1200) } : {}),
      ...(Array.isArray(row.steps) && row.steps.length ? { substeps: row.steps.length } : {}),
    });
  }

  // Merge call-log timing/outcomes with token-ledger per-tool char sizes.
  const callSummary = summarizeCalls(toolCalls);
  const byTool: Record<string, MergedToolStats> = {};
  for (const [name, info] of Object.entries(ledger?.byTool || {})) {
    byTool[name] = {
      calls: info.calls || 0,
      chars: info.chars || 0,
      images: info.images || 0,
      ms: callSummary[name]?.ms || 0,
      failed: (callSummary[name]?.failed || 0) + (callSummary[name]?.refused || 0) + (callSummary[name]?.invalid || 0),
    };
  }
  for (const [name, info] of Object.entries(callSummary)) {
    if (!byTool[name]) {
      byTool[name] = { calls: info.calls, chars: 0, images: 0, ms: info.ms, failed: info.failed + info.refused + info.invalid };
    }
  }

  const totalMs = computedMs || totalStepMs;
  const routingEvents: RoutingEvent[] = (Array.isArray(routing) ? routing : []).map(item => ({
    at: item.at || '',
    type: item.type || (item.role ? 'seat' : 'route'),
    role: item.role || '',
    provider: item.provider || '',
    model: item.model || '',
    kind: item.kind || '',
    outcome: item.outcome || '',
    ms: Number.isFinite(Number(item.ms)) ? Math.round(Number(item.ms)) : null,
    standIn: item.standIn || '',
    why: item.why || '',
    passed: typeof item.passed === 'boolean' ? item.passed : null,
    tokens: item.tokens || null,
  }));

  for (const ev of routingEvents) {
    if (ev.model && ev.role) noteModel({ model: ev.model, provider: ev.provider, role: ev.role, standIn: ev.standIn }, ev.role);
  }

  const tokens: NormalizedTokens | null = usage && (usage.input || usage.output || usage.cached)
    ? { input: Number(usage.input) || 0, output: Number(usage.output) || 0, cached: Number(usage.cached) || 0 }
    : (ledger?.reported ? { input: Number(ledger.reported.input) || 0, output: Number(ledger.reported.output) || 0, cached: Number(ledger.reported.cached) || 0 } : null);

  return {
    id: String(at || replyAt || 'turn'),
    session: String(session || ''),
    at: String(at || ''),
    replyAt: String(replyAt || ''),
    request: clip(request || '', 300),
    outcome: String(outcome || 'done'),
    ended: String(ended || outcome || 'done'),
    ms: totalMs,
    seat: primarySeat,
    auto: auto ? {
      model: String(auto.model || ''),
      provider: String(auto.provider || ''),
      effort: String(auto.effort || ''),
      kind: String(auto.kind || ''),
      shape: String(auto.shape || auto.route?.shape || ''),
      why: clip(auto.why || '', 300),
      standIn: String(auto.standIn || ''),
    } : null,
    verdict: verdict?.line ? { status: verdict.status || 'not-checked', line: verdict.line, tooltip: verdict.tooltip || '' } : null,
    tokens,
    ledger: ledger ? {
      steps: Number(ledger.steps) || 0,
      sent: Number(ledger.sent) || 0,
      images: Number(ledger.images) || 0,
      parts: ledger.parts ? { ...ledger.parts } : null,
    } : null,
    byTool,
    models: [...modelsSeen.values()],
    stepCount: steps.length,
    handoffCount: steps.filter(step => step.kind === 'handoff').length,
    failedCount: steps.filter(step => step.status === 'failed').length,
    timeline: steps,
    routing: routingEvents,
  };
}

// Reconstructs run traces for every work turn in a chat, correlating routing.jsonl & token-ledger.jsonl.
export function tracesForSession({ session = '', history = [], routingLines = [], ledgerLines = [] }: TracesForSessionOptions = {}): TurnTrace[] {
  const entries = Array.isArray(history) ? history : [];
  const chatRouting = (Array.isArray(routingLines) ? routingLines : []).filter(line => !session || !line.chat || line.chat === session);
  const chatLedger = (Array.isArray(ledgerLines) ? ledgerLines : []).filter(line => !session || !line.session || line.session === session);

  const usersByAt = new Map<string, SessionHistoryEntry>();
  let lastUser: SessionHistoryEntry | null = null;
  const traces: TurnTrace[] = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.role === 'user') {
      if (entry.at) usersByAt.set(entry.at, entry);
      lastUser = entry;
      continue;
    }
    if (entry.role !== 'assistant' || entry.mode !== 'work') continue;
    const ask = (entry.replyTo && usersByAt.get(entry.replyTo)) || lastUser;
    const askAt = entry.replyTo || ask?.at || '';
    const replyAt = entry.at || '';
    const startMs = toMs(askAt);
    const endMs = toMs(replyAt);

    // Match routing events belonging to this turn's time window.
    const matchingRouting = chatRouting.filter(line => {
      if (line.chat && session && line.chat !== session) return false;
      const t = toMs(line.at);
      if (!t || (!startMs && !endMs)) return false;
      const lo = (startMs || endMs) - 3000;
      const hi = (endMs || startMs) + 5000;
      return t >= lo && t <= hi;
    });

    // Fall back to token-ledger.jsonl when an older saved message didn't embed `ledger`.
    let ledger = entry.ledger || null;
    if (!ledger && (startMs || endMs)) {
      const matched = chatLedger.find(line => {
        const t = toMs(line.at);
        if (!t) return false;
        const lo = (startMs || endMs) - 3000;
        const hi = (endMs || startMs) + 5000;
        return t >= lo && t <= hi;
      });
      if (matched) ledger = matched;
    }

    const turnSeatFromRouting = matchingRouting.find(item => item.role === 'turn' || item.role === 'lead' || item.role === 'swarm-build');
    const seat: SeatInput | null = entry.seat || (turnSeatFromRouting ? {
      model: turnSeatFromRouting.model,
      provider: turnSeatFromRouting.provider,
      role: turnSeatFromRouting.role,
      standIn: turnSeatFromRouting.standIn,
    } : null);

    const outcome = entry.unfinished ? (entry.ended === 'you' ? 'stopped' : 'failed') : 'done';
    traces.push(buildTurnTrace({
      session,
      at: askAt,
      replyAt,
      request: ask?.content || '',
      seat,
      auto: entry.auto || null,
      outcome,
      ended: entry.ended || outcome,
      ms: entry.durationMs || Number(turnSeatFromRouting?.ms) || 0,
      usage: entry.usage || turnSeatFromRouting?.tokens || null,
      ledger,
      verdict: entry.verdict || null,
      activity: entry.activity || [],
      toolCalls: entry.toolCalls || [],
      routing: matchingRouting,
    }));
  }

  return traces.reverse();
}

export function formatDuration(ms: unknown): string {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 1000) return `${Math.round(n)} ms`;
  if (n < 60000) return `${(n / 1000).toFixed(1)} s`;
  const mins = Math.floor(n / 60000);
  const secs = Math.round((n % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

export function traceMarkdown(trace: TurnTrace | null | undefined): string {
  if (!trace) return '';
  const lines = [
    `# Run trace (${trace.at || trace.replyAt || 'turn'})`,
    `- **Request**: ${trace.request || '(none)'}`,
    `- **Outcome**: ${trace.outcome}${trace.ended && trace.ended !== trace.outcome ? ` (${trace.ended})` : ''} · **Duration**: ${formatDuration(trace.ms)}`,
  ];
  if (trace.seat?.model) lines.push(`- **Model**: ${trace.seat.model} (${trace.seat.role || 'turn'}${trace.seat.provider ? `, ${trace.seat.provider}` : ''})${trace.seat.standIn ? ` · stand-in: ${trace.seat.standIn}` : ''}`);
  if (trace.auto?.why) lines.push(`- **Routing**: ${trace.auto.why}`);
  if (trace.verdict?.line) lines.push(`- **Verdict**: ${trace.verdict.line}`);
  if (trace.tokens) lines.push(`- **Tokens**: ${trace.tokens.input.toLocaleString()} in / ${trace.tokens.output.toLocaleString()} out${trace.tokens.cached ? ` (${trace.tokens.cached.toLocaleString()} cached)` : ''}`);
  if (trace.timeline?.length) {
    lines.push('', '## Steps');
    for (const step of trace.timeline) {
      const seatTag = step.seat?.model ? ` [${step.seat.role || 'helper'}: ${step.seat.model}]` : '';
      const dur = step.ms !== null ? ` (${formatDuration(step.ms)})` : '';
      lines.push(`${step.index}. **${step.tool}** ${step.summary} — ${step.status}${dur}${seatTag}${step.detail ? ` · ${step.detail}` : ''}`);
      if (step.handoff) {
        if (step.handoff.brief) lines.push(`   - Brief: ${step.handoff.brief.replace(/\s+/g, ' ').slice(0, 300)}`);
        if (step.handoff.report) lines.push(`   - Report: ${step.handoff.report.replace(/\s+/g, ' ').slice(0, 300)}`);
      }
    }
  }
  return lines.join('\n');
}
