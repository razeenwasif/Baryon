// What you said you'd do, in Settings: whether Fairy keeps track, the open promises with when they're due, and the
// ones ticked off lately. Each can be ticked off or removed; ticking one off on the phone shows here straight away.
const pad = number => String(number).padStart(2, '0');
const dayKey = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

// "Today 1:30 pm", "Tomorrow", "Fri 14 Nov", or "No date".
export function promiseWhen(item, now = new Date()) {
  if (!item.due) return 'No date';
  const date = item.allDay ? new Date(`${item.due}T12:00`) : new Date(item.due), tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const day = dayKey(date) === dayKey(now) ? 'Today' : dayKey(date) === dayKey(tomorrow) ? 'Tomorrow' : date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  return item.allDay ? day : `${day} ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

export function setupPromiseSettings({ api, root }) {
  root.insertAdjacentHTML('beforeend', `<section id="promises-settings"><h4>What you said you’d do</h4>
    <label>Keep track of promises<select name="promisesMode"><option value="on">On · nudge me when they’re due</option><option value="off">Off</option></select></label>
    <p class="field-note">When you tell Fairy you’ll do something (“I’ll email Sam after lunch”, “remind me to call Mum tomorrow”), in any chat, by voice or from your iPhone, she keeps it here and nudges you when it’s due: a notification on this Mac, or on your iPhone while you’re away. Only lines that sound like a promise are checked, once a minute, by Claude’s Haiku (or Gemini, or Codex), and only your own words are kept. Work sessions are left out. They also show in Your week on your iPhone, where you can tick them off.</p>
    <div class="field-grid"><button type="button" id="promises-check" class="quiet">Look now</button></div>
    <p id="promises-status" class="field-note" role="status"></p>
    <div id="promises-list"></div></section>`);
  const list = root.querySelector('#promises-list'), status = root.querySelector('#promises-status');
  let view = { open: [], done: [], note: '' };
  function row(item, done) {
    const line = document.createElement('div'); line.className = 'promise-row' + (done ? ' done' : '') + (item.overdue ? ' overdue' : '');
    const tick = document.createElement('button'); tick.type = 'button'; tick.className = 'promise-tick'; tick.setAttribute('aria-pressed', String(done));
    tick.setAttribute('aria-label', done ? `Not done yet: ${item.what}` : `Done: ${item.what}`); tick.textContent = done ? '✓' : '';
    tick.onclick = () => act(() => api.promiseDone(item.id, !done));
    const words = document.createElement('div'); words.className = 'promise-words';
    const what = document.createElement('b'); what.textContent = item.what;
    const when = document.createElement('span'); when.textContent = done ? 'Done' : `${item.overdue ? 'Overdue · ' : ''}${promiseWhen(item)}${item.said ? ` · “${item.said}”` : ''}`;
    words.append(what, when);
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'quiet promise-remove'; remove.textContent = 'Remove'; remove.setAttribute('aria-label', `Remove: ${item.what}`);
    remove.onclick = () => act(() => api.promiseRemove(item.id));
    line.append(tick, words, remove);
    return line;
  }
  function render() {
    list.replaceChildren();
    if (!view.open.length) { const empty = document.createElement('p'); empty.className = 'field-note'; empty.textContent = 'Nothing yet. Tell Fairy something you’ll do and it shows up here within a minute.'; list.append(empty); }
    for (const item of view.open) list.append(row(item, false));
    if (view.done.length) { const title = document.createElement('p'); title.className = 'memory-group'; title.textContent = 'Done lately'; list.append(title); for (const item of view.done.slice(0, 5)) list.append(row(item, true)); }
    status.textContent = view.note || '';
  }
  async function act(work) { try { view = await work(); render(); } catch (error) { status.textContent = error.message; } }
  root.querySelector('#promises-check').onclick = () => { status.textContent = 'Looking…'; void act(() => api.promisesCheck()); };
  api?.onPromises?.(value => { view = value; render(); });
  return { refresh: () => api?.promises ? act(() => api.promises()) : Promise.resolve() };
}
