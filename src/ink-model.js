// A turning 3D model in Fairy's ink: simple shapes as clouds of square pixels, drawn small and blown up, turning in
// steps like a sprite.
import { AdditiveBlending, BufferAttribute, BufferGeometry, Group, PerspectiveCamera, Points, PointsMaterial, Scene, WebGLRenderer, MathUtils } from 'three';
import { TONE_COLOURS } from './ink-tones.js';

const TAU = Math.PI * 2;
const rand = (seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647)(7);
// Points over each shape; sizes come checked from the sketch (see ink-sketch.mjs).
export function shapePoints(shape, size) {
  const [a = 0.5, b = a, c = shape === 'helix' ? 3 : a] = size, out = [];
  const push = (x, y, z) => out.push(x, y, z);
  if (shape === 'sphere') { const n = 360; for (let i = 0; i < n; i++) { const y = 1 - 2 * (i + 0.5) / n, r = Math.sqrt(1 - y * y), t = i * 2.39996; push(Math.cos(t) * r * a, y * a, Math.sin(t) * r * a); } }
  else if (shape === 'ring') { const tube = Math.min(b, a * 0.6); for (let i = 0; i < 420; i++) { const u = rand() * TAU, v = rand() * TAU; push((a + tube * Math.cos(v)) * Math.cos(u), tube * Math.sin(v), (a + tube * Math.cos(v)) * Math.sin(u)); } }
  else if (shape === 'disk') { const inner = Math.min(a, b), outer = Math.max(a, b); for (let i = 0; i < 700; i++) { const r = inner + (outer - inner) * Math.pow(rand(), 1.6), t = rand() * TAU; push(Math.cos(t) * r, (rand() - 0.5) * 0.02, Math.sin(t) * r); } }
  else if (shape === 'cylinder' || shape === 'cone') { for (let i = 0; i < 380; i++) { const h = rand(), t = rand() * TAU, r = shape === 'cone' ? a * (1 - h) : a; push(Math.cos(t) * r, (h - 0.5) * b, Math.sin(t) * r); } }
  else if (shape === 'box') { const [w, h, d] = [a, b, c]; for (let i = 0; i < 420; i++) { const p = [rand() - 0.5, rand() - 0.5, rand() - 0.5], axis = i % 3; p[axis] = p[axis] < 0 ? -0.5 : 0.5; if (i % 2) p[(axis + 1) % 3] = p[(axis + 1) % 3] < 0 ? -0.5 : 0.5; push(p[0] * w, p[1] * h, p[2] * d); } }
  else if (shape === 'helix') { const turns = Math.max(1, Math.min(12, c)); for (let i = 0; i < 360; i++) { const s = i / 360, t = s * turns * TAU; push(Math.cos(t) * a + (rand() - 0.5) * 0.03, (s - 0.5) * b, Math.sin(t) * a + (rand() - 0.5) * 0.03); } }
  else if (shape === 'line') { for (let i = 0; i <= 60; i++) push((i / 60 - 0.5) * a, 0, 0); }
  return new Float32Array(out);
}
// A part's value for one property at time T, eased between the keyframes that set it; before the first or after the last,
// that keyframe's value; with none, the fallback.
const smooth = k => k * k * (3 - 2 * k);
export function keyframe(timeline, prop, T, fallback) {
  const keys = (timeline || []).filter(k => k[prop] !== null && k[prop] !== undefined);
  if (!keys.length) return fallback;
  if (T <= keys[0].t) return keys[0][prop];
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1], b = keys[i];
    if (T <= b.t) {
      const k = smooth((T - a.t) / Math.max(1e-6, b.t - a.t));
      return Array.isArray(a[prop]) ? a[prop].map((v, j) => v + ((b[prop][j] ?? v) - v) * k) : a[prop] + (b[prop] - a[prop]) * k;
    }
  }
  return keys.at(-1)[prop];
}

