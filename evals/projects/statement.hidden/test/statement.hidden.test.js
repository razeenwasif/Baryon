import test from 'node:test';
import assert from 'node:assert/strict';
import { statement } from '../src/statement.js';

const cents = text => Math.round(Number(text.slice(1)) * 100);

test('a half cent rounds up, even where floating point says otherwise', () => {
  assert.equal(statement([{ name: 'A', price: 1.005, quantity: 1 }]).rows[0].amount, '$1.01');
  assert.equal(statement([{ name: 'B', price: 2.675, quantity: 1 }]).rows[0].amount, '$2.68');
  assert.equal(statement([{ name: 'C', price: 0.335, quantity: 1 }]).rows[0].amount, '$0.34');
});

test('a discounted line rounds once, to the nearest cent', () => {
  assert.equal(statement([{ name: 'Mugs', price: 19.99, quantity: 3, discount: 0.15 }]).rows[0].amount, '$50.97');
});

test('the rows always add up to the total', () => {
  const prices = [0.1, 0.2, 0.335, 1.005, 2.675, 19.99, 0.07, 3.3, 9.995, 0.015];
  for (let size = 1; size <= prices.length; size++) {
    const lines = prices.slice(0, size).map((price, i) => ({ name: `L${i}`, price, quantity: (i % 3) + 1, discount: i % 4 === 0 ? 0.1 : 0 }));
    const { rows, total } = statement(lines);
    assert.equal(cents(total), rows.reduce((sum, row) => sum + cents(row.amount), 0), `with ${size} lines`);
  }
});

test('an empty statement totals nothing', () => {
  assert.deepEqual(statement([]), { rows: [], total: '$0.00' });
});
