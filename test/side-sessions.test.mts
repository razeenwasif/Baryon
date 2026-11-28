import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore } from '../desktop/sessions.mjs';
import { readJSON, writeJSON } from '../desktop/core.mjs';
import { SESSION_TOOLS, SideSessions, noteEntry, pendingNotes, runSessionsChat } from '../desktop/side-sessions.mjs';
import { WorkTools } from '../desktop/work-tools.mjs';
import { runWork, workInstructions } from '../desktop/work-agent.mjs';
import { checkBranchable } from '../desktop/git-tools.mjs';
import { describeEntry, workContext } from '../src/work-context.js';
import { requestMode, wantsSessions } from '../src/chat-routing.js';
import { scriptedProvider } from '../evals/runner.mjs';

const textOf = (result: any) => result.contentItems[0].text;
// A chat store in a scratch folder, a work session to start from, and SideSessions with a pretend way of running turns:
// begin records each turn, and full makes it refuse the way three busy chats do.
async function setup(t: TestContext, { permission = 'ask', full = false }: { permission?: 'ask' | 'auto' | 'plan'; full?: boolean } = {}) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'fairy-side-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let clock = 0, ids = 0;
  const now = Date.UTC(2026, 10, 11, 9, 0, 0);
  const tick = () => new Date(now + 1000 * clock++);
  const sessions = new SessionStore({ dir: join(dir, 'sessions'), legacyDir: dir, readJSON, writeJSON, trash: async () => {}, now: () => tick().toISOString(), id: () => `chat-${++ids}` });
  await sessions.load();
  await sessions.createWork(dir);
  await sessions.setWork({ permission });
  await sessions.save([{ role: 'user', content: 'Tidy the project', at: tick().toISOString(), mode: 'work' }, { role: 'assistant', content: 'On it.', at: tick().toISOString(), mode: 'work' }]);
  const parent = sessions.active!, turns: any[] = [], logged: any[] = [], running = new Set<string>(), world = { full };
  const side = new SideSessions({ sessions: sessions as any, busy: id => running.has(id), place: async path => path, log: entry => logged.push(entry), now: tick, id: () => `card-${++ids}`,
    begin: async (id, turn) => {
      if (world.full) throw new Error('3 chats are already working. Wait for one to finish, or stop one.');
      turns.push({ id, ...turn }); running.add(id);
    } });
  (sessions as any).queued = () => side.queued();
  // Ends a pretend turn the way main does: the reply is saved, then SideSessions hears about it.
  const finish = async (id: string, reply: string, { stopped = false }: { stopped?: boolean } = {}) => {
    const turn = turns.findLast(entry => entry.id === id);
    await sessions.append(id, [{ role: 'assistant', content: reply, at: tick().toISOString(), replyTo: turn.at, mode: 'work' }]);
    running.delete(id);
    await side.turnEnded({ id, reply, finished: !stopped, stopped });
  };
  const call = (name: string, args: any, scope: Record<string, any> = {}): Promise<any> => {
    const tool = SESSION_TOOLS.find(entry => entry.name === name)!;
    return tool.run(args, { link: side.link(() => parent), permission, approveOffer: async () => 'allow', approveStart: async () => {}, ...scope } as any) as Promise<any>;
  };
  return { dir, sessions, side, parent, turns, logged, running, world, finish, call };
}

test('the session tools are on the shared registry, and a work session offers them only when it can start sessions', async t => {
  assert.deepEqual(SESSION_TOOLS.map(tool => tool.name), ['start_session', 'message_session', 'list_sessions']);
  assert.ok(SESSION_TOOLS.every(tool => tool.risk === (tool.name === 'list_sessions' ? 'read' : 'write') && tool.inputSchema.additionalProperties === false));
  const root = await realpath(await mkdtemp(join(tmpdir(), 'fairy-side-tools-'))); t.after(() => rm(root, { recursive: true, force: true }));
  const names = (tools: WorkTools) => tools.available().map(tool => tool.name);
  assert.ok(!names(new WorkTools({ root, approve: async () => 'allow' })).includes('start_session'));
  assert.ok(names(new WorkTools({ root, approve: async () => 'allow', sessions: {} as any })).includes('start_session'));
  assert.ok(names(new WorkTools({ root, approve: async () => 'allow', sessions: {} as any })).includes('message_session'));
});