// Draws parts into the canvas and keeps them moving until stop(). With a duration, parts follow their timelines and the
// whole thing replays after a short pause.
export function modelView(canvas, parts, { spin = true, reduced = false, duration = null } = {}) {
  let renderer;
  try { renderer = new WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'low-power' }); }
  catch { return { stop() {} }; }
  // Rendered at a third of its size; CSS scales it up with square pixels (image-rendering: pixelated).
  const width = Math.round((canvas.clientWidth || 320) / 3), height = Math.round((canvas.clientHeight || 216) / 3);
  renderer.setPixelRatio(1); renderer.setSize(width, height, false); renderer.setClearColor(0x000000, 0);
  const scene = new Scene(), world = new Group(), camera = new PerspectiveCamera(34, width / height, 0.1, 50);
  // From above at an angle, so orbits read as orbits rather than bodies passing behind each other.
  camera.position.set(0, 2.4, 4.9); camera.lookAt(0, 0, 0);
  scene.add(world);
  const moving = [];
  for (const part of parts) {
    const geometry = new BufferGeometry(); geometry.setAttribute('position', new BufferAttribute(shapePoints(part.shape, part.size), 3));
    const material = new PointsMaterial({ color: TONE_COLOURS[part.tone] || TONE_COLOURS.blue, size: 1, transparent: true, opacity: 0.6, blending: AdditiveBlending, depthWrite: false, sizeAttenuation: false });
    const points = new Points(geometry, material), body = new Group(), pivot = new Group();
    body.add(points); body.rotation.set(MathUtils.degToRad(part.tilt[0]), 0, MathUtils.degToRad(part.tilt[1]));
    body.position.set(...part.at); pivot.add(body); world.add(pivot);
    // Orbiting parts share one starting angle, so two bodies placed opposite each other stay opposite.
    const r0 = Math.hypot(part.at[0], part.at[2]) || 1;
    moving.push({ part, points, material, body, pivot, phase: part.motion === 'orbit' ? 0 : rand() * TAU, angle: 0, r0 });
  }
  const timed = Boolean(duration) && moving.some(m => m.part.timeline);
  const cycle = timed ? duration + 1.5 : 0;
  let frame = 0, stopped = false, last = -1;
  const started = performance.now();
  // Twelve frames a second, like pixel-art animation.
  let shown = -1;
  const draw = now => {
    if (stopped) return;
    frame = requestAnimationFrame(draw);
    const tick = Math.floor((now - started) / 83);
    if (tick === shown) return;
    shown = tick;
    const t = tick * 0.083, T = reduced ? (duration || 0) : timed ? t % cycle : t, dt = 0.083;
    if (timed && T < last) for (const m of moving) m.angle = 0;
    last = T;
    if (spin && !reduced) world.rotation.y = t * 0.35;
    for (const m of moving) {
      const { part } = m;
      if (part.timeline) {
        const at = keyframe(part.timeline, 'at', T, part.at), size = keyframe(part.timeline, 'size', T, part.size), opacity = keyframe(part.timeline, 'opacity', T, 1);
        m.body.position.set(...at);
        const scale = Math.max(0.001, (size[0] ?? part.size[0]) / (part.size[0] || 1)); m.points.scale.setScalar(scale);
        m.material.opacity = 0.6 * opacity; m.points.visible = opacity > 0.02;
      }
      if (reduced) continue;
      if (part.motion === 'spin') m.points.rotation.y = t * 1.4;
      else if (part.motion === 'orbit') {
        // Faster the closer in, as an orbit decaying under gravity does.
        const r = Math.hypot(m.body.position.x, m.body.position.z);
        m.angle += dt * Math.min(14, 0.9 * Math.pow(m.r0 / Math.max(0.06, r), 1.5));
        m.pivot.rotation.y = m.angle + m.phase;
      }
      else if (part.motion === 'pulse') { const s = 1 + Math.sin(t * 2.4 + m.phase) * 0.08; if (part.timeline) m.points.scale.multiplyScalar(s); else m.points.scale.setScalar(s); }
    }
    renderer.render(scene, camera);
  };
  frame = requestAnimationFrame(draw);
  return { stop() { stopped = true; cancelAnimationFrame(frame); for (const m of moving) { m.points.geometry.dispose(); m.points.material.dispose(); } renderer.dispose(); renderer.forceContextLoss?.(); } };
}
