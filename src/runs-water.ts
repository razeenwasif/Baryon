// Runs' background: the Zen Pool, a calm pool of water drawn in fine ASCII, ported from the user's own
// zen_pool_ascii.html. A camera looks down at the water at an angle; drops strike it now and then and spread rings (a
// main wavefront, a trailing train and fine capillary ripples), the surface shows by what it reflects of two softboxes
// and a warm rim light, and each character cell becomes a glyph and a shade from that. Three ways to draw it: Ripple
// (glyphs that follow the slope of the waves), Density (a plain luminance ramp) and Splash (a drop falling at the
// centre, its splash column and droplet, again and again); four themes. Moving the pointer leaves a light wake and
// sways the camera; a click drops one.
// WebGL2 in two passes: the water and the glyph for each cell into a small texture (about 40,000 cells, not every
// pixel), then the glyphs drawn from an atlas. 30 frames a second, only while Runs is shown and the window is
// visible; a still frame for reduced motion.

export type PoolModeId = 'ripple' | 'density' | 'splash';
export type PoolThemeId = 'obsidian' | 'steel' | 'jade' | 'bone';
export type RGB = readonly [number, number, number];

export interface PoolModeInfo {
  id: PoolModeId;
  name: string;
  title: string;
}

export interface PoolThemeInfo {
  id: PoolThemeId;
  name: string;
  cool: readonly RGB[];
  rim: RGB;
}

export interface RunsWaterOptions {
  mode?: string;
  theme?: string;
  fps?: number;
  seed?: number;
  reduced?: boolean;
}

export interface RunsWaterController {
  start: () => void;
  stop: () => void;
  pointer: (clientX: number, clientY: number) => void;
  dropAt: (clientX: number, clientY: number) => boolean;
  mode: () => PoolModeId;
  setMode: (id: string) => void;
  theme: () => PoolThemeId;
  setTheme: (id: string) => void;
  renderer: () => 'webgl2';
  cells: () => { cols: number; rows: number };
  tick: (dt?: number) => void;
  destroy: () => void;
}

export const MODES: readonly PoolModeInfo[] = Object.freeze([
  { id: 'ripple', name: 'Ripple', title: 'Directional ripple: glyphs follow the slope of the waves' },
  { id: 'density', name: 'Density', title: 'Density: a plain luminance ramp, dots to @' },
  { id: 'splash', name: 'Splash', title: 'Drop and splash: a drop falls at the centre, its splash column and droplet' },
]);
export const THEMES: readonly PoolThemeInfo[] = Object.freeze([
  { id: 'obsidian', name: 'Obsidian Silver', cool: [[14, 30, 42], [48, 86, 112], [116, 158, 184], [205, 224, 238], [248, 251, 255]], rim: [215, 116, 62] },
  { id: 'steel', name: 'Midnight Steel', cool: [[10, 26, 48], [36, 82, 132], [86, 152, 206], [168, 212, 242], [232, 246, 255]], rim: [120, 190, 235] },
  { id: 'jade', name: 'Phosphor Jade', cool: [[6, 38, 26], [18, 96, 64], [42, 168, 114], [115, 228, 174], [218, 255, 236]], rim: [148, 242, 186] },
  { id: 'bone', name: 'Monochrome Bone', cool: [[34, 36, 40], [88, 92, 98], [148, 154, 162], [212, 216, 222], [252, 252, 254]], rim: [228, 230, 235] },
]);
export const GLYPHS = Object.freeze([' ', '.', ':', '-', '~', '/', '\\', '=', '+', '*', 'o', 'O', '#', '@', '|', '°'] as const);
export const SHADES = 20; // 16 cool, 4 warm rim
export const CELL = Object.freeze({ w: 4.5, h: 7.2 } as const); // points, the original's Ultra-Fine grain
export const DROPS = 16;
const TILE = { w: 24, h: 38 }, ATLAS = { w: 512, h: 1024 };

export const modeIndex = (id: string): number => Math.max(0, MODES.findIndex(m => m.id === id));
export const themeIndex = (id: string): number => Math.max(0, THEMES.findIndex(t => t.id === id));

