import test from 'node:test';
import assert from 'node:assert/strict';
import { mean } from '../src/mean.js';

test('the mean of a few numbers', () => {
  assert.equal(mean([2, 4, 9]), 5);
});

test('the mean of nothing is 0', () => {
  assert.equal(mean([]), 0);
});
