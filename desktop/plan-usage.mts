const EVERY = 5 * 60 * 1000, CLOSEST = 60 * 1000;
const ORDER = ['5h', 'Week', ''];
const percent = (value: number | string): number => Math.min(100, Math.max(0, Number(value)));

export interface UsageMeter {
  short: string;
  label: string;
  used: number;
  resets: string;
}

export interface CodexRateLimitWindow {
  usedPercent: number;
  windowDurationMins: number;
  resetsAt?: number | null;
}

export interface CodexUsageInput {
  rateLimits?: {
    primary?: CodexRateLimitWindow | null;
    secondary?: CodexRateLimitWindow | null;
  } | null;
}

export interface DeepSeekBalanceInfo {
  currency: string;
  total_balance: string;
}

export interface DeepSeekBalanceInput {
  balance_infos?: DeepSeekBalanceInfo[] | null;
  is_available?: boolean;
}

export interface DeepSeekBalanceMeter {
  short: string;
  label: string;
  text: string;
  level: string;
}

export interface PlanMeterEntry {
  short?: string;
  label?: string;
  used?: number;
  resets?: string;
  text?: string;
  level?: string;
}

export interface PlanState {
  meters: PlanMeterEntry[];
  at: number;
  failed?: boolean;
}

export type PlanReader = (options: { force: boolean; explicit: boolean }) => Promise<PlanMeterEntry[] | null | undefined>;

export interface PlanUsageOptions {
  readers: Record<string, PlanReader>;
  onChange?: (plans: Record<string, PlanState>) => void;
  visible?: () => boolean;
  every?: number;
  closest?: number;
  now?: () => number;
}

export interface PhoneMeter {
  short: string;
  label: string;
  used: number | null;
  resets: string;
}

export interface PhonePlanUsage {
  at: number;
  failed: boolean;
  meters: PhoneMeter[];
}

// "Current session: 11% used · resets Nov 3 at 5:39pm (Australia/Sydney)"
export function parseClaudeUsage(text: unknown): UsageMeter[] {
  return [...String(text).matchAll(/^Current ([^:\n]+):\s*(\d{1,3})% used(?:\s*·\s*resets ([^\n(]+?))?(?:\s*\([^)\n]*\))?\s*$/gm)].map(([, name, used, resets]) => ({
    short: name === 'session' ? '5h' : name === 'week (all models)' ? 'Week' : '',
    label: name === 'session' ? '5-hour limit' : name === 'week (all models)' ? 'Weekly limit' : `Weekly limit: ${name.replace(/^week \((.+)\)$/, '$1')}`,
    used: percent(used), resets: resets?.trim() ?? '',
  }));
}
// "Gemini Models<tab>Five Hour Limit Remaining<tab>99%<tab>2026-11-03T06:40:29Z". Claude through agy is a separate allowance, and isn't what this is for.
export function parseGeminiUsage(text: unknown): UsageMeter[] {
  return String(text).split('\n').map(line => line.split('\t')).filter(parts => parts.length >= 3 && /^\d{1,3}%$/.test(parts[2].trim()) && /gemini/i.test(parts[0])).map(([group, name, left, resets]) => {
    const models = group.trim() === 'Gemini Models', five = models && /five hour/i.test(name), week = models && /weekly/i.test(name);
    return { short: five ? '5h' : week ? 'Week' : '', label: five ? '5-hour limit' : week ? 'Weekly limit' : `Weekly limit: ${group.trim()}`, used: percent(100 - parseInt(left, 10)), resets: resets?.trim() ?? '' };
  }).sort((a, b) => ORDER.indexOf(a.short) - ORDER.indexOf(b.short));
}
const WINDOWS: Record<number, [string, string]> = { 300: ['5h', '5-hour limit'], 10080: ['Week', 'Weekly limit'], 43200: ['Month', 'Monthly limit'] };
// "Primary" and "secondary" are whichever windows the plan has. The free plan has just a month.
export function parseCodexUsage(result: CodexUsageInput | null | undefined): UsageMeter[] {
  const limits = result?.rateLimits;
  return [limits?.primary, limits?.secondary].filter((window): window is CodexRateLimitWindow => Number.isFinite(window?.usedPercent)).map(({ usedPercent, windowDurationMins: minutes, resetsAt }) => {
    const [short, label] = WINDOWS[minutes] ?? [minutes >= 1440 ? `${Math.round(minutes / 1440)}d` : `${Math.round(minutes / 60)}h`, 'Limit'];
    return { short, label, used: Math.round(percent(usedPercent)), resets: resetsAt ? new Date(resetsAt * 1000).toISOString() : '' };
  });
}
// DeepSeek is prepaid, so there's no limit to be a percentage of, just what's left.
const SYMBOLS: Record<string, string> = { USD: '$', CNY: '¥' };
export function parseDeepSeekBalance(result: DeepSeekBalanceInput | null | undefined): DeepSeekBalanceMeter[] {
  return (result?.balance_infos ?? []).filter(info => Number.isFinite(Number.parseFloat(info.total_balance))).map(info => {
    const left = Number.parseFloat(info.total_balance);
    return { short: 'Left', label: 'Balance', text: `${SYMBOLS[info.currency] ?? `${info.currency} `}${left.toFixed(2)}`, level: result!.is_available === false || left <= 0 ? 'full' : left < 1 ? 'high' : '' };
  });
}
// Each CLI's own /usage costs no tokens. A plan that can't be read keeps its last figures, marked with when they're from, and one that no longer applies, such as a removed key, reads as null.
export class PlanUsage {
  readers: Record<string, PlanReader>;
  onChange: (plans: Record<string, PlanState>) => void;
  visible: () => boolean;
  every: number;
  closest: number;
  now: () => number;
  plans: Record<string, PlanState> = {};
  last = 0;
  reading: Promise<Record<string, PlanState>> | null = null;
  timer: ReturnType<typeof setInterval> | undefined;

