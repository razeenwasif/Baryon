// Settings → Work sessions → Evals (docs/evals-from-sessions.md, stages 3–4): the tasks saved from your work sessions,
// how each is checked and where it starts, its last result beside the first time, and Run, Run all, Stop and Remove.
// A run starts only after your OK on a card, and goes on in the background.

export interface EvalTokens {
  input?: number;
  output?: number;
}

export interface EvalLastResult {
  skipped?: boolean;
  error?: string;
  ok?: boolean;
  seconds?: number;
  tokens?: EvalTokens | null;
  model?: string;
  at: string | number;
}

export interface EvalTaskSummary {
  id?: string;
  title?: string;
  repo?: string;
  commit?: string;
  kind?: string;
  tags?: string[];
  checks?: string[];
  verify?: string;
  firstSeconds?: number | null;
  firstTokens?: EvalTokens | null;
  firstModel?: string | null;
  last?: EvalLastResult | null;
}

export interface EvalsProgress {
  running?: boolean;
  done: number;
  total: number;
  current?: string;
}

export interface EvalsProblem {
  id: string;
  problem: string;
}

export interface EvalsListResponse {
  progress?: EvalsProgress;
  tasks: Array<EvalTaskSummary & {
    id: string;
    title: string;
    repo: string;
    commit: string;
    tags: string[];
    checks: string[];
  }>;
  problems: EvalsProblem[];
}

export interface EvalsSettingsApi {
  evalsList?: () => Promise<EvalsListResponse>;
  evalsRun?: (ids: string[] | 'all') => Promise<{ started?: boolean }>;
  evalsStop?: () => Promise<unknown>;
  evalRemove?: (id: string) => Promise<unknown>;
  onEvalsProgress?: (callback: (value: unknown) => void) => () => void;
}

export interface SetupEvalsSettingsOptions {
  api?: EvalsSettingsApi | null;
  root: HTMLElement;
  onError?: (message: string) => void;
}

