// model-strengths.json in Fairy's data folder: the strengths table (table.mjs) on disk. Read whole, written whole, through
// a temporary file so a crash never leaves half a table. A file that can't be read starts an empty table and is kept
// beside it, never thrown away.
import { readFile, rename, writeFile } from 'node:fs/promises';
import { emptyTable } from './table.mjs';

export class StrengthsStore {
  constructor({ path }) { this.path = path; this.queue = Promise.resolve(); this.problem = ''; }
  async load() {
    let text;
    try { text = await readFile(this.path, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return emptyTable(); throw error; }
    try { return cleanTable(JSON.parse(text)); }
    catch (error) {
      this.problem = `model-strengths.json couldn’t be read (${error.message}), so the table starts empty; the old file is kept as model-strengths.unreadable.json.`;
      await rename(this.path, this.path.replace(/\.json$/, '.unreadable.json')).catch(() => {});
      return emptyTable();
    }
  }
  // Changes go one at a time: change(table) returns the new table.
  update(change) {
    const next = this.queue.then(async () => {
      const table = await change(await this.load());
      const temporary = `${this.path}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(table, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, this.path);
      return table;
    });
    this.queue = next.catch(() => {});
    return next;
  }
}

// Only the parts the table knows, each a list or an object; anything else in the file is left out.
export function cleanTable(value) {
  const table = emptyTable();
  if (!value || typeof value !== 'object') return table;
  for (const list of ['public', 'aside', 'evals', 'use', 'notices']) if (Array.isArray(value[list])) table[list] = value[list].filter(row => row && typeof row === 'object');
  for (const map of ['pinned', 'sources', 'known']) if (value[map] && typeof value[map] === 'object' && !Array.isArray(value[map])) table[map] = value[map];
  return table;
}
