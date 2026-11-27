import test from 'node:test';
import assert from 'node:assert/strict';
import { countWords } from '../src/count.js';

test('counts words', () => {
  assert.equal(countWords("It's a small world."), 4);
});
