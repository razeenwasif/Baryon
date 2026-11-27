import test from 'node:test';
import assert from 'node:assert/strict';
import { formatJson } from '../src/format.js';

test('formats counts with a total', () => {
  assert.deepEqual(JSON.parse(formatJson([{ file: 'a.txt', words: 2 }, { file: 'b.txt', words: 5 }])), { files: { 'a.txt': 2, 'b.txt': 5 }, total: 7 });
});
