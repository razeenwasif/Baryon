export interface ApprovedFolder {
  id: string;
  name: string;
  path: string;
}

export interface FilePreviewData {
  path: string;
  page?: number;
  start?: number;
  modifiedAt?: string;
  url?: string;
  text?: string;
  pages?: unknown;
}

export interface FilesSettingsApi {
  filesStatus(): Promise<ApprovedFolder[]>;
  filesAdd(): Promise<ApprovedFolder[]>;
  filesRemove(id: string): Promise<ApprovedFolder[]>;
  filesPreview(link: unknown): Promise<FilePreviewData>;
  filesReveal(link: unknown): Promise<unknown>;
}

export interface SetupFilesSettingsOptions {
  api?: FilesSettingsApi | null;
  root: HTMLElement;
  onError?: (message: string) => void;
}

export interface FilesSettingsController {
  refresh: () => Promise<void>;
  open: (link: unknown) => Promise<void>;
}

const errorMessage = (e: unknown): string =>
  e instanceof Error ? e.message : (typeof e === 'object' && e !== null && 'message' in e ? String((e as { message: unknown }).message) : String(e));

export function setupFilesSettings({ api, root, onError = () => {} }: SetupFilesSettingsOptions): FilesSettingsController {
  root.innerHTML = `<section aria-labelledby="files-title"><h3 id="files-title">Local files</h3><p class="field-note">Give Fairy access to folders you choose. Files are read-only unless your current message explicitly asks her to create or write a named file. Search and document extraction happen on this Mac; relevant excerpts and page images go to your conversation provider to answer your question. Replies remain in chat history, but file conversations are excluded from automatic long-term recall.</p><button type="button" class="quiet" id="files-add">Add a folder…</button><div id="files-roots"></div><p class="field-note" id="files-status" role="status"></p><p class="field-note">Try “Read my MIP lab files and explain the constraints.” Supports code, text, notebooks, PDF pages, CSV/JSON, and images. For example: “Create notes.md with a summary of this lab.” Use a relative path for nested files, or an absolute path if several folders are approved. Text/code writes are limited to 256 KiB; edits keep a hidden backup beside the original. No code execution. Hidden files, credentials and dependency folders are excluded. Click a cited source for a read-only preview. Temporary images stay in memory.</p></section>`;
  const status = root.querySelector<HTMLParagraphElement>('#files-status')!;
  const list = root.querySelector<HTMLDivElement>('#files-roots')!;
  const addButton = root.querySelector<HTMLButtonElement>('#files-add')!;

  const render = (folders: ApprovedFolder[]): void => {
    list.replaceChildren();
    for (const f of folders) {
      const row = document.createElement('div');
      row.className = 'field-grid';
      const name = document.createElement('p');
      name.className = 'field-note';
      name.textContent = f.path;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'quiet';
      remove.textContent = `Remove ${f.name}`;
      remove.onclick = async () => {
        if (!api) return;
        try { render(await api.filesRemove(f.id)); } catch (e) { status.textContent = errorMessage(e); }
      };
      row.append(name, remove);
      list.append(row);
    }
    status.textContent = folders.length
      ? `${folders.length} approved folder${folders.length === 1 ? '' : 's'} · read-only by default · explicit requests enable one file write`
      : 'No folders approved.';
  };

  const refresh = async (): Promise<void> => {
    try { render(api ? await api.filesStatus() : []); } catch (e) { status.textContent = errorMessage(e); }
  };

  addButton.disabled = !api;
  addButton.onclick = async () => {
    if (!api) return;
    try { render(await api.filesAdd()); } catch (e) { status.textContent = errorMessage(e); }
  };

  const modal = document.createElement('dialog');
  modal.className = 'file-preview';
  modal.innerHTML = `<div><h3></h3><p class="field-note"></p><pre style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:65vh;overflow:auto"></pre><img alt="Local file preview" style="max-width:100%;max-height:65vh;object-fit:contain"><div class="field-grid"><button type="button" class="quiet" data-reveal>Reveal in Finder</button><button type="button" class="quiet" data-close>Close preview</button></div></div>`;
  document.body.append(modal);

  let current: unknown = null;
  let version = 0;

  modal.querySelector<HTMLButtonElement>('[data-close]')!.onclick = () => modal.close();
  modal.onclose = () => {
    version++;
    current = null;
    modal.querySelector<HTMLPreElement>('pre')!.textContent = '';
    modal.querySelector<HTMLImageElement>('img')!.removeAttribute('src');
  };
  modal.querySelector<HTMLButtonElement>('[data-reveal]')!.onclick = () => {
    void api?.filesReveal(current).catch(e => onError(errorMessage(e)));
  };

  const open = async (link: unknown): Promise<void> => {
    if (!api) return;
    const token = ++version;
    try {
      const data = await api.filesPreview(link);
      if (token !== version) return;
      current = link;
      modal.querySelector<HTMLHeadingElement>('h3')!.textContent = data.path;
      modal.querySelector<HTMLParagraphElement>('p')!.textContent = `${data.page ? 'Page ' + data.page : 'From line ' + (data.start || 1)} · ${data.modifiedAt || ''}`;
      const pre = modal.querySelector<HTMLPreElement>('pre')!;
      const img = modal.querySelector<HTMLImageElement>('img')!;
      pre.hidden = !!data.url;
      img.hidden = !data.url;
      if (data.url) img.src = data.url;
      else {
        img.removeAttribute('src');
        pre.textContent = data.text || JSON.stringify(data.pages, null, 2);
      }
      if (!modal.open) modal.showModal();
    } catch (e) {
      onError(errorMessage(e));
    }
  };

  return { refresh, open };
}
