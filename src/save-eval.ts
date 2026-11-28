import './save-eval.css';

// Save as eval (docs/evals-from-sessions.md, stage 3): a card over the chat for one work request. Fairy fills it in from
// the turn (the request, where it started, a test command it ran that passed, the test files it wrote) and you accept,
// edit or write your own check. Saving runs the check once where the request started, which takes a little while: a
// check that already passes there isn't kept.
export interface EvalDraftStart {
  commit: string;
  branch?: string;
  dirty?: boolean;
  repo: string;
  kept: boolean;
  why?: string;
}

export interface EvalDraftHiddenFile {
  path: string;
  same: boolean;
  new?: boolean;
}

export interface EvalDraft {
  start: EvalDraftStart;
  title: string;
  ask: string;
  verify: string;
  tests: string[];
  hidden: EvalDraftHiddenFile[];
  changed: string[];
  kinds: string[];
}

export interface EvalSavePayload {
  title: string;
  ask: string;
  verify: string;
  hidden: string[];
  changesOnly: boolean;
  kind?: string;
  tags: string[];
}

export interface EvalSaveResult {
  title: string;
  atStart?: { exitCode: number };
}

export interface SaveEvalApi {
  evalDraft: (at: unknown) => Promise<EvalDraft>;
  evalSave: (at: unknown, choices: EvalSavePayload) => Promise<EvalSaveResult>;
}

export interface OpenSaveEvalOptions {
  api: SaveEvalApi;
  at: unknown;
  onError?: (message: string) => void;
  onSaved?: (saved: EvalSaveResult) => void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

const errMessage = (error: unknown): string => (
  error instanceof Error
    ? error.message
    : typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error)
);

const KIND_WORDS: Readonly<Record<string, string>> = { code: 'Code', maths: 'Maths', circuits: 'Circuits', research: 'Research', data: 'Data', business: 'Business', writing: 'Writing', vision: 'Vision', teaching: 'Teaching', everyday: 'Everyday' };

export async function openSaveEval({ api, at, onError = () => {}, onSaved = () => {} }: OpenSaveEvalOptions): Promise<HTMLDialogElement | null> {
  let draft: EvalDraft;
  try { draft = await api.evalDraft(at); } catch (error: unknown) { onError(errMessage(error)); return null; }
  const dialog = el('dialog', 'save-eval');
  dialog.setAttribute('aria-labelledby', 'save-eval-title');
  const form = el('form');
  form.method = 'dialog';
  const title = el('h3', '', 'Save as eval');
  title.id = 'save-eval-title';
  const where = el('p', 'save-eval-where', `Starts from ${draft.start.commit.slice(0, 10)}${draft.start.branch ? ` on ${draft.start.branch}` : ''}${draft.start.dirty ? ', with what wasn’t committed then' : ''}, in ${draft.start.repo.split('/').filter(Boolean).at(-1)}.`);
  const field = (label: string, input: HTMLElement, note = ''): HTMLLabelElement => {
    const wrap = el('label', 'save-eval-field');
    wrap.append(el('span', '', label), input);
    if (note) wrap.append(el('small', '', note));
    return wrap;
  };
  const name = el('input');
  name.value = draft.title;
  name.maxLength = 120;
  const ask = el('textarea');
  ask.value = draft.ask;
  ask.rows = 4;
  const verify = el('input');
  verify.value = draft.verify;
  verify.placeholder = 'A command whose exit says pass or fail, such as npm test';
  verify.spellcheck = false;
  if (draft.tests.length > 1) {
    const list = el('datalist');
    list.id = 'save-eval-tests';
    for (const command of draft.tests) {
      const option = el('option');
      option.value = command;
      list.append(option);
    }
    verify.setAttribute('list', list.id);
    form.append(list);
  }
  const verifyNote = draft.verify ? 'Suggested from a test command this turn ran that passed. It must fail where the request started.' : 'This turn ran no test that passed; write the command that should pass once the request is done. It must fail where the request started.';
  const parts: HTMLElement[] = [title, where];
  if (!draft.start.kept) parts.push(el('p', 'save-eval-problem', `Where this turn started wasn’t kept in full (${draft.start.why}), so it can’t be saved as an eval.`));
  parts.push(field('Name', name), field('Request', ask, 'As it’s asked each time. Edit out anything that leans on earlier turns.'), field('Check', verify, verifyNote));
  const hiddenBoxes: HTMLInputElement[] = [];
  if (draft.hidden.length) {
    const box = el('fieldset', 'save-eval-hidden');
    box.append(el('legend', '', 'Tests this turn wrote, added just before the check runs'));
    for (const file of draft.hidden) {
      const row = el('label', 'save-eval-check'), check = el('input');
      check.type = 'checkbox';
      check.value = file.path;
      check.checked = file.same;
      check.disabled = !file.same;
      row.append(check, el('span', '', file.path), el('small', '', file.same ? (file.new ? 'new' : 'changed') : 'changed since, so not offered'));
      hiddenBoxes.push(check);
      box.append(row);
    }
    parts.push(box);
  }
  const only = el('input');
  only.type = 'checkbox';
  const onlyRow = el('label', 'save-eval-check');
  onlyRow.append(only, el('span', '', `It may change only the files this turn changed (${draft.changed.length})`));
  if (draft.changed.length) { onlyRow.title = draft.changed.join('\n'); parts.push(onlyRow); }
  const kind = el('select');
  kind.append(Object.assign(el('option', '', 'Not said'), { value: '' }), ...draft.kinds.map(k => Object.assign(el('option', '', KIND_WORDS[k] || k), { value: k })));
  const tags = el('input');
  tags.placeholder = 'bugfix, parser';
  const row = el('div', 'save-eval-row');
  row.append(field('Kind', kind), field('Tags', tags));
  parts.push(row);
  const status = el('p', 'save-eval-status');
  status.setAttribute('role', 'status');
  const buttons = el('div', 'save-eval-buttons');
  const cancel = el('button', 'quiet', 'Cancel');
  cancel.type = 'button';
  cancel.onclick = () => dialog.close();
  const save = el('button', 'primary', 'Save');
  save.type = 'submit';
  save.disabled = !draft.start.kept;
  buttons.append(cancel, save);
  form.append(...parts, status, buttons);
  dialog.append(form);
  form.onsubmit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (!verify.value.trim() && !only.checked) { status.textContent = 'Give it a check: a command, or “may change only these files”.'; return; }
    save.disabled = true;
    cancel.disabled = true;
    status.textContent = verify.value.trim() ? 'Running the check where the request started…' : 'Saving…';
    try {
      const saved = await api.evalSave(at, {
        title: name.value.trim(),
        ask: ask.value.trim(),
        verify: verify.value.trim(),
        hidden: hiddenBoxes.filter(b => b.checked).map(b => b.value),
        changesOnly: only.checked,
        kind: kind.value || undefined,
        tags: tags.value.split(',').map(t => t.trim()).filter(Boolean),
      });
      status.textContent = saved.atStart ? `Saved as “${saved.title}”. Its check failed where the request started (exit ${saved.atStart.exitCode}), as it should.` : `Saved as “${saved.title}”.`;
      onSaved(saved);
      setTimeout(() => dialog.close(), 1600);
    } catch (error: unknown) {
      status.textContent = errMessage(error).replace(/Error invoking remote method '[^']+': Error: /, '');
      save.disabled = false;
      cancel.disabled = false;
    }
  };
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  name.focus();
  return dialog;
}
