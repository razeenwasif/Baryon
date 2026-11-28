export type ConnectionStatus = 'idle' | 'connected' | 'reconnecting' | 'stopped';

export interface SupervisorTimer {
  unref?: () => unknown;
}

export type SupervisorTimerHandle = ReturnType<typeof setTimeout> | SupervisorTimer | number;

export interface ConnectionSupervisorOptions {
  probe?: () => boolean | Promise<boolean>;
  onReconnect?: () => unknown;
  onState?: (status: ConnectionStatus) => void;
  silentMs?: number;
  backoffMs?: number[];
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => SupervisorTimerHandle;
  clear?: (timer: any) => void;
}

export interface ConnectionSupervisor {
  markConnected: () => void;
  markHeard: () => void;
  markDisconnected: () => void;
  onWake: () => Promise<boolean>;
  checkSilent: () => Promise<boolean>;
  stop: () => void;
  state: () => { status: ConnectionStatus; lastHeardAt: number; tries: number };
}

/**
 * Connection liveness supervisor with immediate wakeup probing (avoids waiting out dead TCP sockets after sleep)
 * and bounded exponential backoff reconnection.
 */
export function createConnectionSupervisor({
  probe,
  onReconnect = () => {},
  onState = () => {},
  silentMs = 30_000,
  backoffMs = [1000, 2000, 5000, 10000, 30000],
  now = Date.now,
  schedule = setTimeout,
  clear = clearTimeout,
}: ConnectionSupervisorOptions = {}): ConnectionSupervisor {
  let status: ConnectionStatus = 'idle';
  let lastHeardAt = 0;
  let tries = 0;
  let retryTimer: SupervisorTimerHandle | null = null;
  let stopped = false;
  let probing: Promise<boolean> | null = null;

  const setStatus = (next: ConnectionStatus): void => {
    if (status !== next) {
      status = next;
      onState(next);
    }
  };

  function clearRetry(): void {
    if (retryTimer !== null) {
      clear(retryTimer);
      retryTimer = null;
    }
  }

  function scheduleReconnect(): void {
    if (stopped) return;
    clearRetry();
    setStatus('reconnecting');
    const delay = backoffMs[Math.min(tries, backoffMs.length - 1)] ?? 1000;
    tries += 1;
    retryTimer = schedule(async () => {
      retryTimer = null;
      if (stopped) return;
      await Promise.resolve(onReconnect()).catch(() => {});
    }, delay);
    if (typeof retryTimer === 'object' && retryTimer !== null) {
      retryTimer.unref?.();
    }
  }

  async function onWake(): Promise<boolean> {
    if (stopped) return false;
    if (probing) return probing;
    probing = (async () => {
      try {
        const ok = typeof probe === 'function' ? await probe() : true;
        if (ok) {
          lastHeardAt = now();
          tries = 0;
          clearRetry();
          setStatus('connected');
          return true;
        }
        scheduleReconnect();
        return false;
      } catch {
        scheduleReconnect();
        return false;
      } finally {
        probing = null;
      }
    })();
    return probing;
  }

  return {
    markConnected() {
      stopped = false;
      clearRetry();
      tries = 0;
      lastHeardAt = now();
      setStatus('connected');
    },
    markHeard() {
      lastHeardAt = now();
      if (status === 'reconnecting') setStatus('connected');
    },
    markDisconnected() {
      if (stopped) return;
      scheduleReconnect();
    },
    onWake,
    async checkSilent() {
      if (stopped || status !== 'connected' || !lastHeardAt) return false;
      if (now() - lastHeardAt >= silentMs) return !(await onWake());
      return false;
    },
    stop() {
      stopped = true;
      clearRetry();
      setStatus('stopped');
    },
    state() {
      return { status, lastHeardAt, tries };
    },
  };
}
