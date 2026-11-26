import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AttachmentStore } from '../desktop/attachments.mjs';
import { PhoneTurns } from '../desktop/phone-turns.mjs';
import { phoneChat } from '../desktop/phone-access.mjs';

// A folder as the iPhone sends it: zipped, holding the folder itself.
async function zippedFolder(base, files) {
  const folder = join(base, 'Notes');
  for (const [name, text] of Object.entries(files)) {
    await mkdir(join(folder, name, '..'), { recursive: true });
    await writeFile(join(folder, name), text);
  }
  const zip = join(base, 'Notes.zip');
  execFileSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', folder, zip]);
  return readFile(zip);
}

test('a zipped folder becomes one attachment, without secrets', async () => {
  const base = await mkdtemp(join(tmpdir(), 'fairy-attach-'));
  try {
    const store = new AttachmentStore({ dir: join(base, 'attachments') });
    const bytes = await zippedFolder(base, { 'week.md': '# Week', 'deep/plan.txt': 'Plan', '.env': 'KEY=secret' });
    const item = await store.addFolderZip('Notes.zip', bytes);
    assert.equal(item.name, 'Notes');
    const root = store.root(item.id);
    assert.deepEqual((await readdir(join(root.path, 'Notes'))).sort(), ['deep', 'week.md']);
    assert.equal(root.name, 'Attached: Notes');
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('an empty or oversized folder is refused', async () => {
  const base = await mkdtemp(join(tmpdir(), 'fairy-attach-'));
  try {
    const store = new AttachmentStore({ dir: join(base, 'attachments') });
    await assert.rejects(store.addFolderZip('Nothing', Buffer.alloc(0)), /empty/);
    await assert.rejects(store.addFolderZip('Big', Buffer.alloc(51 * 1024 * 1024, 1)), /over 50 MB/);
    const bytes = await zippedFolder(base, { '.env': 'KEY=secret' });
    await assert.rejects(store.addFolderZip('Notes.zip', bytes), /no files/);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('a phone message carries its attachments to the reply and into the chat', async () => {
  const saved = [], claimed = [];
  let replied;
  const turns = new PhoneTurns({ list: () => [], read: async () => [], append: async (id, entries) => saved.push(...entries), addChat: async () => 'c1',
    attached: async ids => ids.map(id => ({ id, name: `${id}.pdf`, size: 10 })), claim: async files => claimed.push(...files),
    reply: async request => { replied = request; return 'Read it.'; } });
  await turns.send({ text: 'Summarise this', attachments: ['a1'] });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(replied.files.map(file => file.id), ['a1']);
  assert.deepEqual(saved[0].attachments.map(file => file.name), ['a1.pdf']);
  assert.deepEqual(claimed.map(file => file.id), ['a1']);
  await assert.rejects(turns.send({ text: 'Too many', attachments: Array(11).fill('x') }), /up to 10/);
  const chat = phoneChat({ id: 'c1', title: 'T' }, saved, null, 'idle');
  assert.deepEqual(chat.messages[0].attachments, [{ name: 'a1.pdf', size: 10 }]);
});
