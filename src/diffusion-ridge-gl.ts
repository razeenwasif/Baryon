// Diffusion's ridge background on the GPU (WebGL2): the same land, views and look as the canvas renderer in
// src/diffusion-ridge.js, drawn for a few percent of what the canvas costs, so it can run at 30 frames a second.
//
//   1. Heights: one fragment per grid point (150 × 96) works out the land's height there and at its four neighbours,
//      with the same gradient noise and permutation table as the canvas version (so the same land), and keeps
//      height, light, warmth and crest in a small float texture.
//   2. Ground: filled with the ground colour, writing depth, so a nearer row hides what's behind it. This stands in
//      for the canvas's back-to-front skirts (each row's line down to the bottom): a row's lines sit just in front of
//      its own ground and behind every nearer row's, exactly what painting back to front gave, at about one layer.
//   3. Contours: each band of cells between two rows is drawn once, and its pixels find the nearest contour level
//      from the interpolated height, smoothed over one pixel with fwidth, so the lines keep their widths at any slope.
//   4. Slope ribs and the dashed survey lines: each row is a strip of quads with mitred joins, its width and colour
//      flat for each segment as the canvas draws them, smoothed at its edges.
//   5. Registration crosses and the small survey squares: point sprites.
// Everything after the ground blends without writing depth, rows back to front. The window's drawing buffer is
// multisampled, so the edges of the ground are smooth too.

export interface RidgeGridSizes {
  NX: number;
  NZ: number;
  LEVELS: number;
}

export interface RidgeShaderSources {
  height: [string, string];
  skirt: [string, string];
  contour: [string, string];
  line: [string, string];
  point: [string, string];
}

export interface RidgePalette {
  ground: string;
  plate: string;
  paleMinor: readonly number[];
  paleMajor: readonly number[];
  greenMinor: readonly number[];
  greenMajor: readonly number[];
  ribDim: readonly number[];
  ribBright: readonly number[];
  ribGreen: readonly number[];
  ribGreenPeak: readonly number[];
  mark: readonly number[];
  markGreen: readonly number[];
}

export interface CreateRidgeGLOptions extends RidgeGridSizes {
  perm: Uint8Array;
  palette: RidgePalette;
}

export interface RidgeDrawCamera {
  yaw?: number;
  pitch?: number;
  light?: number;
}

export interface RidgeDrawOptions {
  width: number;
  height: number;
  scale: number;
  t: number;
  mode?: number;
  ribs?: boolean;
  cam?: RidgeDrawCamera;
}

export interface RidgeGLRenderer {
  gl: WebGL2RenderingContext;
  draw(options: RidgeDrawOptions): boolean;
  lost(): boolean;
}

interface ProgramEntry {
  program: WebGLProgram;
  u: (key: string) => WebGLUniformLocation | null;
}

interface RidgeGLResources {
  programs: Record<keyof RidgeShaderSources, ProgramEntry>;
  vaos: {
    full: WebGLVertexArrayObject | null;
    strip: WebGLVertexArrayObject | null;
    points: WebGLVertexArrayObject | null;
  };
  permTex: WebGLTexture | null;
  dataTex: WebGLTexture | null;
  fbo: WebGLFramebuffer | null;
}

