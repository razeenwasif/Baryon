import test from 'node:test';
import assert from 'node:assert/strict';
import { roundCents } from '../src/money/round.js';

test('rounds halves away from zero', () => {
  assert.equal(roundCents(2.5), 3);
  assert.equal(roundCents(-2.5), -3);
});
