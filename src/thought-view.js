import { copyTextWithFeedback, highlightCode, renderReply } from './reply-renderer.js';
import { fileIconElement, languageForPath } from './file-icons.js';
import { providerLogo } from './provider-logos.js';
import { thoughtHeadline } from './action-summary.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const COPY_SVG = '<svg class="code-copy-icon" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5.2" y="5.2" width="8.2" height="8.2" rx="1.6"/><path d="M10.8 5.2V3.4A1.4 1.4 0 0 0 9.4 2H3.4A1.4 1.4 0 0 0 2 3.4v6a1.4 1.4 0 0 0 1.4 1.4h1.8"/></svg>';
const INLINE_THOUGHT_LIMIT = 220;

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const svgEl = (viewBox, size, className, build) => {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  if (className) svg.setAttribute('class', className);
  const path = (d, extra = {}) => {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    for (const [k, v] of Object.entries(extra)) p.setAttribute(k, String(v));
    svg.append(p);
  };
  const rect = (x, y, width, height, rx = 2) => {
    const r = document.createElementNS(SVG_NS, 'rect');
    r.setAttribute('x', String(x)); r.setAttribute('y', String(y));
    r.setAttribute('width', String(width)); r.setAttribute('height', String(height));
    r.setAttribute('rx', String(rx));
    svg.append(r);
  };
  build({ svg, path, rect });
  return svg;
};

export function brainIcon(className = 'thought-brain-svg') {
  return svgEl('0 0 24 24', 15, className, ({ path }) => {
    path('M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z');
    path('M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z');
    path('M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4');
    path('M17.599 6.5a3 3 0 0 0 .399-1.375');
    path('M6.003 5.125A3 3 0 0 0 6.401 6.5');
    path('M3.477 10.896a4 4 0 0 1 .585-.396');
    path('M19.938 10.5a4 4 0 0 1 .585.396');
    path('M6 18a4 4 0 0 1-1.967-.516');
    path('M19.967 17.484A4 4 0 0 1 18 18');
  });
}

export function actionIcon(kind = 'tool', className = 'action-row-icon') {
  return svgEl('0 0 24 24', 14, className, ({ path, rect }) => {
    if (kind === 'terminal') {
      path('M4 17l6-5-6-5');
      path('M12 19h8');
      return;
    }
    if (kind === 'device') {
      rect(6, 2.5, 12, 19, 2.5);
      path('M10.5 18h3');
      return;
    }
    if (kind === 'file') {
      path('M14 2.5H7a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z');
      path('M14 2.5v5.5h5');
      return;
    }
    if (kind === 'edit') {
      path('M12 20h9');
      path('M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z');
      return;
    }
    if (kind === 'globe') {
      rect(3, 3, 18, 18, 9);
      path('M3 12h18');
      path('M12 3a13 13 0 0 1 0 18');
      path('M12 3a13 13 0 0 0 0 18');
      return;
    }
    // Hammer / action-group icon.
    path('m15 12-8.373 8.373a1 1 0 1 1-3-3L12 9');
    path('m18 15 4-4');
    path('m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172V7l-2.26-2.26a6 6 0 0 0-4.202-1.756L9 2.96l.92.82A6.18 6.18 0 0 1 12 8.4V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5');
  });
}

function handoffSwapIcon() {
  return svgEl('0 0 24 24', 13, 'context-handoff-swap', ({ path }) => {
    path('m17 3 4 4-4 4');
    path('M21 7H5');
    path('m7 21-4-4 4-4');
    path('M3 17h16');
  });
}

/**
 * Create a centered divider pill representing a cross-provider context handoff.
 */
