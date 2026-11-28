// Plan cost & usage forecast for Doc 7 #15:
// Combines plan step parsing, routing.jsonl historical turn averages, Orchestrator seats, and PlanUsage meters
// to estimate per-role calls, duration, and 5-hour usage impact before approving a plan.
import { pick, seatFor, type Bias, type PickState, type Role } from './orchestrator.mjs';
import { parseResetTime, type PlanUsageMap } from './off-peak-queue.mjs';
import { readJsonlTail } from './run-trace.mjs';

export type ForecastProvider = 'claude' | 'gemini' | 'codex';
export type ForecastStepRole = 'builder' | 'critic' | 'scout';

export interface PlanStep {
  text: string;
  role: ForecastStepRole;
  small: boolean;
}

export interface RoutingHistoryLine {
  type?: unknown;
  role?: unknown;
  ms?: unknown;
  tokens?: {
    input?: unknown;
    output?: unknown;
  } | null;
  [key: string]: unknown;
}

export interface RoleHistoryAverage {
  samples: number;
  avgMs: number;
  avgTokens: number;
  fromHistory: boolean;
}

export interface RoleForecast {
  calls: number;
  provider: ForecastProvider;
  model: string;
  estTokens: number;
  estMs: number;
  fromHistory: boolean;
}

export interface ProviderForecast {
  provider: ForecastProvider;
  calls: number;
  estTokens: number;
  currentFiveHourPct?: number | null;
  currentWeekPct?: number | null;
  estFiveHourDeltaPct?: number;
  projectedFiveHourPct?: number | null;
  resets?: string;
  minsUntilReset?: number | null;
}

export interface ForecastPlanOptions {
  plan?: string;
  routingLines?: RoutingHistoryLine[];
  plans?: PlanUsageMap;
  bias?: Bias | string;
  home?: string;
  seatState?: PickState | null;
  now?: Date;
}

export interface ForecastPlanFromFilesOptions {
  plan?: string;
  routingPath?: string;
  plans?: PlanUsageMap;
  bias?: Bias | string;
  home?: string;
  seatState?: PickState | null;
  now?: Date;
}

export interface PlanForecastResult {
  stepsCount: number;
  totalCalls: number;
  totalTokens: number;
  estimatedMinutes: number;
  bias: string;
  byRole: Partial<Record<Role, RoleForecast>>;
  byProvider: Partial<Record<ForecastProvider, ProviderForecast>>;
  saverTokens: number;
  savedPctVsCurrent: number;
  recommendation: 'proceed' | 'wait' | 'saver';
  advisory: string;
  summary: string;
}

const ROLE_DEFAULTS: Readonly<Record<Role, { ms: number; tokens: number }>> = Object.freeze({
  scout: { ms: 12_000, tokens: 8_000 },
  builder: { ms: 40_000, tokens: 28_000 },
  lead: { ms: 55_000, tokens: 42_000 },
  critic: { ms: 25_000, tokens: 18_000 },
});

// Conservative 5-hour token allowances per pool so delta estimates stay grounded without hardcoding private tiers.
const FIVE_HOUR_BUDGET_TOKENS: Readonly<Record<ForecastProvider, number>> = Object.freeze({
  claude: 1_500_000,
  gemini: 2_500_000,
  codex: 2_000_000,
});

const BIAS_TOKEN_SCALE: Readonly<Record<Bias, number>> = Object.freeze({
  quality: 1.25,
  balanced: 1.0,
  saver: 0.65,
});

const SCOUT_HINT = /\b(?:search|find|inspect|read|check|verify|list|scan|lookup|gather|audit)\b/i;
const CRITIC_HINT = /\b(?:review|critique|validate|second opinion|diff check)\b/i;
const BUILDER_HINT = /\b(?:create|edit|write|implement|update|wire|fix|refactor|migrate|build|add|remove|test)\b/i;

export function parsePlanSteps(planText: unknown): PlanStep[] {
  const raw = String(planText || '').trim();
  if (!raw) return [];
  const lines = raw.split(/\r?\n/);
  const steps: PlanStep[] = [];
  for (const line of lines) {
    const m = /^\s*(?:[-*]\s+\[[ xX]\]\s+|\d+[.)]\s+|[-*]\s+)(.+)$/.exec(line);
    if (!m) continue;
    const text = m[1].trim();
    if (!text) continue;
    let role: ForecastStepRole = 'builder';
    if (CRITIC_HINT.test(text) && !BUILDER_HINT.test(text)) role = 'critic';
    else if (SCOUT_HINT.test(text) && !BUILDER_HINT.test(text)) role = 'scout';
    steps.push({ text: text.slice(0, 200), role, small: text.length < 48 });
  }
  if (!steps.length) {
    steps.push({ text: raw.slice(0, 200), role: 'builder', small: raw.length < 160 });
  }
  return steps.slice(0, 30);
}

