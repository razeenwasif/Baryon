// Notes as Markdown: a heading for each, its body, and its tags.
export function toMarkdown(notes) {
  return `${notes.map(note => [`## ${note.title}`, '', note.body, ...(note.tags?.length ? ['', `Tags: ${note.tags.join(', ')}`] : [])].join('\n')).join('\n\n')}\n`;
}
