// Notebook's sky: one large nebula flowing slowly through Velvet, drawn in fine characters on the GPU, its gas stirred
// by the pointer: it parts around where the pointer rests, and a pointer moving through the cloud drags the gas along
// and leaves a pair of eddies turning either way behind it, which settle back over two seconds or so (19 Nov, the
// user's ask, in place of the constellations that joined near the pointer). Velvet stays underneath (its near-black,
// its glow and its dot grid, a little quieter here), and where there's gas the dots give way to characters. Made from
// the mock the user chose on 17 Nov (artifact WZhuH7rdNwTCPKU7X2R8W9, v3.1).
//
// Two passes. The first runs once per character cell (7 × 11 css pixels) into a small texture: what's there, its colour
// and its character. The second runs per pixel: the cell's character from a strip, Velvet's dots where there's none,
// and a soft haze of the nebula read smoothly from the same texture. The noise is all in the first pass, so a 1512 ×
// 982 window works it out for about 19,000 cells rather than 5.9 million pixels. At most 30 frames a second, only
// while Notebook is open and the window is seen; one still frame with Reduce Motion or Low Power.

import { DOT_FIELD } from './dot-field.js';

export type NebulaMode = 'off' | 'still' | 'paused' | 'live';

export interface WakePoint {
  x: number;
  y: number;
  vx: number;
  vy: number;
  a: number;
}

export interface WakeCursor {
  x: number;
  y: number;
  at: number;
}

export interface NebulaSkyOptions {
  now?: () => number;
}

export interface NebulaSkyController {
  set(next: NebulaMode): void;
  speed(n: number): void;
  readonly mode: NebulaMode;
}

interface ShaderProgram {
  p: WebGLProgram;
  u: (name: string) => WebGLUniformLocation | null;
}

export const NEBULA = Object.freeze({
  fps: 30,
  cell: Object.freeze([7, 11] as const),          // css pixels across and down
  glyphs: Object.freeze([' ', '.', '·', ':', '-', '=', '+', '*', '#', '%', '@', '/', '\\', '|'] as const), // a ramp (0–10), then lines
  // The pointer's wake: how many of its recent places stir the gas at once, how often one is taken (seconds), how long
  // a stir takes to settle (seconds, to a third), and how far one reaches (window heights).
  wake: 8, every: 0.06, settle: 1.4, reach: 0.11,
  // Velvet's dot field, quieter under the nebula.
  dots: Object.freeze({ gap: DOT_FIELD.gap, radius: DOT_FIELD.radius, push: DOT_FIELD.push, base: 0.02, peak: 0.26 }),
});

const VERTEX = 'attribute vec2 at; void main() { gl_Position = vec4(at, 0.0, 1.0); }';

