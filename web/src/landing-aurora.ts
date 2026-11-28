// Bottom-confined Stratus teal/cyan WebGL horizon aurora for the Baryon landing hero.
// Includes Canvas2D fallback, webglcontextlost recovery, and prefers-reduced-motion guard.

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

  vec2 m = (uMouse - 0.5) * vec2(0.22, 0.10);
  float t = uTime * 0.13;

  vec2 warpCoord = vec2(p.x * 0.92, uv.y * 2.3) - m * 0.55 + vec2(t * 0.26, -t * 0.16);
  vec2 q = vec2(fbm(warpCoord), fbm(warpCoord + vec2(4.3, 1.9) + t * 0.15));
  float silk = fbm(warpCoord + 1.8 * q + vec2(-t * 0.14, t * 0.1));
  float ribbon = fbm(warpCoord * 1.35 - 1.2 * q + vec2(2.7, -t * 0.22));

  vec3 zenith = vec3(0.0196, 0.0196, 0.0275); // #050507
  float arch = -0.05 * (p.x * p.x) + m.y * 0.035;
  float bottomMask = smoothstep(0.62, 0.0, uv.y - arch);
  float deepBand = pow(clamp(1.0 - (uv.y - arch) / 0.58, 0.0, 1.0), 1.85);
  float curtain = bottomMask * (0.48 + 0.62 * silk) * deepBand;

  vec2 orbA = vec2(-0.36 * aspect + m.x * 0.7 + sin(t * 0.7) * 0.09, 0.04 + ribbon * 0.05);
  vec2 orbB = vec2(0.34 * aspect - m.x * 0.6 + cos(t * 0.6) * 0.10, 0.05 + silk * 0.05);
  vec2 orbC = vec2(m.x * 0.4, 0.11 + sin(t * 0.48) * 0.025);

  float gA = exp(-dot(p - orbA, p - orbA) * (2.4 - silk * 0.5)) * bottomMask;
  float gB = exp(-dot(p - orbB, p - orbB) * (2.5 - ribbon * 0.45)) * bottomMask;
  float gC = exp(-dot(p - orbC, p - orbC) * 2.25) * bottomMask;

  vec3 plume = vec3(0.0);
  plume += uColorA * (curtain * 0.85 + gA * 0.58);
  plume += uColorB * (gB * 0.62 + deepBand * pow(ribbon, 1.3) * 0.54);
  plume += uColorC * (gC * 0.34 + smoothstep(0.45, 0.92, silk * curtain) * 0.48);

  float limbY = 0.075 + 0.022 * cos(p.x * 1.1) + (silk - 0.5) * 0.01;
  float limb = exp(-abs(uv.y - limbY) * 210.0) * smoothstep(1.25, 0.15, abs(p.x)) * bottomMask;
  plume += mix(uColorB, uColorC, 0.55) * limb * 0.22;

  vec2 starCell = floor(uv * vec2(84.0, 52.0) + vec2(uTime * 0.03, 0.0));
  vec2 starLocal = fract(uv * vec2(84.0, 52.0) + vec2(uTime * 0.03, 0.0)) - 0.5;
  float starSeed = hash12(starCell);
  float starMask = step(0.989, starSeed) * smoothstep(0.42, 0.9, uv.y);
  float twinkle = 0.5 + 0.5 * sin(uTime * (0.8 + starSeed * 1.8) + starSeed * 40.0);
  float starDot = smoothstep(0.24, 0.03, length(starLocal)) * starMask * twinkle;
  plume += mix(vec3(0.7, 0.9, 0.98), uColorC, 0.45) * starDot * 0.14;

  vec3 color = zenith + plume * uIntensity;
  float sideVig = smoothstep(1.5, 0.34, length((uv - vec2(0.5, 0.14)) * vec2(aspect * 0.72, 1.05)));
  color = mix(zenith, color, mix(0.25, 1.0, sideVig));

  // Smooth fade into page ground at very bottom edge
  color = mix(zenith, color, smoothstep(0.0, 0.08, uv.y));

  color = color / (1.0 + color * 0.32);
  color += (ign(gl_FragCoord.xy) - 0.5) / 255.0;

  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

export interface AuroraController {
  destroy: () => void;
}

interface AuroraUniforms {
  uRes: WebGLUniformLocation | null;
  uMouse: WebGLUniformLocation | null;
  uTime: WebGLUniformLocation | null;
  uIntensity: WebGLUniformLocation | null;
  uColorA: WebGLUniformLocation | null;
  uColorB: WebGLUniformLocation | null;
  uColorC: WebGLUniformLocation | null;
}

