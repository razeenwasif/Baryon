import test from 'node:test';
import assert from 'node:assert/strict';
import { loadNotes } from '../src/notes.js';

test('loads the notes', () => {
  assert.equal(loadNotes().length, 3);
});
