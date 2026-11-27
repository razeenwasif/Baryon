import { createPopover, el } from './popover.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const cleanErr = error => String(error?.message || error || '').replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');

/**
 * Floating popup menu opened from the sidebar Routines icon (#routines).
 * Displays existing scheduled routines with last-run info, enables inline Create/Edit/Toggle/Run/Delete,
 * and links to Skills/Hooks/Watchers in Settings if needed.
 */
export function createRoutinesPopover({
  api,
  anchor,
  onError = () => {},
  onOpenSkillsSettings = () => {},
} = {}) {
  let state = { schedules: [], watchers: [] };
  let editing = null; // null | { id: string | null, title, prompt, time, days: number[], enabled: boolean }
  let msg = '';
  let msgIsErr = false;

  const pop = createPopover({
    anchor,
    className: 'fairy-popover--routines',
    label: 'Routines',
    align: 'right-of',
    width: 390,
    onOpen: async () => {
      msg = '';
      editing = null;
      await refresh();
    },
  });

  async function refresh() {
    if (!api?.automationState) return;
    try {
      const next = await api.automationState();
      if (next) state = next;
    } catch (e) {
      msg = cleanErr(e);
      msgIsErr = true;
    }
    if (pop.isOpen()) {
      render();
      pop.position();
    }
  }

  async function runAction(fn, okMsg = '') {
    msg = '';
    msgIsErr = false;
    try {
      const next = await fn();
      if (next) state = next;
      if (okMsg) msg = okMsg;
    } catch (e) {
      msg = cleanErr(e);
      msgIsErr = true;
      onError(msg);
    }
    if (pop.isOpen()) {
      render();
      pop.position();
    }
  }

  function startEditor(schedule = null) {
    editing = schedule
      ? {
          id: schedule.id,
          title: schedule.title || '',
          prompt: schedule.prompt || '',
          time: schedule.time || '09:00',
          days: Array.isArray(schedule.days) ? [...schedule.days] : [1, 2, 3, 4, 5],
          enabled: schedule.enabled !== false,
        }
      : { id: null, title: '', prompt: '', time: '09:00', days: [1, 2, 3, 4, 5], enabled: true };
    msg = '';
    render();
    pop.position();
    pop.panel.querySelector('.fp-input')?.focus();
  }

  function renderEditor() {
    const form = el('div', 'fp-form');
    const titleInput = el('input', 'fp-input');
    titleInput.placeholder = 'Morning brief';
    titleInput.maxLength = 80;
    titleInput.value = editing.title;

    const promptInput = el('textarea', 'fp-textarea');
    promptInput.rows = 3;
    promptInput.placeholder = 'What should Fairy do when this routine fires?';
    promptInput.value = editing.prompt;

    const timeRow = el('div', 'fp-inline-row');
    const timeLabel = el('label', 'fp-field');
    timeLabel.append(el('span', 'fp-field-label', 'Time'));
    const timeInput = el('input', 'fp-input fp-time-input');
    timeInput.type = 'time';
    timeInput.value = editing.time || '09:00';
    timeLabel.append(timeInput);
    timeRow.append(timeLabel);

    const daysWrap = el('div', 'fp-days');
    const selectedDays = new Set(editing.days);
    DAYS.forEach((dayName, dayIndex) => {
      const dayBtn = el('button', `fp-day-pill${selectedDays.has(dayIndex) ? ' is-on' : ''}`, dayName);
      dayBtn.type = 'button';
      dayBtn.setAttribute('aria-pressed', String(selectedDays.has(dayIndex)));
      dayBtn.onclick = () => {
        if (selectedDays.has(dayIndex)) selectedDays.delete(dayIndex);
        else selectedDays.add(dayIndex);
        const on = selectedDays.has(dayIndex);
        dayBtn.classList.toggle('is-on', on);
        dayBtn.setAttribute('aria-pressed', String(on));
      };
      daysWrap.append(dayBtn);
    });

    const titleField = el('label', 'fp-field');
    titleField.append(el('span', 'fp-field-label', 'Name'), titleInput);
    const promptField = el('label', 'fp-field');
    promptField.append(el('span', 'fp-field-label', 'Prompt'), promptInput);
    const daysField = el('div', 'fp-field');
    daysField.append(el('span', 'fp-field-label', 'Days'), daysWrap);

    const actions = el('div', 'fp-form-actions');
    const cancelBtn = el('button', 'fp-btn-quiet', 'Cancel');
    cancelBtn.type = 'button';
    cancelBtn.onclick = () => { editing = null; msg = ''; render(); pop.position(); };

    const saveBtn = el('button', 'fp-btn-primary', editing.id ? 'Save changes' : 'Create routine');
    saveBtn.type = 'button';
    saveBtn.onclick = () => void runAction(async () => {
      const payload = {
        title: titleInput.value.trim(),
        prompt: promptInput.value.trim(),
        time: timeInput.value,
        days: [...selectedDays].sort((a, b) => a - b),
        enabled: editing.enabled,
      };
      const res = editing.id && api?.scheduleUpdate
        ? await api.scheduleUpdate(editing.id, payload)
        : await api.scheduleAdd(payload);
      editing = null;
      return res;
    });

    actions.append(cancelBtn, saveBtn);
    form.append(titleField, promptField, timeRow, daysField, actions);
    return form;
  }

  function render() {
    const schedules = Array.isArray(state?.schedules) ? state.schedules : [];
    const header = el('div', 'fp-head');
    header.append(el('strong', 'fp-title', editing ? (editing.id ? 'Edit routine' : 'New routine') : 'Routines'));
    if (!editing) {
      const addBtn = el('button', 'fp-btn-primary fp-btn-sm', '+ New');
      addBtn.type = 'button';
      addBtn.onclick = () => startEditor(null);
      header.append(addBtn);
    }

    const parts = [header];
    if (msg) parts.push(el('p', `fp-status${msgIsErr ? ' is-error' : ''}`, msg));

    if (editing) {
      parts.push(renderEditor());
    } else {
      const scroll = el('div', 'fp-scroll');
      if (!schedules.length) {
        scroll.append(el('p', 'fp-empty', 'No routines scheduled yet. Click + New to set up a daily or weekly prompt.'));
      } else {
        for (const s of schedules) {
          const card = el('div', `fp-routine-card${s.enabled === false ? ' is-paused' : ''}`);
          const top = el('div', 'fp-routine-top');
          top.append(el('strong', 'fp-routine-title', s.title || 'Routine'));
          top.append(el('span', `fp-routine-badge${s.enabled === false ? ' is-paused' : ''}`, s.enabled === false ? 'Paused' : 'Active'));

          const daysText = (s.days || []).map(d => DAYS[d]).filter(Boolean).join(' ');
          const meta = el('div', 'fp-routine-meta', `${s.time} · ${daysText}${s.lastRun ? ` · Last ran ${s.lastRun}` : ' · Never run yet'}`);
          const promptPreview = el('p', 'fp-routine-prompt', s.prompt || '');

          const rowActions = el('div', 'fp-routine-actions');
          const toggleBtn = el('button', 'fp-btn-quiet fp-btn-xs', s.enabled === false ? 'Enable' : 'Pause');
          toggleBtn.type = 'button';
          toggleBtn.disabled = !api?.scheduleUpdate;
          toggleBtn.onclick = () => void runAction(() => api.scheduleUpdate(s.id, { enabled: s.enabled === false }));

          const runBtn = el('button', 'fp-btn-quiet fp-btn-xs', 'Run now');
          runBtn.type = 'button';
          runBtn.onclick = () => void runAction(() => api.scheduleRun(s.id), `Started “${s.title}” in the background.`);

          const editBtn = el('button', 'fp-btn-quiet fp-btn-xs', 'Edit');
          editBtn.type = 'button';
          editBtn.onclick = () => startEditor(s);

          const delBtn = el('button', 'fp-btn-danger fp-btn-xs', 'Delete');
          delBtn.type = 'button';
          delBtn.onclick = () => void runAction(() => api.scheduleRemove(s.id));

          rowActions.append(toggleBtn, runBtn, editBtn, delBtn);
          card.append(top, meta, promptPreview, rowActions);
          scroll.append(card);
        }
      }
      parts.push(scroll);

      const footer = el('div', 'fp-foot');
      const moreBtn = el('button', 'fp-link-btn', 'Skills, hooks & watchers in Settings ↗');
      moreBtn.type = 'button';
      moreBtn.onclick = () => { pop.close(); void onOpenSkillsSettings(); };
      footer.append(moreBtn);
      parts.push(footer);
    }

    pop.panel.replaceChildren(...parts);
  }

  return {
    toggle: () => pop.toggle(),
    close: () => pop.close(),
    refresh,
  };
}