const COMMON = ({ NX, NZ, LEVELS }: RidgeGridSizes): string => `#version 300 es
precision highp float; precision highp int; precision highp sampler2D; precision highp usampler2D;
const int NX = ${NX}, NZ = ${NZ}, LEVELS = ${LEVELS};
uniform usampler2D u_perm;
uniform sampler2D u_data;
uniform float u_t, u_light, u_dpr, u_relief, u_horizon, u_span, u_fov, u_pMin, u_pRange, u_pitch;
uniform int u_mode, u_kind;
uniform vec2 u_drift, u_rot, u_size;
uniform vec3 u_ground;
uniform vec3 u_c[10];   // pale minor, pale major, green minor, green major, rib dim, rib bright, rib green, rib green peak, mark, mark green

uint P(int i) { return texelFetch(u_perm, ivec2(i, 0), 0).r; }
float grad(uint h, vec2 d) { float a = float(h) * (6.28318530718 / 256.0); return cos(a) * d.x + sin(a) * d.y; }
float noise(vec2 p) {
  vec2 i0 = floor(p), f = p - i0;
  int X = int(mod(i0.x, 256.0)), Y = int(mod(i0.y, 256.0));
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  int pX = int(P(X)), pX1 = int(P(X + 1));
  float d00 = grad(P(pX + Y), f), d10 = grad(P(pX1 + Y), f - vec2(1.0, 0.0));
  float d01 = grad(P(pX + Y + 1), f - vec2(0.0, 1.0)), d11 = grad(P(pX1 + Y + 1), f - vec2(1.0, 1.0));
  return mix(mix(d00, d10, u.x), mix(d01, d11, u.x), u.y);
}
float depthOf(int j) { return float(j) / float(NZ - 1); }
float perspOf(float depth) { return u_fov / (u_fov + depth * 1.85); }
vec2 world(int i, int j) {
  float wzBase = (depthOf(j) * 2.8 - 1.0) * 1.65 + u_drift.y;
  float wxBase = (float(i) / float(NX - 1) * 2.0 - 1.0) * 2.85 + u_drift.x;
  return vec2(wxBase * u_rot.x - wzBase * u_rot.y, wxBase * u_rot.y + wzBase * u_rot.x);
}
float elevation(vec2 w) {
  float wx = w.x, wz = w.y, t = u_t;
  if (u_mode == 3) {
    float s1 = sin(wx * 1.35 + t * 0.35) * cos(wz * 1.25 - t * 0.28);
    float s2 = 0.55 * cos((wx - wz) * 1.95 - t * 0.42);
    float n1 = noise(vec2(wx * 1.1 + s1 * 0.35, wz * 1.1 + s2 * 0.35)), n2 = 0.45 * noise(vec2(wx * 2.2, wz * 2.2));
    return clamp(0.48 + 0.30 * s1 + 0.26 * n1 + 0.14 * n2, 0.02, 0.98);
  }
  float px = wx + noise(vec2(wx * 0.65, wz * 0.65)) * 0.52, pz = wz + noise(vec2(wx * 0.65 + 17.3, wz * 0.65 + 31.7)) * 0.52;
  float n1 = noise(vec2(px * 0.80, pz * 0.80)), r1 = 1.0 - abs(n1);
  float n2 = noise(vec2(px * 1.75 + 9.2, pz * 1.75 - 4.1)), r2 = 1.0 - abs(n2);
  float n3 = noise(vec2(px * 3.4 + 12.1, pz * 3.4 + 21.4));
  float mixv = u_mode == 1 ? 0.32 : u_mode == 2 ? 0.82 : 0.65;
  float smoothH = 0.48 + 0.42 * n1 + 0.22 * n2 + 0.08 * n3;
  float ridged = 0.50 * r1 * r1 + 0.30 * r2 * r2 + 0.14 * (0.5 + 0.5 * n1) + 0.06 * n3;
  return clamp(smoothH * (1.0 - mixv) + ridged * mixv + 0.04 * sin(wx * 0.9 + t * 0.6) * cos(wz * 0.9 - t * 0.4), 0.02, 0.98);
}
vec4 dataAt(int i, int j) { return texelFetch(u_data, ivec2(clamp(i, 0, NX - 1), clamp(j, 0, NZ - 1)), 0); }
// Where a grid point is on screen, in css pixels, as the canvas projects it.
vec2 screen(int i, int j, float h) {
  float depth = depthOf(j), p = perspOf(depth), pN = (p - u_pMin) / u_pRange;
  float baseY = u_horizon + pN * u_span + u_pitch * 85.0 * (depth - 0.5), halfX = u_size.x * 0.64 * (0.58 + 0.58 * p);
  return vec2(u_size.x * 0.5 + (float(i) / float(NX - 1) * 2.0 - 1.0) * halfX, baseY - h * u_relief * p);
}
vec4 clipAt(vec2 s, float z) { vec2 c = s / u_size * 2.0 - 1.0; return vec4(c.x, -c.y, z * 2.0 - 1.0, 1.0); }
// Each row's depth: its skirt at rowZ, its lines just in front of it and behind every nearer row's skirt.
float rowZ(int j) { return (float(j) + 1.0) / float(NZ + 1); }
float lineZ(int j) { return rowZ(j) - 0.5 / float(NZ + 1); }
`;

