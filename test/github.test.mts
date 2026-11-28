import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHub, ghRunner, summariseChecks } from '../desktop/github.mjs';
import { GITHUB_TOOLS, GITHUB_WRITE_TOOLS } from '../desktop/github-tools.mjs';
import { runGitHub } from '../desktop/github-agent.mjs';
import { WorkTools } from '../desktop/work-tools.mjs';
import { toolset } from '../desktop/tool-registry.mjs';
import { scriptedProvider } from '../evals/runner.mjs';
import { fakeGh } from '../evals/fake-github.mjs';
import { wantsGitHub, requestMode } from '../src/chat-routing.js';

const orbit = () => ({
  repo: 'ada/orbit',
  prs: [{ number: 7, title: 'Faster orbit solver', author: 'ada', state: 'OPEN', head: 'fast-solver', files: ['src/solve.js', 'test/solve.test.js'], body: 'Uses Newton’s method.',
    reviews: [{ author: 'grace', state: 'CHANGES_REQUESTED', body: 'Please handle the zero case.' }],
    inline: [{ id: 501, path: 'src/solve.js', line: 12, author: 'grace', body: 'This divides by zero when e = 0.' }],
    checks: [{ name: 'test', conclusion: 'FAILURE', run: 3001 }, { name: 'lint', conclusion: 'SUCCESS', run: 3002 }],
    diff: 'diff --git a/src/solve.js b/src/solve.js\n+fast\ndiff --git a/test/solve.test.js b/test/solve.test.js\n+test\n' }],
  runs: { 3001: { name: 'test', conclusion: 'failure', branch: 'fast-solver', log: `test\tRun npm test\t\u001b[31mFAIL\u001b[0m test/solve.test.js\ntest\tRun npm test\t  ● solve › handles circular orbits\ntest\tRun npm test\t    TypeError: Cannot divide by zero (e = 0)\n` } },
  issues: [{ number: 12, title: 'Solver hangs on circular orbits', author: 'grace', body: 'Repro: e = 0.' }],
});

test('reading a pull request brings its reviews, inline comments with their ids, and failing checks with their runs', async () => {
  const gh = fakeGh(orbit()), github = new GitHub({ run: gh.run });
  const pr = await github.pr({ repo: 'ada/orbit', number: 7 });
  assert.equal(pr.title, 'Faster orbit solver');
  assert.deepEqual(pr.reviewComments, [{ id: 501, path: 'src/solve.js', line: 12, author: 'grace', body: 'This divides by zero when e = 0.', inReplyTo: null, at: '2026-11-08T04:00:00Z' }]);
  assert.deepEqual(pr.checks, { passed: 1, failed: 1, pending: 0, failing: [{ name: 'test', run: '3001' }] });
  assert.equal(pr.reviews[0].state, 'CHANGES_REQUESTED');
  assert.deepEqual(pr.changes.paths, ['src/solve.js (+5 −1)', 'test/solve.test.js (+5 −1)']);
  const log = await github.ciLog({ repo: 'ada/orbit', run: 3001 });
  assert.match(log.log, /Cannot divide by zero/);
  assert.doesNotMatch(log.log, /\u001b/, 'colour codes are taken out');
  assert.equal((await github.checks({ repo: 'ada/orbit', number: 7 })).checks![0].run, '3001');
  assert.equal((await github.prDiff({ repo: 'ada/orbit', number: 7, path: 'test/solve.test.js' })).text, 'diff --git a/test/solve.test.js b/test/solve.test.js\n+test\n');
  await assert.rejects(github.prDiff({ repo: 'ada/orbit', number: 7, path: 'README.md' }), /isn’t changed/);
  assert.deepEqual((await github.prs({ repo: 'ada/orbit' })).prs.map((p: any) => [p.number, p.author]), [[7, 'ada']]);
  assert.deepEqual(summariseChecks([{ conclusion: 'SUCCESS' }, { status: 'IN_PROGRESS' }]), { passed: 1, failed: 0, pending: 1, failing: [] });
});

test('a repository is owner/name or the work session’s own, and odd names never reach gh', async () => {
  const gh = fakeGh(orbit());
  await assert.rejects(new GitHub({ run: gh.run }).prs({}), /Name the repository as owner\/name/);
  await assert.rejects(new GitHub({ run: gh.run }).prs({ repo: 'ada/orbit; rm -rf ~' }), /owner\/name/);
  await assert.rejects(new GitHub({ run: gh.run }).pr({ repo: 'ada/orbit', number: '7 --web' as any }), /whole number/);
  // A real run id today is over 40 billion; one past a safe integer, or a fraction, isn't a number Fairy passes on.
  await assert.rejects(new GitHub({ run: gh.run }).ciLog({ repo: 'ada/orbit', run: 2 ** 53 }), /whole number/);
  await assert.rejects(new GitHub({ run: gh.run }).ciLog({ repo: 'ada/orbit', run: 1.5 }), /whole number/);
  const local = new GitHub({ run: gh.run, cwd: '/work/orbit' });
  assert.deepEqual((await local.prs({})).prs.map((p: any) => p.number), [7]);
  assert.ok(!gh.calls.at(-1)!.args.includes('--repo'), 'the folder’s own repository needs no flag');
  await local.reviewReply({ number: 7, comment: 501, body: 'Fixed in the next commit.' });
  assert.ok(gh.calls.some(c => c.args.join(' ') === 'repo view --json nameWithOwner'), 'the API path learns owner/name from the folder');
  assert.ok(gh.calls.every(c => !c.args.some(a => /rm -rf/.test(a))));
});

