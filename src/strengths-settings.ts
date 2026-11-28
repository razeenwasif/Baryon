import { noticeWords } from '../desktop/strengths/fresh.mjs';
import { modelName } from './auto-caption.js';

// Settings → Conversation → What each model is good at (docs/auto-by-task-plan.md, stage 2): the strengths table, kinds
// down and models across, a table per tier. Each cell is a score from 0 to 100 with where it came from; each number in
// it opens the page it was quoted from, at the words it was quoted from. Read-only but for Refresh, which reads the
// benchmark pages and asks the scout once per page after you say so. Auto doesn't pick by it yet.
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

const TIER_WORDS: Record<string, string> = { extreme: 'Extreme tier', heavy: 'Heavy tier', standard: 'Standard tier', light: 'Light tier' };
const LAYER_WORDS: Record<string, string> = { public: 'web', evals: 'your evals', use: 'use' };
export const KIND_WORDS: Record<string, string> = {
  code: 'Code',
  maths: 'Maths',
  circuits: 'Circuits',
  research: 'Research',
  data: 'Data',
  business: 'Business',
  writing: 'Writing',
  vision: 'Vision',
  teaching: 'Teaching',
};
const day = (stamp: string): string => {
  const at = new Date(stamp);
  return Number.isNaN(at.getTime()) ? '' : at.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
};
const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export interface StrengthsLayerFound {
  amount: number;
}

export interface StrengthsCellSource {
  benchmark: string;
  value: string | number;
  url: string;
  quote: string;
  source: string;
  fetched: string;
}

export interface StrengthsCell {
  model: string;
  score: number | null;
  layers?: Record<string, StrengthsLayerFound>;
  sources: StrengthsCellSource[];
}

export interface StrengthsRow {
  kind: string;
  cells: StrengthsCell[];
}

export interface StrengthsColumn {
  model: string;
  name: string;
}

export interface StrengthsTierView {
  tier: string;
  columns: StrengthsColumn[];
  rows: StrengthsRow[];
}

export interface StrengthsSourceStatus {
  problem?: string;
  fetched?: string;
  read?: string;
  kept?: number;
  unscored?: number;
  aside?: number;
  dropped?: number;
}

export interface StrengthsSourceInfo {
  id: string;
  name: string;
  url: string;
  kinds: string[];
  about: string;
  status?: StrengthsSourceStatus | null;
}

export interface StrengthsNotice {
  id: string;
  type: string;
  provider?: string;
  model?: string;
  level?: string;
  days?: number;
  at?: string;
}

export interface StrengthsRefreshingState {
  done: number;
  total: number;
  current: string;
}

export interface StrengthsState {
  refreshing?: StrengthsRefreshingState | null;
  sources: StrengthsSourceInfo[];
  problems?: string[];
  notices?: StrengthsNotice[];
  view: StrengthsTierView[];
  kindsWithSources: string[];
  pinned?: Record<string, string>;
  kinds?: string[];
  where?: string;
}

export interface StrengthsSettingsApi {
  strengthsState?: () => Promise<StrengthsState>;
  strengthsStop?: () => Promise<unknown>;
  strengthsRefresh?: () => Promise<unknown>;
  strengthsDismiss?: (id: string) => Promise<unknown>;
  strengthsPin?: (kind: string, model: string) => Promise<unknown>;
  openSource: (url: string) => Promise<unknown>;
}

export interface StrengthsSettingsOptions {
  api?: StrengthsSettingsApi | null;
  root: HTMLElement;
  onError?: (message: string) => void;
}

export interface StrengthsSettingsController {
  render: () => Promise<void>;
  stop: () => void;
}

// The page a number came from, scrolled to its words where the browser can (a text fragment).
export function quoteLink(url: string, quote = ''): string {
  const whole = String(quote).replace(/\s+/g, ' ').trim();
  // At most 80 characters, cut at a word.
  const words = whole.length > 80 ? whole.slice(0, 80).replace(/\s\S*$/, '') : whole;
  if (!words) return url;
  const base = String(url).split('#')[0];
  return `${base}#:~:text=${encodeURIComponent(words).replace(/-/g, '%2D')}`;
}

// A cell's words: "71" and "web · 2 sources", or nothing known.
export function cellWords(cell?: { score?: number | null; layers?: Record<string, StrengthsLayerFound> } | null): { score: string; note: string } {
  if (cell?.score == null) return { score: '–', note: '' };
  const layers = Object.entries(cell.layers || {}).map(([layer, found]) =>
    layer === 'public'
      ? `${LAYER_WORDS.public} · ${found.amount} source${found.amount === 1 ? '' : 's'}`
      : `${LAYER_WORDS[layer] || layer} · ${found.amount}`,
  );
  return { score: String(Math.round(cell.score)), note: layers.join(', ') };
}