const HEIGHT_VS = `in vec2 a_vert; void main() { gl_Position = vec4(a_vert, 0.0, 1.0); }`;
const HEIGHT_FS = `out vec4 o;
void main() {
  int i = int(gl_FragCoord.x), j = int(gl_FragCoord.y);
  float h = elevation(world(i, j));
  float hL = i > 0 ? elevation(world(i - 1, j)) : h, hR = i < NX - 1 ? elevation(world(i + 1, j)) : h;
  float hD = j > 0 ? elevation(world(i, j - 1)) : h, hU = j < NZ - 1 ? elevation(world(i, j + 1)) : h;
  float dx = (hR - hL) * 26.0, dz = (hU - hD) * 26.0, depth = depthOf(j), ux = float(i) / float(NX - 1) * 2.0 - 1.0;
  float crest = clamp((h * 4.0 - (hL + hR + hD + hU)) * 42.0 * 1.35 + max(0.0, h - 0.52) * 0.65, 0.0, 1.0);
  float a = ux - 0.15 + depth * 0.35, b = depth - 0.25, c = ux + 0.65, d = depth - 0.50;
  float zone1 = exp(-a * a * 2.4 - b * b * 5.5), zone2 = exp(-c * c * 3.8 - d * d * 7.0);
  float warm = min(1.0, (zone1 * 1.25 + zone2 * 1.05) * (0.45 + 0.55 * max(0.0, -dx * 0.50 - dz * 0.40 + 0.38)));
  float key = max(0.0, -dx * (0.60 + u_light * 0.3) - dz * 0.45 + 0.36);
  float shade = u_mode == 1 ? 0.62 + 0.38 * key : min(1.0, max(0.05, pow(max(key, 1e-6), 1.15) * 1.2 + crest * 0.45));
  o = vec4(h, shade * (1.0 - pow(depth, 2.4) * 0.70), warm, crest);
}`;

// The ground, without filling every row's skirt to the bottom (95 layers of overdraw): instance 0 is the nearest row's
// skirt; instance k is the band between rows k - 1 and k, at row k's depth. Wherever a pixel is, the nearest of these
// covering it has the depth of the nearest row whose line is above it, which is what the skirts gave.
const SKIRT_VS = `in vec2 a_vert;
void main() {
  int i = int(a_vert.x), k = gl_InstanceID;
  vec2 s;
  if (k == 0) { s = screen(i, 0, dataAt(i, 0).x); if (a_vert.y > 0.5) s.y = u_size.y + 40.0; }
  else { int j = a_vert.y > 0.5 ? k - 1 : k; s = screen(i, j, dataAt(i, j).x); }
  gl_Position = clipAt(s, rowZ(k));
}`;
const SKIRT_FS = `out vec4 o; void main() { o = vec4(u_ground, 1.0); }`;