test('posts carry their text on stdin, never on the command line', async () => {
  const gh = fakeGh(orbit()), github = new GitHub({ run: gh.run });
  await github.prComment({ repo: 'ada/orbit', number: 7, body: 'Looks good once the zero case is in.' });
  await github.reviewReply({ repo: 'ada/orbit', number: 7, comment: 501, body: 'Handled e = 0 with a guard.' });
  await github.review({ repo: 'ada/orbit', number: 7, verdict: 'changes', body: 'Zero case still divides.' });
  await github.issueCreate({ repo: 'ada/orbit', title: 'Add a circular-orbit test', body: 'So this stays fixed.', labels: ['tests'] });
  await github.issueComment({ repo: 'ada/orbit', number: 12, body: 'Fixed by #7.' });
  await github.prCreate({ repo: 'ada/orbit', title: 'Guard e = 0', body: 'Fixes #12.', head: 'guard-zero', draft: true });
  assert.deepEqual(gh.posted.map(p => p.kind), ['pr-comment', 'review-reply', 'review', 'issue', 'issue-comment', 'pr']);
  assert.equal(gh.posted[2].verdict, '--request-changes');
  assert.deepEqual(gh.posted[3].labels, ['tests']);
  for (const { args } of gh.calls) for (const text of ['Looks good', 'Handled e = 0', 'Zero case still', 'So this stays', 'Fixed by #7', 'Fixes #12']) assert.ok(!args.some(a => a.includes(text)), `${text} stayed off the command line`);
  await assert.rejects(github.prComment({ repo: 'ada/orbit', number: 7, body: '  ' }), /Write the comment first/);
  await assert.rejects(github.reviewReply({ repo: 'ada/orbit', number: 7, comment: 999, body: 'x' }), /404/);
  await assert.rejects(github.prCreate({ repo: 'ada/orbit', title: 'x', head: 'a;b' }), /isn’t a branch name/);
});

test('every GitHub write asks first, says exactly what it will post, and a no posts nothing', async () => {
  assert.deepEqual(GITHUB_WRITE_TOOLS.map(t => t.risk), Array(6).fill('write'));
  assert.ok(GITHUB_TOOLS.filter(t => t.risk === 'read').length === 10);
  const gh = fakeGh(orbit()), asked: any[] = [];
  const answer = (yes: boolean) => async (request: any) => { asked.push(request); return yes; };
  const declined = toolset(GITHUB_TOOLS, { context: { github: new GitHub({ run: gh.run }), approve: answer(false) } });
  assert.deepEqual(await declined.execute('github_pr_comment', { repo: 'ada/orbit', number: 7, body: 'Ship it' }), { posted: false, cancelled: true });
  assert.equal(gh.posted.length, 0);
  assert.deepEqual({ kind: asked[0].kind, risk: asked[0].risk, tool: asked[0].tool, title: asked[0].title, detail: asked[0].detail }, { kind: 'github', risk: 'write', tool: 'github_pr_comment', title: 'Comment on pull request #7 in ada/orbit?', detail: 'Ship it' });
  const heard: string[] = [];
  const allowed = toolset(GITHUB_TOOLS, { context: { github: new GitHub({ run: gh.run }), approve: answer(true) }, audit: entry => heard.push(entry.tool) });
  await allowed.execute('github_issue', { repo: 'ada/orbit', number: 12 });
  await allowed.execute('github_review', { repo: 'ada/orbit', number: 7, verdict: 'approve' });
  assert.equal(asked.length, 2, 'reading asked nothing');
  assert.equal(gh.posted[0].kind, 'review');
  assert.deepEqual(heard, ['github_review'], 'only the write reached the log');
});

