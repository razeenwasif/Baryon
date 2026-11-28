// Velvet's aurora grid: Velvet's dot grid and the aurora in ASCII made one thing. Every dot of the grid is a cell the
// aurora can light: where the aurora flows, the dot grows into a character, denser toward an arc's crest (. : - ~ = + *
// # %), grey, and blue on the brightest crest with a few blue glints; elsewhere it stays a faint velvet dot. The pointer
// still gathers the grid as Velvet's dots did, pushing the cells outwards and lighting them, and it stirs the aurora
// under it, so the characters near it brighten too.
//
// Drawn on the GPU by one fragment shader, about 30 frames a second, so it moves smoothly and costs the page almost
// nothing: each frame is a few uniforms and one triangle. The aurora's shape is ascii-aurora.js's (its ARCS and the
// same formula), so the two can't drift apart. 'live' flows and follows the pointer; 'paused' keeps the frame;
// 'still' (Reduce Motion, Low Power) is one frame of the sky with no pointer; 'off' is blank.
import { ARCS, ASCII_AURORA } from './ascii-aurora.js';
import { DOT_FIELD, type DotFieldMode } from './dot-field.js';

export const AURORA_GRID = { fps: 30, glyph: 64 };
const RAMP = ASCII_AURORA.ramp; // ' ..:-~=+*#%', index 0 is a plain dot

export interface AuroraGridOptions {
  now?: () => number;
}

export interface AuroraGridController {
  set(next: DotFieldMode): void;
  speed(n: number): void;
  readonly mode: DotFieldMode;
}

type UniformName = 'size' | 'scale' | 'time' | 'pointer' | 'glyphs';

const num = (value: number): string => (Number.isInteger(value) ? `${value}.0` : String(value));

// The aurora's light and the main arc's crest at (u, v), in GLSL, from the same arcs as ascii-aurora.js auroraAt.
export function auroraGLSL(): string {
  const arcs = ARCS.map(arc => `
    {
      float y = ${num(arc.base)} - ${num(arc.lift)} * u + ${num(arc.bow)} * (u - 0.5) * (u - 0.5) + ${num(arc.sway)} * sin(u * 4.3 + t * ${num(arc.speed)} * 6.0) + ripple;
      float d = (v - y) / ${num(arc.width)};
      float glow = exp(-(d > 0.0 ? d * d * 1.6 : d * d * 0.22));
      light += ${num(arc.strength)} * glow * curtain;${arc.accent ? '\n      crest = max(crest, glow * curtain);' : ''}
    }`).join('');
  return `
vec2 aurora(float u, float v, float t) {
  float light = 0.0, crest = 0.0;
  float curtain = 0.86 + 0.14 * sin(u * 19.0 + 2.0 * sin(u * 5.0 + t * 0.35) - t * 0.6);
  float ripple = 0.008 * sin(u * 17.0 - t * 0.9);${arcs}
  light *= 0.88 + 0.12 * sin(t * 0.35);
  return vec2(min(1.0, light), crest);
}`;
}

const VERTEX = 'attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }';

