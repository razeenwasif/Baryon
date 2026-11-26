// Notes as CSV, quoted as RFC 4180 has it.
const field = value => { const text = String(value ?? ''); return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; };
export function toCsv(notes) {
  return ['id,title,tags,body', ...notes.map(note => [note.id, note.title, (note.tags || []).join(';'), note.body].map(field).join(','))].map(line => `${line}\n`).join('');
}
