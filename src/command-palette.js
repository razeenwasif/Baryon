const element = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
// Every word has to appear, so "work plan" finds "Plan for the work".
export function matchItems(items, query, limit = 40) {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter(item => { const text = `${item.label} ${item.hint || ''} ${item.group || ''}`.toLowerCase(); return words.every(word => text.includes(word)); }).slice(0, limit);
}
function moveSelection(list, selected, step) { return list.length ? (selected + step + list.length) % list.length : 0; }
// ⌘K: find any command, chat, message, skill or page. It's a real dialog, so the browser pane steps aside for it.
export function setupPalette({ parent, items, search = null, enabled = () => true, onError = () => {} }) {
  const dialog = element('dialog', 'palette'); dialog.setAttribute('aria-label', 'Find anything');
  const input = element('input', 'palette-input'); input.type = 'search'; input.placeholder = 'Find a command, chat, message, skill or page'; input.autocomplete = 'off'; input.setAttribute('aria-label', 'Find anything');
  const list = element('div', 'palette-list'); list.setAttribute('role', 'listbox'); list.id = 'palette-list'; input.setAttribute('aria-controls', list.id);
  dialog.append(input, list); parent.append(dialog);
  let all = [], dynamic = [], shown = [], selected = 0, loading = 0, searchSeq = 0, searchTimer = 0;
  const choose = item => { dialog.close(); try { Promise.resolve(item.run()).catch(error => onError(error.message)); } catch (error) { onError(error.message); } };
  function draw() {
    shown = [...matchItems(all, input.value), ...dynamic];
    selected = Math.min(selected, Math.max(0, shown.length - 1));
    const nodes = [];
    let group = null;
    shown.forEach((item, index) => {
      if (item.group !== group) { group = item.group; nodes.push(element('p', 'palette-group', group)); }
      const row = element('button', index === selected ? 'palette-item selected' : 'palette-item'); row.type = 'button'; row.id = `palette-${index}`; row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(index === selected));
      row.append(element('span', '', item.label));
      if (item.hint) row.append(element('span', 'palette-hint', item.hint));
      row.onclick = () => choose(item);
      row.onmousemove = () => { if (selected !== index) { selected = index; draw(); } };
      nodes.push(row);
    });
    if (!shown.length) nodes.push(element('p', 'palette-empty', 'Nothing matches.'));
    list.replaceChildren(...nodes);
    input.setAttribute('aria-activedescendant', shown.length ? `palette-${selected}` : '');
    list.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
  }
  async function open() {
    const run = ++loading;
    clearTimeout(searchTimer); ++searchSeq;
    input.value = ''; selected = 0; all = []; dynamic = []; draw();
    dialog.showModal(); input.focus();
    try { const next = await items(); if (run === loading) { all = next; draw(); } } catch (error) { onError(error.message); }
  }
  input.oninput = () => {
    selected = 0;
    clearTimeout(searchTimer);
    const seq = ++searchSeq;
    const query = input.value.trim();
    if (query.length < 2 || typeof search !== 'function') {
      dynamic = [];
      draw();
      return;
    }
    dynamic = [];
    draw();
    searchTimer = setTimeout(async () => {
      try {
        const next = await search(query);
        if (dialog.open && seq === searchSeq) {
          dynamic = Array.isArray(next) ? next : [];
          draw();
        }
      } catch (error) {
        if (dialog.open && seq === searchSeq) onError(error.message);
      }
    }, 140);
  };
  input.onkeydown = event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); selected = moveSelection(shown, selected, event.key === 'ArrowDown' ? 1 : -1); draw(); }
    if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); if (shown[selected]) choose(shown[selected]); }
  };
  dialog.onclick = event => { if (event.target === dialog) dialog.close(); };
  const toggle = () => { if (dialog.open) dialog.close(); else if (enabled()) void open(); };
  document.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k') { event.preventDefault(); toggle(); }
  }, true);
  return { open, toggle };
}
// Typing "/" at the start of the composer lists what can run. Commands act at once; a skill goes in the box for you to add to.
export function setupSlashMenu({ input, parent, commands, onError = () => {} }) {
  const menu = element('div', 'slash-menu'); menu.hidden = true; menu.setAttribute('role', 'listbox'); menu.setAttribute('aria-label', 'Commands and skills');
  parent.append(menu);
  let all = null, shown = [], selected = 0;
  const hide = () => { menu.hidden = true; shown = []; };
  const choose = item => {
    hide();
    if (item.run) { input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); try { Promise.resolve(item.run()).catch(error => onError(error.message)); } catch (error) { onError(error.message); } }
    else { input.value = `/${item.name} `; input.dispatchEvent(new Event('input', { bubbles: true })); input.focus(); }
  };
  function draw() {
    menu.replaceChildren(...shown.map((item, index) => {
      const row = element('button', index === selected ? 'slash-item selected' : 'slash-item'); row.type = 'button'; row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(index === selected));
      row.append(element('span', 'slash-name', `/${item.name}`), element('span', 'slash-about', item.about || ''));
      if (item.source === 'project') row.append(element('span', 'palette-hint', 'this project'));
      row.onmousedown = event => { event.preventDefault(); choose(item); };
      return row;
    }));
    menu.hidden = !shown.length;
    menu.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
  }
  async function update() {
    const match = /^\/([a-z0-9-]*)$/.exec(input.value);
    if (!match) { hide(); all = null; return; }
    try { all ??= await commands(); } catch (error) { onError(error.message); return; }
    if (input.value !== `/${match[1]}`) return;
    shown = all.filter(item => item.name.startsWith(match[1])).slice(0, 12);
    selected = Math.min(selected, Math.max(0, shown.length - 1));
    draw();
  }
  input.addEventListener('input', () => { selected = 0; void update(); });
  input.addEventListener('blur', hide);
  // These come first, so Enter picks from the list rather than sending "/".
  input.addEventListener('keydown', event => {
    if (menu.hidden || !shown.length) return;
    const stop = () => { event.preventDefault(); event.stopImmediatePropagation(); };
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { stop(); selected = moveSelection(shown, selected, event.key === 'ArrowDown' ? 1 : -1); draw(); }
    else if ((event.key === 'Enter' && !event.shiftKey && !event.isComposing) || event.key === 'Tab') { stop(); choose(shown[selected]); }
    else if (event.key === 'Escape') { stop(); hide(); }
  }, true);
  return { hide };
}
