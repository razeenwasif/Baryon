import { defineTool, type ToolDefinition } from './tool-registry.mjs';

const isProtectedApp = (name: unknown = ''): boolean => /\b(baryon|fairy|lyra)\b/i.test(String(name));

const VALID_LAYOUTS = ['left', 'right', 'maximize', 'center'] as const;
const VALID_FAN_MODES = ['auto', 'max', 'status'] as const;

export interface VorssaintApprovalInfo {
  tool: string;
  title: string;
  detail: string;
  args: Record<string, unknown>;
}

export interface CreateVorssaintToolsOptions {
  invoke?: (tool: string, args: Record<string, unknown>) => Promise<unknown> | unknown;
  approve?: (info: VorssaintApprovalInfo) => Promise<boolean> | boolean;
}

export interface VorssaintToolsBundle {
  readOnly: ToolDefinition[];
  mutating: ToolDefinition[];
  all: ToolDefinition[];
}

export function createVorssaintTools({ invoke, approve }: CreateVorssaintToolsOptions = {}): VorssaintToolsBundle {
  if (typeof invoke !== 'function') {
    throw new Error('createVorssaintTools requires an invoke(tool, args) function.');
  }
  const requestApproval = async (info: VorssaintApprovalInfo): Promise<boolean> =>
    (typeof approve === 'function' ? Boolean(await approve(info)) : false);

  const mac_system_snapshot = defineTool({
    name: 'mac_system_snapshot',
    description: 'Read live CPU, GPU, memory, thermals, power watts, battery, fan RPM, disk free space, and network throughput from Vorssaint.',
    risk: 'read',
    properties: {},
    required: [],
    run: async () => invoke('mac_system_snapshot', {}),
  });

  const mac_port_list = defineTool({
    name: 'mac_port_list',
    description: 'List active listening TCP ports with PID, process name, and bind address.',
    risk: 'read',
    properties: {
      query: { type: 'string', description: 'Optional filter by port or process name.' },
    },
    required: [],
    run: async args => invoke('mac_port_list', args),
  });

  const mac_window_list = defineTool({
    name: 'mac_window_list',
    description: 'List visible on-screen macOS windows with app name, title, PID, and bounds.',
    risk: 'read',
    properties: {},
    required: [],
    run: async () => invoke('mac_window_list', {}),
  });

  const mac_window_layout = defineTool({
    name: 'mac_window_layout',
    description: 'Tile or arrange an application window (left, right, maximize, center). Requires user approval.',
    risk: 'write',
    properties: {
      action: { type: 'string', enum: VALID_LAYOUTS, description: 'Window arrangement action.' },
      app: { type: 'string', description: 'Optional app name (defaults to frontmost window).' },
    },
    required: ['action'],
    run: async args => {
      const { app, action } = args as { app?: string; action: string };
      const target = app ? `${app} → ${action}` : `Frontmost window → ${action}`;
      const ok = await requestApproval({
        tool: 'mac_window_layout',
        title: 'Arrange Window',
        detail: target,
        args,
      });
      if (!ok) return { cancelled: true, message: 'Cancelled by user.' };
      return invoke('mac_window_layout', args);
    },
  });

  const mac_audio_mixer = defineTool({
    name: 'mac_audio_mixer',
    description: 'Adjust per-app volume (0.0 to 2.0) or mute state. Refuses muting Baryon/Fairy. Requires user approval.',
    risk: 'write',
    properties: {
      app: { type: 'string', description: 'Application display name.' },
      volume: { type: 'number', description: 'Target gain between 0.0 and 2.0 (1.0 = 100%).' },
      muted: { type: 'boolean', description: 'Whether to mute the application.' },
    },
    required: ['app'],
    guard: args => {
      if (isProtectedApp(args.app)) {
        return 'Refused: Baryon/Fairy audio is protected from mixer muting.';
      }
      if (args.volume !== undefined && (typeof args.volume !== 'number' || !Number.isFinite(args.volume) || args.volume < 0 || args.volume > 2)) {
        return 'volume must be between 0.0 and 2.0.';
      }
      return '';
    },
    run: async args => {
      const { app, muted, volume } = args as { app: string; muted?: boolean; volume?: number };
      const parts = [app];
      if (muted !== undefined) parts.push(muted ? 'mute' : 'unmute');
      if (volume !== undefined) parts.push(`${Math.round(volume * 100)}%`);
      const ok = await requestApproval({
        tool: 'mac_audio_mixer',
        title: 'Adjust App Audio',
        detail: parts.join(' · '),
        args,
      });
      if (!ok) return { cancelled: true, message: 'Cancelled by user.' };
      return invoke('mac_audio_mixer', args);
    },
  });

  const mac_port_kill = defineTool({
    name: 'mac_port_kill',
    description: 'Terminate a process listening on a port by PID (refuses system PIDs <= 1). Requires user approval.',
    risk: 'write',
    properties: {
      pid: { type: 'integer', description: 'Process ID (> 1) to terminate.' },
      force: { type: 'boolean', description: 'Use SIGKILL instead of SIGTERM when true.' },
    },
    required: ['pid'],
    guard: args => {
      if (!Number.isInteger(args.pid) || (args.pid as number) <= 1) {
        return 'Refused: PID must be an integer greater than 1.';
      }
      return '';
    },
    run: async args => {
      const { pid, force } = args as { pid: number; force?: boolean };
      const ok = await requestApproval({
        tool: 'mac_port_kill',
        title: force ? 'Force Kill Process' : 'Stop Process',
        detail: `PID ${pid}`,
        args,
      });
      if (!ok) return { cancelled: true, message: 'Cancelled by user.' };
      return invoke('mac_port_kill', args);
    },
  });

  const mac_keep_awake = defineTool({
    name: 'mac_keep_awake',
    description: 'Enable or disable Keep Awake session (optional duration in minutes). Requires user approval.',
    risk: 'write',
    properties: {
      enabled: { type: 'boolean', description: 'True to keep Mac awake, false to stop.' },
      minutes: { type: 'integer', description: 'Optional duration in minutes (0 = indefinite).' },
    },
    required: ['enabled'],
    run: async args => {
      const { enabled, minutes } = args as { enabled: boolean; minutes?: number };
      const detail = enabled
        ? (minutes ? `Keep awake for ${minutes} min` : 'Keep awake indefinitely')
        : 'Disable Keep Awake';
      const ok = await requestApproval({
        tool: 'mac_keep_awake',
        title: 'Keep Awake',
        detail,
        args,
      });
      if (!ok) return { cancelled: true, message: 'Cancelled by user.' };
      return invoke('mac_keep_awake', args);
    },
  });

  const mac_fan_profile = defineTool({
    name: 'mac_fan_profile',
    description: 'Inspect or switch fan control mode (auto, max, status). Requires user approval for changes.',
    risk: 'write',
    properties: {
      mode: { type: 'string', enum: VALID_FAN_MODES, description: 'Target fan mode or status check.' },
    },
    required: ['mode'],
    run: async args => {
      const { mode } = args as { mode: string };
      const ok = await requestApproval({
        tool: 'mac_fan_profile',
        title: 'Fan Profile',
        detail: `Mode: ${mode}`,
        args,
      });
      if (!ok) return { cancelled: true, message: 'Cancelled by user.' };
      return invoke('mac_fan_profile', args);
    },
  });

  const readOnly = [mac_system_snapshot, mac_port_list, mac_window_list];
  const mutating = [mac_window_layout, mac_audio_mixer, mac_port_kill, mac_keep_awake, mac_fan_profile];
  return {
    readOnly,
    mutating,
    all: [...readOnly, ...mutating],
  };
}
