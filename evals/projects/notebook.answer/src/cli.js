#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { loadNotes } from './notes.js';
import { toMarkdown } from './export/markdown.js';
import { toCsv } from './export/csv.js';
import { toHtml } from './export/html.js';

const FORMATS = { md: toMarkdown, csv: toCsv, html: toHtml };
const args = process.argv.slice(2), value = name => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; };
const format = FORMATS[value('--format')];
if (!format) { console.error('Usage: node src/cli.js --format md|csv|html [--out <file>]'); process.exit(1); }
const out = format(loadNotes()), file = value('--out');
if (file) writeFileSync(file, out); else process.stdout.write(out);
