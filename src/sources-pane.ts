import './panels.css';
import { describeSource, isPdf } from './source-link.js';
import type { SourceDescription } from './source-link.js';
import { pdfViewer } from './pdf-viewer.js';
import type { PdfViewerController } from './pdf-viewer.js';
import { webSources } from './web-sources.js';
import type { WebSourceHistoryEntry } from './web-sources.js';
import { fileIconElement } from './file-icons.js';
import type { BaryonPreloadApi } from '../desktop/ipc-contract.js';
import type { PaneContext, SidePaneDefinition } from './side-pane.js';

export interface SourcesPaneOptions {
  api: Pick<BaryonPreloadApi, 'filesPreview' | 'filesReveal' | 'filesOpen' | 'openSource'>;
  onError?: (message: string) => void;
  history?: () => readonly WebSourceHistoryEntry[];
}

interface FilesPreviewResult {
  path?: string;
  modifiedAt?: string | number;
  url?: string;
  text?: string;
  truncated?: boolean;
  start?: number;
  nextStart?: number;
  totalLines?: number;
}

const errorMessage = (error: unknown): string => (
  error instanceof Error ? error.message
    : typeof error === 'object' && error !== null && 'message' in error ? String((error as { message: unknown }).message)
      : String(error)
);

const readOn = (at: string): string => {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? 'Read' : `Read ${date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}`;
};

// Cited notes and book pages from this chat, one open beside it. Clicking a citation in a reply opens it here.
// history: the chat's messages, for the web pages its work turns read, which open in the browser.
export function sourcesPane({ api, onError = () => {}, history = () => [] }: SourcesPaneOptions): SidePaneDefinition {
  let previewToken = 0, viewer: PdfViewerController | null = null;
  const setFull = (value: boolean): boolean => document.documentElement.classList.toggle('pane-full', value);
  const pdfPage = (source: SourceDescription | null | undefined): source is SourceDescription & { page: number } =>
    Boolean(source && source.page != null && isPdf(source.path));
  const el = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    text?: string | null,
  ): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const button = (className: string, text: string, onclick: () => void): HTMLButtonElement => {
    const node = el('button', className, text);
    node.type = 'button';
    node.onclick = onclick;
    return node;
  };
  // In the order they were cited, each link once.
  const cited = (): SourceDescription[] => {
    const seen = new Map<string, SourceDescription>();
    for (const anchor of document.querySelectorAll('#messages a[href^="lyra-file:"]')) {
      const source = describeSource(anchor.getAttribute('href') ?? '', anchor.textContent ?? '');
      if (source && !seen.has(source.link)) seen.set(source.link, source);
    }
    return [...seen.values()];
  };

  async function preview(holder: HTMLElement, source: SourceDescription): Promise<void> {
    const token = ++previewToken;
    viewer?.destroy(); viewer = null;
    // A cited PDF page opens in the PDF viewer, at that page, with the rest of the book around it.
    if (pdfPage(source)) {
      const head = el('div', 'panel-card-head');
      head.append(el('h3', '', source.path), button('panel-button quiet', 'Reveal in Finder', () => api.filesReveal(source.link).catch((error: unknown) => onError(errorMessage(error)))));
      viewer = pdfViewer({ api, link: source.link, page: source.page, onError });
      holder.classList.add('source-pdf');
      holder.replaceChildren(head, viewer.element);
      viewer.keepPlace?.();
      return;
    }
    holder.classList.remove('source-pdf');
    setFull(false);
    holder.replaceChildren(el('p', 'panel-note busy', `Opening ${source.name}…`));
    let data: FilesPreviewResult;
    try { data = await api.filesPreview(source.link) as FilesPreviewResult; }
    catch (error: unknown) { if (token === previewToken) holder.replaceChildren(el('p', 'panel-note', errorMessage(error))); return; }
    if (token !== previewToken) return;
    const head = el('div', 'panel-card-head');
    head.append(el('h3', '', data.path || source.path), button('panel-button quiet', 'Reveal in Finder', () => api.filesReveal(source.link).catch((error: unknown) => onError(errorMessage(error)))));
    const parts: Node[] = [head, el('p', 'panel-note', `${source.where}${data.modifiedAt ? ` · changed ${new Date(data.modifiedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}`)];
    if (data.url) { const image = el('img', 'source-page'); image.alt = `${source.name}, ${source.where.toLowerCase()}`; image.src = data.url; parts.push(image); }
    else {
      // The cited lines are marked and scrolled to, so you can find them at a glance. Each line starts with its number.
      const text = el('pre', 'source-text');
      for (const line of String(data.text ?? '').split('\n')) {
        const number = Number(/^(\d+):/.exec(line)?.[1]);
        text.append(number >= source.from && number <= source.to ? el('mark', '', `${line}\n`) : `${line}\n`);
      }
      parts.push(text);
      if (data.truncated) parts.push(el('p', 'panel-note', `Showing lines ${data.start} to ${Number(data.nextStart) - 1} of ${data.totalLines}.`));
    }
    holder.replaceChildren(...parts);
    holder.querySelector('mark')?.scrollIntoView({ block: 'center' });
  }

  return {
    id: 'sources', title: 'Sources',
    // A PDF gets the wider panel, as a page does.
    wide: (view: unknown): boolean => pdfPage(view ? describeSource(String(view)) : cited()[0]),
    leave() { setFull(false); viewer?.destroy(); viewer = null; },
    reset() { setFull(false); },
    render(body: HTMLElement, context: PaneContext) {
      const viewLink = context.view ? String(context.view) : '';
      const sources = cited(), wanted = viewLink ? (sources.find(source => source.link === viewLink) || describeSource(viewLink)) : null;
      if (wanted && !sources.some(source => source.link === wanted.link)) sources.unshift(wanted);
      const root = el('div', 'sources panel-stack'), head = el('header', 'panel-head');
      head.append(el('h2', '', 'Sources'));
      root.append(head);
      // The web pages this chat's work read, each with when, opened in the browser.
      const pages = webSources(history());
      const web = (): HTMLElement[] => {
        if (!pages.length) return [];
        const list = el('ul', 'source-list web-sources');
        list.append(...pages.map(page => {
          const row = button('', '', () => api.openSource(page.url).catch((error: unknown) => onError(errorMessage(error))));
          row.title = page.url;
          row.append(el('span', 'source-name', page.name), el('span', 'source-where', readOn(page.at)));
          const item = el('li'); item.append(row); return item;
        }));
        return [el('h3', 'panel-subhead', `Web pages read in this chat (${pages.length})`), list];
      };
      if (!sources.length) { root.append(el('p', 'panel-note', 'When Fairy cites one of your notes or a book page in this chat, you can open it here beside the conversation.'), ...web()); body.replaceChildren(root); return; }
      const current = wanted || sources[0];
      const list = el('ul', 'source-list');
      list.append(...sources.map(source => {
        const row = button(source.link === current.link ? 'current' : '', '', () => context.setView(source.link));
        row.title = source.path;
        row.append(fileIconElement(source.path), el('span', 'source-name', source.name), el('span', 'source-where', source.where));
        const item = el('li'); item.append(row); return item;
      }));
      const holder = el('section', 'panel-card source-preview');
      root.append(list, ...web(), holder);
      body.replaceChildren(root);
      void preview(holder, current);
    },
  };
}
