// How a whiteboard or sheet talks to the Pages panel around it. The page says it's ready; the panel answers that it may be
// edited only when it's on screen in Fairy, so on a phone, in a PDF or opened anywhere else it stays a picture to look at.
// The page can hand back its own data to save as a new version, and nothing else.
function fairyBridge({ onEdit, onSaved, onFailed }) {
  const embedded = window.parent !== window;
  addEventListener('message', event => {
    if (event.source !== window.parent || !event.data || typeof event.data.type !== 'string') return;
    if (event.data.type === 'fairy-edit') onEdit();
    else if (event.data.type === 'fairy-saved') onSaved();
    else if (event.data.type === 'fairy-save-failed') onFailed(String(event.data.message || 'That didn’t save.'));
  });
  const send = message => { if (embedded) window.parent.postMessage(message, '*'); };
  setTimeout(() => send({ type: 'fairy-ready' }));
  return {
    save: data => send({ type: 'fairy-save', data }),
    dirty: value => send({ type: 'fairy-dirty', dirty: Boolean(value) }),
    view: info => send({ type: 'fairy-view', ...info }),
  };
}
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const modKey = event => (isMac ? event.metaKey : event.ctrlKey);
function el(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') element.className = value;
    else if (key === 'text') element.textContent = value;
    else if (key.startsWith('on')) element.addEventListener(key.slice(2), value);
    else if (value === true) element.setAttribute(key, '');
    else if (value !== false && value !== null && value !== undefined) element.setAttribute(key, value);
  }
  element.append(...children.filter(child => child !== null && child !== undefined));
  return element;
}
// A toolbar button: an icon from a small set, or a word. Its label is always there for screen readers and as a tooltip.
const ICONS = {
  select: '<path d="M5 3l14 8-6 1.6L10 19z"/>', hand: '<path d="M8 11V5.5a1.5 1.5 0 013 0V10m0-5.5a1.5 1.5 0 013 0V10m0-3.5a1.5 1.5 0 013 0V14a6 6 0 01-6 6h-1a6 6 0 01-5-2.7L4.6 14a1.5 1.5 0 012.4-1.8L8 13.5"/>',
  note: '<path d="M4 4h16v11l-5 5H4z"/><path d="M15 20v-5h5"/>', rect: '<rect x="3.5" y="6" width="17" height="12" rx="2"/>', ellipse: '<ellipse cx="12" cy="12" rx="9" ry="6.5"/>',
  diamond: '<path d="M12 3l9 9-9 9-9-9z"/>', text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>', arrow: '<path d="M5 19L19 5M10 5h9v9"/>', pen: '<path d="M4 20c3-1 4-3 6-6l7-7a2.1 2.1 0 00-3-3l-7 7c-3 2-5 3-6 6z"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>', redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 000 12h3"/>', trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  minus: '<path d="M5 12h14"/>', plus: '<path d="M12 5v14M5 12h14"/>', fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>', filter: '<path d="M4 5h16l-6 8v6l-4-2v-4z"/>',
  sortUp: '<path d="M7 20V4M3 8l4-4 4 4M14 6h7M14 11h5M14 16h3"/>', sortDown: '<path d="M7 4v16M3 16l4 4 4-4M14 6h3M14 11h5M14 16h7"/>',
};
function tool(name, label, onclick, { word = '', shortcut = '' } = {}) {
  const button = el('button', { type: 'button', class: word ? 'word' : 'icon', 'aria-label': label, title: shortcut ? `${label} (${shortcut})` : label, onclick });
  if (word) button.textContent = word;
  else button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
  return button;
}
