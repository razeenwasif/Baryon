import { defineTool, type ToolDefinition, type ToolScope } from './tool-registry.mjs';

export interface NeutrinoApprovalRequest {
  tool: string;
  title: string;
  detail: string;
  allowLabel: string;
  denyLabel: string;
  kind?: 'neutrino';
  risk?: 'write';
}

export type NeutrinoApproveFn = (request: NeutrinoApprovalRequest & { kind: 'neutrino'; risk: 'write' }) => Promise<unknown> | unknown;

export interface NeutrinoClient {
  status: () => Promise<unknown> | unknown;
  repos: (args: Record<string, unknown>) => Promise<unknown> | unknown;
  repoOverview: (args: Record<string, unknown>) => Promise<unknown> | unknown;
  prs: (args: Record<string, unknown>) => Promise<unknown> | unknown;
  pr: (args: Record<string, unknown>) => Promise<unknown> | unknown;
  prDiff: (args: Record<string, unknown>) => Promise<unknown> | unknown;
  runs: (args: Record<string, unknown>) => Promise<unknown> | unknown;
  run: (args: Record<string, unknown>) => Promise<unknown> | unknown;
  ciLog: (args: Record<string, unknown>) => Promise<unknown> | unknown;
  workflows: (args: Record<string, unknown>) => Promise<unknown> | unknown;
  mirrors: () => Promise<unknown> | unknown;
  rules: (args: Record<string, unknown>) => Promise<unknown> | unknown;
  secrets: (args: { repo: unknown; environment: unknown }) => Promise<{ secrets: unknown }>;
  variables: (args: { repo: unknown; environment: unknown }) => Promise<{ variables: unknown }>;
  environments: (args: { repo: unknown }) => Promise<{ environments: unknown }>;
  prCreate: (args: Record<string, unknown>) => Promise<unknown> | unknown;
  prNote: (args: Record<string, unknown>) => Promise<unknown> | unknown;
  prResolveNote: (args: Record<string, unknown>) => Promise<unknown> | unknown;
  prUpdate: (args: Record<string, unknown>) => Promise<unknown> | unknown;
  prMerge: (args: Record<string, unknown>) => Promise<unknown> | unknown;
  runStart: (args: Record<string, unknown>) => Promise<unknown> | unknown;
  runRerun: (args: Record<string, unknown>) => Promise<unknown> | unknown;
  runCancel: (args: Record<string, unknown>) => Promise<unknown> | unknown;
  jobApprove: (args: Record<string, unknown>) => Promise<unknown> | unknown;
  mirrorNow: (args: Record<string, unknown>) => Promise<unknown> | unknown;
  createHosted: (args: Record<string, unknown>) => Promise<unknown> | unknown;
  backupNow: () => Promise<unknown> | unknown;
}

interface NeutrinoScope {
  neutrino: NeutrinoClient;
  approve: NeutrinoApproveFn;
}

const ctx = (scope: ToolScope): NeutrinoScope => scope as unknown as NeutrinoScope;

// Fairy's Neutrino tools, for plain chat and work sessions alike. Each talks to ~/.neutrino/neutrinod.sock
// (directly on the server Mac, or over SSH from a workstation). Reading needs no OK; every write/action
// shows exactly what it will do, and where, and waits for the user's approval first.
const string = { type: 'string' }, integer = { type: 'integer' }, boolean = { type: 'boolean' };
const repo = { type: 'string', description: 'Neutrino repository id or name (e.g. "fairy", "neutrino"). Leave it out in a work session to mean this project folder’s own repository.' };
const asked = async (approve: NeutrinoApproveFn, request: NeutrinoApprovalRequest): Promise<boolean> =>
  (await approve({ kind: 'neutrino', risk: 'write', ...request })) === true;