const CONTOUR_VS = `in vec2 a_vert;
out float v_h, v_lit, v_warm; flat out float v_persp, v_rowLit;
void main() {
  int i = int(a_vert.x), j = (NZ - 2) - gl_InstanceID, jj = j + int(a_vert.y);
  vec4 d = dataAt(i, jj), near = dataAt(i, j);
  v_h = d.x; v_lit = near.y; v_warm = near.z;
  float depth = depthOf(j); v_persp = perspOf(depth); v_rowLit = 0.80 * (1.0 - pow(depth, 2.2) * 0.68);
  gl_Position = clipAt(screen(i, jj, d.x), lineZ(j));
}`;
const CONTOUR_FS = `in float v_h, v_lit, v_warm; flat in float v_persp, v_rowLit; out vec4 o;
void main() {
  float x = v_h * float(LEVELS), fw = max(fwidth(x), 1e-5), m = floor(x + 0.5);
  if (v_lit < 0.14 || m < 1.0 || m > float(LEVELS - 1)) discard;
  bool major = mod(m, 4.0) < 0.5, green = v_warm > 0.28;
  float p = v_persp, w, a; vec3 c;
  if (green) { if (major) { c = u_c[3]; a = 0.96; w = max(1.2, 2.5 * p); } else { c = u_c[2]; a = 0.65; w = max(0.65, 1.05 * p); } }
  else { if (major) { c = u_c[1]; a = 0.92; w = max(1.1, 2.2 * p); } else { c = u_c[0]; a = 0.45; w = max(0.55, 0.90 * p); } }
  float cover = clamp(w * u_dpr * 0.5 + 0.5 - abs(x - m) / fw, 0.0, 1.0);
  if (cover <= 0.0) discard;
  o = vec4(c, cover * a * v_rowLit);
}`;

// Slope ribs (u_kind 0) and dashed survey lines (u_kind 1). A strip's triangles take flat values from their last
// vertex, so vertex i carries segment i - 1's colour and width: each segment is coloured exactly as the canvas draws it.
const LINE_VS = `in vec2 a_vert;
out float v_dist; flat out vec4 v_col; flat out float v_half;
void category(int k, int j, out vec3 col, out float alpha, out float width) {
  col = vec3(0.0); alpha = 0.0; width = 0.0;
  if (k < 0 || k > NX - 2) return;
  vec4 d = dataAt(k, j); float lit = d.y, warm = d.z, ridge = d.w, depth = depthOf(j), p = perspOf(depth);
  if (u_kind == 0) {
    if (lit < 0.16) return;
    float fade = 1.0 - pow(depth, 2.3) * 0.72;
    if (warm > 0.34) { if (ridge > 0.42 || lit > 0.68) { col = u_c[7]; alpha = 0.95 * fade; width = max(1.1, 2.25 * p); } else { col = u_c[6]; alpha = 0.58 * fade; width = max(0.7, 1.15 * p); } }
    else { if (ridge > 0.45 || lit > 0.70) { col = u_c[5]; alpha = 0.88 * fade; width = max(0.95, 1.85 * p); } else { col = u_c[4]; alpha = 0.36 * fade; width = max(0.55, 0.85 * p); } }
  } else {
    vec2 w = world(k, j);
    if (lit < 0.22 || mod(w.y, 1.4) >= 0.055 || mod(floor(w.x * 6.0), 2.0) > 0.5) return;
    col = u_c[8]; alpha = 0.42 * lit; width = max(0.65, 0.95 * p);
  }
}
void main() {
  int i = int(a_vert.x), j = (NZ - 2) - gl_InstanceID; float side = a_vert.y * 2.0 - 1.0;
  vec3 cPrev, cNext; float aPrev, aNext, wPrev, wNext;
  category(i - 1, j, cPrev, aPrev, wPrev); category(i, j, cNext, aNext, wNext);
  v_col = vec4(cPrev, aPrev); v_half = wPrev * 0.5 * u_dpr;
  // Where neither neighbouring segment is drawn, the strip collapses to nothing (no pixels to shade).
  float halfW = aPrev <= 0.0 && aNext <= 0.0 ? 0.0 : max(wPrev, wNext) * 0.5 * u_dpr + 1.0;
  vec2 s = screen(i, j, dataAt(i, j).x) * u_dpr;
  vec2 sp = i > 0 ? screen(i - 1, j, dataAt(i - 1, j).x) * u_dpr : s;
  vec2 sn = i < NX - 1 ? screen(i + 1, j, dataAt(i + 1, j).x) * u_dpr : s;
  vec2 dNext = i < NX - 1 ? normalize(sn - s) : normalize(s - sp);
  vec2 dPrev = i > 0 ? normalize(s - sp) : dNext;
  vec2 tangent = normalize(dPrev + dNext), normal = vec2(-tangent.y, tangent.x);
  float miter = 1.0 / max(dot(normal, vec2(-dNext.y, dNext.x)), 0.5);
  v_dist = side * halfW;
  gl_Position = clipAt((s + normal * side * halfW * miter) / u_dpr, lineZ(j));
}`;
const LINE_FS = `in float v_dist; flat in vec4 v_col; flat in float v_half; out vec4 o;
void main() {
  float cover = clamp(v_half + 0.5 - abs(v_dist), 0.0, 1.0);
  if (v_col.a <= 0.0 || cover <= 0.0) discard;
  o = vec4(v_col.rgb, v_col.a * cover);
}`;

