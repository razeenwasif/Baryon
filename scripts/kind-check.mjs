#!/usr/bin/env node
// Auto's kind question against the labelled requests (evals/kind-labels.mjs): docs/auto-by-task-plan.md, stage 1 is done
// when nine in ten get the right kind.
//
//   node scripts/kind-check.mjs --list                    the requests and their labels, with no call
//   GEMINI_API_KEY=… node scripts/kind-check.mjs          asks Gemini Decisions once per request (about 45 calls)
//
// It only asks the decision, the same call Auto makes before each chat message, so no model answers anything; the calls
// are on your Gemini API key. It prints each miss and a line per kind, and keeps nothing.
import { parseArgs } from 'node:util';
import { decideTier } from '../desktop/model-router.mjs';
import { kindLabels, kindScore } from '../evals/kind-labels.mjs';

const { values: flags } = parseArgs({ options: { list: { type: 'boolean' }, json: { type: 'boolean' } } });
const labels = kindLabels();
if (flags.list) {
  for (const label of labels) console.log(`${label.kind.padEnd(10)}${label.where.padEnd(6)}${label.id.padEnd(26)}${String(label.text).replace(/\s+/g, ' ').slice(0, 90)}`);
  console.log(`\n${labels.length} requests.`);
  process.exit(0);
}
const key = process.env.GEMINI_API_KEY;
if (!key) { console.error('Set GEMINI_API_KEY in this terminal first (the key Fairy uses for Auto), or use --list.'); process.exit(2); }
const results = [];
for (const label of labels) {
  try {
    const decided = await decideTier({ key, text: label.text, where: label.where, timeout: 8000 });
    results.push({ id: label.id, kind: label.kind, got: decided?.kind || null, confidence: decided?.kindConfidence ?? null });
  } catch (error) { results.push({ id: label.id, kind: label.kind, got: null, error: error.message }); console.error(`${label.id}: ${error.message}`); }
}
const score = kindScore(results);
if (flags.json) { console.log(JSON.stringify({ score, results }, null, 2)); process.exit(score.passes ? 0 : 1); }
for (const miss of score.misses) console.log(`miss  ${miss.id.padEnd(26)}labelled ${miss.kind.padEnd(9)} read as ${miss.got}${miss.confidence != null ? ` (${Math.round(miss.confidence * 100)}%)` : ''}`);
console.log('');
for (const [kind, row] of Object.entries(score.byKind)) console.log(`${kind.padEnd(10)}${row.right}/${row.asked}`);
console.log(`\n${score.right} of ${score.asked} right (${Math.round(score.share * 100)}%): ${score.passes ? 'passes' : 'below'} nine in ten.`);
process.exit(score.passes ? 0 : 1);
