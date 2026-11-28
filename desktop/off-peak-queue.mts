// Doc 7, #8: Off-peak queue — work that can wait (evals, literature refreshes, index building,
// memory reflection, or queued prompts). Runs automatically only when enabled, on mains power,
// idle, not busy, and when a provider's 5-hour usage window is about to reset with allowance unused
// (or on mains + idle alone for zero-token local tasks like index building).
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const OFF_PEAK_KINDS = Object.freeze(['eval', 'literature', 'index', 'reflect', 'prompt'] as const);
export type OffPeakKind = (typeof OFF_PEAK_KINDS)[number];
export const LOCAL_ONLY_KINDS = new Set<string>(['index']);
export const PROVIDERS = Object.freeze(['any', 'claude', 'gemini', 'codex'] as const);
export type OffPeakProvider = (typeof PROVIDERS)[number];
const MAX_QUEUE = 60;
const MAX_HISTORY = 40;

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

export interface PlanMeter {
  short?: string;
  used?: number;
  resets?: string | number | null;
  [key: string]: unknown;
}

export interface PlanEntry {
  meters?: PlanMeter[];
  [key: string]: unknown;
}

export type PlanUsageMap = Record<string, PlanEntry | null | undefined>;

export interface FindResettingWindowOptions {
  now?: number;
  leadMinutes?: number;
  maxUsed?: number;
  weeklyMaxUsed?: number;
  preferred?: string;
}

export interface ResettingWindowSummary {
  provider: string;
  minutesLeft: number;
  unusedPercent: number;
  usedPercent: number;
  weeklyUsed: number;
  resetsAt: string;
}

export type ResettingWindowResult =
  | (ResettingWindowSummary & { eligible: true; reason: string })
  | { eligible: false; reason: string; nextWindow: ResettingWindowSummary | null };

export interface CanRunOffPeakOptions {
  onBattery?: boolean;
  idleSeconds?: number;
  minIdleSeconds?: number;
  busy?: boolean;
  plans?: PlanUsageMap;
  jobKind?: string;
  provider?: string;
  now?: number;
  leadMinutes?: number;
  maxUsed?: number;
  weeklyMaxUsed?: number;
}

export type CanRunOffPeakResult =
  | { ok: false; reason: string; window?: ResettingWindowResult }
  | { ok: true; provider: string; reason: string; window?: ResettingWindowResult };

export interface OffPeakConfig {
  leadMinutes: number;
  minIdleSeconds: number;
  maxUsed: number;
  weeklyMaxUsed: number;
}

export interface OffPeakQueueItem {
  id: string;
  kind: OffPeakKind;
  title: string;
  provider: string;
  prompt?: string;
  target?: string;
  status: 'queued';
  addedAt: string;
}

export interface OffPeakRunningItem {
  id: string;
  kind: OffPeakKind;
  title: string;
  provider: string;
  prompt?: string;
  target?: string;
  status: 'running';
  addedAt: string;
  startedAt: string;
}

export interface OffPeakHistoryItem {
  id: string;
  kind: OffPeakKind;
  title: string;
  provider: string;
  prompt?: string;
  target?: string;
  status: 'done' | 'failed';
  addedAt: string;
  startedAt: string;
  finishedAt: string;
  summary?: string;
  error?: string;
}

export interface OffPeakState {
  enabled: boolean;
  config: OffPeakConfig;
  running: OffPeakRunningItem | null;
  items: OffPeakQueueItem[];
  history: OffPeakHistoryItem[];
  window: ResettingWindowResult;
  readiness: { ok: boolean; reason: string };
}

export interface OffPeakRunResult {
  summary?: unknown;
}

export type OffPeakRunJob = (
  item: OffPeakQueueItem,
  context: { provider: string },
) => Promise<OffPeakRunResult | null | undefined> | OffPeakRunResult | null | undefined;

export interface OffPeakQueueOptions {
  path: string;
  now?: () => number;
}

export interface OffPeakConfigurePatch {
  enabled?: boolean;
  leadMinutes?: number;
  minIdleSeconds?: number;
  maxUsed?: number;
  weeklyMaxUsed?: number;
}

