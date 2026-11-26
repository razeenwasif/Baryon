import { fetchJson } from './http/client.js';
import { formatMoney } from './money/format.js';

export async function listEntries() {
  const entries = await fetchJson('https://bank.example/entries');
  return entries.map(entry => ({ ...entry, shown: formatMoney(entry.cents) }));
}
