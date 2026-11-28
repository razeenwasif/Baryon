// The strengths table's evals layer (docs/auto-by-task-plan.md, stage 3): a run of evals by kind (scripts/eval.mjs
// --kinds) as rows of the table, one per kind: passed out of tasks, on which model, from which run. Pure.
import { modelKey, type EvalEvidenceRow, type StrengthsTableInput } from './table.mjs';

export interface EvalResultItem {
  skipped?: boolean;
  taskKind?: string;
  ok?: boolean;
}

export interface EvalRunMeta {
  model: string;
  provider: string;
  run: string;
  at: string;
}

export interface EvalLayerRow extends EvalEvidenceRow {
  model: string;
  level: string;
  provider: string;
  kind: string;
  passed: number;
  total: number;
  run: string;
  at: string;
}

// One row per kind the run covered. A task that was skipped (its world couldn't be made) counts for nothing.
export function evalRows(results: readonly EvalResultItem[], { model, provider, run, at }: EvalRunMeta): EvalLayerRow[] {
  const byKind = new Map<string, { passed: number; total: number }>();
  for (const result of results) {
    if (result.skipped || !result.taskKind) continue;
    const row = byKind.get(result.taskKind) || { passed: 0, total: 0 };
    row.total++; if (result.ok) row.passed++;
    byKind.set(result.taskKind, row);
  }
  return [...byKind].map(([kind, { passed, total }]) => ({ model: modelKey(model), level: model, provider, kind, passed, total, run, at }));
}

// A newer run of the same model, at the same level, on the same kind replaces the older one; other rows stay.
export function withEvalRows<T extends StrengthsTableInput>(
  table: T,
  rows: readonly EvalEvidenceRow[],
): T & { evals: EvalEvidenceRow[] } {
  const replaced = (row: EvalEvidenceRow): boolean => rows.some(next => next.level === row.level && next.kind === row.kind);
  return { ...table, evals: [...(table.evals || []).filter(row => !replaced(row)), ...rows] };
}
