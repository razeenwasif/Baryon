import hljs from 'highlight.js/lib/common';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import latex from 'highlight.js/lib/languages/latex';

if (!hljs.getLanguage('dockerfile')) hljs.registerLanguage('dockerfile', dockerfile);
if (!hljs.getLanguage('latex')) hljs.registerLanguage('latex', latex);
hljs.registerAliases(['tex'], { languageName: 'latex' });
hljs.registerAliases(['docker'], { languageName: 'dockerfile' });
hljs.registerAliases(['mjs', 'cjs'], { languageName: 'javascript' });
hljs.registerAliases(['mts', 'cts'], { languageName: 'typescript' });
hljs.registerAliases(['jsonl', 'jsonc'], { languageName: 'json' });
hljs.registerAliases(['console'], { languageName: 'bash' });
hljs.registerAliases(['vue', 'svelte'], { languageName: 'xml' });

const escapeHtml = s =>
  String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

function highlightLine(code, lang) {
  const source = String(code ?? '');
  const l = String(lang || '').trim().split(/\s+/)[0].toLowerCase();
  if (source.length <= 4000 && l && hljs.getLanguage(l)) {
    try {
      return hljs.highlight(source, { language: l, ignoreIllegals: true }).value;
    } catch {}
  }
  return escapeHtml(source);
}

self.onmessage = event => {
  const { id, items = [] } = event.data || {};
  const html = items.map(item => highlightLine(item?.code ?? '', item?.lang ?? ''));
  self.postMessage({ id, html });
};