export interface AddOffPeakOptions {
  kind?: string;
  title?: string;
  provider?: string;
  prompt?: string;
  target?: string;
}

// Parses reset timestamps from PlanUsage meters:
// - ISO-8601 strings (Gemini / Codex): "2026-11-21T16:40:29Z"
// - Claude CLI strings: "Nov 21 at 5:39pm", "Nov 3 at 12:05am", or "5:39pm"
export function parseResetTime(resets: unknown, nowMs = Date.now()): number | null {
  const raw = String(resets || '').trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const full = /^([A-Za-z]{3})\s+(\d{1,2})\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i.exec(raw);
  if (full) {
    const month = MONTHS[full[1].toLowerCase()];
    if (month === undefined) return null;
    const day = Number(full[2]);
    let hour = Number(full[3]) % 12;
    if (full[5].toLowerCase() === 'pm') hour += 12;
    const minute = Number(full[4] || 0);
    const ref = new Date(nowMs);
    let candidate = new Date(ref.getFullYear(), month, day, hour, minute, 0, 0).getTime();
    // Handle year boundary (e.g. Dec 31 -> Jan 1)
    if (candidate < nowMs - 180 * 86400_000) candidate = new Date(ref.getFullYear() + 1, month, day, hour, minute, 0, 0).getTime();
    return Number.isFinite(candidate) ? candidate : null;
  }
  const timeOnly = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i.exec(raw);
  if (timeOnly) {
    let hour = Number(timeOnly[1]) % 12;
    if (timeOnly[3].toLowerCase() === 'pm') hour += 12;
    const minute = Number(timeOnly[2] || 0);
    const ref = new Date(nowMs);
    let candidate = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), hour, minute, 0, 0).getTime();
    if (candidate <= nowMs - 60_000) candidate += 86400_000;
    return candidate;
  }
  return null;
}

// Inspects planUsage.state() for a 5h window resetting within leadMinutes with unused allowance left.
export function findResettingWindow(
  plans: PlanUsageMap = {},
  {
    now = Date.now(),
    leadMinutes = 45,
    maxUsed = 85,
    weeklyMaxUsed = 92,
    preferred = 'any',
  }: FindResettingWindowOptions = {},
): ResettingWindowResult {
  const candidates: ResettingWindowSummary[] = [];
  const upcoming: ResettingWindowSummary[] = [];
  const names = preferred && preferred !== 'any' ? [preferred] : ['claude', 'gemini', 'codex'];

  for (const provider of names) {
    const entry = plans?.[provider];
    const meters = Array.isArray(entry?.meters) ? entry.meters : [];
    if (!meters.length) continue;
    const five = meters.find(m => m.short === '5h');
    if (!five || typeof five.used !== 'number' || !Number.isFinite(five.used)) continue;
    const weekly = meters.find(m => m.short === 'Week');
    const weeklyUsed = typeof weekly?.used === 'number' && Number.isFinite(weekly.used) ? weekly.used : 0;
    const resetsAt = parseResetTime(five.resets, now);
    if (!resetsAt) continue;
    const msLeft = resetsAt - now;
    if (msLeft <= 0) continue;
    const minutesLeft = Math.round(msLeft / 60_000);
    const unusedPercent = Math.max(0, Math.round(100 - five.used));
    const summary: ResettingWindowSummary = {
      provider,
      minutesLeft,
      unusedPercent,
      usedPercent: Math.round(five.used),
      weeklyUsed: Math.round(weeklyUsed),
      resetsAt: new Date(resetsAt).toISOString(),
    };
    upcoming.push(summary);
    if (msLeft <= leadMinutes * 60_000 && five.used <= maxUsed && weeklyUsed <= weeklyMaxUsed) {
      candidates.push(summary);
    }
  }

  candidates.sort((a, b) => a.minutesLeft - b.minutesLeft || b.unusedPercent - a.unusedPercent);
  upcoming.sort((a, b) => a.minutesLeft - b.minutesLeft);

  if (candidates.length) {
    return {
      eligible: true,
      ...candidates[0],
      reason: `${candidates[0].provider} 5h window resets in ${candidates[0].minutesLeft}m with ${candidates[0].unusedPercent}% unused.`,
    };
  }
  if (upcoming.length) {
    const next = upcoming[0];
    const why = next.minutesLeft > leadMinutes
      ? `Next 5h reset is ${next.provider} in ${next.minutesLeft}m (waits until ≤${leadMinutes}m left).`
      : next.usedPercent > maxUsed
        ? `${next.provider} 5h window is already ${next.usedPercent}% used.`
        : `${next.provider} weekly usage is at ${next.weeklyUsed}%.`;
    return { eligible: false, reason: why, nextWindow: next };
  }
  return { eligible: false, reason: 'No 5-hour usage window reset time available yet.', nextWindow: null };
}

