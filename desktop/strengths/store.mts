// model-strengths.json in Fairy's data folder: the strengths table (table.mjs) on disk. Read whole, written whole, through
// a temporary file so a crash never leaves half a table. A file that can't be read starts an empty table and is kept
// beside it, never thrown away.
import { readFile, rename, writeFile } from 'node:fs/promises';
import { emptyTable, type StrengthsTable } from './table.mjs';

export interface StrengthsStoreOptions {
  path: string;
}

export class StrengthsStore {
  path: string;
  queue: Promise<unknown>;
  problem: string;

  constructor({ path }: StrengthsStoreOptions) {
    this.path = path;
    this.queue = Promise.resolve();
    this.problem = '';
  }

  async load(): Promise<StrengthsTable> {
    let text: string;
    try { text = await readFile(this.path, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException | null | undefined)?.code === 'ENOENT') return emptyTable();
      throw error;
    }
    try { return cleanTable(JSON.parse(text)); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.problem = `model-strengths.json couldn’t be read (${message}), so the table starts empty; the old file is kept as model-strengths.unreadable.json.`;
      await rename(this.path, this.path.replace(/\.json$/, '.unreadable.json')).catch(() => {});
      return emptyTable();
    }
  }

  // Changes go one at a time: change(table) returns the new table.
  update<T = StrengthsTable>(change: (table: StrengthsTable) => T | Promise<T>): Promise<T> {
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
export function cleanTable(value: unknown): StrengthsTable {
  const table = emptyTable();
  if (!value || typeof value !== 'object') return table;
  const record = value as Record<string, unknown>;
  for (const list of ['public', 'aside', 'evals', 'use', 'notices'] as const) {
    if (Array.isArray(record[list])) {
      (table as Record<string, unknown>)[list] = record[list].filter((row): row is Record<string, unknown> => Boolean(row && typeof row === 'object'));
    }
  }
  for (const map of ['pinned', 'sources', 'known'] as const) {
    if (record[map] && typeof record[map] === 'object' && !Array.isArray(record[map])) {
      (table as Record<string, unknown>)[map] = record[map];
    }
  }
  return table;
}
