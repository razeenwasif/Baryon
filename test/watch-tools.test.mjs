import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { WATCH_TOOLS, sameWatcher, watchCard, watchDraft, watchNudge } from '../desktop/watch-tools.mjs';
import { PLAIN_NEED, WorkTools } from '../desktop/work-tools.mjs';
import { phoneApproval } from '../desktop/phone-access.mjs';

const home = '/Users/someone';

test('a drafted watcher is what the store would keep, and never runs on its own from a chat', () => {
  const job = watchDraft({ event: 'nexus-job', job: 'j-123abc' });
  assert.equal(job.event, 'nexus-job'); assert.equal(job.job, 'j-123abc'); assert.equal(job.every, 2); assert.equal(job.action, 'tell'); assert.equal(job.title, 'Nexus job j-123abc');
  assert.ok(!('id' in job) && !('state' in job) && !('enabled' in job));
  const work = watchDraft({ event: 'check-failed', repo: 'me/app', pr: 7, action: 'work', prompt: 'Fix it', runOnOwn: true }, { folder: `${home}/app` });
  assert.equal(work.folder, `${home}/app`, 'work happens in the chat’s folder unless another is named');
  assert.equal(work.runOnOwn, false);
  assert.equal(watchDraft({ event: 'check-failed', repo: 'me/app', action: 'work', folder: `${home}/other` }, { folder: `${home}/app` }).folder, `${home}/other`);
  assert.equal(watchDraft({ event: 'paper', query: 'protein design', action: 'summarise', folder: '/etc' }).folder, '', 'only work keeps a folder');
});

test('an incomplete watcher says what it needs', () => {
  assert.throws(() => watchDraft({ event: 'nope' }), /Say which event/);
  assert.throws(() => watchDraft({ event: 'nexus-job' }), /its id as job/);
  assert.throws(() => watchDraft({ event: 'check-failed', repo: '../..' }), /owner\/name/);
  assert.throws(() => watchDraft({ event: 'check-failed', repo: 'me/app', pr: 3, branch: 'main' }), /not both/);
  assert.throws(() => watchDraft({ event: 'file', path: 'notes' }), /full path/);
  assert.throws(() => watchDraft({ event: 'paper', query: 'x', every: 5 }), /60 to 1440/);
  assert.throws(() => watchDraft({ event: 'paper', query: 'x', action: 'explode' }), /what to do/);
  assert.throws(() => watchDraft({ event: 'check-failed', repo: 'me/app', action: 'work', folder: 'relative' }), /folder given as a full path/);
});

test('the card spells the watcher out', () => {
  const card = watchCard(watchDraft({ event: 'check-failed', repo: 'me/app', pr: 7, action: 'work', prompt: 'Find why and fix it' }, { folder: `${home}/app` }));
  assert.equal(card.title, 'Add a watcher? Checks on me/app #7');
  assert.equal(card.detail, `When a check fails on me/app #7\nLooks every 5 minutes, on the mini\nThen: Work on it in ${home}/app, asking you first each time\nAsking: Find why and fix it`);
  assert.match(watchCard(watchDraft({ event: 'paper', query: 'protein design' })).detail, /^When a new arXiv paper matches “protein design”\nLooks every 6 hours/);
  assert.match(watchCard(watchDraft({ event: 'review' })).detail, /^When a review or comment arrives on your pull requests\n/);
  assert.match(watchCard(watchDraft({ event: 'nexus-job', job: 'abc123' })).detail, /^When Nexus job abc123 ends\nLooks every 2 minutes/);
});

test('watch_add adds a watcher only when the user presses Add watcher', async () => {
  const [tool] = WATCH_TOOLS;
  assert.deepEqual([tool.name, tool.risk], ['watch_add', 'read']);
  assert.ok(!('runOnOwn' in tool.inputSchema.properties), 'a chat can’t ask for a watcher that works on its own');
  const added = [], offered = [];
  const watchers = answer => ({ list: async () => [], add: async value => added.push(value), offer: async request => { offered.push(request); return answer; } });
  const yes = await tool.run({ event: 'nexus-job', job: 'abc123' }, { watchers: watchers('allow'), folder: home });
  assert.equal(yes.added, true); assert.match(yes.text, /Added the watcher “Nexus job abc123”\. It looks every 2 minutes on the mini, and tells the user/);
  assert.equal(added.length, 1); assert.equal(added[0].job, 'abc123');
  assert.equal(offered[0].title, 'Add a watcher? Nexus job abc123');
  const no = await tool.run({ event: 'nexus-job', job: 'abc123' }, { watchers: watchers('deny'), folder: home });
  assert.deepEqual([no.added, no.text], [false, 'The user chose not to add the watcher.']);
  const none = await tool.run({ event: 'nexus-job', job: 'abc123' }, { watchers: watchers('timeout'), folder: home });
  assert.match(none.text, /No one answered/);
  assert.equal(added.length, 1);
  // The same watcher already kept: no card.
  const kept = { ...watchDraft({ event: 'nexus-job', job: 'abc123' }), id: 'w1', enabled: false, title: 'My job' };
  offered.length = 0;
  const again = await tool.run({ event: 'nexus-job', job: 'abc123' }, { watchers: { ...watchers('allow'), list: async () => [kept] }, folder: home });
  assert.equal(again.already, true); assert.match(again.text, /“My job”, paused/); assert.equal(offered.length, 0);
  assert.ok(!sameWatcher(kept, watchDraft({ event: 'nexus-job', job: 'abc123', action: 'summarise' })));
  // A bad watcher, or a store that refuses it, comes back as an error.
  assert.match((await tool.run({ event: 'nexus-job' }, { watchers: watchers('allow'), folder: home })).error, /its id as job/);
  assert.equal((await tool.run({ event: 'check-failed', repo: 'me/app', action: 'work' }, { watchers: { ...watchers('allow'), add: async () => { throw new Error('That folder is your whole home folder.'); } }, folder: home })).error, 'That folder is your whole home folder.');
  assert.match((await tool.run({ event: 'nexus-job', job: 'abc123' }, { watchers: null })).error, /aren’t on this Mac/);
});