export function createHandoffDivider(handoff) {
  const wrap = el('div', 'context-handoff');
  wrap.setAttribute('role', 'separator');
  const pill = el('span', 'context-handoff-pill');
  pill.append(handoffSwapIcon(), el('span', 'context-handoff-label', 'Context handoff'));

  const makeProviderChip = (side, isTarget) => {
    const family = String(side?.family || 'unknown').toLowerCase();
    const chip = el('span', `handoff-provider is-${family}${isTarget ? ' is-target' : ''}`);
    const logo = providerLogo(family);
    if (logo) {
      const logoWrap = el('span', 'handoff-provider-logo');
      logoWrap.append(logo);
      chip.append(logoWrap);
    }
    chip.append(el('span', 'handoff-provider-name', side?.label || 'Assistant'));
    return chip;
  };

  pill.append(
    makeProviderChip(handoff?.from, false),
    el('span', 'context-handoff-arrow', '→'),
    makeProviderChip(handoff?.to, true),
  );
  wrap.append(pill);
  return wrap;
}

export function formatThoughtDuration(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return '';
  if (value < 1000) return '<1s';
  const seconds = value / 1000;
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60), rem = Math.round(seconds % 60);
  return rem ? `${mins}m ${rem}s` : `${mins}m`;
}

function isShortInlineThought(text) {
  return text.length > 0 && text.length <= INLINE_THOUGHT_LIMIT && !/\n\n|```/.test(text);
}

export function createPendingThinkingRow(label = 'Thinking') {
  const row = el('div', 'thought-shimmer pending-thinking');
  const brain = el('span', 'thought-brain'); brain.append(brainIcon());
  const text = el('span', 'stream-shimmer-text', label);
  row.append(brain, text);
  return row;
}

export function createThoughtNode(thought, { openLink, defaultOpen = false } = {}) {
  if (thought?.kind === 'commentary') {
    const node = el('div', 'stream-commentary rich-reply');
    if (thought.id) node.dataset.thoughtId = thought.id;
    node._isCommentary = true;
    node._openLink = openLink;
    node._lastText = null;
    updateThoughtNode(node, thought, { openLink });
    return node;
  }

  const node = el('div', 'thought-entry');
  if (thought?.id) node.dataset.thoughtId = thought.id;
  node._openLink = openLink;
  node._defaultOpen = Boolean(defaultOpen);
  node._userExpanded = null;
  node._lastText = null;
  node._lastStatus = null;

  const inlineRow = el('div', 'thought-row-inline');
  const inlineBrain = el('span', 'thought-brain'); inlineBrain.append(brainIcon());
  const inlineBody = el('div', 'thought-inline rich-reply');
  inlineRow.append(inlineBrain, inlineBody);

  const details = el('details', 'thought-block');
  const head = el('summary', 'thought-head');
  head.addEventListener('click', () => {
    node._userExpanded = !details.open;
    details.dataset.userToggled = '1';
  });
  const headBrain = el('span', 'thought-brain'); headBrain.append(brainIcon());
  const headTitle = el('span', 'thought-title');
  const chevron = el('span', 'thought-chevron'); chevron.setAttribute('aria-hidden', 'true');
  head.append(headBrain, headTitle, chevron);
  const detailsBody = el('div', 'thought-body rich-reply');
  details.append(head, detailsBody);

  const shimmerRow = createPendingThinkingRow('Thinking');

  node.append(inlineRow, details, shimmerRow);
  node._parts = { inlineRow, inlineBody, details, headTitle, detailsBody, shimmerRow };
  updateThoughtNode(node, thought, { openLink });
  return node;
}

export function updateThoughtNode(node, thought, { openLink } = {}) {
  const linkFn = openLink || node._openLink;
  const status = thought?.status === 'running' ? 'running' : 'done';
  const nextText = String(thought?.text || '').trim();

  if (node._isCommentary || thought?.kind === 'commentary') {
    node.className = `stream-commentary rich-reply ${status}`;
    const drawCommentary = () => {
      node._renderTimer = null;
      node._lastDrawAt = Date.now();
      const text = node._pendingText ?? nextText;
      const st = node._pendingStatus ?? status;
      if (node._lastText === text && node._lastStatus === st) return;
      node._lastText = text;
      node._lastStatus = st;
      if (text) renderReply(node, text, linkFn);
      else node.replaceChildren();
    };
    node._pendingText = nextText;
    node._pendingStatus = status;
    if (status !== 'running' || !node._lastDrawAt || Date.now() - node._lastDrawAt >= 50) {
      clearTimeout(node._renderTimer);
      drawCommentary();
    } else if (!node._renderTimer) {
      node._renderTimer = setTimeout(drawCommentary, 50);
    }
    return;
  }

  node.className = `thought-entry ${status}`;
  const { inlineRow, inlineBody, details, headTitle, detailsBody, shimmerRow } = node._parts;

  const drawThought = () => {
    node._renderTimer = null;
    node._lastDrawAt = Date.now();
    const text = node._pendingText ?? nextText;
    const st = node._pendingStatus ?? status;
    const dur = node._pendingDur ?? thought?.durationMs;
    if (node._lastText === text && node._lastStatus === st && node._lastDur === dur) return;
    node._lastText = text;
    node._lastStatus = st;
    node._lastDur = dur;

    const running = st === 'running';
    shimmerRow.hidden = !running;

    if (!text) {
      inlineRow.hidden = true;
      details.hidden = true;
      return;
    }

    if (running || isShortInlineThought(text)) {
      inlineRow.hidden = false;
      details.hidden = true;
      renderReply(inlineBody, text, linkFn);
      return;
    }

    inlineRow.hidden = true;
    details.hidden = false;
    headTitle.textContent = thoughtHeadline(text, dur, st);
    details.open = node._userExpanded !== null ? node._userExpanded : node._defaultOpen;
    renderReply(detailsBody, text, linkFn);
  };

  node._pendingText = nextText;
  node._pendingStatus = status;
  node._pendingDur = thought?.durationMs;
  if (status !== 'running' || !node._lastDrawAt || Date.now() - node._lastDrawAt >= 50) {
    clearTimeout(node._renderTimer);
    drawThought();
  } else if (!node._renderTimer) {
    node._renderTimer = setTimeout(drawThought, 50);
  }
}

export function createCodeBlockElement(code, language = 'bash', { label = '', showHeader = true } = {}) {
  const wrap = el('div', 'code-block');
  const text = String(code ?? '');
  if (language) wrap.dataset.lang = language;
  if (showHeader) {
    const header = el('div', 'code-block-header');
    const langSpan = el('span', 'code-block-lang');
    langSpan.append(fileIconElement(language === 'bash' || language === 'shell' || language === 'zsh' ? 'cmd.sh' : `file.${language}`), el('span', 'code-block-label', label || language));
    const copy = el('button', 'code-copy');
    copy.type = 'button';
    copy.setAttribute('aria-label', 'Copy code');
    copy.innerHTML = `${COPY_SVG}<span>Copy</span>`;
    copy.onclick = event => { event.preventDefault(); event.stopPropagation(); copyTextWithFeedback(copy, text); };
    header.append(langSpan, copy);
    wrap.append(header);
  }
  const pre = el('pre', 'code-pre');
  const codeNode = el('code', `hljs${language ? ` language-${language}` : ''}`);
  // highlightCode returns only Highlight.js escaped tokens / escaped plain text.
  codeNode.innerHTML = highlightCode(text, language).html;
  pre.append(codeNode);
  wrap.append(pre);
  return wrap;
}

export function createCommandNode(row) {
  const node = el('div', 'work-row work-command');
  if (row.id) node.dataset.rowId = row.id;
  const head = el('div', 'work-command-head');
  const dot = el('span', 'work-command-dot'); dot.setAttribute('aria-hidden', 'true');
  const icon = fileIconElement('cmd.sh', { className: 'work-command-icon' });
  const verb = el('span', 'work-verb');
  const reason = el('span', 'work-command-reason');
  const tags = el('span', 'work-command-tags');
  const detail = el('span', 'work-detail');
  const copy = el('button', 'code-copy work-command-copy');
  copy.type = 'button';
  copy.setAttribute('aria-label', 'Copy command');
  copy.innerHTML = `${COPY_SVG}<span>Copy</span>`;
  head.append(dot, icon, verb, reason, tags, detail, copy);

  const codeWrap = el('div', 'work-command-code');
  const pre = el('pre', 'code-pre');
  const code = el('code', 'hljs language-bash');
  pre.append(code);
  codeWrap.append(pre);

  const outputWrap = el('details', 'work-command-output-wrap');
  outputWrap.hidden = true;
  const outputSummary = el('summary', 'work-command-output-summary');
  outputSummary.addEventListener('click', () => { outputWrap.dataset.userToggled = '1'; });
  const outputPre = el('pre', 'work-output');
  outputWrap.append(outputSummary, outputPre);

  node.append(head, codeWrap, outputWrap);
  node._parts = { verb, reason, tags, detail, copy, code, outputWrap, outputSummary, outputPre };
  node._lastCommand = null;
  node._lastOutput = null;
  updateCommandNode(node, row);
  return node;
}

export function updateCommandNode(node, row) {
  const status = row.status || 'done';
  node.className = `work-row work-command ${status}`;
  const { verb, reason, tags, detail, copy, code, outputWrap, outputSummary, outputPre } = node._parts;
  verb.textContent = status === 'running' ? 'Running command' : status === 'failed' ? 'Command failed' : 'Ran command';
  reason.textContent = row.reason || '';
  reason.hidden = !row.reason;

  const tagList = [];
  if (row.network) tagList.push(el('span', 'work-tag', 'network'));
  if (row.local) tagList.push(el('span', 'work-tag', 'local ports'));
  if (row.outside) tagList.push(el('span', 'work-tag outside', 'outside sandbox'));
  tags.replaceChildren(...tagList);
  tags.hidden = !tagList.length;

  detail.textContent = row.detail || (status === 'running' ? 'Running…' : '');
  detail.hidden = !detail.textContent;

  const commandText = String(row.command || row.summary || '');
  if (node._lastCommand !== commandText) {
    node._lastCommand = commandText;
    // highlightCode returns only Highlight.js escaped tokens / escaped plain text.
    code.innerHTML = highlightCode(commandText, 'bash').html;
    copy.onclick = event => { event.preventDefault(); event.stopPropagation(); copyTextWithFeedback(copy, commandText); };
  }

  const outText = String(row.output || '');
  if (outText) {
    outputWrap.hidden = false;
    const lines = outText.split('\n').length;
    outputSummary.textContent = status === 'running' ? `Output · streaming (${lines} ${lines === 1 ? 'line' : 'lines'})` : `Output · ${lines} ${lines === 1 ? 'line' : 'lines'}`;
    if (node._lastOutput !== outText) {
      node._lastOutput = outText;
      outputPre.textContent = outText;
      if (status === 'running') outputPre.scrollTop = outputPre.scrollHeight;
    }
    outputPre.classList.toggle('live', status === 'running');
    if (!outputWrap.dataset.userToggled) {
      outputWrap.open = status === 'running' || status === 'failed' || lines <= 12;
    }
  } else {
    outputWrap.hidden = true;
    node._lastOutput = '';
  }
}

export function createHighlightedDiff(diff, filePath = '') {
  const view = el('pre', 'work-diff');
  let lang = languageForPath(filePath);
  for (const row of diff.rows || []) {
    // Combined helper diffs have header lines like `── path/to/file.js`.
    const header = /^──\s+(.+?)(?:\s+\(not text\))?$/.exec(String(row.text || ''));
    if (row.type === ' ' && header) {
      lang = languageForPath(header[1]);
      view.append(el('span', 'meta', `${row.type} ${row.text}\n`));
      continue;
    }
    const line = el('span', row.type === '+' ? 'add' : row.type === '-' ? 'del' : '');
    const prefix = el('span', 'diff-sign', `${row.type} `);
    const content = el('span', 'diff-code');
    if (lang) content.innerHTML = highlightCode(row.text, lang).html;
    else content.textContent = row.text;
    line.append(prefix, content, '\n');
    view.append(line);
  }
  if (diff.truncated) view.append(el('span', 'more', '… more lines not shown\n'));
  return view;
}
