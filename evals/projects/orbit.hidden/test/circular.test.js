import test from 'node:test';
import assert from 'node:assert/strict';
import { anomalyAtRadius, eccentricAnomaly } from '../src/solve.js';

// Grace's review: a circular orbit (e = 0) divides by zero.
test('a circular orbit has a finite anomaly at its radius', () => {
  const E = anomalyAtRadius(2, 0, 2);
  assert.ok(Number.isFinite(E), `got ${E}`);
});

test('the elliptical cases still work', () => {
  assert.ok(Math.abs(anomalyAtRadius(1, 0.5, 1) - Math.PI / 2) < 1e-9);
  assert.equal(eccentricAnomaly(0.3, 0), 0.3);
});
