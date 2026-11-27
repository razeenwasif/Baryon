import test from 'node:test';
import assert from 'node:assert/strict';
import { statement } from '../src/statement.js';

const dollars = text => Number(text.slice(1));

test('prints a row per line', () => {
  const { rows } = statement([{ name: 'Tea', price: 4.5, quantity: 2 }]);
  assert.deepEqual(rows, [{ name: 'Tea', amount: '$9.00' }]);
});

test('the total is the sum of the rows', () => {
  const lines = [1, 2, 3].map(n => ({ name: `Sample ${n}`, price: 0.335, quantity: 1 }));
  const { rows, total } = statement(lines);
  assert.equal(total, `$${rows.reduce((sum, row) => sum + dollars(row.amount), 0).toFixed(2)}`);
});
