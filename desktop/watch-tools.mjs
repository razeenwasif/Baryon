// Watchers from a chat (docs/watchers-plan.md, stage 5). A chat or work session can't add a watcher on its own: watch_add
// shows the user a card with the watcher spelled out, and it is added only when they press Add watcher. It never sets a
// watcher to work on its own; only Settings can. Offered in the watchers group of more_tools (desktop/work-tools.mjs),
// and straight away when a request asks to be told when something happens, or right after a Nexus job is sent or a
// pull request opened, when Fairy may offer one.
import { defineTool } from './tool-registry.mjs';
import { ACTIONS, BOUNDS, EVERY, WATCH_EVENTS, cleanWatcher, targetWords } from './watchers.mjs';

const string = { type: 'string' };
const WHEN = { 'check-failed': 'a check fails on', review: 'a review or comment arrives on', 'nexus-job': 'Nexus job', file: 'something changes in', paper: 'a new arXiv paper matches' };
const THEN = { tell: 'Tell you', summarise: 'Summarise it in a new chat', work: 'Work on it' };
const minutes = n => (n % 60 === 0 && n >= 60 ? `${n / 60} ${n === 60 ? 'hour' : 'hours'}` : `${n} ${n === 1 ? 'minute' : 'minutes'}`);

// The watcher a model asked for, as the store would keep it, or an error that says what's missing. A work watcher works in
// this chat's folder unless it names another; it never runs on its own from here.
export function watchDraft(args = {}, { folder = '' } = {}) {
  const value = args && typeof args === 'object' ? args : {};
  if (!WATCH_EVENTS.includes(value.event)) throw new Error(`Say which event to watch: ${WATCH_EVENTS.join(', ')}.`);
  const action = value.action || 'tell';
  if (!ACTIONS.includes(action)) throw new Error(`Say what to do when it fires: ${ACTIONS.join(', ')}.`);
  const draft = cleanWatcher({ event: value.event, repo: value.repo ?? '', branch: value.branch ?? '', pr: value.pr ?? null, job: value.job ?? '', path: value.path ?? '', query: value.query ?? '',
    every: value.every ?? '', action, prompt: value.prompt ?? '', folder: action === 'work' ? value.folder || folder : '', runOnOwn: false, title: value.title ?? '', id: 'draft', state: {} });
  if (!draft) {
    const [low, high] = BOUNDS[value.event];
    throw new Error(`That watcher isn’t complete. ${{
      'check-failed': 'A check needs repo as owner/name (or neutrino:<id>), and a branch or a pull request number (pr) if you name one, not both.',
      review: 'Reviews watch the user’s open pull requests (in repo if given), or one with pr and its repo.',
      'nexus-job': 'A Nexus job needs its id as job, as nexus_run gave it.',
      file: 'Files need a full path in the user’s home folder, as path.',
      paper: 'Papers need a search as query, as you’d type it into arXiv.' }[value.event]}${action === 'work' ? ' Work on it needs a folder given as a full path.' : ''} every is in minutes, ${low} to ${high} for this event.`);
  }
  const { id, enabled, state, ...watcher } = draft;
  return watcher;
}

// The card: what it watches, how often, and what it does.
export function watchCard(w) {
  const target = w.event === 'nexus-job' ? `${w.job} ends` : w.event === 'file' ? w.path : w.event === 'paper' ? `“${w.query}”` : w.event === 'review' && !w.pr ? `your pull requests${w.repo ? ` in ${w.repo}` : ''}` : targetWords(w);
  const lines = [`When ${WHEN[w.event]} ${target}`, `Looks every ${minutes(w.every)}, on the mini`,
    `Then: ${THEN[w.action]}${w.action === 'work' ? ` in ${w.folder}, asking you first each time` : ''}`];
  if (w.prompt) lines.push(`Asking: ${w.prompt.slice(0, 400)}`);
  return { title: `Add a watcher? ${w.title}`, detail: lines.join('\n'), note: 'Pause or remove it any time in Settings → Skills & automation.' };
}

// The same watcher already kept: the same event on the same thing, doing the same.
export const sameWatcher = (a, b) => ['event', 'repo', 'branch', 'pr', 'job', 'path', 'query', 'action', 'folder'].every(key => (a[key] ?? '') === (b[key] ?? ''));