export function canRunOffPeak({
  onBattery = false,
  idleSeconds = 0,
  minIdleSeconds = 300,
  busy = false,
  plans = {},
  jobKind = 'reflect',
  provider = 'any',
  now = Date.now(),
  leadMinutes = 45,
  maxUsed = 85,
  weeklyMaxUsed = 92,
}: CanRunOffPeakOptions = {}): CanRunOffPeakResult {
  if (busy) return { ok: false, reason: 'Fairy is busy with an active request.' };
  if (onBattery) return { ok: false, reason: 'Mac is on battery power (waits for mains).' };
  if (idleSeconds < minIdleSeconds) return { ok: false, reason: `Waiting for Mac to be idle (${Math.round(idleSeconds)}s / ${minIdleSeconds}s).` };
  if (LOCAL_ONLY_KINDS.has(jobKind)) {
    return { ok: true, provider: 'local', reason: 'On mains and idle; local job uses no plan allowance.' };
  }
  const win = findResettingWindow(plans, { now, leadMinutes, maxUsed, weeklyMaxUsed, preferred: provider });
  if (!win.eligible) return { ok: false, reason: win.reason, window: win };
  return { ok: true, provider: win.provider, reason: win.reason, window: win };
}

const cleanText = (v: unknown, max = 300): string =>
  String(v ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, max);

export class OffPeakQueue {
  path: string;
  now: () => number;
  enabled: boolean;
  config: OffPeakConfig;
  items: OffPeakQueueItem[];
  history: OffPeakHistoryItem[];
  running: OffPeakRunningItem | null;
  loaded: boolean;

  constructor({ path, now = () => Date.now() }: OffPeakQueueOptions) {
    this.path = path;
    this.now = now;
    this.enabled = false;
    this.config = { leadMinutes: 45, minIdleSeconds: 300, maxUsed: 85, weeklyMaxUsed: 92 };
    this.items = [];
    this.history = [];
    this.running = null;
    this.loaded = false;
  }