function normProvider(raw: unknown): ForecastProvider {
  const p = String(raw || '').toLowerCase();
  if (p === 'antigravity' || p === 'gemini') return 'gemini';
  if (p === 'codex' || p === 'openai') return 'codex';
  return 'claude';
}

export function summarizeRoutingHistory(routingLines: RoutingHistoryLine[] = []): Record<Role, RoleHistoryAverage> {
  const acc: Record<Role, { count: number; msSum: number; tokenCount: number; tokenSum: number }> = {
    scout: { count: 0, msSum: 0, tokenCount: 0, tokenSum: 0 },
    builder: { count: 0, msSum: 0, tokenCount: 0, tokenSum: 0 },
    lead: { count: 0, msSum: 0, tokenCount: 0, tokenSum: 0 },
    critic: { count: 0, msSum: 0, tokenCount: 0, tokenSum: 0 },
  };
  for (const line of Array.isArray(routingLines) ? routingLines : []) {
    if (!line || typeof line !== 'object') continue;
    if (line.type === 'check' || line.type === 'goal-step' || line.type === 'goal-own') continue;
    const rawRole = line.role === 'turn' || line.role === 'swarm-build' ? 'builder' : line.role;
    if (typeof rawRole !== 'string' || !Object.hasOwn(acc, rawRole)) continue;
    const bucket = acc[rawRole as Role];
    bucket.count += 1;
    if (typeof line.ms === 'number' && Number.isFinite(line.ms) && line.ms > 0) bucket.msSum += line.ms;
    const tok = (Number(line.tokens?.input) || 0) + (Number(line.tokens?.output) || 0);
    if (tok > 0) {
      bucket.tokenCount += 1;
      bucket.tokenSum += tok;
    }
  }
  const out = {} as Record<Role, RoleHistoryAverage>;
  for (const role of Object.keys(ROLE_DEFAULTS) as Role[]) {
    const def = ROLE_DEFAULTS[role];
    const b = acc[role];
    out[role] = {
      samples: b.count,
      avgMs: b.count > 0 && b.msSum > 0 ? Math.round(b.msSum / b.count) : def.ms,
      avgTokens: b.tokenCount > 0 ? Math.round(b.tokenSum / b.tokenCount) : def.tokens,
      fromHistory: b.count > 0,
    };
  }
  return out;
}

function meterInfo(plans: PlanUsageMap, provider: ForecastProvider): { usedFiveHour: number | null; resets: string; usedWeek: number | null } {
  const plan = plans?.[provider];
  const meters = Array.isArray(plan?.meters) ? plan.meters : [];
  const five = meters.find(m => m.short === '5h' || /5[- ]?hour|five hour/i.test(String(m.label || '')));
  const week = meters.find(m => m.short === 'Week' || /week/i.test(String(m.label || '')));
  return {
    usedFiveHour: typeof five?.used === 'number' && Number.isFinite(five.used) ? five.used : null,
    resets: typeof five?.resets === 'string' ? five.resets : String(five?.resets || ''),
    usedWeek: typeof week?.used === 'number' && Number.isFinite(week.used) ? week.used : null,
  };
}

