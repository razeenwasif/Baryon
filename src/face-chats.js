// Two Macs: a face's chats window. The other Mac's chats, the questions waiting for your OK there, and sending a
// message, all through the phone link as a phone does it (desktop/face-main.cjs). A message from here gets a phone's
// kind of reply: conversation, Gmail or Calendar; work sessions can be read but are written to on the other Mac.
import 'katex/dist/katex.min.css';
import './face-chats.css';
import { renderReply } from './reply-renderer.js';
import { setupMessageRail } from './message-rail.js';
import { formatReplyTime } from './reply-time.js';

const api = window.fairy, $ = selector => document.querySelector(selector);
const element = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
const clean = error => String(error?.message || error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
const STATE = { working: 'Working…', waiting: 'Needs your OK', idle: '' };
const WORDS = { unpaired: 'Not paired', connecting: 'Connecting…', unreachable: 'Can’t reach your other Mac', changed: 'Pair again', forgotten: 'Pair again' };

$('#chats').innerHTML = `
  <aside><div class="side-head"><b>Chats</b><span id="link"></span></div><button id="new" type="button">New chat</button><section id="asks" aria-label="Waiting for your OK"></section><nav id="list" aria-label="Chats"></nav></aside>
  <main><div class="head"><h1 id="title">New chat</h1><span id="state"></span><button id="stop" class="small" type="button" hidden>Stop</button></div>
    <div id="messages" role="log" aria-live="polite"></div><p id="note"></p>
    <form id="composer"><textarea id="text" rows="2" maxlength="12000" placeholder="Message Fairy" aria-label="Message Fairy"></textarea><button type="submit">Send</button></form></main>`;
const messageRail = setupMessageRail({ scroller: $('#messages'), host: $('main'), inset: true, isMessage: node => node.classList.contains('msg'), isMine: node => node.classList.contains('user'), textOf: node => node.textContent || '' });

let open = null, chats = [], drawn = '', askDrawn = '', link = 'connecting', sending = false;
const current = () => chats.find(chat => chat.id === open);

function showLink(state) {
  link = state?.link || 'unreachable';
  $('#link').textContent = link === 'connected' ? (state.host || '').split('.')[0] : WORDS[link] ?? WORDS.unreachable;
  $('#link').classList.toggle('down', link !== 'connected');
}
async function refreshList() {
  try { chats = await api.faceChatsList(); } catch { return; }
  const list = $('#list');
  list.replaceChildren(...chats.map(chat => {
    const row = element('button', 'chat');
    row.type = 'button'; row.setAttribute('aria-current', String(chat.id === open));
    const state = STATE[chat.state] ?? '';
    row.append(element('span', '', chat.title || 'Untitled'), element('small', chat.state, state || (chat.work ? 'Work session' : chat.folder || '')));
    row.onclick = () => openChat(chat.id);
    return row;
  }));
}
function openChat(id) {
  open = id; drawn = '';
  $('#messages').replaceChildren(); $('#title').textContent = id ? current()?.title || 'Chat' : 'New chat'; $('#state').textContent = ''; $('#stop').hidden = true;
  if (!id) $('#messages').append(element('p', 'empty', 'Ask Fairy anything. Your other Mac answers, and the chat is kept there.'));
  composerFor(id ? current() : null);
  void api.faceChatsWatch(id).catch(() => {});
  void refreshList();
  $('#text').focus();
}
function composerFor(chat) {
  const work = Boolean(chat?.work);
  $('#text').disabled = work; $('#composer button').disabled = work;
  $('#note').textContent = work ? 'This is a work session. Follow it here; to write in it, use Fairy on your other Mac.' : '';
}
function askCard(request) {
  const card = element('div', 'ask');
  card.append(element('b', '', request.title || 'Fairy needs your OK'));
  const detail = [request.detail, request.command, request.plan].filter(Boolean).join('\n\n');
  if (detail) card.append(element('p', '', detail));
  if (request.macOnly) card.append(element('p', '', 'This one can only be allowed on your other Mac.'));
  if (request.tooBig) card.append(element('p', '', 'This one is too long to answer here. Answer it on your other Mac.'));
  const buttons = element('div', 'buttons');
  const choices = [...(request.macOnly || request.tooBig ? [] : [['Allow', 'allow', 'yes']]), ['Don’t allow', 'deny', '']];
  for (const [label, decision, kind] of choices) {
    const button = element('button', `small ${kind}`, label);
    button.type = 'button';
    button.onclick = async () => {
      for (const each of buttons.children) each.disabled = true;
      try { await api.faceChatsAnswer(request.id, decision); } catch (error) { card.append(element('p', 'problem', clean(error))); for (const each of buttons.children) each.disabled = false; }
    };
    buttons.append(button);
  }
  card.append(buttons);
  return card;
}
function drawAsks(approvals = []) {
  const signature = JSON.stringify(approvals.map(item => item.id));
  if (signature === askDrawn) return;
  askDrawn = signature;
  $('#asks').replaceChildren(...approvals.map(askCard));
}
function messageNode({ role, text, at, attachments, from }) {
  const node = element('div', `msg ${role}`);
  if (role === 'assistant') renderReply(node, text, url => window.open(url));
  else node.textContent = text;
  const formatted = role === 'assistant' ? formatReplyTime(at) : null;
  const stamp = role === 'assistant' ? (formatted?.label || '') : (at ? new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');
  const meta = [from?.title ? `from ${from.title}` : '', attachments?.length ? attachments.map(item => item.name).join(', ') : '', stamp].filter(Boolean).join(' · ');
  if (meta) {
    const line = element('span', 'meta', meta);
    if (formatted?.title) line.title = formatted.title;
    node.append(line);
  }
  return node;
}
function drawChat(chat) {
  if (!chat || chat.id !== open) return;
  const signature = JSON.stringify([chat.messages, chat.live, chat.state, chat.failure]);
  if (signature === drawn) return;
  const box = $('#messages'), atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  drawn = signature;
  $('#title').textContent = chat.title || 'Chat';
  $('#state').textContent = STATE[chat.state] ?? '';
  $('#stop').hidden = chat.state !== 'working';
  const parts = (chat.messages ?? []).map(messageNode);
  if (chat.live) {
    const live = element('div', 'live');
    if (chat.live.rows?.length) { const list = element('ul'); for (const row of chat.live.rows.slice(-8)) list.append(element('li', row.status, row.summary || row.tool || '')); live.append(list); }
    if (chat.live.text) { const text = element('div', 'msg assistant'); renderReply(text, chat.live.text, url => window.open(url)); live.append(text); }
    else if (!chat.live.rows?.length) live.append(element('span', '', 'Thinking…'));
    parts.push(live);
  }
  if (chat.failure) parts.push(element('p', 'problem', chat.failure));
  box.replaceChildren(...(parts.length ? parts : [element('p', 'empty', 'Nothing here yet.')]));
  messageRail.refresh();
  if (atEnd) box.scrollTop = box.scrollHeight;
}

$('#composer').onsubmit = async event => {
  event.preventDefault();
  const text = $('#text').value.trim();
  if (!text || sending) return;
  sending = true; $('#composer button').disabled = true;
  try {
    const { chat } = await api.faceChatsSend({ chat: open, text });
    $('#text').value = '';
    if (chat && chat !== open) openChat(chat);
  } catch (error) { $('#note').textContent = clean(error); }
  finally { sending = false; composerFor(open ? current() : null); }
};
$('#text').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('#composer').requestSubmit(); } });
$('#new').onclick = () => openChat(null);
$('#stop').onclick = () => { if (open) void api.faceChatsStop(open).catch(error => { $('#note').textContent = clean(error); }); };

let listSoon = null;
api.onFaceChats?.(value => {
  drawAsks(value?.overview?.approvals);
  drawChat(value?.chat);
  // The list catches up a moment after anything changes, and its titles follow.
  clearTimeout(listSoon); listSoon = setTimeout(refreshList, 1500);
});
api.onFaceChatsState?.(state => { showLink(state); if (state?.link === 'connected') void refreshList(); });
api.faceChatsState?.().then(state => { showLink(state); return refreshList(); }).then(() => openChat(chats[0]?.id ?? null)).catch(() => openChat(null));
