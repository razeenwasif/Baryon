// Token use, step 7: one line for every model call Fairy makes without a message from you (quiz answers, ideas,
// reflection, check-ins and briefs, scheduled tasks, promises, meeting summaries), and for every check-in she skipped
// because nothing was new, so the calls in an idle hour can be counted. Kinds, models and outcomes only: no content.
import { readFile } from 'node:fs/promises';
import { recordTurn } from './token-ledger.mjs';

export const BACKGROUND_FILE = 'background-calls.jsonl';
export const BACKGROUND_KEEP = 2000;
// No keyboard or mouse for this long counts as idle, the same two minutes after which screen awareness stops looking.
export const IDLE_SECONDS = 120;

export interface BackgroundLineOptions {
  outcome?: string;
  idleSeconds?: number;
  provider?: string;
  model?: string;
  at?: Date;
}

export type BackgroundLine = {
  at: string;
  kind: string;
  outcome: string;
  idleSeconds: number;
  idle: boolean;
  provider?: string;
  model?: string;
};

export interface BackgroundKindCounts {
  called: number;
  idleCalled: number;
  skipped: number;
}

export interface CountBackgroundOptions {
  from: Date;
  to?: Date;
}

export interface BackgroundCounts {
  hours: number;
  called: number;
  idleCalled: number;
  skipped: number;
  perHour: number | null;
  kinds: Record<string, BackgroundKindCounts>;
}

const text = (value: unknown, max = 80): string => (typeof value === 'string' ? value.slice(0, max) : '');

export function backgroundLine(
  kind: string,
  { outcome = 'called', idleSeconds = 0, provider = '', model = '', at = new Date() }: BackgroundLineOptions = {},
): BackgroundLine {
  const idle = Math.max(0, Math.round(Number(idleSeconds) || 0));
  return { at: at.toISOString(), kind: text(kind, 40), outcome: text(outcome, 40), idleSeconds: idle, idle: idle >= IDLE_SECONDS,
    ...(provider ? { provider: text(provider, 40) } : {}), ...(model ? { model: text(model, 40) } : {}) };
}

export const recordBackground = (
  path: string,
  line: BackgroundLine | Record<string, unknown>,
  { keep = BACKGROUND_KEEP }: { keep?: number } = {},
): Promise<void> => recordTurn(path, line, { keep });

// The lines from `from` up to `to`, counted by kind: model calls, and those skipped because nothing was new, with how
// many of the calls came while you were idle, and calls per hour over the window.
export function countBackground(lines: BackgroundLine[], { from, to = new Date() }: CountBackgroundOptions): BackgroundCounts {
  const start = from.getTime(), end = to.getTime(), hours = Math.max(0, end - start) / 3600000, kinds: Record<string, BackgroundKindCounts> = {};
  let called = 0, idleCalled = 0, skipped = 0;
  for (const line of lines) {
    const at = Date.parse(line?.at);
    if (!(at >= start && at < end)) continue;
    const kind = kinds[line.kind] ||= { called: 0, idleCalled: 0, skipped: 0 };
    if (line.outcome === 'called') { kind.called++; called++; if (line.idle) { kind.idleCalled++; idleCalled++; } }
    else { kind.skipped++; skipped++; }
  }
  const rate = (count: number): number | null => (hours ? Math.round(count / hours * 100) / 100 : null);
  return { hours: Math.round(hours * 100) / 100, called, idleCalled, skipped, perHour: rate(called), kinds };
}

export async function readBackground(path: string): Promise<BackgroundLine[]> {
  const raw = await readFile(path, 'utf8').catch((error: unknown) => ((error as { code?: unknown } | null | undefined)?.code === 'ENOENT' ? '' : Promise.reject(error)));
  return raw.split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line) as BackgroundLine]; } catch { return []; } });
}
