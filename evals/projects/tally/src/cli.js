#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { countWords } from './count.js';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Usage: tally <file>...');
  process.exit(1);
}
for (const file of files) console.log(`${basename(file)}: ${countWords(readFileSync(file, 'utf8'))} words`);
