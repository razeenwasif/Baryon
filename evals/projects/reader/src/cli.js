#!/usr/bin/env node
import { readFileSync } from 'node:fs';

// Prints how many lines each file has.
for (const file of process.argv.slice(2)) {
  console.log(`${file}: ${readFileSync(file, 'utf8').split('\n').length} lines`);
}
