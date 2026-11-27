/**
 * Smooth live agent cursor + click ripple overlay inside the Browser pane host.
 */
export function createAgentCursorOverlay(host) {
  let cursor = null;
  let labelEl = null;

  function ensure() {
    if (cursor || !host || typeof document === 'undefined') return;
    cursor = document.createElement('div');
    cursor.className = 'browser-agent-cursor';
    cursor.hidden = true;
    const dot = document.createElement('span');
    dot.className = 'browser-agent-cursor-dot';
    labelEl = document.createElement('span');
    labelEl.className = 'browser-agent-cursor-label';
    cursor.append(dot, labelEl);
    host.append(cursor);
  }

  return {
    moveTo(x, y, label = '') {
      ensure();
      if (!cursor) return;
      cursor.hidden = false;
      cursor.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      if (labelEl) {
        labelEl.textContent = String(label || '');
        labelEl.hidden = !label;
      }
    },
    clickAt(x, y, label = '') {
      this.moveTo(x, y, label);
      if (!host || typeof document === 'undefined') return;
      const ripple = document.createElement('span');
      ripple.className = 'browser-cursor-ripple';
      ripple.style.left = `${Math.round(x)}px`;
      ripple.style.top = `${Math.round(y)}px`;
      host.append(ripple);
      setTimeout(() => ripple.remove(), 550);
    },
    hide() {
      if (cursor) cursor.hidden = true;
    },
    destroy() {
      cursor?.remove();
      cursor = null;
      labelEl = null;
    },
  };
}

/**
 * Floating Picture-in-Picture mini preview shown when navigating away from the Browser pane with PiP enabled.
 */
export function createBrowserPipPlayer({ onExpand = () => {}, onClose = () => {} } = {}) {
  let box = null;
  let titleEl = null;
  let urlEl = null;

  function ensure() {
    if (box || typeof document === 'undefined') return;
    box = document.createElement('aside');
    box.className = 'browser-pip';
    box.hidden = true;
    const head = document.createElement('div');
    head.className = 'browser-pip-head';
    titleEl = document.createElement('strong');
    titleEl.textContent = 'Browser PiP';
    const actions = document.createElement('div');
    actions.className = 'browser-pip-actions';
    const expand = document.createElement('button');
    expand.type = 'button';
    expand.className = 'wt-btn';
    expand.textContent = 'Open';
    expand.onclick = () => onExpand();
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'wt-btn';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Close PiP');
    close.onclick = () => {
      box.hidden = true;
      onClose();
    };
    actions.append(expand, close);
    head.append(titleEl, actions);

    urlEl = document.createElement('div');
    urlEl.className = 'browser-pip-url';
    box.append(head, urlEl);
    document.body.append(box);
  }

  return {
    setFrame({ title = 'Browser', url = '', note = '' } = {}) {
      ensure();
      if (!box) return;
      if (titleEl) titleEl.textContent = title || 'Browser';
      if (urlEl) urlEl.textContent = note || url || 'No page loaded';
    },
    show() {
      ensure();
      if (box) box.hidden = false;
    },
    hide() {
      if (box) box.hidden = true;
    },
    isOpen: () => Boolean(box && !box.hidden),
    destroy() {
      box?.remove();
      box = null;
    },
  };
}

/**
 * Annotated canvas recorder logging timestamped browser state/action keyframes into a bounded timeline.
 */
export function createAnnotatedCanvasRecorder({ maxFrames = 120, now = Date.now } = {}) {
  let active = false;
  let startedAt = 0;
  const recorded = [];

  return {
    start() {
      active = true;
      startedAt = now();
      recorded.length = 0;
      return true;
    },
    captureFrame({ url = '', title = '', note = '', cursor = null } = {}) {
      if (!active) return null;
      const frame = {
        index: recorded.length,
        atMs: Math.max(0, now() - startedAt),
        url: String(url || ''),
        title: String(title || ''),
        note: String(note || ''),
        ...(cursor ? { cursor } : {}),
      };
      recorded.push(frame);
      if (recorded.length > maxFrames) recorded.shift();
      return frame;
    },
    stop() {
      active = false;
      return this.exportTimeline();
    },
    isRecording: () => active,
    frames: () => recorded.map(f => ({ ...f })),
    exportTimeline() {
      return {
        startedAt,
        durationMs: recorded.length ? recorded.at(-1).atMs : 0,
        frameCount: recorded.length,
        frames: recorded.map(f => ({ ...f })),
      };
    },
  };
}
