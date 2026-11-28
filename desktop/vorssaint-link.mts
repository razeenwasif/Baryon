// Phase 1+3 bidirectional protocol wrapper on top of createVorssaintBridge (`vorssaint.sock`).
import {
  createVorssaintBridge,
  type VorssaintMessage,
  type VorssaintPeerState,
} from './vorssaint-bridge.mjs';

export interface VorssaintPromptContext {
  source?: unknown;
  mode?: unknown;
  files?: unknown;
  imagePath?: unknown;
  ocrText?: unknown;
  selectedText?: unknown;
  [key: string]: unknown;
}

export interface VorssaintRunningTask {
  current: string;
  index: number;
  total: number;
}

export interface CompactRelayState {
  installed: boolean;
  reachable: boolean;
  miniName: string;
  route: string;
  problem: string;
  miniFreeBytes: number;
  scheduleTime: string;
  lastSyncAt: number;
  lastStatus: string;
  enabledJobs: number;
  totalJobs: number;
  pendingFiles: number | null;
  pendingBytes: number | null;
  diffing: boolean;
  running: VorssaintRunningTask | null;
}

export interface RawRelayState {
  installed?: unknown;
  mini?: {
    reachable?: unknown;
    name?: unknown;
    route?: unknown;
    problem?: unknown;
    free?: unknown;
  } | null;
  schedule?: {
    time?: unknown;
  } | null;
  lastSyncAt?: unknown;
  lastStatus?: unknown;
  jobs?: Array<{ enabled?: unknown } | null | undefined> | unknown;
  diff?: {
    files?: unknown;
    bytes?: unknown;
  } | null;
  diffing?: unknown;
  running?: {
    current?: unknown;
    index?: unknown;
    total?: unknown;
  } | null;
}

export interface CompactSweepState {
  installed: boolean;
  diskFreeBytes: number;
  diskTotalBytes: number;
  thresholdGB: number;
  belowThreshold: boolean;
  lastSweepAt: number;
  lastFreedBytes: number;
  totalFreedBytes: number;
  readyBytes: number | null;
  running: VorssaintRunningTask | null;
}

export interface RawSweepState {
  installed?: unknown;
  disk?: {
    free?: unknown;
    total?: unknown;
  } | null;
  threshold?: unknown;
  below?: unknown;
  lastSweepAt?: unknown;
  lastFreed?: unknown;
  totalFreed?: unknown;
  scan?: {
    ready?: unknown;
  } | null;
  running?: {
    current?: unknown;
    index?: unknown;
    total?: unknown;
  } | null;
}

function getErrorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = (err as { message?: unknown }).message;
    if (msg) return String(msg);
  }
  return String(err);
}

