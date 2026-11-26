// Phase 1+3 bidirectional protocol wrapper on top of createVorssaintBridge (`vorssaint.sock`).
import { createVorssaintBridge } from './vorssaint-bridge.mjs';

export function formatVorssaintPrompt(text, context = {}) {
  const base = typeof text === 'string' ? text.trim() : '';
  if (!context || typeof context !== 'object' || Array.isArray(context)) return base;
  const parts = [];
  if (typeof context.source === 'string' && context.source.trim()) {
    parts.push(`[Source: ${context.source.trim()}]`);
  }
  if (typeof context.mode === 'string' && context.mode.trim()) {
    parts.push(`[Mode: ${context.mode.trim()}]`);
  }
  if (Array.isArray(context.files) && context.files.length > 0) {
    const cleanFiles = context.files.map(file => String(file ?? '').trim()).filter(Boolean);
    if (cleanFiles.length > 0) {
      parts.push(`Files:\n${cleanFiles.map(file => `- ${file}`).join('\n')}`);
    }
  }
  if (typeof context.imagePath === 'string' && context.imagePath.trim()) {
    parts.push(`Image path: ${context.imagePath.trim()}`);
  }
  if (typeof context.ocrText === 'string' && context.ocrText.trim()) {
    parts.push(`Captured OCR text:\n${context.ocrText.trim()}`);
  }
  if (typeof context.selectedText === 'string' && context.selectedText.trim()) {
    parts.push(`Selected text:\n${context.selectedText.trim()}`);
  }
  if (parts.length === 0) return base;
  return base ? `${parts.join('\n\n')}\n\n${base}` : parts.join('\n\n');
}

export function compactRelayState(s) {
  if (!s || typeof s !== 'object') {
    return { installed: false, reachable: false, miniName: 'Mac mini', route: '', problem: '', miniFreeBytes: 0, scheduleTime: '', lastSyncAt: 0, lastStatus: '', enabledJobs: 0, totalJobs: 0, pendingFiles: null, pendingBytes: null, diffing: false, running: null };
  }
  const jobs = Array.isArray(s.jobs) ? s.jobs : [];
  return {
    installed: Boolean(s.installed),
    reachable: Boolean(s.mini?.reachable),
    miniName: String(s.mini?.name || 'Mac mini'),
    route: String(s.mini?.route || ''),
    problem: String(s.mini?.problem || ''),
    miniFreeBytes: Number(s.mini?.free) || 0,
    scheduleTime: String(s.schedule?.time || ''),
    lastSyncAt: Number(s.lastSyncAt) || 0,
    lastStatus: String(s.lastStatus || ''),
    enabledJobs: jobs.filter(j => j?.enabled !== false).length,
    totalJobs: jobs.length,
    pendingFiles: s.diff ? Number(s.diff.files) || 0 : null,
    pendingBytes: s.diff ? Number(s.diff.bytes) || 0 : null,
    diffing: Boolean(s.diffing),
    running: s.running ? {
      current: String(s.running.current || ''),
      index: Number(s.running.index) || 0,
      total: Number(s.running.total) || 0,
    } : null,
  };
}

export function compactSweepState(s) {
  if (!s || typeof s !== 'object') {
    return { installed: false, diskFreeBytes: 0, diskTotalBytes: 0, thresholdGB: 50, belowThreshold: false, lastSweepAt: 0, lastFreedBytes: 0, totalFreedBytes: 0, readyBytes: null, running: null };
  }
  return {
    installed: s.installed !== false,
    diskFreeBytes: Number(s.disk?.free) || 0,
    diskTotalBytes: Number(s.disk?.total) || 0,
    thresholdGB: Number(s.threshold) || 50,
    belowThreshold: Boolean(s.below),
    lastSweepAt: Number(s.lastSweepAt) || 0,
    lastFreedBytes: Number(s.lastFreed) || 0,
    totalFreedBytes: Number(s.totalFreed) || 0,
    readyBytes: s.scan?.ready != null ? Number(s.scan.ready) || 0 : null,
    running: s.running ? {
      current: String(s.running.current || ''),
      index: Number(s.running.index) || 0,
      total: Number(s.running.total) || 0,
    } : null,
  };
}

