// Doc 7, #6: Run trace — structured timeline of one work turn: each step, tool, model seat, duration,
// tokens, handoff brief/report (builders, helpers, workers, critic), and matching routing.jsonl events.
// Works both on newly recorded turns (with startedAt/ms/handoff/toolCalls) and on older saved work turns.
import { readFile } from 'node:fs/promises';

const clip = (text, limit = 1500) => {
  const value = String(text ?? '');
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
};

const toMs = iso => {
  if (typeof iso === 'number' && Number.isFinite(iso)) return iso;
  const parsed = Date.parse(String(iso || ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

export async function readJsonlTail(path, { limit = 2000 } = {}) {
  let raw = '';
  try { raw = await readFile(path, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const lines = raw.split('\n').filter(Boolean);
  const slice = limit > 0 && lines.length > limit ? lines.slice(-limit) : lines;
  const out = [];
  for (const line of slice) {
    try { const parsed = JSON.parse(line); if (parsed && typeof parsed === 'object') out.push(parsed); } catch {}
  }
  return out;
}

const HANDOFF_TOOLS = new Set(['step', 'helper', 'worker', 'critic']);

function normalizeSeat(seat) {
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

function extractHandoff(row) {
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
  if (!HANDOFF_TOOLS.has(row?.tool)) return null;
  const brief = row.tool === 'helper' ? (row.summary || '') : (row.reason || '');
  const report = row.output || '';
  if (!brief && !report) return null;
  const kind = { step: 'builder', helper: 'helper', worker: 'worker', critic: 'critic' }[row.tool] || row.tool;
  return { kind, brief: clip(brief, 2000), report: clip(report, 4000) };
}

function summarizeCalls(calls = []) {
  const byTool = {};
  for (const call of Array.isArray(calls) ? calls : []) {
    if (!call?.name) continue;
    const item = byTool[call.name] ||= { calls: 0, ms: 0, ok: 0, failed: 0, refused: 0, invalid: 0, unknown: 0 };
    item.calls += 1;
    item.ms += Math.max(0, Number(call.ms) || 0);
    const out = ['ok', 'failed', 'refused', 'invalid', 'unknown'].includes(call.outcome) ? call.outcome : 'ok';
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
} = {}) {
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

  const steps = [];
  let nonThoughtIndex = 0;
  let totalStepMs = 0;
  const modelsSeen = new Map();
  const noteModel = (s, fallbackRole = 'turn') => {
    if (!s?.model) return;
    const role = s.role || fallbackRole;
    const key = `${role}:${s.model}`;
    if (!modelsSeen.has(key)) modelsSeen.set(key, { role, model: s.model, ...(s.provider ? { provider: s.provider } : {}), ...(s.effort ? { effort: s.effort } : {}), ...(s.standIn ? { standIn: s.standIn } : {}), count: 0 });
    modelsSeen.get(key).count += 1;
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
  const byTool = {};
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
  const routingEvents = (Array.isArray(routing) ? routing : []).map(item => ({
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

  const tokens = usage && (usage.input || usage.output || usage.cached)
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
      model: auto.model || '',
      provider: auto.provider || '',
      effort: auto.effort || '',
      kind: auto.kind || '',
      shape: auto.shape || auto.route?.shape || '',
      why: clip(auto.why || '', 300),
      standIn: auto.standIn || '',
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
export function tracesForSession({ session = '', history = [], routingLines = [], ledgerLines = [] } = {}) {
  const entries = Array.isArray(history) ? history : [];
  const chatRouting = (Array.isArray(routingLines) ? routingLines : []).filter(line => !session || !line.chat || line.chat === session);
  const chatLedger = (Array.isArray(ledgerLines) ? ledgerLines : []).filter(line => !session || !line.session || line.session === session);

  const usersByAt = new Map();
  let lastUser = null;
  const traces = [];

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
    const seat = entry.seat || (turnSeatFromRouting ? {
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
      ms: entry.durationMs || turnSeatFromRouting?.ms || 0,
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

export function formatDuration(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 1000) return `${Math.round(n)} ms`;
  if (n < 60000) return `${(n / 1000).toFixed(1)} s`;
  const mins = Math.floor(n / 60000);
  const secs = Math.round((n % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

export function traceMarkdown(trace) {
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
