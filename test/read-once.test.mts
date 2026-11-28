// Token use, step 8: a part of a file read earlier in the turn, unchanged since, isn't sent again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkTools, workTools } from '../desktop/work-tools.mjs';

const textOf = (result: any) => result.contentItems.map((item: any) => item.text).join('');
const project = async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'fairy-read-once-')));
  await writeFile(join(root, 'a.js'), Array.from({ length: 300 }, (_, i) => `line ${i + 1}`).join('\n'));
  return { root, tools: new WorkTools({ root, permission: 'auto', sandboxed: true, runCommand: (async () => ({})) as any }) };
};

test('reading the same part again in a turn, with nothing changed, gets a short note instead of the contents', async () => {
  const { tools } = await project();
  const first = textOf(await tools.read({ path: 'a.js' }));
  assert.match(first, /^a\.js \(300 lines;/);
  const again = textOf(await tools.read({ path: 'a.js' }));
  assert.match(again, /^a\.js from line 1 is unchanged since you read it earlier in this turn, so it isn’t sent again\. If it’s no longer in front of you, call read_file with again: true\.$/);
  assert.ok(again.length < 200 && first.length > 2000);
  assert.equal(tools.activity.at(-1)!.detail, 'unchanged since read this turn');
  // again: true sends it whole; another part of the file is a first read.
  assert.equal(textOf(await tools.read({ path: 'a.js', again: true })), first);
  assert.match(textOf(await tools.read({ path: 'a.js', start: 251 })), /^a\.js \(300 lines;[\s\S]*251: line 251/);
  assert.match(textOf(await tools.read({ path: 'a.js', start: 251 })), /from line 251 is unchanged/);
});

test('a file changed since, by an edit or anything else, is sent again; and a new turn reads afresh', async () => {
  const { root, tools } = await project();
  await tools.read({ path: 'a.js' });
  await tools.edit({ path: 'a.js', old_text: 'line 7\n', new_text: 'line seven\n' });
  assert.match(textOf(await tools.read({ path: 'a.js' })), /7: line seven/);
  // Changed outside the tools, by a command say: the bytes differ, so it's sent.
  await writeFile(join(root, 'a.js'), 'changed\n');
  assert.match(textOf(await tools.read({ path: 'a.js' })), /1: changed/);
  const next = new WorkTools({ root, permission: 'auto', sandboxed: true, runCommand: (async () => ({})) as any });
  assert.match(textOf(await next.read({ path: 'a.js' })), /1: changed/, 'each turn has its own WorkTools');
});

test('read_file says so, and takes again', () => {
  const read = workTools.find(entry => entry.name === 'read_file')!;
  assert.match(read.description, /isn’t sent again unless you pass again: true/);
  assert.deepEqual(read.inputSchema.properties.again, { type: 'boolean' });
});
