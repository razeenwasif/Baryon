import type { BaryonPreloadApi } from '../desktop/ipc-contract.js';

export interface MemoryItem {
  id: string;
  kind: string;
  text: string;
  source?: string;
}

export interface MemoryChange {
  action: string;
  text: string;
}

export interface MemoryReflection {
  at?: string | number;
  undone?: boolean;
  changes?: MemoryChange[];
}

export interface MemoryState {
  items: MemoryItem[];
  used: string[];
  lastReflection: MemoryReflection | null;
  canUndo: boolean;
}

export interface SetupMemorySettingsOptions {
  api: BaryonPreloadApi | null | undefined;
  root: HTMLElement;
}

const KINDS: Record<string, string> = {
  you: 'About you',
  projects: 'Projects and goals',
  self: 'Fairy’s history',
  work: 'Development projects',
};

const ACTIONS: Record<string, string> = {
  added: 'Added',
  updated: 'Updated',
  removed: 'Removed',
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function setupMemorySettings({ api, root }: SetupMemorySettingsOptions): { refresh: () => Promise<boolean> } {
  root.insertAdjacentHTML('beforeend', `<section id="long-term-memory"><h4>Long-term memory</h4>
    <p class="field-note">Lasting notes that every conversation provider can use, stored on this Mac. Each reply only gets the notes that fit the request. Work sessions always get your Development projects notes, and no others. You can edit or remove anything here.</p>
    <label>Reflection<select name="reflectionMode"><option value="off">Off · only what I add</option><option value="on">On · at most once a day</option></select></label>
    <p class="field-note">Reflection sends recent plain chat to your conversation provider, which suggests what's worth keeping. It needs a subscription provider and skips email, files, calendars, desktop tasks and screen questions. It never changes notes you wrote, or adds back ones you removed.</p>
    <div class="field-grid"><button type="button" id="memory-reflect" class="quiet">Reflect now</button><button type="button" id="memory-undo" class="quiet" hidden>Undo last reflection</button><button type="button" id="memory-clear" class="quiet">Remove everything</button></div>
    <p id="memory-reflection-status" class="field-note" role="status"></p>
    <ul id="memory-changes"></ul>
    <div class="memory-add"><select id="memory-new-kind" aria-label="Kind of memory">${Object.entries(KINDS).filter(([kind]) => kind !== 'self').map(([kind, label]) => `<option value="${kind}">${label}</option>`).join('')}</select><input id="memory-new-text" maxlength="300" placeholder="Add something to remember" aria-label="New memory" autocomplete="off"><button type="button" id="memory-add" class="quiet">Add</button></div>
    <div id="memory-list"></div>
    <p id="memory-used" class="field-note" role="status"></p></section>`);
  const $ = <T extends HTMLElement = HTMLElement>(id: string): T => root.querySelector(`#memory-${id}`) as T;
  let state: MemoryState = { items: [], used: [], lastReflection: null, canUndo: false };
  let confirmingClear = false;
  let reflecting = false;
  const say = (text: string): void => { $<HTMLParagraphElement>('reflection-status').textContent = text; };
  const guarded = async (work: () => Promise<MemoryState>): Promise<boolean> => {
    try {
      state = await work();
      render();
      return true;
    } catch (error) {
      say(errorMessage(error));
      return false;
    }
  };

  function render(): void {
    const list = $<HTMLDivElement>('list');
    list.replaceChildren();
    if (!state.items.length) {
      const empty = document.createElement('p');
      empty.className = 'field-note';
      empty.textContent = 'Nothing saved yet.';
      list.append(empty);
    }
    for (const [kind, label] of Object.entries(KINDS)) {
      const items = state.items.filter(item => item.kind === kind);
      if (!items.length) continue;
      const title = document.createElement('p');
      title.className = 'memory-group';
      title.textContent = label;
      list.append(title);
      for (const item of items) {
        const row = document.createElement('div');
        row.className = 'memory-row';
        const input = document.createElement('input');
        input.value = item.text;
        input.maxLength = 300;
        input.setAttribute('aria-label', `${label}: edit memory`);
        input.addEventListener('keydown', event => {
          if (event.key === 'Enter') {
            event.preventDefault();
            input.blur();
          }
        });
        input.addEventListener('change', () => {
          void guarded(() => api!.memoryEdit(item.id, input.value) as Promise<MemoryState>);
        });
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'quiet';
        remove.textContent = 'Remove';
        remove.setAttribute('aria-label', `Remove: ${item.text}`);
        remove.onclick = () => {
          void guarded(() => api!.memoryRemove(item.id) as Promise<MemoryState>);
        };
        row.append(input, remove);
        if (item.source === 'reflection') {
          const from = document.createElement('span');
          from.className = 'memory-source';
          from.textContent = 'Reflection';
          row.insertBefore(from, remove);
        }
        list.append(row);
      }
    }
    const changes = state.lastReflection?.changes || [];
    const changesEl = $<HTMLUListElement>('changes');
    changesEl.replaceChildren(...changes.map(change => {
      const line = document.createElement('li');
      line.textContent = `${ACTIONS[change.action]}: ${change.text}`;
      return line;
    }));
    changesEl.hidden = !changes.length;
    $<HTMLButtonElement>('undo').hidden = !state.canUndo;
    const when = state.lastReflection?.at ? new Date(state.lastReflection.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
    if (!reflecting) {
      say(!when ? '' : state.lastReflection?.undone ? `Last reflection, ${when}, was undone.` : changes.length ? `Last reflection, ${when}:` : `Last reflection, ${when}, found nothing new.`);
    }
    const used = state.items.filter(item => state.used.includes(item.id));
    const usedEl = $<HTMLParagraphElement>('used');
    usedEl.textContent = used.length ? `Sent with your last reply: ${used.map(item => item.text).join(' · ')}` : 'None of these went with your last reply.';
    usedEl.hidden = !state.items.length;
  }

  const add = async (): Promise<void> => {
    const newText = $<HTMLInputElement>('new-text');
    const text = newText.value;
    if (await guarded(() => api!.memoryAdd($<HTMLSelectElement>('new-kind').value, text) as Promise<MemoryState>)) {
      newText.value = '';
      newText.focus();
    }
  };

  $<HTMLButtonElement>('add').onclick = () => void add();
  $<HTMLInputElement>('new-text').addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void add();
    }
  });
  $<HTMLButtonElement>('reflect').onclick = async () => {
    reflecting = true;
    $<HTMLButtonElement>('reflect').disabled = true;
    say('Reflecting on recent conversation…');
    const finished = await guarded(() => api!.memoryReflect() as Promise<MemoryState>);
    reflecting = false;
    $<HTMLButtonElement>('reflect').disabled = !api;
    if (finished) render();
  };
  $<HTMLButtonElement>('undo').onclick = () => void guarded(() => api!.memoryUndo() as Promise<MemoryState>);
  // The window's own confirm can't be relied on inside a modal page, so removal takes a second click.
  $<HTMLButtonElement>('clear').onclick = async () => {
    const clearBtn = $<HTMLButtonElement>('clear');
    if (!confirmingClear) {
      confirmingClear = true;
      clearBtn.textContent = 'Click again to remove everything';
      return;
    }
    confirmingClear = false;
    clearBtn.textContent = 'Remove everything';
    await guarded(() => api!.memoryClear() as Promise<MemoryState>);
  };
  for (const id of ['add', 'reflect', 'clear']) $<HTMLButtonElement>(id).disabled = !api;
  render();
  return { refresh: () => (api ? guarded(() => api.memoryState() as Promise<MemoryState>) : Promise.resolve(false)) };
}
