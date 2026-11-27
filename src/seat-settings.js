// Settings → Work sessions → Models for each role: the model the orchestrator's lead, builder and scout, and Swarm's
// designer, use on each provider. Automatic (empty) leaves the choice to Fairy, as before; a model chosen here is used
// whenever its provider offers it (desktop/orchestrator.mjs, seatChoices and swarmChoices).
// The selects carry the settings' own names, so the form saves them with everything else.
import { CLAUDE_MODELS } from './model-menu.js';

export const SEAT_ROWS = Object.freeze([
  { role: 'lead', name: 'Lead', note: 'Plans a work turn, briefs and checks the steps. Used with work Auto on, for a turn that needs a plan or that Auto rates heavy or harder.' },
  { role: 'builder', name: 'Builder', note: 'Carries out a step the lead wrote a brief for.' },
  { role: 'scout', name: 'Scout', note: 'Quick jobs: searches, notes on older messages, helper questions.' },
  { role: 'swarm', name: 'Council designer', note: 'Each provider’s designer in a /council design debate.' },
]);
export const SEAT_COLUMNS = Object.freeze([{ provider: 'claude', name: 'Claude' }, { provider: 'gemini', name: 'Gemini' }, { provider: 'codex', name: 'Codex' }]);
const cap = word => word[0].toUpperCase() + word.slice(1);
export const seatKey = (role, provider) => role === 'swarm' ? `swarm${cap(provider)}` : `orch${cap(role)}${cap(provider)}`;

// The models a provider's seats can take, as [{ id, name }]: Claude's own list; Gemini's from agy, without agy's own
// Orchestrator entries (not one model) and without other makers' models; Codex's GPT models.
export function seatModels(provider, lists = {}) {
  const tidy = list => (Array.isArray(list) ? list : []).map(item => typeof item === 'string' ? { id: item, name: item } : { id: item?.id, name: item?.name || item?.displayName || item?.id }).filter(item => typeof item.id === 'string' && item.id);
  if (provider === 'claude') return CLAUDE_MODELS.map(({ id, name }) => ({ id, name }));
  if (provider === 'gemini') return tidy(lists.gemini).filter(item => /^gemini-/.test(item.id) && !/^gemini-pro-orchestrator/.test(item.id));
  if (provider === 'codex') return tidy(lists.codex).filter(item => /^gpt-/.test(item.id));
  return [];
}

// A select's options: Automatic, the provider's models, and the saved choice kept when the provider doesn't list it now
// (signed out, or a model it no longer offers), marked so, so opening Settings never quietly drops it.
export function seatOptions(provider, lists, current = '') {
  const models = seatModels(provider, lists), options = [{ value: '', label: 'Automatic' }, ...models.map(item => ({ value: item.id, label: item.name }))];
  if (current && !models.some(item => item.id === current)) options.push({ value: current, label: `${current} (not offered now)` });
  return options;
}

export function renderSeatSettings({ root, settings = {}, lists = {} }) {
  if (!root) return;
  // Choices made since Settings opened survive a redraw when the model lists arrive.
  const now = Object.fromEntries([...root.querySelectorAll('select[name]')].map(select => [select.name, select.value]));
  const grid = document.createElement('div'); grid.className = 'seat-models'; grid.setAttribute('role', 'table'); grid.setAttribute('aria-label', 'Models for each role');
  const cell = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node; };
  const head = cell('div', 'seat-row seat-head'); head.setAttribute('role', 'row');
  head.append(cell('span', 'seat-role', ''), ...SEAT_COLUMNS.map(column => { const node = cell('span', 'seat-provider', column.name); node.setAttribute('role', 'columnheader'); return node; }));
  grid.append(head);
  for (const row of SEAT_ROWS) {
    const line = cell('div', 'seat-row'); line.setAttribute('role', 'row');
    const label = cell('span', 'seat-role', row.name); label.title = row.note; label.setAttribute('role', 'rowheader');
    line.append(label);
    for (const column of SEAT_COLUMNS) {
      const key = seatKey(row.role, column.provider), current = key in now ? now[key] : settings[key] || '';
      const select = document.createElement('select');
      select.name = key; select.setAttribute('aria-label', `${row.name} on ${column.name}`); select.title = row.note;
      for (const option of seatOptions(column.provider, lists, current)) { const node = document.createElement('option'); node.value = option.value; node.textContent = option.label; select.append(node); }
      select.value = current;
      line.append(select);
    }
    grid.append(line);
  }
  root.replaceChildren(grid);
}
