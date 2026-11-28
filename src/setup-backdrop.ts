// Full-screen GPU cool-tone horizon atmosphere for Baryon first-run onboarding.
// WebGL shader with domain-warped silk aurora plumes, micro-starlight motes,
// hairline horizon limb arc, interleaved-gradient-noise dithering, and Canvas2D fallback.

const VERT_SRC = `
attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FRAG_SRC = `
precision highp float;

uniform vec2 uRes;
uniform vec2 uMouse;
uniform float uTime;
uniform float uIntensity;
uniform float uBurst;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash12(i + vec2(0.0, 0.0)), hash12(i + vec2(1.0, 0.0)), u.x),
    mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.52;
  mat2 rot = mat2(0.84, 0.54, -0.54, 0.84);
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = rot * p * 2.04 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

float ign(vec2 fragCoord) {
  return fract(52.9829189 * fract(dot(fragCoord, vec2(0.06711056, 0.00583715))));
}

void main() {
  vec2 uv = gl_FragCoord.xy / max(uRes, vec2(1.0));
  float aspect = uRes.x / max(uRes.y, 1.0);
  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y);

  vec2 m = (uMouse - 0.5) * vec2(0.24, 0.12);
  float t = uTime * 0.14;

  // Domain-warped cool-tone silk aurora curtains confined strictly across the bottom ~40%
  vec2 warpCoord = vec2(p.x * 0.95, uv.y * 2.4) - m * 0.65 + vec2(t * 0.28, -t * 0.18);
  vec2 q = vec2(fbm(warpCoord), fbm(warpCoord + vec2(4.3, 1.9) + t * 0.16));
  float silk = fbm(warpCoord + 1.8 * q + vec2(-t * 0.14, t * 0.1));
  float ribbon = fbm(warpCoord * 1.4 - 1.25 * q + vec2(2.7, -t * 0.24));

  // Pure jet-black upper zenith (#000002) melting smoothly into curved bottom aurora
  vec3 zenith = vec3(0.0, 0.002, 0.006);
  float arch = -0.055 * (p.x * p.x) + m.y * 0.04;
  float bottomMask = smoothstep(0.56, 0.0, uv.y - arch);
  float deepBand = pow(clamp(1.0 - (uv.y - arch) / 0.54, 0.0, 1.0), 1.9);
  float curtain = bottomMask * (0.48 + 0.62 * silk) * deepBand;

  // Lush teal / cyan / sapphire pools hugging the lower edge with subtle parallax
  vec2 orbA = vec2(-0.36 * aspect + m.x * 0.75 + sin(t * 0.7) * 0.1, 0.02 + ribbon * 0.05);
  vec2 orbB = vec2(0.34 * aspect - m.x * 0.65 + cos(t * 0.6) * 0.12, 0.04 + silk * 0.05);
  vec2 orbC = vec2(m.x * 0.45, 0.09 + sin(t * 0.48) * 0.025);

  float gA = exp(-dot(p - orbA, p - orbA) * (2.5 - silk * 0.55)) * bottomMask;
  float gB = exp(-dot(p - orbB, p - orbB) * (2.65 - ribbon * 0.5)) * bottomMask;
  float gC = exp(-dot(p - orbC, p - orbC) * 2.35) * bottomMask;

  vec3 plume = vec3(0.0);
  plume += uColorA * (curtain * 0.85 + gA * 0.56);
  plume += uColorB * (gB * 0.62 + deepBand * pow(ribbon, 1.3) * 0.58);
  plume += uColorC * (gC * 0.34 + smoothstep(0.45, 0.92, silk * curtain) * 0.52);

  // Delicate curved hairline lower-horizon glow
  float limbY = 0.068 + 0.024 * cos(p.x * 1.15) + (silk - 0.5) * 0.012;
  float limb = exp(-abs(uv.y - limbY) * 230.0) * smoothstep(1.25, 0.15, abs(p.x)) * bottomMask;
  plume += mix(uColorB, uColorC, 0.55) * limb * 0.24;

  // Whisper-faint starlight motes in the dark upper void
  vec2 starCell = floor(uv * vec2(84.0, 52.0) + vec2(uTime * 0.035, 0.0));
  vec2 starLocal = fract(uv * vec2(84.0, 52.0) + vec2(uTime * 0.035, 0.0)) - 0.5;
  float starSeed = hash12(starCell);
  float starMask = step(0.988, starSeed) * smoothstep(0.46, 0.88, uv.y);
  float twinkle = 0.5 + 0.5 * sin(uTime * (0.8 + starSeed * 2.0) + starSeed * 40.0);
  float starDot = smoothstep(0.24, 0.03, length(starLocal)) * starMask * twinkle;
  plume += mix(vec3(0.7, 0.9, 0.98), uColorC, 0.45) * starDot * 0.16;

  // Radial finish burst
  float distCenter = length(p - vec2(0.0, 0.48));
  float burstRing = exp(-abs(distCenter - uBurst * 1.35) * 16.0) * uBurst * (1.0 - smoothstep(0.65, 1.0, uBurst));
  plume += mix(uColorB, vec3(0.84, 0.97, 1.0), 0.55) * burstRing * 1.1;
  plume += uColorB * (uBurst * 0.2 * exp(-distCenter * 1.25));

  vec3 color = zenith + plume * uIntensity;

  // Keep upper corners & outer zenith pure jet-black
  float sideVig = smoothstep(1.5, 0.34, length((uv - vec2(0.5, 0.14)) * vec2(aspect * 0.72, 1.05)));
  color = mix(zenith, color, mix(0.25, 1.0, sideVig));

  // Tone compress highlights gently and apply IGN dithering for zero banding
  color = color / (1.0 + color * 0.32);
  color += (ign(gl_FragCoord.xy) - 0.5) / 255.0;

  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

