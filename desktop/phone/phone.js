// Everything from the Mac is set as text, so a file's contents can't add controls to this page.
const main = document.querySelector('#main'), title = document.querySelector('#title'), status = document.querySelector('#status'), back = document.querySelector('#back');
const EVERY = 2500, SETTLE = 800;
let open = null, drawn = '', timer = null, answering = new Set(), failure = '';
function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
async function call(path, body) {
  const response = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(value.error || 'Something went wrong.'), { status: response.status });
  return value;
}
function diff(view) {
  const node = element('pre');
  for (const row of view.rows ?? []) node.append(element('span', row.type === '+' ? 'add' : row.type === '-' ? 'del' : '', `${row.type} ${row.text}\n`));
  if (view.truncated) node.append(element('span', 'more', '… more lines not shown\n'));
  return node;
}
// A new card waits a moment before taking a tap, so a second tap meant for the last card can't land on it.
function askCard(request) {
  const card = element('div', 'card ask');
  card.append(element('h3', '', request.title), element('p', 'where', request.chat));
  if (request.tooBig) card.append(element('p', 'note', 'This one is too long to show here. To allow it, answer on the Mac.'));
  if (request.macOnly) card.append(element('p', 'note', 'This reaches beyond the sandbox, so it can only be allowed on the Mac. You can refuse it here.'));
  if (request.detail) card.append(element('p', '', request.detail));
  if (request.command) card.append(element('pre', '', request.command));
  if (request.plan) card.append(element('pre', '', request.plan));
  if (request.diff?.rows?.length) card.append(diff(request.diff));
  if (request.note) card.append(element('p', 'note', request.note));
  const buttons = element('div', 'buttons'), plan = request.kind === 'plan';
  const choices = [...(request.tooBig || request.macOnly ? [] : [[plan ? 'Approve' : request.allowLabel || 'Allow once', 'allow', 'yes']]), [plan ? 'Not yet' : request.denyLabel || 'Don’t allow', 'deny', '']];
  for (const [label, decision, kind] of choices) {
    const button = element('button', kind, label);
    button.type = 'button'; button.disabled = true;
    setTimeout(() => { button.disabled = answering.has(request.id); }, SETTLE);
    button.onclick = async () => {
      answering.add(request.id);
      for (const each of buttons.children) each.disabled = true;
      try { await call('/api/answer', { id: request.id, decision }); failure = ''; }
      catch (error) { failure = error.message; }
      drawn = ''; refresh();
    };
    buttons.append(button);
  }
  card.append(buttons);
  return card;
}
const STATE = { working: 'Working', waiting: 'Needs your OK', idle: '' };
function chatRow(chat) {
  const row = element('button', 'chat'), words = element('span', 'words');
  row.type = 'button';
  words.append(element('strong', '', chat.title), element('small', '', chat.folder || ''));
  row.append(words, element('span', `state ${chat.state}`, STATE[chat.state] ?? ''));
  row.onclick = () => { open = chat.id; drawn = ''; refresh(); };
  return row;
}
const askSection = approvals => approvals.length ? [element('h2', '', approvals.length === 1 ? 'Waiting for you' : `${approvals.length} waiting for you`), ...approvals.map(askCard)] : [];
function drawOverview({ chats, approvals }) {
  back.hidden = true; title.textContent = 'Fairy';
  const parts = askSection(approvals);
  if (failure) parts.unshift(element('p', 'problem', failure));
  parts.push(element('h2', '', 'Work sessions'));
  parts.push(...(chats.length ? chats.map(chatRow) : [element('p', 'note', 'No work sessions yet.')]));
  main.replaceChildren(...parts);
}
const ROW_MARK = { running: '●', done: '✓', failed: '✕' };
function drawChat(chat, approvals) {
  back.hidden = false; title.textContent = chat.title;
  const parts = askSection(approvals);
  if (failure) parts.unshift(element('p', 'problem', failure));
  if (chat.live?.tasks?.length) {
    const list = element('ul', 'tasks');
    for (const task of chat.live.tasks) list.append(element('li', task.status, task.text));
    parts.push(element('h2', '', 'Plan'), list);
  }
  if (chat.live?.rows?.length) {
    parts.push(element('h2', '', 'What Fairy is doing'));
    for (const row of chat.live.rows) { const line = element('div', `row ${row.status}`); line.append(element('span', '', ROW_MARK[row.status] ?? '·'), element('span', '', row.detail ? `${row.summary} · ${row.detail}` : row.summary)); parts.push(line); }
  }
  if (chat.live?.text) parts.push(element('h2', '', 'Writing'), element('p', 'message', chat.live.text));
  if (chat.messages.length) {
    parts.push(element('h2', '', 'Latest messages'));
    for (const message of chat.messages) parts.push(element('p', `message ${message.role}`, message.text));
  }
  main.replaceChildren(...parts);
}
function showNotice(heading, words) { back.hidden = true; title.textContent = 'Fairy'; status.textContent = ''; const card = element('div', 'card'); card.append(element('h2', '', heading), element('p', '', words)); main.replaceChildren(card); }
async function refresh() {
  clearTimeout(timer);
  try {
    const overview = await call('/api/overview');
    const chat = open ? await call(`/api/chat?id=${encodeURIComponent(open)}`).catch(error => { if (error.status === 401) throw error; open = null; return null; }) : null;
    const approvals = overview.approvals.filter(request => !answering.has(request.id));
    status.textContent = '';
    document.title = approvals.length ? `(${approvals.length}) Fairy` : 'Fairy';
    // Drawn again only when something changed, so a card doesn't vanish under a finger.
    const next = JSON.stringify([open, overview, chat, failure, answering.size]);
    if (next !== drawn) { drawn = next; chat ? drawChat(chat, approvals) : drawOverview({ ...overview, approvals }); }
  } catch (error) {
    if (error.status === 401) { drawn = ''; showNotice('This phone isn’t paired', 'On your Mac, open Fairy, then Settings, then Phone, and scan the code it shows.'); return; }
    status.textContent = 'Can’t reach the Mac';
  }
  if (document.visibilityState === 'visible') timer = setTimeout(refresh, EVERY);
}
back.onclick = () => { open = null; drawn = ''; failure = ''; refresh(); };
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
async function start() {
  const code = /^#pair=([\w-]+)$/.exec(location.hash)?.[1];
  // Out of the address right away, so it isn't left in the phone's history.
  if (location.hash) history.replaceState(null, '', location.pathname);
  if (code) {
    try { await call('/api/pair', { code }); }
    catch (error) { showNotice('This phone couldn’t be paired', error.message); return; }
  }
  refresh();
}
start();
