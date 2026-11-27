// The strengths table's evals layer (docs/auto-by-task-plan.md, stage 3): a run of evals by kind (scripts/eval.mjs
// --kinds) as rows of the table, one per kind: passed out of tasks, on which model, from which run. Pure.
import { modelKey } from './table.mjs';

// One row per kind the run covered. A task that was skipped (its world couldn't be made) counts for nothing.
export function evalRows(results, { model, provider, run, at }) {
  const byKind = new Map();
  for (const result of results) {
    if (result.skipped || !result.taskKind) continue;
    const row = byKind.get(result.taskKind) || { passed: 0, total: 0 };
    row.total++; if (result.ok) row.passed++;
    byKind.set(result.taskKind, row);
  }
  return [...byKind].map(([kind, { passed, total }]) => ({ model: modelKey(model), level: model, provider, kind, passed, total, run, at }));
}

// A newer run of the same model, at the same level, on the same kind replaces the older one; other rows stay.
export function withEvalRows(table, rows) {
  const replaced = row => rows.some(next => next.level === row.level && next.kind === row.kind);
  return { ...table, evals: [...(table.evals || []).filter(row => !replaced(row)), ...rows] };
}
