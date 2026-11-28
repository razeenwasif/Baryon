import { defineTool, type ToolScope } from './tool-registry.mjs';
import type { GitHub } from './github.mjs';

export interface GitHubApprovalRequest {
  tool: string;
  title: string;
  detail: string;
  allowLabel: string;
  denyLabel: string;
  [key: string]: unknown;
}

export type GitHubApproveFn = (request: { kind: 'github'; risk: 'write' } & GitHubApprovalRequest) => Promise<boolean> | boolean;

// Fairy's GitHub tools, for plain chat and work sessions alike. Each runs against the GitHub in the request's context
// (desktop/github.mjs, on your gh sign-in). Reading needs no OK; every write shows exactly what it will post, and where,
// and asks first through approve(), the same approval card Calendar and Drive use, or a work session's own.
const string = { type: 'string' }, integer = { type: 'integer' };
const repo = { type: 'string', description: 'owner/name. Leave it out in a work session to mean the project folder’s own repository.' };
const asked = async (approve: GitHubApproveFn, request: GitHubApprovalRequest): Promise<boolean> =>
  (await approve({ kind: 'github', risk: 'write', ...request })) === true;
const gh = (scope: ToolScope): GitHub => scope.github as unknown as GitHub;

export const GITHUB_READ_TOOLS = [
  defineTool({
    name: 'github_status',
    description: 'What is waiting for the user across GitHub: assigned issues and pull requests, review requests, mentions, and recent activity in their repositories.',
    run: (_args, scope) => gh(scope).status(),
  }),
  defineTool({
    name: 'github_repos',
    description: 'The user’s repositories, most recently updated first, or another account’s with owner.',
    properties: { owner: string, limit: integer },
    run: (args, scope) => gh(scope).repos(args),
  }),
  defineTool({
    name: 'github_prs',
    description: 'Pull requests in a repository: open by default, or closed, merged or all; search takes GitHub’s search syntax, such as author:@me or review-requested:@me.',
    properties: { repo, state: { type: 'string', enum: ['open', 'closed', 'merged', 'all'] }, search: string, limit: integer },
    run: (args, scope) => gh(scope).prs(args),
  }),
  defineTool({
    name: 'github_pr',
    description: 'One pull request in full: its description, changed files, reviews, conversation, inline review comments (with the id a reply needs) and a summary of its checks, with the run id of each failing one.',
    properties: { repo, number: integer },
    required: ['number'],
    run: (args, scope) => gh(scope).pr(args),
  }),
  defineTool({
    name: 'github_pr_diff',
    description: 'A pull request’s diff, or just one file’s with path. Long diffs are cut; ask for a file at a time.',
    properties: { repo, number: integer, path: string },
    required: ['number'],
    run: (args, scope) => gh(scope).prDiff(args),
  }),
  defineTool({
    name: 'github_checks',
    description: 'A pull request’s checks with number, or a branch’s latest workflow runs with branch: each with its state and the run id its failing log is read by.',
    properties: { repo, number: integer, branch: string },
    run: (args, scope) => gh(scope).checks(args),
  }),
  defineTool({
    name: 'github_ci_log',
    description: 'The log of a workflow run’s failed steps, its end, where the failure is. Take run from github_checks or github_pr.',
    properties: { repo, run: integer },
    required: ['run'],
    run: (args, scope) => gh(scope).ciLog(args),
  }),
  defineTool({
    name: 'github_issues',
    description: 'Issues in a repository: open by default, or closed or all, with GitHub search syntax and labels to narrow them.',
    properties: { repo, state: { type: 'string', enum: ['open', 'closed', 'all'] }, search: string, labels: { type: 'array', items: string, maxItems: 5 }, limit: integer },
    run: (args, scope) => gh(scope).issues(args),
  }),
  defineTool({
    name: 'github_issue',
    description: 'One issue in full, with its comments.',
    properties: { repo, number: integer },
    required: ['number'],
    run: (args, scope) => gh(scope).issue(args),
  }),
  defineTool({
    name: 'github_search',
    description: 'Search GitHub for code, issues, prs or repos, across GitHub or in one repository.',
    properties: { kind: { type: 'string', enum: ['code', 'issues', 'prs', 'repos'] }, query: string, repo: string, limit: integer },
    required: ['query'],
    run: (args, scope) => gh(scope).search(args),
  }),
];

