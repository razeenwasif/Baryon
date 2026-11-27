import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { commandPath } from './work-sandbox.mjs';

// GitHub through the gh CLI you're signed into, so Fairy holds no token of its own. A repository is owner/name, or
// the work session's folder when it's a clone. Everything read from GitHub is someone's writing, so it comes back as
// data with its size bounded; nothing here posts anything unless a write is called, and the tools around it ask first.
export const LIMITS = { body: 12000, log: 24000, diff: 60000, status: 12000, list: 50, comments: 60 };
const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const clip = (text, limit) => { const value = String(text ?? ''); return value.length > limit ? { text: value.slice(0, limit), truncated: true } : { text: value, truncated: false }; };
const tail = (text, limit) => { const value = String(text ?? ''); return value.length > limit ? { text: value.slice(-limit), truncated: true } : { text: value, truncated: false }; };
const count = (value, fallback, most = LIMITS.list) => Math.min(most, Math.max(1, Math.floor(Number(value)) || fallback));
// GitHub's run ids are past 40 billion now, so any safe whole number; a flag or a fraction still isn't one.
const number = (value, what = 'number') => { const n = Number(value); if (!Number.isSafeInteger(n) || n < 1) throw new Error(`Give the ${what} as a whole number.`); return n; };
const words = (value, what, limit = 65000) => { const text = String(value ?? '').trim(); if (!text) throw new Error(`Write the ${what} first.`); if (text.length > limit) throw new Error(`The ${what} is too long.`); return text; };
const person = user => user?.login ?? user?.name ?? null;