// Settings → Conversation → Auto by task: the kinds and providers as ticks, kept in the form's hidden autoKinds and
// autoProviders (comma lists) so the Settings save bar saves them with everything else.
export function setupAutoChoices(form: HTMLFormElement): { sync: () => void } {
  const boxes = (attribute: string): HTMLInputElement[] => [...form.querySelectorAll<HTMLInputElement>(`input[${attribute}]`)];
  const field: Record<string, string> = { 'data-auto-kind': 'autoKinds', 'data-auto-provider': 'autoProviders' };
  const elements = form.elements as unknown as Record<string, { value: string } | undefined>;
  const sync = () => {
    for (const [attribute, name] of Object.entries(field)) {
      const on = new Set(String(elements[name]?.value || '').split(',').filter(Boolean));
      for (const box of boxes(attribute)) box.checked = on.has(box.getAttribute(attribute) || '');
    }
  };
  for (const [attribute, name] of Object.entries(field)) {
    for (const box of boxes(attribute)) {
      box.addEventListener('change', () => {
        const target = elements[name];
        if (target) {
          target.value = boxes(attribute).filter(item => item.checked).map(item => item.getAttribute(attribute)).join(',');
        }
        form.dispatchEvent(new Event('change'));
      });
    }
  }
  return { sync };
}

