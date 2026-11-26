import test from 'node:test';
import assert from 'node:assert/strict';
import { mean } from '../src/mean.js';

test('one value is its own mean', () => {
  assert.equal(mean([7]), 7);
});