export const NEUTRINO_READ_TOOLS: ToolDefinition[] = [
  defineTool({ name: 'neutrino_status', description: 'Overview of the Neutrino server and scheduler: daemon version/role, Graviton CI capacity, deploy jobs waiting for approval, pull requests ready to merge, open pull requests, recent runs, and any failing GitHub mirrors.',
    run: (_args, scope) => ctx(scope).neutrino.status() }),
  defineTool({ name: 'neutrino_repos', description: 'List repositories in Neutrino. Hosted server repositories (default, with GitHub mirror status and head branches) or workstation working copies (kind: "workstation"). Filter with query.',
    properties: { kind: { type: 'string', enum: ['server', 'workstation'] }, query: string, limit: integer },
    run: (args, scope) => ctx(scope).neutrino.repos(args) }),
  defineTool({ name: 'neutrino_repo', description: 'Full overview of one hosted Neutrino repository: commit/file stats, languages, branches, open pull requests, recent CI runs, branch protection rules, deploy environments, and mirror status.',
    properties: { repo }, run: (args, scope) => ctx(scope).neutrino.repoOverview(args) }),
  defineTool({ name: 'neutrino_prs', description: 'Pull requests in a Neutrino repository (open by default, or closed, merged, or all).',
    properties: { repo, state: { type: 'string', enum: ['open', 'closed', 'merged', 'all'] }, limit: integer },
    run: (args, scope) => ctx(scope).neutrino.prs(args) }),
  defineTool({ name: 'neutrino_pr', description: 'One Neutrino pull request in full: description, mergeability/conflicts, changed files, inline review notes (with note ids and resolved flags), commits, guarding branch rule, and latest CI check runs.',
    properties: { repo, number: integer }, required: ['number'],
    run: (args, scope) => ctx(scope).neutrino.pr(args) }),
  defineTool({ name: 'neutrino_pr_diff', description: 'Unified diff for a Neutrino pull request, or a single changed file with path.',
    properties: { repo, number: integer, path: string }, required: ['number'],
    run: (args, scope) => ctx(scope).neutrino.prDiff(args) }),
  defineTool({ name: 'neutrino_runs', description: 'Recent Graviton/Neutrino CI workflow runs in a repository, optionally filtered by pull request number or branch.',
    properties: { repo, pull: integer, branch: string, limit: integer },
    run: (args, scope) => ctx(scope).neutrino.runs(args) }),
  defineTool({ name: 'neutrino_run', description: 'Full detail of one Neutrino CI run by its run id: jobs, executors (graviton/host/nexus), steps, exit codes, deploy environment approvals, and warnings.',
    properties: { repo, id: integer }, required: ['id'],
    run: (args, scope) => ctx(scope).neutrino.run(args) }),
  defineTool({ name: 'neutrino_ci_log', description: 'Read the log output of a Neutrino CI run (defaults to its failing, waiting, or latest job if job is omitted).',
    properties: { repo, run: integer, job: integer }, required: ['run'],
    run: (args, scope) => ctx(scope).neutrino.ciLog(args) }),
  defineTool({ name: 'neutrino_workflows', description: 'Inspect and syntax-check `.neutrino/workflows/` files and triggers on a branch.',
    properties: { repo, branch: string },
    run: (args, scope) => ctx(scope).neutrino.workflows(args) }),
  defineTool({ name: 'neutrino_mirrors', description: 'GitHub mirror status across all hosted Neutrino repositories (ok, pending, failing, last error, and mirror-only refs).',
    run: (_args, scope) => ctx(scope).neutrino.mirrors() }),
  defineTool({ name: 'neutrino_rules', description: 'Branch protection rules (`require_pull`, `block_force`, `block_delete`, required checks) and recent rule overrides for a repository.',
    properties: { repo }, run: (args, scope) => ctx(scope).neutrino.rules(args) }),
  defineTool({ name: 'neutrino_vault', description: 'List Neutrino Vault secret names and scopes (secret values are never readable), variables, and deploy environments.',
    properties: { repo, environment: string },
    run: async (args = {}, scope) => {
      const { repo: r = '', environment = '' } = args as { repo?: unknown; environment?: unknown };
      const { neutrino } = ctx(scope);
      const [secrets, variables, environments] = await Promise.all([
        neutrino.secrets({ repo: r, environment }),
        neutrino.variables({ repo: r, environment }),
        r ? neutrino.environments({ repo: r }) : Promise.resolve({ environments: [] }),
      ]);
      return { secrets: secrets.secrets, variables: variables.variables, environments: environments.environments };
    } }),
];