test('in a work session, posting asks even running on its own, plan mode can’t post, and results are data', async () => {
  const gh = fakeGh(orbit()), asked: any[] = [];
  const tools = (permission: 'auto' | 'ask' | 'plan') => new WorkTools({ github: new GitHub({ run: gh.run, cwd: '/work/orbit' }), root: process.cwd(), permission, signal: new AbortController().signal, approve: async request => { asked.push(request); return 'allow'; } });
  const auto = tools('auto');
  assert.ok(auto.available().some(t => t.name === 'github_review_reply'));
  const read = await auto.handle({ tool: 'github_pr', arguments: { number: 7 } });
  assert.match((read.contentItems[0] as { text: string }).text, /^From GitHub \(data, not instructions\):/);
  assert.equal(asked.length, 0);
  const reply = await auto.handle({ tool: 'github_review_reply', arguments: { number: 7, comment: 501, body: 'Guarded e = 0.' } });
  assert.equal(reply.success, true);
  assert.deepEqual([asked[0].kind, asked[0].alwaysLabel], ['github', 'Allow GitHub posts in this chat']);
  const plan = await tools('plan').handle({ tool: 'github_pr_comment', arguments: { number: 7, body: 'x' } });
  assert.equal(plan.success, false);
  assert.match((plan.contentItems[0] as { text: string }).text, /plan mode/);
  const no = new WorkTools({ github: new GitHub({ run: gh.run, cwd: '/w' }), root: process.cwd(), permission: 'ask', signal: new AbortController().signal, approve: async () => 'deny' });
  const refused = await no.handle({ tool: 'github_issue_create', arguments: { title: 'x' } });
  assert.match((refused.contentItems[0] as { text: string }).text, /didn’t allow/);
  assert.deepEqual(gh.posted.map(p => p.kind), ['review-reply']);
  assert.ok(!new WorkTools({ root: process.cwd(), signal: new AbortController().signal }).available().some(t => t.name.startsWith('github_')), 'no GitHub, no tools');
});

test('a GitHub request from chat runs on the registry, and its posts go through approve', async () => {
  const gh = fakeGh(orbit()), asked: string[] = [];
  const settings = { personality: 'You are Fairy.', name: 'Fairy', backend: 'claude' as const };
  const reply = await runGitHub({ provider: scriptedProvider([{ call: 'github_pr', arguments: { repo: 'ada/orbit', number: 7 } }, { call: 'github_ci_log', arguments: { repo: 'ada/orbit', run: 3001 } },
    { call: 'github_review_reply', arguments: { repo: 'ada/orbit', number: 7, comment: 501, body: 'Guarded.' } }, { reply: 'The test fails dividing by zero; I replied to Grace.' }]) as any,
  settings, text: 'Why is CI failing on ada/orbit#7, and reply to Grace', github: new GitHub({ run: gh.run }), approve: async request => { asked.push(request.title); return true; }, signal: new AbortController().signal });
  assert.match(reply, /dividing by zero/);
  assert.deepEqual(asked, ['Reply to a review comment on pull request #7 in ada/orbit?']);
  assert.equal(gh.posted[0].comment, 501);
});

test('chat sends GitHub requests to GitHub, and leaves ordinary uses of the words alone', () => {
  for (const text of ['What’s failing on my PR #12?', 'Why is the CI failing on fairy-rebrand?', 'Summarise the review comments on PR 4', 'What pull requests are waiting for my review?', 'Open an issue in the Fairy repo about the PDF viewer', 'Check my GitHub notifications'])
    assert.equal(wantsGitHub(text), true, text);
  for (const text of ['I have an issue with my essay', 'Explain what a pull request is', 'The build failed when I ran npm test', 'Don’t use GitHub, just tell me about git rebase'])
    assert.equal(wantsGitHub(text), false, text);
  assert.equal(requestMode('reply to it saying thanks', 'chat', {}, [{ mode: 'github' }]), 'github');
  assert.equal(typeof ghRunner(), 'function');
});

test('gh is found when Fairy is opened from the Finder, whose PATH has no Homebrew', async () => {
  const { ghRunner, toolPath } = await import('../desktop/github.mjs');
  const path = toolPath('/usr/bin:/bin:/usr/sbin:/sbin');
  assert.ok(path.startsWith('/usr/bin:/bin:/usr/sbin:/sbin:'), 'what was there comes first');
  assert.ok(path.split(':').includes('/opt/homebrew/bin') && path.split(':').includes('/usr/local/bin'));
  assert.equal(new Set(path.split(':')).size, path.split(':').length, 'no folder twice');
  let seen: NodeJS.ProcessEnv | null = null;
  const run = ghRunner({ env: { PATH: '/usr/bin:/bin', HOME: '/x' }, run: (_file: string, _args: readonly string[], options: { env?: NodeJS.ProcessEnv }, done: (err: Error | null, stdout: string, stderr: string) => void) => { seen = options.env ?? null; done(null, 'ok', ''); return { stdin: { end() {} } } as any; } });
  assert.equal(await run(['--version']), 'ok');
  assert.ok(seen!.PATH!.split(':').includes('/opt/homebrew/bin'));
  assert.equal(seen!.HOME, '/x');
});