// A shade's colour: 0–15 along the theme's cool stops, 16–19 its warm rim, brighter as they go.
export function shadeColour(theme: PoolThemeInfo, index: number): [number, number, number] {
  if (index >= 16) {
    const k = (index - 15) / 4;
    return [
      Math.round(theme.rim[0] * (0.55 + 0.45 * k)),
      Math.round(theme.rim[1] * (0.55 + 0.45 * k)),
      Math.round(theme.rim[2] * (0.55 + 0.45 * k)),
    ];
  }
  const scaled = (index / 15) * (theme.cool.length - 1), i = Math.min(theme.cool.length - 2, Math.floor(scaled)), f = scaled - i;
  return [
    Math.round(theme.cool[i][0] + (theme.cool[i + 1][0] - theme.cool[i][0]) * f),
    Math.round(theme.cool[i][1] + (theme.cool[i + 1][1] - theme.cool[i][1]) * f),
    Math.round(theme.cool[i][2] + (theme.cool[i + 1][2] - theme.cool[i][2]) * f),
  ];
}

// The camera, as the original places it: swayed by the pointer (cam in -1..1 scaled), looking at the pool's centre.
export function camera(cam: { x: number; y: number } = { x: 0, y: 0 }): { ro: number[]; ww: number[]; uu: number[]; vv: number[] } {
  const ro = [cam.x * 0.45, 1.38 + cam.y * 0.22, 2.85], ta = [0, -0.04, 0];
  const norm = (v: number[]): number[] => { const l = Math.hypot(...v) || 1; return v.map(n => n / l); };
  const cross = (a: number[], b: number[]): number[] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const ww = norm(ta.map((n, i) => n - ro[i])), uu = norm(cross(ww, [0, 1, 0])), vv = cross(uu, ww);
  return { ro, ww, uu, vv };
}
// A point of the panel (in points from its top left) on the water: [x, z], or null over the horizon.
export function toWater(sx: number, sy: number, w: number, h: number, cam?: { x: number; y: number }): [number, number] | null {
  const { ro, ww, uu, vv } = camera(cam), u = (sx - w / 2) / h, v = (h / 2 - sy) / h;
  const d = [0, 1, 2].map(i => u * uu[i] + v * vv[i] + 1.5 * ww[i]), l = Math.hypot(...d), rd = d.map(n => n / l);
  if (rd[1] >= -0.025) return null;
  const t = Math.min(8, -ro[1] / rd[1]);
  return [ro[0] + rd[0] * t, ro[2] + rd[2] * t];
}

const WATER = `
uniform vec2 uRes;
uniform vec2 uCellSize;
uniform float uTime;
uniform int uMode;
uniform vec2 uCam;
uniform float uHeroDropT;
uniform vec4 uDrops[${DROPS}];

vec2 evalWaterGrad(vec2 p, float t) {
  vec2 grad = vec2(0.0);
  grad.x += 0.011 * cos(p.x * 1.6 + t * 0.35) * sin(p.y * 1.4 - t * 0.28);
  grad.y += 0.011 * sin(p.x * 1.6 + t * 0.35) * cos(p.y * 1.4 - t * 0.28);
  for (int i = 0; i < ${DROPS}; i++) {
    vec4 d = uDrops[i];
    if (d.w > 0.001) {
      float tau = t - d.z;
      if (tau > 0.0 && tau < 7.8) {
        vec2 delta = p - d.xy;
        float r = length(delta) + 1e-5;
        float atten = d.w * exp(-tau * 0.35) / (1.0 + r * 0.58);
        float dMain = r - 0.92 * tau;
        float envMain = exp(-dMain * dMain * (1.45 / (0.36 + tau * 0.30)));
        float dWaveMain = -12.0 * sin(dMain * 12.0 - tau * 2.2) * envMain;
        float dTrail = r - 0.54 * tau;
        float envTrail = exp(-dTrail * dTrail * 1.35) * smoothstep(0.12, 0.6, tau);
        float dWaveTrail = -0.54 * 17.5 * sin(r * 17.5 - tau * 7.8) * envTrail;
        float dCap = r - 1.18 * tau;
        float envCap = exp(-dCap * dCap * 2.5) + 0.45 * exp(-(r - 0.72 * tau) * (r - 0.72 * tau) * 3.2);
        float dWaveCap = -0.28 * 38.0 * sin(r * 38.0 - tau * 14.5) * envCap;
        grad += atten * (dWaveMain + dWaveTrail + dWaveCap) * (delta / r);
      }
    }
  }
  return grad;
}`;