export function forecastPlan({
  plan = '',
  routingLines = [],
  plans = {},
  bias = 'balanced',
  home = 'claude',
  seatState = null,
  now = new Date(),
}: ForecastPlanOptions = {}): PlanForecastResult {
  const steps = parsePlanSteps(plan);
  const averages = summarizeRoutingHistory(routingLines);
  const scale = BIAS_TOKEN_SCALE[bias as Bias] ?? 1.0;

  // Plan execution uses: lead (orchestration / synthesis), step workers (builder or scout), plus critic review on multi-step plans.
  const callsByRole: Record<Role, number> = { lead: 1, builder: 0, scout: 0, critic: steps.length >= 2 ? 1 : 0 };
  for (const s of steps) {
    if (callsByRole[s.role] !== undefined) callsByRole[s.role] += 1;
    else callsByRole.builder += 1;
  }

  const byRole: Partial<Record<Role, RoleForecast>> = {};
  const byProvider: Partial<Record<ForecastProvider, ProviderForecast>> = {};
  let totalCalls = 0;
  let totalTokens = 0;
  let totalMs = 0;

  for (const role of ['lead', 'builder', 'scout', 'critic'] as const) {
    const calls = callsByRole[role];
    if (!calls) continue;
    const seatInput: PickState | null = seatState ? { ...seatState, bias: bias as Bias } : null;
    const picked = seatInput ? (role === 'lead' ? pick('lead', seatInput) : seatFor(role, seatInput)) : null;
    const provider = normProvider(picked?.provider || home);
    const avg = averages[role];
    const roleScale = role === 'lead' ? 1 : scale;
    const estTokens = Math.round(calls * avg.avgTokens * roleScale);
    const estMs = Math.round(calls * avg.avgMs * (role === 'lead' ? 1 : 0.75 + 0.25 * roleScale));
    byRole[role] = {
      calls,
      provider,
      model: picked?.model || '',
      estTokens,
      estMs,
      fromHistory: avg.fromHistory,
    };
    const p = (byProvider[provider] ||= { provider, calls: 0, estTokens: 0 });
    p.calls += calls;
    p.estTokens += estTokens;
    totalCalls += calls;
    totalTokens += estTokens;
    totalMs += estMs;
  }

  let peakProjectedFiveHour = 0;
  let peakCurrentFiveHour = 0;
  let soonestReset: { provider: ForecastProvider; minsUntilReset: number; resets: string } | null = null;

  for (const provider of Object.keys(byProvider) as ForecastProvider[]) {
    const entry = byProvider[provider]!;
    const meter = meterInfo(plans, provider);
    const budget = FIVE_HOUR_BUDGET_TOKENS[provider] || FIVE_HOUR_BUDGET_TOKENS.claude;
    const estDeltaPct = Math.round((entry.estTokens / budget) * 1000) / 10;
    const projectedFiveHourPct = meter.usedFiveHour != null
      ? Math.min(100, Math.round((meter.usedFiveHour + estDeltaPct) * 10) / 10)
      : null;
    const resetMs = meter.resets ? parseResetTime(meter.resets, now.getTime()) : null;
    const minsUntilReset = resetMs !== null && Number.isFinite(resetMs) ? Math.max(0, Math.round((resetMs - now.getTime()) / 60_000)) : null;

    entry.currentFiveHourPct = meter.usedFiveHour;
    entry.currentWeekPct = meter.usedWeek;
    entry.estFiveHourDeltaPct = estDeltaPct;
    entry.projectedFiveHourPct = projectedFiveHourPct;
    entry.resets = meter.resets;
    entry.minsUntilReset = minsUntilReset;

    if (meter.usedFiveHour != null) peakCurrentFiveHour = Math.max(peakCurrentFiveHour, meter.usedFiveHour);
    if (projectedFiveHourPct != null) peakProjectedFiveHour = Math.max(peakProjectedFiveHour, projectedFiveHourPct);
    if (minsUntilReset != null && (soonestReset == null || minsUntilReset < soonestReset.minsUntilReset)) {
      soonestReset = { provider, minsUntilReset, resets: meter.resets };
    }
  }

  const saverTokens = (Object.entries(byRole) as Array<[Role, RoleForecast]>).reduce(
    (sum, [role, info]) => sum + Math.round(info.calls * averages[role].avgTokens * (role === 'lead' ? 1 : BIAS_TOKEN_SCALE.saver)),
    0,
  );
  const savedPctVsCurrent = totalTokens > 0 ? Math.max(0, Math.round(((totalTokens - saverTokens) / totalTokens) * 100)) : 0;

  let recommendation: 'proceed' | 'wait' | 'saver' = 'proceed';
  let advisory = 'Within comfortable allowance.';
  if (peakProjectedFiveHour >= 92) {
    if (soonestReset && soonestReset.minsUntilReset <= 120) {
      recommendation = 'wait';
      advisory = `High usage impact (~${peakProjectedFiveHour}% of 5h limit); ${soonestReset.provider} resets in ~${soonestReset.minsUntilReset} min.`;
    } else {
      recommendation = 'saver';
      advisory = `Tight allowance (~${peakProjectedFiveHour}% projected 5h usage); Saver bias trims non-lead calls by ~${savedPctVsCurrent}%.`;
    }
  } else if (peakProjectedFiveHour >= 75 && bias !== 'saver') {
    recommendation = 'saver';
    advisory = `5h usage may reach ~${peakProjectedFiveHour}%; Saver bias cuts ~${savedPctVsCurrent}% tokens.`;
  }

  const estMinutes = Math.max(1, Math.round(totalMs / 60_000));
  const roleParts = (Object.entries(byRole) as Array<[Role, RoleForecast]>).map(([role, r]) => `${r.calls} ${role}`);
  const summary = `Est. ${totalCalls} calls (${roleParts.join(', ')}), ~${Math.round(totalTokens / 1000)}k tokens (~${estMinutes} min). ${advisory}`;

  return {
    stepsCount: steps.length,
    totalCalls,
    totalTokens,
    estimatedMinutes: estMinutes,
    bias,
    byRole,
    byProvider,
    saverTokens,
    savedPctVsCurrent,
    recommendation,
    advisory,
    summary,
  };
}

export async function forecastPlanFromFiles({
  plan,
  routingPath,
  plans = {},
  bias = 'balanced',
  home = 'claude',
  seatState = null,
  now = new Date(),
}: ForecastPlanFromFilesOptions = {}): Promise<PlanForecastResult> {
  const routingLines = routingPath ? await readJsonlTail(routingPath, { limit: 600 }) : [];
  return forecastPlan({ plan, routingLines, plans, bias, home, seatState, now });
}