export type RGBTuple = [number, number, number];

export interface SetupMoodInput {
  a?: readonly number[];
  b?: readonly number[];
  c?: readonly number[];
  intensity?: number;
}

export interface NormalizedSetupMood {
  a: RGBTuple;
  b: RGBTuple;
  c: RGBTuple;
  intensity: number;
}

export interface SetupBackdropController {
  setMood: (mood?: SetupMoodInput) => void;
  setMouse: (nx: number, ny: number) => void;
  triggerBurst: () => void;
  resize: () => void;
  destroy: () => void;
}

interface BackdropUniforms {
  uRes: WebGLUniformLocation | null;
  uMouse: WebGLUniformLocation | null;
  uTime: WebGLUniformLocation | null;
  uIntensity: WebGLUniformLocation | null;
  uBurst: WebGLUniformLocation | null;
  uColorA: WebGLUniformLocation | null;
  uColorB: WebGLUniformLocation | null;
  uColorC: WebGLUniformLocation | null;
}

const DEFAULT_MOOD: NormalizedSetupMood = {
  a: [0.02, 0.24, 0.30],
  b: [0.05, 0.50, 0.62],
  c: [0.16, 0.78, 0.88],
  intensity: 1.0,
};

function normalizeMood(mood: SetupMoodInput = {}): NormalizedSetupMood {
  return {
    a: Array.isArray(mood.a) ? (mood.a as RGBTuple) : DEFAULT_MOOD.a,
    b: Array.isArray(mood.b) ? (mood.b as RGBTuple) : DEFAULT_MOOD.b,
    c: Array.isArray(mood.c) ? (mood.c as RGBTuple) : DEFAULT_MOOD.c,
    intensity: Number.isFinite(mood.intensity) ? (mood.intensity as number) : DEFAULT_MOOD.intensity,
  };
}

