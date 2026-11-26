import 'katex/dist/katex.min.css';
import { paintStatus } from './tool-glyphs.js';
import { CURSOR_FAR_MS, cursorCheckDelay } from './cursor-check.js';
import './tool-glyphs.css';
import './replies.css';
import './floating.css';
import './radial-menu.css';
import './companion.css';
import idleSheet from '../ios/Fairy/Assets.xcassets/eye-idle.imageset/eye-idle.png';
import listeningSheet from '../ios/Fairy/Assets.xcassets/eye-listening.imageset/eye-listening.png';
import speakingSheet from '../ios/Fairy/Assets.xcassets/eye-speaking.imageset/eye-speaking.png';
import { renderReply } from './reply-renderer.js';
import { setupRadialMenu } from './radial-menu.js';
import { icons } from './icons.js';
import { setupFaceVoice } from './face-voice.js';
import { clickThrough, nearBox } from './companion-hit.js';
import { Avatar } from './avatar.js';
import { CursorSampler } from './cursor-tracking.js';
import { WalkingAnimation } from './walking-animation.js';

// The floating companion: Fairy's eye with the same radial menu as floating mode, in its own small
// window. Typing on the ring asks her in the companion's quick chat; voice, mute and meeting mode
// still belong to the main window, so those buttons pass through to it.
const api = window.fairy;
// Two Macs: the same page, opened as a face of the Fairy on another Mac (desktop/face-main.cjs). What belongs to a full
// Fairy's window is hidden, and her link to the other Mac decides what the status line says.
const face = new URLSearchParams(location.search).get('role') === 'face';
const FACE_WORDS = { unpaired: 'Not paired with your other Mac', connecting: 'Reaching your other Mac…', unreachable: 'Can’t reach your other Mac', changed: 'Your other Mac’s certificate changed. Pair again.', forgotten: 'This Mac was removed. Pair again.' };
let faceLink = face ? 'unpaired' : 'connected';
const idleWords = () => FACE_WORDS[faceLink] ?? 'Ready when you are';
const $ = selector => document.querySelector(selector);
document.documentElement.classList.add('floating', 'companion-page');
// Clicks on the window's see-through parts reach the windows behind it (companion-hit.js).
if (api?.companionPassthrough) { const follow = clickThrough(value => api.companionPassthrough(value), { near: (x, y) => nearBox($('#eye')?.getBoundingClientRect(), x, y) }); document.addEventListener('mousemove', follow); }
$('#companion').innerHTML = `
  <section class="approval" id="approval" aria-live="assertive" hidden><b id="approval-title"></b><pre id="approval-detail"></pre><div class="approval-actions"><button type="button" id="approval-deny">Deny</button><button type="button" id="approval-allow">Allow</button></div></section>
  <div class="reply" id="reply" role="log" aria-live="polite" hidden><div id="reply-text"></div><button type="button" id="close-reply" aria-label="Close reply">×</button></div>
  <div id="floating-ui">
    <div id="floating-composer"><textarea id="floating-message" rows="2" maxlength="12000" placeholder="Ask Fairy…" aria-label="Ask Fairy"></textarea><button id="floating-send" aria-label="Send message" title="Send message (Enter)">↑</button></div>
    <div id="floating-controls"><span class="floating-handle" aria-hidden="true"></span>
      <button id="floating-listening" class="icon-button" data-mirror aria-label="Turn microphone on" title="Turn microphone on (⌘⇧M)">${icons.microphoneOff}</button>
      <button id="floating-mic" class="icon-button" data-mirror aria-label="Record a single message" title="Record a single message"></button>
      <button id="floating-mode" aria-label="Current mode: Chat. Click to switch." title="Switch mode: Chat or Desktop task">Chat</button>
      <button id="floating-explain" class="icon-button" aria-pressed="false" aria-label="Explain what you’re looking at" title="Explain what you’re looking at, drawn beside it">${icons.explain}</button>
      <button id="floating-wave" class="icon-button" aria-label="Wave hello" title="Wave hello"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 11V6a1.5 1.5 0 0 1 3 0v4M10 10V4.5a1.5 1.5 0 0 1 3 0V10M13 10V5.5a1.5 1.5 0 0 1 3 0V12M16 9.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-2.7L3.5 15a1.5 1.5 0 0 1 2.4-1.8L7 14.5"/></svg></button>
      <button id="floating-mute" class="icon-button" data-mirror aria-label="Mute voice" title="Mute voice">${icons.speaker}</button>
      <button id="floating-new-topic" data-mirror>Surprise me</button><button id="floating-news" data-mirror>News</button><button id="floating-pause-ideas" data-mirror>Pause ideas</button>
      <button id="floating-sing" data-mirror>Sing</button><button id="floating-music" data-mirror>Music</button>
      <button id="floating-hands-free" data-mirror>Hands-free</button><button id="floating-pause-awareness" data-mirror>Pause awareness</button>
      <button id="floating-quiz-hints" data-mirror>Quiz hints</button><button id="floating-quiz-auto" data-mirror>Auto hints</button>
      <button id="floating-ride" class="icon-button" aria-pressed="false" aria-label="Ride along" title="Ride along: when she’s idle, Fairy shrinks onto your pointer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 3l7 17 2.5-7.5L21 10z"/><circle cx="18" cy="18" r="2.5"/></svg></button>
      <button id="floating-meeting" class="icon-button" data-mirror aria-label="Meeting mode" title="Meeting mode">${icons.transcribe}</button>
      <button id="open-workspace" aria-label="Open the window" title="Open the window">↗</button>
      <button id="floating-stop" aria-label="Stop" title="Stop">■</button>
      <button id="companion-close" aria-label="Put the companion away" title="Put the companion away">×</button>
    </div>
    <div id="floating-status">Ready when you are</div>
  </div>
  <div id="eye" role="img" aria-label="Fairy" data-mood="idle"></div>`;

