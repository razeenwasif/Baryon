import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PageRelations, directMatches, parseRelated, relatedPrompt, sameProject, worthAsking } from '../desktop/page-relations.mjs';
import { readJSON, writeJSON } from '../desktop/core.mjs';

const pages = [
  { id: 'own', title: 'Trip plan', session: 'chat-flux' },
  { id: 'cc', title: 'Flux tab strip', folder: '/Users/r/Github/Flux', session: 'claude-code:a' },
  { id: 'deep', title: 'Flux settings', folder: '/Users/r/Github/Flux/app' },
  { id: 'home', title: 'Scratch', folder: '/Users/r' },
  { id: 'gh', title: 'Everything', folder: '/Users/r/Github' },
  { id: 'design', title: 'Browser chrome mockups', description: 'Flux Browser address bar ideas', folder: '/Users/r/Github/Designs' },
  { id: 'other', title: 'Boxtube redesign', folder: '/Users/r/Github/Boxtube' },
];
const chat = { id: 'chat-flux', title: 'Flux Browser', folder: '/Users/r/Github/Flux', requests: ['Fix the tab strip'] };

test('a chat’s own pages and its project folder match without a model', () => {
  assert.equal(sameProject('/Users/r/Github/Flux', '/Users/r/Github/Flux/app'), true);
  assert.equal(sameProject('/Users/r/Github/Flux', '/Users/r/Github/Fluxion'), false);
  assert.equal(sameProject('/Users/r', '/Users/r/Github/Flux'), false, 'the home folder is no project');
  assert.equal(sameProject('/Users/r/Github', '/Users/r/Github/Flux'), false, 'nor is ~/Github');
  assert.deepEqual(directMatches(pages, chat), { session: ['own'], folder: ['cc', 'deep'] });
});

test('the model sees titles and folder names, and only its numbers are taken', () => {
  const prompt = relatedPrompt(chat, pages.slice(5));
  assert.match(prompt, /Chat: Flux Browser\nProject folder: Github\/Flux/);
  assert.match(prompt, /1\. Browser chrome mockups — Flux Browser address bar ideas \[Github\/Designs\]/);
  assert.doesNotMatch(prompt, /\/Users\/r/, 'only the last two folder names go');
  assert.deepEqual(parseRelated('Sure: {"related": [1, 1, 9, "2"]}', pages.slice(5)), ['design', 'other']);
  assert.equal(parseRelated('no idea', pages.slice(5)), null);
  assert.equal(worthAsking({ title: 'New chat' } as any), false);
});

test('suggestions come in the background, are kept, and a dismissed one stays gone', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-relations-')); t.after(() => rm(dir, { recursive: true, force: true }));
  let asked = 0; const updates: Array<[string, any]> = [];
  const make = () => new PageRelations({ file: join(dir, 'r.json'), readJSON, writeJSON, ask: async (prompt: string) => { asked++; return /Browser chrome/.test(prompt) ? '{"related": [3]}' : '{"related": []}'; }, onUpdate: (id, value) => updates.push([id, value]) });
  const relations = make();
  const first = await relations.forChat(chat, pages);
  assert.deepEqual([first.session, first.folder, first.suggested, first.pending], [['own'], ['cc', 'deep'], [], true]);
  await Promise.all(relations.running.values());
  // The candidates are home, gh, design, other, so design is number 3.
  assert.deepEqual(updates.at(-1), ['chat-flux', { session: ['own'], folder: ['cc', 'deep'], suggested: ['design'], dismissed: [], pending: false }]);
  const again = await make().forChat(chat, pages);
  assert.deepEqual([again.suggested, again.pending, asked], [['design'], false, 1], 'kept, so the model isn’t asked again');
  await relations.dismiss('chat-flux', 'design');
  assert.deepEqual((await make().forChat(chat, pages)).suggested, []);
  // A new page means asking again.
  await make().forChat(chat, [...pages, { id: 'new', title: 'Flux icons' }]);
  assert.equal(asked, 2);
  // With no small model signed in, folders alone.
  const none = new PageRelations({ file: join(dir, 'n.json'), readJSON, writeJSON, ask: async () => null });
  await none.forChat(chat, pages); await Promise.all(none.running.values());
  assert.deepEqual((await none.forChat(chat, pages)).suggested, []);
});
