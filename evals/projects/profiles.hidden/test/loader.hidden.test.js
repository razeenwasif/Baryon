import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoader } from '../src/loader.js';

const slow = (value, ms = 5) => new Promise(resolve => setTimeout(() => resolve(value), ms));

test('many loads of one profile at once make one request, and all get it', async () => {
  let calls = 0;
  const load = createLoader(async id => { calls++; return slow({ id }); });
  const got = await Promise.all([load(1), load(1), load(1), load(1)]);
  assert.equal(calls, 1);
  assert.ok(got.every(user => user === got[0]));
});

test('different profiles are fetched separately', async () => {
  const asked = [];
  const load = createLoader(async id => { asked.push(id); return slow({ id }); });
  const [a, b] = await Promise.all([load(1), load(2)]);
  assert.deepEqual([a.id, b.id, asked.sort()], [1, 2, [1, 2]]);
});

test('a failed request reaches everyone waiting on it, and isn’t kept', async () => {
  let calls = 0;
  const load = createLoader(async id => { calls++; if (calls === 1) { await slow(null); throw new Error('API down'); } return slow({ id }); });
  const first = await Promise.allSettled([load(9), load(9)]);
  assert.deepEqual(first.map(result => result.status), ['rejected', 'rejected']);
  assert.equal(first[0].reason.message, 'API down');
  assert.equal(calls, 1, 'one request for both');
  assert.deepEqual(await load(9), { id: 9 }, 'the next load tries again');
  assert.equal(calls, 2);
  await load(9);
  assert.equal(calls, 2, 'and once it worked, it’s kept');
});