const eye = $('#eye');
// Fairy's own sprite sheets, 80 px frames: idle blinks, listening watches, speaking talks.
for (const [name, sheet] of [['idle', idleSheet], ['listening', listeningSheet], ['speaking', speakingSheet]]) eye.style.setProperty(`--eye-${name}`, `url("${sheet}")`);
let quietTimer = null;
// Fairy's animated eye, as floating Fairy had it: idle animations, reactions, naps, a wave, and her gaze on the pointer.
// The sheets above stay underneath for when it can't draw.
const eyeAvatar = (() => {
  try {
    const box = document.createElement('div'); box.className = 'eye-avatar'; eye.append(box);
    const avatar = new Avatar(box); avatar.setCharacter('fairy'); void avatar.setMode('sprite');
    eye.classList.add('animated');
    return avatar;
  } catch (error) { console.warn('The animated eye couldn’t start:', error.message); return null; }
})();
const ACTIVITY = { idle: 'idle', listening: 'thinking', speaking: 'speaking' };
function mood(value) { clearTimeout(quietTimer); eye.dataset.mood = value; eyeAvatar?.setActivity(ACTIVITY[value] || 'idle'); }

let bloomTimer = null;
api.onCompanionBloom?.(() => {
  clearTimeout(bloomTimer);
  document.body.classList.remove('dock-hover', 'docking-out', 'bloom-in');
  void document.body.offsetWidth;
  document.body.classList.add('bloom-in');
  bloomTimer = setTimeout(() => document.body.classList.remove('bloom-in'), 280);
});
api.onCompanionDockHover?.(({ active = false, docking = false } = {}) => {
  document.body.classList.toggle('dock-hover', Boolean(active) && !docking);
  document.body.classList.toggle('docking-out', Boolean(docking));
});