// Registration crosses (u_kind 0) and survey squares (u_kind 1), one point per grid point, as the canvas marks them.
const POINT_VS = `in vec2 a_vert;
flat out vec4 v_col; flat out float v_size, v_lw; flat out vec2 v_dims;
void main() {
  int id = gl_VertexID, i = id % (NX - 1), j = (NZ - 2) - id / (NX - 1);
  vec4 d = dataAt(i, j); float lit = d.y, p = perspOf(depthOf(j)); vec2 w = world(i, j);
  v_col = vec4(0.0); v_size = 0.0; v_lw = 0.0; v_dims = vec2(0.0);
  gl_PointSize = 1.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  if (lit < 0.22) return;
  if (u_kind == 0) {
    vec2 f = fract(w * 1.15);
    if (!(f.x > 0.46 && f.x < 0.54 && f.y > 0.45 && f.y < 0.55)) return;
    float arm = max(3.0, 5.5 * p);
    v_dims = vec2(arm, arm * 0.65) * u_dpr; v_lw = max(0.8, 1.1 * p) * u_dpr; v_col = vec4(u_c[8], 0.58 * lit);
    v_size = (2.0 * arm + 2.0) * u_dpr;
  } else {
    vec2 m = floor(w * 4.5), f = w * 4.5 - m;
    uint hash = P(int(mod(m.x * 17.0 + m.y * 31.0, 256.0)));
    if (!(hash > 249u && f.x < 0.25 && f.y < 0.28)) return;
    bool big = hash == 255u;
    v_dims = vec2(big ? 6.0 : 3.0, big ? 3.8 : 2.2) * p * u_dpr * 0.5;
    v_col = d.z > 0.35 ? vec4(u_c[9], 0.55 * lit) : vec4(u_c[8], 0.45 * lit);
    v_size = max(v_dims.x, v_dims.y) * 2.0 + 2.0;
  }
  gl_PointSize = v_size;
  gl_Position = clipAt(screen(i, j, d.x), lineZ(j));
}`;
const POINT_FS = `flat in vec4 v_col; flat in float v_size, v_lw; flat in vec2 v_dims; out vec4 o;
void main() {
  vec2 q = (gl_PointCoord - 0.5) * v_size;
  float cover;
  if (u_kind == 0) {
    float across = min(clamp(v_dims.x + 0.5 - abs(q.x), 0.0, 1.0), clamp(v_lw * 0.5 + 0.5 - abs(q.y), 0.0, 1.0));
    float down = min(clamp(v_dims.y + 0.5 - abs(q.y), 0.0, 1.0), clamp(v_lw * 0.5 + 0.5 - abs(q.x), 0.0, 1.0));
    cover = max(across, down);
  } else cover = min(clamp(v_dims.x + 0.5 - abs(q.x), 0.0, 1.0), clamp(v_dims.y + 0.5 - abs(q.y), 0.0, 1.0));
  if (v_col.a <= 0.0 || cover <= 0.0) discard;
  o = vec4(v_col.rgb, v_col.a * cover);
}`;

