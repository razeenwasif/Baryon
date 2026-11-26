/**
 * Normalize and trim a selected passage from an assistant reply for citation chips.
 */
export function extractAssistantQuote(text, maxLen = 280) {
  const clean = String(text ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return '';
  if (clean.length <= maxLen) return clean;
  const slice = clean.slice(0, maxLen);
  const boundary = Math.max(slice.lastIndexOf(' '), slice.lastIndexOf('\n'));
  return `${slice.slice(0, boundary > maxLen * 0.6 ? boundary : maxLen).trim()}…`;
}

/**
 * Format active quote/citation chips as clean Markdown blockquotes prepended to the user's prompt.
 */
export function formatQuotedPrompt(quotes = [], text = '') {
  const items = (Array.isArray(quotes) ? quotes : []).filter(q => q && (q.formatted || q.snippet || q.text));
  const body = String(text ?? '').trim();
  if (!items.length) return body;
  const blocks = items.map(q => {
    const raw = q.formatted
      ? String(q.formatted).trim()
      : String(q.snippet || q.text).trim().split('\n').map(line => `> ${line}`).join('\n');
    const comment = String(q.comment || '').trim();
    return comment ? `${raw}\nNote: ${comment}` : raw;
  });
  return body ? `${blocks.join('\n\n')}\n\n${body}` : blocks.join('\n\n');
}

/**
 * Floating assistant text-selection Quote toolbar + composer citation chip bar.
 */
export function setupQuoteSelection({ messagesEl, composerQuotesEl, dock, input, onQuote, onSideChat } = {}) {
  let quotes = [];
  let toolbar = null;
  let currentSelection = '';
  let hideTimer = null;

  function ensureToolbar() {
    if (toolbar) return toolbar;
    toolbar = document.createElement('div');
    toolbar.className = 'quote-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', 'Quote selection');
    toolbar.hidden = true;

    const quoteBtn = document.createElement('button');
    quoteBtn.type = 'button';
    quoteBtn.className = 'quote-toolbar-btn';
    quoteBtn.textContent = '❝ Quote';
    quoteBtn.onmousedown = event => event.preventDefault();
    quoteBtn.onclick = () => {
      const selected = currentSelection;
      if (!selected) return;
      add({ snippet: extractAssistantQuote(selected, 400), text: selected, source: 'reply' });
      onQuote?.(selected);
      window.getSelection?.()?.removeAllRanges?.();
      hideToolbar();
      input?.focus();
    };

    const sideBtn = document.createElement('button');
    sideBtn.type = 'button';
    sideBtn.className = 'quote-toolbar-btn';
    sideBtn.textContent = 'Side chat';
    sideBtn.onmousedown = event => event.preventDefault();
    sideBtn.onclick = () => {
      const selected = currentSelection;
      if (!selected) return;
      onSideChat?.(extractAssistantQuote(selected, 600));
      window.getSelection?.()?.removeAllRanges?.();
      hideToolbar();
    };

    toolbar.append(quoteBtn, sideBtn);
    document.body.append(toolbar);
    return toolbar;
  }

  function hideToolbar() {
    currentSelection = '';
    if (toolbar) toolbar.hidden = true;
  }

  function drawChips() {
    if (!composerQuotesEl) return;
    composerQuotesEl.hidden = !quotes.length;
    if (!quotes.length) {
      composerQuotesEl.replaceChildren();
      return;
    }
    const chips = quotes.map(q => {
      const chip = document.createElement('div');
      chip.className = 'quote-chip';
      chip.dataset.quoteId = q.id;

      const label = document.createElement('span');
      label.className = 'quote-chip-label';
      label.textContent = q.source === 'side-chat' ? 'Side chat' : 'Quote';

      const snippet = document.createElement('span');
      snippet.className = 'quote-chip-snippet';
      const plain = String(q.snippet || q.text || '').replace(/\s+/g, ' ').trim();
      snippet.textContent = plain.length > 96 ? `${plain.slice(0, 95).trim()}…` : plain;
      snippet.title = q.snippet || q.text || '';

      const commentInput = document.createElement('input');
      commentInput.type = 'text';
      commentInput.className = 'quote-chip-comment';
      commentInput.placeholder = 'Note…';
      commentInput.value = q.comment || '';
      commentInput.setAttribute('aria-label', 'Optional comment on quote');
      commentInput.oninput = () => { q.comment = commentInput.value; };

      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'quote-chip-remove';
      rm.textContent = '×';
      rm.setAttribute('aria-label', 'Remove quote');
      rm.onclick = () => {
        quotes = quotes.filter(other => other.id !== q.id);
        drawChips();
        dock?.dispatchEvent?.(new CustomEvent('fairy:quotes-change'));
      };

      chip.append(label, snippet, commentInput, rm);
      return chip;
    });
    composerQuotesEl.replaceChildren(...chips);
  }

  function add(item) {
    if (!item) return null;
    const entry = {
      id: item.id || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      snippet: item.snippet || extractAssistantQuote(item.text || ''),
      text: item.text || item.snippet || '',
      formatted: item.formatted || '',
      comment: item.comment || '',
      source: item.source || 'reply',
    };
    quotes.push(entry);
    drawChips();
    return entry;
  }

  function updateToolbar() {
    if (!messagesEl) return;
    const sel = window.getSelection?.();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      hideToolbar();
      return;
    }
    const text = sel.toString().trim();
    if (text.length < 3) {
      hideToolbar();
      return;
    }
    const range = sel.getRangeAt(0);
    const common = range.commonAncestorContainer;
    const el = common.nodeType === 1 ? common : common.parentElement;
    if (!el || !messagesEl.contains(el)) {
      hideToolbar();
      return;
    }
    const msg = el.closest('.message.assistant');
    if (!msg || el.closest('button, input, textarea, dialog')) {
      hideToolbar();
      return;
    }
    const rect = range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) {
      hideToolbar();
      return;
    }
    currentSelection = text;
    const bar = ensureToolbar();
    bar.hidden = false;
    const left = Math.max(12, Math.min(window.innerWidth - 180, rect.left + rect.width / 2 - 80));
    const top = Math.max(12, rect.top - 38);
    bar.style.left = `${Math.round(left)}px`;
    bar.style.top = `${Math.round(top)}px`;
  }

  const scheduleUpdate = () => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(updateToolbar, 20);
  };

  messagesEl?.addEventListener('mouseup', scheduleUpdate);
  messagesEl?.addEventListener('keyup', scheduleUpdate);
  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection?.();
    if (!sel || sel.isCollapsed) hideToolbar();
  });
  messagesEl?.addEventListener('scroll', hideToolbar, { passive: true });

  return {
    add,
    list: () => [...quotes],
    take() { const taken = quotes; quotes = []; drawChips(); return taken; },
    restore(items = []) {
      const valid = Array.isArray(items) ? items : [];
      quotes = [...valid, ...quotes.filter(q => !valid.some(v => v.id === q.id))];
      drawChips();
    },
    clear() { quotes = []; drawChips(); },
  };
}