const menu = setupRadialMenu({
  container: $('#floating-controls'),
  anchor: () => { const rect = eye.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, r: rect.width / 2 }; },
  input: $('#floating-message'), send: $('#floating-send'), status: $('#floating-status'), pointer: () => api.companionCursor(),
  // The same ring as floating mode: what belongs to the main window (voice, ideas, senses, meeting) is mirrored from it.
  actions: ['#floating-listening', '#floating-mic', '#floating-explain', '#floating-mode', '#floating-wave', '#floating-mute',
    { label: 'Ideas', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/></svg>', items: ['#floating-new-topic', '#floating-news', '#floating-pause-ideas', '#floating-sing', '#floating-music'] },
    { label: 'Senses', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>', items: ['#floating-hands-free', '#floating-pause-awareness', '#floating-quiz-hints', '#floating-quiz-auto'] },
    { label: 'More', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>', items: ['#floating-ride', '#floating-meeting', '#open-workspace', '#floating-stop', '#companion-close'] }],
});
// Check the cursor itself, since macOS sends hover late to a window that isn't focused: often near the window, a few
// times a second far from it (src/cursor-check.js).
let hovering = false, pointerInside = false;
async function checkCursor() {
  let next = CURSOR_FAR_MS;
  try {
    if (document.hidden) return;
    const point = await api.companionCursor().catch(() => null), rect = eye.getBoundingClientRect();
    pointerInside = Boolean(point) && point.x >= 0 && point.y >= 0 && point.x <= innerWidth && point.y <= innerHeight;
    const over = Boolean(point) && Math.hypot(point.x - (rect.left + rect.width / 2), point.y - (rect.top + rect.height / 2)) <= rect.width / 2 + 6;
    if (over !== hovering) { hovering = over; menu.spriteHover(over); }
    next = cursorCheckDelay(point, innerWidth, innerHeight);
  } finally { setTimeout(checkCursor, next); }
}
void checkCursor();

let busy = false, replyAt = 0;
function showReply(text, { thinking = false } = {}) {
  replyAt = Date.now();
  $('#reply').hidden = !text && !thinking;
  const box = $('#reply-text');
  if (thinking && !text) { box.className = 'thinking'; box.textContent = 'Thinking…'; return; }
  box.className = ''; box.replaceChildren(); renderReply(box, text, () => {});
  $('#reply').scrollTop = $('#reply').scrollHeight;
}
function setBusy(value) { busy = value; document.body.classList.toggle('busy', value); $('#floating-mode').disabled = value; mood(value ? 'listening' : 'idle'); paintStatus($('#floating-status'), value ? (mode === 'task' ? 'Starting the task…' : 'Thinking…') : idleWords()); }
// explain: the pen. Fairy draws her answer on the screen beside what you're reading. With an empty ring the pen arms
// Explain, so the next question is drawn; pressing it again with nothing typed explains what's on the screen.
let armed = false;
function arm(value) {
  armed = value; $('#floating-explain').setAttribute('aria-pressed', String(value));
  placeholder(); menu.render();
}
// Chat and Desktop task in one: Chat asks her, and when you ask for something done on the computer she does it (the
// other Mac's model decides, desktop/core.mjs DESKTOP_MARKER). The old Task switch is gone; the pen still explains.
let mode = 'chat';
$('#floating-mode').hidden = true;
function placeholder() {
  $('#floating-message').placeholder = armed ? 'Explain anything… (pen again: explain the screen)' : mode === 'task' ? 'Describe a task on your desktop…' : 'Ask Fairy…';
}
function showMode() {
  const button = $('#floating-mode');
  button.textContent = mode === 'task' ? 'Task' : 'Chat';
  button.setAttribute('aria-label', `Current mode: ${mode === 'task' ? 'Desktop task' : 'Chat'}. Click to switch.`);
  placeholder(); menu.render();
}
if (face) {
  document.documentElement.classList.add('face-page');
  // Mute is the face's own (its menu bar's too) and Ride along happens on this Mac, so those two stay.
  // ↗ opens the face's chats window, in place of the full Fairy's window. The pen draws on this Mac's screen (step 7).
  // The quiz's two buttons are the face's own too: its quiz watches this Mac's screen (step 8).
  for (const node of document.querySelectorAll('[data-mirror]:not(#floating-mute):not(#floating-quiz-hints):not(#floating-quiz-auto)')) node.hidden = true;
  $('#open-workspace').setAttribute('aria-label', 'Open your chats'); $('#open-workspace').title = 'Open your chats';
  // The face says whether it's muted through the mirror, as the full Fairy's window does; the icon follows.
  api.onCompanionMirror?.(list => { const mute = (Array.isArray(list) ? list : []).find(item => item?.id === 'floating-mute'); if (mute) { $('#floating-mute').innerHTML = mute.pressed === 'true' ? icons.muted : icons.speaker; menu.render(); } });
  for (const label of ['Ideas']) { const group = document.querySelector(`.radial-group[data-label="${label}"]`); if (group) group.hidden = true; }
  // With no pairing, one field for the link from "Pair a Mac" on the other Mac.
  const pairBox = Object.assign(document.createElement('form'), { id: 'face-pair', className: 'face-pair', hidden: true });
  pairBox.innerHTML = '<label for="face-pair-link">Paste the pairing link from your other Mac</label><div class="face-pair-row"><input id="face-pair-link" autocomplete="off" spellcheck="false" placeholder="fairy://pair?…"><button type="submit">Pair</button></div><p id="face-pair-note" role="status"></p><p class="face-pair-help">On your other Mac, open Fairy’s Settings, then Phone, and choose Pair a Mac.</p>';
  $('#companion').append(pairBox);
  const showLink = value => {
    faceLink = value?.link || 'unreachable';
    document.documentElement.classList.toggle('face-offline', faceLink !== 'connected');
    pairBox.hidden = !['unpaired', 'changed', 'forgotten'].includes(faceLink);
    if (!busy) paintStatus($('#floating-status'), idleWords());
  };
  pairBox.onsubmit = async event => {
    event.preventDefault();
    const note = $('#face-pair-note');
    note.textContent = 'Pairing…';
    try { showLink(await api.facePair($('#face-pair-link').value)); $('#face-pair-link').value = ''; note.textContent = ''; }
    catch (error) { note.textContent = error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''); }
  };
  // Her voice, made on the other Mac and played here.
  setupFaceVoice({ api, speaking: () => mood('speaking'), quiet: () => { if (!busy) mood('idle'); } });
  api.onFaceState?.(showLink);
  api.faceState?.().then(showLink).catch(() => {});
}
showMode();
$('#floating-mode').onclick = () => {
  if (busy) return;
  mode = mode === 'task' ? 'chat' : 'task';
  try { localStorage.setItem('companion-mode', mode); } catch {}
  showMode();
};
// chat: answered as a question whatever the mode (the quick keys ask questions, never start tasks).
async function ask({ explain = false, chat = false } = {}) {
  const text = $('#floating-message').value.trim();
  if (busy) return;
  if (explain && !text && !armed) { arm(true); $('#floating-message').focus(); return; }
  if (!text && !explain) return;
  if (armed) { explain = true; arm(false); }
  $('#floating-message').value = ''; menu.render(); menu.retract(); setBusy(true); showReply('', { thinking: true });
  try {
    showReply((await (explain ? api.companionExplain(text) : mode === 'task' && !chat ? api.companionTask(text) : api.companionChat(text))).text);
    // She keeps talking a little while the window reads the reply aloud.
    setBusy(false); mood('speaking'); quietTimer = setTimeout(() => mood('idle'), 5000);
  } catch (error) { showReply(/stopped/i.test(error.message) ? 'Stopped.' : error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')); setBusy(false); }
}

// A desktop task's progress, under her eye.
// The window's status too, while you're looking at her rather than the window ('Ready' puts her own back).
api.onCompanionProgress?.(text => {
  if (typeof text !== 'string') return;
  if (busy) { if (text) paintStatus($('#floating-status'), text); return; }
  paintStatus($('#floating-status'), !text || text === 'Ready' ? idleWords() : text);
});
// A reply the window is writing, while you're looking at her: shown as it comes.
api.onCompanionTextOut?.(text => { if (busy || typeof text !== 'string' || !text) return; showReply(text); mood('speaking'); });
api.onCompanionText(text => { if (busy) { showReply(text); mood('speaking'); } });
// Fairy turns into the pen to draw on the screen ('out') and back when it returns ('in'), in pixel steps.
// A quiz's "more like this" asks again from the companion, as an Explain turn.
api.onCompanionAsk?.(text => { if (busy || typeof text !== 'string') return; $('#floating-message').value = text; void ask({ explain: true }); });
// A question from the quick box (⌥⌘ or ⌃⌥A) or heard while ⌃⌥ was held, while the companion is the one out.
api.onQuickAsk?.(({ text, mode } = {}) => { if (busy || typeof text !== 'string' || !text.trim()) return; $('#floating-message').value = text.trim(); void ask({ explain: mode === 'explain', chat: true }); });
let eyeMorph = null;
api.onCompanionMorph?.(phase => {
  // Out: a pulse, then she squashes into a glowing ball that bursts into the pen. In: she grows back out of it.
  const out = [{ transform: 'scale(1)', opacity: 1, filter: 'brightness(1)' }, { transform: 'scale(1.12)', opacity: 1, filter: 'brightness(1.3)', offset: 0.2 }, { transform: 'scale(0.4)', opacity: 1, filter: 'brightness(2.4) saturate(1.4)', offset: 0.65 }, { transform: 'scale(0)', opacity: 0, filter: 'brightness(3)' }], back = [{ transform: 'scale(0)', opacity: 0, filter: 'brightness(3)' }, { transform: 'scale(0.4)', opacity: 1, filter: 'brightness(2.4) saturate(1.4)', offset: 0.35 }, { transform: 'scale(1.12)', opacity: 1, filter: 'brightness(1.3)', offset: 0.75 }, { transform: 'scale(1)', opacity: 1, filter: 'brightness(1)' }];
  eyeMorph?.cancel();
  eyeMorph = eye.animate(phase === 'out' ? out : back, { duration: phase === 'out' ? 380 : 440, easing: 'steps(8, end)', fill: phase === 'out' ? 'forwards' : 'none' });
});
$('#floating-send').onclick = () => void ask();
$('#floating-explain').onclick = () => void ask({ explain: true });
$('#floating-message').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void ask(); } });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && busy) void api.companionStop(); });
$('#floating-stop').onclick = () => api.companionStop();
$('#open-workspace').onclick = () => api.companionOpenWindow();
$('#companion-close').onclick = () => api.companionClose();
$('#close-reply').onclick = () => { $('#reply').hidden = true; };
// Buttons that belong to the main window: pressing one presses it there, and its state (on or off, its label, whether
// it can be pressed now) comes back here whenever it changes.
for (const button of document.querySelectorAll('[data-mirror]')) button.onclick = () => api.companionAction(button.id);
api.onCompanionMirror?.(list => {
  for (const item of Array.isArray(list) ? list : []) {
    const button = document.getElementById(item.id);
    if (!button || !button.hasAttribute('data-mirror')) continue;
    if (typeof item.html === 'string') button.innerHTML = item.html;
    if (item.label) button.setAttribute('aria-label', item.label); else button.removeAttribute('aria-label');
    button.title = item.title || item.label || '';
    if (item.pressed === null || item.pressed === undefined) button.removeAttribute('aria-pressed'); else button.setAttribute('aria-pressed', String(item.pressed));
    button.disabled = Boolean(item.disabled); button.hidden = Boolean(item.hidden);
  }
  menu.render();
});
api.companionMirrorRequest?.().catch(() => {});
// Fairy's own ideas and news, said while the companion is the one out.
api.onCompanionSay?.(text => { if (busy || typeof text !== 'string') return; showReply(text); mood('speaking'); quietTimer = setTimeout(() => mood('idle'), 6000); });
// Wave hello: her eye gives a little pixel hop.
$('#floating-wave').onclick = () => eyeAvatar ? (walker?.cancel(), eyeAvatar.wave()) : eye.animate([{ transform: 'translateY(0) rotate(0)' }, { transform: 'translateY(-10px) rotate(-8deg)', offset: 0.3 }, { transform: 'translateY(-4px) rotate(8deg)', offset: 0.6 }, { transform: 'translateY(0) rotate(0)' }], { duration: 700, easing: 'steps(7, end)' });