test('an offer the user starts opens a linked work session that runs its brief by itself', async t => {
  const { sessions, parent, turns, logged, call } = await setup(t);
  const result: any = await call('start_session', { title: 'README tidy-up', brief: 'Tidy the README headings.', where: 'own_branch' });
  assert.equal(result.started, true);
  const child = sessions.find(result.session)!;
  assert.equal(child.parent, parent);
  assert.equal(child.title, 'README tidy-up');
  assert.equal(child.work!.isolate, true, 'its own branch is made when its first turn starts');
  assert.equal(child.work!.permission, 'ask');
  assert.notEqual(sessions.active, child.id, 'it runs off screen, so the chat you were in stays on screen');
  const [turn] = turns;
  assert.equal(turn.id, child.id);
  assert.match(turn.text, /^A task from “Tidy the project”, the chat that started this session[^]*Tidy the README headings\./);
  assert.deepEqual(turn.before, []);
  const saved: any[] = await sessions.read(child.id);
  assert.equal(saved[0].from.kind, 'brief');
  assert.equal(saved[0].note.text, 'Tidy the README headings.');
  assert.equal(logged[0].kind, 'session');
  assert.equal(logged[0].chat, parent);
  // Linked both ways: the parent lists it, and it says where it came from.
  assert.deepEqual(sessions.state().links!.children.map((entry: any) => entry.id), [child.id]);
  assert.equal(sessions.state().sessions.find((entry: any) => entry.id === child.id)!.parent, parent);
  await sessions.open(child.id);
  assert.deepEqual(sessions.state().links!.parent, { id: parent, title: 'Tidy the project' });
});

test('Do it here, no answer and plan mode each start nothing', async t => {
  const { sessions, turns, call } = await setup(t);
  const here: any = await call('start_session', { title: 'Docs', brief: 'x' }, { approveOffer: async () => 'deny' });
  assert.equal(here.started, false);
  assert.match(here.text, /Do it here/);
  const late: any = await call('start_session', { title: 'Docs', brief: 'x' }, { approveOffer: async () => 'timeout' });
  assert.match(late.text, /Nobody answered/);
  for (const mode of ['offer', 'start']) assert.match(((await call('start_session', { title: 'Docs', brief: 'x', mode }, { permission: 'plan' })) as any).error, /plan mode, so it can only propose/);
  await assert.rejects(call('start_session', { title: 'Docs', brief: 'x', mode: 'start' }, { approveStart: async () => { throw new Error('The user didn’t allow this.'); } }), /didn’t allow/);
  assert.equal(turns.length, 0);
  assert.equal(sessions.sessions.length, 1);
});