export const poolShaderSources = {
  vertex: `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`,
  // Pass one: one fragment per cell, its glyph and shade (as the original works them out for the cell's centre).
  cells: `#version 300 es
precision highp float;
${WATER}
out vec4 outCell;
void main() {
  vec2 cellIdx = floor(gl_FragCoord.xy);
  vec2 cellCenterPx = (cellIdx + 0.5) * uCellSize;
  vec2 uv = (cellCenterPx - 0.5 * uRes) / uRes.y;
  vec3 ro = vec3(uCam.x * 0.45, 1.38 + uCam.y * 0.22, 2.85);
  vec3 ta = vec3(0.0, -0.04, 0.0);
  vec3 ww = normalize(ta - ro);
  vec3 uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0)));
  vec3 vv = cross(uu, ww);
  vec3 rd = normalize(uv.x * uu + uv.y * vv + 1.50 * ww);
  float gIdx = 0.0, sIdx = 0.0;
  if (rd.y < -0.025) {
    float tHit = -ro.y / rd.y;
    if (tHit < 12.0) {
      vec2 wp = ro.xz + rd.xz * tHit;
      float vignette = 0.08 + 0.92 * exp(-dot(wp, wp) * 0.16);
      vec2 grad = evalWaterGrad(wp, uTime);
      vec3 n = normalize(vec3(-grad.x, 1.0, -grad.y));
      vec3 refl = reflect(rd, n);
      float ndotv = clamp(dot(-rd, n), 0.0, 1.0);
      float fresnel = 0.04 + 0.96 * pow(1.0 - ndotv, 4.2);
      float dotBox1 = dot(refl, normalize(vec3(0.48, 0.72, -0.49)));
      float box1 = dotBox1 > 0.28 ? pow((dotBox1 - 0.28) / 0.72, 1.45) : 0.0;
      float dotBox2 = dot(refl, normalize(vec3(-0.62, 0.56, -0.38)));
      float box2 = dotBox2 > 0.36 ? pow((dotBox2 - 0.36) / 0.64, 1.7) * 0.55 : 0.0;
      float dotWarm = dot(refl, normalize(vec3(0.88, 0.24, -0.20)));
      float warmRim = dotWarm > 0.58 ? pow((dotWarm - 0.58) / 0.42, 2.2) * 0.75 : 0.0;
      float dome = refl.y > 0.05 ? min(0.22, refl.y * 0.24) : 0.0;
      float slopeBoost = min(0.38, length(grad) * 0.90);
      float rawLum = (dome + box1 * 0.95 + box2 + warmRim * 0.55 + slopeBoost * 0.45) * fresnel * vignette;
      float lum = clamp(rawLum * 1.45, 0.0, 1.0);
      if (lum >= 0.05) {
        if (uMode == 1) {
          float stepF = floor(lum * 11.99);
          if (stepF < 1.0) gIdx = 1.0;
          else if (stepF < 2.0) gIdx = 2.0;
          else if (stepF < 3.0) gIdx = 3.0;
          else if (stepF < 4.0) gIdx = 4.0;
          else if (stepF < 5.0) gIdx = 7.0;
          else if (stepF < 6.0) gIdx = 8.0;
          else if (stepF < 7.0) gIdx = 9.0;
          else if (stepF < 8.0) gIdx = 10.0;
          else if (stepF < 9.0) gIdx = 11.0;
          else if (stepF < 10.0) gIdx = 12.0;
          else gIdx = 13.0;
        } else {
          if (lum < 0.12) gIdx = 1.0;
          else if (lum < 0.19) gIdx = 2.0;
          else if (lum < 0.48) {
            float absX = abs(grad.x), absZ = abs(grad.y);
            if (absX > absZ * 1.45) gIdx = lum < 0.33 ? 2.0 : 8.0;
            else if (absX > absZ * 0.42) gIdx = (grad.x * grad.y) > 0.0 ? 5.0 : 6.0;
            else gIdx = lum < 0.32 ? 4.0 : 7.0;
          }
          else if (lum < 0.62) gIdx = 8.0;
          else if (lum < 0.74) gIdx = 9.0;
          else if (lum < 0.84) gIdx = 10.0;
          else if (lum < 0.92) gIdx = 11.0;
          else gIdx = lum > 0.96 ? 13.0 : 12.0;
        }
        if (warmRim > 0.18 && warmRim > box1 * 0.7) sIdx = 16.0 + min(3.0, floor(lum * 4.0));
        else sIdx = min(15.0, floor(lum * 16.0));
      }
    }
  }
  if (uMode == 2) {
    vec2 totalCells = floor(uRes / uCellSize);
    float cCenter = floor(totalCells.x * 0.5 - uCam.x * totalCells.x * 0.08);
    float rPool = floor(totalCells.y * 0.48 + uCam.y * totalCells.y * 0.08);
    if (abs(cellIdx.x - cCenter) < 0.5) {
      if (uHeroDropT >= 0.0 && uHeroDropT < 0.28) {
        float f = uHeroDropT / 0.28;
        float rDrop = floor(mix(totalCells.y - 2.0, rPool, f * f));
        if (abs(cellIdx.y - rDrop) < 0.5) { gIdx = 15.0; sIdx = 15.0; }
        else if (abs(cellIdx.y - (rDrop + 1.0)) < 0.5) { gIdx = 14.0; sIdx = 13.0; }
      } else if (uHeroDropT >= 0.28 && uHeroDropT < 1.65) {
        float tJet = uHeroDropT - 0.28;
        float rise = sin(min(1.0, tJet / 1.35) * 3.14159265);
        float jetH = max(1.0, floor(rise * (totalCells.y * 0.14) + 0.5));
        float dy = cellIdx.y - rPool;
        if (dy >= 0.0 && dy < jetH) { gIdx = dy < 0.5 ? 11.0 : 14.0; sIdx = min(15.0, 11.0 + dy * 0.6); }
        if (tJet > 0.14 && tJet < 1.25) {
          float arch = sin((tJet - 0.14) / 1.11 * 3.14159265);
          float rDroplet = rPool + jetH + 1.0 + floor(arch * (totalCells.y * 0.09) + 0.5);
          if (abs(cellIdx.y - rDroplet) < 0.5) { gIdx = 15.0; sIdx = 15.0; }
        }
      }
    }
  }
  outCell = vec4(gIdx / 255.0, sIdx / 255.0, 0.0, 1.0);
}`,
  // Pass two: every pixel, its cell's glyph from the atlas.
  glyphs: `#version 300 es
precision highp float;
uniform vec2 uCellSize;
uniform sampler2D uCells;
uniform sampler2D uAtlas;
out vec4 colour;
void main() {
  vec2 cell = floor(gl_FragCoord.xy / uCellSize), localUV = fract(gl_FragCoord.xy / uCellSize);
  vec2 gs = floor(texelFetch(uCells, ivec2(cell), 0).rg * 255.0 + 0.5);
  if (gs.x < 0.5) { colour = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec2 tileUV = vec2(${TILE.w}.0 / ${ATLAS.w}.0, ${TILE.h}.0 / ${ATLAS.h}.0);
  vec2 inset = vec2(clamp(localUV.x, 0.04, 0.96), clamp(1.0 - localUV.y, 0.04, 0.96));
  vec4 t = texture(uAtlas, vec2(gs.x * tileUV.x, gs.y * tileUV.y) + inset * tileUV);
  colour = vec4(t.rgb * t.a, 1.0);
}`,
};

