import test from 'node:test';
import assert from 'node:assert/strict';
import { PANE_MIN, CHAT_ROOM, paneWidth } from '../src/pane-resize.js';

test('the side panel keeps a width of its own only once dragged, and always leaves the chat room', () => {
  assert.equal(paneWidth(null), null, 'never dragged: each panel keeps its own width');
  assert.equal(paneWidth('abc'), null);
  assert.equal(paneWidth(560, 1512, 324), 560);
  assert.equal(paneWidth(100, 1512, 324), PANE_MIN, 'never narrower than a panel can use');
  assert.equal(paneWidth(1400, 1512, 324), 1512 - 324 - CHAT_ROOM, 'never so wide the chat disappears');
  assert.equal(paneWidth(560.6, 1512, 324), 561);
});
