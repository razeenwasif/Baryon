const DEFAULT_KEY = '__default__';
const sessionKey = id => (typeof id === 'string' && id.trim() ? id.trim() : DEFAULT_KEY);

/**
 * Pure disposable side-chat store keyed by parent session id.
 * Side turns never modify the parent session's saved history unless the user clicks "Add to chat".
 */
export function createSideChatStore({ now = Date.now } = {}) {
  const bySession = new Map();

  const turns = sessionId => [...(bySession.get(sessionKey(sessionId)) || [])];

  function append(sessionId, { question = '', answer = '', quote = '' } = {}) {
    const q = String(question ?? '').trim();
    const a = String(answer ?? '').trim();
    const qt = String(quote ?? '').trim();
    if (!q && !a) return null;
    const key = sessionKey(sessionId);
    const list = bySession.get(key) || [];
    const entry = { id: `${now().toString(36)}-${list.length + 1}`, question: q, answer: a, quote: qt, at: now() };
    list.push(entry);
    bySession.set(key, list);
    return entry;
  }

  function clear(sessionId) {
    bySession.delete(sessionKey(sessionId));
  }

  function formatForMainChat(turn) {
    if (!turn) return '';
    const q = String(turn.question || '').trim();
    const a = String(turn.answer || '').trim();
    const parts = [];
    if (q) parts.push(`Side question: ${q}`);
    if (a) parts.push(a);
    return parts.join('\n\n').split('\n').map(line => `> ${line}`).join('\n');
  }

  function formatAllForMainChat(sessionId) {
    const list = turns(sessionId);
    if (!list.length) return '';
    return list.map(formatForMainChat).join('\n\n');
  }

  function buildPrompt(sessionId, question, quote = '') {
    const cleanQ = String(question ?? '').trim();
    const cleanQuote = String(quote ?? '').trim();
    const recent = turns(sessionId).slice(-4);
    const blocks = [];
    if (recent.length) {
      blocks.push('Earlier in this side chat:\n' + recent.map(t => `User: ${t.question}\nAssistant: ${t.answer}`).join('\n---\n'));
    }
    if (cleanQuote) {
      blocks.push('Quoted passage from the main reply:\n' + cleanQuote.split('\n').map(l => `> ${l}`).join('\n'));
    }
    blocks.push(cleanQ);
    return blocks.join('\n\n');
  }

  return { turns, append, clear, formatForMainChat, formatAllForMainChat, buildPrompt };
}

/**
 * Side-panel controller for disposable Side Chats with one-click "Add to chat" into the main composer.
 */