test('a Nexus job sent or a pull request opened nudges the model to offer one', () => {
  assert.match(watchNudge('nexus_run', { job: 'abc123', target: 'cpu' }), /watch_add with event nexus-job and job abc123/);
  assert.match(watchNudge('github_pr_create', { created: true, url: 'https://github.com/me/app/pull/42\n' }), /repo me\/app and pr 42/);
  for (const [name, result] of [['nexus_logs', { job: 'abc123' }], ['github_pr_create', { created: false, cancelled: true }], ['github_pr_create', { created: true, url: 'https://example.com/me/app/pull/1' }], ['nexus_run', { error: 'no' }]])
    assert.equal(watchNudge(name, result), '', name);
});

test('a work turn offers watch_add on the card, in the watchers group', async () => {
  const asked = [], added = [];
  const tools = new WorkTools({ root: home, runCommand: async () => ({}), approve: async request => { asked.push(request); return 'allow'; },
    watchers: { list: async () => [], add: async value => added.push(value) } });
  assert.ok(tools.toolGroups().has('watchers'));
  assert.ok(tools.offered({ request: 'Let me know when the job ends' }).some(t => t.name === 'watch_add'));
  assert.ok(!tools.offered({ request: 'Fix the parser' }).some(t => t.name === 'watch_add'), 'otherwise only through more_tools');
  const result = await tools.handle({ tool: 'more_tools', arguments: { name: 'watch_add', arguments: { event: 'check-failed', repo: 'me/app', branch: 'main' } } });
  assert.equal(result.success, true);
  assert.equal(asked[0].kind, 'watcher-offer'); assert.equal(asked[0].tool, 'watch_add'); assert.equal(asked[0].title, 'Add a watcher? Checks on me/app on main');
  assert.equal(added[0].branch, 'main');
  assert.equal(tools.activity.at(-1).detail, 'Added');
  const none = new WorkTools({ root: home, runCommand: async () => ({}) });
  assert.ok(!none.toolGroups().has('watchers'));
  assert.equal((await none.handle({ tool: 'watch_add', arguments: { event: 'nexus-job', job: 'abc123' } })).success, false);
});

test('nexus_run’s result carries the nudge only when watchers are on', async () => {
  const nexus = { submit: async () => ({ job: 'abc123', target: 'cpu', status: 'waiting' }) };
  const make = watchers => new WorkTools({ root: home, runCommand: async () => ({}), nexus, permission: 'auto', approve: async () => 'allow', ...(watchers ? { watchers } : {}) });
  const on = await make({ list: async () => [], add: async () => {} }).handle({ tool: 'nexus_run', arguments: { target: 'cpu', command: 'python sweep.py' } });
  assert.match(on.contentItems[0].text, /offer a watcher: watch_add with event nexus-job and job abc123/);
  const off = await make(null).handle({ tool: 'nexus_run', arguments: { target: 'cpu', command: 'python sweep.py' } });
  assert.doesNotMatch(off.contentItems[0].text, /watch_add/);
});

test('asking to be told is a plain need for watchers', () => {
  for (const request of ['tell me when the checks fail', 'let me know when it finishes', 'keep an eye on PR 12', 'add a watcher for new papers', 'ping me once the job is done', 'notify me if the build fails'])
    assert.ok(PLAIN_NEED.watchers.test(request), request);
  for (const request of ['tell me about the parser', 'watch out for null here', 'when it ends, the loop returns']) assert.ok(!PLAIN_NEED.watchers.test(request), request);
});

test('the card is labelled Add watcher and Not now wherever it shows', async () => {
  const main = await readFile(new URL('../desktop/main.cjs', import.meta.url), 'utf8'), view = await readFile(new URL('../src/work-view.js', import.meta.url), 'utf8'), phone = await readFile(new URL('../desktop/phone/phone.js', import.meta.url), 'utf8');
  assert.match(main, /request\.kind === 'watcher-offer'\) request = \{ allowLabel: 'Add watcher', denyLabel: 'Not now', \.\.\.request \}/);
  assert.match(main, /watchers: \{ list: async \(\) => automation\.state\(\)\.watchers, add: value => automation\.addWatcher\(value\) \}/);
  assert.match(view, /request\.kind === 'watcher-offer' \? \[\['Add watcher', 'allow', 'primary'\], \['Not now', 'deny'\]\]/);
  assert.match(phone, /request\.allowLabel \|\| 'Allow once'/);
  const shown = phoneApproval({ id: 'a', kind: 'watcher-offer', title: 'Add a watcher? X', detail: 'When…', allowLabel: 'Add watcher', denyLabel: 'Not now' }, { id: 'c', title: 'Chat' });
  assert.deepEqual([shown.allowLabel, shown.denyLabel], ['Add watcher', 'Not now']);
});