export const NEUTRINO_WRITE_TOOLS: ToolDefinition[] = [
  defineTool({ name: 'neutrino_pr_create', description: 'Open a new pull request on Neutrino from a pushed source branch into target. Shows the title, branches, and description first.',
    properties: { repo, title: string, body: string, source: string, target: string }, required: ['title'], risk: 'write',
    async run(args, scope) {
      const { neutrino, approve } = ctx(scope);
      const targetRepo = (args.repo as string | undefined) || '';
      const branches = `\n\n${args.source || 'current branch'} → ${args.target || 'default branch'}`;
      if (!await asked(approve, { tool: 'neutrino_pr_create', title: `Open a Neutrino pull request${targetRepo ? ` in ${targetRepo}` : ''}?`, detail: `${args.title}${branches}${args.body ? `\n\n${args.body}` : ''}`, allowLabel: 'Open pull request', denyLabel: 'Cancel' })) return { created: false, cancelled: true };
      return neutrino.prCreate(args);
    } }),
  defineTool({ name: 'neutrino_pr_note', description: 'Add a line-level review note on a Neutrino pull request diff. Shows the file, line, and note first.',
    properties: { repo, number: integer, path: string, side: { type: 'string', enum: ['new', 'old'] }, line: integer, text: string }, required: ['number', 'path', 'line', 'text'], risk: 'write',
    async run(args, scope) {
      const { neutrino, approve } = ctx(scope);
      if (!await asked(approve, { tool: 'neutrino_pr_note', title: `Add a review note on #${args.number}${args.repo ? ` in ${args.repo}` : ''}?`, detail: `${args.path}:${args.line} (${args.side || 'new'})\n\n${args.text}`, allowLabel: 'Add note', denyLabel: 'Cancel' })) return { posted: false, cancelled: true };
      return neutrino.prNote(args);
    } }),
  defineTool({ name: 'neutrino_pr_resolve_note', description: 'Mark a pull request review note resolved or unresolved by note id from neutrino_pr.',
    properties: { repo, number: integer, note: integer, resolved: boolean }, required: ['number', 'note'], risk: 'write',
    async run(args, scope) {
      const { neutrino, approve } = ctx(scope);
      const resolve = args.resolved !== false;
      if (!await asked(approve, { tool: 'neutrino_pr_resolve_note', title: `${resolve ? 'Resolve' : 'Reopen'} review note #${args.note} on PR #${args.number}?`, detail: args.repo ? `Repository: ${args.repo}` : 'Current repository', allowLabel: resolve ? 'Resolve note' : 'Reopen note', denyLabel: 'Cancel' })) return { updated: false, cancelled: true };
      return neutrino.prResolveNote(args);
    } }),
  defineTool({ name: 'neutrino_pr_update', description: 'Close, reopen, or update the title or description of a Neutrino pull request. Asks the user first.',
    properties: { repo, number: integer, state: { type: 'string', enum: ['open', 'closed'] }, title: string, body: string }, required: ['number'], risk: 'write',
    async run(args, scope) {
      const { neutrino, approve } = ctx(scope);
      const verb = args.state === 'closed' ? 'Close' : args.state === 'open' ? 'Reopen' : 'Update';
      const detail = [args.title ? `Title: ${args.title}` : '', args.state ? `State: ${args.state}` : '', args.body ? String(args.body) : ''].filter(Boolean).join('\n\n') || `Pull request #${args.number}`;
      if (!await asked(approve, { tool: 'neutrino_pr_update', title: `${verb} Neutrino pull request #${args.number}${args.repo ? ` in ${args.repo}` : ''}?`, detail, allowLabel: `${verb} PR`, denyLabel: 'Cancel' })) return { updated: false, cancelled: true };
      return neutrino.prUpdate(args);
    } }),
  defineTool({ name: 'neutrino_pr_merge', description: 'Merge a Neutrino pull request using merge, squash, rebase, or fast_forward. Optionally delete the source branch. Shows details first.',
    properties: { repo, number: integer, strategy: { type: 'string', enum: ['merge', 'squash', 'rebase', 'fast_forward'] }, message: string, delete_source: boolean }, required: ['number'], risk: 'write',
    async run(args, scope) {
      const { neutrino, approve } = ctx(scope);
      const strategy = (args.strategy as string | undefined) || 'merge';
      const detail = [`Strategy: ${strategy}`, args.delete_source ? 'Will delete source branch after merge.' : '', args.message ? `Message: ${args.message}` : ''].filter(Boolean).join('\n');
      if (!await asked(approve, { tool: 'neutrino_pr_merge', title: `Merge Neutrino PR #${args.number}${args.repo ? ` in ${args.repo}` : ''}?`, detail, allowLabel: 'Merge PR', denyLabel: 'Cancel' })) return { merged: false, cancelled: true };
      return neutrino.prMerge({ repo: args.repo, number: args.number, strategy, message: args.message, deleteSource: args.delete_source === true });
    } }),
  defineTool({ name: 'neutrino_run_start', description: 'Dispatch a `workflow_dispatch` CI workflow on a branch in Neutrino. Asks the user first.',
    properties: { repo, workflow: string, branch: string }, required: ['workflow', 'branch'], risk: 'write',
    async run(args, scope) {
      const { neutrino, approve } = ctx(scope);
      if (!await asked(approve, { tool: 'neutrino_run_start', title: `Start Neutrino workflow “${args.workflow}” on ${args.branch}?`, detail: args.repo ? `Repository: ${args.repo}` : 'Current repository', allowLabel: 'Start run', denyLabel: 'Cancel' })) return { started: false, cancelled: true };
      return neutrino.runStart(args);
    } }),
  defineTool({ name: 'neutrino_run_rerun', description: 'Rerun an existing Neutrino CI run on the same commit. Asks the user first.',
    properties: { repo, id: integer }, required: ['id'], risk: 'write',
    async run(args, scope) {
      const { neutrino, approve } = ctx(scope);
      if (!await asked(approve, { tool: 'neutrino_run_rerun', title: `Rerun Neutrino CI run #${args.id}${args.repo ? ` in ${args.repo}` : ''}?`, detail: 'Runs the same workflow on the same commit.', allowLabel: 'Rerun', denyLabel: 'Cancel' })) return { rerun: false, cancelled: true };
      return neutrino.runRerun(args);
    } }),
  defineTool({ name: 'neutrino_run_cancel', description: 'Cancel an active or queued Neutrino CI run. Asks the user first.',
    properties: { repo, id: integer }, required: ['id'], risk: 'write',
    async run(args, scope) {
      const { neutrino, approve } = ctx(scope);
      if (!await asked(approve, { tool: 'neutrino_run_cancel', title: `Cancel Neutrino CI run #${args.id}${args.repo ? ` in ${args.repo}` : ''}?`, detail: 'Stops running and queued jobs in this run.', allowLabel: 'Cancel run', denyLabel: 'Keep running' })) return { cancelledRun: false, cancelled: true };
      return neutrino.runCancel(args);
    } }),
  defineTool({ name: 'neutrino_job_approve', description: 'Approve or reject a Neutrino deploy job waiting on an environment gate. Always shows the repo and job first.',
    properties: { repo, job: integer, approve: boolean }, required: ['job'], risk: 'write',
    async run(args, scope) {
      const { neutrino, approve } = ctx(scope);
      const ok = args.approve !== false;
      if (!await asked(approve, { tool: 'neutrino_job_approve', title: `${ok ? 'Approve' : 'Reject'} Neutrino deploy job #${args.job}${args.repo ? ` in ${args.repo}` : ''}?`, detail: ok ? 'Allows this deployment job to run with its environment secrets.' : 'Declines the waiting deployment job.', allowLabel: ok ? 'Approve deploy' : 'Reject deploy', denyLabel: 'Cancel' })) return { approved: false, cancelled: true };
      return neutrino.jobApprove({ repo: args.repo, job: args.job, approve: ok });
    } }),
  defineTool({ name: 'neutrino_mirror_now', description: 'Sync a hosted Neutrino repository to its GitHub mirror now. Asks the user first.',
    properties: { repo }, risk: 'write',
    async run(args, scope) {
      const { neutrino, approve } = ctx(scope);
      if (!await asked(approve, { tool: 'neutrino_mirror_now', title: `Sync Neutrino mirror to GitHub${args.repo ? ` for ${args.repo}` : ''}?`, detail: 'Copies hosted branches and tags to its configured GitHub mirror now.', allowLabel: 'Sync mirror', denyLabel: 'Cancel' })) return { mirrored: false, cancelled: true };
      return neutrino.mirrorNow(args);
    } }),
  defineTool({ name: 'neutrino_create_repo', description: 'Create a new hosted bare repository on the Neutrino server. Asks the user first.',
    properties: { name: string, description: string }, required: ['name'], risk: 'write',
    async run(args, scope) {
      const { neutrino, approve } = ctx(scope);
      if (!await asked(approve, { tool: 'neutrino_create_repo', title: `Create hosted Neutrino repo “${args.name}”?`, detail: (args.description as string | undefined) || 'Creates a new bare git repository on the Neutrino server.', allowLabel: 'Create repo', denyLabel: 'Cancel' })) return { created: false, cancelled: true };
      return neutrino.createHosted(args);
    } }),
  defineTool({ name: 'neutrino_backup', description: 'Take a snapshot backup of the Neutrino server database now. Asks the user first.',
    risk: 'write',
    async run(_args, scope) {
      const { neutrino, approve } = ctx(scope);
      if (!await asked(approve, { tool: 'neutrino_backup', title: 'Take a Neutrino database snapshot now?', detail: 'Creates a fresh SQLite snapshot on the Neutrino server.', allowLabel: 'Back up now', denyLabel: 'Cancel' })) return { backedUp: false, cancelled: true };
      return neutrino.backupNow();
    } }),
];

export const NEUTRINO_TOOLS: ToolDefinition[] = [...NEUTRINO_READ_TOOLS, ...NEUTRINO_WRITE_TOOLS];
export const NEUTRINO_TOOL_NAMES: Set<string> = new Set(NEUTRINO_TOOLS.map(tool => tool.name));
