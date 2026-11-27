// Doc 7, #9: Lab journal side pane — dated, editable per-project log of what was tried,
// outcomes, and decisions, grouped by date beside the chat.
const el = (tag, className = '', text = undefined) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const todayIso = () => new Date().toISOString().slice(0, 10);

function toMarkdown(folder, entries = []) {
  const lines = [`# Lab journal${folder ? ` — ${folder}` : ''}`];
  if (!entries.length) {
    lines.push('', '_No entries yet._');
    return lines.join('\n');
  }
  let currentDate = null;
  for (const entry of entries) {
    const date = entry.date || 'Undated';
    if (date !== currentDate) {
      currentDate = date;
      lines.push('', `## ${date}`);
    }
    lines.push('', `### ${entry.title || 'Work session update'}${entry.source === 'you' ? ' (edited)' : ''}`);
    if (entry.tried) lines.push(`- **Tried:** ${entry.tried}`);
    if (entry.outcome) lines.push(`- **Outcome:** ${entry.outcome}`);
    if (entry.decision) lines.push(`- **Decision:** ${entry.decision}`);
  }
  return lines.join('\n');
}

function labeledBlock(label, text) {
  const block = el('div', 'journal-block');
  block.append(el('span', 'journal-label', label), el('p', 'journal-text', text));
  return block;
}