// Pass 1, one fragment per cell: rgb its colour (brightness folded in), a its character's place in the strip.
export function skySource(): string {
  const { wake, reach } = NEBULA;
  return `precision highp float;
uniform vec2 grid, unit;           // columns and rows; one cell in window heights
uniform float A, time;             // width over height; seconds
uniform vec3 pointer;              // where (window heights) and how present
uniform vec4 stir[${wake}];        // the pointer's recent places: x, y, and its velocity there (window heights a second)
uniform float stirA[${wake}];      // how much each still stirs, 1 fresh to 0 settled

const vec3 WHITE = vec3(0.9, 0.94, 1.0), CYAN = vec3(0.42, 0.84, 1.0), BLUE = vec3(0.24, 0.34, 0.92);
const vec3 DEEP = vec3(0.16, 0.18, 0.55), VIOLET = vec3(0.56, 0.4, 0.95), TEAL = vec3(0.24, 0.7, 0.78);
// The thickest gas goes to a soft cool grey rather than white, and the whole cloud is drawn about a quarter dimmer
// (18 Nov, the user's ask), so it sits back behind what you read.
const vec3 PEAK = vec3(0.6, 0.62, 0.68);
const float GLOW = 0.74;
const mat2 TURN = mat2(1.6, 1.2, -1.2, 1.6);

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * noise(p); p = TURN * p; a *= 0.5; } return s; }
float ramp(float b) { return clamp(floor(b * 10.99), 0.0, 10.0); }
// A point turned by angle a about a centre.
vec2 turn(vec2 p, vec2 c, float a) { vec2 d = p - c; float s = sin(a), k = cos(a); return c + vec2(k * d.x - s * d.y, s * d.x + k * d.y); }

void main() {
  vec2 cell = floor(gl_FragCoord.xy);
  vec2 p = (vec2(cell.x, grid.y - 1.0 - cell.y) + 0.5) * unit;
  vec3 col = vec3(0.0); float g = 0.0;
  float near = pointer.z * smoothstep(0.22, 0.0, length(p - pointer.xy));

  // The pointer stirs the gas: the nebula is read from where the gas here was pushed from. Where the pointer rests the
  // gas parts around it; along its path the gas is dragged with it, and turned either way on the two sides of the path,
  // a pair of eddies that settle as the stir fades.
  vec2 g0 = p; float stirred = 0.0;
  for (int i = 0; i < ${wake}; i++) {
    float a = stirA[i];
    if (a < 0.01) continue;
    vec2 d = p - stir[i].xy, v = stir[i].zw;
    float fall = exp(-dot(d, d) / ${(reach * reach).toFixed(5)}) * a;
    float side = d.x * v.y - d.y * v.x;
    g0 = turn(g0, stir[i].xy, -sign(side) * min(length(v), 1.5) * fall * 0.9);
    g0 -= v * fall * 0.045;
    stirred += fall * min(length(v), 1.0);
  }
  vec2 dp = p - pointer.xy;
  g0 -= dp * pointer.z * exp(-dot(dp, dp) / ${(reach * reach * 0.6).toFixed(5)}) * 0.55;

  // The nebula: noise warped by noise warped by noise, so it folds into filaments that flow, slowly.
  float t = time * 0.022;
  vec2 s = g0 * 1.7;
  vec2 q = vec2(fbm(s + vec2(0.0, t)), fbm(s + vec2(5.2, 1.3) - t * 0.8));
  vec2 r = vec2(fbm(s + 3.6 * q + vec2(1.7, 9.2) + t * 1.4), fbm(s + 3.6 * q + vec2(8.3, 2.8) - t * 1.1));
  float f = fbm(s + 3.4 * r);
  // Lower horizon band drifting smoothly along the bottom edge so most of the upper window stays obsidian black.
  float x = g0.x / A;
  float edge = g0.y - (0.93 - 0.14 * x + 0.06 * sin(x * 3.2 + 0.6)) + (q.x - 0.5) * 0.28;
  float body = exp(-edge * edge * 10.5) * smoothstep(0.42, 0.78, g0.y);
  float dens = pow(smoothstep(0.3, 0.82, f), 1.7) * body * 1.05;
  float dust = smoothstep(0.52, 0.74, fbm(s * 2.3 + 2.2 * r + 7.0));
  // Fine fibres through it, and bright thin filaments where the warped noise folds.
  dens *= 0.4 + 0.6 * fbm(s * 5.5 + r * 2.5 - t);
  float fold = 1.0 - abs(2.0 * fbm(s * 2.6 + 4.0 * r + 3.0) - 1.0);
  dens += pow(fold, 6.0) * body * 0.55;
  dens *= 1.0 - 0.8 * dust;
  dens = clamp(dens, 0.0, 1.0);
  dens += near * 0.05 * body;
  // Stirred gas glows a little, a touch cooler.
  dens = clamp(dens * (1.0 + 0.35 * stirred), 0.0, 1.0);
  if (dens > 0.03) {
    vec3 c = mix(DEEP, VIOLET, smoothstep(0.2, 0.9, length(q) * 0.9));
    c = mix(c, BLUE, smoothstep(0.4, 0.75, q.y) * 0.6);
    c = mix(c, CYAN, clamp(r.x * r.x * 1.6 - 0.15, 0.0, 1.0));
    c = mix(c, TEAL, 0.14 * smoothstep(0.62, 0.82, r.y));
    c = mix(c, PEAK, smoothstep(0.55, 1.0, dens) * 0.7);
    c = mix(c, CYAN, clamp(stirred * 0.5, 0.0, 0.35));
    col = c * (0.18 + dens * 0.72) * GLOW;
    g = max(1.0, ramp(pow(dens, 1.35) + (hash(cell) - 0.5) * 0.06));
    if (dens < 0.3 && hash(cell * 0.91 + 1.7) > dens * 3.4) g = 0.0; // thin gas thins to scattered characters; its haze stays
  }

  // Far stars, faint, kept low along the horizon so upper background remains clean black.
  float starMask = smoothstep(0.42, 0.76, p.y);
  if (p.y >= 0.42) {
    for (int i = 0; i < 2; i++) {
      float fi = float(i);
      vec2 sc = p / unit; sc.x += time * (0.05 + 0.08 * fi);
      vec2 id = floor(sc) + fi * vec2(37.0, 91.0);
      if (hash(id) > 0.993 - fi * 0.002 && dens < 0.35) {
        float h2 = hash(id + 0.71), b = (0.15 + 0.2 * h2) * (0.6 + 0.4 * sin(time * (0.6 + 2.0 * h2) + h2 * 40.0)) + near * 0.15;
        col = (h2 > 0.6 ? CYAN : WHITE) * (0.18 + b) * starMask; g = b > 0.45 ? 6.0 : b > 0.3 ? 2.0 : 1.0;
      }
    }
  }
  if (dens > 0.3 && hash(cell * 1.37 + 5.0) > 0.9965) { col = PEAK * (0.6 + 0.3 * sin(time * 0.7 + hash(cell) * 30.0)) * GLOW; g = 7.0; }


  gl_FragColor = vec4(col, g / 255.0);
}`;
}

