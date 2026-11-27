import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoader } from '../src/loader.js';

const api = () => {
  const calls = [];
  const fetchUser = async id => { calls.push(id); await new Promise(resolve => setTimeout(resolve, 5)); return { id, name: `Member ${id}` }; };
  return { calls, fetchUser };
};

test('a profile already loaded isn’t fetched again', async () => {
  const { calls, fetchUser } = api(), load = createLoader(fetchUser);
  assert.deepEqual(await load(7), { id: 7, name: 'Member 7' });
  await load(7);
  assert.deepEqual(calls, [7]);
});

test('loads of the same profile at the same time share one request', async () => {
  const { calls, fetchUser } = api(), load = createLoader(fetchUser);
  const [a, b] = await Promise.all([load(3), load(3)]);
  assert.equal(a, b);
  assert.deepEqual(calls, [3]);
});