export function formatVorssaintPrompt(text: unknown, context: VorssaintPromptContext | null = {}): string {
  const base = typeof text === 'string' ? text.trim() : '';
  if (!context || typeof context !== 'object' || Array.isArray(context)) return base;
  const parts: string[] = [];
  if (typeof context.source === 'string' && context.source.trim()) {
    parts.push(`[Source: ${context.source.trim()}]`);
  }
  if (typeof context.mode === 'string' && context.mode.trim()) {
    parts.push(`[Mode: ${context.mode.trim()}]`);
  }
  if (Array.isArray(context.files) && context.files.length > 0) {
    const cleanFiles = context.files.map((file: unknown) => String(file ?? '').trim()).filter(Boolean);
    if (cleanFiles.length > 0) {
      parts.push(`Files:\n${cleanFiles.map((file: string) => `- ${file}`).join('\n')}`);
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

export function compactRelayState(s?: unknown): CompactRelayState {
  if (!s || typeof s !== 'object') {
    return { installed: false, reachable: false, miniName: 'Mac mini', route: '', problem: '', miniFreeBytes: 0, scheduleTime: '', lastSyncAt: 0, lastStatus: '', enabledJobs: 0, totalJobs: 0, pendingFiles: null, pendingBytes: null, diffing: false, running: null };
  }
  const raw = s as RawRelayState;
  const jobs = Array.isArray(raw.jobs) ? (raw.jobs as Array<{ enabled?: unknown } | null | undefined>) : [];
  return {
    installed: Boolean(raw.installed),
    reachable: Boolean(raw.mini?.reachable),
    miniName: String(raw.mini?.name || 'Mac mini'),
    route: String(raw.mini?.route || ''),
    problem: String(raw.mini?.problem || ''),
    miniFreeBytes: Number(raw.mini?.free) || 0,
    scheduleTime: String(raw.schedule?.time || ''),
    lastSyncAt: Number(raw.lastSyncAt) || 0,
    lastStatus: String(raw.lastStatus || ''),
    enabledJobs: jobs.filter(j => j?.enabled !== false).length,
    totalJobs: jobs.length,
    pendingFiles: raw.diff ? Number(raw.diff.files) || 0 : null,
    pendingBytes: raw.diff ? Number(raw.diff.bytes) || 0 : null,
    diffing: Boolean(raw.diffing),
    running: raw.running ? {
      current: String(raw.running.current || ''),
      index: Number(raw.running.index) || 0,
      total: Number(raw.running.total) || 0,
    } : null,
  };
}

export function compactSweepState(s?: unknown): CompactSweepState {
  if (!s || typeof s !== 'object') {
    return { installed: false, diskFreeBytes: 0, diskTotalBytes: 0, thresholdGB: 50, belowThreshold: false, lastSweepAt: 0, lastFreedBytes: 0, totalFreedBytes: 0, readyBytes: null, running: null };
  }
  const raw = s as RawSweepState;
  return {
    installed: raw.installed !== false,
    diskFreeBytes: Number(raw.disk?.free) || 0,
    diskTotalBytes: Number(raw.disk?.total) || 0,
    thresholdGB: Number(raw.threshold) || 50,
    belowThreshold: Boolean(raw.below),
    lastSweepAt: Number(raw.lastSweepAt) || 0,
    lastFreedBytes: Number(raw.lastFreed) || 0,
    totalFreedBytes: Number(raw.totalFreed) || 0,
    readyBytes: raw.scan?.ready != null ? Number(raw.scan.ready) || 0 : null,
    running: raw.running ? {
      current: String(raw.running.current || ''),
      index: Number(raw.running.index) || 0,
      total: Number(raw.running.total) || 0,
    } : null,
  };
}

export interface OpsService {
  call: (method: string, opts?: Record<string, unknown>) => Promise<unknown>;
}

export interface OpsHandlerOptions {
  getRelay?: () => OpsService | null | undefined | Promise<OpsService | null | undefined>;
  getSweep?: () => OpsService | null | undefined | Promise<OpsService | null | undefined>;
  getLink?: () => VorssaintLink | null | undefined;
}

export interface VorssaintOpsRequest {
  target?: string;
  action?: string;
  tier?: string | null;
}

export function createOpsHandler({ getRelay, getSweep, getLink }: OpsHandlerOptions = {}): (req?: VorssaintOpsRequest) => Promise<void> {
  return async ({ target = 'all', action = 'state', tier = null }: VorssaintOpsRequest = {}) => {
    const link = typeof getLink === 'function' ? getLink() : null;
    const readRelay = async (opts?: Record<string, unknown>): Promise<CompactRelayState | null> => {
      try {
        const svc = await getRelay?.();
        if (!svc) return null;
        return compactRelayState(await svc.call('state', opts));
      } catch (err: unknown) {
        return { installed: false, reachable: false, miniName: 'Mac mini', route: '', problem: getErrorMessage(err), miniFreeBytes: 0, scheduleTime: '', lastSyncAt: 0, lastStatus: '', enabledJobs: 0, totalJobs: 0, pendingFiles: null, pendingBytes: null, diffing: false, running: null };
      }
    };
    const readSweep = async (opts?: Record<string, unknown>): Promise<CompactSweepState | null> => {
      try {
        const svc = await getSweep?.();
        if (!svc) return null;
        return compactSweepState(await svc.call('state', opts));
      } catch {
        return { installed: false, diskFreeBytes: 0, diskTotalBytes: 0, thresholdGB: 50, belowThreshold: false, lastSweepAt: 0, lastFreedBytes: 0, totalFreedBytes: 0, readyBytes: null, running: null };
      }
    };

    try {
      if (target === 'relay') {
        const svc = await getRelay?.();
        if (!svc) throw new Error('Relay is unavailable.');
        let state: CompactRelayState | null = null;
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
        let state: CompactSweepState | null = null;
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
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      link?.pushOpsState({ error: message });
      link?.pushToast({ title: 'Relay / Sweep', detail: message, accent: 'orange' });
    }
  };
}

export interface VorssaintAskRequest {
  id: string;
  text: string;
  context: VorssaintPromptContext;
  signal: AbortSignal;
  onText: (value: unknown) => void;
}

export interface VorssaintApprovalDecision {
  id: string;
  decision: 'allow' | 'deny' | 'inspect';
}

export interface VorssaintUndockEvent {
  x: number;
  y: number;
  vx: number;
  vy: number;
  displayId: number;
}

export interface VorssaintContextActionEvent {
  action: string;
  text: string;
  files: string[];
  imagePath: string;
  source: string;
}

export interface VorssaintAlertEvent {
  kind: string;
  title: string;
  detail: string;
  metrics: Record<string, unknown>;
}

export interface VorssaintFeaturesStatePayload {
  keptFeatures: string[];
  unifiedTray: boolean;
  iCloudNotesSync: boolean;
  aiLauncherFolder: string;
  hadronTodosPath: string;
  hadronNotesPath: string;
  permissions: Record<string, unknown>;
}

export interface VorssaintFeaturesState extends Partial<VorssaintFeaturesStatePayload> {
  connected: boolean;
}

export interface VorssaintApprovalItem {
  id: string | number;
  chat?: string | null;
  chatId?: string | null;
  title?: string | null;
  detail?: string | null;
  command?: string | null;
  risk?: string | null;
}

export interface StartVorssaintLinkOptions {
  socketPath?: string;
  binaryPath?: string | null;
  lockPath?: string | null;
  role?: string;
  env?: Record<string, string | undefined>;
  log?: (message: string) => void;
  ask?: (req: VorssaintAskRequest) => unknown;
  onApprovalDecision?: (payload: VorssaintApprovalDecision) => unknown;
  onUndock?: (payload: VorssaintUndockEvent) => unknown;
  onQuickAction?: (payload: { action: string }) => unknown;
  onContextAction?: (payload: VorssaintContextActionEvent) => unknown;
  onOps?: (payload: VorssaintOpsRequest) => unknown;
  onCalendarRequest?: (message: VorssaintMessage) => unknown;
  onAlert?: (payload: VorssaintAlertEvent) => unknown;
  onFeaturesState?: (state: VorssaintFeaturesStatePayload & { connected: boolean }) => unknown;
  onMessage?: (message: VorssaintMessage, send: (payload: Record<string, unknown>) => boolean) => void;
  onStateChange?: (state: VorssaintPeerState) => void;
}

export interface VorssaintLink {
  ready: Promise<void>;
  state: () => VorssaintPeerState;
  send: (payload: Record<string, unknown>) => boolean;
  pushState: (opts?: { state?: string; title?: string; subtitle?: string; progress?: number | null; audioLevel?: number; model?: string }) => boolean;
  syncApprovals: (pending?: Array<VorssaintApprovalItem | null | undefined>) => boolean;
  pushToast: (opts?: { id?: string; title?: string; detail?: string; accent?: string; durationMs?: number }) => boolean;
  controlTeleprompter: (opts?: { action?: string; text?: string; title?: string; wpm?: number | null; progress?: number | null; autoPlay?: boolean }) => boolean;
  sendUndockAck: (opts?: { x?: number; y?: number }) => boolean;
  sendDockHover: (opts?: { active?: boolean; proximity?: number }) => boolean;
  sendDock: (opts?: { x?: number; y?: number }) => boolean;
  pushOpsState: (opts?: { relay?: CompactRelayState | Record<string, unknown> | null; sweep?: CompactSweepState | Record<string, unknown> | null; error?: string }) => boolean;
  pushCalendarEvents: (opts?: { connected?: boolean; events?: unknown[]; updatedAt?: number }) => boolean;
  invokeTool: (tool: string, args?: Record<string, unknown>, opts?: { timeoutMs?: number }) => Promise<unknown>;
  pushPreset: (preset: string, params?: Record<string, unknown>) => boolean;
  pushUsage: (summary?: { updatedAt?: number; todayCostUsd?: number; todayTokens?: number; providers?: unknown[] }) => boolean;
  featuresState: () => VorssaintFeaturesState;
  sendFeaturesCommand: (payload?: Record<string, unknown>) => boolean;
  close: () => Promise<void>;
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
}: StartVorssaintLinkOptions = {}): VorssaintLink {
  let lastStateJson = '';
  let lastApprovalKey: string | null = null;
  let lastDockHover = { active: false, proximity: 0 };
  let lastCalendarPayload: Record<string, unknown> | null = null;
  let lastUsagePayload: Record<string, unknown> | null = null;
  let lastFeaturesState: VorssaintFeaturesStatePayload | null = null;
  let activeAsk: { id: string; controller: AbortController } | null = null;
  let nextToolSeq = 0;
  const pendingTools = new Map<string, { resolve: (value: unknown) => void; reject: (reason?: unknown) => void; timer: ReturnType<typeof setTimeout> }>();

  const handleMessage = (message: VorssaintMessage, send: (payload: Record<string, unknown>) => boolean): void => {
    if (!message || typeof message !== 'object') return;
    switch (message.type) {
      case 'fairy.approvalDecision': {
        const id = typeof message.id === 'string' ? message.id : '';
        const decision = typeof message.decision === 'string' ? message.decision : '';
        if (!id || (decision !== 'allow' && decision !== 'deny' && decision !== 'inspect')) return;
        Promise.resolve(onApprovalDecision({ id, decision })).catch((err: unknown) => log(`vorssaint approval error: ${getErrorMessage(err)}`));
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
        Promise.resolve(onUndock({ x, y, vx, vy, displayId })).catch((err: unknown) => log(`vorssaint undock error: ${getErrorMessage(err)}`));
        return;
      }
      case 'fairy.quickAction': {
        const action = typeof message.action === 'string' ? message.action : '';
        if (!action) return;
        Promise.resolve(onQuickAction({ action })).catch((err: unknown) => log(`vorssaint quickAction error: ${getErrorMessage(err)}`));
        return;
      }
      case 'fairy.contextAction': {
        const action = typeof message.action === 'string' ? message.action : '';
        if (!action) return;
        const text = typeof message.text === 'string' ? message.text : '';
        const files = Array.isArray(message.files) ? message.files.map((item: unknown) => String(item ?? '')).filter(Boolean) : [];
        const imagePath = typeof message.imagePath === 'string' ? message.imagePath : '';
        const source = typeof message.source === 'string' ? message.source : '';
        Promise.resolve(onContextAction({ action, text, files, imagePath, source })).catch((err: unknown) => log(`vorssaint contextAction error: ${getErrorMessage(err)}`));
        return;
      }
      case 'vorssaint.ops': {
        const target = typeof message.target === 'string' ? message.target : 'all';
        const action = typeof message.action === 'string' ? message.action : 'state';
        const tier = typeof message.tier === 'string' ? message.tier : null;
        Promise.resolve(onOps({ target, action, tier })).catch((err: unknown) => log(`vorssaint ops error: ${getErrorMessage(err)}`));
        return;
      }
      case 'vorssaint.calendarRequest': {
        Promise.resolve(onCalendarRequest(message)).catch((err: unknown) => log(`vorssaint calendarRequest error: ${getErrorMessage(err)}`));
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
          metrics: message.metrics && typeof message.metrics === 'object' ? (message.metrics as Record<string, unknown>) : {},
        })).catch((err: unknown) => log(`vorssaint alert error: ${getErrorMessage(err)}`));
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
          permissions: message.permissions && typeof message.permissions === 'object' ? (message.permissions as Record<string, unknown>) : {},
        };
        Promise.resolve(onFeaturesState({ ...lastFeaturesState, connected: Boolean(bridge.state().connected) }))
          .catch((err: unknown) => log(`vorssaint featuresState error: ${getErrorMessage(err)}`));
        return;
      }
      case 'fairy.ask': {
        const id = typeof message.id === 'string' && message.id ? message.id : `ask-${Date.now()}`;
        const text = typeof message.text === 'string' ? message.text : '';
        const context = message.context && typeof message.context === 'object' ? (message.context as VorssaintPromptContext) : {};
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
          onText: (value: unknown) => {
            if (activeAsk === current && !controller.signal.aborted) {
              send({ type: 'fairy.text', id, text: String(value ?? '') });
            }
          },
        }))
          .then((result: unknown) => {
            if (activeAsk === current) activeAsk = null;
            const finalText = typeof result === 'string'
              ? result
              : String((result && typeof result === 'object' && 'text' in result ? (result as { text?: unknown }).text : undefined) ?? '');
            send({ type: 'fairy.done', id, text: finalText });
          })
          .catch((error: unknown) => {
            if (activeAsk === current) activeAsk = null;
            const errorObj = error && typeof error === 'object' ? (error as { name?: unknown; message?: unknown }) : null;
            send({ type: 'fairy.error', id, message: errorObj?.name === 'AbortError' ? 'Stopped.' : (errorObj?.message ? String(errorObj.message) : String(error)) });
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
    onStateChange: (state: VorssaintPeerState) => {
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
    send: (payload: Record<string, unknown>) => bridge.send(payload),

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

    invokeTool(tool: string, args: Record<string, unknown> = {}, { timeoutMs = 15_000 }: { timeoutMs?: number } = {}) {
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

    pushPreset(preset: string, params: Record<string, unknown> = {}) {
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

    sendFeaturesCommand(payload: Record<string, unknown> = {}) {
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
