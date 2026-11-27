import test from 'node:test';
import assert from 'node:assert/strict';
import { anomalyAtRadius, eccentricAnomaly } from '../src/solve.js';

test('solves Kepler’s equation', () => {
  const E = eccentricAnomaly(1, 0.5);
  assert.ok(Math.abs(E - 0.5 * Math.sin(E) - 1) < 1e-9);
});

test('finds the anomaly at a radius', () => {
  assert.ok(Math.abs(anomalyAtRadius(1, 0.5, 1) - Math.PI / 2) < 1e-9);
});
