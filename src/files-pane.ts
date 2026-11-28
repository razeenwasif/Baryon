import { isPdf } from './source-link.js';
import { pdfViewer, type PdfViewerController } from './pdf-viewer.js';
import { fileIconElement, languageForPath } from './file-icons.js';
import { highlightCode } from './reply-renderer.js';
import type { PaneContext, SidePaneDefinition } from './side-pane.js';
import type { BaryonPreloadApi } from '../desktop/ipc-contract.js';

export interface FileRootEntry {
  id: string;
  name: string;
}

export interface FileListItem {
  path: string;
  kind: 'file' | 'folder' | (string & {});
  link: string;
}

export interface FileTreeEntry {
  rootId: string;
  path: string;
  name: string;
  kind: 'file' | 'folder' | (string & {});
  depth: number;
  link?: string;
}

export interface FilePreviewData {
  path?: string;
  url?: string;
  text?: string;
  pages?: Array<{ text?: string }>;
}

export interface FilesHistoryAdapter {
  available: () => boolean;
  open: (link: string) => unknown;
}

export interface FilesPaneOptions {
  api?: Pick<BaryonPreloadApi, 'filesStatus' | 'filesAdd' | 'filesList' | 'filesPreview' | 'filesReveal' | 'filesOpen'> | null;
  onError: (message: string) => void;
  history?: FilesHistoryAdapter | null;
  openData?: ((link: string) => unknown) | null;
}

type FilePreviewState =
  | { entry: FileTreeEntry; pdf: true; data?: undefined }
  | { entry: FileTreeEntry; pdf?: false; data: FilePreviewData };

const errorMessage = (error: unknown): string => (
  error instanceof Error ? error.message
    : typeof error === 'object' && error !== null && 'message' in error ? String((error as { message: unknown }).message)
      : String(error)
);

