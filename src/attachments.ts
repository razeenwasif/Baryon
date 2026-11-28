import { detectFileReference, fileIconElement } from './file-icons.js';

export interface AttachmentItem {
  id: string;
  name: string;
  size: number;
  source?: unknown;
}

export interface AttachmentChipOptions {
  onOpen?: (source: unknown) => void;
  onRemove?: (item: AttachmentItem) => void;
}

export interface FileActivityStep {
  id: string;
  text: string;
  state: string;
  detail?: string;
}

export interface FileActivityHandle {
  step: (step: FileActivityStep) => void;
  finish: (outcome?: string) => void;
  element: HTMLDetailsElement;
}

export interface AttachChooseResult {
  added: AttachmentItem[];
  failed: Array<{ message: string }>;
}

export interface AttachmentsApi {
  attachBytes: (name: string, bytes: ArrayBuffer) => Promise<AttachmentItem>;
  attachChoose: () => Promise<AttachChooseResult>;
  attachDiscard: (id: string) => Promise<unknown>;
}

export interface SetupAttachmentsOptions {
  api: AttachmentsApi | null | undefined;
  row: HTMLElement;
  input: HTMLElement;
  dock: HTMLElement;
  enabled?: () => boolean;
  onError?: (message: string) => void;
  onOpen?: (source: unknown) => void;
}

export interface AttachmentsDraft {
  add: (files: readonly File[]) => Promise<void>;
  choose: () => Promise<void>;
  list: () => AttachmentItem[];
  take: () => AttachmentItem[];
  restore: (taken?: readonly AttachmentItem[]) => void;
  defaultText: () => string;
}