export function fragmentSource(): string {
  const { gap, radius, push, base, peak, colour } = DOT_FIELD;
  const rgb = (text: string): string => `vec3(${text.split(',').map(n => (Number(n) / 255).toFixed(4)).join(', ')})`;
  return `precision highp float;
uniform vec2 size;      // the canvas in points
uniform float scale;    // pixels to a point
uniform float time;
uniform vec3 pointer;   // x, y in points, and how strongly it's there (0..1)
uniform sampler2D glyphs;
${auroraGLSL()}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// One cell's dot or character as it falls on the point px, premultiplied.
vec4 cellAt(vec2 px, vec2 cell, vec2 offset) {
  vec2 anchor = offset + cell * ${num(gap)};
  // The pointer gathers the grid: cells pushed outwards and lit, smoothly from full at the pointer to none at ${radius}.
  vec2 away = anchor - pointer.xy;
  float dist = length(away), near = max(0.0, 1.0 - dist / ${num(radius)});
  float pull = near * near * (3.0 - 2.0 * near) * pointer.z;
  vec2 centre = anchor + (dist > 0.0 ? away / dist * pull * pull * ${num(push)} : vec2(0.0));
  vec2 local = px - centre;
  float lift = pow(pull, 1.8);
  // The aurora at the cell, stirred brighter under the pointer.
  vec2 sky = aurora(anchor.x / size.x, anchor.y / size.y, time);
  float light = sky.x > 0.04 ? min(1.0, sky.x + 0.3 * lift) : sky.x;
  float index = min(${num(RAMP.length - 1)}, floor(light * ${num(RAMP.length)}));
  vec3 colour; float alpha;
  if (index < 1.0) {
    // A velvet dot: round, faint, brighter and bigger near the pointer.
    float r = 0.7 + lift;
    alpha = (${num(base)} + lift * ${num(peak - base)}) * clamp(r + 0.5 / scale - length(local), 0.0, 1.0);
    colour = ${rgb(colour)};
  } else {
    // A character: the ramp's glyph for this light, in a cell the size of the grid's spacing.
    vec2 at = local / ${num(gap)} + 0.5;
    float inside = step(0.0, at.x) * step(at.x, 1.0) * step(0.0, at.y) * step(at.y, 1.0);
    float glint = step(0.2, sky.x) * step(0.992, hash(cell)) * step(0.7, sin(time * 2.3 + hash(cell.yx) * 40.0));
    float shown = glint > 0.5 ? 7.0 : index;
    float ink = texture2D(glyphs, vec2((shown + clamp(at.x, 0.0, 1.0)) / ${num(RAMP.length)}, clamp(at.y, 0.0, 1.0))).a * inside;
    if (glint > 0.5 || sky.y > 0.95) { colour = vec3(0.561, 0.659, 1.0); alpha = 0.62; }
    else if (sky.y > 0.86) { colour = vec3(0.247, 0.388, 1.0); alpha = 0.46; }
    else { colour = vec3(0.69, 0.714, 0.776); alpha = 0.08 + 0.26 * min(1.0, floor(light * 4.0) / 3.0); }
    alpha = ink * min(1.0, alpha + 0.4 * lift);
  }
  return vec4(colour * alpha, alpha);
}
void main() {
  vec2 px = vec2(gl_FragCoord.x, size.y * scale - gl_FragCoord.y) / scale;
  // The grid is laid as Velvet's: centred, a dot every ${gap} points.
  vec2 count = ceil(size / ${num(gap)}) + 1.0, offset = (size - (count - 1.0) * ${num(gap)}) * 0.5;
  vec2 cell = floor((px - offset) / ${num(gap)} + 0.5);
  vec4 colour = cellAt(px, cell, offset);
  // Near the pointer a cell can be pushed into its neighbour's square, so there each point looks at its neighbours too.
  if (pointer.z > 0.001 && length(px - pointer.xy) < ${num(radius + push + gap)}) {
    for (int dx = -1; dx <= 1; dx++) for (int dy = -1; dy <= 1; dy++) {
      if (dx == 0 && dy == 0) continue;
      vec4 other = cellAt(px, cell + vec2(float(dx), float(dy)), offset);
      colour = other + colour * (1.0 - other.a);
    }
  }
  gl_FragColor = colour;
}`;
}

// The ramp's characters, white, each in a square cell of a strip: the shader's glyph atlas.
function glyphStrip(documentRef: Document = document): HTMLCanvasElement {
  const size = AURORA_GRID.glyph;
  const canvas = documentRef.createElement('canvas');
  canvas.width = size * RAMP.length;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return canvas;
  context.fillStyle = '#fff';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = `${Math.round(size * 0.78)}px ui-monospace, "SF Mono", Menlo, monospace`;
  [...RAMP].forEach((ch, i) => {
    if (i > 0) context.fillText(i === 7 ? '+' : ch, (i + 0.5) * size, size * 0.54);
  });
  return canvas;
}

