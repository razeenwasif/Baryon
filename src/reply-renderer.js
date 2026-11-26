import MarkdownIt from 'markdown-it';
import katex from 'katex';
import hljs from 'highlight.js/lib/common';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import latex from 'highlight.js/lib/languages/latex';
import { describeSource } from './source-link.js';
import { detectFileReference, fileIconHTML, languageDisplayInfo, languageForPath } from './file-icons.js';

if (!hljs.getLanguage('dockerfile')) hljs.registerLanguage('dockerfile', dockerfile);
if (!hljs.getLanguage('latex')) hljs.registerLanguage('latex', latex);
hljs.registerAliases(['tex'], { languageName: 'latex' });
hljs.registerAliases(['docker'], { languageName: 'dockerfile' });
hljs.registerAliases(['mjs', 'cjs'], { languageName: 'javascript' });
hljs.registerAliases(['mts', 'cts'], { languageName: 'typescript' });
hljs.registerAliases(['jsonl', 'jsonc'], { languageName: 'json' });
hljs.registerAliases(['console'], { languageName: 'bash' });
hljs.registerAliases(['vue', 'svelte'], { languageName: 'xml' });

const HIGHLIGHT_LIMIT = 40000;
const COPY_ICON = '<svg class="code-copy-icon" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5.2" y="5.2" width="8.2" height="8.2" rx="1.6"/><path d="M10.8 5.2V3.4A1.4 1.4 0 0 0 9.4 2H3.4A1.4 1.4 0 0 0 2 3.4v6a1.4 1.4 0 0 0 1.4 1.4h1.8"/></svg>';

const markdown = new MarkdownIt({ html: false, linkify: true, typographer: false, maxNesting: 24 });
export const escapeHtml = text => markdown.utils.escapeHtml(String(text ?? ''));

export function highlightCode(code, language = '') {
  const source = String(code ?? '');
  const raw = String(language || '').trim().split(/\s+/)[0].toLowerCase();
  if (source.length <= HIGHLIGHT_LIMIT && raw && hljs.getLanguage(raw)) {
    try {
      return { html: hljs.highlight(source, { language: raw, ignoreIllegals: true }).value, language: raw, highlighted: true };
    } catch {}
  }
  return { html: escapeHtml(source), language: raw, highlighted: false };
}

function parseFenceInfo(info) {
  const trimmed = String(info || '').trim();
  if (!trimmed) return { language: '', filename: '' };
  const parts = trimmed.split(/\s+/);
  let first = parts[0], filename = parts.slice(1).join(' ').trim();
  // Support `lang:path/to/file.ext` or `path/to/file.ext` directly as the fence label.
  if (!filename && first.includes(':')) {
    const colon = first.indexOf(':');
    const left = first.slice(0, colon), right = first.slice(colon + 1);
    if (left && right && detectFileReference(right)) { first = left; filename = right; }
  }
  if (!filename && !hljs.getLanguage(first.toLowerCase()) && detectFileReference(first)) {
    return { language: languageForPath(first), filename: first };
  }
  const cleanFilename = filename && detectFileReference(filename) ? filename : '';
  return { language: first.toLowerCase(), filename: cleanFilename };
}

markdown.renderer.rules.fence = (tokens, index) => {
  const token = tokens[index];
  const { language, filename } = parseFenceInfo(token.info);
  const code = token.content.replace(/\n$/, '');
  const { html } = highlightCode(code, language);
  const display = languageDisplayInfo(language, filename);
  const safeLang = language.replace(/[^a-z0-9_+-]/gi, '');
  const langClass = safeLang ? ` language-${safeLang}` : '';
  const dataLang = safeLang ? ` data-lang="${escapeHtml(safeLang)}"` : '';
  return `<div class="code-block"${dataLang}><div class="code-block-header"><span class="code-block-lang">${display.iconHTML}<span class="code-block-label">${escapeHtml(display.label)}</span></span><button type="button" class="code-copy" aria-label="Copy code">${COPY_ICON}<span>Copy</span></button></div><pre class="code-pre"><code class="hljs${langClass}">${html}</code></pre></div>\n`;
};

markdown.renderer.rules.code_inline = (tokens, index, options, env, self) => {
  const token = tokens[index];
  if (!env?._inFileLink) {
    const ref = detectFileReference(token.content);
    if (ref) {
      return `<code class="file-ref-code" data-file-type="${escapeHtml(ref.type.id)}">${fileIconHTML(ref.path)}<span class="file-ref-name">${escapeHtml(token.content)}</span></code>`;
    }
  }
  return `<code${self.renderAttrs(token)}>${escapeHtml(token.content)}</code>`;
};

const defaultLinkOpen = markdown.renderer.rules.link_open || ((tokens, index, options, env, self) => self.renderToken(tokens, index, options));
const defaultLinkClose = markdown.renderer.rules.link_close || ((tokens, index, options, env, self) => self.renderToken(tokens, index, options));
markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const token = tokens[index];
  const href = token.attrGet('href') || '';
  let iconPath = '';
  if (href.startsWith('lyra-file:')) {
    iconPath = describeSource(href)?.path || '';
  } else {
    // Check if the link's own text is a file name/path (e.g. [src/app.js](https://...)).
    let label = '';
    for (let i = index + 1; i < tokens.length && tokens[i].type !== 'link_close'; i++) {
      if (tokens[i].type === 'text' || tokens[i].type === 'code_inline') label += tokens[i].content;
    }
    const candidate = label.trim().replace(/,\s*(?:lines?|p\.|pages?)\s+[\d–—-]+$/i, '').trim();
    if (detectFileReference(candidate)) iconPath = candidate;
  }
  if (!iconPath) return defaultLinkOpen(tokens, index, options, env, self);
  if (env) env._inFileLink = (env._inFileLink || 0) + 1;
  token.meta = { ...token.meta, fileLink: true };
  token.attrJoin('class', 'file-ref-link');
  return `${defaultLinkOpen(tokens, index, options, env, self)}${fileIconHTML(iconPath)}`;
};
markdown.renderer.rules.link_close = (tokens, index, options, env, self) => {
  if (env?._inFileLink) env._inFileLink = Math.max(0, env._inFileLink - 1);
  return defaultLinkClose(tokens, index, options, env, self);
};

