// Kepler's equation, M = E - e sin E, for an orbit with eccentricity e.

// The eccentric anomaly E for a mean anomaly M, by Newton's method.
export function eccentricAnomaly(M, e) {
  let E = M;
  for (let i = 0; i < 50; i++) { const step = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E)); E -= step; if (Math.abs(step) < 1e-12) break; }
  return E;
}

// The eccentric anomaly at distance r from the focus, for semi-major axis a: r = a(1 - e cos E).
export function anomalyAtRadius(a, e, r) {
  const cosE = (1 - r / a) / e;
  return Math.acos(Math.max(-1, Math.min(1, cosE)));
}