// Ride along, as in floating mode: after a few idle seconds the companion's eye shrinks onto the pointer and this window
// goes see-through; a reply, typing, or the pointer coming back over the companion brings her back. One switch for both.
const readRide = () => { try { return localStorage.getItem('fairy-ride-along') === 'on'; } catch { return false; } };
let rideEnabled = readRide(), riding = false, rideIdleSince = 0, rideAway = false;
function showRide() { $('#floating-ride').setAttribute('aria-pressed', String(rideEnabled)); menu.render(); }
function setRide(on) {
  if (on === riding) return Promise.resolve(riding);
  riding = on; document.body.classList.toggle('riding', on);
  return (api.companionRide?.(on) ?? Promise.resolve(false)).then(result => { riding = Boolean(result); document.body.classList.toggle('riding', riding); return riding; }).catch(() => { riding = false; document.body.classList.remove('riding'); return false; });
}
$('#floating-ride').onclick = () => { rideEnabled = !rideEnabled; try { localStorage.setItem('fairy-ride-along', rideEnabled ? 'on' : 'off'); } catch {} showRide(); if (!rideEnabled) setRide(false); };
addEventListener('storage', event => { if (event.key === 'fairy-ride-along') { rideEnabled = readRide(); showRide(); if (!rideEnabled) setRide(false); } });
showRide();
// Two Macs: Ride along goes with her when she crosses to the other Mac. The Mac she leaves reads this page's switch and
// whether she's riding, stops the ride and tells the page she's away (so it doesn't ask to ride meanwhile); the Mac she
// arrives on takes on that switch and, if she was riding, rides at once. arrive resolves whether she's riding.
window.fairyRideAlong = {
  state: () => ({ enabled: rideEnabled, riding }),
  leave: () => { rideAway = true; rideIdleSince = 0; riding = false; document.body.classList.remove('riding'); },
  arrive: ({ enabled, riding: was } = {}) => {
    rideAway = false; riding = false; document.body.classList.remove('riding');
    if (typeof enabled === 'boolean' && enabled !== rideEnabled) { rideEnabled = enabled; try { localStorage.setItem('fairy-ride-along', enabled ? 'on' : 'off'); } catch {} showRide(); }
    if (!rideEnabled || was !== true) { rideIdleSince = 0; return Promise.resolve(false); }
    rideIdleSince = Date.now() - 6000;
    return setRide(true);
  },
};
setInterval(() => {
  if (rideAway) return;
  const idle = rideEnabled && Boolean(api.companionRide) && !busy && !pointerInside && $('#approval').hidden && ($('#reply').hidden || Date.now() - replyAt > 15000)
    && !$('#floating-message').value.trim() && document.activeElement !== $('#floating-message') && !armed;
  if (!idle) { rideIdleSince = 0; if (riding) setRide(false); return; }
  rideIdleSince ||= Date.now();
  if (!riding && Date.now() - rideIdleSince > 6000) setRide(true);
}, 500);
api.companionHistory().then(({ history }) => { const last = history.findLast(entry => entry.role === 'assistant'); if (last) showReply(last.content); }).catch(() => {});

