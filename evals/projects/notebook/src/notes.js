import { readFileSync } from 'node:fs';

// The notes, from notes.json beside package.json: [{ id, title, tags, body }].
export function loadNotes(path = new URL('../notes.json', import.meta.url)) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