export function journalPane({ api, work, openChat = () => {}, onError = () => {} }) {
  let cached = null;
  let filterText = '';
  let editingId = null; // null = closed, 'new' = add form, or existing entry.id
  let copied = false;
  let copyTimer = 0;

  const pane = {
    id: 'journal',
    title: 'Lab journal',
    wide: () => true,
    reset() {
      cached = null;
      filterText = '';
      editingId = null;
      copied = false;
      clearTimeout(copyTimer);
    },
    async render(body, context) {
      const currentWork = work?.();
      if (!currentWork?.folder) {
        body.replaceChildren(el('p', 'pane-empty', 'Open a work session in a project folder to read and edit its lab journal.'));
        return;
      }
      if (!api?.labJournalList) {
        body.replaceChildren(el('p', 'pane-empty', 'Lab journal isn’t available here.'));
        return;
      }

      let data;
      try {
        data = await api.labJournalList();
      } catch (err) {
        onError(err.message);
        body.replaceChildren(el('p', 'pane-empty', `Couldn’t load lab journal: ${err.message}`));
        return;
      }
      cached = data;
      const folder = data?.folder || currentWork.folder;
      const folderName = folder.split('/').filter(Boolean).pop() || folder;
      const allEntries = Array.isArray(data?.entries) ? data.entries : [];

      const draw = () => {
        const wrap = el('div', 'journal-pane');

        const head = el('div', 'journal-head');
        const headLeft = el('div', 'journal-head-left');
        headLeft.append(el('strong', '', 'Lab journal'), el('span', 'journal-folder-pill', folderName));
        const actions = el('div', 'journal-actions');

        const addBtn = el('button', 'panel-button primary', editingId === 'new' ? 'Close form' : '+ Entry');
        addBtn.type = 'button';
        addBtn.onclick = () => {
          editingId = editingId === 'new' ? null : 'new';
          draw();
        };

        const copyBtn = el('button', 'panel-button quiet', copied ? 'Copied' : 'Copy MD');
        copyBtn.type = 'button';
        copyBtn.disabled = !allEntries.length;
        copyBtn.onclick = async () => {
          try {
            await navigator.clipboard.writeText(toMarkdown(folder, allEntries));
            copied = true;
            clearTimeout(copyTimer);
            copyTimer = setTimeout(() => { copied = false; copyBtn.textContent = 'Copy MD'; }, 1600);
            copyBtn.textContent = 'Copied';
          } catch (err) {
            onError(err.message);
          }
        };

        const refreshBtn = el('button', 'panel-button quiet', 'Refresh');
        refreshBtn.type = 'button';
        refreshBtn.onclick = () => context.redraw();

        actions.append(addBtn, copyBtn, refreshBtn);
        head.append(headLeft, actions);
        wrap.append(head);

        // Search filter
        const filterRow = el('div', 'journal-filter-row');
        const filterInput = el('input', 'journal-filter-input');
        filterInput.type = 'search';
        filterInput.placeholder = 'Filter entries…';
        filterInput.value = filterText;
        filterInput.setAttribute('aria-label', 'Filter lab journal entries');
        filterInput.oninput = () => {
          filterText = filterInput.value;
          const pos = filterInput.selectionStart;
          draw();
          const nextInput = wrap.querySelector('.journal-filter-input');
          if (nextInput) {
            nextInput.focus();
            if (pos !== null) nextInput.setSelectionRange(pos, pos);
          }
        };
        filterRow.append(filterInput);
        wrap.append(filterRow);

        // Add or Edit form
        const editingEntry = editingId && editingId !== 'new' ? allEntries.find(e => e.id === editingId) : null;
        if (editingId === 'new' || editingEntry) {
          const form = el('form', 'journal-form');
          const row1 = el('div', 'journal-form-row');
          const dateLabel = el('label', 'journal-field');
          dateLabel.append(el('span', 'journal-label', 'Date'));
          const dateInput = el('input', 'journal-input journal-date-input');
          dateInput.type = 'date';
          dateInput.value = editingEntry?.date || todayIso();
          dateLabel.append(dateInput);

          const titleLabel = el('label', 'journal-field journal-field-grow');
          titleLabel.append(el('span', 'journal-label', 'Title'));
          const titleInput = el('input', 'journal-input');
          titleInput.type = 'text';
          titleInput.placeholder = 'Short summary of what this step explored';
          titleInput.value = editingEntry?.title || '';
          titleLabel.append(titleInput);
          row1.append(dateLabel, titleLabel);

          const fieldArea = (label, placeholder, value) => {
            const box = el('label', 'journal-field');
            box.append(el('span', 'journal-label', label));
            const area = el('textarea', 'journal-textarea');
            area.rows = 2;
            area.placeholder = placeholder;
            area.value = value || '';
            box.append(area);
            return { box, area };
          };
          const triedF = fieldArea('What was tried', 'Hypotheses, changes, or experiments run…', editingEntry?.tried);
          const outcomeF = fieldArea('Outcome', 'Metrics, check results, or what happened…', editingEntry?.outcome);
          const decisionF = fieldArea('Decision / why kept or dropped', 'Why this direction stays, changed, or was dropped…', editingEntry?.decision);

          const formActions = el('div', 'journal-form-actions');
          const saveBtn = el('button', 'panel-button primary', 'Save');
          saveBtn.type = 'submit';
          const cancelBtn = el('button', 'panel-button quiet', 'Cancel');
          cancelBtn.type = 'button';
          cancelBtn.onclick = () => { editingId = null; draw(); };
          formActions.append(cancelBtn, saveBtn);

          form.onsubmit = async event => {
            event.preventDefault();
            saveBtn.disabled = true;
            const payload = {
              date: dateInput.value || todayIso(),
              title: titleInput.value.trim(),
              tried: triedF.area.value.trim(),
              outcome: outcomeF.area.value.trim(),
              decision: decisionF.area.value.trim(),
            };
            try {
              if (editingEntry) {
                await api.labJournalUpdate(editingEntry.id, payload);
              } else {
                await api.labJournalAdd(payload);
              }
              editingId = null;
              context.redraw();
            } catch (err) {
              onError(err.message);
              saveBtn.disabled = false;
            }
          };

          form.append(row1, triedF.box, outcomeF.box, decisionF.box, formActions);
          wrap.append(form);
        }

        const q = filterText.trim().toLowerCase();
        const visible = q
          ? allEntries.filter(e => `${e.date} ${e.title} ${e.tried} ${e.outcome} ${e.decision}`.toLowerCase().includes(q))
          : allEntries;

        if (!visible.length) {
          wrap.append(el('p', 'pane-empty', allEntries.length
            ? 'No journal entries match that filter.'
            : 'No journal entries for this project yet. Completed work turns that change files or run checks add dated entries here automatically, or click + Entry to log one.'));
          body.replaceChildren(wrap);
          return;
        }

        const list = el('div', 'journal-groups');
        let currentDate = null;
        let groupEl = null;
        for (const entry of visible) {
          const date = entry.date || 'Undated';
          if (date !== currentDate) {
            currentDate = date;
            const section = el('section', 'journal-date-group');
            section.append(el('h3', 'journal-date-heading', date));
            groupEl = el('div', 'journal-cards');
            section.append(groupEl);
            list.append(section);
          }
          const card = el('article', 'journal-card');
          const top = el('div', 'journal-card-head');
          const topLeft = el('div', 'journal-card-title-row');
          topLeft.append(
            el('strong', 'journal-card-title', entry.title || 'Work session update'),
            el('span', `journal-source-pill ${entry.source === 'you' ? 'is-edited' : 'is-auto'}`, entry.source === 'you' ? 'Edited' : 'Auto'),
          );
          const cardBtns = el('div', 'journal-card-actions');
          if (entry.chat) {
            const chatBtn = el('button', 'journal-mini-btn', 'Chat');
            chatBtn.type = 'button';
            chatBtn.title = 'Open the chat turn that recorded this entry';
            chatBtn.onclick = () => openChat(entry.chat);
            cardBtns.append(chatBtn);
          }
          const editBtn = el('button', 'journal-mini-btn', 'Edit');
          editBtn.type = 'button';
          editBtn.onclick = () => { editingId = entry.id; draw(); };
          const delBtn = el('button', 'journal-mini-btn journal-mini-del', 'Delete');
          delBtn.type = 'button';
          delBtn.onclick = async () => {
            delBtn.disabled = true;
            try {
              await api.labJournalRemove(entry.id);
              if (editingId === entry.id) editingId = null;
              context.redraw();
            } catch (err) {
              onError(err.message);
              delBtn.disabled = false;
            }
          };
          cardBtns.append(editBtn, delBtn);
          top.append(topLeft, cardBtns);
          card.append(top);
          if (entry.tried) card.append(labeledBlock('Tried', entry.tried));
          if (entry.outcome) card.append(labeledBlock('Outcome', entry.outcome));
          if (entry.decision) card.append(labeledBlock('Decision', entry.decision));
          groupEl.append(card);
        }
        wrap.append(list);
        body.replaceChildren(wrap);
      };

      draw();
    },
  };

  return pane;
}
