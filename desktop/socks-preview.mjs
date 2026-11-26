import { connect as netConnect } from 'node:net';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '0:0:0:0:0:0:0:1']);

export function isLoopbackHost(host) {
  const clean = String(host ?? '').trim().toLowerCase();
  return LOOPBACK_HOSTS.has(clean);
}

/**
 * Enforces strictly loopback host + valid port (+ optional allowlist) for mobile preview tunnels.
 */
export function isLoopbackTarget(host, port, allowedPorts = null) {
  if (!isLoopbackHost(host)) return false;
  const p = Math.floor(Number(port));
  if (!Number.isInteger(p) || p < 1 || p > 65535) return false;
  if (allowedPorts) {
    const set = allowedPorts instanceof Set ? allowedPorts : new Set(allowedPorts);
    if (set.size > 0 && !set.has(p)) return false;
  }
  return true;
}

export function createLocalhostPreviewTunnel({ allowedPorts = null, connect = netConnect } = {}) {
  function assertAllowedTarget(host, port) {
    if (!isLoopbackTarget(host, port, allowedPorts)) {
      throw new Error(`Refused preview tunnel target ${host}:${port}: only allowed localhost ports may be tunneled.`);
    }
    return { host: String(host).trim(), port: Math.floor(Number(port)) };
  }

  return {
    assertAllowedTarget,
    connect({ host, port }) {
      const target = assertAllowedTarget(host, port);
      return connect({ host: target.host === 'localhost' ? '127.0.0.1' : target.host, port: target.port });
    },
  };
}
