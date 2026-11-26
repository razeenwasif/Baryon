#!/usr/bin/env node
// The strengths table from a terminal (docs/auto-by-task-plan.md, stage 2).
//
//   node scripts/strengths.mjs show [--kind maths]    each kind's numbers by model, with source and date
//   node scripts/strengths.mjs sources                the source list and when each was last read
//   GEMINI_API_KEY=… node scripts/strengths.mjs would-pick "Solve x² = 4" [--home claude] [--where chat]
//                                                     what the pick by task would choose for a request (one Decisions call)
//   node scripts/strengths.mjs compare [--home claude] [--tier heavy] [--json]
//                                                     stage 4's comparison, from the evals already run (no model call):
//                                                     each kind's pass rate on your provider's model beside the model by
//                                                     task would pick, with the task counts
//
// Refresh lives in Fairy (Settings → Conversation → What each model is good at): it reads each page through Fairy's own
// checked-address reader, which a terminal doesn't have, and asks her scout once per page.
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { cleanTable } from '../desktop/strengths/store.mjs';
import { ROUTED_KINDS, blended } from '../desktop/strengths/table.mjs';
import { BUILT_IN_SOURCES } from '../desktop/strengths/service.mjs';
import { comparison, offeredFromTable } from '../desktop/strengths/compare.mjs';
import { pickByTask } from '../desktop/strengths/pick.mjs';
import { loadSources } from '../desktop/strengths/index.mjs';

const data = join(homedir(), 'Library', 'Application Support', 'lyra-companion', 'lyra');
const { values, positionals } = parseArgs({ allowPositionals: true, options: { kind: { type: 'string' }, file: { type: 'string', default: join(data, 'model-strengths.json') },
  home: { type: 'string', default: 'claude' }, where: { type: 'string', default: 'chat' }, tier: { type: 'string', default: 'heavy' }, json: { type: 'boolean' } } });
const what = positionals[0] || 'show';
let table;
try { table = cleanTable(JSON.parse(await readFile(values.file, 'utf8'))); } catch (error) { table = cleanTable({}); if (error.code !== 'ENOENT') console.error(`Couldn’t read ${values.file}: ${error.message}`); }

if (what === 'sources') {
  let text;
  try { text = await readFile(join(data, 'strengths-sources.json'), 'utf8'); console.log('Your list (strengths-sources.json):'); } catch { text = await readFile(BUILT_IN_SOURCES, 'utf8'); console.log('The built-in list:'); }
  const { sources, problems } = loadSources(JSON.parse(text));
  for (const source of sources) {
    const status = table.sources[source.id];
    console.log(`${source.id.padEnd(20)}${source.kinds.join(',').padEnd(22)}${status ? (status.problem ? `problem: ${status.problem}` : `read ${status.read.slice(0, 10)}: ${status.kept} kept, ${status.aside} aside, ${status.dropped} dropped`) : 'not read yet'}`);
  }
  for (const problem of problems) console.log(`left out: ${problem}`);
} else if (what === 'show') {
  const kinds = values.kind ? [values.kind] : ROUTED_KINDS;
  if (!table.public.length && !table.evals.length) console.log('The table is empty. Refresh it in Fairy: Settings → Conversation → What each model is good at.');
  for (const kind of kinds) {
    const models = [...new Set([...table.public, ...table.evals].filter(row => row.kind === kind).map(row => row.model))];
    if (!models.length) continue;
    console.log(`\n${kind}`);
    for (const model of models) {
      const found = blended(table, model, kind);
      console.log(`  ${model.padEnd(24)}${found ? `${String(found.score).padStart(5)}  (sure ${found.confidence})` : '    –'}`);
      for (const row of table.public.filter(item => item.model === model && item.kind === kind)) console.log(`      ${row.benchmark}: ${row.value}${row.scale === 'percent' ? '%' : ` (${row.scale}, not scored)`} · ${row.source}, ${String(row.fetched).slice(0, 10)} · ${row.url}`);
    }
  }
  if (table.aside.length) console.log(`\n${table.aside.length} number${table.aside.length === 1 ? '' : 's'} for models you aren’t offered, set aside.`);
} else if (what === 'would-pick') {
  const text = positionals.slice(1).join(' ').trim();
  if (!text) { console.error('Give the request in quotes.'); process.exit(2); }
  if (!process.env.GEMINI_API_KEY) { console.error('Set GEMINI_API_KEY in this terminal first: the kind and size come from the same Decisions call Auto makes.'); process.exit(2); }
  const { decideTier } = await import('../desktop/model-router.mjs');
  const decided = await decideTier({ key: process.env.GEMINI_API_KEY, text, where: values.where, timeout: 8000 });
  if (!decided) { console.error('No decision came back.'); process.exit(1); }
  const result = pickByTask({ decided, home: values.home, table, offered: await offeredFromTable(table), place: values.where === 'work' ? 'work-start' : 'new-chat' });
  console.log(`kind ${decided.kind || '–'} (${Math.round((decided.kindConfidence || 0) * 100)}%), ${decided.tier} tier, ${decided.effort} effort`);
  console.log(`by task: ${result.model} on ${result.provider}${result.moved ? ' (a move)' : ''}. ${result.reason}`);
  for (const c of result.candidates) console.log(`  ${c.provider.padEnd(7)}${c.model.padEnd(26)}${c.score == null ? '   –' : String(c.score).padStart(5)}  sure ${c.confidence}${c.out ? `  (out: ${c.out})` : ''}`);
} else if (what === 'compare') {
  const rows = comparison(table, { home: values.home, tier: values.tier, offered: await offeredFromTable(table) });
  if (values.json) { console.log(JSON.stringify(rows, null, 2)); process.exit(0); }
  if (!table.evals.length) console.log('No evals by kind have been run yet: node scripts/eval.mjs --kinds maths --provider claude --model claude-opus-5-5, on your yes.\n');
  console.log(`${'kind'.padEnd(10)}${`today (${values.home})`.padEnd(34)}${'by task'.padEnd(34)}verdict`);
  for (const row of rows) {
    const side = s => s ? `${s.model} ${s.passed == null ? 'no evals' : `${s.passed}/${s.total}`}` : '–';
    console.log(`${row.kind.padEnd(10)}${side(row.today).padEnd(34)}${side(row.byTask).padEnd(34)}${row.verdict}`);
  }
  console.log('\nThe pick was made from these same results, so a lead here is the most it could show. Run a kind again before turning it on in stage 5.');
} else { console.error('Use show, sources, would-pick or compare.'); process.exit(2); }