export function sideChatPane({ api, activeSession, renderText, onAddToChat, onError } = {}) {
  const store = createSideChatStore();
  let pendingQuote = '';
  let ctxRef = null;
  let sending = false;

  function renderTurn(turn) {
    const card = document.createElement('article');
    card.className = 'side-chat-turn';

    if (turn.quote) {
      const q = document.createElement('blockquote');
      q.className = 'side-chat-quote';
      q.textContent = turn.quote.length > 180 ? `${turn.quote.slice(0, 179).trim()}…` : turn.quote;
      card.append(q);
    }

    const ask = document.createElement('div');
    ask.className = 'side-chat-q';
    ask.textContent = turn.question;
    card.append(ask);

    const ans = document.createElement('div');
    ans.className = 'side-chat-a';
    if (renderText) renderText(ans, turn.answer || '');
    else ans.textContent = turn.answer || '';
    card.append(ans);

    const bar = document.createElement('div');
    bar.className = 'side-chat-turn-actions';
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'quiet';
    addBtn.textContent = 'Add to chat';
    addBtn.title = 'Insert this side answer into the main composer';
    addBtn.onclick = () => onAddToChat?.({
      text: turn.answer,
      snippet: turn.question ? `${turn.question}: ${turn.answer}` : turn.answer,
      formatted: store.formatForMainChat(turn),
      source: 'side-chat',
    });
    bar.append(addBtn);
    card.append(bar);
    return card;
  }

  function render(body, context) {
    ctxRef = context;
    const sid = activeSession?.() || '';
    const turns = store.turns(sid);

    const wrap = document.createElement('div');
    wrap.className = 'side-chat-pane';

    const head = document.createElement('div');
    head.className = 'side-chat-head';
    const titleWrap = document.createElement('div');
    titleWrap.className = 'side-chat-title-wrap';
    const h4 = document.createElement('h4');
    h4.textContent = 'Side chat';
    const hint = document.createElement('span');
    hint.className = 'side-chat-hint';
    hint.textContent = 'Doesn’t enter main context unless you add it';
    titleWrap.append(h4, hint);

    const headBtns = document.createElement('div');
    headBtns.className = 'side-chat-head-btns';
    if (turns.length) {
      const addAllBtn = document.createElement('button');
      addAllBtn.type = 'button';
      addAllBtn.className = 'quiet';
      addAllBtn.textContent = 'Add all to chat';
      addAllBtn.onclick = () => onAddToChat?.({
        text: turns.map(t => t.answer).join('\n\n'),
        snippet: `Side chat (${turns.length} turn${turns.length > 1 ? 's' : ''})`,
        formatted: store.formatAllForMainChat(sid),
        source: 'side-chat',
      });
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'quiet';
      clearBtn.textContent = 'Clear';
      clearBtn.onclick = () => {
        store.clear(sid);
        pendingQuote = '';
        render(body, context);
      };
      headBtns.append(addAllBtn, clearBtn);
    }
    head.append(titleWrap, headBtns);

    const log = document.createElement('div');
    log.className = 'side-chat-log';
    if (!turns.length && !pendingQuote) {
      const empty = document.createElement('p');
      empty.className = 'side-chat-empty';
      empty.textContent = 'Ask a tangent or clarifying question here without cluttering the main thread—even while Fairy is working.';
      log.append(empty);
    } else {
      for (const turn of turns) log.append(renderTurn(turn));
    }

    const composer = document.createElement('div');
    composer.className = 'side-chat-composer';

    if (pendingQuote) {
      const quoteChip = document.createElement('div');
      quoteChip.className = 'side-chat-pending-quote';
      const qtSpan = document.createElement('span');
      qtSpan.textContent = `“${pendingQuote.length > 140 ? `${pendingQuote.slice(0, 139).trim()}…` : pendingQuote}”`;
      const rmBtn = document.createElement('button');
      rmBtn.type = 'button';
      rmBtn.textContent = '×';
      rmBtn.setAttribute('aria-label', 'Remove quoted text');
      rmBtn.onclick = () => { pendingQuote = ''; render(body, context); };
      quoteChip.append(qtSpan, rmBtn);
      composer.append(quoteChip);
    }

    const row = document.createElement('div');
    row.className = 'side-chat-input-row';
    const input = document.createElement('textarea');
    input.className = 'side-chat-input';
    input.rows = 2;
    input.placeholder = 'Ask a quick side question…';
    input.setAttribute('aria-label', 'Ask a side question');
    const sendBtn = document.createElement('button');
    sendBtn.type = 'button';
    sendBtn.className = 'side-chat-send';
    sendBtn.textContent = 'Ask';
    sendBtn.disabled = sending;

    async function askSide() {
      const question = input.value.trim();
      if (!question || sending) return;
      if (!api?.btw) { onError?.('Side chat requires the desktop app.'); return; }
      sending = true;
      sendBtn.disabled = true;
      input.disabled = true;
      const usedQuote = pendingQuote;
      const prompt = store.buildPrompt(sid, question, usedQuote);
      const tempCard = document.createElement('article');
      tempCard.className = 'side-chat-turn is-pending';
      const qEl = document.createElement('div');
      qEl.className = 'side-chat-q';
      qEl.textContent = question;
      const aEl = document.createElement('div');
      aEl.className = 'side-chat-a';
      aEl.textContent = 'Thinking…';
      tempCard.append(qEl, aEl);
      log.querySelector('.side-chat-empty')?.remove();
      log.append(tempCard);
      log.scrollTop = log.scrollHeight;
      try {
        const reply = await api.btw(prompt);
        const answer = reply?.text || 'No answer came back.';
        store.append(sid, { question, answer, quote: usedQuote });
        pendingQuote = '';
        input.value = '';
      } catch (err) {
        onError?.(err.message);
      } finally {
        sending = false;
        render(body, context);
      }
    }

    input.onkeydown = event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        void askSide();
      }
    };
    sendBtn.onclick = () => void askSide();
    row.append(input, sendBtn);
    composer.append(row);

    wrap.append(head, log, composer);
    body.replaceChildren(wrap);
    log.scrollTop = log.scrollHeight;
  }

  return {
    id: 'side-chat',
    title: 'Side chat',
    store,
    render,
    setQuote(text) {
      pendingQuote = String(text ?? '').trim();
      ctxRef?.redraw?.();
    },
    seedTurn({ question, answer, quote = '' }) {
      const sid = activeSession?.() || '';
      store.append(sid, { question, answer, quote });
      ctxRef?.redraw?.();
    },
    refresh() {
      ctxRef?.redraw?.();
    },
    reset() {
      pendingQuote = '';
    },
  };
}