// Pass 2, per pixel: the cell's character, Velvet's dots (pushed and lit near the pointer) where there's none, and the
// nebula's haze read smoothly underneath.
export function drawSource(): string {
  return `precision mediump float;
uniform sampler2D sky, atlas;
uniform vec2 grid, cellPx, canvasPx;
uniform float glyphs, dpr;
uniform vec3 pointerPx;   // css pixels, and how present
uniform vec4 dots;        // gap, radius, push, base
uniform float peak;
void main() {
  vec2 fc = vec2(gl_FragCoord.x, canvasPx.y - gl_FragCoord.y);
  vec2 c = floor(fc / cellPx), local = fract(fc / cellPx);
  vec4 s = texture2D(sky, vec2((c.x + 0.5) / grid.x, (grid.y - c.y - 0.5) / grid.y));
  float g = floor(s.a * 255.0 + 0.5);
  float m = g < 0.5 ? 0.0 : texture2D(atlas, vec2((g + local.x) / glyphs, local.y)).a;
  vec3 haze = texture2D(sky, vec2(fc.x / (cellPx.x * grid.x), 1.0 - fc.y / (cellPx.y * grid.y))).rgb * 0.12;
  vec2 css = fc / dpr, size = canvasPx / dpr;
  vec2 offset = (size - floor(size / dots.x) * dots.x) * 0.5;
  vec2 anchor = floor((css - offset) / dots.x + 0.5) * dots.x + offset;
  vec2 away = anchor - pointerPx.xy; float dist = length(away);
  float near = max(0.0, 1.0 - dist / dots.y), pull = near * near * (3.0 - 2.0 * near) * pointerPx.z;
  vec2 at = anchor + (dist > 0.0 ? away / dist * pull * pull * dots.z : vec2(0.0));
  float light = pow(pull, 1.8), radius = 0.7 + light;
  float dot = smoothstep(radius + 0.6, radius - 0.2, length(css - at)) * (dots.w + light * (peak - dots.w)) * (g < 0.5 ? 1.0 : 0.0);
  vec3 rgb = s.rgb * m + haze + vec3(0.79, 0.82, 0.93) * dot;
  gl_FragColor = vec4(rgb, max(rgb.r, max(rgb.g, rgb.b)));
}`;
}

// The pointer's wake. A new place is taken at most every NEBULA.every seconds, with the velocity since the last one
// (window heights a second, at most 3); only the newest NEBULA.wake are kept. Returns the place taken last.
export function takeWake(wake: WakePoint[], last: WakeCursor, x: number, y: number, at: number): WakeCursor {
  if (at - last.at < NEBULA.every) return last;
  const dt = last.at < 0 ? 0 : Math.min(0.5, at - last.at);
  let vx = dt ? (x - last.x) / dt : 0, vy = dt ? (y - last.y) / dt : 0;
  const speed = Math.hypot(vx, vy);
  if (speed > 3) { vx *= 3 / speed; vy *= 3 / speed; }
  wake.push({ x, y, vx, vy, a: 1 });
  while (wake.length > NEBULA.wake) wake.shift();
  return { x, y, at };
}
// Each stir fades to a third in NEBULA.settle seconds; settled ones go.
export function settleWake(wake: WakePoint[], dt: number): WakePoint[] {
  const keep = Math.exp(-dt / NEBULA.settle);
  for (const w of wake) w.a *= keep;
  while (wake.length && wake[0].a < 0.01) wake.shift();
  return wake;
}