// A read-only look at the folders you've given Fairy, using the same checks as its file tools. A PDF opens in the
// PDF viewer, every page in one scroll; anything else shows as its text, or as a picture.
export function filesPane({ api, onError, history = null, openData = null }: FilesPaneOptions): SidePaneDefinition {
  const open = new Map<string, boolean>();
  let preview: FilePreviewState | null = null;
  let viewer: PdfViewerController | null = null;
  const setFull = (value: boolean): void => { document.documentElement.classList.toggle('pane-full', value); };
  const close = (): void => { viewer?.destroy(); viewer = null; setFull(false); };
  const failed = (_body: HTMLElement, error: unknown): void => { onError(errorMessage(error)); };
  const pane: SidePaneDefinition = {
    id: 'files',
    title: 'Files',
    wide: () => Boolean(preview),
    leave() { close(); },
    reset() { preview = null; close(); },
    async render(body: HTMLElement, context: PaneContext) {
      if (!api) { const none = document.createElement('p'); none.className = 'pane-empty'; none.textContent = 'Files are available in the desktop app.'; body.replaceChildren(none); return; }
      if (preview) { showPreview(body, context); return; }
      let roots: FileRootEntry[];
      try { roots = (await api.filesStatus()) as FileRootEntry[]; } catch (error) { return failed(body, error); }
      const tree = document.createElement('div'); tree.className = 'file-tree';
      if (!roots.length) { const empty = document.createElement('p'); empty.className = 'pane-empty'; empty.textContent = 'Choose a folder for Fairy to read. Nothing outside it is shown.'; tree.append(empty); }
      for (const root of roots) await branch(tree, { rootId: root.id, path: '', name: root.name, kind: 'folder', depth: 0 }, context);
      const add = document.createElement('button'); add.type = 'button'; add.className = 'quiet file-add'; add.textContent = 'Add a folder';
      add.onclick = async () => { try { await api.filesAdd(); context.redraw(); } catch (error) { failed(body, error); } };
      body.replaceChildren(tree, add);
    },
  };
  const key = (entry: FileTreeEntry): string => `${entry.rootId}:${entry.path}`;
  async function branch(parent: HTMLElement, entry: FileTreeEntry, context: PaneContext): Promise<void> {
    const isFolder = entry.kind !== 'file';
    const expanded = isFolder && open.get(key(entry)) === true;
    const line = document.createElement('button'); line.type = 'button'; line.className = `file-row ${entry.kind}`; line.style.paddingLeft = `${10 + entry.depth * 14}px`; line.title = entry.path || entry.name;
    const label = document.createElement('span'); label.className = 'file-row-name'; label.textContent = entry.name;
    line.append(fileIconElement(entry.name, { isFolder, open: expanded }), label);
    parent.append(line);
    if (!isFolder) {
      line.onclick = async () => {
        if (isPdf(entry.name)) { preview = { entry, pdf: true }; context.redraw(); return; }
        try { preview = { entry, data: (await api!.filesPreview(entry.link)) as FilePreviewData }; context.redraw(); } catch (error) { onError(errorMessage(error)); }
      };
      return;
    }
    line.setAttribute('aria-expanded', String(expanded));
    line.onclick = () => { open.set(key(entry), !expanded); context.redraw(); };
    if (!expanded) return;
    try {
      const { items, truncated } = (await api!.filesList(entry.rootId, entry.path)) as { items: FileListItem[]; truncated?: boolean };
      for (const item of items) await branch(parent, { ...item, rootId: entry.rootId, name: item.path.split('/').pop() ?? '', depth: entry.depth + 1 }, context);
      if (truncated) { const more = document.createElement('p'); more.className = 'page-note'; more.textContent = 'Only the first 200 are shown here.'; parent.append(more); }
    } catch (error) { const bad = document.createElement('p'); bad.className = 'page-note'; bad.textContent = errorMessage(error); parent.append(bad); }
  }
  function showPreview(body: HTMLElement, context: PaneContext): void {
    if (!preview) return;
    const { entry } = preview;
    const head = document.createElement('div'); head.className = 'page-head';
    const back = document.createElement('button'); back.type = 'button'; back.className = 'page-back'; back.textContent = '‹'; back.setAttribute('aria-label', 'All files'); back.title = 'All files';
    back.onclick = () => { preview = null; close(); context.redraw(); };
    const title = document.createElement('h4'); title.title = preview.data?.path || entry.path;
    const titleText = document.createElement('span'); titleText.textContent = entry.name;
    title.append(fileIconElement(entry.name), titleText);
    const reveal = document.createElement('button'); reveal.type = 'button'; reveal.className = 'page-link'; reveal.textContent = 'Show in Finder';
    reveal.onclick = () => api!.filesReveal(entry.link).catch((error: unknown) => onError(errorMessage(error)));
    head.append(back, title);
    // In a work session, a file in its folder can show its commits in the Git panel, and data files open in the Data pane.
    if (openData && /\.(?:csv|tsv|json|jsonl|ndjson|parquet|sqlite|db)$/i.test(entry.name)) {
      const inspect = document.createElement('button'); inspect.type = 'button'; inspect.className = 'page-link'; inspect.textContent = 'Data'; inspect.title = 'Inspect columns, stats and quick plot in the Data pane';
      inspect.onclick = () => { if (entry.link) openData(entry.link); };
      head.append(inspect);
    }
    if (history?.available()) { const past = document.createElement('button'); past.type = 'button'; past.className = 'page-link'; past.textContent = 'History'; past.title = 'This file’s commits, in the Git panel'; past.onclick = () => { if (entry.link) history.open(entry.link); }; head.append(past); }
    head.append(reveal);
    if (preview.pdf) {
      // Drawn once; going full window or zooming changes it in place rather than starting again.
      if (!viewer) viewer = pdfViewer({ api, link: entry.link, page: 1, onError });
      body.replaceChildren(head, viewer.element);
      viewer.keepPlace?.();
      return;
    }
    const { data } = preview;
    let view: HTMLElement;
    if (data.url) {
      const img = document.createElement('img'); img.className = 'file-image'; img.alt = entry.name; img.src = data.url;
      view = img;
    } else {
      const pre = document.createElement('pre'); pre.className = 'file-text';
      const raw = data.text ?? (data.pages || []).map(page => page.text ?? JSON.stringify(page)).join('\n\n');
      const lang = languageForPath(entry.name);
      if (lang) {
        const code = document.createElement('code'); code.className = `hljs language-${lang}`;
        code.innerHTML = highlightCode(raw, lang).html;
        pre.append(code);
      } else pre.textContent = raw;
      view = pre;
    }
    body.replaceChildren(head, view);
  }
  return pane;
}