// A work session in the window can ask for an OK; answer it here without switching windows.
let approval = null;
api.onCompanionApproval(value => {
  if (value.closed) { if (approval === value.id) { approval = null; $('#approval').hidden = true; } return; }
  approval = value.id; $('#approval-title').textContent = value.title;
  // A request may name its own answers, such as a Desktop task's "Run these actions" and "Stop task".
  $('#approval-allow').textContent = value.allowLabel || 'Allow'; $('#approval-deny').textContent = value.denyLabel || 'Deny';
  $('#approval-detail').textContent = value.detail; $('#approval-detail').hidden = !value.detail; $('#approval').hidden = false;
});
for (const [id, decision] of [['#approval-allow', 'allow'], ['#approval-deny', 'deny']]) $(id).onclick = async () => {
  if (!approval) return;
  try { await api.companionAnswer(approval, decision); } catch (error) { showReply(error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')); }
  approval = null; $('#approval').hidden = true;
};

// Her gaze follows the pointer, and now and then (Settings → Occasional walks) she strolls along the bottom of the
// screen, as floating Fairy did. A face's companion stays put: its window is this Mac's to move.
const roaming = () => { try { return localStorage.getItem('fairy-roaming') !== 'off'; } catch { return true; } };
let walker = null;
if (eyeAvatar) {
  const sprite = eyeAvatar.spriteAvatar;
  const sampler = new CursorSampler({ interval: () => 0.1, read: () => api.companionCursor(), eligible: () => sprite.cursorEligible(), update: point => sprite.trackCursor(point) });
  sprite.cursorSampler = sampler;
  if (!face && api.companionWalkStart) walker = new WalkingAnimation({ api: { walkStart: () => api.companionWalkStart(), walkStep: token => api.companionWalkStep(token), walkStop: token => api.companionWalkStop(token) },
    eligible: manual => (roaming() || manual) && !busy && !document.hidden && $('#reply').hidden && !matchMedia('(prefers-reduced-motion: reduce)').matches,
    display: value => sprite.setWalking(value) });
  sprite.onFrame = dt => { walker?.tick(dt); sampler.tick(dt); };
}

// The window is only as big as what shows: the eye and her ring when idle, growing upward for a reply or a question
// for your OK, and back down when it closes (the main process keeps her bottom edge where it is). Heights in CSS
// pixels: the ring reaches 283 px above the window's bottom.
const RING_TOP = 283, IDLE_HEIGHT = 296;
function fitWindow() {
  const reply = $('#reply'), ask = $('#approval');
  let height = IDLE_HEIGHT;
  if (!reply.hidden) height = Math.max(height, 12 + Math.min(reply.scrollHeight, 240) + 16 + RING_TOP);
  if (!ask.hidden) height = Math.max(height, 300 + ask.scrollHeight + 12);
  void api.companionFit?.(Math.ceil(height)).catch(() => {});
}
{
  const watch = new ResizeObserver(() => fitWindow());
  for (const id of ['#reply', '#approval']) { watch.observe($(id)); new MutationObserver(() => fitWindow()).observe($(id), { attributes: true, attributeFilter: ['hidden'] }); }
  fitWindow();
}