export function ridgeShaderSources(sizes: RidgeGridSizes): RidgeShaderSources {
  const common = COMMON(sizes);
  return {
    height: [common + HEIGHT_VS, common + HEIGHT_FS], skirt: [common + SKIRT_VS, common + SKIRT_FS],
    contour: [common + CONTOUR_VS, common + CONTOUR_FS], line: [common + LINE_VS, common + LINE_FS], point: [common + POINT_VS, common + POINT_FS],
  };
}

// Whether this machine can draw it: WebGL2 with float render targets. Tried on a throwaway canvas, since a canvas
// that has given out a WebGL context can't give a 2D one afterwards.
export function ridgeGLSupported(): boolean {
  try {
    const probe = document.createElement('canvas').getContext('webgl2');
    if (!probe) return false;
    const ok = Boolean(probe.getExtension('EXT_color_buffer_float'));
    probe.getExtension('WEBGL_lose_context')?.loseContext();
    return ok;
  } catch { return false; }
}

const PALETTE_ORDER = ['paleMinor', 'paleMajor', 'greenMinor', 'greenMajor', 'ribDim', 'ribBright', 'ribGreen', 'ribGreenPeak', 'mark', 'markGreen'] as const;
const hexRGB = (hex: string): number[] => [1, 3, 5].map(k => parseInt(hex.slice(k, k + 2), 16) / 255);

