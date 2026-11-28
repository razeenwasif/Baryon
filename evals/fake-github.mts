import type { GhRunOptions, GhRunnerFn } from '../desktop/github.mjs';

export interface FakeGhReview {
  author: string;
  state: string;
  body: string;
}

export interface FakeGhConversationComment {
  author: string;
  body: string | null;
}

export interface FakeGhInlineComment {
  id: number;
  path: string;
  line: number;
  author: string;
  body: string;
  inReplyTo?: number | null;
}

export interface FakeGhCheck {
  name: string;
  conclusion: string;
  run: number;
}

export interface FakeGhPr {
  number: number;
  title: string | undefined;
  author: string;
  state: string;
  head: string;
  body?: string;
  updatedAt?: string;
  files?: string[];
  reviewDecision?: string;
  reviews?: FakeGhReview[];
  conversation?: FakeGhConversationComment[];
  inline?: FakeGhInlineComment[];
  checks?: FakeGhCheck[];
  diff?: string;
}

export interface FakeGhIssueComment {
  author: string;
  body: string | null;
}

export interface FakeGhIssue {
  number: number;
  title: string | undefined;
  author: string;
  body?: string;
  labels?: string[];
  comments?: FakeGhIssueComment[];
}

export interface FakeGhRun {
  name: string;
  conclusion: string;
  branch: string;
  log?: string;
}

export interface FakeGhWorld {
  repo?: string;
  description?: string;
  status?: string;
  viewer?: string;
  prs?: FakeGhPr[];
  issues?: FakeGhIssue[];
  runs?: Record<string, FakeGhRun>;
}

export interface FakeGhCall {
  args: readonly string[];
  input: string | null;
}

export interface FakeGhPosted {
  kind: 'pr-comment' | 'review' | 'pr' | 'issue' | 'issue-comment' | 'review-reply';
  number?: number;
  verdict?: string;
  title?: string;
  body: string | null;
  labels?: Array<string | undefined>;
  comment?: number;
}

export interface FakeGh {
  run: GhRunnerFn;
  calls: FakeGhCall[];
  posted: FakeGhPosted[];
  repo: string;
}

