// Token use, step 7: one line for every model call Fairy makes without a message from you (quiz answers, ideas,
// reflection, check-ins and briefs, scheduled tasks, promises, meeting summaries), and for every check-in she skipped
// because nothing was new, so the calls in an idle hour can be counted. Kinds, models and outcomes only: no content.
import { readFile } from 'node:fs/promises';
import { recordTurn } from './token-ledger.mjs';

export const BACKGROUND_FILE = 'background-calls.jsonl';
export const BACKGROUND_KEEP = 2000;
// No keyboard or mouse for this long counts as idle, the same two minutes after which screen awareness stops looking.
export const IDLE_SECONDS = 120;

const text = (value, max = 80) => (typeof value === 'string' ? value.slice(0, max) : '');

export function backgroundLine(kind, { outcome = 'called', idleSeconds = 0, provider = '', model = '', at = new Date() } = {}) {
  const idle = Math.max(0, Math.round(Number(idleSeconds) || 0));
  return { at: at.toISOString(), kind: text(kind, 40), outcome: text(outcome, 40), idleSeconds: idle, idle: idle >= IDLE_SECONDS,
    ...(provider ? { provider: text(provider, 40) } : {}), ...(model ? { model: text(model) } : {}) };
}

export const recordBackground = (path, line, { keep = BACKGROUND_KEEP } = {}) => recordTurn(path, line, { keep });

// The lines from `from` up to `to`, counted by kind: model calls, and those skipped because nothing was new, with how
// many of the calls came while you were idle, and calls per hour over the window.
export function countBackground(lines, { from, to = new Date() }) {
  const start = from.getTime(), end = to.getTime(), hours = Math.max(0, end - start) / 3600000, kinds = {};
  let called = 0, idleCalled = 0, skipped = 0;
  for (const line of lines) {
    const at = Date.parse(line?.at);
    if (!(at >= start && at < end)) continue;
    const kind = kinds[line.kind] ||= { called: 0, idleCalled: 0, skipped: 0 };
    if (line.outcome === 'called') { kind.called++; called++; if (line.idle) { kind.idleCalled++; idleCalled++; } }
    else { kind.skipped++; skipped++; }
  }
  const rate = count => (hours ? Math.round(count / hours * 100) / 100 : null);
  return { hours: Math.round(hours * 100) / 100, called, idleCalled, skipped, perHour: rate(called), kinds };
}

export async function readBackground(path) {
  const raw = await readFile(path, 'utf8').catch(error => (error.code === 'ENOENT' ? '' : Promise.reject(error)));
  return raw.split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
}
