export type Unsubscribe = () => void;

export interface SyncCounts {
  chatsAdded?: number;
  chatsUpdated?: number;
  pagesCopied?: number;
  typedCopied?: number;
  pagesFetched?: number;
  pagesFailed?: number;
  pagesOnline?: number;
}

export interface SkillItem {
  name: string;
  description?: string;
  source?: string;
}

export interface HookItem {
  id: string;
  folder: string;
  event: string;
  command: string;
}

export interface ScheduleItem {
  id: string;
  title: string;
  time: string;
  days: number[];
  lastRun?: string;
}

export interface WatcherPaper {
  id: string;
  title?: string;
  url?: string;
  at?: number | string;
}

export interface WatcherItem {
  id: string;
  title: string;
  event: string;
  every: number;
  action: string;
  enabled: boolean;
  repo?: string;
  branch?: string;
  pr?: string | number;
  job?: string;
  path?: string;
  query?: string;
  folder?: string;
  runOnOwn?: boolean;
  state: {
    paused?: string;
    looked?: number | string;
    fired?: number | string;
    error?: string;
    recentPapers?: WatcherPaper[];
  };
}

export interface AutomationState {
  hooks: HookItem[];
  schedules: ScheduleItem[];
  watchers?: WatcherItem[];
}

export interface ConnectorItem {
  id: string;
  name: string;
  target: string;
}

export interface ScratchState {
  root: string;
  folders: number;
  bytes: number;
  limit: number;
  here?: boolean;
  trimmed?: {
    at: number | string;
    removed?: unknown[];
  };
}

export interface ClaudeSyncState {
  role?: string;
  running?: boolean;
  progress?: string;
  error?: string;
  last?: {
    at: number | string;
    from?: string;
    counts?: SyncCounts;
  };
}

export interface OffPeakQueueItem {
  id: string;
  title: string;
  kind: string;
  provider: string;
}

export interface OffPeakHistoryItem {
  title: string;
  status: string;
  provider: string;
  summary?: string;
  error?: string;
}

export interface OffPeakState {
  enabled?: boolean;
  running?: { title: string; provider: string } | null;
  window?: { reason?: string } | null;
  readiness?: { reason?: string } | null;
  items?: OffPeakQueueItem[];
  history?: OffPeakHistoryItem[];
}

export interface AutomationSettingsApi {
  automationState: () => Promise<AutomationState>;
  skillsList: () => Promise<SkillItem[]>;
  skillSave: (value: { name: string; description: string; text: string }) => Promise<unknown>;
  skillRemove: (name: string) => Promise<unknown>;
  hookChooseFolder: () => Promise<string | null | undefined>;
  hookAdd: (value: { folder: string; event: string; command: string }) => Promise<unknown>;
  hookRemove: (id: string) => Promise<unknown>;
  scheduleAdd: (value: { title: string; prompt: string; time: string; days: number[] }) => Promise<unknown>;
  scheduleRun: (id: string) => Promise<unknown>;
  scheduleRemove: (id: string) => Promise<unknown>;
  watcherAdd: (value: Record<string, unknown>) => Promise<unknown>;
  watcherLook: (id: string) => Promise<unknown>;
  watcherSet: (id: string, value: { enabled: boolean }) => Promise<unknown>;
  watcherRemove: (id: string) => Promise<unknown>;
  openSource?: (url: string) => Promise<unknown>;
  connectorsState: () => Promise<ConnectorItem[]>;
  connectorAdd: (value: { name: string; kind: string; target: string }) => Promise<unknown>;
  connectorTest: (id: string) => Promise<string[]>;
  connectorRemove: (id: string) => Promise<unknown>;
  scratchState?: () => Promise<ScratchState>;
  scratchReveal: () => Promise<unknown>;
  scratchTrim: () => Promise<ScratchState>;
  claudeSync?: (action: string) => Promise<ClaudeSyncState>;
  onClaudeSync?: (callback: (state: ClaudeSyncState) => void) => Unsubscribe;
  claudeImport: () => Promise<{ text: string }>;
  offPeakState?: () => Promise<OffPeakState>;
  offPeakSet: (patch: { enabled: boolean }) => Promise<OffPeakState>;
  offPeakAdd: (item: { kind: string; title: string; provider: string; prompt: string }) => Promise<OffPeakState>;
  offPeakRun: (id: string) => Promise<OffPeakState>;
  offPeakRemove: (id: string) => Promise<OffPeakState>;
}