// The grid on a canvas, or null when there's no WebGL (Velvet's plain dot field is used then).
export function auroraGrid(canvas: HTMLCanvasElement, { now = () => performance.now() / 1000 }: AuroraGridOptions = {}): AuroraGridController | null {
  const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false, powerPreference: 'low-power' });
  if (!gl) return null;
  const webgl = gl;
  let program: WebGLProgram | null = null;
  let uniforms: Record<UniformName, WebGLUniformLocation | null> | null = null;

  function build(): void {
    const shader = (type: number, source: string): WebGLShader => {
      const s = webgl.createShader(type);
      if (!s) throw new Error('The grid’s shader didn’t compile.');
      webgl.shaderSource(s, source);
      webgl.compileShader(s);
      if (!webgl.getShaderParameter(s, webgl.COMPILE_STATUS)) throw new Error(webgl.getShaderInfoLog(s) || 'The grid’s shader didn’t compile.');
      return s;
    };
    const prog = webgl.createProgram();
    if (!prog) throw new Error('The grid’s shader didn’t link.');
    program = prog;
    webgl.attachShader(prog, shader(webgl.VERTEX_SHADER, VERTEX));
    webgl.attachShader(prog, shader(webgl.FRAGMENT_SHADER, fragmentSource()));
    webgl.linkProgram(prog);
    if (!webgl.getProgramParameter(prog, webgl.LINK_STATUS)) throw new Error(webgl.getProgramInfoLog(prog) || 'The grid’s shader didn’t link.');
    webgl.useProgram(prog);
    const buffer = webgl.createBuffer();
    webgl.bindBuffer(webgl.ARRAY_BUFFER, buffer);
    webgl.bufferData(webgl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), webgl.STATIC_DRAW);
    const at = webgl.getAttribLocation(prog, 'p');
    webgl.enableVertexAttribArray(at);
    webgl.vertexAttribPointer(at, 2, webgl.FLOAT, false, 0, 0);
    const texture = webgl.createTexture();
    webgl.bindTexture(webgl.TEXTURE_2D, texture);
    webgl.texImage2D(webgl.TEXTURE_2D, 0, webgl.RGBA, webgl.RGBA, webgl.UNSIGNED_BYTE, glyphStrip());
    webgl.texParameteri(webgl.TEXTURE_2D, webgl.TEXTURE_MIN_FILTER, webgl.LINEAR);
    webgl.texParameteri(webgl.TEXTURE_2D, webgl.TEXTURE_MAG_FILTER, webgl.LINEAR);
    webgl.texParameteri(webgl.TEXTURE_2D, webgl.TEXTURE_WRAP_S, webgl.CLAMP_TO_EDGE);
    webgl.texParameteri(webgl.TEXTURE_2D, webgl.TEXTURE_WRAP_T, webgl.CLAMP_TO_EDGE);
    const names: readonly UniformName[] = ['size', 'scale', 'time', 'pointer', 'glyphs'];
    uniforms = Object.fromEntries(names.map(name => [name, webgl.getUniformLocation(prog, name)])) as Record<UniformName, WebGLUniformLocation | null>;
    webgl.uniform1i(uniforms.glyphs, 0);
  }
  build();

  const pointer = { x: 0, y: 0, toX: 0, toY: 0, strength: 0, to: 0 };
  let mode: DotFieldMode = 'off';
  let rate = 1;
  let clock = 0;
  let last = 0;
  let shown = 0;
  let frame = 0;
  let width = 0;
  let height = 0;
  let scale = 1;
  let lost = false;

  function resize(): void {
    const box = canvas.getBoundingClientRect();
    width = box.width;
    height = box.height;
    scale = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    if (mode !== 'off') draw();
  }

  function draw(): void {
    if (lost || !width || !uniforms) return;
    webgl.viewport(0, 0, canvas.width, canvas.height);
    webgl.uniform2f(uniforms.size, width, height);
    webgl.uniform1f(uniforms.scale, scale);
    webgl.uniform1f(uniforms.time, clock);
    webgl.uniform3f(uniforms.pointer, pointer.x, pointer.y, mode === 'live' ? pointer.strength : 0);
    webgl.clearColor(0, 0, 0, 0);
    webgl.clear(webgl.COLOR_BUFFER_BIT);
    webgl.drawArrays(webgl.TRIANGLES, 0, 3);
  }

  function tick(): void {
    frame = 0;
    if (mode !== 'live') return;
    const at = now();
    // The sky's clock runs at the frame rate's pace, never jumping after a pause.
    clock += Math.min(0.1, at - last) * rate;
    last = at;
    pointer.x += (pointer.toX - pointer.x) * 0.16;
    pointer.y += (pointer.toY - pointer.y) * 0.16;
    pointer.strength += (pointer.to - pointer.strength) * 0.12;
    if (at - shown >= 1 / AURORA_GRID.fps - 0.004) { shown = at; draw(); }
    frame = requestAnimationFrame(tick);
  }

  const resizes = new ResizeObserver(resize);
  resizes.observe(canvas);
  window.addEventListener('pointermove', event => {
    if (mode !== 'live') return;
    const box = canvas.getBoundingClientRect();
    pointer.toX = event.clientX - box.left;
    pointer.toY = event.clientY - box.top;
    if (pointer.strength < 0.01) { pointer.x = pointer.toX; pointer.y = pointer.toY; }
    pointer.to = 1;
  }, { passive: true });
  const away = (): void => { pointer.to = 0; };
  document.documentElement.addEventListener('mouseleave', away);
  window.addEventListener('blur', away);
  // After the GPU process restarts the context comes back empty: build again and carry on.
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); lost = true; }, false);
  canvas.addEventListener('webglcontextrestored', () => { lost = false; try { build(); draw(); } catch {} }, false);

  return {
    set(next: DotFieldMode): void {
      if (next === mode) return;
      mode = next;
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      if (mode === 'off') { webgl.clearColor(0, 0, 0, 0); webgl.clear(webgl.COLOR_BUFFER_BIT); return; }
      if (!width) resize();
      if (mode !== 'live') { pointer.strength = 0; pointer.to = 0; draw(); return; }
      last = now();
      frame = requestAnimationFrame(tick);
    },
    speed(n: number): void { rate = Number.isFinite(n) && n > 0 ? n : 1; },
    get mode(): DotFieldMode { return mode; },
  };
}
