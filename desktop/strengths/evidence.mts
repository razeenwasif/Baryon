// The strengths table's use layer (docs/auto-by-task-plan.md, stage 6): real use folded in from routing.jsonl. Decision 9
// (19 Nov): it counts a little and fades, each signal losing weight evenly until it stops counting at 60 days. Pure: the
// lines and the time are passed in. Only the kind, the model and the outcome are ever read; no words.
//
//   override  you chose another model with Choose another   strongly against the one you left, for the one you chose
//   check     a build step's check passed or failed           for or against the builder's model
//   turn      a work turn that ended in an error              against its model (one that ended well says nothing)
import { modelKey, type RoutedTaskKind, type StrengthsTableInput, type UseEvidenceRow } from './table.mjs';
import { KINDS } from '../model-router.mjs';

export const FADE_DAYS = 60;
const DAY = 24 * 60 * 60 * 1000;
export const STRENGTH = { override: 2, check: 1, turn: 1 } as const;
export type UseSignal = keyof typeof STRENGTH;

export interface RoutingLogLine {
  kind?: string;
  at?: string;
  type?: string;
  fromModel?: string;
  toModel?: string;
  model?: string;
  passed?: boolean;
  outcome?: string;
  [key: string]: unknown;
}

export interface UseLayerRow extends UseEvidenceRow {
  model: string;
  kind: RoutedTaskKind;
  for: boolean;
  weight: number;
  signal: UseSignal;
  at: string | undefined;
}

const routed = (kind: unknown): kind is RoutedTaskKind =>
  typeof kind === 'string' && (KINDS as readonly string[]).includes(kind) && kind !== 'everyday';

// The signals in a run of routing.jsonl lines, as rows of the use layer, each with its faded weight.
export function useRows(lines: readonly (RoutingLogLine | null | undefined)[], { now }: { now: string }): UseLayerRow[] {
  const rows: UseLayerRow[] = [], at = Date.parse(now);
  for (const line of lines) {
    if (!line || !routed(line.kind)) continue;
    const age = at - Date.parse(String(line.at || 0));
    if (!Number.isFinite(age) || age < 0 || age >= FADE_DAYS * DAY) continue;
    const fade = 1 - age / (FADE_DAYS * DAY);
    const kind = line.kind;
    const row = (model: unknown, support: boolean, signal: UseSignal): void => {
      if (model) {
        rows.push({
          model: modelKey(model),
          kind,
          for: support,
          weight: Math.round(STRENGTH[signal] * fade * 1000) / 1000,
          signal,
          at: line.at,
        });
      }
    };
    if (line.type === 'override') { row(line.fromModel, false, 'override'); row(line.toModel, true, 'override'); }
    else if (line.type === 'check' && typeof line.passed === 'boolean') row(line.model, line.passed, 'check');
    else if (!line.type && line.outcome === 'failed') row(line.model, false, 'turn');
  }
  return rows.filter(item => item.weight > 0);
}

// The use layer replaced whole by what the log says now, so a signal that has faded out leaves the table.
export const withUseRows = <T extends StrengthsTableInput>(
  table: T,
  rows: readonly UseEvidenceRow[],
): T & { use: UseEvidenceRow[] } => ({ ...table, use: rows as UseEvidenceRow[] });
