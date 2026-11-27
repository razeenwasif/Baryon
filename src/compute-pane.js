// Compute panel (Doc 7 #16): live Nexus tickets & jobs beside the chat with logs and outputs.
export function computePane({ api, onOpenRun = null, onError = () => {} }) {
  let state = null;
  let selectedJob = '';
  let logByJob = new Map();
  let outputsByJob = new Map();
  let busyJob = new Set();
  let loading = false;
  let timer = null;
  let shownBody = null;

  const el = (tag, className = '', text = '') => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== '') node.textContent = text;
    return node;
  };
  const btn = (className, text, onclick) => {
    const b = el('button', className, text);
    b.type = 'button';
    b.onclick = onclick;
    return b;
  };

  async function refresh(body = shownBody) {
    if (!api?.computeState || loading) return;
    loading = true;
    try {
      state = await api.computeState();
    } catch (error) {
      onError(error.message);
    } finally {
      loading = false;
      if (shownBody && body === shownBody) render(shownBody);
    }
  }

  async function readLogs(jobId) {
    if (!api?.computeLogs || busyJob.has(`log:${jobId}`)) return;
    busyJob.add(`log:${jobId}`);
    selectedJob = jobId;
    if (shownBody) render(shownBody);
    try {
      const res = await api.computeLogs(jobId, 6);
      logByJob.set(jobId, res);
    } catch (error) {
      onError(error.message);
    } finally {
      busyJob.delete(`log:${jobId}`);
      if (shownBody) render(shownBody);
    }
  }

  async function readOutputs(jobId) {
    if (!api?.computeOutputs || busyJob.has(`out:${jobId}`)) return;
    busyJob.add(`out:${jobId}`);
    selectedJob = jobId;
    if (shownBody) render(shownBody);
    try {
      const res = await api.computeOutputs(jobId);
      outputsByJob.set(jobId, res);
      await refresh();
    } catch (error) {
      onError(error.message);
    } finally {
      busyJob.delete(`out:${jobId}`);
      if (shownBody) render(shownBody);
    }
  }

  function render(body) {
    const wrap = el('div', 'panel-stack compute-pane');
    const head = el('div', 'panel-head');
    head.append(el('h2', '', 'Compute'));
    const refBtn = btn('panel-button quiet', loading ? 'Refreshing…' : 'Refresh', () => void refresh(body));
    refBtn.disabled = loading;
    head.append(refBtn);
    wrap.append(head);

    if (!api?.computeState) {
      wrap.append(el('p', 'panel-note', 'Compute view needs the desktop app.'));
      body.replaceChildren(wrap);
      return;
    }

    if (!state) {
      wrap.append(el('p', 'panel-note busy', 'Checking Nexus tickets and cluster jobs…'));
      body.replaceChildren(wrap);
      return;
    }

    if (!state.available) {
      wrap.append(el('p', 'panel-note', state.reason || 'Nexus is not configured on this Mac.'));
    } else {
      const c = state.counts || {};
      const counts = el('div', 'compute-counts');
      counts.append(
        el('span', 'compute-pill running', `${c.running || 0} running`),
        el('span', 'compute-pill waiting', `${c.waiting || 0} awaiting Accept`),
        el('span', 'compute-pill done', `${c.done || 0} done`),
        ...(c.failed ? [el('span', 'compute-pill failed', `${c.failed} failed`)] : []),
      );
      wrap.append(counts, el('p', 'panel-note', state.note));
    }

    const items = Array.isArray(state.items) ? state.items : [];
    if (!items.length) {
      wrap.append(el('p', 'panel-note', 'No Nexus tickets or cluster runs recorded yet.'));
      body.replaceChildren(wrap);
      return;
    }

    for (const item of items) {
      const card = el('div', `panel-card compute-card${selectedJob === item.job ? ' is-selected' : ''}`);
      const cardHead = el('div', 'panel-card-head');
      const title = el('h3', '', `${item.name || item.job}`);
      const badge = el('span', `compute-badge ${item.status}`, item.status === 'waiting' ? 'Accept in Nexus' : item.rawState || item.status);
      cardHead.append(title, badge);
      card.append(cardHead);

      const metaParts = [
        item.job,
        item.node && item.node !== 'queued' ? item.node : '',
        item.projectTitle || '',
        item.runId || '',
      ].filter(Boolean);
      card.append(el('p', 'compute-meta', metaParts.join(' · ')));
      if (item.command) card.append(el('code', 'compute-cmd', item.command));

      const actions = el('div', 'panel-actions');
      const logBtn = btn('panel-button quiet', busyJob.has(`log:${item.job}`) ? 'Loading log…' : 'Logs', () => void readLogs(item.job));
      logBtn.disabled = busyJob.has(`log:${item.job}`);
      actions.append(logBtn);
      if (item.status !== 'waiting') {
        const outBtn = btn('panel-button quiet', busyJob.has(`out:${item.job}`) ? 'Fetching…' : 'Outputs', () => void readOutputs(item.job));
        outBtn.disabled = busyJob.has(`out:${item.job}`);
        actions.append(outBtn);
      }
      if (item.folder && item.runId && onOpenRun) {
        actions.append(btn('panel-button quiet', `Open ${item.runId}`, () => onOpenRun(item.folder, item.runId)));
      }
      card.append(actions);

      const logData = logByJob.get(item.job);
      if (logData) {
        const summary = `${logData.ended ? `Ended (exit ${logData.exitCode ?? 0})` : 'Running'}${logData.notes ? ` · ${logData.notes}` : ''}`;
        const pre = el('pre', 'source-text compute-log', logData.log || '(No output yet.)');
        card.append(el('div', 'compute-sub', summary), pre);
      }

      const outData = outputsByJob.get(item.job);
      if (outData) {
        const files = Array.isArray(outData.files) ? outData.files : [];
        const fileList = el('ul', 'compute-files');
        if (!files.length) fileList.append(el('li', 'panel-note', 'No files written in $DUET_OUTPUT_DIR.'));
        else for (const f of files.slice(0, 40)) fileList.append(el('li', '', `${f.path} (${f.bytes} B)`));
        card.append(el('div', 'compute-sub', `Outputs in ${outData.folder || 'compute-outputs'}`), fileList);
      }

      wrap.append(card);
    }

    body.replaceChildren(wrap);
  }

  return {
    id: 'compute',
    title: 'Compute',
    render(body) {
      shownBody = body;
      render(body);
      void refresh(body);
      clearInterval(timer);
      timer = setInterval(() => {
        if (shownBody !== body || !body.isConnected) return;
        void refresh(body);
      }, 15000);
    },
    leave() {
      shownBody = null;
      clearInterval(timer);
      timer = null;
    },
  };
}