export function setupStrengthsSettings({ api, root, onError = () => {} }: StrengthsSettingsOptions): StrengthsSettingsController {
  let polling: ReturnType<typeof setInterval> | null = null, open = '';
  const stopPolling = () => { if (polling) clearInterval(polling); polling = null; };
  async function render(): Promise<void> {
    if (!api?.strengthsState) { root.replaceChildren(); return; }
    let state: StrengthsState;
    try { state = await api.strengthsState(); } catch (error) { root.replaceChildren(el('p', 'field-note', errorMessage(error))); return; }
    const running = state.refreshing;
    if (running && !polling) polling = setInterval(() => void render(), 3000);
    if (!running) stopPolling();
    const head = el('div', 'evals-head'); head.append(el('h4', '', 'What each model is good at'));
    const actions = el('div', 'evals-actions');
    const stop = el('button', 'panel-button quiet', 'Stop'); stop.type = 'button'; stop.hidden = !running;
    stop.onclick = async () => { stop.disabled = true; try { await api.strengthsStop?.(); } catch (error) { onError(errorMessage(error)); } };
    const refresh = el('button', 'panel-button', 'Refresh'); refresh.type = 'button'; refresh.disabled = Boolean(running) || !state.sources.length;
    refresh.onclick = async () => {
      const count = state.sources.length;
      if (!window.confirm(`Refresh reads ${count} benchmark page${count === 1 ? '' : 's'} on the web and asks your scout model once per page to find the numbers, on your plan. Go ahead?`)) return;
      refresh.disabled = true;
      try { await api.strengthsRefresh?.(); } catch (error) { onError(errorMessage(error)); }
      await render();
    };
    actions.append(stop, refresh); head.append(actions);
    const intro = el('p', 'field-note', 'How each model you can use does on each kind of task, scored 0 to 100 and compared only within a tier. Two kinds of evidence so far: benchmark numbers read from the web, the weakest (often the maker’s own, on tasks that aren’t yours), and Fairy’s own evals by kind, which count most. Run those from a terminal, a kind at a time, on your plan: node scripts/eval.mjs --kinds maths --provider claude --model claude-opus-5-5. Each run is also kept under Evals by kind in Experiments. Auto picks by this table only for the kinds you turn on under Auto by task, above.');
    const parts: HTMLElement[] = [head, intro];
    if (running) parts.push(el('p', 'field-note evals-progress', `Reading ${Math.min(running.done + 1, running.total)} of ${running.total}: ${running.current}`));
    for (const problem of state.problems || []) parts.push(el('p', 'field-note strengths-problem', problem));
    // Stage 7's notices: a new model to run evals on, or month-old web numbers to refresh.
    for (const notice of state.notices || []) {
      const box = el('div', 'strengths-notice'), words = noticeWords(notice, { name: modelName });
      const text = el('div', 'evals-text'); text.append(el('b', '', words.title), el('span', 'field-note', words.body));
      const buttons = el('div', 'evals-actions');
      if (notice.type === 'stale') { const again = el('button', 'panel-button', 'Refresh'); again.type = 'button'; again.disabled = Boolean(running); again.onclick = () => refresh.click(); buttons.append(again); }
      const away = el('button', 'panel-button quiet', 'Dismiss'); away.type = 'button';
      away.onclick = async () => { try { await api.strengthsDismiss?.(notice.id); } catch (error) { onError(errorMessage(error)); } await render(); };
      buttons.append(away); box.append(text, buttons); parts.push(box);
    }
    const known = state.view.some(tier => tier.rows.some(row => row.cells.some(cell => cell.score != null)));
    if (!state.view.length) parts.push(el('p', 'field-note', 'No models to show yet: sign in to Claude, Gemini or Codex under Accounts & keys.'));
    else if (!known) parts.push(el('p', 'field-note', running ? 'Nothing found yet.' : 'Nothing read yet. Refresh reads the sources below.'));
    for (const tier of state.view) {
      const wrap = el('div', 'strengths-tier'); wrap.append(el('h5', '', TIER_WORDS[tier.tier] || tier.tier));
      // A tier nothing is known about yet is one line, not a grid of dashes.
      if (known && !tier.rows.some(row => row.cells.some(cell => cell.score != null))) {
        wrap.append(el('p', 'field-note', `Nothing yet for ${tier.columns.map(column => column.name).join(', ')}.`)); parts.push(wrap); continue;
      }
      const table = el('table', 'strengths-table'), headRow = el('tr');
      headRow.append(el('th', '', 'Kind'), ...tier.columns.map(column => { const th = el('th', '', column.name); th.title = column.model; return th; }));
      const thead = el('thead'); thead.append(headRow);
      const body = el('tbody');
      for (const row of tier.rows) {
        const tr = el('tr'), heard = state.kindsWithSources.includes(row.kind);
        const kindCell = el('th', '', KIND_WORDS[row.kind] || row.kind); kindCell.scope = 'row';
        if (!heard) kindCell.title = 'No web source speaks to this kind; it fills from your own evals.';
        tr.append(kindCell);
        for (const cell of row.cells) {
          const td = el('td', cell.score == null ? 'empty' : ''), words = cellWords(cell), id = `${tier.tier}:${row.kind}:${cell.model}`;
          const button = el('button', 'strengths-cell'); button.type = 'button'; button.disabled = cell.score == null;
          button.append(el('b', '', words.score), el('small', '', words.note));
          button.setAttribute('aria-expanded', String(open === id));
          button.onclick = () => { open = open === id ? '' : id; void render(); };
          td.append(button);
          if (open === id && cell.sources.length) {
            const list = el('ul', 'strengths-sources');
            for (const source of cell.sources) {
              const li = el('li'), link = el('a', '', `${source.benchmark}: ${source.value}`);
              link.href = quoteLink(source.url, source.quote); link.onclick = event => { event.preventDefault(); void api.openSource(link.href).catch((err: unknown) => onError(errorMessage(err))); };
              li.append(link, el('small', '', ` ${state.sources.find(s => s.id === source.source)?.name || source.source}, read ${day(source.fetched)}`));
              li.title = `“${source.quote}”`;
              list.append(li);
            }
            td.append(list);
          }
          tr.append(td);
        }
        body.append(tr);
      }
      table.append(thead, body); wrap.append(table); parts.push(wrap);
    }
    // Pins (decision 7): a model for a kind that outranks every score, while its provider can take the request.
    const models = [...new Map(state.view.flatMap(tier => tier.columns).map(column => [column.model, column])).values()];
    const pins = el('details', 'strengths-source-list strengths-pins'); pins.open = Object.keys(state.pinned || {}).length > 0;
    pins.append(el('summary', '', `Pins (${Object.keys(state.pinned || {}).length})`), el('p', 'field-note', 'A pinned model answers that kind when Auto by task is on for it, whatever the scores, unless its provider is signed out or past your allowance.'));
    const grid = el('div', 'strengths-pin-grid');
    for (const kind of state.kinds || []) {
      const label = el('label', 'strengths-pin'), select = el('select');
      select.append(Object.assign(el('option', '', 'No pin'), { value: '' }), ...models.map(column => Object.assign(el('option', '', column.name), { value: column.model })));
      select.value = state.pinned?.[kind] || '';
      select.setAttribute('aria-label', `Pin a model for ${KIND_WORDS[kind] || kind}`);
      select.onchange = async () => { try { await api.strengthsPin?.(kind, select.value); } catch (error) { onError(errorMessage(error)); } await render(); };
      label.append(el('span', '', KIND_WORDS[kind] || kind), select); grid.append(label);
    }
    pins.append(grid); parts.push(pins);
    // The sources, each with when it was last read and what came of it.
    const details = el('details', 'strengths-source-list'); details.append(el('summary', '', `Sources (${state.sources.length})${state.where === 'yours' ? ' · your list' : ''}`));
    const list = el('ul', 'evals-list');
    for (const source of state.sources) {
      const li = el('li', 'evals-item'), text = el('div', 'evals-text');
      const name = el('a', '', source.name); name.href = source.url; name.onclick = event => { event.preventDefault(); void api.openSource(source.url).catch((err: unknown) => onError(errorMessage(err))); };
      const status = source.status;
      const said = !status ? 'Not read yet.' : status.problem ? `${status.problem}${status.fetched ? ` Last read ${day(status.fetched)}.` : ''}`
        : `Read ${day(status.read || '')}: ${status.kept} number${status.kept === 1 ? '' : 's'} for your models${status.unscored ? ` (${status.unscored} not percentages, shown only)` : ''}, ${status.aside} for other models set aside, ${status.dropped} dropped as not quoted.`;
      text.append(name, el('span', 'field-note', `${source.kinds.map(kind => KIND_WORDS[kind] || kind).join(', ')} · ${source.about}`), el('span', 'field-note', said));
      li.append(text); list.append(li);
    }
    details.append(list, el('p', 'field-note', 'To change the list, put your own strengths-sources.json in Fairy’s data folder, in the same shape as desktop/strengths/sources.json. Each page is read as data: only numbers quoted from it, beside the model’s name, are kept.'));
    parts.push(details);
    root.replaceChildren(...parts);
  }
  return { render, stop: stopPolling };
}
