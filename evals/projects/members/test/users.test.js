import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchUser } from '../src/users.js';
import { profileLine } from '../src/profile.js';
import { isAdmin } from '../src/admin.js';

test('fetchUser finds a member', () => {
  assert.equal(fetchUser(2).name, 'Grace');
  assert.equal(fetchUser(9), null);
});

test('profiles and admins', () => {
  assert.equal(profileLine(1), 'Ada (#1)');
  assert.equal(isAdmin(2), false);
});