export function createOpsHandler({ getRelay, getSweep, getLink } = {}) {
  return async ({ target = 'all', action = 'state', tier = null } = {}) => {
    const link = typeof getLink === 'function' ? getLink() : null;
    const readRelay = async opts => {
      try {
        const svc = await getRelay?.();
        if (!svc) return null;
        return compactRelayState(await svc.call('state', opts));
      } catch (err) {
        return { installed: false, reachable: false, miniName: 'Mac mini', route: '', problem: String(err?.message || err), miniFreeBytes: 0, scheduleTime: '', lastSyncAt: 0, lastStatus: '', enabledJobs: 0, totalJobs: 0, pendingFiles: null, pendingBytes: null, diffing: false, running: null };
      }
    };
    const readSweep = async opts => {
      try {
        const svc = await getSweep?.();
        if (!svc) return null;
        return compactSweepState(await svc.call('state', opts));
      } catch (err) {
        return { installed: false, diskFreeBytes: 0, diskTotalBytes: 0, thresholdGB: 50, belowThreshold: false, lastSweepAt: 0, lastFreedBytes: 0, totalFreedBytes: 0, readyBytes: null, running: null };
      }
    };

    try {
      if (target === 'relay') {
        const svc = await getRelay?.();
        if (!svc) throw new Error('Relay is unavailable.');
        let state = null;
        if (action === 'diff') {
          await svc.call('diff', { fresh: true });
          state = compactRelayState(await svc.call('state', { fresh: true }));
          link?.pushToast({ title: 'Relay Diff Complete', detail: `${state.pendingFiles ?? 0} pending file(s)`, accent: 'blue' });
        } else if (action === 'sync') {
          link?.pushToast({ title: 'Relay Sync Started', detail: 'Syncing repos to Mac mini…', accent: 'blue' });
          state = compactRelayState(await svc.call('sync', {}));
          link?.pushToast({ title: 'Relay Sync Finished', detail: state.lastStatus || 'Completed', accent: 'blue' });
        } else if (action === 'stop') {
          await svc.call('stop');
          state = compactRelayState(await svc.call('state', { fresh: true }));
        } else {
          state = compactRelayState(await svc.call('state', { fresh: action === 'state' }));
        }
        link?.pushOpsState({ relay: state });
        return;
      }

      if (target === 'sweep') {
        const svc = await getSweep?.();
        if (!svc) throw new Error('Sweep is unavailable.');
        let state = null;
        if (action === 'scan') {
          await svc.call('scan', { fresh: true });
          state = compactSweepState(await svc.call('state', { fresh: true }));
        } else if (action === 'clean') {
          link?.pushToast({ title: 'Sweep Started', detail: tier ? `Cleaning (${tier})…` : 'Cleaning enabled targets…', accent: 'cyan' });
          state = compactSweepState(await svc.call('clean', tier ? { tier } : {}));
          link?.pushToast({ title: 'Sweep Complete', detail: 'Disk cleanup finished.', accent: 'cyan' });
        } else if (action === 'stop') {
          await svc.call('stop');
          state = compactSweepState(await svc.call('state', { fresh: true }));
        } else {
          state = compactSweepState(await svc.call('state', { fresh: action === 'state' }));
        }
        link?.pushOpsState({ sweep: state });
        return;
      }

      const [relay, sweep] = await Promise.all([readRelay({ fresh: true }), readSweep({ fresh: true })]);
      link?.pushOpsState({ relay, sweep });
    } catch (err) {
      const message = String(err?.message || err);
      link?.pushOpsState({ error: message });
      link?.pushToast({ title: 'Relay / Sweep', detail: message, accent: 'orange' });
    }
  };
}

