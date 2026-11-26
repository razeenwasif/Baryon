import test from 'node:test';
import assert from 'node:assert/strict';
import * as users from '../src/users.js';

test('loadUser replaces fetchUser', () => {
  assert.equal(typeof users.loadUser, 'function');
  assert.equal('fetchUser' in users, false);
  assert.equal(users.loadUser(1).name, 'Ada');
});
