/**
 * Collision-safe `tailscale serve` route discovery and mount planning.
 */
export function parseServeStatus(input) {
  if (!input) return [];
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try { return parseServeStatus(JSON.parse(trimmed)); } catch {}
    }
    const routes = [];
    for (const line of trimmed.split('\n')) {
      const m = /^\s*\|--\s+(\S+)\s+proxy\s+(\S+)/i.exec(line);
      if (m) routes.push({ mountPath: m[1].trim(), target: m[2].trim() });
    }
    return routes;
  }

  const routes = [];
  const web = input?.Web;
  if (web && typeof web === 'object') {
    for (const entry of Object.values(web)) {
      const handlers = entry?.Handlers;
      if (!handlers || typeof handlers !== 'object') continue;
      for (const [mountPath, cfg] of Object.entries(handlers)) {
        if (cfg?.Proxy) routes.push({ mountPath, target: String(cfg.Proxy) });
      }
    }
  }
  return routes;
}

export function findAvailableServePath(existingRoutes = [], preferredPath = '/fairy', targetPrefix = '') {
  const routes = Array.isArray(existingRoutes) ? existingRoutes : [];
  const cleanPref = preferredPath.startsWith('/') ? preferredPath : `/${preferredPath}`;
  const matchingExisting = routes.find(r => r.mountPath === cleanPref);
  if (!matchingExisting) return { mountPath: cleanPref, reusedExisting: false, collisionAvoided: false };
  if (targetPrefix && matchingExisting.target === targetPrefix) {
    return { mountPath: cleanPref, reusedExisting: true, collisionAvoided: false };
  }
  const taken = new Set(routes.map(r => r.mountPath));
  for (let i = 2; i < 100; i++) {
    const candidate = `${cleanPref}-${i}`;
    if (!taken.has(candidate)) return { mountPath: candidate, reusedExisting: false, collisionAvoided: true };
  }
  throw new Error('Could not find an available tailscale serve path.');
}

export function planServeConfig({ statusInput = null, preferredPath = '/fairy', localPort } = {}) {
  const port = Math.floor(Number(localPort));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid local port for tailscale serve.');
  const target = `http://127.0.0.1:${port}`;
  const routes = parseServeStatus(statusInput);
  const picked = findAvailableServePath(routes, preferredPath, target);
  return {
    mountPath: picked.mountPath,
    target,
    reusedExisting: picked.reusedExisting,
    collisionAvoided: picked.collisionAvoided,
    args: ['serve', '--bg', '--set-path', picked.mountPath, target],
  };
}
