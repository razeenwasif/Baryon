const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export interface ModelItem {
  id: string;
  name?: string;
}

export interface CollapsedModelEntry {
  id: string;
  name: string;
  levels: Record<string, string>;
  plain?: string;
}

export interface ModelGroupNote {
  text: string;
  fix?: boolean;
}

export interface ModelGroup {
  provider: string;
  name: string;
  note: ModelGroupNote | null;
  orchestrator: boolean;
  models: CollapsedModelEntry[];
}

export type ModelSettingsLike = Record<string, any>;

export const CLAUDE_MODELS: ModelItem[] = [
  { id: 'claude-fable-5-2', name: 'Fable 5.2' },
  { id: 'claude-opus-5-5', name: 'Opus 5.5' },
  { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5' },
  { id: 'claude-haiku-5-5', name: 'Haiku 5.5' },
];

// Used until DeepSeek's own list has been read.
const DEEPSEEK_MODELS: ModelItem[] = [
  { id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash' },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
];

const STALE = 10 * 60 * 1000;
const PROVIDER_NAMES: Record<string, string> = { claude: 'Claude', gemini: 'Gemini', codex: 'Codex', deepseek: 'DeepSeek' };

export const PLACEHOLDER_PROVIDERS = Object.freeze([
  { provider: 'cursor', name: 'Cursor' },
  { provider: 'grok', name: 'Grok' },
  { provider: 'opencode', name: 'OpenCode' },
  { provider: 'pi', name: 'Pi' },
  { provider: 'kiro', name: 'Kiro' },
  { provider: 'fx', name: 'FX' },
  { provider: 'muse', name: 'Muse' },
]);

// The providers the orchestrator can pick models for, by Auto's names, and each one's settings name.
const ORCHESTRATED: Record<string, string> = { claude: 'claude', gemini: 'antigravity', codex: 'codex' };

// Efforts. Claude and Codex keep effort apart from the model; Gemini's is part of the model's name, as Antigravity lists
// each model once per effort ("gemini-4-argon-low", "…-medium", "…-high"). The menu shows each Gemini model once and
// the effort picker beside it chooses between them.
export const EFFORT_NAMES: Record<string, string> = { '': 'Default', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra', max: 'Max' };
const LEVELS = ['low', 'medium', 'high', 'xhigh'] as const;
const LEVEL = /-(low|medium|high|xhigh)$/;

export const baseModel = (id = ''): string => String(id || '').replace(LEVEL, '');
export const levelOf = (id = ''): string => String(id || '').match(LEVEL)?.[1] || '';

const plainName = (item: ModelItem): string => {
  const named = item.name && item.name !== item.id ? String(item.name).replace(/\s*[([]?\s*(?:low|medium|high|x-?high|extra high)\s*[)\]]?\s*$/i, '').trim() : '';
  return named || baseModel(item.id).split('-').filter(Boolean).map(word => /^gpt$/i.test(word) ? 'GPT' : /^\d/.test(word) ? word : word[0].toUpperCase() + word.slice(1)).join(' ');
};

// One entry per model: { id: its name without the effort, name, levels: { low: id, … } }, or plain: id for a model that
// comes in one effort only.
export function collapseLevels(models: ModelItem[] = []): CollapsedModelEntry[] {
  const found = new Map<string, CollapsedModelEntry>();
  for (const item of models) {
    const id = baseModel(item.id), level = levelOf(item.id);
    if (!found.has(id)) found.set(id, { id, name: plainName(item), levels: {} });
    const entry = found.get(id)!;
    if (level) entry.levels[level] = item.id; else entry.plain = item.id;
  }
  return [...found.values()];
}

// The id to run a model at an effort: that effort if it has it, otherwise the nearest, the higher on a tie.
export function variantFor(entry: CollapsedModelEntry | null | undefined, effort = 'high'): string {
  if (!entry) return '';
  const levels = Object.keys(entry.levels || {});
  if (!levels.length) return entry.plain || entry.id;
  const want = effort === 'max' ? 'xhigh' : (LEVELS as readonly string[]).includes(effort) ? effort : 'high';
  if (entry.levels[want]) return entry.levels[want];
  const at = (LEVELS as readonly string[]).indexOf(want);
  const idx = (k: string) => (LEVELS as readonly string[]).indexOf(k);
  return entry.levels[levels.sort((a, b) => Math.abs(idx(a) - at) - Math.abs(idx(b) - at) || idx(b) - idx(a))[0]];
}

function effectiveSettings(settings: ModelSettingsLike, work = false, sessionProvider = ''): ModelSettingsLike {
  if (work && ORCHESTRATED[sessionProvider]) {
    return { ...settings, workProvider: ORCHESTRATED[sessionProvider] };
  }
  return settings;
}

// Work sessions choose separately from chats, so a big job on Opus can sit beside quick chats on Gemini.
export function currentModel(settings: ModelSettingsLike, work = false, sessionProvider = ''): { provider: string; model: string } {
  const resolved = effectiveSettings(settings, work, sessionProvider);
  if (work) {
    if (resolved.workProvider === 'antigravity') return { provider: 'gemini', model: resolved.workGeminiModel || resolved.antigravityModel };
    if (resolved.workProvider === 'codex') return { provider: 'codex', model: resolved.workCodexModel || resolved.desktopModel };
    return { provider: 'claude', model: resolved.workClaudeModel };
  }
  if (resolved.backend === 'antigravity') return { provider: 'gemini', model: resolved.antigravityModel };
  if (resolved.backend === 'claude') return { provider: 'claude', model: resolved.claudeModel };
  return { provider: resolved.backend, model: resolved.model };
}

// The effort the current model runs at, and the ones it can. A chat on Claude can also stay at Claude Code's default.
export function currentEffort(settings: ModelSettingsLike, work = false, groups: ModelGroup[] = [], sessionProvider = ''): { provider: string; effort: string; choices: string[] } {
  const { provider, model } = currentModel(settings, work, sessionProvider), three = ['low', 'medium', 'high'];
  if (provider === 'gemini') {
    const entry = groups.find(group => group.provider === 'gemini')?.models.find(item => item.id === baseModel(model));
    return { provider, effort: levelOf(model), choices: entry ? LEVELS.filter(level => entry.levels?.[level]) : levelOf(model) ? [levelOf(model)] : [] };
  }
  if (provider === 'claude') return work ? { provider, effort: settings.workEffort || 'high', choices: ['low', 'medium', 'high', 'xhigh', 'max'] } : { provider, effort: settings.claudeEffort || '', choices: ['', 'low', 'medium', 'high', 'xhigh', 'max'] };
  if (provider === 'codex') return { provider, effort: work ? (three.includes(settings.workEffort) ? settings.workEffort : 'high') : settings.reasoning, choices: three };
  if (provider === 'deepseek') return { provider, effort: settings.reasoning, choices: three };
  return { provider, effort: '', choices: [] };
}

// The settings a choice changes:
//   { provider, model }     a model by hand, which turns the orchestrator off: your choice wins
//   { provider, auto: true } the orchestrator for that provider: Fairy picks its model and effort for each request, and
//                           in a work session plans big tasks and hands their steps to faster models
//   { auto: false }          the orchestrator off, keeping the model you had
//   { provider, effort }     Claude's or Codex's effort (Gemini's effort is a model, so its picker sends one)
export function modelChange({ work = false, provider, model, auto, effort }: { work?: boolean; provider?: string; model?: string; auto?: boolean; effort?: string }): Record<string, unknown> {
  const autoKey = work ? 'workAutoModel' : 'autoModel';
  if (auto === false) return { [autoKey]: 'off' };
  if (auto === true) {
    if (!provider) return { [autoKey]: 'on' };
    if (!ORCHESTRATED[provider]) throw new Error('The orchestrator works with Claude, Gemini or Codex.');
    // A chat's Codex and DeepSeek models share one setting, so moving a chat to Codex brings a Codex model with it.
    return work ? { workProvider: ORCHESTRATED[provider], [autoKey]: 'on' } : { backend: ORCHESTRATED[provider], ...(provider === 'codex' && model ? { model } : {}), [autoKey]: 'on' };
  }
  if (typeof effort === 'string') {
    if (work) return { workEffort: effort };
    return provider === 'claude' ? { claudeEffort: effort } : { reasoning: effort };
  }
  if (typeof model !== 'string' || !model) throw new Error('Choose a model.');
  if (work) {
    if (provider === 'claude') return { workProvider: 'claude', workClaudeModel: model, [autoKey]: 'off' };
    if (provider === 'gemini') return { workProvider: 'antigravity', workGeminiModel: model, [autoKey]: 'off' };
    if (provider === 'codex') return { workProvider: 'codex', workCodexModel: model, [autoKey]: 'off' };
    throw new Error('Work sessions can use Claude, Gemini or Codex.');
  }
  if (provider === 'claude') return { backend: 'claude', claudeModel: model, [autoKey]: 'off' };
  if (provider === 'gemini') return { backend: 'antigravity', antigravityModel: model, [autoKey]: 'off' };
  if (provider === 'codex' || provider === 'deepseek') return { backend: provider, model, [autoKey]: 'off' };
  throw new Error('Choose Claude, Gemini, Codex or DeepSeek.');
}

// Whether the orchestrator is on here, and whether it can work: it needs a Gemini API key (Auto's decisions), and a
// provider with sizes to choose from.
export function autoState(settings: ModelSettingsLike, work = false, hasKey = false, sessionProvider = '') {
  const on = (work ? settings.workAutoModel : settings.autoModel) === 'on', { provider } = currentModel(settings, work, sessionProvider);
  const usable = Boolean(ORCHESTRATED[provider]);
  return { on, provider, providerName: PROVIDER_NAMES[provider] || provider, working: on && hasKey && usable, note: !hasKey ? 'Needs a Gemini API key' : !usable ? `Not for ${PROVIDER_NAMES[provider] || provider}` : '' };
}

export function modelGroups({
  settings,
  work = false,
  lists = {},
  connected = {},
  sessionProvider = '',
}: {
  settings: ModelSettingsLike;
  work?: boolean;
  lists?: Record<string, ModelItem[] | null | undefined>;
  connected?: Record<string, boolean | undefined>;
  sessionProvider?: string;
}): ModelGroup[] {
  const current = currentModel(settings, work, sessionProvider), signIn: ModelGroupNote = { text: 'Not signed in', fix: true };
  const listNote = (list: ModelItem[] | null | undefined): ModelGroupNote | null =>
    list === undefined ? { text: 'Loading…' } : list === null ? { text: 'Couldn’t load its models' } : null;
  const group = (provider: string, name: string, models: CollapsedModelEntry[], note: ModelGroupNote | null): ModelGroup => {
    const gemini = provider === 'gemini', chosen = current.provider === provider ? (gemini ? baseModel(current.model) : current.model) : '';
    const kept: CollapsedModelEntry = gemini
      ? { id: chosen, name: plainName({ id: current.model }), levels: levelOf(current.model) ? { [levelOf(current.model)]: current.model } : {}, ...(levelOf(current.model) ? {} : { plain: current.model }) }
      : { id: chosen, name: chosen, levels: {} };
    return { provider, name, note, orchestrator: Boolean(ORCHESTRATED[provider]), models: chosen && !models.some(model => model.id === chosen) ? [...models, kept] : models };
  };
  const toEntries = (raw: ModelItem[]): CollapsedModelEntry[] => raw.map(m => ({ id: m.id, name: m.name || m.id, levels: {} }));
  return [
    group('claude', 'Claude', toEntries(CLAUDE_MODELS), connected.claude ? null : signIn),
    group('gemini', 'Gemini', collapseLevels(lists.gemini ?? []), connected.gemini ? null : signIn),
    group('codex', 'Codex', toEntries(lists.codex ?? []), connected.codex ? listNote(lists.codex) : signIn),
    group('deepseek', 'DeepSeek', toEntries(lists.deepseek ?? DEEPSEEK_MODELS), work ? { text: 'For chats only' } : connected.deepseek ? null : { text: 'Needs your API key', fix: true }),
  ];
}

// pick: what the orchestrator chose last ({ provider, model, where }), shown beside its name while it's for this scope
// and provider.
export function modelLabel(
  settings: ModelSettingsLike,
  work: boolean,
  groups: ModelGroup[],
  { hasKey = false, pick = null, sessionProvider = '' }: { hasKey?: boolean; pick?: { provider?: string; model?: string; where?: string } | null; sessionProvider?: string } = {},
): string {
  const { provider, model } = currentModel(settings, work, sessionProvider);
  const nameOf = (id: string, kind = provider) => {
    const list = groups.find(group => group.provider === kind)?.models || [];
    return list.find(item => item.id === id)?.name || list.find(item => item.id === baseModel(id))?.name || id;
  };
  const auto = autoState(settings, work, hasKey, sessionProvider);
  if (auto.working) return pick && pick.provider === provider && (pick.where === 'work') === work ? `Orchestrator · ${nameOf(pick.model || '')}` : 'Orchestrator';
  return nameOf(model) || 'Choose a model';
}

// A pop-up list beside the message box: opens above its button, closes on Escape or a click elsewhere, and moves with
// the arrow keys.
function popUp({
  button,
  parent,
  id,
  label,
  draw,
  onOpen = () => {},
}: {
  button: HTMLElement;
  parent: HTMLElement;
  id: string;
  label: string;
  draw: (menu: HTMLDivElement, close: (focus?: boolean) => void) => void;
  onOpen?: () => void;
}) {
  const menu = element('div', 'model-menu');
  menu.id = id; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', label); menu.hidden = true;
  button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-controls', id);
  parent.append(menu);
  const items = () => [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
  const close = (focus = true) => { if (menu.hidden) return; menu.hidden = true; button.setAttribute('aria-expanded', 'false'); if (focus) button.focus(); };
  button.onclick = () => {
    if (!menu.hidden) { close(); return; }
    menu.hidden = false; button.setAttribute('aria-expanded', 'true');
    draw(menu, close);
    // Only as tall as the room above the message box (below the window's title bar), scrolling for the rest, so a box
    // sitting partway down the window, as on a new chat, never pushes the menu's top out of sight.
    const anchor = (menu.offsetParent || menu.parentElement) as HTMLElement | null;
    const above = (anchor?.getBoundingClientRect().top ?? 300) - 10 - 52;
    menu.style.maxHeight = `${Math.round(Math.max(140, Math.min(560, above)))}px`;
    (menu.querySelector<HTMLButtonElement>('[aria-checked="true"]:not(:disabled)') ?? items()[0])?.focus();
    onOpen();
  };
  menu.addEventListener('keydown', event => {
    const all = items(), at = all.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); all[(at + 1) % all.length]?.focus(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); all[(at - 1 + all.length) % all.length]?.focus(); }
  });
  document.addEventListener('pointerdown', event => {
    const target = event.target as Node | null;
    if (target && !menu.contains(target) && !button.contains(target)) close(false);
  });
  return { menu, close, redraw: () => { if (!menu.hidden) draw(menu, close); } };
}

const item = (text: string, role: string, checked: boolean | null, onclick: () => void) => {
  const row = element('button', 'model-item', text);
  row.type = 'button'; row.setAttribute('role', role);
  if (checked !== null) row.setAttribute('aria-checked', String(checked));
  row.onclick = onclick;
  return row;
};

// The provider a choice of provider leads to: the Orchestrator for it while the Orchestrator is on (DeepSeek has none, so
// it's chosen by hand), otherwise the model you last had there, or its first.
export function providerChoice(settings: ModelSettingsLike, work: boolean, provider: string, groups: ModelGroup[] = []) {
  const auto = (work ? settings.workAutoModel : settings.autoModel) === 'on', listed = groups.find(group => group.provider === provider)?.models || [];
  const first = provider === 'gemini' ? variantFor(listed[0], 'high') : listed[0]?.id;
  const shared = settings.backend === provider ? settings.model : '';
  if (auto && ORCHESTRATED[provider]) return { work, provider, auto: true, ...(provider === 'codex' && !work ? { model: shared || first } : {}) };
  const remembered: Record<string, string | undefined> = work
    ? { claude: settings.workClaudeModel, gemini: settings.workGeminiModel || settings.antigravityModel, codex: settings.workCodexModel || settings.desktopModel }
    : { claude: settings.claudeModel, gemini: settings.antigravityModel, codex: shared, deepseek: shared };
  const model = remembered[provider] || first;
  if (!model) throw new Error(`${PROVIDER_NAMES[provider] || provider} has no models to choose yet.`);
  return { work, provider, model };
}

export interface ModelMenuApi {
  setModel: (choice: unknown) => Promise<any>;
  modelLists?: () => Promise<any>;
}

// Three selectors beside the mic: the provider (its icon), the model (Orchestrator or one by hand) and the effort, which
// is greyed out while the Orchestrator picks it.
export function setupModelMenu({
  api,
  button,
  providerButton = null,
  effortButton = null,
  parent,
  state,
  onChange,
  onError,
  openSettings,
}: {
  api: ModelMenuApi;
  button: HTMLElement;
  providerButton?: HTMLElement | null;
  effortButton?: HTMLButtonElement | HTMLElement | null;
  parent: HTMLElement;
  state: () => ModelSettingsLike;
  onChange: (next: any) => void;
  onError: (msg: string) => void;
  openSettings: (pane: string) => void;
}) {
  const label = element('span');
  let lists: Record<string, ModelItem[] | null | undefined> = {}, connected: Record<string, boolean> | null = null, readAt = 0;
  button.replaceChildren(label);
  const work = () => Boolean(state().sessions?.work);
  const sessionProvider = () => String(state().sessions?.work?.provider || '');
  const hasKey = () => Boolean(state().hasGeminiKey);
  function groups() {
    const { antigravity, claude, subscription, hasDeepSeekKey, settings } = state();
    return modelGroups({ settings, work: work(), sessionProvider: sessionProvider(), lists, connected: { claude: claude?.connected, gemini: antigravity?.connected, codex: subscription?.connected, ...connected, deepseek: hasDeepSeekKey } });
  }
  async function choose(choice: unknown, close: () => void) {
    close();
    try { onChange(await api.setModel(choice)); } catch (error: unknown) { onError(error instanceof Error ? error.message : String(error)); }
  }
  async function read() {
    readAt = Date.now();
    try { ({ connected, ...lists } = await api.modelLists!()); update(); } catch { readAt = 0; }
  }
  const fresh = () => { if (api?.modelLists && Date.now() - readAt > STALE) void read(); };
  const settingsRow = (close: () => void) => {
    const more = element('button', 'model-note', 'Model settings');
    more.type = 'button'; more.setAttribute('role', 'menuitem'); more.onclick = () => { close(); openSettings('conversation'); };
    return more;
  };
  const providers = providerButton ? popUp({
    button: providerButton, parent, id: 'provider-menu', label: 'Provider', onOpen: fresh,
    draw(menu, close) {
      const { provider } = currentModel(state().settings, work(), sessionProvider()), rows: HTMLElement[] = [element('div', 'model-group', 'Provider')];
      for (const group of groups()) {
        const usable = !group.note?.fix && group.note?.text !== 'For chats only', checked = group.provider === provider;
        const row = item(group.name, 'menuitemradio', checked, () => {
          if (checked) return close();
          try { void choose(providerChoice(state().settings, work(), group.provider, groups()), close); } catch (error: unknown) { close(); onError(error instanceof Error ? error.message : String(error)); }
        });
        row.classList.add('provider-item'); row.dataset.provider = group.provider;
        if (group.note) row.append(element('small', '', group.note.text));
        if (!usable) {
          if (group.note?.fix) { row.onclick = () => { close(); openSettings('accounts'); }; row.title = `${group.note.text}: open Accounts & keys`; }
          else row.disabled = true;
        }
        rows.push(row);
      }
      rows.push(element('div', 'model-rule'), element('div', 'model-group', 'Coming soon'));
      for (const p of PLACEHOLDER_PROVIDERS) {
        const row = item(p.name, 'menuitemradio', false, () => close());
        row.classList.add('provider-item', 'is-placeholder');
        row.dataset.provider = p.provider;
        row.disabled = true;
        row.title = `${p.name} support coming soon`;
        row.append(element('small', '', 'Coming soon'));
        rows.push(row);
      }
      menu.replaceChildren(...rows);
    },
  }) : null;
  const models = popUp({
    button, parent, id: 'model-menu', label: 'Model', onOpen: fresh,
    draw(menu, close) {
      const settings = state().settings, sp = sessionProvider(), { provider, model } = currentModel(settings, work(), sp), auto = autoState(settings, work(), hasKey(), sp), group = groups().find(found => found.provider === provider), rows: HTMLElement[] = [];
      if (!group) { menu.replaceChildren(settingsRow(close)); return; }
      rows.push(element('div', 'model-group', group.name));
      if (group.note) rows.push(element('div', 'model-note', group.note.text));
      if (group.orchestrator) {
        const row = item('', 'menuitemradio', auto.on, () => auto.on ? close() : void choose({ work: work(), provider, auto: true, ...(provider === 'codex' && !work() ? { model } : {}) }, close));
        row.classList.add('model-auto');
        row.title = work() ? `Fairy picks a ${group.name} model and effort for each request, plans big tasks and hands their steps to faster models` : `Fairy picks a ${group.name} model and effort for each message`;
        const copy = element('span', 'model-auto-text');
        copy.append(element('span', '', 'Orchestrator'), element('small', '', !hasKey() ? 'Needs a Gemini API key' : work() ? 'Picks models, plans and splits big tasks' : 'Picks the model and effort each time'));
        row.replaceChildren(copy);
        rows.push(row);
        if (!hasKey()) { const fix = element('button', 'model-note', 'Add a Gemini API key'); fix.type = 'button'; fix.setAttribute('role', 'menuitem'); fix.onclick = () => { close(); openSettings('accounts'); }; rows.push(fix); }
        rows.push(element('div', 'model-rule'));
      }
      for (const entry of group.models) {
        const current = entry.id === (provider === 'gemini' ? baseModel(model) : model), checked = !auto.on && current;
        // A Gemini model keeps the effort you had on Gemini, or High.
        const pick = provider === 'gemini' ? variantFor(entry, levelOf(model) || 'high') : entry.id;
        rows.push(item(entry.name, 'menuitemradio', checked, () => checked ? close() : void choose({ work: work(), provider, model: pick }, close)));
      }
      rows.push(element('div', 'model-rule'), settingsRow(close));
      menu.replaceChildren(...rows);
    },
  });
  const efforts = effortButton ? popUp({
    button: effortButton, parent, id: 'effort-menu', label: 'Effort',
    draw(menu, close) {
      const settings = state().settings, sp = sessionProvider(), list = groups(), { provider, effort, choices } = currentEffort(settings, work(), list, sp), { model } = currentModel(settings, work(), sp);
      const entry = provider === 'gemini' ? list.find(group => group.provider === 'gemini')?.models.find(found => found.id === baseModel(model)) : null;
      const rows: HTMLElement[] = [element('div', 'model-group', 'Effort')];
      for (const level of choices) {
        const checked = level === (effort || '');
        rows.push(item(EFFORT_NAMES[level] ?? level, 'menuitemradio', checked, () => checked ? close() : void choose(provider === 'gemini' ? { work: work(), provider, model: variantFor(entry, level) } : { work: work(), provider, effort: level }, close)));
      }
      menu.replaceChildren(...rows);
    },
  }) : null;
  function update() {
    const settings = state().settings, sp = sessionProvider(), list = groups(), { provider } = currentModel(settings, work(), sp), auto = autoState(settings, work(), hasKey(), sp);
    label.textContent = modelLabel(settings, work(), list, { hasKey: hasKey(), pick: state().autoPick, sessionProvider: sp });
    button.dataset.orchestrator = String(Boolean(auto.on));
    button.title = `Model for this ${work() ? 'work session' : 'chat'}: ${label.textContent}`;
    if (providerButton && providers) {
      providerButton.dataset.provider = provider;
      providerButton.setAttribute('aria-label', `Provider: ${PROVIDER_NAMES[provider] || provider}`);
      providerButton.title = `Provider: ${PROVIDER_NAMES[provider] || provider}`;
      providers.redraw();
    }
    if (effortButton && efforts) {
      const { effort, choices } = currentEffort(settings, work(), list, sp), name = EFFORT_NAMES[effort || ''] ?? effort;
      effortButton.hidden = choices.length < 2;
      // The Orchestrator picks the effort, so the bulb is greyed out while it's on.
      if ('disabled' in effortButton) (effortButton as HTMLButtonElement).disabled = auto.on;
      effortButton.title = auto.on ? 'Effort: the Orchestrator picks it' : `Effort: ${name}`;
      effortButton.setAttribute('aria-label', effortButton.title);
      if (auto.on) efforts.close(false);
      efforts.redraw();
    }
    models.redraw();
  }
  if (api?.modelLists) void read();
  update();
  return { update, close: () => { models.close(); efforts?.close(); providers?.close(); } };
}