export interface SetupAutomationSettingsOptions {
  api?: AutomationSettingsApi | null;
  root: HTMLElement;
  onError: (message: string) => void;
  onChanged?: () => void;
  onReproduce?: ((paperId: string) => void | Promise<void>) | null;
}

export interface AutomationSettingsController {
  render: () => Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOOK_LABELS: Record<string, string> = { 'after-edit': 'After each file edit', 'after-turn': 'When a turn finishes' };

// What a Claude sync run did (claude-sync.mjs counts), in words.
export function syncSummary(counts?: SyncCounts | null): string {
  if (!counts) return '';
  const said = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const parts = [
    counts.chatsAdded ? said(counts.chatsAdded, 'new chat') : '',
    counts.chatsUpdated ? `${said(counts.chatsUpdated, 'chat')} updated` : '',
    counts.pagesCopied ? `${said(counts.pagesCopied, 'page')} copied` : '',
    counts.typedCopied ? `${said(counts.typedCopied, 'Doc or Design', 'Docs and Designs')} updated` : '',
    counts.pagesFetched ? `${said(counts.pagesFetched, 'page')} downloaded from claude.ai` : '',
    counts.pagesFailed ? `${said(counts.pagesFailed, 'page')} couldn’t come over` : '',
    counts.pagesOnline ? `${said(counts.pagesOnline, 'page')} only on claude.ai for now` : '',
  ].filter(Boolean);
  return parts.length ? `${parts.join(', ')}.` : 'Nothing new.';
}

const folderName = (path: string): string => String(path).split('/').filter(Boolean).at(-1) || path;

function button(label: string, run: () => void, className = 'quiet'): HTMLButtonElement {
  const node = element('button', className, label);
  node.type = 'button';
  node.onclick = run;
  return node;
}

// Inside the settings form, so Enter here mustn't save the whole form.
function field<K extends keyof HTMLElementTagNameMap = 'label'>(label: string, control: HTMLElement, tag: K = 'label' as K): HTMLElementTagNameMap[K] {
  const node = element(tag, 'automation-field');
  node.append(label, control);
  if (tag !== 'label') {
    node.setAttribute('role', 'group');
    node.setAttribute('aria-label', label);
  }
  return node;
}

function input(placeholder = '', maxLength = 200): HTMLInputElement {
  const node = element('input');
  node.placeholder = placeholder;
  node.maxLength = maxLength;
  node.autocomplete = 'off';
  node.onkeydown = event => { if (event.key === 'Enter') event.preventDefault(); };
  return node;
}

function textarea(placeholder?: string, rows = 3): HTMLTextAreaElement {
  const node = element('textarea');
  if (placeholder !== undefined) node.placeholder = placeholder;
  node.rows = rows;
  return node;
}

function row(title: string, detail: string, actions: Node[]): HTMLDivElement {
  const node = element('div', 'automation-row');
  const words = element('div', 'automation-words');
  words.append(element('strong', '', title));
  if (detail) words.append(element('span', '', detail));
  node.append(words, ...actions);
  return node;
}

// Skills, hooks, schedules, watchers and connectors: things you set up once, kept in Fairy's own data rather than a project.
export function setupAutomationSettings({ api, root, onError, onChanged = () => {}, onReproduce = null }: SetupAutomationSettingsOptions): AutomationSettingsController {
  // Settings covers the window's own error line, so a problem shows here, beside what caused it.
  const makeGuard = (failure: HTMLElement) => async <T>(run: () => Promise<T>): Promise<T | undefined> => {
    failure.textContent = '';
    try { return await run(); } catch (error) {
      failure.textContent = errorMessage(error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
      return undefined;
    }
  };
  const section = (title: string, note: string, failure: HTMLElement, ...parts: Node[]): HTMLDivElement => {
    const box = element('div', 'automation-section');
    box.append(element('h4', '', title), element('p', 'automation-note', note), ...parts, failure);
    return box;
  };

  async function skillsSection(): Promise<HTMLDivElement> {
    const failure = element('p', 'automation-error');
    const guard = makeGuard(failure);
    const skills = await api!.skillsList();
    const name = input('review-pr', 40);
    const description = input('What it’s for');
    const text = textarea('The instructions Fairy should follow when you run it', 4);
    const add = button('Save skill', () => void guard(async () => {
      await api!.skillSave({ name: name.value.trim(), description: description.value, text: text.value });
      onChanged();
      await render();
    }));
    return section(
      'Skills',
      'Instructions you run by typing / and their name in any chat. They only run when you choose them. A project can add its own in .fairy/skills, and those are labelled.',
      failure,
      ...skills.map(skill => row(
        `/${skill.name}`,
        [skill.source === 'project' ? 'This project' : '', skill.description].filter(Boolean).join(' · '),
        skill.source === 'project' ? [] : [button('Remove', () => void guard(async () => { await api!.skillRemove(skill.name); onChanged(); await render(); }))],
      )),
      element('div', 'automation-form'),
      field('Name', name),
      field('What it’s for', description),
      field('Instructions', text),
      add,
    );
  }

  async function hooksSection(state: AutomationState): Promise<HTMLDivElement> {
    const failure = element('p', 'automation-error');
    const guard = makeGuard(failure);
    let folder = '';
    const chosen = element('span', 'automation-chosen', 'No folder chosen');
    const command = input('npm test', 2000);
    const when = element('select');
    when.append(...Object.entries(HOOK_LABELS).map(([value, label]) => new Option(label, value)));
    const pick = button('Choose folder…', () => void guard(async () => {
      const path = await api!.hookChooseFolder();
      if (path) { folder = path; chosen.textContent = folderName(path); chosen.title = path; }
    }));
    const add = button('Add hook', () => void guard(async () => {
      await api!.hookAdd({ folder, event: when.value, command: command.value });
      await render();
    }));
    const place = element('div', 'automation-inline');
    place.append(pick, chosen);
    return section(
      'Hooks',
      'Commands that run by themselves in a work session’s folder. They run in the same sandbox as Fairy’s other commands, and show up in the chat.',
      failure,
      ...state.hooks.map(hook => {
        const line = row(
          hook.command,
          `${folderName(hook.folder)} · ${HOOK_LABELS[hook.event]}`,
          [button('Remove', () => void guard(async () => { await api!.hookRemove(hook.id); await render(); }))],
        );
        line.title = hook.folder;
        return line;
      }),
      element('div', 'automation-form'),
      field('Folder', place, 'div'),
      field('When', when),
      field('Command', command),
      add,
    );
  }

  async function schedulesSection(state: AutomationState): Promise<HTMLDivElement> {
    const failure = element('p', 'automation-error');
    const guard = makeGuard(failure);
    const title = input('Morning brief', 80);
    const prompt = textarea('What should Fairy do?', 3);
    const time = input('', 5);
    time.type = 'time';
    time.value = '09:00';
    const days = element('div', 'automation-days');
    const boxes = DAYS.map((label, index) => {
      const box = element('input');
      box.type = 'checkbox';
      box.checked = index > 0 && index < 6;
      box.setAttribute('aria-label', label);
      const wrap = element('label', 'automation-day');
      wrap.append(box, element('span', '', label));
      days.append(wrap);
      return box;
    });
    const add = button('Add routine', () => void guard(async () => {
      await api!.scheduleAdd({
        title: title.value,
        prompt: prompt.value,
        time: time.value,
        days: boxes.flatMap((box, index) => box.checked ? [index] : []),
      });
      await render();
    }));
    const box = section(
      'Routines',
      'Fairy does these on your subscription and leaves the result in a new chat. They need Fairy open and your Mac awake; one that was missed still runs if it’s under three hours late. Gmail and Calendar work if the prompt asks for them, but a routine can’t add events by itself.',
      failure,
      ...state.schedules.map(schedule => row(
        schedule.title,
        `${schedule.time} · ${schedule.days.map(day => DAYS[day]).join(' ')}${schedule.lastRun ? ` · last ran ${schedule.lastRun}` : ''}`,
        [
          button('Run now', () => void guard(async () => { await api!.scheduleRun(schedule.id); await render(); })),
          button('Remove', () => void guard(async () => { await api!.scheduleRemove(schedule.id); await render(); })),
        ],
      )),
      element('div', 'automation-form'),
      field('Name', title),
      field('Prompt', prompt),
      field('Time', time),
      field('Days', days, 'div'),
      add,
    );
    box.id = 'automation-routines';
    return box;
  }

  // Watchers (docs/watchers-plan.md): routines that start on an event: a check failing, a review or comment, a Nexus job ending.
  const when = (stamp?: number | string): string => {
    if (!stamp) return '';
    const at = new Date(stamp);
    return at.toDateString() === new Date().toDateString()
      ? at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : at.toLocaleDateString([], { day: 'numeric', month: 'short' });
  };
  const WATCH_KINDS: Array<[string, string]> = [
    ['check-failed', 'A check fails'],
    ['review', 'A review or comment arrives'],
    ['nexus-job', 'A Nexus job ends'],
    ['file', 'A file changes'],
    ['paper', 'A new paper matches'],
  ];
  const EVERY_DEFAULT: Record<string, string> = { 'check-failed': '5', review: '5', 'nexus-job': '2', file: '2', paper: '360' };
  const watched = (w: WatcherItem): string => (
    w.event === 'file' ? `changes in ${w.path}`
      : w.event === 'paper' ? `new arXiv papers for “${w.query}”`
        : w.event === 'nexus-job' ? `Nexus job ${w.job}`
          : w.event === 'review' ? `reviews and comments on ${w.pr ? `#${w.pr} in ${w.repo}` : `your pull requests${w.repo ? ` in ${w.repo}` : ''}`}`
            : `checks${w.pr ? ` on #${w.pr}` : w.branch ? ` on ${w.branch}` : ''} in ${w.repo}`
  );
  const ACTION_WORDS: Record<string, string> = { tell: 'tells you', summarise: 'summarises it in a new chat', work: 'works on it' };

  function watcherDetail(w: WatcherItem): string {
    const parts = [
      watched(w),
      `every ${w.every} min`,
      w.action === 'work' ? `works on it in ${w.folder}${w.runOnOwn ? ', on its own' : ', asking first'}` : ACTION_WORDS[w.action] || ACTION_WORDS.tell,
    ];
    if (!w.enabled) parts.push(w.state.paused || 'paused');
    else if (w.state.looked) parts.push(`looked ${when(w.state.looked)}`);
    else parts.push('first look within a minute');
    if (w.state.fired) parts.push(`last fired ${when(w.state.fired)}`);
    if (w.state.error) parts.push(`couldn’t look: ${w.state.error}`);
    return parts.join(' · ');
  }

  async function watchersSection(state: AutomationState): Promise<HTMLDivElement> {
    const failure = element('p', 'automation-error');
    const guard = makeGuard(failure);
    const kind = element('select');
    for (const [value, label] of WATCH_KINDS) {
      const option = element('option', '', label);
      option.value = value;
      kind.append(option);
    }
    const title = input('CI on main', 80);
    const repo = input('owner/name', 201);
    const branch = input('main', 200);
    const pr = input('', 7);
    const job = input('the id nexus gave', 64);
    const path = input('/Users/you/project/results', 1000);
    const query = input('diffusion models protein design', 200);
    const every = input('', 4);
    pr.inputMode = 'numeric';
    every.inputMode = 'numeric';
    every.value = '5';
    // Then: what to do when it fires.
    const then = element('select');
    for (const [value, label] of [['tell', 'Tell me'], ['summarise', 'Summarise it in a new chat'], ['work', 'Work on it']] as const) {
      const option = element('option', '', label);
      option.value = value;
      then.append(option);
    }
    const prompt = textarea('What to do, e.g. “Find why it failed and fix it.” Empty for Fairy’s own words.', 2);
    const folder = input('/Users/you/project', 1000);
    const pickFolder = button('Choose folder…', () => void guard(async () => { const chosen = await api!.hookChooseFolder(); if (chosen) folder.value = chosen; }));
    const folderRow = element('div', 'automation-path');
    folderRow.append(folder, pickFolder);
    const ownBox = element('input');
    ownBox.type = 'checkbox';
    const own = element('label', 'automation-check');
    own.append(ownBox, element('span', '', 'Run on its own, without asking first (it still follows the folder’s Ask first)'));
    const thenFields = { prompt: field('Ask', prompt), folder: field('In folder', folderRow, 'div'), own };
    const showThen = () => {
      thenFields.prompt.hidden = then.value === 'tell';
      thenFields.folder.hidden = then.value !== 'work';
      thenFields.own.hidden = then.value !== 'work';
    };
    then.onchange = showThen;
    showThen();
    const choose = button('Choose folder…', () => void guard(async () => { const chosen = await api!.hookChooseFolder(); if (chosen) path.value = chosen; }));
    const pathRow = element('div', 'automation-path');
    pathRow.append(path, choose);
    const fields = {
      repo: field('Repository', repo),
      branch: field('Branch', branch),
      pr: field('Or pull request', pr),
      job: field('Job', job),
      path: field('File or folder', pathRow, 'div'),
      query: field('Search', query),
    };
    // Only what each kind needs: a check its repository and a branch or PR; a review a repository and PR, or neither for
    // all your pull requests; a Nexus job its id.
    const show = () => {
      const k = kind.value;
      fields.repo.hidden = !['check-failed', 'review'].includes(k);
      fields.branch.hidden = k !== 'check-failed';
      fields.pr.hidden = !['check-failed', 'review'].includes(k);
      fields.job.hidden = k !== 'nexus-job';
      fields.path.hidden = k !== 'file';
      fields.query.hidden = k !== 'paper';
      if (fields.pr.firstChild) fields.pr.firstChild.textContent = k === 'review' ? 'Pull request' : 'Or pull request';
      repo.placeholder = k === 'review' ? 'owner/name, or empty for all your pull requests' : 'owner/name';
      every.value = EVERY_DEFAULT[k];
    };
    kind.onchange = show;
    show();
    const add = button('Add watcher', () => void guard(async () => {
      const k = kind.value;
      await api!.watcherAdd({
        event: k,
        title: title.value,
        every: Number(every.value) || undefined,
        action: then.value,
        ...(then.value === 'tell' ? {} : { prompt: prompt.value }),
        ...(then.value === 'work' ? { folder: folder.value.trim(), runOnOwn: ownBox.checked } : {}),
        ...(k === 'nexus-job'
          ? { job: job.value.trim() }
          : k === 'file'
            ? { path: path.value.trim() }
            : k === 'paper'
              ? { query: query.value.trim() }
              : { repo: repo.value.trim(), pr: pr.value.trim(), ...(k === 'check-failed' ? { branch: branch.value.trim() } : {}) }),
      });
      await render();
    }));
    const box = section(
      'Watchers',
      'Fairy looks for an event, with no model call, and tells you when it happens: aloud, on the companion, as a notification and on your iPhone while you’re away. A check failing, or a review or comment on your pull requests, is looked for through your gh sign-in, and its first look only learns what is there already. A Nexus job is looked for until it ends; its outputs come into Fairy’s folder, and the notification opens them. A file or folder in your home folder is told when its files’ names, sizes or times change (never read), once things have settled and at most every 10 minutes. A paper search asks arXiv, every 6 hours unless you say, and tells new papers together. Then it tells you, summarises what it saw in a new chat (one turn on the scout model), or works on it in a folder, asking you on a card first unless you let it run on its own. What it saw goes to the model as data, never as your words. One that fires 6 times in an hour pauses itself.',
      failure,
      ...(state.watchers || []).flatMap(w => {
        // The whole line on hover: why it paused, or why it couldn't look, is often longer than the row.
        const line = row(w.title, watcherDetail(w), [
          button('Look now', () => void guard(async () => { await api!.watcherLook(w.id); await render(); })),
          button(w.enabled ? 'Pause' : 'Turn on', () => void guard(async () => { await api!.watcherSet(w.id, { enabled: !w.enabled }); await render(); })),
          button('Remove', () => void guard(async () => { await api!.watcherRemove(w.id); await render(); })),
        ]);
        line.title = watcherDetail(w);
        // Reproduce a paper (stage 6, Decision 11): one-click Reproduce on recent arXiv papers noticed by this watcher.
        const papers = w.event === 'paper' && Array.isArray(w.state?.recentPapers) ? w.state.recentPapers : [];
        if (!papers.length) return [line];
        const notices = papers.slice(0, 5).map(paper => row(
          paper.title || paper.id,
          `arXiv:${paper.id}${paper.at ? ` · noticed ${when(paper.at)}` : ''}`,
          [
            ...(onReproduce ? [button('Reproduce', () => void onReproduce(paper.id))] : []),
            ...(paper.url && api!.openSource ? [button('arXiv', () => void api!.openSource!(paper.url!))] : []),
          ],
        ));
        return [line, ...notices];
      }),
      element('div', 'automation-form'),
      field('When', kind),
      field('Name', title),
      fields.repo,
      fields.branch,
      fields.pr,
      fields.job,
      fields.path,
      fields.query,
      field('Every (minutes)', every),
      field('Then', then),
      thenFields.prompt,
      thenFields.folder,
      thenFields.own,
      add,
    );
    box.id = 'automation-watchers';
    return box;
  }

  async function connectorsSection(): Promise<HTMLDivElement> {
    const failure = element('p', 'automation-error');
    const guard = makeGuard(failure);
    const items = await api!.connectorsState();
    const name = input('notes', 30);
    const kind = element('select');
    const target = input('npx some-mcp-server', 2000);
    kind.append(new Option('A command on this Mac', 'command'), new Option('An address', 'url'));
    kind.onchange = () => { target.placeholder = kind.value === 'url' ? 'https://example.com/mcp' : 'npx some-mcp-server'; };
    const add = button('Add connector', () => void guard(async () => {
      await api!.connectorAdd({ name: name.value, kind: kind.value, target: target.value });
      await render();
    }));
    return section(
      'Connectors',
      'MCP servers that give work sessions more tools. They run outside the sandbox with your account’s access, so only add ones you trust. Fairy asks before each use, even when a chat runs on its own, unless you allow that tool for the chat.',
      failure,
      ...items.map(item => {
        const result = element('span', 'automation-result');
        const line = row(item.name, item.target, [
          result,
          button('Test', () => void guard(async () => {
            result.textContent = 'Connecting…';
            try {
              const tools = await api!.connectorTest(item.id);
              result.textContent = tools.length ? `${tools.length} ${tools.length === 1 ? 'tool' : 'tools'}: ${tools.slice(0, 5).join(', ')}` : 'No tools';
            } catch (error) {
              result.textContent = '';
              throw error;
            }
          })),
          button('Remove', () => void guard(async () => { await api!.connectorRemove(item.id); await render(); })),
        ]);
        return line;
      }),
      element('div', 'automation-form'),
      field('Name', name),
      field('Runs as', kind),
      field('Command or address', target),
      add,
    );
  }

  // Fairy Scratch (desktop/scratch.mjs): where scratch sessions keep their files, how big it is, and its hourly trim.
  async function scratchSection(): Promise<HTMLDivElement> {
    const failure = element('p', 'automation-error');
    const guard = makeGuard(failure);
    const line = element('p', 'automation-note');
    const size = (bytes: number) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.max(0, Math.round(bytes / 1024 ** 2))} MB`);
    const show = (state?: ScratchState | null) => {
      if (!state) return;
      const trimmed = state.trimmed?.removed?.length ? ` The last trim (${when(state.trimmed.at)}) removed ${state.trimmed.removed.length} ${state.trimmed.removed.length === 1 ? 'folder' : 'folders'}.` : '';
      line.textContent = `${state.root.replace(/^\/Users\/[^/]+/, '~')}: ${state.folders} ${state.folders === 1 ? 'chat folder' : 'chat folders'}, ${size(state.bytes)} of ${size(state.limit)}.${trimmed}`;
    };
    const state = await api!.scratchState?.().catch(() => null);
    show(state);
    const reveal = button('Show in Finder', () => void guard(() => api!.scratchReveal()));
    reveal.hidden = state?.here === false;
    const trim = button('Trim now', () => void guard(async () => {
      trim.disabled = true;
      try { show(await api!.scratchTrim()); } finally { trim.disabled = false; }
    }));
    return section(
      'Fairy Scratch',
      'New scratch session (the flask beside New work session) works in its own folder in Fairy Scratch, on the Mac Fairy runs on, whichever provider answers. Every hour Fairy trims it: a chat folder untouched for two weeks is deleted, and while Scratch is over its limit (5 GB, or 1 GB when the disk is nearly full) the oldest go first. A chat that is open, working or was used in the last day keeps its folder.',
      failure,
      line,
      reveal,
      trim,
    );
  }

  // Claude sync's progress line, followed while Settings shows it.
  let stopSync: Unsubscribe | null = null;
  async function importSection(): Promise<HTMLDivElement> {
    const result = element('p', 'automation-note');
    const failure = element('p', 'automation-error');
    const guard = makeGuard(failure);
    const sync = await api!.claudeSync?.('state').catch(() => null);
    stopSync?.();
    stopSync = null;
    // The Mac Claude Code is used on sends its chats and pages to the other one, where Fairy keeps them.
    if (sync?.role === 'sender') {
      const line = element('p', 'automation-note');
      const now = button('Sync now', () => void guard(async () => show(await api!.claudeSync!('run'))));
      function show(state?: ClaudeSyncState | null) {
        if (!state) return;
        now.disabled = Boolean(state.running);
        line.textContent = state.running
          ? (state.progress || 'Syncing…')
          : state.error
            ? `The last sync didn’t finish: ${state.error}`
            : state.last
              ? `Synced ${when(state.last.at)}. ${syncSummary(state.last.counts)}`
              : 'Not synced yet. It runs by itself every 10 minutes while your other Mac is reachable.';
      }
      show(sync);
      stopSync = api!.onClaudeSync?.(show) ?? null;
      return section(
        'Claude Code',
        'Claude Code is used on this Mac, and Fairy keeps your chats and pages on your other Mac, so Fairy here sends them over every 10 minutes, and when you press Sync now: new and changed chats, and pages with their files. claude.ai Docs and Designs come too: a daily task in the Claude app (Fairy: bring claude.ai Docs and Designs) files changed Designs and notes changed Docs, which Fairy exports here. A chat you’ve deleted or carried on with there, and a page you’ve removed, stay as you left them.',
        failure,
        now,
        line,
      );
    }
    const last = sync?.last ? element('p', 'automation-note', `Last sync from ${sync.last.from || 'your MacBook'}: ${when(sync.last.at)}. ${syncSummary(sync.last.counts)}`) : null;
    const run = button('Import new chats', () => void guard(async () => {
      run.disabled = true;
      result.textContent = 'Importing…';
      try { result.textContent = (await api!.claudeImport()).text; } catch (error) { result.textContent = ''; throw error; } finally { run.disabled = false; }
    }));
    return section(
      'Claude Code chats',
      'Copies your Claude Code sessions into your chat list, with a folder for each project. It only reads them, and nothing leaves this Mac. Claude Code clears out old sessions after a while, but the copies here stay. A chat you’ve deleted or carried on with here stays as you left it. Fairy on your MacBook also sends its chats and pages here every 10 minutes.',
      failure,
      ...(last ? [last] : []),
      run,
      result,
    );
  }

  // Doc 7, #8: Off-peak queue — work that runs automatically on mains + idle before a 5-hour window resets.
  async function offPeakSection(): Promise<HTMLDivElement> {
    const failure = element('p', 'automation-error');
    const guard = makeGuard(failure);
    const statusLine = element('p', 'automation-note');
    const listWrap = element('div', 'automation-list');
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    const toggleLabel = element('label', 'automation-check');
    toggleLabel.append(toggle, element('span', '', 'Run queued jobs automatically on mains + idle before a 5-hour window resets'));

    const kindSelect = element('select');
    kindSelect.append(
      new Option('Memory reflection', 'reflect'),
      new Option('Refresh notes & books index (local)', 'index'),
      new Option('Refresh literature watchers', 'literature'),
      new Option('Run saved evals', 'eval'),
      new Option('Queued prompt', 'prompt'),
    );
    const provSelect = element('select');
    provSelect.append(
      new Option('Any resetting window', 'any'),
      new Option('Claude', 'claude'),
      new Option('Gemini', 'gemini'),
      new Option('Codex', 'codex'),
    );
    const titleInput = input('Optional title');
    const promptInput = input('Prompt (required for Queued prompt)', 4000);

    function draw(st?: OffPeakState | null) {
      if (!st) return;
      toggle.checked = Boolean(st.enabled);
      statusLine.textContent = st.running
        ? `Running: ${st.running.title} (${st.running.provider})…`
        : `${st.window?.reason || ''} ${st.enabled ? `Current check: ${st.readiness?.reason || ''}` : 'Auto-run is off until you turn it on.'}`.trim();
      listWrap.replaceChildren();
      for (const item of st.items || []) {
        listWrap.append(row(item.title, `${item.kind} · ${item.provider} · queued`, [
          button('Run now', () => void guard(async () => draw(await api!.offPeakRun(item.id)))),
          button('Remove', () => void guard(async () => draw(await api!.offPeakRemove(item.id)))),
        ]));
      }
      for (const done of (st.history || []).slice(0, 5)) {
        listWrap.append(row(done.title, `${done.status} · ${done.provider} · ${done.summary || done.error || ''}`, []));
      }
    }

    toggle.onchange = () => void guard(async () => draw(await api!.offPeakSet({ enabled: toggle.checked })));
    const addBtn = button('Queue', () => void guard(async () => {
      const next = await api!.offPeakAdd({
        kind: kindSelect.value,
        title: titleInput.value,
        provider: provSelect.value,
        prompt: promptInput.value,
      });
      titleInput.value = '';
      promptInput.value = '';
      draw(next);
    }));

    const initial = await api!.offPeakState?.().catch(() => null);
    draw(initial);
    return section(
      'Off-peak queue',
      'Queue background work that can wait (evals, literature refreshes, index rebuilds, reflection, or prompts). When enabled, Fairy runs queued items on mains power while idle whenever a 5-hour usage window is within 45 minutes of resetting with unused allowance left.',
      failure,
      toggleLabel,
      statusLine,
      listWrap,
      element('div', 'automation-form'),
      field('Kind', kindSelect),
      field('Provider', provSelect),
      field('Title', titleInput),
      field('Prompt', promptInput),
      addBtn,
    );
  }

  async function render(): Promise<void> {
    if (!api) return;
    try {
      const state = await api.automationState();
      root.replaceChildren(
        ...await Promise.all([skillsSection(), hooksSection(state), schedulesSection(state), watchersSection(state), offPeakSection(), connectorsSection()]),
        await scratchSection(),
        await importSection(),
      );
    } catch (error) {
      onError(errorMessage(error));
    }
  }

  return { render };
}
