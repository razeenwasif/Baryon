let nextCommentId = 1;

/**
 * Formats attached diff review comments together with the user's message before sending to Fairy.
 */
export function formatReviewCommentsPrompt(comments = [], promptText = '') {
  const list = Array.isArray(comments) ? comments.filter(c => c && (c.comment || c.snippet)) : [];
  const body = String(promptText ?? '').trim();
  if (!list.length) return body;
  const header = list
    .map((item, idx) => {
      const loc = item.line ? `${item.path}:${item.line}` : item.path || 'diff';
      const snippet = item.snippet ? `\n\`\`\`diff\n${String(item.snippet).slice(0, 600)}\n\`\`\`` : '';
      return `Review comment ${idx + 1} (${loc}): ${String(item.comment || '').trim()}${snippet}`;
    })
    .join('\n\n');
  return body ? `${header}\n\n${body}` : header;
}

/**
 * Per-session store for inline diff review annotations queued into the composer.
 */
export function createDiffAnnotationStore() {
  const bySession = new Map();
  const listeners = new Set();

  const bucket = sid => {
    const key = sid || 'default';
    let arr = bySession.get(key);
    if (!arr) {
      arr = [];
      bySession.set(key, arr);
    }
    return arr;
  };

  const emit = () => {
    for (const fn of listeners) {
      try { fn(); } catch {}
    }
  };

  return {
    list(sid) {
      return bucket(sid).map(item => ({ ...item }));
    },
    add(sid, { path = '', line = 0, side = 'new', snippet = '', comment = '' } = {}) {
      const cleanComment = String(comment ?? '').trim().slice(0, 1000);
      const cleanPath = String(path ?? '').trim();
      if (!cleanPath || !cleanComment) return null;
      const entry = {
        id: `rc-${nextCommentId++}`,
        path: cleanPath,
        line: Number.isInteger(line) && line > 0 ? line : 0,
        side: side === 'old' ? 'old' : 'new',
        snippet: String(snippet ?? '').slice(0, 600),
        comment: cleanComment,
        createdAt: Date.now(),
      };
      bucket(sid).push(entry);
      emit();
      return { ...entry };
    },
    remove(sid, id) {
      const list = bucket(sid);
      const idx = list.findIndex(item => item.id === id);
      if (idx < 0) return false;
      list.splice(idx, 1);
      emit();
      return true;
    },
    take(sid) {
      const taken = this.list(sid);
      if (taken.length) {
        bySession.set(sid || 'default', []);
        emit();
      }
      return taken;
    },
    restore(sid, entries = []) {
      if (!Array.isArray(entries) || !entries.length) return;
      bucket(sid).unshift(...entries.map(item => ({ ...item })));
      emit();
    },
    clear(sid) {
      if (!bucket(sid).length) return;
      bySession.set(sid || 'default', []);
      emit();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/**
 * Renders removable review comment chips inside `#composer-review-chips` above the composer.
 */
export function setupDiffAnnotationChips({ container, store, activeSession = () => 'default', onJump = () => {} } = {}) {
  if (!container || !store) return { render: () => {} };

  function render() {
    const sid = activeSession();
    const list = store.list(sid);
    if (!list.length) {
      container.hidden = true;
      container.replaceChildren();
      return;
    }
    const nodes = list.map(item => {
      const chip = document.createElement('div');
      chip.className = 'review-chip';

      const loc = document.createElement('button');
      loc.type = 'button';
      loc.className = 'review-chip-loc';
      loc.textContent = item.line ? `${item.path}:${item.line}` : item.path;
      loc.title = item.snippet || item.path;
      loc.onclick = () => onJump(item);

      const text = document.createElement('span');
      text.className = 'review-chip-text';
      text.textContent = item.comment;

      const rmBtn = document.createElement('button');
      rmBtn.type = 'button';
      rmBtn.className = 'quote-chip-remove';
      rmBtn.textContent = '×';
      rmBtn.setAttribute('aria-label', 'Remove review comment');
      rmBtn.onclick = () => store.remove(sid, item.id);

      chip.append(loc, text, rmBtn);
      return chip;
    });
    container.hidden = false;
    container.replaceChildren(...nodes);
  }

  store.subscribe(render);
  return { render };
}