interface FileActivityRow {
  node: HTMLLIElement;
  icon: HTMLSpanElement | null;
  label: HTMLSpanElement;
  note: HTMLElement;
  state?: string;
}

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

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const MAX_FILES = 10;
const MAX_SIZE = 20 * 1024 * 1024;
const shortSize = (bytes: number): string =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// One attached file, in the message box or on a sent message. Only one in the box has a remove button.
export function attachmentChip(item: AttachmentItem, { onOpen, onRemove }: AttachmentChipOptions = {}): HTMLSpanElement {
  const chip = element('span', 'attachment-chip');
  const open = element('button', 'attachment-open', item.name);
  open.type = 'button';
  open.title = `Open ${item.name}`;
  open.onclick = () => onOpen?.(item.source);
  chip.append(fileIconElement(item.name), open, element('small', '', shortSize(item.size)));
  if (onRemove) {
    const remove = element('button', 'attachment-remove', '×');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remove ${item.name}`);
    remove.onclick = () => onRemove(item);
    chip.append(remove);
  }
  return chip;
}

export function attachmentRow(items: readonly AttachmentItem[], onOpen?: (source: unknown) => void): HTMLDivElement {
  const row = element('div', 'message-attachments');
  row.append(...items.map(item => attachmentChip(item, { onOpen })));
  return row;
}

const clock = (ms: number): string => {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

// The steps of a file question as they happen, so a long one visibly isn't stuck.
export function fileActivity(parent: HTMLElement, now: () => number = () => Date.now()): FileActivityHandle {
  const box = element('details', 'file-activity');
  const summary = element('summary');
  const title = element('span', '', 'Getting started');
  const time = element('span', 'file-activity-time', '0:00');
  const list = element('ol');
  const rows = new Map<string, FileActivityRow>();
  const started = now();
  box.open = true;
  summary.append(title, time);
  box.append(summary, list);
  parent.append(box);
  box.scrollIntoView({ block: 'end' });
  const tick = (): void => { time.textContent = clock(now() - started); };
  const timer = setInterval(tick, 1000);
  const running = (): boolean => [...rows.values()].some(row => row.state === 'running');

  function step({ id, text, state, detail }: FileActivityStep): void {
    let row = rows.get(id);
    if (!row) {
      row = { node: element('li', 'file-step'), icon: null, label: element('span'), note: element('small') };
      row.node.append(row.label, row.note);
      rows.set(id, row);
      list.append(row.node);
    }
    row.state = state;
    row.node.className = `file-step ${state}`;
    row.label.textContent = text;
    row.note.textContent = detail || '';
    const ref = String(text || '').split(/\s+/).find(token => detectFileReference(token.replace(/^[“”"'()]+|[“”"'(),.:]+$/g, '')));
    if (ref && !row.icon) {
      row.icon = fileIconElement(ref.replace(/^[“”"'()]+|[“”"'(),.:]+$/g, ''));
      row.node.insertBefore(row.icon, row.label);
    }
    title.textContent = running() ? 'Working on your files' : 'Thinking about what it found';
    box.scrollIntoView({ block: 'end' });
  }

  function finish(outcome = 'done'): void {
    clearInterval(timer);
    tick();
    if (!rows.size) { box.remove(); return; }
    for (const row of rows.values()) {
      if (row.state === 'running') {
        row.state = 'failed';
        row.node.className = 'file-step failed';
      }
    }
    title.textContent = outcome === 'stopped' ? `Stopped after ${rows.size} ${rows.size === 1 ? 'step' : 'steps'}` : `Took ${rows.size} ${rows.size === 1 ? 'step' : 'steps'}`;
    box.open = false;
  }

  return { step, finish, element: box };
}

// What's waiting to go with the next message, from the + menu, a drop or a paste.
export function setupAttachments({ api, row, input, dock, enabled = () => true, onError = () => {}, onOpen }: SetupAttachmentsOptions): AttachmentsDraft {
  let items: AttachmentItem[] = [];

  function draw(): void {
    row.hidden = !items.length;
    row.replaceChildren(...items.map(item => attachmentChip(item, {
      onOpen,
      onRemove: removed => {
        items = items.filter(other => other.id !== removed.id);
        draw();
        api?.attachDiscard(removed.id).catch(() => {});
      },
    })));
  }

  const room = (count: number): boolean => {
    if (items.length + count <= MAX_FILES) return true;
    onError(`Attach up to ${MAX_FILES} files to a message.`);
    return false;
  };

  async function add(files: readonly File[]): Promise<void> {
    if (!api || !files.length || !room(files.length)) return;
    const problems: string[] = [];
    for (const file of files) {
      try {
        if (file.size > MAX_SIZE) throw new Error(`${file.name} is over 20 MB, which is as big as an attached file can be.`);
        // A folder only fails once it's read.
        const bytes = await file.arrayBuffer().catch(() => {
          throw new Error(`${file.name} can’t be attached. Attach files rather than folders.`);
        });
        items.push(await api.attachBytes(file.name, bytes));
        draw();
      } catch (error) {
        problems.push(errorMessage(error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''));
      }
    }
    if (problems.length) onError(problems.join(' '));
    input.focus();
  }

  async function choose(): Promise<void> {
    if (!api || !room(1)) return;
    try {
      const { added, failed } = await api.attachChoose();
      if (!room(added.length)) {
        added.forEach(item => api.attachDiscard(item.id).catch(() => {}));
        return;
      }
      items.push(...added);
      draw();
      if (failed.length) onError(failed.map(entry => entry.message).join(' '));
      input.focus();
    } catch (error) {
      onError(errorMessage(error));
    }
  }

  const hasFiles = (event: DragEvent): boolean => [...(event.dataTransfer?.types || [])].includes('Files');
  const settle = (): void => { dock.classList.remove('dragging-files'); };

  // Dropping a file anywhere would otherwise send the window to it, so this also covers when it can't be attached.
  document.addEventListener('dragover', event => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = enabled() ? 'copy' : 'none';
    dock.classList.toggle('dragging-files', enabled());
  });
  document.addEventListener('dragleave', event => { if (!event.relatedTarget) settle(); });
  document.addEventListener('drop', event => {
    settle();
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (enabled() && event.dataTransfer) void add([...event.dataTransfer.files]);
  });

  // Rich text can come with a picture of itself, so plain text wins.
  input.addEventListener('paste', event => {
    const files = [...(event.clipboardData?.files || [])];
    if (!files.length || event.clipboardData?.getData('text/plain')) return;
    event.preventDefault();
    void add(files);
  });

  return {
    add,
    choose,
    list: () => items,
    take() { const taken = items; items = []; draw(); return taken; },
    restore(taken: readonly AttachmentItem[] = []) {
      items = [...taken, ...items.filter(item => !taken.some(other => other.id === item.id))];
      draw();
    },
    defaultText: () => (items.length === 1 ? 'Take a look at this file.' : 'Take a look at these files.'),
  };
}