function rgbCss(vec: readonly number[], alpha = 1): string {
  const r = Math.round(Math.min(1, Math.max(0, vec[0])) * 255);
  const g = Math.round(Math.min(1, Math.max(0, vec[1])) * 255);
  const b = Math.round(Math.min(1, Math.max(0, vec[2])) * 255);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function mountSetupBackdrop(canvas: HTMLCanvasElement | null | undefined): SetupBackdropController {
  if (!canvas) {
    return { setMood: () => {}, setMouse: () => {}, triggerBurst: () => {}, resize: () => {}, destroy: () => {} };
  }

  let disposed = false;
  let rafId = 0;
  let lastNow = performance.now();
  let time = 0;

  let targetMood = normalizeMood(DEFAULT_MOOD);
  const curA: RGBTuple = [...targetMood.a];
  const curB: RGBTuple = [...targetMood.b];
  const curC: RGBTuple = [...targetMood.c];
  let curIntensity = targetMood.intensity;

  let targetMouseX = 0.5;
  let targetMouseY = 0.5;
  let curMouseX = 0.5;
  let curMouseY = 0.5;
  let burst = 0;
  let burstActive = false;

  const reduced = (() => {
    try { return matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch { return false; }
  })();

  let gl: WebGL2RenderingContext | WebGLRenderingContext | null = null;
  let program: WebGLProgram | null = null;
  let uniforms: BackdropUniforms | null = null;
  let ctx2d: CanvasRenderingContext2D | null = null;

  try {
    gl = canvas.getContext('webgl2', { alpha: false, antialias: false, powerPreference: 'low-power' })
      || canvas.getContext('webgl', { alpha: false, antialias: false, powerPreference: 'low-power' });
    if (gl?.isContextLost?.()) gl = null;
  } catch { gl = null; }

  const onContextLost = (event: Event) => {
    event?.preventDefault?.();
    gl = null;
    program = null;
    canvas.classList.remove('is-ready');
  };
  canvas.addEventListener('webglcontextlost', onContextLost);

  if (gl) {
    const context = gl;
    const compile = (type: number, src: string): WebGLShader | null => {
      const sh = context.createShader(type);
      if (!sh) return null;
      context.shaderSource(sh, src);
      context.compileShader(sh);
      if (!context.getShaderParameter(sh, context.COMPILE_STATUS)) {
        context.deleteShader(sh);
        return null;
      }
      return sh;
    };
    const vs = compile(context.VERTEX_SHADER, VERT_SRC);
    const fs = compile(context.FRAGMENT_SHADER, FRAG_SRC);
    if (vs && fs) {
      program = context.createProgram();
      if (program) {
        context.attachShader(program, vs);
        context.attachShader(program, fs);
        context.linkProgram(program);
        if (!context.getProgramParameter(program, context.LINK_STATUS)) {
          context.deleteProgram(program);
          program = null;
        }
      }
    }
    if (program) {
      const buf = context.createBuffer();
      context.bindBuffer(context.ARRAY_BUFFER, buf);
      context.bufferData(context.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), context.STATIC_DRAW);
      const loc = context.getAttribLocation(program, 'aPos');
      context.enableVertexAttribArray(loc);
      context.vertexAttribPointer(loc, 2, context.FLOAT, false, 0, 0);
      uniforms = {
        uRes: context.getUniformLocation(program, 'uRes'),
        uMouse: context.getUniformLocation(program, 'uMouse'),
        uTime: context.getUniformLocation(program, 'uTime'),
        uIntensity: context.getUniformLocation(program, 'uIntensity'),
        uBurst: context.getUniformLocation(program, 'uBurst'),
        uColorA: context.getUniformLocation(program, 'uColorA'),
        uColorB: context.getUniformLocation(program, 'uColorB'),
        uColorC: context.getUniformLocation(program, 'uColorC'),
      };
    } else {
      gl = null;
    }
  }

  if (!gl) {
    ctx2d = canvas.getContext('2d');
  }

  function resize() {
    if (disposed || !canvas) return;
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.floor((canvas.clientWidth || window.innerWidth || 1280) * dpr));
    const h = Math.max(1, Math.floor((canvas.clientHeight || window.innerHeight || 800) * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    if (gl) gl.viewport(0, 0, canvas.width, canvas.height);
  }

  function draw2d() {
    if (!ctx2d || !canvas) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx2d.fillStyle = '#000000';
    ctx2d.fillRect(0, 0, w, h);

    const g1 = ctx2d.createRadialGradient(w * (0.30 + (curMouseX - 0.5) * 0.14), h * 1.02, 10, w * 0.36, h * 0.96, Math.min(w * 0.55, h * 0.62));
    g1.addColorStop(0, rgbCss(curA, 0.62 * curIntensity));
    g1.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx2d.fillStyle = g1;
    ctx2d.fillRect(0, 0, w, h);

    const g2 = ctx2d.createRadialGradient(w * (0.70 - (curMouseX - 0.5) * 0.12), h * 1.02, 10, w * 0.66, h * 0.96, Math.min(w * 0.54, h * 0.58));
    g2.addColorStop(0, rgbCss(curB, 0.56 * curIntensity));
    g2.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx2d.fillStyle = g2;
    ctx2d.fillRect(0, 0, w, h);
  }

  function drawFrame(now: number) {
    if (disposed || !canvas) return;
    const dt = Math.min(0.05, Math.max(0.001, (now - lastNow) / 1000));
    lastNow = now;
    if (!reduced) time += dt;

    const k = reduced ? 1 : Math.min(1, dt * 4.5);
    for (let i = 0; i < 3; i++) {
      curA[i] += (targetMood.a[i] - curA[i]) * k;
      curB[i] += (targetMood.b[i] - curB[i]) * k;
      curC[i] += (targetMood.c[i] - curC[i]) * k;
    }
    curIntensity += (targetMood.intensity - curIntensity) * k;
    curMouseX += (targetMouseX - curMouseX) * Math.min(1, dt * 6);
    curMouseY += (targetMouseY - curMouseY) * Math.min(1, dt * 6);

    if (burstActive) {
      burst = Math.min(1, burst + dt * 2.1);
      if (burst >= 1) burstActive = false;
    } else if (burst > 0) {
      burst = Math.max(0, burst - dt * 2.5);
    }

    if (gl && program && uniforms && !gl.isContextLost()) {
      gl.useProgram(program);
      gl.uniform2f(uniforms.uRes, canvas.width, canvas.height);
      gl.uniform2f(uniforms.uMouse, curMouseX, 1.0 - curMouseY);
      gl.uniform1f(uniforms.uTime, time);
      gl.uniform1f(uniforms.uIntensity, curIntensity);
      gl.uniform1f(uniforms.uBurst, burst);
      gl.uniform3f(uniforms.uColorA, curA[0], curA[1], curA[2]);
      gl.uniform3f(uniforms.uColorB, curB[0], curB[1], curB[2]);
      gl.uniform3f(uniforms.uColorC, curC[0], curC[1], curC[2]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      canvas.classList.add('is-ready');
    } else if (ctx2d) {
      draw2d();
      canvas.classList.add('is-ready');
    } else {
      canvas.classList.remove('is-ready');
    }

    if (!reduced || burstActive) {
      rafId = requestAnimationFrame(drawFrame);
    } else {
      rafId = 0;
    }
  }

  resize();
  window.addEventListener('resize', resize);
  rafId = requestAnimationFrame(drawFrame);

  return {
    setMood(mood?: SetupMoodInput) {
      targetMood = normalizeMood(mood);
      if (reduced && !rafId) rafId = requestAnimationFrame(drawFrame);
    },
    setMouse(nx: number, ny: number) {
      if (Number.isFinite(nx)) targetMouseX = Math.min(1, Math.max(0, nx));
      if (Number.isFinite(ny)) targetMouseY = Math.min(1, Math.max(0, ny));
    },
    triggerBurst() {
      burst = 0.01;
      burstActive = true;
      if (!rafId) rafId = requestAnimationFrame(drawFrame);
    },
    resize,
    destroy() {
      disposed = true;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.classList.remove('is-ready');
      if (gl && !gl.isContextLost()) {
        try { gl.getExtension('WEBGL_lose_context')?.loseContext?.(); } catch {}
      }
      gl = null;
      program = null;
    },
  };
}