  async load(): Promise<this> {
    if (this.loaded) return this;
    try {
      const raw = JSON.parse(await readFile(this.path, 'utf8')) as {
        enabled?: unknown;
        config?: Partial<Record<keyof OffPeakConfig, unknown>>;
        items?: Array<Partial<OffPeakQueueItem> & { kind?: string }>;
        history?: OffPeakHistoryItem[];
      } | null;
      if (raw && typeof raw === 'object') {
        this.enabled = Boolean(raw.enabled);
        if (raw.config && typeof raw.config === 'object') {
          this.config = {
            leadMinutes: Math.max(5, Math.min(180, Math.round(Number(raw.config.leadMinutes) || 45))),
            minIdleSeconds: Math.max(30, Math.min(3600, Math.round(Number(raw.config.minIdleSeconds) || 300))),
            maxUsed: Math.max(10, Math.min(98, Math.round(Number(raw.config.maxUsed) || 85))),
            weeklyMaxUsed: Math.max(20, Math.min(99, Math.round(Number(raw.config.weeklyMaxUsed) || 92))),
          };
        }
        this.items = Array.isArray(raw.items)
          ? raw.items
            .filter((x): x is OffPeakQueueItem => Boolean(x && x.id && x.kind && (OFF_PEAK_KINDS as readonly string[]).includes(x.kind)))
            .map(x => ({ ...x, status: 'queued' }))
          : [];
        this.history = Array.isArray(raw.history) ? raw.history.slice(-MAX_HISTORY) : [];
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null | undefined)?.code !== 'ENOENT') throw error;
    }
    this.loaded = true;
    return this;
  }

  async save(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const tmp = `${this.path}.${randomUUID()}.tmp`;
    const payload = JSON.stringify({ enabled: this.enabled, config: this.config, items: this.items, history: this.history.slice(-MAX_HISTORY) }, null, 2);
    await writeFile(tmp, payload, { encoding: 'utf8', mode: 0o600 });
    await rename(tmp, this.path);
  }

  state({
    onBattery = false,
    idleSeconds = 0,
    busy = false,
    plans = {},
  }: { onBattery?: boolean; idleSeconds?: number; busy?: boolean; plans?: PlanUsageMap } = {}): OffPeakState {
    const window = findResettingWindow(plans, { now: this.now(), ...this.config });
    const readiness = canRunOffPeak({
      onBattery,
      idleSeconds,
      busy,
      plans,
      jobKind: this.items[0]?.kind || 'reflect',
      provider: this.items[0]?.provider || 'any',
      now: this.now(),
      ...this.config,
    });
    return {
      enabled: this.enabled,
      config: { ...this.config },
      running: this.running ? { ...this.running } : null,
      items: this.items.map(item => ({ ...item })),
      history: this.history.slice(-20).reverse(),
      window,
      readiness: { ok: readiness.ok, reason: readiness.reason },
    };
  }

  async configure(patch: OffPeakConfigurePatch = {}): Promise<OffPeakState> {
    await this.load();
    if (typeof patch.enabled === 'boolean') this.enabled = patch.enabled;
    if (patch.leadMinutes !== undefined) this.config.leadMinutes = Math.max(5, Math.min(180, Math.round(Number(patch.leadMinutes) || 45)));
    if (patch.minIdleSeconds !== undefined) this.config.minIdleSeconds = Math.max(30, Math.min(3600, Math.round(Number(patch.minIdleSeconds) || 300)));
    if (patch.maxUsed !== undefined) this.config.maxUsed = Math.max(10, Math.min(98, Math.round(Number(patch.maxUsed) || 85)));
    if (patch.weeklyMaxUsed !== undefined) this.config.weeklyMaxUsed = Math.max(20, Math.min(99, Math.round(Number(patch.weeklyMaxUsed) || 92)));
    await this.save();
    return this.state();
  }

  async add({ kind, title = '', provider = 'any', prompt = '', target = '' }: AddOffPeakOptions = {}): Promise<OffPeakQueueItem> {
    await this.load();
    if (!kind || !(OFF_PEAK_KINDS as readonly string[]).includes(kind)) {
      throw new Error(`Choose an off-peak job kind: ${OFF_PEAK_KINDS.join(', ')}.`);
    }
    const validKind = kind as OffPeakKind;
    const cleanPrompt = cleanText(prompt, 4000);
    if (validKind === 'prompt' && !cleanPrompt) throw new Error('Enter the prompt for a queued off-peak run.');
    const defaultTitle = {
      eval: 'Run saved evals',
      literature: 'Refresh literature watchers',
      index: 'Refresh notes & books index',
      reflect: 'Long-term memory reflection',
      prompt: cleanPrompt.slice(0, 80),
    }[validKind];
    const cleanProv = LOCAL_ONLY_KINDS.has(validKind)
      ? 'local'
      : ((PROVIDERS as readonly string[]).includes(provider) ? provider : 'any');
    if (this.items.length >= MAX_QUEUE) throw new Error(`Off-peak queue is full (max ${MAX_QUEUE} items).`);
    const entry: OffPeakQueueItem = {
      id: `op-${randomUUID().slice(0, 8)}`,
      kind: validKind,
      title: cleanText(title, 120) || defaultTitle,
      provider: cleanProv,
      ...(cleanPrompt ? { prompt: cleanPrompt } : {}),
      ...(target ? { target: cleanText(target, 240) } : {}),
      status: 'queued',
      addedAt: new Date(this.now()).toISOString(),
    };
    this.items.push(entry);
    await this.save();
    return entry;
  }

  async remove(id: unknown): Promise<{ removed: boolean }> {
    if (typeof id !== 'string' || !/^op-[a-z0-9-]+$/i.test(id)) throw new Error('That queued off-peak job isn’t here.');
    await this.load();
    const before = this.items.length;
    this.items = this.items.filter(item => item.id !== id);
    if (this.items.length !== before) await this.save();
    return { removed: this.items.length !== before };
  }

  async executeItem(
    item: OffPeakQueueItem,
    { provider, runJob }: { provider: string; runJob?: OffPeakRunJob },
  ): Promise<OffPeakHistoryItem> {
    this.items = this.items.filter(x => x.id !== item.id);
    const startedAt = new Date(this.now()).toISOString();
    this.running = { ...item, status: 'running', provider, startedAt };
    await this.save();
    let record: OffPeakHistoryItem;
    try {
      const result = await (runJob as OffPeakRunJob)(item, { provider });
      record = {
        ...item,
        status: 'done',
        provider,
        startedAt,
        finishedAt: new Date(this.now()).toISOString(),
        summary: cleanText(result?.summary || 'Done.', 300),
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : '';
      record = {
        ...item,
        status: 'failed',
        provider,
        startedAt,
        finishedAt: new Date(this.now()).toISOString(),
        error: cleanText(errMsg || String(error), 300),
      };
    } finally {
      this.running = null;
    }
    this.history.push(record);
    if (this.history.length > MAX_HISTORY) this.history = this.history.slice(-MAX_HISTORY);
    await this.save();
    return record;
  }

  // Called on the periodic timer: runs at most one eligible queued job when mains + idle + resetting window align.
  async step({
    onBattery = false,
    idleSeconds = 0,
    busy = false,
    plans = {},
    runJob,
  }: {
    onBattery?: boolean;
    idleSeconds?: number;
    busy?: boolean;
    plans?: PlanUsageMap;
    runJob?: OffPeakRunJob;
  } = {}): Promise<{ ran: boolean; reason: string; item?: OffPeakHistoryItem }> {
    await this.load();
    if (!this.enabled) return { ran: false, reason: 'Off-peak queue is turned off.' };
    if (this.running) return { ran: false, reason: 'An off-peak job is already running.' };
    if (!this.items.length) return { ran: false, reason: 'Queue is empty.' };

    for (const item of this.items) {
      const check = canRunOffPeak({
        onBattery,
        idleSeconds,
        busy,
        plans,
        jobKind: item.kind,
        provider: item.provider,
        now: this.now(),
        ...this.config,
      });
      if (check.ok) {
        const done = await this.executeItem(item, { provider: check.provider, runJob });
        return { ran: true, item: done, reason: check.reason };
      }
    }
    const firstCheck = canRunOffPeak({
      onBattery,
      idleSeconds,
      busy,
      plans,
      jobKind: this.items[0].kind,
      provider: this.items[0].provider,
      now: this.now(),
      ...this.config,
    });
    return { ran: false, reason: firstCheck.reason };
  }

  // Manual trigger from UI: runs one queued item immediately regardless of mains/idle/reset window.
  async runNow(
    id?: unknown,
    { runJob, plans = {} }: { runJob?: OffPeakRunJob; plans?: PlanUsageMap } = {},
  ): Promise<OffPeakHistoryItem> {
    if (id !== undefined && id !== null && id !== '' && (typeof id !== 'string' || !/^op-[a-z0-9-]+$/i.test(id))) {
      throw new Error('That queued off-peak job isn’t here.');
    }
    await this.load();
    if (this.running) throw new Error('An off-peak job is already running.');
    const item = id ? this.items.find(x => x.id === id) : this.items[0];
    if (!item) throw new Error('That queued off-peak job isn’t here.');
    const win = findResettingWindow(plans, { now: this.now(), ...this.config, preferred: item.provider });
    const provider = LOCAL_ONLY_KINDS.has(item.kind) ? 'local' : (item.provider !== 'any' ? item.provider : ((win.eligible ? win.provider : '') || 'claude'));
    return this.executeItem(item, { provider, runJob });
  }
}
