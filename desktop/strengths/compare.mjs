// Stage 4's comparison (docs/auto-by-task-plan.md): from the evals already run, with no model call, each kind's pass
// rate on your provider's model beside the model the pick by task would choose, with the task counts. A kind meets the
// bar to be turned on in stage 5 only when by task is ahead by at least two tasks on it (and no worse elsewhere, which
// the caller reads across rows).
import { CLAUDE_MODELS } from '../../src/model-menu.js';
import { modelFor } from '../model-router.mjs';
import { pickByTask } from './pick.mjs';
import { ROUTED_KINDS, modelKey } from './table.mjs';

const providerOf = id => /^claude-/.test(id) ? 'claude' : /^gemini-/.test(id) ? 'gemini' : /^gpt-/.test(id) ? 'codex' : null;
// What a terminal knows is offered: Claude's list, and the Gemini and Codex models the table has evidence for.
export function offeredFromTable(table) {
  const offered = { claude: CLAUDE_MODELS.map(model => model.id), gemini: [], codex: [] };
  for (const row of [...(table.evals || []), ...(table.public || [])]) {
    const id = row.level || row.model, provider = providerOf(id);
    if (provider && provider !== 'claude' && !offered[provider].includes(id)) offered[provider].push(id);
  }
  return offered;
}

// Passed out of tasks for a model on a kind, from every eval row of it (its thinking levels together); null if none.
function passes(table, model, kind) {
  const rows = (table.evals || []).filter(row => row.model === modelKey(model) && row.kind === kind);
  if (!rows.length) return { model, passed: null, total: null };
  return { model, passed: rows.reduce((sum, row) => sum + row.passed, 0), total: rows.reduce((sum, row) => sum + row.total, 0) };
}

export function comparison(table, { home = 'claude', tier = 'heavy', offered = {} } = {}) {
  return ROUTED_KINDS.map(kind => {
    const todayModel = modelFor(home, tier, offered[home] || []);
    const pick = pickByTask({ decided: { tier, kind, kindConfidence: 1 }, home, table, offered, place: 'new-chat' });
    const today = todayModel ? passes(table, todayModel, kind) : null, byTask = pick.model ? passes(table, pick.model, kind) : null;
    let verdict, ahead = null;
    if (!today || !byTask) verdict = 'nothing to compare';
    else if (modelKey(today.model) === modelKey(byTask.model)) verdict = `the same model (${pick.reason})`;
    else if (today.passed == null || byTask.passed == null) verdict = `not comparable: no evals for ${today.passed == null ? today.model : byTask.model}`;
    else {
      // The same task set on both, so the difference in tasks passed; if the counts differ, by rate over the smaller set.
      ahead = today.total === byTask.total ? byTask.passed - today.passed : Math.round((byTask.passed / byTask.total - today.passed / today.total) * Math.min(today.total, byTask.total));
      verdict = ahead === 0 ? 'the same' : ahead > 0 ? `better by ${ahead} task${ahead === 1 ? '' : 's'}${ahead >= 2 ? ': meets the bar to turn on' : ''}` : `worse by ${-ahead} task${ahead === -1 ? '' : 's'}`;
    }
    return { kind, today, byTask, moved: pick.moved, reason: pick.reason, ahead, verdict };
  });
}
