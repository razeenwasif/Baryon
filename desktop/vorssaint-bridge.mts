// Supervised NDJSON bridge between Baryon (Electron / Node) and the native Vorssaint Swift helper.
import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import net, { type Server, type Socket } from 'node:net';
import { dirname } from 'node:path';
import { readProcessIdentity, reclaimOrphanedDaemon } from './process-audit-token.mjs';

const LINE_LIMIT = 1 << 20;

export interface VorssaintPeerState {
  connected: boolean;
  pid: number | null;
  app: string | null;
  protocol: number;
  keptFeatures: unknown[];
}

export interface VorssaintMessage {
  type?: string;
  pid?: number | null;
  app?: string;
  protocol?: number;
  keptFeatures?: unknown[];
  [key: string]: unknown;
}

export interface CreateVorssaintBridgeOptions {
  socketPath?: string;
  binaryPath?: string | null;
  lockPath?: string | null;
  role?: string;
  env?: Record<string, string | undefined>;
  log?: (message: string) => void;
  onMessage?: (message: VorssaintMessage, send: (payload: Record<string, unknown>) => boolean) => void;
  onStateChange?: (state: VorssaintPeerState) => void;
}

export interface VorssaintBridge {
  state: () => VorssaintPeerState;
  send: (message: Record<string, unknown>) => boolean;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export function createVorssaintBridge({
  socketPath,
  binaryPath = null,
  lockPath = null,
  role = 'full',
  env = {},
  log = () => {},
  onMessage = () => {},
  onStateChange = () => {},
}: CreateVorssaintBridgeOptions = {}): VorssaintBridge {
  if (!socketPath) throw new Error('socketPath is required');

  let server: Server | null = null;
  let activeConn: Socket | null = null;
  let child: ChildProcess | null = null;
  let stopped = false;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let backoffMs = 500;
  let peerState: VorssaintPeerState = { connected: false, pid: null, app: null, protocol: 1, keptFeatures: [] };

  const emitState = (patch: Partial<VorssaintPeerState>): void => {
    peerState = { ...peerState, ...patch };
    try { onStateChange({ ...peerState }); } catch {}
  };

  const send = (message: Record<string, unknown>): boolean => {
    if (!activeConn || activeConn.destroyed) return false;
    activeConn.write(`${JSON.stringify(message)}\n`);
    return true;
  };

  const writeLock = async (pid: number | undefined): Promise<void> => {
    if (!lockPath || !pid) return;
    mkdirSync(dirname(lockPath), { recursive: true });
    const identity = await readProcessIdentity(pid).catch(() => null);
    writeFileSync(lockPath, JSON.stringify({
      pid,
      startedAt: identity?.startedAt || '',
      command: identity?.command || binaryPath || '',
    }));
  };

  const removeLock = (): void => {
    if (!lockPath) return;
    try { rmSync(lockPath, { force: true }); } catch {}
  };

  const launchHelper = async (): Promise<void> => {
    if (stopped || !binaryPath || child) return;
    if (!existsSync(binaryPath)) {
      log(`vorssaint bridge: binary not found at ${binaryPath}`);
      return;
    }
    if (lockPath) await reclaimOrphanedDaemon(lockPath).catch(() => {});

    const proc = spawn(binaryPath, ['--baryon-helper', '--socket', socketPath], {
      env: { ...process.env, BARYON_HELPER: '1', BARYON_VORSSAINT_SOCK: socketPath, ...env } as NodeJS.ProcessEnv,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child = proc;
    void writeLock(proc.pid);

    proc.stderr?.on('data', (chunk: Buffer | string) => {
      const text = String(chunk || '').trim();
      if (text) log(`vorssaint: ${text}`);
    });

    proc.on('exit', (code, signal) => {
      if (child === proc) child = null;
      removeLock();
      emitState({ connected: false, pid: null });
      if (!stopped) {
        log(`vorssaint helper exited (code=${code}, signal=${signal}); restarting in ${backoffMs}ms`);
        const wait = backoffMs;
        backoffMs = Math.min(backoffMs * 2, 10_000);
        restartTimer = setTimeout(() => {
          restartTimer = null;
          void launchHelper();
        }, wait);
      }
    });
  };

  return {
    state() { return { ...peerState }; },
    send,
    async start() {
      stopped = false;
      mkdirSync(dirname(socketPath), { recursive: true });
      if (existsSync(socketPath)) {
        try { unlinkSync(socketPath); } catch {}
      }

      const srv = net.createServer(conn => {
        if (activeConn && !activeConn.destroyed) {
          try { activeConn.destroy(); } catch {}
        }
        activeConn = conn;
        conn.setEncoding('utf8');
        let buffer = '';

        const handleLine = (line: string): void => {
          let message: VorssaintMessage;
          try {
            message = JSON.parse(line) as VorssaintMessage;
          } catch {
            if (!conn.destroyed) conn.write(`${JSON.stringify({ type: 'error', message: 'Invalid JSON.' })}\n`);
            return;
          }
          if (message?.type === 'hello') {
            backoffMs = 500;
            emitState({
              connected: true,
              pid: message.pid ?? null,
              app: message.app || 'vorssaint',
              protocol: message.protocol || 1,
              keptFeatures: Array.isArray(message.keptFeatures) ? message.keptFeatures : [],
            });
            conn.write(`${JSON.stringify({ type: 'hello.ack', app: 'Baryon', role, protocol: 1 })}\n`);
            return;
          }
          try { onMessage(message, payload => send(payload)); } catch (err: unknown) { log(`vorssaint handler: ${err instanceof Error ? err.message : String(err)}`); }
        };

        conn.on('data', (chunk: string) => {
          buffer += chunk;
          if (buffer.length > LINE_LIMIT) { conn.destroy(); return; }
          let nl: number;
          while ((nl = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (line) handleLine(line);
          }
        });

        conn.on('close', () => {
          if (activeConn === conn) {
            activeConn = null;
            emitState({ connected: false, pid: null });
          }
        });
        conn.on('error', () => {});
      });
      server = srv;

      srv.on('error', (err: Error) => log(`vorssaint bridge socket error: ${err.message}`));

      await new Promise<void>((resolve, reject) => {
        srv.once('error', reject);
        srv.listen(socketPath, () => {
          srv.off('error', reject);
          try { chmodSync(socketPath, 0o600); } catch {}
          resolve();
        });
      });

      if (binaryPath) await launchHelper();
    },

    async stop() {
      stopped = true;
      if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
      try { send({ type: 'shutdown' }); } catch {}

      const proc = child;
      if (proc && !proc.killed) {
        await new Promise<void>(resolve => {
          const timer = setTimeout(() => {
            try { proc.kill('SIGTERM'); } catch {}
            setTimeout(() => {
              if (!proc.killed) { try { proc.kill('SIGKILL'); } catch {} }
              resolve();
            }, 400);
          }, 300);
          proc.once('exit', () => { clearTimeout(timer); resolve(); });
        });
      }
      child = null;
      removeLock();

      if (activeConn && !activeConn.destroyed) {
        try { activeConn.destroy(); } catch {}
      }
      activeConn = null;

      if (server) {
        const srv = server;
        await new Promise<void>(resolve => srv.close(() => resolve()));
        server = null;
      }
      try { unlinkSync(socketPath); } catch {}
      emitState({ connected: false, pid: null });
    },
  };
}
