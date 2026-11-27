import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exchanges, questionLine } from '../src/compacted.js';

test('compacted messages fold into one line per question', () => {
  const groups = exchanges([
    { role: 'assistant', content: 'Good morning', at: '1' },
    { role: 'user', content: '\n  What is PCA?\nMore detail', at: '2' },
    { role: 'assistant', content: 'Variance.', at: '3' },
    { role: 'assistant', content: 'And more.', at: '4' },
    { role: 'user', content: 'Thanks', at: '5' },
  ]);
  assert.deepEqual(groups.map(group => [group.title, group.items.length]), [['Earlier', 1], ['What is PCA?', 3], ['Thanks', 1]]);
  assert.equal(questionLine('x'.repeat(200)).length, 90);
  assert.ok(questionLine('x'.repeat(200)).endsWith('…'));
  assert.equal(questionLine(''), 'A message');
});