  constructor({ readers, onChange = () => {}, visible = () => true, every = EVERY, closest = CLOSEST, now = Date.now }: PlanUsageOptions) {
    this.readers = readers;
    this.onChange = onChange;
    this.visible = visible;
    this.every = every;
    this.closest = closest;
    this.now = now;
  }
  start(): void {
    this.refresh({ force: true });
    this.timer = setInterval(() => { if (this.visible()) this.refresh(); }, this.every);
    this.timer.unref?.();
  }
  stop(): void { clearInterval(this.timer); }
  state(): Record<string, PlanState> { return this.plans; }
  refresh({ force = false, explicit = false }: { force?: boolean; explicit?: boolean } = {}): Promise<Record<string, PlanState>> {
    if (this.reading) return this.reading;
    if (!force && this.now() - this.last < this.closest) return Promise.resolve(this.plans);
    this.last = this.now();
    this.reading = Promise.all(Object.entries(this.readers).map(async ([name, read]) => {
      try {
        const meters = await read({ force, explicit });
        // undefined: not asked this time (Codex isn't in use, efficiency audit fix 5), so what's shown stays.
        if (meters === undefined) return;
        if (meters === null) delete this.plans[name];
        else if (meters.length) this.plans[name] = { meters, at: this.now() };
        else if (this.plans[name]) this.plans[name].failed = true;
      } catch { if (this.plans[name]) this.plans[name].failed = true; }
    })).then(() => { this.onChange(this.plans); return this.plans; }).finally(() => { this.reading = null; });
    return this.reading;
  }
}

// The phone's notch island shows Claude Code, agy and Codex as rings while nothing else is going on: their meters, small.
export function phoneUsage(plans: Record<string, PlanState | undefined> = {}): Record<string, PhonePlanUsage> {
  const out: Record<string, PhonePlanUsage> = {};
  for (const name of ['claude', 'gemini', 'codex']) {
    const plan = plans[name];
    if (!plan?.meters?.length) continue;
    out[name] = { at: plan.at || 0, failed: Boolean(plan.failed),
      meters: plan.meters.slice(0, 3).map(meter => ({ short: String(meter.short || ''), label: String(meter.label || ''), used: typeof meter.used === 'number' && Number.isFinite(meter.used) ? Math.max(0, Math.min(100, Math.round(meter.used))) : null, resets: String(meter.resets || '') })) };
  }
  return out;
}