markdown.validateLink = url => /^fairy-run:R\d{1,6}$/.test(url) || /^lyra-file:\/\/[a-f0-9-]{36}\/[A-Za-z0-9_-]+\?(?:line|page)=[0-9]+$/.test(url) || /^https?:\/\//i.test(url) && (() => { try { const parsed = new URL(url); return !parsed.username && !parsed.password; } catch { return false; } })();
markdown.renderer.rules.image = (tokens, index) => `<span class="image-description">${markdown.utils.escapeHtml(tokens[index].content || 'Image')}</span>`;

function mathHTML(source, displayMode) {
  if (source.length > 4000) return markdown.utils.escapeHtml(source);
  try { return katex.renderToString(source, { displayMode, throwOnError: false, trust: false, strict: 'ignore', maxExpand: 200, maxSize: 20, output: 'htmlAndMathml' }); }
  catch { return `<code class="math-fallback">${markdown.utils.escapeHtml(source)}</code>`; }
}
function closingAt(source, delimiter, start) {
  let index = source.indexOf(delimiter, start);
  while (index >= 0) {
    let slashes = 0;
    for (let i = index - 1; i >= 0 && source[i] === '\\'; i--) slashes++;
    if (slashes % 2 === 0) return index;
    index = source.indexOf(delimiter, index + delimiter.length);
  }
  return -1;
}
markdown.block.ruler.before('fence', 'fairy_math_block', (state, startLine, endLine, silent) => {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  const opening = state.src.slice(start, start + 2);
  if (!['\\[', '$$'].includes(opening)) return false;
  const closing = opening === '\\[' ? '\\]' : '$$';
  const end = closingAt(state.src, closing, start + 2);
  if (end < 0 || end - start > 4000) return false;
  let line = startLine;
  while (line < endLine && state.eMarks[line] < end + 2) line++;
  if (line >= endLine || state.src.slice(end + 2, state.eMarks[line]).trim()) return false;
  if (silent) return true;
  const token = state.push('fairy_math_block', 'div', 0);
  token.block = true; token.content = state.src.slice(start + 2, end).trim(); token.map = [startLine, line + 1];
  state.line = line + 1; return true;
}, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
markdown.inline.ruler.before('escape', 'fairy_math_inline', (state, silent) => {
  const start = state.pos;
  const pair = state.src.slice(start, start + 2);
  const opening = ['\\(', '\\[', '$$'].includes(pair) ? pair : state.src[start] === '$' ? '$' : null;
  if (!opening) return false;
  const closing = { '\\(': '\\)', '\\[': '\\]', '$$': '$$', '$': '$' }[opening];
  const contentStart = start + opening.length;
  if (opening === '$' && /\s/.test(state.src[contentStart] || ' ')) return false;
  const end = closingAt(state.src, closing, contentStart);
  if (end < 0 || end - contentStart > 4000) return false;
  if (opening === '$' && (/\s/.test(state.src[end - 1] || ' ') || /\d/.test(state.src[end + 1] || '') || state.src.slice(contentStart, end).includes('\n'))) return false;
  if (!silent) { const token = state.push('fairy_math_inline', 'math', 0); token.content = state.src.slice(contentStart, end); token.meta = { displayMode: opening !== '$' && opening !== '\\(' }; }
  state.pos = end + closing.length; return true;
});
markdown.renderer.rules.fairy_math_inline = (tokens, index) => mathHTML(tokens[index].content, tokens[index].meta.displayMode);
markdown.renderer.rules.fairy_math_block = (tokens, index) => `<div class="math-block">${mathHTML(tokens[index].content, true)}</div>\n`;

export function replyHTML(text) {
  return markdown.render(String(text), {});
}

export function copyTextWithFeedback(button, text) {
  if (!button || !navigator.clipboard?.writeText) return;
  navigator.clipboard.writeText(String(text ?? '')).then(() => {
    const label = button.querySelector('span');
    button.classList.add('copied');
    if (label) label.textContent = 'Copied';
    clearTimeout(button._copyTimer);
    button._copyTimer = setTimeout(() => {
      button.classList.remove('copied');
      if (label) label.textContent = 'Copy';
    }, 1600);
  }).catch(() => {});
}

export function renderReply(element, text, openLink) {
  element.classList.add('rich-reply');
  // Raw HTML is disabled; only Markdown-it, bounded KaTeX, static built-in SVG file icons,
  // and escaped Highlight.js output can create elements. No remote images are loaded.
  element.innerHTML = replyHTML(text);
  element.scrollTop = 0;
  element.onclick = event => {
    const copy = event.target.closest?.('.code-copy');
    if (copy && element.contains(copy)) {
      event.preventDefault();
      const code = copy.closest('.code-block')?.querySelector('pre code')?.textContent ?? '';
      copyTextWithFeedback(copy, code);
      return;
    }
    const link = event.target.closest?.('a');
    if (!link || !element.contains(link)) return;
    event.preventDefault();
    if (markdown.validateLink(link.href)) openLink?.(link.href);
  };
}
