// The notes Fairy keeps on a chat's compacted messages, shown and edited by hand (improving existing features, item 3).
// A work chat's notes open with its pinned facts: goal, plan, decisions and open questions. Lines you add under
// "Pinned by you" are kept word for word by every later summary.
export interface ChatNotesData {
  text: string;
  work?: boolean;
}

export interface ChatNotesApi {
  sessionNotes: () => Promise<ChatNotesData | null | undefined>;
  sessionNotesSave: (text: string) => Promise<ChatNotesData>;
}

export interface OpenChatNotesOptions {
  api: ChatNotesApi;
  onError?: (message: string) => void;
  onSaved?: (notes: ChatNotesData) => void;
}

let dialog: HTMLDialogElement | null = null;

const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export async function openChatNotes({ api, onError = () => {}, onSaved = () => {} }: OpenChatNotesOptions): Promise<void> {
  let notes: ChatNotesData | null | undefined;
  try {
    notes = await api.sessionNotes();
  } catch (error) {
    onError(errorMessage(error));
    return;
  }
  if (!notes?.text) {
    onError('This chat has no notes yet. Compact it first.');
    return;
  }
  dialog?.remove();
  dialog = element('dialog', 'chat-notes');
  dialog.setAttribute('aria-labelledby', 'chat-notes-title');
  const title = element('h3', '', 'Notes on the earlier messages');
  title.id = 'chat-notes-title';
  const about = element(
    'p',
    'chat-notes-about',
    notes.work
      ? 'What Fairy carries forward from the folded messages, starting with the goal, plan, decisions and open questions. Correct anything here, or add lines under “Pinned by you”, which she keeps word for word.'
      : 'What Fairy carries forward from the folded messages. Correct anything here, or add lines under “Pinned by you”, which she keeps word for word.',
  );
  const text = element('textarea', 'chat-notes-text');
  text.value = notes.text;
  text.spellcheck = true;
  text.setAttribute('aria-label', 'Notes');
  const status = element('p', 'chat-notes-status');
  status.setAttribute('aria-live', 'polite');
  const pin = element('button', 'quiet', 'Add “Pinned by you”');
  pin.type = 'button';
  pin.hidden = /^\s*(?:#+\s*)?(?:\*\*)?Pinned by you/im.test(notes.text);
  pin.onclick = () => {
    text.value = `${text.value.trimEnd()}\n\nPinned by you:\n`;
    pin.hidden = true;
    text.focus();
    text.setSelectionRange(text.value.length, text.value.length);
  };
  const close = element('button', 'quiet', 'Close');
  close.type = 'button';
  close.onclick = () => dialog?.close();
  const save = element('button', '', 'Save');
  save.type = 'button';
  save.onclick = async () => {
    save.disabled = true;
    status.textContent = 'Saving…';
    try {
      const next = await api.sessionNotesSave(text.value);
      text.value = next.text;
      status.textContent = 'Saved. Fairy reads these from her next turn.';
      onSaved(next);
    } catch (error) {
      status.textContent = errorMessage(error);
    } finally {
      save.disabled = false;
    }
  };
  const actions = element('div', 'chat-notes-actions');
  actions.append(pin, close, save);
  dialog.append(title, about, text, status, actions);
  dialog.addEventListener('close', () => {
    dialog?.remove();
    dialog = null;
  });
  document.body.append(dialog);
  dialog.showModal();
  text.focus();
  text.setSelectionRange(0, 0);
  text.scrollTop = 0;
}