// Runs gh with its prompts, colours and update checks off; text for a write goes in on stdin, never on the command line.
// An app opened from the Finder gets only /usr/bin:/bin:/usr/sbin:/sbin, without Homebrew's /opt/homebrew/bin where gh
// usually is, so the usual tool folders are added to whatever PATH there is, as Fairy's git commands have them.
export const toolPath = (path = '') => [...new Set([...String(path || '').split(':'), ...commandPath().split(':')].filter(Boolean))].join(':');
export function ghRunner({ cwd = null, env = process.env, file = 'gh', run = execFile } = {}) {
  return (args, { input = null, timeout = 45000 } = {}) => new Promise((resolve, reject) => {
    const child = run(file, args, { cwd: cwd || undefined, env: { ...env, PATH: toolPath(env.PATH), GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', GH_SPINNER_DISABLED: '1', NO_COLOR: '1', CLICOLOR: '0' }, timeout, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (!error) { resolve(stdout); return; }
        const said = String(stderr || error.message).trim().slice(0, 600);
        reject(Object.assign(new Error(error.code === 'ENOENT' ? 'Install the GitHub CLI (gh) and sign in with gh auth login.' : /gh auth login|not logged in|authentication/i.test(said) ? 'Sign in to GitHub with gh auth login, then try again.' : said), { missing: error.code === 'ENOENT' }));
      });
    if (input != null) child.stdin?.end(input); else child.stdin?.end();
  });
}

// Clones owner/name into parent/name with gh, for a work session there; a clone of it already in that place is used as
// it is, and any other folder by that name is left alone.
export async function cloneInto({ github, repo, parent, originOf, exists = existsSync }) {
  const name = String(repo ?? '');
  if (!REPO.test(name)) throw new Error('Name the repository as owner/name.');
  const folder = name.split('/')[1];
  if (folder === '.' || folder === '..') throw new Error('That isn’t a repository Fairy can clone.');
  if (typeof parent !== 'string' || !isAbsolute(parent)) throw new Error('Choose a folder to clone it into.');
  const target = join(parent, folder);
  if (exists(target)) {
    const there = await Promise.resolve().then(() => originOf(target)).catch(() => null);
    if (there && there.toLowerCase() === name.toLowerCase()) return { folder: target, cloned: false };
    throw new Error(`There’s already a folder called ${folder} in ${parent}. Choose another place, or move that folder.`);
  }
  await github.run(['repo', 'clone', name, target, '--', '--quiet'], { timeout: 15 * 60 * 1000 });
  return { folder: target, cloned: true };
}

export class GitHub {
  // run(args, { input }) runs gh; cwd is the work session's folder, if it's a clone, so a repository can be left out.
  constructor({ run, cwd = null, quota = null }) { Object.assign(this, { run, cwd, quota }); this.names = new Map(); }
  repoArgs(repo) {
    if (repo) { if (typeof repo !== 'string' || !REPO.test(repo) || repo.startsWith('-') || repo.split('/').some(part => part === '.' || part === '..')) throw new Error('Name the repository as owner/name.'); return ['--repo', repo]; }
    if (!this.cwd) throw new Error('Name the repository as owner/name. github_repos lists yours.');
    return [];
  }
  // owner/name, for the API calls gh has no command for.
  async fullName(repo) {
    if (repo) { this.repoArgs(repo); return String(repo); }
    if (!this.cwd) throw new Error('Name the repository as owner/name.');
    if (!this.names.has(this.cwd)) this.names.set(this.cwd, (await this.json(['repo', 'view', '--json', 'nameWithOwner'])).nameWithOwner);
    return this.names.get(this.cwd);
  }
  async json(args, options) {
    if (options?.priority === 'background' && this.quota) this.quota.assertAllowed({ priority: 'background' });
    const out = await this.run(args, options);
    try { return JSON.parse(out || 'null'); } catch { throw new Error('GitHub sent back something Fairy couldn’t read.'); }
  }

  /* ── reading ── */
  // What's waiting for you across GitHub: assigned issues and PRs, review requests, mentions and recent activity.
  async status() { return clip(await this.run(['status']), LIMITS.status); }
  async repos({ owner = '', limit } = {}) {
    if (owner && (typeof owner !== 'string' || !/^[A-Za-z0-9_.-]{1,100}$/.test(owner) || owner === '.' || owner === '..' || owner.startsWith('-'))) throw new Error('That isn’t a GitHub account name.');
    return { repos: await this.json(['repo', 'list', ...(owner ? [owner] : []), '--limit', String(count(limit, 30)), '--json', 'nameWithOwner,description,updatedAt,visibility,isFork,isArchived,url']) };
  }
  async prs({ repo, state = 'open', search = '', limit } = {}) {
    if (!['open', 'closed', 'merged', 'all'].includes(state)) throw new Error('Choose open, closed, merged or all.');
    const prs = await this.json(['pr', 'list', ...this.repoArgs(repo), '--state', state, ...(search ? ['--search', String(search).slice(0, 300)] : []), '--limit', String(count(limit, 20)),
      '--json', 'number,title,author,state,isDraft,updatedAt,headRefName,baseRefName,reviewDecision,url']);
    return { prs: prs.map(pr => ({ ...pr, author: person(pr.author) })) };
  }
  // A PR, its conversation, its reviews and every inline review comment, with the ids a reply needs.
  async pr({ repo, number: n } = {}) {
    const id = number(n, 'pull request number');
    const raw = await this.json(['pr', 'view', String(id), ...this.repoArgs(repo), '--json', 'number,title,body,author,state,isDraft,baseRefName,headRefName,additions,deletions,changedFiles,files,reviewDecision,reviews,comments,statusCheckRollup,url,mergeable,labels,reviewRequests,updatedAt']);
    const name = await this.fullName(repo);
    const inline = await this.json(['api', `repos/${name}/pulls/${id}/comments?per_page=100`]).catch(() => []);
    return {
      number: raw.number, title: raw.title, url: raw.url, author: person(raw.author), state: raw.state, draft: raw.isDraft, base: raw.baseRefName, head: raw.headRefName, mergeable: raw.mergeable,
      ...(raw.updatedAt ? { updatedAt: raw.updatedAt } : {}),
      ...(Array.isArray(raw.labels) ? { labels: raw.labels.map(l => ({ name: l?.name || '', color: l?.color || '' })).filter(l => l.name) } : {}),
      ...(Array.isArray(raw.reviewRequests) ? { reviewers: raw.reviewRequests.map(r => r?.login || r?.name || r?.requestedReviewer?.login || r?.requestedReviewer?.name).filter(Boolean) } : {}),
      body: clip(raw.body, LIMITS.body).text, changes: { files: raw.changedFiles, additions: raw.additions, deletions: raw.deletions, paths: (raw.files || []).slice(0, 100).map(f => `${f.path} (+${f.additions} −${f.deletions})`) },
      files: (raw.files || []).slice(0, 100).map(f => ({ path: f.path, additions: f.additions ?? 0, deletions: f.deletions ?? 0 })),
      reviewDecision: raw.reviewDecision || null,
      reviews: (raw.reviews || []).slice(-LIMITS.comments).map(r => ({ author: person(r.author), state: r.state, body: clip(r.body, 2000).text, at: r.submittedAt })),
      conversation: (raw.comments || []).slice(-LIMITS.comments).map(c => ({ author: person(c.author), body: clip(c.body, 2000).text, at: c.createdAt })),
      reviewComments: (Array.isArray(inline) ? inline : []).slice(-LIMITS.comments).map(c => ({ id: c.id, path: c.path, line: c.line ?? c.original_line ?? null, author: person(c.user), body: clip(c.body, 2000).text, inReplyTo: c.in_reply_to_id ?? null, at: c.created_at })),
      checks: summariseChecks(raw.statusCheckRollup),
    };
  }
  async prDiff({ repo, number: n, path = '' } = {}) {
    const diff = await this.run(['pr', 'diff', String(number(n, 'pull request number')), ...this.repoArgs(repo), '--color', 'never']);
    if (!path) return clip(diff, LIMITS.diff);
    const part = diff.split(/(?=^diff --git )/m).find(section => section.startsWith(`diff --git a/${path} `) || section.includes(` b/${path}\n`));
    if (!part) throw new Error(`${path} isn’t changed in this pull request.`);
    return clip(part, LIMITS.diff);
  }
  // A PR's checks, or a branch's latest runs, with the run id each failure's log is read by.
  async checks({ repo, number: n, branch = '' } = {}) {
    if (n != null && n !== '') {
      const checks = await this.json(['pr', 'checks', String(number(n, 'pull request number')), ...this.repoArgs(repo), '--json', 'name,state,bucket,link,workflow,description']).catch(error => { if (/no checks reported/i.test(error.message)) return []; throw error; });
      return { checks: checks.map(c => ({ ...c, run: /\/runs\/(\d+)/.exec(c.link || '')?.[1] ?? null })) };
    }
    return { runs: await this.json(['run', 'list', ...this.repoArgs(repo), ...(branch ? ['--branch', String(branch).slice(0, 200)] : []), '--limit', '15', '--json', 'databaseId,name,workflowName,status,conclusion,headBranch,headSha,event,createdAt,url']) };
  }
  // The failing steps' log of a run: its end, where the failure is.
  async ciLog({ repo, run } = {}) {
    const id = number(run, 'run id');
    const log = await this.run(['run', 'view', String(id), ...this.repoArgs(repo), '--log-failed'], { timeout: 90000 });
    const kept = tail(log.replace(/\u001b\[[0-9;]*m/g, ''), LIMITS.log);
    return { run: id, log: kept.text, truncated: kept.truncated, ...(log.trim() ? {} : { note: 'No failed steps in this run, or its log has expired.' }) };
  }
  async issues({ repo, state = 'open', search = '', labels = [], limit } = {}) {
    if (!['open', 'closed', 'all'].includes(state)) throw new Error('Choose open, closed or all.');
    const issues = await this.json(['issue', 'list', ...this.repoArgs(repo), '--state', state, ...(search ? ['--search', String(search).slice(0, 300)] : []), ...[].concat(labels || []).slice(0, 5).flatMap(l => ['--label', String(l).slice(0, 80)]),
      '--limit', String(count(limit, 20)), '--json', 'number,title,state,author,labels,updatedAt,url']);
    return { issues: issues.map(issue => ({ ...issue, author: person(issue.author), labels: (issue.labels || []).map(l => l.name) })) };
  }
  async issue({ repo, number: n } = {}) {
    const raw = await this.json(['issue', 'view', String(number(n, 'issue number')), ...this.repoArgs(repo), '--json', 'number,title,body,state,author,labels,assignees,comments,url,createdAt']);
    return { number: raw.number, title: raw.title, url: raw.url, state: raw.state, author: person(raw.author), labels: (raw.labels || []).map(l => l.name), assignees: (raw.assignees || []).map(person),
      body: clip(raw.body, LIMITS.body).text, comments: (raw.comments || []).slice(-LIMITS.comments).map(c => ({ author: person(c.author), body: clip(c.body, 2000).text, at: c.createdAt })) };
  }
  async search({ kind = 'code', query, repo = '', limit } = {}) {
    const fields = { code: 'path,repository,url,textMatches', issues: 'number,title,state,repository,updatedAt,url', prs: 'number,title,state,repository,updatedAt,url', repos: 'fullName,description,updatedAt,url,stargazersCount' };
    if (!fields[kind]) throw new Error('Search code, issues, prs or repos.');
    const q = words(query, 'search', 300);
    if (repo && !REPO.test(String(repo))) throw new Error('Name the repository as owner/name.');
    const found = await this.json(['search', kind, q, ...(repo && kind !== 'repos' ? ['--repo', String(repo)] : []), '--limit', String(count(limit, 15, 30)), '--json', fields[kind]]);
    return { results: kind === 'code' ? found.map(r => ({ repo: r.repository?.nameWithOwner, path: r.path, url: r.url, matches: (r.textMatches || []).slice(0, 3).map(m => clip(m.fragment, 400).text) })) : found };
  }

  // A repository at a glance, for the Git pane.
  async repoOverview({ repo } = {}) {
    if (repo !== undefined && repo !== null && repo !== '' && typeof repo !== 'string') throw new Error('Name the repository as owner/name.');
    const raw = await this.json(['repo', 'view', ...(repo ? [String(this.repoArgs(repo)[1])] : this.cwd ? [] : (() => { throw new Error('Name the repository as owner/name.'); })()), '--json', 'nameWithOwner,description,url,defaultBranchRef,visibility,stargazerCount,forkCount,issues,pullRequests,pushedAt,primaryLanguage']);
    return { name: raw.nameWithOwner, description: raw.description || '', url: raw.url, branch: raw.defaultBranchRef?.name || null, visibility: raw.visibility, stars: raw.stargazerCount, forks: raw.forkCount,
      openIssues: raw.issues?.totalCount ?? null, openPrs: raw.pullRequests?.totalCount ?? null, pushed: raw.pushedAt, language: raw.primaryLanguage?.name || null };
  }
  // A repository's commits on GitHub, newest first, a page at a time.
  async commits({ repo, branch = '', limit = 50, page = 1 } = {}) {
    const name = await this.fullName(repo);
    if (branch && (typeof branch !== 'string' || !/^(?!-)(?!.*\.\.)[A-Za-z0-9._\/-]{1,200}$/.test(branch))) throw new Error('That isn’t a branch name.');
    const per = count(limit, 50, 100), at = Math.max(1, Math.floor(Number(page)) || 1);
    const list = await this.json(['api', `repos/${name}/commits?per_page=${per}&page=${at}${branch ? `&sha=${encodeURIComponent(branch)}` : ''}`]);
    return { commits: (list || []).map(c => ({ sha: c.sha, short: c.sha.slice(0, 7), author: c.author?.login || c.commit?.author?.name || '', date: c.commit?.author?.date, subject: String(c.commit?.message || '').split('\n')[0], parents: (c.parents || []).map(p => p.sha), url: c.html_url })), more: (list || []).length === per };
  }

  // Your pull request inbox, in one GraphQL call: reviews waiting on you, your own open pull requests, and others
  // you're part of, each with its checks, review state and comment count.
  async inbox({ limit = 30 } = {}) {
    const per = count(limit, 30, 50);
    const fields = 'number title url updatedAt isDraft reviewDecision additions deletions baseRefName headRefName labels(first: 5) { nodes { name color } } repository { nameWithOwner } author { login } comments { totalCount } reviewThreads { totalCount } commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }';
    const part = (name, q) => `${name}: search(query: "is:pr is:open archived:false ${q}", type: ISSUE, first: ${per}) { issueCount nodes { ... on PullRequest { ${fields} } } }`;
    const query = `query { viewer { login } ${part('review', 'review-requested:@me')} ${part('mine', 'author:@me')} ${part('involved', 'involves:@me -author:@me -review-requested:@me')} }`;
    const raw = await this.json(['api', 'graphql', '-f', `query=${query}`]);
    const data = raw?.data || {};
    const checks = { SUCCESS: 'passing', FAILURE: 'failing', ERROR: 'failing', PENDING: 'running', EXPECTED: 'running' };
    const list = found => (found?.nodes || []).filter(pr => pr?.number).map(pr => ({
      repo: pr.repository?.nameWithOwner || '', number: pr.number, title: String(pr.title || '').slice(0, 300), url: pr.url, author: pr.author?.login || '', updated: pr.updatedAt, draft: Boolean(pr.isDraft),
      review: pr.reviewDecision ? pr.reviewDecision.toLowerCase().replaceAll('_', ' ') : '', checks: checks[pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state] || '',
      comments: (pr.comments?.totalCount || 0) + (pr.reviewThreads?.totalCount || 0),
      ...(pr.additions != null ? { additions: pr.additions } : {}),
      ...(pr.deletions != null ? { deletions: pr.deletions } : {}),
      ...(pr.baseRefName ? { base: pr.baseRefName } : {}),
      ...(pr.headRefName ? { head: pr.headRefName } : {}),
      ...(Array.isArray(pr.labels?.nodes) ? { labels: pr.labels.nodes.map(l => ({ name: l?.name || '', color: l?.color || '' })).filter(l => l.name) } : {}),
    }));
    return { login: data.viewer?.login || '', review: list(data.review), mine: list(data.mine), involved: list(data.involved), counts: { review: data.review?.issueCount ?? 0, mine: data.mine?.issueCount ?? 0, involved: data.involved?.issueCount ?? 0 } };
  }

  // Your contributions over the last year, day by day, and the repositories you committed to most, for the activity grid.
  async activity() {
    const query = 'query { viewer { login contributionsCollection { contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } } commitContributionsByRepository(maxRepositories: 8) { repository { nameWithOwner url } contributions { totalCount } } } } }';
    const viewer = (await this.json(['api', 'graphql', '-f', `query=${query}`]))?.data?.viewer;
    const made = viewer?.contributionsCollection || {};
    const days = (made.contributionCalendar?.weeks || []).flatMap(week => week.contributionDays || []).filter(day => /^\d{4}-\d{2}-\d{2}$/.test(day?.date || '')).map(day => ({ date: day.date, count: Math.max(0, Number(day.contributionCount) || 0) }));
    return { login: viewer?.login || '', total: made.contributionCalendar?.totalContributions ?? days.reduce((sum, day) => sum + day.count, 0), days,
      repos: (made.commitContributionsByRepository || []).map(r => ({ name: r.repository?.nameWithOwner || '', url: r.repository?.url || '', commits: r.contributions?.totalCount || 0 })).filter(r => r.name) };
  }

  // One commit with its files and their patches, for the Git pane's Your repos.
  async commitDetail({ repo, sha } = {}) {
    const name = await this.fullName(repo);
    if (typeof sha !== 'string' || !/^[0-9a-f]{7,64}$/i.test(sha)) throw new Error('That isn’t a commit.');
    const c = await this.json(['api', `repos/${name}/commits/${sha}`]);
    return { sha: c?.sha, message: String(c?.commit?.message || '').trim(), files: (c?.files || []).slice(0, 300).map(f => { const patch = typeof f.patch === 'string' ? f.patch : null, binary = !patch && !f.additions && !f.deletions && f.status !== 'removed'; return { path: f.filename, added: binary ? null : f.additions ?? null, removed: binary ? null : f.deletions ?? null, status: f.status, patch }; }), more: (c?.files || []).length >= 300 };
  }

  /* ── writing: only through the tools, which ask first ── */
  async prComment({ repo, number: n, body } = {}) { const out = await this.run(['pr', 'comment', String(number(n, 'pull request number')), ...this.repoArgs(repo), '--body-file', '-'], { input: words(body, 'comment') }); return { posted: true, url: out.trim().split('\n').at(-1) }; }
  async reviewReply({ repo, number: n, comment, body } = {}) {
    const name = await this.fullName(repo), text = words(body, 'reply');
    const made = await this.json(['api', '--method', 'POST', `repos/${name}/pulls/${number(n, 'pull request number')}/comments/${number(comment, 'review comment id')}/replies`, '--input', '-'], { input: JSON.stringify({ body: text }) });
    return { posted: true, url: made?.html_url ?? null };
  }
  async review({ repo, number: n, verdict = 'comment', body = '' } = {}) {
    const flag = { comment: '--comment', approve: '--approve', changes: '--request-changes' }[verdict];
    if (!flag) throw new Error('A review comments, approves or requests changes.');
    if (verdict !== 'approve') words(body, 'review');
    await this.run(['pr', 'review', String(number(n, 'pull request number')), ...this.repoArgs(repo), flag, '--body-file', '-'], { input: String(body || '') });
    return { posted: true, verdict };
  }
  async issueCreate({ repo, title, body = '', labels = [] } = {}) {
    const out = await this.run(['issue', 'create', ...this.repoArgs(repo), '--title', words(title, 'title', 256), '--body-file', '-', ...[].concat(labels || []).slice(0, 5).flatMap(l => ['--label', String(l).slice(0, 80)])], { input: String(body || '') });
    return { created: true, url: out.trim().split('\n').at(-1) };
  }
  async issueComment({ repo, number: n, body } = {}) { const out = await this.run(['issue', 'comment', String(number(n, 'issue number')), ...this.repoArgs(repo), '--body-file', '-'], { input: words(body, 'comment') }); return { posted: true, url: out.trim().split('\n').at(-1) }; }
  async prCreate({ repo, title, body = '', base = '', head = '', draft = false } = {}) {
    const ref = value => { if (value && !/^[A-Za-z0-9._\/-]{1,200}$/.test(value)) throw new Error('That isn’t a branch name.'); return value; };
    const out = await this.run(['pr', 'create', ...this.repoArgs(repo), '--title', words(title, 'title', 256), '--body-file', '-', ...(ref(base) ? ['--base', base] : []), ...(ref(head) ? ['--head', head] : []), ...(draft ? ['--draft'] : [])], { input: String(body || ''), timeout: 60000 });
    return { created: true, url: out.trim().split('\n').at(-1) };
  }
}

// Checks as counts and the ones that didn't pass, from a PR's status rollup.
export function summariseChecks(rollup = []) {
  const summary = { passed: 0, failed: 0, pending: 0, failing: [] };
  for (const check of rollup || []) {
    const value = String(check.conclusion || check.state || check.status || '').toUpperCase();
    if (['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(value)) summary.passed++;
    else if (['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(value)) { summary.failed++; summary.failing.push({ name: check.name || check.context, run: /\/runs\/(\d+)/.exec(check.detailsUrl || check.targetUrl || '')?.[1] ?? null }); }
    else summary.pending++;
  }
  return summary;
}
