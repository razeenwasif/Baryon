import test from 'node:test';
import assert from 'node:assert/strict';
import { total } from '../src/cart.js';

test('rounds to the cent', () => {
  assert.equal(total([{ price: 0.1, quantity: 3 }]), 0.3);
});
