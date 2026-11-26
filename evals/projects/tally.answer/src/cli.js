#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { countWords } from './count.js';
import { formatJson } from './format.js';

const args = process.argv.slice(2), json = args.includes('--json'), files = args.filter(arg => arg !== '--json');
if (!files.length) {
  console.error('Usage: tally [--json] <file>...');
  process.exit(1);
}
const counts = files.map(file => ({ file, words: countWords(readFileSync(file, 'utf8')) }));
if (json) console.log(formatJson(counts));
else for (const { file, words } of counts) console.log(`${basename(file)}: ${words} words`);