// gh, as far as Fairy's GitHub code runs it, answered from a made-up repository kept in memory. Fairy's real GitHub
// class runs on top, so its commands and the way it reads their answers are what's under test, and nothing reaches
// GitHub. Every command is recorded, and every post lands in `posted`.
export function fakeGh(world: FakeGhWorld = {}): FakeGh {
  const repo = world.repo || 'ada/orbit', prs = world.prs || [], issues = world.issues || [], runs = world.runs || {};
  const calls: FakeGhCall[] = [], posted: FakeGhPosted[] = [];
  const flag = (args: readonly string[], name: string): string | undefined => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const json = (value: unknown): string => JSON.stringify(value);
  const fail = (message: string): Promise<never> => Promise.reject(new Error(message));
  const run: GhRunnerFn = async (args: readonly string[], { input = null }: GhRunOptions = {}): Promise<string> => {
    calls.push({ args, input });
    const target = flag(args, '--repo') || repo;
    if (target !== repo && args[0] !== 'search' && args[0] !== 'repo') return fail(`GraphQL: Could not resolve to a Repository with the name '${target}'.`);
    const [area, verb] = args;
    if (area === 'status') return world.status || `Review Requests\n${repo}#${prs[0]?.number} ${prs[0]?.title}\n`;
    if (area === 'repo' && verb === 'list') return json([{ nameWithOwner: repo, description: world.description || '', updatedAt: '2026-11-09T00:00:00Z', visibility: 'PUBLIC', isFork: false, isArchived: false, url: `https://github.com/${repo}` }]);
    if (area === 'repo' && verb === 'view') return json({ nameWithOwner: repo });
    const pr = (n: string | undefined): FakeGhPr | undefined => prs.find(p => p.number === Number(n));
    if (area === 'pr' && verb === 'list') return json(prs.filter(p => (flag(args, '--state') || 'open') === 'all' || p.state.toLowerCase() === (flag(args, '--state') || 'open')).map(p => ({ number: p.number, title: p.title, author: { login: p.author }, state: p.state, isDraft: false, updatedAt: p.updatedAt || '2026-11-08T00:00:00Z', headRefName: p.head, baseRefName: 'main', reviewDecision: p.reviewDecision || '', url: `https://github.com/${repo}/pull/${p.number}` })));
    if (area === 'pr' && verb === 'view') {
      const p = pr(args[2]); if (!p) return fail(`no pull requests found for ${args[2]}`);
      return json({ number: p.number, title: p.title, body: p.body || '', author: { login: p.author }, state: p.state, isDraft: false, baseRefName: 'main', headRefName: p.head, additions: 10, deletions: 2, changedFiles: (p.files || []).length,
        files: (p.files || []).map(path => ({ path, additions: 5, deletions: 1 })), reviewDecision: p.reviewDecision || '', reviews: (p.reviews || []).map(r => ({ author: { login: r.author }, state: r.state, body: r.body, submittedAt: '2026-11-08T01:00:00Z' })),
        comments: (p.conversation || []).map(c => ({ author: { login: c.author }, body: c.body, createdAt: '2026-11-08T02:00:00Z' })),
        statusCheckRollup: (p.checks || []).map(c => ({ name: c.name, conclusion: c.conclusion, detailsUrl: `https://github.com/${repo}/actions/runs/${c.run}/job/1` })), url: `https://github.com/${repo}/pull/${p.number}`, mergeable: 'MERGEABLE' });
    }
    if (area === 'pr' && verb === 'diff') { const p = pr(args[2]); return p?.diff || ''; }
    if (area === 'pr' && verb === 'checks') { const p = pr(args[2]); return json((p?.checks || []).map(c => ({ name: c.name, state: c.conclusion, bucket: c.conclusion === 'SUCCESS' ? 'pass' : 'fail', link: `https://github.com/${repo}/actions/runs/${c.run}/job/1`, workflow: 'CI', description: '' }))); }
    if (area === 'pr' && (verb === 'comment' || verb === 'review')) {
      const verdictFlag = ['--approve', '--request-changes', '--comment'].find(f => args.includes(f));
      posted.push({ kind: verb === 'comment' ? 'pr-comment' : 'review', number: Number(args[2]), verdict: verdictFlag, body: input });
      const p = pr(args[2]);
      if (p && verb === 'comment') (p.conversation ||= []).push({ author: world.viewer || 'you', body: input });
      if (p && verb === 'review') (p.reviews ||= []).push({ author: world.viewer || 'you', state: verdictFlag === '--approve' ? 'APPROVED' : verdictFlag === '--request-changes' ? 'CHANGES_REQUESTED' : 'COMMENTED', body: input || '' });
      return `https://github.com/${repo}/pull/${args[2]}#issuecomment-1\n`;
    }
    if (area === 'pr' && verb === 'create') {
      const title = flag(args, '--title');
      posted.push({ kind: 'pr', title, body: input });
      prs.push({ number: 99, title, author: world.viewer || 'you', state: 'OPEN', head: flag(args, '--head') || 'branch', body: input || '' });
      return `https://github.com/${repo}/pull/99\n`;
    }
    if (area === 'run' && verb === 'list') return json(Object.entries(runs).map(([id, r]) => ({ databaseId: Number(id), name: r.name, workflowName: 'CI', status: 'completed', conclusion: r.conclusion, headBranch: r.branch, headSha: 'abc123', event: 'pull_request', createdAt: '2026-11-08T03:00:00Z', url: `https://github.com/${repo}/actions/runs/${id}` })));
    if (area === 'run' && verb === 'view') return runs[args[2]]?.log ?? '';
    if (area === 'issue' && verb === 'list') return json(issues.map(i => ({ number: i.number, title: i.title, state: 'OPEN', author: { login: i.author }, labels: (i.labels || []).map(name => ({ name })), updatedAt: '2026-11-08T00:00:00Z', url: `https://github.com/${repo}/issues/${i.number}` })));
    if (area === 'issue' && verb === 'view') { const i = issues.find(x => x.number === Number(args[2])); if (!i) return fail('issue not found'); return json({ number: i.number, title: i.title, body: i.body, state: 'OPEN', author: { login: i.author }, labels: [], assignees: [], comments: (i.comments || []).map(c => ({ author: { login: c.author }, body: c.body, createdAt: '2026-11-08T00:00:00Z' })), url: `https://github.com/${repo}/issues/${i.number}`, createdAt: '2026-11-07T00:00:00Z' }); }
    if (area === 'issue' && verb === 'create') {
      const title = flag(args, '--title');
      posted.push({ kind: 'issue', title, body: input, labels: args.flatMap((a, i) => (a === '--label' ? [args[i + 1]] : [])) });
      issues.push({ number: 42, title, author: world.viewer || 'you', body: input || '', comments: [] });
      return `https://github.com/${repo}/issues/42\n`;
    }
    if (area === 'issue' && verb === 'comment') {
      posted.push({ kind: 'issue-comment', number: Number(args[2]), body: input });
      const i = issues.find(x => x.number === Number(args[2]));
      if (i) (i.comments ||= []).push({ author: world.viewer || 'you', body: input });
      return `https://github.com/${repo}/issues/${args[2]}#issuecomment-2\n`;
    }
    if (area === 'search') return json([]);
    if (area === 'api') {
      const path = args.find(a => a.startsWith('repos/')), post = args.includes('POST');
      const [, n, comment] = /pulls\/(\d+)\/comments(?:\/(\d+)\/replies)?/.exec(path || '') || [];
      if (!post) return json((pr(n)?.inline || []).map(c => ({ id: c.id, path: c.path, line: c.line, user: { login: c.author }, body: c.body, in_reply_to_id: c.inReplyTo ?? null, created_at: '2026-11-08T04:00:00Z' })));
      if (!(pr(n)?.inline || []).some(c => c.id === Number(comment))) return fail('HTTP 404: Not Found');
      const body = (JSON.parse(input as string) as { body: string }).body;
      posted.push({ kind: 'review-reply', number: Number(n), comment: Number(comment), body });
      const p = pr(n);
      if (p) (p.inline ||= []).push({ id: 900, path: p.inline[0]?.path || '', line: p.inline[0]?.line || 1, author: world.viewer || 'you', body, inReplyTo: Number(comment) });
      return json({ id: 900, html_url: `https://github.com/${repo}/pull/${n}#discussion_r900` });
    }
    return fail(`fake gh doesn't know: ${args.join(' ')}`);
  };
  return { run, calls, posted, repo };
}