test('a proposal is a card the user can start or dismiss for a week', async t => {
  const { sessions, side, parent, turns, call } = await setup(t, { permission: 'plan' });
  const card: any = await call('start_session', { title: 'Upgrade the linter', brief: 'Move to the new config format.', mode: 'propose' }, { permission: 'plan' });
  assert.equal(card.proposed, true);
  assert.equal(turns.length, 0, 'nothing starts until the user says so');
  const [shown] = sessions.state().links!.proposals;
  assert.equal(shown.title, 'Upgrade the linter');
  assert.equal(Date.parse(shown.expires) - Date.parse(shown.at), 7 * 24 * 60 * 60 * 1000);
  assert.match(side.describe(parent), /Cards you left that the user hasn't answered: “Upgrade the linter”/);
  const child = await side.startProposal(parent, shown.id);
  assert.equal(sessions.find(child.id)!.parent, parent);
  assert.equal(sessions.find(child.id)!.work!.permission, 'ask', 'a session from a plan-mode chat still asks first');
  assert.equal(sessions.state().links!.proposals.length, 0);
  await assert.rejects(side.startProposal(parent, shown.id), /expired or was already answered/);
  const other: any = await call('start_session', { title: 'Later', brief: 'y', mode: 'propose' });
  await side.dismissProposal(parent, other.id);
  assert.equal(sessions.state().links!.proposals.length, 0);
  assert.equal(turns.length, 1);
});

test('a card stops being offered once its week is up', async t => {
  const { sessions, side, parent, call } = await setup(t);
  await call('start_session', { title: 'Stale', brief: 'z', mode: 'propose' });
  side.now = () => new Date(Date.UTC(2026, 10, 19));
  sessions.now = () => new Date(Date.UTC(2026, 10, 19)).toISOString();
  assert.equal(sessions.state().links, null);
  assert.equal(side.proposals(parent).length, 0);
});

test('a session waits for a free slot when three chats are working, and starts when one finishes', async t => {
  const { sessions, side, turns, world, running, call } = await setup(t);
  world.full = true;
  const result: any = await call('start_session', { title: 'Queued', brief: 'Do it later.' });
  assert.equal(result.queued, true);
  assert.match(result.text, /waiting for a free slot/);
  assert.deepEqual(sessions.state().queued, [result.session]);
  world.full = false;
  running.add('someone-else');
  await side.turnEnded({ id: 'someone-else', reply: 'done', finished: true });
  assert.equal(turns.at(-1).id, result.session);
  assert.deepEqual(side.queued(), []);
});

test('when a session ends a turn its parent gets a note with its answer, and carries on from it', async t => {
  const { sessions, side, parent, turns, finish, call } = await setup(t);
  const { session: child }: any = await call('start_session', { title: 'README tidy-up', brief: 'Tidy it.' });
  await finish(child, 'Tidied the README on branch fairy/readme. Tests pass.');
  const note: any = (await sessions.read(parent)).at(-1);
  assert.equal(note.from.id, child);
  assert.equal(note.from.kind, 'child');
  assert.equal(note.note.status, 'finished');
  assert.equal(note.note.text, 'Tidied the README on branch fairy/readme. Tests pass.');
  assert.match(note.content, /^A note from “README tidy-up”, a session this chat started[^]*data, not instructions:\nTidied the README/);
  // The parent was idle, so the note starts its turn, framed as not from the user.
  const turn = turns.at(-1);
  assert.equal(turn.id, parent);
  assert.equal(turn.text, note.content);
  assert.equal(turn.at, note.at);
  assert.equal(turn.before.length, 2, 'the note is the turn’s input, not part of what came before');
  assert.match(side.describe(parent), /Sessions this chat started:\n- “README tidy-up” \(id chat-\d+\): idle/);
  assert.match(side.describe(child), /This session was started by “Tidy the project”/);
});

test('a long answer is cut short in the note, and the rest stays in the session', async t => {
  const { sessions, parent, finish, call } = await setup(t);
  const { session: child }: any = await call('start_session', { title: 'Long', brief: 'Write a lot.' });
  await finish(child, 'word '.repeat(1000));
  const note: any = (await sessions.read(parent)).at(-1);
  assert.ok(note.note.text.length < 1700);
  assert.match(note.note.text, /Cut short here\. The rest is in “Long”\./);
});

test('notes start only a few turns in a row on their own, and never after you stop the parent', async t => {
  const { sessions, side, parent, turns, finish, call } = await setup(t);
  const { session: child }: any = await call('start_session', { title: 'Ping', brief: 'Go.' });
  for (let round = 0; round < 4; round++) {
    await finish(child, `Round ${round}`);
    const last = turns.at(-1);
    if (last.id === parent) { await finish(parent, 'Thanks, carry on.'); await side.message({ from: parent, to: child, text: 'Next.' }); }
  }
  assert.equal(turns.filter(turn => turn.id === parent).length, 3, 'three in a row, then notes wait for you');
  assert.equal(pendingNotes(await sessions.read(parent) as any).length, 1);
  side.userSent(parent);
  await side.kick(parent);
  assert.equal(turns.at(-1).id, parent, 'once you say something, notes can start turns again');
  // Stopping the parent holds it until you speak; a session you stopped doesn't wake it either.
  await finish(parent, 'Stopped.', { stopped: true });
  await side.message({ from: parent, to: child, text: 'Once more.' });
  const before = turns.length;
  await finish(child, 'Done again.');
  assert.equal(turns.length, before, 'the parent was stopped, so the note waits');
});

test('a note from a session the user stopped is kept for the next turn without starting one', async t => {
  const { sessions, parent, turns, finish, call } = await setup(t);
  const { session: child }: any = await call('start_session', { title: 'Stop me', brief: 'Go.' });
  await finish(child, 'Stopped before finishing.', { stopped: true });
  const note: any = (await sessions.read(parent)).at(-1);
  assert.equal(note.note.status, 'stopped');
  assert.equal(note.quiet, true);
  assert.equal(turns.at(-1).id, child);
});

test('message_session reaches linked sessions as linked messages, and starts a turn there', async t => {
  const { sessions, side, parent, turns, running, finish, call } = await setup(t);
  const { session: child }: any = await call('start_session', { title: 'Helper', brief: 'Go.' });
  await finish(child, 'Which file?');
  await finish(parent, 'Answering.');
  const sent: any = await call('message_session', { session: child, message: 'README.md, please.' });
  assert.equal(sent.sent, true);
  assert.equal(turns.at(-1).id, child);
  assert.match(sent.text, /working on it now/);
  assert.match(turns.at(-1).text, /^A message from “Tidy the project”, the chat that started this session[^]*README\.md, please\./);
  // While it's busy, a message waits for its turn to end.
  running.add(child);
  const later: any = await call('message_session', { session: child, message: 'Also the changelog.' });
  assert.match(later.text, /in the middle of a turn/);
  await assert.rejects(call('message_session', { session: 'nobody', message: 'Hi' }), /There’s no session nobody/);
  // An unlinked work session gets a peer message instead (test/session-messages.test.mjs).
  const stranger = await sessions.addWork({ title: 'Unrelated', work: { folder: '/tmp', permission: 'ask' }, history: [] });
  await call('message_session', { session: stranger, message: 'Hi' });
  assert.equal((await sessions.read(stranger) as any[]).at(-1).from.kind, 'peer');
  running.delete(child);
  await assert.rejects(call('message_session', { session: child, message: 'More' }, { permission: 'plan' }), /plan mode/);
  // A session can answer the chat that started it.
  const up = await side.message({ from: child, to: parent, text: 'Done with both.' });
  assert.equal(up.sent, true);
  assert.equal((await sessions.read(parent) as any[]).at(-1).from.kind, 'reply');
});

test('pending notes are the ones no turn has seen', () => {
  const at = (second: number) => `2026-11-11T09:00:${String(second).padStart(2, '0')}.000Z`;
  const note = (second: number) => noteEntry({ from: { id: 'c', title: 'C' }, kind: 'child', text: 'x', at: at(second) });
  assert.equal(pendingNotes([note(1)]).length, 1);
  // A note that arrived during a turn comes after the request that turn answered.
  assert.equal(pendingNotes([{ role: 'user', content: 'go', at: at(2) }, note(3), { role: 'assistant', content: 'done', at: at(5), replyTo: at(2) }]).length, 1);
  assert.equal(pendingNotes([note(1), { role: 'assistant', content: 'read it', at: at(4), replyTo: at(1) }]).length, 0);
  assert.equal(pendingNotes([{ role: 'user', content: 'hi', at: at(1) }]).length, 0);
});

test('the digest calls a note a linked session, not the user, and doesn’t take it for an unanswered request', () => {
  const history = [{ role: 'user', content: 'Start it', at: '1', mode: 'work' }, { role: 'assistant', content: 'Started.', at: '2', mode: 'work' }, noteEntry({ from: { id: 'c', title: 'C' }, kind: 'child', text: 'All done.', at: '3' })];
  assert.match(describeEntry(history, 2), /^Linked session: A note from “C”/);
  assert.doesNotMatch(workContext(history), /got no reply/);
});

test('a work turn can offer a session, and the user starting it opens a linked chat with its brief', async t => {
  const { dir, sessions, side, parent, turns } = await setup(t);
  const offers: any[] = [];
  const tools = new WorkTools({ root: dir, permission: 'ask', owner: parent, sessions: side.link(() => parent), approve: async request => { offers.push(request); return 'allow'; } });
  let seen: any;
  const script = scriptedProvider([
    { call: 'start_session', arguments: { title: 'README tidy-up', brief: 'Tidy the README: fix headings and dead links.', where: 'own_branch', mode: 'offer' } },
    results => ({ reply: `Split it off. ${results[0]}` }),
  ]);
  const provider: any = { turn: (options: any) => { seen = options; return script.turn(options); } };
  const reply = await runWork({ provider, settings: {}, text: 'Split the README tidy-up into its own session.', history: [], tools: tools as any, linked: side.describe(parent) });
  assert.equal(offers.length, 1);
  assert.equal(offers[0].kind, 'session-offer');
  assert.equal(offers[0].command, 'Tidy the README: fix headings and dead links.');
  assert.match(offers[0].detail, /on its own branch of/);
  assert.match(reply, /Started “README tidy-up”/);
  assert.match(seen.instructions, /use start_session: offer when the user named the task/);
  assert.ok(seen.tools.some((tool: any) => tool.name === 'start_session'));
  const child = sessions.sessions.find(entry => entry.parent === parent)!;
  assert.equal(child.title, 'README tidy-up');
  assert.equal(turns.at(-1).id, child.id);
  assert.equal(tools.activity.at(-1)!.tool, 'session');
  assert.equal(tools.activity.at(-1)!.detail, 'Started');
});

test('a turn started by notes says so, rather than calling them the user’s request', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'fairy-side-turn-'))); t.after(() => rm(root, { recursive: true, force: true }));
  let input: any;
  const provider: any = { turn: async (options: any) => { input = options.input[0].text; return 'ok'; } };
  await runWork({ provider, settings: {}, text: 'A note from “C”…', history: [], tools: new WorkTools({ root, approve: async () => 'allow', sessions: {} as any }) as any, fromSessions: true });
  assert.match(input, /This turn wasn’t started by the user/);
  assert.doesNotMatch(input, /The user's request/);
  assert.match(workInstructions({ root, permission: 'plan', sandboxed: true, sessions: 'x' }), /You can still leave a card for a separate session/);
  assert.doesNotMatch(workInstructions({ root, permission: 'ask', sandboxed: true }), /start_session/);
});