// A seeded generator, so a scene can be tested.
export function seeded(seed = 1): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// The cells across and down a panel of w × h points.
export const cellsFor = (w: number, h: number): { cols: number; rows: number } => ({ cols: Math.max(1, Math.ceil(w / CELL.w)), rows: Math.max(1, Math.ceil(h / CELL.h)) });

export function runsWater(
  canvas: HTMLCanvasElement,
  {
    mode = 'ripple',
    theme = 'obsidian',
    fps = 30,
    seed = (Date.now() & 0xffff) || 7,
    reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false,
  }: RunsWaterOptions = {},
): RunsWaterController {
  const context = canvas.getContext('webgl2', { alpha: false, antialias: false });
  if (!context) throw new Error('No WebGL2 here.');
  const gl: WebGL2RenderingContext = context;
  const compile = (type: number, source: string): WebGLShader => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
    return s;
  };
  const link = (fragment: string): WebGLProgram => {
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, poolShaderSources.vertex));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fragment));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link');
    return p;
  };
  const cellsProgram = link(poolShaderSources.cells), glyphProgram = link(poolShaderSources.glyphs);
  const at = <T extends string>(p: WebGLProgram, names: readonly T[]): Record<T, WebGLUniformLocation | null> =>
    Object.fromEntries(names.map(n => [n, gl.getUniformLocation(p, n)])) as Record<T, WebGLUniformLocation | null>;
  const cu = at(cellsProgram, ['uRes', 'uCellSize', 'uTime', 'uMode', 'uCam', 'uHeroDropT', 'uDrops'] as const);
  const gu = at(glyphProgram, ['uCellSize', 'uCells', 'uAtlas'] as const);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  // The glyph atlas: every glyph in every shade of the theme.
  const atlasCanvas = document.createElement('canvas');
  atlasCanvas.width = ATLAS.w;
  atlasCanvas.height = ATLAS.h;
  const atlasTex = gl.createTexture();
  let themeAt = themeIndex(theme), modeAt = modeIndex(mode);
  function atlas(): void {
    const c = atlasCanvas.getContext('2d')!;
    c.clearRect(0, 0, ATLAS.w, ATLAS.h);
    c.font = '600 28px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (let s = 0; s < SHADES; s++) {
      const [r, g, b] = shadeColour(THEMES[themeAt], s);
      c.fillStyle = `rgb(${r},${g},${b})`;
      for (let i = 1; i < GLYPHS.length; i++) c.fillText(GLYPHS[i], i * TILE.w + TILE.w / 2, s * TILE.h + TILE.h * 0.52);
    }
    gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    for (const [k, v] of [[gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlasCanvas);
  }
  atlas();

  // The cell texture, one texel a cell, and the framebuffer that fills it.
  const cellTex = gl.createTexture(), fbo = gl.createFramebuffer();
  let cols = 1, rows = 1;

  const rand = seeded(seed);
  const drops = new Float32Array(DROPS * 4);
  let cursor = 0, t = 0, nextDrop = 0.2, hero = -0.35, heroStruck = false, lastWake = -1;
  const cam = { x: 0, y: 0, tx: 0, ty: 0 };
  let w = 0, h = 0, dpr = 1, raf = 0, last = 0, drawn = 0, running = false, wanted = false;
  const spawn = (x: number, z: number, amp: number): void => { drops.set([x, z, t, amp], cursor * 4); cursor = (cursor + 1) % DROPS; };
  spawn(0, 0, 0.088);

  function resize(): void {
    const box = canvas.getBoundingClientRect();
    w = Math.max(1, Math.round(box.width));
    h = Math.max(1, Math.round(box.height));
    dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ({ cols, rows } = cellsFor(canvas.width / dpr, canvas.height / dpr));
    gl.bindTexture(gl.TEXTURE_2D, cellTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, cellTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    draw();
  }

  function draw(): void {
    if (!w || !h) return;
    const cell = [CELL.w * dpr, CELL.h * dpr];
    gl.bindVertexArray(vao);
    // The cells.
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, cols, rows);
    gl.useProgram(cellsProgram);
    gl.uniform2f(cu.uRes, canvas.width, canvas.height);
    gl.uniform2f(cu.uCellSize, cell[0], cell[1]);
    gl.uniform1f(cu.uTime, t);
    gl.uniform1i(cu.uMode, modeAt);
    gl.uniform2f(cu.uCam, cam.x, cam.y);
    gl.uniform1f(cu.uHeroDropT, t - hero);
    gl.uniform4fv(cu.uDrops, drops);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    // The glyphs.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(glyphProgram);
    gl.uniform2f(gu.uCellSize, cell[0], cell[1]);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, cellTex);
    gl.uniform1i(gu.uCells, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.uniform1i(gu.uAtlas, 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  // Time on by dt: the camera easing toward the pointer, drops now and then (or the splash, again and again).
  function advance(dt: number): void {
    t += dt;
    const ease = 1 - 0.95 ** (dt * 60);
    cam.x += (cam.tx - cam.x) * ease;
    cam.y += (cam.ty - cam.y) * ease;
    if (modeAt === 2) {
      const since = t - hero;
      if (since > 4.2) { hero = t; heroStruck = false; }
      else if (since >= 0.28 && !heroStruck) { heroStruck = true; spawn(0, 0, 0.098); }
    } else if (t > nextDrop) {
      spawn((rand() - 0.5) * 1.8, (rand() - 0.5) * 1.3, 0.082);
      nextDrop = t + 2.3 + rand() * 1.4;
    }
  }
  function frame(now: number): void {
    raf = running ? requestAnimationFrame(frame) : 0;
    if (now - drawn < 1000 / fps - 4) return;
    advance(Math.min(0.1, last ? (now - last) / 1000 : 1 / fps));
    last = now;
    drawn = now;
    draw();
  }
  function start(): void {
    wanted = true;
    if (running || document.hidden) return;
    if (reduced) { draw(); return; }
    running = true;
    last = 0;
    raf = requestAnimationFrame(frame);
  }
  function halt(): void { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }
  const visible = (): void => { if (document.hidden) halt(); else if (wanted) start(); };
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  observer?.observe(canvas);
  document.addEventListener('visibilitychange', visible);
  resize();

  const spot = (clientX: number, clientY: number): [number, number] | null => {
    const box = canvas.getBoundingClientRect();
    return toWater(clientX - box.left, clientY - box.top, w, h, cam);
  };
  return {
    start,
    stop() { wanted = false; halt(); },
    // The pointer moving over the panel: the camera sways toward it, and a light wake follows it.
    pointer(clientX: number, clientY: number) {
      if (!wanted || reduced) return;
      const box = canvas.getBoundingClientRect();
      cam.tx = (((clientX - box.left) / box.width) * 2 - 1) * 0.35;
      cam.ty = (((clientY - box.top) / box.height) * 2 - 1) * 0.25;
      if (t - lastWake > 0.12) { const p = spot(clientX, clientY); if (p) spawn(p[0], p[1], 0.032); lastWake = t; }
    },
    // A click: a drop there, or in Splash, near the centre, the splash again.
    dropAt(clientX: number, clientY: number) {
      if (!wanted || reduced) return false;
      const p = spot(clientX, clientY);
      if (!p) return false;
      if (modeAt === 2 && Math.hypot(p[0], p[1]) < 0.25) { hero = t; heroStruck = false; } else spawn(p[0], p[1], 0.088);
      return true;
    },
    mode: () => MODES[modeAt].id,
    setMode(id: string) { modeAt = modeIndex(id); if (modeAt === 2) { hero = t; heroStruck = false; } draw(); },
    theme: () => THEMES[themeAt].id,
    setTheme(id: string) { themeAt = themeIndex(id); atlas(); draw(); },
    renderer: () => 'webgl2',
    cells: () => ({ cols, rows }),
    // One frame by hand, dt seconds on: for tests and for timing.
    tick(dt = 1 / fps) { advance(dt); draw(); },
    destroy() { halt(); observer?.disconnect(); document.removeEventListener('visibilitychange', visible); },
  };
}