function glyphStrip(documentRef = document): HTMLCanvasElement {
  const w = 48, h = 80, canvas = documentRef.createElement('canvas');
  canvas.width = w * NEBULA.glyphs.length; canvas.height = h;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#fff'; context.textAlign = 'center'; context.textBaseline = 'middle';
  context.font = '500 62px ui-monospace, "SF Mono", Menlo, monospace';
  NEBULA.glyphs.forEach((ch, i) => context.fillText(ch, (i + 0.5) * w, h / 2 + 2));
  return canvas;
}

// The sky on a canvas, or null when there's no WebGL (Notebook keeps plain Velvet then). set('off'|'still'|'paused'|'live').
export function nebulaSky(canvas: HTMLCanvasElement, { now = () => performance.now() / 1000 }: NebulaSkyOptions = {}): NebulaSkyController | null {
  const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false, powerPreference: 'low-power' });
  if (!gl) return null;
  let sky: ShaderProgram | null = null, draw: ShaderProgram | null = null, skyTex: WebGLTexture | null = null, atlasTex: WebGLTexture | null = null, fbo: WebGLFramebuffer | null = null;
  const program = (fragment: string, label: string): ShaderProgram => {
    const shader = (type: number, source: string): WebGLShader => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || `Notebook’s sky (${label}) didn’t compile.`);
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, shader(gl.VERTEX_SHADER, VERTEX)); gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fragment));
    gl.bindAttribLocation(p, 0, 'at'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || `Notebook’s sky (${label}) didn’t link.`);
    const where = new Map<string, WebGLUniformLocation | null>();
    return { p, u: (name: string) => { if (!where.has(name)) where.set(name, gl.getUniformLocation(p, name)); return where.get(name) ?? null; } };
  };
  const linear = (): void => {
    const params: ReadonlyArray<readonly [number, number]> = [
      [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
      [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
    ];
    for (const [key, value] of params) gl.texParameteri(gl.TEXTURE_2D, key, value);
  };
  let cols = 0, rows = 0, width = 0, height = 0, scale = 1, lost = false;
  function build(): void {
    sky = program(skySource(), 'sky'); draw = program(drawSource(), 'draw');
    gl!.bindBuffer(gl!.ARRAY_BUFFER, gl!.createBuffer());
    gl!.bufferData(gl!.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl!.STATIC_DRAW);
    gl!.enableVertexAttribArray(0); gl!.vertexAttribPointer(0, 2, gl!.FLOAT, false, 0, 0);
    atlasTex = gl!.createTexture(); gl!.bindTexture(gl!.TEXTURE_2D, atlasTex); linear();
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, glyphStrip());
    skyTex = gl!.createTexture(); fbo = gl!.createFramebuffer();
    gl!.disable(gl!.BLEND);
    cols = 0; // the cell texture is made at the next size
  }
  build();

  // The pointer, and its wake: its recent places with its velocity there, each stirring less as it settles.
  const pointer = { x: -9, y: -9, toX: -9, toY: -9, strength: 0, to: 0 };
  const wake: WakePoint[] = [], stirBuf = new Float32Array(NEBULA.wake * 4), stirABuf = new Float32Array(NEBULA.wake);
  let taken: WakeCursor = { x: -9, y: -9, at: -1 };
  let mode: NebulaMode = 'off', rate = 1, clock = 40, last = 0, shown = 0, frame = 0;

  function resize(): void {
    const box = canvas.getBoundingClientRect();
    width = box.width; height = box.height; scale = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
    if (mode !== 'off') paint();
  }
  // The cell texture, (re)made when the window's size in cells changes.
  function cells(): void {
    const c = Math.max(1, Math.ceil(width / NEBULA.cell[0])), r = Math.max(1, Math.ceil(height / NEBULA.cell[1]));
    if (c === cols && r === rows) return;
    cols = c; rows = r;
    gl!.bindTexture(gl!.TEXTURE_2D, skyTex); linear();
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, cols, rows, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, null);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, fbo); gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, skyTex, 0);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
  }
  // The wake settles; what's left of it goes to the shader.
  function move(dt: number): void {
    settleWake(wake, dt);
    stirBuf.fill(0); stirABuf.fill(0);
    wake.slice(-NEBULA.wake).forEach((w, i) => { stirBuf.set([w.x, w.y, w.vx, w.vy], i * 4); stirABuf[i] = w.a; });
  }
  function paint(): void {
    if (lost || !width || !height || !sky || !draw) return;
    cells();
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, fbo); gl!.viewport(0, 0, cols, rows);
    gl!.useProgram(sky.p);
    gl!.uniform2f(sky.u('grid'), cols, rows); gl!.uniform2f(sky.u('unit'), NEBULA.cell[0] / height, NEBULA.cell[1] / height);
    gl!.uniform1f(sky.u('A'), width / height); gl!.uniform1f(sky.u('time'), clock);
    gl!.uniform3f(sky.u('pointer'), pointer.x, pointer.y, mode === 'live' ? pointer.strength : 0);
    gl!.uniform4fv(sky.u('stir[0]'), stirBuf); gl!.uniform1fv(sky.u('stirA[0]'), stirABuf);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null); gl!.viewport(0, 0, canvas.width, canvas.height);
    gl!.useProgram(draw.p);
    gl!.activeTexture(gl!.TEXTURE0); gl!.bindTexture(gl!.TEXTURE_2D, skyTex); gl!.uniform1i(draw.u('sky'), 0);
    gl!.activeTexture(gl!.TEXTURE1); gl!.bindTexture(gl!.TEXTURE_2D, atlasTex); gl!.uniform1i(draw.u('atlas'), 1);
    gl!.uniform2f(draw.u('grid'), cols, rows); gl!.uniform2f(draw.u('cellPx'), NEBULA.cell[0] * scale, NEBULA.cell[1] * scale);
    gl!.uniform2f(draw.u('canvasPx'), canvas.width, canvas.height); gl!.uniform1f(draw.u('glyphs'), NEBULA.glyphs.length);
    gl!.uniform1f(draw.u('dpr'), scale);
    gl!.uniform3f(draw.u('pointerPx'), pointer.x * height, pointer.y * height, mode === 'live' ? pointer.strength : 0);
    const { gap, radius, push, base, peak } = NEBULA.dots;
    gl!.uniform4f(draw.u('dots'), gap, radius, push, base); gl!.uniform1f(draw.u('peak'), peak);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    gl!.activeTexture(gl!.TEXTURE0);
  }
  function tick(): void {
    frame = 0;
    if (mode !== 'live') return;
    const at = now(), dt = Math.min(0.1, at - last) * rate;
    last = at;
    clock += dt;
    pointer.x += (pointer.toX - pointer.x) * 0.2; pointer.y += (pointer.toY - pointer.y) * 0.2;
    pointer.strength += (pointer.to - pointer.strength) * 0.1;
    move(dt);
    if (at - shown >= 1 / NEBULA.fps - 0.004) { shown = at; paint(); }
    frame = requestAnimationFrame(tick);
  }
  const resizes = new ResizeObserver(resize);
  resizes.observe(canvas);
  window.addEventListener('pointermove', event => {
    if (mode !== 'live' || !height) return;
    const box = canvas.getBoundingClientRect();
    pointer.toX = (event.clientX - box.left) / height; pointer.toY = (event.clientY - box.top) / height;
    if (pointer.strength < 0.02) { pointer.x = pointer.toX; pointer.y = pointer.toY; }
    pointer.to = 1;
    taken = takeWake(wake, taken, pointer.toX, pointer.toY, now());
  }, { passive: true });
  const away = (): void => { pointer.to = 0; };
  document.documentElement.addEventListener('mouseleave', away);
  window.addEventListener('blur', away);
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); lost = true; }, false);
  canvas.addEventListener('webglcontextrestored', () => { lost = false; try { build(); paint(); } catch {} }, false);

  return {
    set(next: NebulaMode) {
      if (next === mode) return;
      mode = next;
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      if (mode === 'off') { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); return; }
      if (!width) resize();
      if (mode !== 'live') { pointer.strength = 0; pointer.to = 0; wake.length = 0; move(0); paint(); return; }
      last = now(); frame = requestAnimationFrame(tick);
    },
    speed(n: number) { rate = Number.isFinite(n) && n > 0 ? n : 1; },
    get mode() { return mode; },
  };
}