export const GITHUB_WRITE_TOOLS = [
  defineTool({
    name: 'github_pr_comment',
    description: 'Post a comment on a pull request’s conversation, under the user’s name. Shows the user exactly what will be posted first.',
    properties: { repo, number: integer, body: string },
    required: ['number', 'body'],
    risk: 'write',
    async run(args, scope) {
      const approve = scope.approve as GitHubApproveFn;
      if (!await asked(approve, { tool: 'github_pr_comment', title: `Comment on pull request #${args.number}${args.repo ? ` in ${args.repo}` : ''}?`, detail: args.body as string, allowLabel: 'Post comment', denyLabel: 'Cancel' })) return { posted: false, cancelled: true };
      return gh(scope).prComment(args);
    },
  }),
  defineTool({
    name: 'github_review_reply',
    description: 'Reply in the thread of one inline review comment on a pull request, by the comment’s id from github_pr. Shows the user the reply first.',
    properties: { repo, number: integer, comment: integer, body: string },
    required: ['number', 'comment', 'body'],
    risk: 'write',
    async run(args, scope) {
      const approve = scope.approve as GitHubApproveFn;
      if (!await asked(approve, { tool: 'github_review_reply', title: `Reply to a review comment on pull request #${args.number}${args.repo ? ` in ${args.repo}` : ''}?`, detail: args.body as string, allowLabel: 'Post reply', denyLabel: 'Cancel' })) return { posted: false, cancelled: true };
      return gh(scope).reviewReply(args);
    },
  }),
  defineTool({
    name: 'github_review',
    description: 'Submit a review of a pull request: comment, approve, or request changes, with a summary. Shows the user the review first.',
    properties: { repo, number: integer, verdict: { type: 'string', enum: ['comment', 'approve', 'changes'] }, body: string },
    required: ['number', 'verdict'],
    risk: 'write',
    async run(args, scope) {
      const approve = scope.approve as GitHubApproveFn;
      const labels: Record<string, string> = { comment: 'Comment on', approve: 'Approve', changes: 'Request changes on' };
      const said = labels[args.verdict as string] || 'Review';
      if (!await asked(approve, { tool: 'github_review', title: `${said} pull request #${args.number}${args.repo ? ` in ${args.repo}` : ''}?`, detail: (args.body as string) || '(No summary.)', allowLabel: 'Submit review', denyLabel: 'Cancel' })) return { posted: false, cancelled: true };
      return gh(scope).review(args);
    },
  }),
  defineTool({
    name: 'github_issue_create',
    description: 'Open a new issue in a repository. Shows the user the title and description first.',
    properties: { repo, title: string, body: string, labels: { type: 'array', items: string, maxItems: 5 } },
    required: ['title'],
    risk: 'write',
    async run(args, scope) {
      const approve = scope.approve as GitHubApproveFn;
      const labels = args.labels as string[] | undefined;
      if (!await asked(approve, { tool: 'github_issue_create', title: `Open an issue${args.repo ? ` in ${args.repo}` : ''}?`, detail: `${args.title}\n\n${args.body || ''}${labels?.length ? `\n\nLabels: ${labels.join(', ')}` : ''}`.trim(), allowLabel: 'Open issue', denyLabel: 'Cancel' })) return { created: false, cancelled: true };
      return gh(scope).issueCreate(args);
    },
  }),
  defineTool({
    name: 'github_issue_comment',
    description: 'Post a comment on an issue, under the user’s name. Shows the user the comment first.',
    properties: { repo, number: integer, body: string },
    required: ['number', 'body'],
    risk: 'write',
    async run(args, scope) {
      const approve = scope.approve as GitHubApproveFn;
      if (!await asked(approve, { tool: 'github_issue_comment', title: `Comment on issue #${args.number}${args.repo ? ` in ${args.repo}` : ''}?`, detail: args.body as string, allowLabel: 'Post comment', denyLabel: 'Cancel' })) return { posted: false, cancelled: true };
      return gh(scope).issueComment(args);
    },
  }),
  defineTool({
    name: 'github_pr_create',
    description: 'Open a pull request from a branch already pushed to GitHub. Shows the user the title, branches and description first. It doesn’t push.',
    properties: { repo, title: string, body: string, base: string, head: string, draft: { type: 'boolean' } },
    required: ['title'],
    risk: 'write',
    async run(args, scope) {
      const approve = scope.approve as GitHubApproveFn;
      const branches = args.head || args.base ? `\n\n${args.head || 'this branch'} → ${args.base || 'the default branch'}` : '';
      if (!await asked(approve, { tool: 'github_pr_create', title: `Open a${args.draft ? ' draft' : ''} pull request${args.repo ? ` in ${args.repo}` : ''}?`, detail: `${args.title}${branches}\n\n${args.body || ''}`.trim(), allowLabel: 'Open pull request', denyLabel: 'Cancel' })) return { created: false, cancelled: true };
      return gh(scope).prCreate(args);
    },
  }),
];

export const GITHUB_TOOLS = [...GITHUB_READ_TOOLS, ...GITHUB_WRITE_TOOLS];
export const GITHUB_TOOL_NAMES = new Set(GITHUB_TOOLS.map(tool => tool.name));