test('a plain chat routes session requests to its own agent, which needs a folder the user named', async t => {
  assert.equal(wantsSessions('split the README tidy-up into its own session'), true);
  assert.equal(wantsSessions('Start a separate session to fix the tests in ~/code/app'), true);
  assert.equal(wantsSessions('message that session and tell it to use main'), true);
  assert.equal(wantsSessions('how was your session at the gym?'), false);
  assert.equal(wantsSessions('do it without a new session'), false);
  assert.equal(requestMode('Spin up a side session to tidy the docs', 'chat', {}), 'sessions');
  assert.equal(requestMode('Spin up a side session to tidy the docs', 'desktop', {}), 'desktop');
  const { sessions, side, dir } = await setup(t);
  const plain = await sessions.addChat({ title: 'Just chatting', history: [{ role: 'user', content: 'hi', at: '1', mode: 'chat' }] });
  await assert.rejects(side.plan(plain, { title: 'x', brief: 'y', where: 'this_folder' } as any), /say which folder/);
  const asked: any[] = [];
  const reply = await runSessionsChat({ provider: scriptedProvider([{ call: 'start_session', arguments: { title: 'Docs', brief: 'Tidy docs.', where: 'other_folder', folder: dir } }, (results: any) => ({ reply: results[0].text })]) as any,
    settings: { backend: 'claude', personality: '', name: 'Fairy' }, text: `Start a separate session to tidy the docs in ${dir}`, link: side.link(() => plain), approveOffer: async (request: any) => { asked.push(request); return 'allow'; }, approveStart: async () => {} } as any);
  assert.match(reply, /Started “Docs”/);
  assert.equal(asked.length, 1);
  assert.equal(sessions.sessions.find(entry => entry.parent === plain)!.work!.folder, dir);
});

test('a session on its own branch needs a repository with a commit', async t => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'fairy-side-git-'))); t.after(() => rm(dir, { recursive: true, force: true }));
  await assert.rejects(checkBranchable(dir), /isn’t a Git repository/);
});
