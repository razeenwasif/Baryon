// Notes as HTML, every title and body escaped.
const escape = text => String(text ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
export function toHtml(notes) {
  return `<main>${notes.map(note => `<article><h2>${escape(note.title)}</h2><p>${escape(note.body)}</p></article>`).join('')}</main>`;
}
