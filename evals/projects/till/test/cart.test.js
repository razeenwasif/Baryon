import test from 'node:test';
import assert from 'node:assert/strict';
import { total } from '../src/cart.js';

test('adds each price times its quantity', () => {
  assert.equal(total([{ price: 2.5, quantity: 2 }, { price: 1, quantity: 3 }]), 8);
});

test('an empty cart costs nothing', () => {
  assert.equal(total([]), 0);
});