export const WATCH_TOOLS = [
  defineTool({ name: 'watch_add', risk: 'read',
    description: `Offer the user a watcher: Fairy keeps an eye on something with no model call and, when it happens, tells them, summarises it in a new chat, or works on it. Use it when they ask to be told when something happens (“tell me when the checks on this PR fail”, “let me know when the job ends”), and offer one yourself right after you send a Nexus job or open a pull request. It shows them a card with the watcher; it is added only if they press Add watcher, so say that. Events: check-failed (repo, and branch or pr), review (a review or comment on their open pull requests, or on one with repo and pr), nexus-job (job), file (path, a file or folder in their home folder), paper (query, an arXiv search). Defaults: every ${Object.entries(EVERY).map(([event, n]) => `${event} ${n}`).join(', ')} minutes.`,
    properties: {
      event: { type: 'string', enum: [...WATCH_EVENTS] },
      repo: { ...string, description: 'owner/name on GitHub, or neutrino:<id> for a Neutrino repository.' },
      branch: string,
      pr: { type: 'integer', description: 'A pull request number.' },
      job: { ...string, description: 'A Nexus job id, from nexus_run.' },
      path: { ...string, description: 'A full path, for file.' },
      query: { ...string, description: 'Search words, for paper.' },
      every: { type: 'integer', description: 'Minutes between looks; leave it out for the default.' },
      action: { type: 'string', enum: [...ACTIONS], description: 'tell (the default), summarise in a new chat, or work on it in a folder (the user is asked each time).' },
      prompt: { ...string, description: 'For summarise or work: what to ask, such as “Find why it failed and fix it”.' },
      folder: { ...string, description: 'For work: a full path; this chat’s folder if left out.' },
      title: { ...string, description: 'A short name for the watcher.' },
    }, required: ['event'],
    run: async (args, { watchers, folder }) => {
      if (!watchers) return { error: 'Watchers aren’t on this Mac.' };
      let draft;
      try { draft = watchDraft(args, { folder }); } catch (error) { return { error: error.message }; }
      const kept = (await watchers.list()).find(w => sameWatcher(w, draft));
      if (kept) return { added: false, already: true, text: `There’s a watcher for that already: “${kept.title}”${kept.enabled ? '' : ', paused'}. The user can change it in Settings → Skills & automation.` };
      const answer = await watchers.offer(watchCard(draft));
      if (answer !== 'allow') return { added: false, text: answer === 'timeout' ? 'No one answered the card, so no watcher was added.' : 'The user chose not to add the watcher.' };
      try { await watchers.add(draft); } catch (error) { return { error: error.message }; }
      return { added: true, text: `Added the watcher “${draft.title}”. It looks every ${minutes(draft.every)} on the mini, and ${draft.action === 'tell' ? 'tells the user' : draft.action === 'summarise' ? 'summarises what it saw in a new chat' : 'asks the user before working on it'} when it fires.` };
    } }),
];
export const WATCH_TOOL_NAMES = new Set(WATCH_TOOLS.map(tool => tool.name));

// After a tool's result, the nudge that offers a watcher where one fits: a Nexus job just sent, or a pull request just
// opened. Text for the model, added to the tool's result; '' when there's nothing to offer.
export function watchNudge(name, result) {
  if (name === 'nexus_run' && typeof result?.job === 'string' && result.job)
    return `\n\nIf the user would want to hear when job ${result.job} ends, offer a watcher: watch_add with event nexus-job and job ${result.job} (through more_tools, group watchers, if it isn’t listed).`;
  if (name === 'github_pr_create' && result?.created && typeof result.url === 'string') {
    const found = /^https:\/\/github\.com\/([A-Za-z0-9-]+\/[A-Za-z0-9_.-]+)\/pull\/(\d+)$/.exec(result.url.trim());
    if (found) return `\n\nIf the user would want to hear when its checks fail or a review arrives, offer a watcher: watch_add with event check-failed or review, repo ${found[1]} and pr ${found[2]} (through more_tools, group watchers, if it isn’t listed).`;
  }
  if (name === 'neutrino_pr_create' && result?.created && result.repo && result.number) {
    return `\n\nIf the user would want to hear when its CI checks fail or a review arrives on Neutrino, offer a watcher: watch_add with event check-failed or review, repo neutrino:${result.repo} and pr ${result.number} (through more_tools, group watchers, if it isn’t listed).`;
  }
  return '';
}