export function mountLandingAurora(canvas: HTMLCanvasElement | null): AuroraController {
  if (!canvas) return { destroy: () => {} };

  let disposed = false;
  let rafId = 0;
  let lastNow = performance.now();
  let time = 0;
  let targetMouseX = 0.5;
  let targetMouseY = 0.5;
  let curMouseX = 0.5;
  let curMouseY = 0.5;

  const colorA: readonly [number, number, number] = [0.06, 0.22, 0.62]; // Stratus Accent Blue (#3e5aec family)
  const colorB: readonly [number, number, number] = [0.05, 0.48, 0.60]; // Stratus Teal
  const colorC: readonly [number, number, number] = [0.10, 0.72, 0.80]; // Stratus Cyan (#18b8cc)
  const intensity = 0.92;

  const reduced = (() => {
    try { return matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch { return false; }
  })();

  let gl: WebGL2RenderingContext | WebGLRenderingContext | null = null;
  let program: WebGLProgram | null = null;
  let uniforms: AuroraUniforms | null = null;
  let ctx2d: CanvasRenderingContext2D | null = null;

  try {
    gl = canvas.getContext('webgl2', { alpha: false, antialias: false, powerPreference: 'low-power' })
      || canvas.getContext('webgl', { alpha: false, antialias: false, powerPreference: 'low-power' });
    if (gl?.isContextLost?.()) gl = null;
  } catch { gl = null; }

  const onContextLost = (event: Event): void => {
    event?.preventDefault?.();
    gl = null;
    program = null;
    ctx2d = canvas.getContext('2d');
    draw2d();
  };
  canvas.addEventListener('webglcontextlost', onContextLost);

  if (gl) {
    const webgl = gl;
    const compile = (type: number, src: string): WebGLShader | null => {
      const sh = webgl.createShader(type);
      if (!sh) return null;
      webgl.shaderSource(sh, src);
      webgl.compileShader(sh);
      if (!webgl.getShaderParameter(sh, webgl.COMPILE_STATUS)) {
        webgl.deleteShader(sh);
        return null;
      }
      return sh;
    };
    const vs = compile(webgl.VERTEX_SHADER, VERT_SRC);
    const fs = compile(webgl.FRAGMENT_SHADER, FRAG_SRC);
    if (vs && fs) {
      program = webgl.createProgram();
      if (program) {
        webgl.attachShader(program, vs);
        webgl.attachShader(program, fs);
        webgl.linkProgram(program);
        if (!webgl.getProgramParameter(program, webgl.LINK_STATUS)) {
          webgl.deleteProgram(program);
          program = null;
        }
      }
    }
    if (program) {
      const buf = webgl.createBuffer();
      webgl.bindBuffer(webgl.ARRAY_BUFFER, buf);
      webgl.bufferData(webgl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), webgl.STATIC_DRAW);
      const loc = webgl.getAttribLocation(program, 'aPos');
      webgl.enableVertexAttribArray(loc);
      webgl.vertexAttribPointer(loc, 2, webgl.FLOAT, false, 0, 0);
      uniforms = {
        uRes: webgl.getUniformLocation(program, 'uRes'),
        uMouse: webgl.getUniformLocation(program, 'uMouse'),
        uTime: webgl.getUniformLocation(program, 'uTime'),
        uIntensity: webgl.getUniformLocation(program, 'uIntensity'),
        uColorA: webgl.getUniformLocation(program, 'uColorA'),
        uColorB: webgl.getUniformLocation(program, 'uColorB'),
        uColorC: webgl.getUniformLocation(program, 'uColorC'),
      };
    } else {
      gl = null;
    }
  }

  if (!gl) {
    ctx2d = canvas.getContext('2d');
  }

  function resize(): void {
    if (disposed || !canvas) return;
    const parent = canvas.parentElement;
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.floor((parent?.clientWidth || window.innerWidth || 1280) * dpr));
    const h = Math.max(1, Math.floor((parent?.clientHeight || window.innerHeight || 800) * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    if (gl) gl.viewport(0, 0, canvas.width, canvas.height);
  }

  function draw2d(): void {
    if (!ctx2d || !canvas) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx2d.fillStyle = '#050507';
    ctx2d.fillRect(0, 0, w, h);

    const g1 = ctx2d.createRadialGradient(w * 0.34, h * 0.92, 12, w * 0.36, h * 0.88, Math.min(w * 0.55, h * 0.6));
    g1.addColorStop(0, 'rgba(62, 90, 236, 0.35)');
    g1.addColorStop(1, 'rgba(5, 5, 7, 0)');
    ctx2d.fillStyle = g1;
    ctx2d.fillRect(0, 0, w, h);

    const g2 = ctx2d.createRadialGradient(w * 0.66, h * 0.92, 12, w * 0.64, h * 0.88, Math.min(w * 0.55, h * 0.6));
    g2.addColorStop(0, 'rgba(24, 184, 204, 0.28)');
    g2.addColorStop(1, 'rgba(5, 5, 7, 0)');
    ctx2d.fillStyle = g2;
    ctx2d.fillRect(0, 0, w, h);
  }

  function drawFrame(now: number): void {
    if (disposed || !canvas) return;
    const dt = Math.min(0.05, Math.max(0.001, (now - lastNow) / 1000));
    lastNow = now;
    if (!reduced) time += dt;

    curMouseX += (targetMouseX - curMouseX) * Math.min(1, dt * 5);
    curMouseY += (targetMouseY - curMouseY) * Math.min(1, dt * 5);

    if (gl && program && uniforms && !gl.isContextLost()) {
      gl.useProgram(program);
      gl.uniform2f(uniforms.uRes, canvas.width, canvas.height);
      gl.uniform2f(uniforms.uMouse, curMouseX, 1.0 - curMouseY);
      gl.uniform1f(uniforms.uTime, time);
      gl.uniform1f(uniforms.uIntensity, intensity);
      gl.uniform3f(uniforms.uColorA, colorA[0], colorA[1], colorA[2]);
      gl.uniform3f(uniforms.uColorB, colorB[0], colorB[1], colorB[2]);
      gl.uniform3f(uniforms.uColorC, colorC[0], colorC[1], colorC[2]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      canvas.classList.add('is-ready');
    } else if (ctx2d) {
      draw2d();
      canvas.classList.add('is-ready');
    }

    if (!reduced) {
      rafId = requestAnimationFrame(drawFrame);
    } else {
      rafId = 0;
    }
  }

  const onPointerMove = (e: PointerEvent): void => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    targetMouseX = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    targetMouseY = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
  };

  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  rafId = requestAnimationFrame(drawFrame);

  return {
    destroy() {
      disposed = true;
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('webglcontextlost', onContextLost);
    },
  };
}
