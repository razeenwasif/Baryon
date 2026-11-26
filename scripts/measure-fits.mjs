// Measures stage 5's suggestions (desktop/notebook/fits.mjs) on a real notebook: for each place in the papers asked
// about, what Fairy offers and how long it took; with labels, how often the pick is one you'd keep. No model is called.
//
//   node scripts/measure-fits.mjs --notebooks <folder> --notebook <slug> [--kb <notebook-knowledge.json>]
//        [--papers S01,S02 | --papers file:exam.pdf] [--labels labels.json] [--depth 1]
//
// Papers default to the notebook's sources marked as past papers. --depth 1 asks only at questions, 2 at parts too.
// labels.json: [{ "paper": "S01", "key": "Problem 2 · Part 1", "fits": ["S20", "S26 p. 3", "CL004"] }], where a bare
// source id counts any place in it. Run it on a copy of your notebooks: it opens them as Fairy does, and keeps the
// question maps it makes in their .notebook/ folders.
import { readFileSync } from 'node:fs';
import { notebookCalls } from '../desktop/notebook/calls.mjs';

const args = process.argv.slice(2), flag = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };
const root = flag('notebooks'), slug = flag('notebook');
if (!root || !slug) { console.error('Usage: node scripts/measure-fits.mjs --notebooks <folder> --notebook <slug> [--kb file] [--papers S01,S02] [--labels labels.json] [--depth 1]'); process.exit(2); }
const calls = notebookCalls({ root, ...(flag('kb') ? { kbFile: flag('kb') } : {}) });
const view = await calls.open(slug);
const depth = Number(flag('depth') || 3);
const labels = flag('labels') ? JSON.parse(readFileSync(flag('labels'), 'utf8')) : null;
const paperOf = name => (String(name).startsWith('file:') ? { file: String(name).slice(5) } : String(name));
const papers = labels ? [...new Set(labels.map(l => JSON.stringify(l.paper)))].map(p => JSON.parse(p))
  : flag('papers') ? flag('papers').split(',').map(paperOf) : view.sources.filter(s => s.role === 'pastPaper').map(s => s.id);
const title = id => view.sources.find(s => s.id === id)?.title || id;

const rows = [];
for (const paper of papers) {
  const { questions } = await calls.questions(typeof paper === 'string' ? paper : paperOf(paper));
  const asked = labels ? labels.filter(l => JSON.stringify(l.paper) === JSON.stringify(paper)) : questions.filter(q => q.depth <= depth).map(q => ({ key: q.key }));
  console.log(`\n${typeof paper === 'string' ? `${paper} ${title(paper)}` : paper.file}: ${questions.length} places, asking at ${asked.length}`);
  for (const one of asked) {
    const found = await calls.fits(typeof paper === 'string' ? paper : paperOf(paper), one.key);
    const pick = found.pin ? found.pin.id : found.passage ? found.passage.cite : null;
    const said = found.pin ? `pin ${found.pin.id} (${found.pin.score})` : found.passage ? `${found.passage.cite} ${title(found.passage.source)} (${found.passage.score}): ${found.passage.words.replace(/\s+/g, ' ').slice(0, 90)}` : 'nothing';
    const hit = one.fits ? one.fits.some(f => pick && (pick === f || (/^S\d+$/.test(f) && pick.startsWith(`${f} `)))) : null;
    rows.push({ ms: found.ms, hit });
    console.log(`  ${hit == null ? ' ' : hit ? '✓' : '✗'} ${one.key.padEnd(28)} ${String(found.ms).padStart(4)} ms  ${said}`);
  }
}
const times = rows.map(r => r.ms).sort((a, b) => a - b), judged = rows.filter(r => r.hit != null);
console.log(`\n${rows.length} asked; median ${times[times.length >> 1] ?? 0} ms, slowest ${times.at(-1) ?? 0} ms (the first in a paper reads its map and the index).`);
if (judged.length) console.log(`Kept ${judged.filter(r => r.hit).length} of ${judged.length} (${Math.round((100 * judged.filter(r => r.hit).length) / judged.length)}%); stage 5 wants two in three.`);
process.exit(0);