// The renderer on a canvas; throws if anything won't build (the caller then falls back to the canvas renderer).
export function createRidgeGL(canvas: HTMLCanvasElement, { NX, NZ, LEVELS, perm, palette }: CreateRidgeGLOptions): RidgeGLRenderer {
  const ctx = canvas.getContext('webgl2', { alpha: false, antialias: true, depth: true, stencil: false, premultipliedAlpha: false, powerPreference: 'low-power', preserveDrawingBuffer: false });
  if (!ctx) throw new Error('No WebGL2 here.');
  const gl = ctx;
  const sources = ridgeShaderSources({ NX, NZ, LEVELS });
  const colours = new Float32Array(PALETTE_ORDER.flatMap(name => palette[name].map(v => v / 255)));
  let res: RidgeGLResources | null = null;

  function build(): void {
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('No float render targets here.');
    const compile = (type: number, source: string): WebGLShader => {
      const shader = gl.createShader(type)!; gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(`Diffusion's background didn't compile: ${gl.getShaderInfoLog(shader)}`);
      return shader;
    };
    const programs = {} as Record<keyof RidgeShaderSources, ProgramEntry>;
    for (const [name, [vs, fs]] of Object.entries(sources) as Array<[keyof RidgeShaderSources, [string, string]]>) {
      const program = gl.createProgram()!;
      gl.attachShader(program, compile(gl.VERTEX_SHADER, vs)); gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fs));
      gl.bindAttribLocation(program, 0, 'a_vert'); gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(`Diffusion's background didn't link: ${gl.getProgramInfoLog(program)}`);
      const at = new Map<string, WebGLUniformLocation | null>();
      programs[name] = { program, u: key => { if (!at.has(key)) at.set(key, gl.getUniformLocation(program, key)); return at.get(key) ?? null; } };
    }
    const buffer = (data: Float32Array): WebGLBuffer | null => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); return b; };
    const vao = (b: WebGLBuffer | null): WebGLVertexArrayObject | null => { const v = gl.createVertexArray(); gl.bindVertexArray(v); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.bindVertexArray(null); return v; };
    const strip = new Float32Array(NX * 4);
    for (let i = 0; i < NX; i++) strip.set([i, 0, i, 1], i * 4);
    const vaos = {
      full: vao(buffer(new Float32Array([-1, -1, 3, -1, -1, 3]))),
      strip: vao(buffer(strip)),
      points: vao(buffer(new Float32Array((NX - 1) * (NZ - 1) * 2))),
    };
    // The permutation table the canvas's noise uses, so the land is the same.
    const permTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, permTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, 512, 1, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, perm);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST]] as const) gl.texParameteri(gl.TEXTURE_2D, k, v);
    const dataTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, dataTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, NX, NZ, 0, gl.RGBA, gl.FLOAT, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]] as const) gl.texParameteri(gl.TEXTURE_2D, k, v);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dataTex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Float render target incomplete.');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    res = { programs, vaos, permTex, dataTex, fbo };
  }
  build();

  let lost = false;
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); lost = true; res = null; });
  canvas.addEventListener('webglcontextrestored', () => { lost = false; try { build(); } catch { res = null; } });

  function draw({ width, height, scale, t, mode = 0, ribs = true, cam = { yaw: 0, pitch: 0, light: 0 } }: RidgeDrawOptions): boolean {
    if (lost || !res || gl.isContextLost()) return false;
    const { programs, vaos, fbo } = res;
    const high = mode === 1, P = palette;
    const ground = hexRGB(high ? P.plate : P.ground);
    const relief = high ? height * 0.20 : mode === 2 ? height * 0.48 : height * 0.42;
    const horizon = high ? height * 0.10 : height * 0.28, bottom = high ? height * 1.05 : height * 1.08;
    const fov = high ? 2.1 : 1.55, pMin = fov / (fov + 1.85);
    const set = ({ program, u }: ProgramEntry): void => {
      gl.useProgram(program);
      gl.uniform1i(u('u_data'), 0); gl.uniform1i(u('u_perm'), 1);
      gl.uniform1f(u('u_t'), t); gl.uniform1i(u('u_mode'), mode); gl.uniform1f(u('u_light'), cam.light || 0);
      gl.uniform2f(u('u_drift'), t * 0.42, t * 0.28); gl.uniform2f(u('u_rot'), Math.cos((cam.yaw || 0) * 0.5), Math.sin((cam.yaw || 0) * 0.5));
      gl.uniform2f(u('u_size'), width, height); gl.uniform1f(u('u_dpr'), scale);
      gl.uniform1f(u('u_relief'), relief); gl.uniform1f(u('u_horizon'), horizon); gl.uniform1f(u('u_span'), bottom - horizon);
      gl.uniform1f(u('u_fov'), fov); gl.uniform1f(u('u_pMin'), pMin); gl.uniform1f(u('u_pRange'), 1 - pMin); gl.uniform1f(u('u_pitch'), cam.pitch || 0);
      gl.uniform3fv(u('u_ground'), ground); gl.uniform3fv(u('u_c'), colours);
    };
    // 1. Heights, light, warmth and crests into the small float texture.
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, NX, NZ);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, null);
    set(programs.height); gl.bindVertexArray(vaos.full); gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, res.dataTex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, res.permTex);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(ground[0], ground[1], ground[2], 1); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // 2. The ground, nearest row first, writing depth.
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.depthMask(true);
    set(programs.skirt); gl.bindVertexArray(vaos.strip); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, NX * 2, NZ - 1);
    // 3–5. Lines and marks over it, back to front, tested against the ground but not hiding one another.
    gl.depthMask(false); gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (mode !== 2) { set(programs.contour); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, NX * 2, NZ - 1); }
    set(programs.line);
    if (ribs && mode !== 1) { gl.uniform1i(programs.line.u('u_kind'), 0); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, NX * 2, NZ - 1); }
    gl.uniform1i(programs.line.u('u_kind'), 1); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, NX * 2, NZ - 1);
    set(programs.point); gl.bindVertexArray(vaos.points);
    for (const kind of [0, 1]) { gl.uniform1i(programs.point.u('u_kind'), kind); gl.drawArrays(gl.POINTS, 0, (NX - 1) * (NZ - 1)); }
    gl.bindVertexArray(null); gl.depthMask(true);
    return true;
  }
  return { gl, draw, lost: () => lost || gl.isContextLost() };
}
