import { createAgentCursorOverlay, createAnnotatedCanvasRecorder, createBrowserPipPlayer } from './browser-live-overlay.js';

const element = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
const tool = (label, title, run) => { const node = element('button', 'browser-tool', label); node.type = 'button'; node.title = title; node.setAttribute('aria-label', title); node.onclick = run; return node; };

// The page itself is a separate view laid over this panel, so this keeps it in step with the host's place on screen.
export function browserPane({ api, work, blocked, onError }) {
  let host = null, observer = null, frame = 0, state = { url: '', note: '' }, preview = { running: false, url: '', output: '', error: '' }, command = '', loadedPreview = '', parts = null, active = false;
  let pipEnabled = false, cursorOverlay = null;
  const recorder = createAnnotatedCanvasRecorder();
  const pip = createBrowserPipPlayer({
    onExpand: () => {
      pipEnabled = false;
      pip.hide();
    },
    onClose: () => { pipEnabled = false; },
  });
  const guard = run => Promise.resolve().then(run).catch(error => onError(error.message));
  const syncView = () => {
    if (!api) return;
    const visible = active && Boolean(host?.isConnected) && !blocked();
    if (visible) {
      const box = host.getBoundingClientRect();
      void api.browserPlace({ x: box.x, y: box.y, width: box.width, height: box.height });
    }
    void api.browserShow(visible);
  };
  const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(syncView); };
  function drawState() {
    if (!parts) return;
    if (document.activeElement !== parts.address) parts.address.value = state.url || '';
    parts.back.disabled = !state.canBack; parts.forward.disabled = !state.canForward;
    parts.reload.textContent = state.loading ? '×' : '↻'; parts.reload.title = state.loading ? 'Stop loading' : 'Reload'; parts.reload.setAttribute('aria-label', parts.reload.title);
    parts.note.textContent = state.note || ''; parts.note.hidden = !state.note;
    parts.empty.hidden = Boolean(state.url);
    if (parts.pip) parts.pip.classList.toggle('is-active', pipEnabled);
    if (parts.rec) {
      const rec = recorder.isRecording();
      parts.rec.classList.toggle('is-recording', rec);
      parts.rec.textContent = rec ? 'Stop' : 'Rec';
      parts.rec.title = rec ? 'Stop recording browser session' : 'Record browser session timeline';
    }
  }
  function drawPreview() {
    if (!parts) return;
    const folder = work();
    parts.preview.hidden = !folder;
    if (!folder) return;
    parts.command.value = document.activeElement === parts.command ? parts.command.value : command;
    parts.run.textContent = preview.running ? 'Stop' : 'Run';
    parts.run.title = preview.running ? 'Stop the server' : 'Run this in the sandbox: it can serve on this Mac and reach nothing else';
    parts.command.disabled = preview.running;
    parts.output.hidden = !(preview.error || (preview.running && !preview.url));
    parts.output.textContent = preview.error || (preview.running ? (preview.output.trim().split('\n').slice(-2).join('\n') || 'Starting…') : '');
  }
  const pane = { id: 'browser', title: 'Browser', wide: () => true,
    leave() {
      active = false;
      observer?.disconnect(); observer = null;
      cursorOverlay?.destroy(); cursorOverlay = null;
      if (pipEnabled && state.url) { pip.setFrame(state); pip.show(); }
      host = null; parts = null;
      window.removeEventListener('resize', schedule);
      if (api) void api.browserShow(false);
    },
    async render(body) {
      if (!api) { body.replaceChildren(element('p', 'pane-empty', 'The browser is available in the desktop app.')); return; }
      active = true;
      pip.hide();
      if (host?.isConnected) { drawState(); drawPreview(); schedule(); return; }
      const bar = element('form', 'browser-bar');
      const back = tool('‹', 'Back', () => guard(() => api.browserCommand('back'))), forward = tool('›', 'Forward', () => guard(() => api.browserCommand('forward')));
      const reload = tool('↻', 'Reload', () => guard(() => api.browserCommand(state.loading ? 'stop' : 'reload')));
      const address = element('input', 'browser-address'); address.placeholder = 'Search or type an address'; address.setAttribute('aria-label', 'Address'); address.autocomplete = 'off'; address.spellcheck = false;
      const pipBtn = tool('PiP', 'Keep mini-player visible when switching panes', () => { pipEnabled = !pipEnabled; drawState(); });
      const recBtn = tool('Rec', 'Record browser session timeline', () => {
        if (recorder.isRecording()) {
          const timeline = recorder.stop();
          state = { ...state, note: `Recorded ${timeline.frameCount} browser states (${(timeline.durationMs / 1000).toFixed(1)}s).` };
        } else {
          recorder.start();
          recorder.captureFrame(state);
          state = { ...state, note: 'Recording browser timeline…' };
        }
        drawState();
      });
      bar.append(back, forward, reload, address, pipBtn, recBtn);
      bar.onsubmit = event => { event.preventDefault(); guard(async () => { state = await api.browserGo(address.value); onError(''); address.blur(); drawState(); schedule(); }); };
      const previewBar = element('div', 'browser-preview');
      const commandBox = element('input', 'browser-command'); commandBox.placeholder = 'Command that runs this project'; commandBox.setAttribute('aria-label', 'Command that runs this project'); commandBox.autocomplete = 'off'; commandBox.spellcheck = false;
      commandBox.oninput = () => { command = commandBox.value; };
      const run = element('button', 'browser-run', 'Run'); run.type = 'button';
      run.onclick = () => guard(async () => { preview = preview.running ? await api.previewStop() : await api.previewStart(commandBox.value); drawPreview(); });
      previewBar.append(commandBox, run);
      const output = element('pre', 'browser-output'); output.hidden = true;
      const note = element('p', 'page-note'); note.hidden = true;
      const empty = element('p', 'pane-empty browser-empty', 'Search, or type an address above. Pages here have their own storage and no access to Fairy.');
      host = element('div', 'browser-host'); host.append(empty);
      cursorOverlay = createAgentCursorOverlay(host);
      parts = { address, back, forward, reload, pip: pipBtn, rec: recBtn, note, empty, preview: previewBar, command: commandBox, run, output };
      body.replaceChildren(bar, previewBar, output, note, host);
      state = await api.browserState(); preview = await api.previewState().catch(() => preview);
      if (work() && !command) command = await api.previewDetect();
      drawState(); drawPreview();
      observer = new ResizeObserver(schedule); observer.observe(host);
      window.addEventListener('resize', schedule);
      schedule();
    },
    setState(next) {
      state = next;
      if (recorder.isRecording()) recorder.captureFrame(next);
      if (pipEnabled && !active && next?.url) pip.setFrame(next);
      drawState();
    },
    showAgentCursor(x, y, { click = false, label = '' } = {}) {
      if (click) cursorOverlay?.clickAt(x, y, label);
      else cursorOverlay?.moveTo(x, y, label);
    },
    hideAgentCursor() { cursorOverlay?.hide(); },
    setPreview(next) {
      preview = next; drawPreview();
      if (next.url && next.url !== loadedPreview) { loadedPreview = next.url; guard(async () => { state = await api.browserGo(next.url); drawState(); schedule(); }); }
      if (!next.running) loadedPreview = '';
      schedule();
    },
    sync: schedule,
    resetCommand() { command = ''; },
  };
  return pane;
}