export function startVorssaintLink({
  socketPath,
  binaryPath = null,
  lockPath = null,
  role = 'full',
  env = {},
  log = () => {},
  ask = async () => { throw new Error('Vorssaint ask handler is unavailable.'); },
  onApprovalDecision = () => {},
  onUndock = () => {},
  onQuickAction = () => {},
  onContextAction = () => {},
  onOps = () => {},
  onCalendarRequest = () => {},
  onAlert = () => {},
  onFeaturesState = () => {},
  onMessage = () => {},
  onStateChange = () => {},
} = {}) {
  let lastStateJson = '';
  let lastApprovalKey = null;
  let lastDockHover = { active: false, proximity: 0 };
  let lastCalendarPayload = null;
  let lastUsagePayload = null;
  let lastFeaturesState = null;
  let activeAsk = null;
  let nextToolSeq = 0;
  const pendingTools = new Map();

  const handleMessage = (message, send) => {
    if (!message || typeof message !== 'object') return;
    switch (message.type) {
      case 'fairy.approvalDecision': {
        const id = typeof message.id === 'string' ? message.id : '';
        const decision = typeof message.decision === 'string' ? message.decision : '';
        if (!id || !['allow', 'deny', 'inspect'].includes(decision)) return;
        Promise.resolve(onApprovalDecision({ id, decision })).catch(err => log(`vorssaint approval error: ${err?.message || err}`));
        return;
      }
      case 'fairy.stop': {
        activeAsk?.controller.abort(new Error('Stopped.'));
        activeAsk = null;
        return;
      }
      case 'fairy.undock': {
        const x = Number(message.x) || 0;
        const y = Number(message.y) || 0;
        const vx = Number(message.vx) || 0;
        const vy = Number(message.vy) || 0;
        const displayId = Number(message.displayId) || 0;
        Promise.resolve(onUndock({ x, y, vx, vy, displayId })).catch(err => log(`vorssaint undock error: ${err?.message || err}`));
        return;
      }
      case 'fairy.quickAction': {
        const action = typeof message.action === 'string' ? message.action : '';
        if (!action) return;
        Promise.resolve(onQuickAction({ action })).catch(err => log(`vorssaint quickAction error: ${err?.message || err}`));
        return;
      }
      case 'fairy.contextAction': {
        const action = typeof message.action === 'string' ? message.action : '';
        if (!action) return;
        const text = typeof message.text === 'string' ? message.text : '';
        const files = Array.isArray(message.files) ? message.files.map(item => String(item ?? '')).filter(Boolean) : [];
        const imagePath = typeof message.imagePath === 'string' ? message.imagePath : '';
        const source = typeof message.source === 'string' ? message.source : '';
        Promise.resolve(onContextAction({ action, text, files, imagePath, source })).catch(err => log(`vorssaint contextAction error: ${err?.message || err}`));
        return;
      }
      case 'vorssaint.ops': {
        const target = typeof message.target === 'string' ? message.target : 'all';
        const action = typeof message.action === 'string' ? message.action : 'state';
        const tier = typeof message.tier === 'string' ? message.tier : null;
        Promise.resolve(onOps({ target, action, tier })).catch(err => log(`vorssaint ops error: ${err?.message || err}`));
        return;
      }
      case 'vorssaint.calendarRequest': {
        Promise.resolve(onCalendarRequest(message)).catch(err => log(`vorssaint calendarRequest error: ${err?.message || err}`));
        return;
      }
      case 'vorssaint.toolResult': {
        const id = typeof message.id === 'string' ? message.id : '';
        const pending = pendingTools.get(id);
        if (!pending) return;
        pendingTools.delete(id);
        clearTimeout(pending.timer);
        if (message.ok === false) {
          pending.reject(new Error(String(message.error || 'Vorssaint tool failed.')));
        } else {
          pending.resolve(message.result ?? null);
        }
        return;
      }
      case 'vorssaint.alert': {
        Promise.resolve(onAlert({
          kind: String(message.kind || 'system'),
          title: String(message.title || 'System Alert'),
          detail: String(message.detail || ''),
          metrics: message.metrics && typeof message.metrics === 'object' ? message.metrics : {},
        })).catch(err => log(`vorssaint alert error: ${err?.message || err}`));
        return;
      }
      case 'vorssaint.featuresState': {
        lastFeaturesState = {
          keptFeatures: Array.isArray(message.keptFeatures) ? message.keptFeatures.map(String) : [],
          unifiedTray: Boolean(message.unifiedTray),
          iCloudNotesSync: Boolean(message.iCloudNotesSync),
          aiLauncherFolder: String(message.aiLauncherFolder || ''),
          hadronTodosPath: String(message.hadronTodosPath || ''),
          hadronNotesPath: String(message.hadronNotesPath || ''),
          permissions: message.permissions && typeof message.permissions === 'object' ? message.permissions : {},
        };
        Promise.resolve(onFeaturesState({ ...lastFeaturesState, connected: Boolean(bridge.state().connected) }))
          .catch(err => log(`vorssaint featuresState error: ${err?.message || err}`));
        return;
      }
      case 'fairy.ask': {
        const id = typeof message.id === 'string' && message.id ? message.id : `ask-${Date.now()}`;
        const text = typeof message.text === 'string' ? message.text : '';
        const context = message.context && typeof message.context === 'object' ? message.context : {};
        if (!text.trim()) {
          send({ type: 'fairy.error', id, message: 'Empty request.' });
          return;
        }
        activeAsk?.controller.abort(new Error('Replaced by a newer request.'));
        const controller = new AbortController();
        const current = { id, controller };
        activeAsk = current;
        Promise.resolve(ask({
          id,
          text,
          context,
          signal: controller.signal,
          onText: value => {
            if (activeAsk === current && !controller.signal.aborted) {
              send({ type: 'fairy.text', id, text: String(value ?? '') });
            }
          },
        }))
          .then(result => {
            if (activeAsk === current) activeAsk = null;
            const finalText = typeof result === 'string' ? result : String(result?.text ?? '');
            send({ type: 'fairy.done', id, text: finalText });
          })
          .catch(error => {
            if (activeAsk === current) activeAsk = null;
            send({ type: 'fairy.error', id, message: error?.name === 'AbortError' ? 'Stopped.' : error?.message || String(error) });
          });
        return;
      }
      default:
        onMessage(message, send);
    }
  };

  const bridge = createVorssaintBridge({
    socketPath,
    binaryPath,
    lockPath,
    role,
    env,
    log,
    onMessage: handleMessage,
      onStateChange: state => {
      if (state?.connected) {
        lastStateJson = '';
        lastApprovalKey = null;
        lastDockHover = { active: false, proximity: 0 };
        if (lastCalendarPayload || lastUsagePayload) {
          queueMicrotask(() => {
            if (lastCalendarPayload) bridge.send(lastCalendarPayload);
            if (lastUsagePayload) bridge.send(lastUsagePayload);
          });
        }
      }
      onStateChange(state);
    },
  });

  const startPromise = bridge.start();

  return {
    ready: startPromise,
    state: () => bridge.state(),
    send: payload => bridge.send(payload),

    pushState({ state = 'idle', title = '', subtitle = '', progress = null, audioLevel = 0, model = '' } = {}) {
      const payload = {
        type: 'fairy.state',
        state: String(state || 'idle'),
        title: String(title || ''),
        subtitle: String(subtitle || ''),
        ...(typeof progress === 'number' ? { progress } : {}),
        audioLevel: Number(audioLevel) || 0,
        ...(model ? { model: String(model) } : {}),
      };
      const serialized = JSON.stringify(payload);
      if (serialized === lastStateJson) return false;
      lastStateJson = serialized;
      return bridge.send(payload);
    },

    syncApprovals(pending = []) {
      const top = Array.isArray(pending) ? pending[0] : null;
      if (!top) {
        if (lastApprovalKey === 'clear') return false;
        lastApprovalKey = 'clear';
        return bridge.send({ type: 'fairy.approval', clear: true });
      }
      const key = `${top.id}:${top.title || ''}:${top.command || ''}`;
      if (key === lastApprovalKey) return false;
      lastApprovalKey = key;
      return bridge.send({
        type: 'fairy.approval',
        id: String(top.id),
        chatId: String(top.chat || top.chatId || ''),
        title: String(top.title || 'Approval required'),
        detail: String(top.detail || ''),
        command: String(top.command || ''),
        risk: String(top.risk || 'write'),
      });
    },

    pushToast({ id = `toast-${Date.now()}`, title = '', detail = '', accent = 'blue', durationMs = 4500 } = {}) {
      return bridge.send({
        type: 'fairy.toast',
        id: String(id),
        title: String(title),
        detail: String(detail),
        accent: String(accent),
        durationMs: Number(durationMs) || 4500,
      });
    },

    controlTeleprompter({ action = 'toggle', text = '', title = '', wpm = null, progress = null, autoPlay = false } = {}) {
      return bridge.send({
        type: 'vorssaint.teleprompter',
        action: String(action),
        ...(text ? { text: String(text) } : {}),
        ...(title ? { title: String(title) } : {}),
        ...(typeof wpm === 'number' ? { wpm } : {}),
        ...(typeof progress === 'number' ? { progress } : {}),
        ...(autoPlay ? { autoPlay: true } : {}),
      });
    },

    sendUndockAck({ x = 0, y = 0 } = {}) {
      return bridge.send({ type: 'fairy.undockAck', x: Number(x) || 0, y: Number(y) || 0 });
    },

    sendDockHover({ active = false, proximity = 0 } = {}) {
      const nextActive = Boolean(active);
      const nextProximity = nextActive ? Number(proximity) || 0 : 0;
      if (nextActive === lastDockHover.active && Math.abs(nextProximity - lastDockHover.proximity) < 0.03) {
        return false;
      }
      lastDockHover = { active: nextActive, proximity: nextProximity };
      return bridge.send({ type: 'fairy.dockHover', active: nextActive, proximity: nextProximity });
    },

    sendDock({ x = 0, y = 0 } = {}) {
      lastDockHover = { active: false, proximity: 0 };
      return bridge.send({ type: 'fairy.dock', x: Number(x) || 0, y: Number(y) || 0 });
    },

    pushOpsState({ relay = null, sweep = null, error = '' } = {}) {
      return bridge.send({
        type: 'vorssaint.opsState',
        ...(relay ? { relay } : {}),
        ...(sweep ? { sweep } : {}),
        ...(error ? { error: String(error) } : {}),
      });
    },

    pushCalendarEvents({ connected = false, events = [], updatedAt = Date.now() } = {}) {
      const payload = {
        type: 'vorssaint.calendarEvents',
        connected: Boolean(connected),
        events: Array.isArray(events) ? events : [],
        updatedAt: Number(updatedAt) || Date.now(),
      };
      lastCalendarPayload = payload;
      return bridge.send(payload);
    },

    invokeTool(tool, args = {}, { timeoutMs = 15_000 } = {}) {
      const id = `vst-${++nextToolSeq}-${Date.now()}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingTools.delete(id);
          reject(new Error(`Vorssaint tool '${tool}' timed out.`));
        }, timeoutMs);
        pendingTools.set(id, { resolve, reject, timer });
        const sent = bridge.send({
          type: 'vorssaint.tool',
          id,
          tool: String(tool),
          args: args && typeof args === 'object' ? args : {},
        });
        if (!sent) {
          pendingTools.delete(id);
          clearTimeout(timer);
          reject(new Error('Vorssaint is not connected.'));
        }
      });
    },

    pushPreset(preset, params = {}) {
      return bridge.send({
        type: 'vorssaint.preset',
        preset: String(preset || ''),
        ...(params && typeof params === 'object' ? params : {}),
      });
    },

    pushUsage(summary = {}) {
      const payload = {
        type: 'vorssaint.usage',
        updatedAt: Number(summary.updatedAt) || Date.now(),
        todayCostUsd: Number(summary.todayCostUsd) || 0,
        todayTokens: Number(summary.todayTokens) || 0,
        providers: Array.isArray(summary.providers) ? summary.providers : [],
      };
      lastUsagePayload = payload;
      return bridge.send(payload);
    },

    featuresState() {
      return {
        connected: Boolean(bridge.state().connected),
        ...(lastFeaturesState || {}),
      };
    },

    sendFeaturesCommand(payload = {}) {
      return bridge.send({
        type: 'vorssaint.features',
        ...(payload && typeof payload === 'object' ? payload : {}),
      });
    },

    close() {
      activeAsk?.controller.abort(new Error('Closed.'));
      activeAsk = null;
      for (const [, pending] of pendingTools) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Vorssaint link closed.'));
      }
      pendingTools.clear();
      return bridge.stop();
    },
  };
}
