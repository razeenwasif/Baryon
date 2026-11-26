// Safe, zero-dependency Markdown renderer & runnable-artifact extractor for Baryon Web.

export function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeUrl(raw) {
  const trimmed = String(raw || '').trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return '';
}

function renderInline(text) {
  const escaped = escapeHtml(text);
  // Protect inline code spans first.
  const codeTokens = [];
  const withCodePlaceholders = escaped.replace(/`([^`\n]+)`/g, (_, code) => {
    const idx = codeTokens.length;
    codeTokens.push(`<code class="bw-inline-code">${code}</code>`);
    return `\u0000CODE${idx}\u0000`;
  });

  const formatted = withCodePlaceholders
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
      const clean = safeUrl(url.replaceAll('&amp;', '&'));
      return clean
        ? `<a href="${escapeHtml(clean)}" target="_blank" rel="noopener noreferrer">${label}</a>`
        : label;
    })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>');

  return formatted.replace(/\u0000CODE(\d+)\u0000/g, (_, idx) => codeTokens[Number(idx)] || '');
}

const ARTIFACT_LANGS = new Set(['html', 'htm', 'svg']);

/**
 * Extract runnable HTML / SVG code artifacts from markdown text.
 */
export function extractArtifacts(markdown) {
  const artifacts = [];
  const src = String(markdown || '');
  const regex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(src)) !== null) {
    const lang = (match[1] || '').toLowerCase();
    const code = match[2] || '';
    if (ARTIFACT_LANGS.has(lang) || (lang === 'xml' && code.includes('<svg'))) {
      artifacts.push({
        index: artifacts.length,
        lang: lang || 'html',
        code: code.trim(),
        title: lang === 'svg' ? 'Vector Canvas (SVG)' : 'Interactive Web Artifact',
      });
    }
  }
  return artifacts;
}

function wrapSvgAsHtml(svgCode) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:#050507;color:#f4f4f6;display:grid;place-items:center;font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif}
    svg{max-width:94vw;max-height:92vh}
  </style></head><body>${svgCode}</body></html>`;
}

export function buildArtifactSrcdoc(artifact) {
  if (!artifact) return '';
  if (artifact.lang === 'svg' || (!artifact.code.includes('<html') && artifact.code.trim().startsWith('<svg'))) {
    return wrapSvgAsHtml(artifact.code);
  }
  return artifact.code;
}

/**
 * Render markdown string into sanitized HTML with copyable code cards & Run Artifact buttons.
 */
export function renderMarkdown(markdown, { messageId = '' } = {}) {
  const src = String(markdown || '').replace(/\r\n/g, '\n');
  if (!src.trim()) return '';

  // Split out fenced code blocks first so inline formatting never corrupts code.
  const segments = [];
  const fenceRe = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let lastIdx = 0;
  let match;
  let artifactIdx = 0;
  while ((match = fenceRe.exec(src)) !== null) {
    if (match.index > lastIdx) {
      segments.push({ type: 'text', value: src.slice(lastIdx, match.index) });
    }
    const lang = (match[1] || 'text').toLowerCase();
    const code = match[2];
    const isArtifact = ARTIFACT_LANGS.has(lang) || (lang === 'xml' && code.includes('<svg'));
    segments.push({ type: 'code', lang, code, isArtifact, artifactIndex: isArtifact ? artifactIdx++ : -1 });
    lastIdx = fenceRe.lastIndex;
  }
  if (lastIdx < src.length) {
    segments.push({ type: 'text', value: src.slice(lastIdx) });
  }

  return segments.map(seg => {
    if (seg.type === 'code') {
      const artBtn = seg.isArtifact
        ? `<button type="button" class="bw-code-btn is-accent" data-run-artifact="${seg.artifactIndex}" data-msg="${escapeHtml(messageId)}">Run Artifact ↗</button>`
        : '';
      return `
        <div class="bw-code-block">
          <div class="bw-code-head">
            <span class="bw-code-lang">${escapeHtml(seg.lang)}</span>
            <div class="bw-code-actions">
              ${artBtn}
              <button type="button" class="bw-code-btn" data-copy-code="${escapeHtml(encodeURIComponent(seg.code))}">Copy</button>
            </div>
          </div>
          <pre><code>${escapeHtml(seg.code.replace(/\n$/, ''))}</code></pre>
        </div>`;
    }
    return renderTextBlocks(seg.value);
  }).join('\n');
}

function renderTextBlocks(block) {
  const lines = block.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    // Heading
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length + 1;
      out.push(`<h${level} class="bw-h">${renderInline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      const quoteLines = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        quoteLines.push(renderInline(lines[i].slice(2)));
        i++;
      }
      out.push(`<blockquote class="bw-quote">${quoteLines.join('<br>')}</blockquote>`);
      continue;
    }

    // Markdown table
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:-]+\|/.test(lines[i + 1])) {
      const parseRow = r => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
      const headers = parseRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(parseRow(lines[i]));
        i++;
      }
      const thead = `<thead><tr>${headers.map(c => `<th>${renderInline(c)}</th>`).join('')}</tr></thead>`;
      const tbody = `<tbody>${rows.map(r => `<tr>${r.map(c => `<td>${renderInline(c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
      out.push(`<div class="bw-table-wrap"><table>${thead}${tbody}</table></div>`);
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(`<li>${renderInline(lines[i].replace(/^\s*[-*]\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ul class="bw-list">${items.join('')}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(`<li>${renderInline(lines[i].replace(/^\s*\d+\.\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ol class="bw-list">${items.join('')}</ol>`);
      continue;
    }

    // Paragraph
    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,3})\s+/.test(lines[i]) &&
      !lines[i].startsWith('> ') &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      para.push(renderInline(lines[i]));
      i++;
    }
    out.push(`<p>${para.join('<br>')}</p>`);
  }
  return out.join('\n');
}
