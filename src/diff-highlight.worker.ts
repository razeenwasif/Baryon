import hljs from 'highlight.js/lib/common';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import latex from 'highlight.js/lib/languages/latex';

interface DiffHighlightItem {
  code?: string;
  lang?: string;
}

interface DiffHighlightWorkerRequest {
  id?: unknown;
  items?: Array<DiffHighlightItem | null | undefined>;
}

interface DiffHighlightWorkerResponse {
  id: unknown;
  html: string[];
}

interface WorkerGlobalScopeLike {
  onmessage: ((event: MessageEvent<DiffHighlightWorkerRequest | undefined>) => void) | null;
  postMessage(message: DiffHighlightWorkerResponse): void;
}

if (!hljs.getLanguage('dockerfile')) hljs.registerLanguage('dockerfile', dockerfile);
if (!hljs.getLanguage('latex')) hljs.registerLanguage('latex', latex);
hljs.registerAliases(['tex'], { languageName: 'latex' });
hljs.registerAliases(['docker'], { languageName: 'dockerfile' });
hljs.registerAliases(['mjs', 'cjs'], { languageName: 'javascript' });
hljs.registerAliases(['mts', 'cts'], { languageName: 'typescript' });
hljs.registerAliases(['jsonl', 'jsonc'], { languageName: 'json' });
hljs.registerAliases(['console'], { languageName: 'bash' });
hljs.registerAliases(['vue', 'svelte'], { languageName: 'xml' });

const escapeHtml = (s: unknown): string =>
  String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

function highlightLine(code: unknown, lang: unknown): string {
  const source = String(code ?? '');
  const l = String(lang || '').trim().split(/\s+/)[0].toLowerCase();
  if (source.length <= 4000 && l && hljs.getLanguage(l)) {
    try {
      return hljs.highlight(source, { language: l, ignoreIllegals: true }).value;
    } catch {}
  }
  return escapeHtml(source);
}

const workerSelf = self as unknown as WorkerGlobalScopeLike;

workerSelf.onmessage = event => {
  const { id, items = [] } = event.data || {};
  const html = items.map(item => highlightLine(item?.code ?? '', item?.lang ?? ''));
  workerSelf.postMessage({ id, html });
};