export interface EvalsSettingsController {
  render: () => Promise<void>;
  stop: () => void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

const CHECK_WORDS: Record<string, string> = {
  testsPass: 'its check passes',
  changesOnly: 'changes only the files it did',
  changesNothing: 'changes nothing',
  checksItsWork: 'runs the tests itself',
  neverRuns: 'never runs a command',
  says: 'the answer says',
};

const n = (value: unknown): string => Number(value || 0).toLocaleString('en-AU');

const when = (stamp: string | number): string => {
  const at = new Date(stamp);
  return Number.isNaN(at.getTime()) ? '' : at.toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : (typeof error === 'object' && error !== null && 'message' in error ? String((error as { message: unknown }).message) : String(error));

// A result beside the first time: “passed in 38 s, 1,100 in / 250 out on claude-opus-5-5 · the first time 41 s, 1,200 / 300”.
export function resultLine(task: EvalTaskSummary): string {
  const first = task.firstSeconds ? `the first time ${task.firstSeconds} s${task.firstTokens ? `, ${n(task.firstTokens.input)} / ${n(task.firstTokens.output)}` : ''}${task.firstModel ? ` on ${task.firstModel}` : ''}` : '';
  if (!task.last) return first ? `Not run yet · ${first}` : 'Not run yet';
  const last = task.last.skipped ? `couldn’t start: ${task.last.error}` : `${task.last.ok ? 'passed' : 'failed'} in ${task.last.seconds} s, ${n(task.last.tokens?.input)} in / ${n(task.last.tokens?.output)} out${task.last.model ? ` on ${task.last.model}` : ''}`;
  return `Last run ${when(task.last.at)}: ${last}${first ? ` · ${first}` : ''}`;
}

export function setupEvalsSettings({ api, root, onError = () => {} }: SetupEvalsSettingsOptions): EvalsSettingsController {
  let polling: ReturnType<typeof setInterval> | null = null;
  let asking = false;
  let unsubscribe: (() => void) | null = null;
  const stopPolling = (): void => { if (polling) clearInterval(polling); polling = null; };

  async function run(ids: string[] | 'all', button: HTMLButtonElement): Promise<void> {
    if (!api?.evalsRun) return;
    asking = true; button.disabled = true;
    const note = root.querySelector('.evals-progress'); if (note) note.textContent = 'Waiting for your OK on the card…';
    try { const started = await api.evalsRun(ids); if (!started.started && note) note.textContent = 'Not run.'; }
    catch (error) { onError(errorMessage(error)); }
    finally { asking = false; await render(); }
  }

  async function render(): Promise<void> {
    if (!api?.evalsList) { root.replaceChildren(); return; }
    let listed: EvalsListResponse;
    try { listed = await api.evalsList(); } catch (error) { root.replaceChildren(el('p', 'field-note', errorMessage(error))); return; }
    const running = Boolean(listed.progress?.running);
    // While a run goes on, the list reads itself again, which also works in the MacBook's window.
    if (running && !polling) polling = setInterval(() => void render(), 4000);
    if (!running) stopPolling();
    if (!unsubscribe && api.onEvalsProgress) unsubscribe = api.onEvalsProgress(() => void render());
    const head = el('div', 'evals-head'); head.append(el('h4', '', 'Evals saved from your work'));
    const runAll = el('button', 'panel-button', 'Run all'); runAll.type = 'button'; runAll.disabled = running || asking || !listed.tasks.length;
    runAll.onclick = () => void run('all', runAll);
    const stop = el('button', 'panel-button quiet', 'Stop'); stop.type = 'button'; stop.hidden = !running;
    stop.onclick = async () => { stop.disabled = true; try { await api.evalsStop?.(); } catch (error) { onError(errorMessage(error)); } };
    const actions = el('div', 'evals-actions'); actions.append(stop, runAll); head.append(actions);
    const intro = el('p', 'field-note', 'A request you saved with Save as eval under a work message: the request, the repository as it was when you asked, and a check. Run them to see how Fairy does on your own work now: each is one work turn on your work sessions provider, in a throwaway copy, after your OK on a card. Each run is also kept under Saved evals in Runs, to compare models and versions. node scripts/eval.mjs --saved runs them from a terminal too.');
    const progress = el('p', 'field-note evals-progress', running && listed.progress ? `Running ${Math.min(listed.progress.done + 1, listed.progress.total)} of ${listed.progress.total}: ${listed.progress.current}` : '');
    const list = el('ul', 'evals-list');
    for (const task of listed.tasks) {
      const li = el('li', 'evals-item'), text = el('div', 'evals-text');
      const verdict = task.last && !task.last.skipped ? el('span', `evals-verdict ${task.last.ok ? 'ok' : 'failed'}`, task.last.ok ? 'Passed' : 'Failed') : null;
      const top = el('div', 'evals-title'); top.append(el('b', '', task.title)); if (verdict) top.append(verdict);
      text.append(top, el('span', 'field-note', `${task.repo.split('/').filter(Boolean).at(-1)} at ${task.commit}${task.kind ? ` · ${task.kind}` : ''}${task.tags.length ? ` · ${task.tags.join(', ')}` : ''}`),
        el('span', 'field-note', `Passes when ${task.checks.map(c => CHECK_WORDS[c] || c).join(' and ')}${task.verify ? `: ${task.verify}` : ''}`), el('span', 'field-note', resultLine(task)));
      const buttons = el('div', 'evals-actions');
      const one = el('button', 'panel-button', 'Run'); one.type = 'button'; one.disabled = running || asking; one.onclick = () => void run([task.id], one);
      const remove = el('button', 'panel-button quiet', 'Remove'); remove.type = 'button'; remove.disabled = running;
      remove.onclick = async () => {
        if (!window.confirm(`Remove “${task.title}” from your saved evals?`)) return;
        try { await api.evalRemove?.(task.id); await render(); } catch (error) { onError(errorMessage(error)); }
      };
      buttons.append(remove, one); li.append(text, buttons); list.append(li);
    }
    for (const { id, problem } of listed.problems) list.append(el('li', 'evals-item field-note', `${id} couldn’t be read: ${problem}`));
    root.replaceChildren(head, intro, progress, listed.tasks.length || listed.problems.length ? list : el('p', 'field-note', 'None yet. Under a work message, choose Save as eval.'));
  }

  return { render, stop: () => { stopPolling(); unsubscribe?.(); unsubscribe = null; } };
}
