// What the orchestrator has done on this Mac, from routing.jsonl in Fairy's data folder: each role's jobs by model, how
// they ended, how long they took and what they cost, and how often work moved to the other subscription. The log keeps
// no chat or file content, so neither does this.
//
//   node scripts/routing-report.mjs                    the last 14 days
//   node scripts/routing-report.mjs --days 2 [--file path/to/routing.jsonl]
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

export function routingReport(lines, { since = 0 } = {}) {
  const rows = new Map();
  let standIns = 0, moved = 0;
  // Auto's picks (type 'pick') are counted by kind of task, apart from the jobs.
  const kinds = {};
  for (const line of lines) {
    if (!line || Date.parse(line.at || 0) < since) continue;
    if (line.type === 'pick') { const kind = line.kind || 'not asked'; kinds[kind] = (kinds[kind] || 0) + 1; continue; }
    if (line.standIn) standIns++;
    if (line.outcome === 'moved') moved++;
    const key = `${line.role || 'turn'}\t${line.model || '?'}`;
    if (!rows.has(key)) rows.set(key, { role: line.role || 'turn', model: line.model || '?', jobs: 0, done: 0, failed: 0, moved: 0, stopped: 0, ms: [], tokens: { input: 0, output: 0 } });
    const row = rows.get(key);
    row.jobs++; row[line.outcome] = (row[line.outcome] || 0) + 1;
    if (Number.isFinite(line.ms)) row.ms.push(line.ms);
    if (line.tokens) { row.tokens.input += line.tokens.input || 0; row.tokens.output += line.tokens.output || 0; }
  }
  const median = list => { if (!list.length) return null; const sorted = [...list].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; };
  return { rows: [...rows.values()].map(row => ({ ...row, medianMs: median(row.ms), ms: undefined })).sort((a, b) => a.role.localeCompare(b.role) || b.jobs - a.jobs), standIns, moved, kinds };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { days: { type: 'string', default: '14' }, file: { type: 'string', default: join(homedir(), 'Library', 'Application Support', 'lyra-companion', 'lyra', 'routing.jsonl') } } });
  let text = '';
  try { text = await readFile(values.file, 'utf8'); } catch { console.log(`No routing log yet at ${values.file}. It starts with the first work turn on the Orchestrator.`); process.exit(0); }
  const lines = text.split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } });
  const { rows, standIns, moved, kinds } = routingReport(lines, { since: Date.now() - Number(values.days) * 86400000 });
  const kindList = Object.entries(kinds).sort((a, b) => b[1] - a[1]);
  if (kindList.length) console.log(`Auto's picks by kind of task: ${kindList.map(([kind, count]) => `${kind} ${count}`).join(', ')}\n`);
  if (!rows.length) { console.log(`Nothing in the last ${values.days} days.`); process.exit(0); }
  console.log(`${'role'.padEnd(9)}${'model'.padEnd(30)}${'jobs'.padStart(5)}${'done'.padStart(6)}${'failed'.padStart(8)}${'moved'.padStart(7)}${'median'.padStart(9)}  tokens in/out`);
  for (const row of rows) console.log(`${row.role.padEnd(9)}${row.model.slice(0, 29).padEnd(30)}${String(row.jobs).padStart(5)}${String(row.done || 0).padStart(6)}${String(row.failed || 0).padStart(8)}${String(row.moved || 0).padStart(7)}${(row.medianMs == null ? '–' : `${Math.round(row.medianMs / 100) / 10}s`).padStart(9)}  ${row.tokens.input || row.tokens.output ? `${row.tokens.input}/${row.tokens.output}` : '–'}`);
  console.log(`\n${moved} job${moved === 1 ? '' : 's'} moved after a sign-out or limit; ${standIns} ran as stand-ins.`);
}
