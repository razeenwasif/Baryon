// Velvet: the plain near-black the phone's chats settle on (VelvetBlack in ios/Fairy/LivingAurora.swift), as a window
// background, and the ripple that pours it in from Fairy's eye: a glowing ring runs out, the velvet behind it. Going back,
// the ring runs out the other way and the wallpaper shows through behind it.

export interface BoxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PictureSize {
  w: number;
  h: number;
}

export interface RippleVelvetOptions {
  host: HTMLElement;
  origin: { x: number; y: number };
  toVelvet: boolean;
  swap: () => void | Promise<void>;
  duration?: number;
  reduced?: boolean;
}

interface WallpaperMediaSource {
  source: HTMLVideoElement | HTMLImageElement;
  w: number;
  h: number;
  inset: number;
  live: boolean;
}

type WebkitCSSStyleDeclaration = CSSStyleDeclaration & { webkitMaskImage: string };

// Near-black, a touch lighter about the eye, with a fine grain, as an image the wallpaper layers can use.
export const VELVET = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000"><defs><radialGradient id="g" cx="50%" cy="42%" r="75%"><stop offset="0" stop-color="#0d0e15"/><stop offset=".5" stop-color="#050508"/><stop offset="1" stop-color="#020203"/></radialGradient><filter id="n" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .075 0"/></filter></defs><rect width="1600" height="1000" fill="url(#g)"/><rect width="1600" height="1000" filter="url(#n)"/></svg>`)}`;

const ease = (t: number): number => 1 - Math.pow(1 - t, 3);
// How far the ring has to run from (x, y) to cover the whole of a w × h box.
export const reach = (x: number, y: number, w: number, h: number): number =>
  Math.hypot(Math.max(x, w - x), Math.max(y, h - y)) + 24;

// The ripple drawn as the phone draws it (LivingAurora.swift's shader): a ring runs out from the eye, bending the
// wallpaper in a few trailing waves as it passes and glowing, with the velvet behind it. The real wallpaper stays
// underneath; this canvas only covers what the ring has changed, so where nothing has changed it shows through.
const VERT = 'attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }';
const FRAG = `precision highp float;
uniform vec2 res, origin; uniform float front, band, amp, glow, toVelvet, overlay;
uniform sampler2D wall, velvet; uniform vec4 wallMap, velvetMap; uniform vec3 wallBg, velvetBg;
vec3 pick(sampler2D t, vec4 m, vec2 px) { return texture2D(t, clamp((px - m.xy) / m.zw, 0.0, 1.0)).rgb; }
// The window's shade over a wallpaper: a vignette to its ground colour about (55%, 45%), and a light tint of it.
vec3 shade(vec3 c, vec2 px, vec3 bg) {
  float d = length((px / res - vec2(0.55, 0.45)) / 0.95);
  c = mix(c, bg, clamp((d - 0.5) / 0.5, 0.0, 1.0));
  return mix(c, bg, overlay);
}
void main() {
  vec2 px = vec2(gl_FragCoord.x, res.y - gl_FragCoord.y), from = px - origin;
  float r = length(from), e = (r - front) / band;
  float ring = exp(-e * e * 3.0);
  // The ring pushes the light outward and back as it passes, in a few waves.
  vec2 q = px + from / max(r, 1.0) * ring * amp * sin((r - front) / band * 7.0);
  vec3 w = shade(pick(wall, wallMap, q), q, wallBg), v = shade(pick(velvet, velvetMap, q), q, velvetBg);
  // Going to velvet it fills in behind the ring; coming back the wallpaper leads into it, so its bent light shows there.
  float inside = toVelvet > 0.5 ? smoothstep(front - band * 0.2, front - band * 1.1, r) : smoothstep(front + band * 0.45, front - band * 0.5, r);
  vec3 c = toVelvet > 0.5 ? mix(w, v, inside) : mix(v, w, inside);
  float a = toVelvet > 0.5 ? max(inside, ring) : max(1.0 - inside, ring);
  c += vec3(0.5, 0.65, 1.0) * ring * glow * (toVelvet > 0.5 ? 1.0 : 0.5);
  gl_FragColor = vec4(c * a, a);
}`;

// Where a picture drawn "cover" into a box lands, in device pixels: [x, y, width, height].
export function coverMap(box: BoxRect, picture: PictureSize): [number, number, number, number] {
  const scale = Math.max(box.w / picture.w, box.h / picture.h);
  const w = picture.w * scale;
  const h = picture.h * scale;
  return [box.x + (box.w - w) / 2, box.y + (box.h - h) / 2, w, h];
}

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });

// The wallpaper as it's on screen: its moving version if that's showing, else its picture, drawn into the
// layer's box (7% larger than the window on each side for the picture, the window itself for the video).
async function wallpaperSource(host: HTMLElement): Promise<WallpaperMediaSource | null> {
  const root = document.documentElement;
  const video = host.querySelector<HTMLVideoElement>('#wallpaper .wp-video');
  if (root.classList.contains('wallpaper-video') && video && video.readyState >= 2 && video.videoWidth) {
    return { source: video, w: video.videoWidth, h: video.videoHeight, inset: 0, live: true };
  }
  const url = getComputedStyle(root).getPropertyValue('--wp-image').trim().match(/^url\(["']?(.*?)["']?\)$/)?.[1];
  if (!url) return null;
  const image = await loadImage(url);
  return { source: image, w: image.naturalWidth, h: image.naturalHeight, inset: 0.07, live: false };
}

async function rippleWithShader({
  host,
  x,
  y,
  toVelvet,
  swap,
  duration,
}: {
  host: HTMLElement;
  x: number;
  y: number;
  toVelvet: boolean;
  swap: () => Promise<void>;
  duration: number;
}): Promise<boolean> {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false });
  if (!gl) return false;
  const box = host.getBoundingClientRect();
  const dpr = Math.min(2, devicePixelRatio || 1);
  const W = Math.round(box.width * dpr);
  const H = Math.round(box.height * dpr);
  // Going to velvet, the wallpaper on screen now is what the ring bends; coming back, the one it's going back to.
  let wall = toVelvet ? await wallpaperSource(host) : null;
  const velvetImage = await loadImage(VELVET);
  canvas.className = 'velvet-ripple velvet-waves';
  canvas.width = W;
  canvas.height = H;
  const program = gl.createProgram();
  if (!program) return false;
  for (const [type, text] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]] as const) {
    const shader = gl.createShader(type);
    if (!shader) return false;
    gl.shaderSource(shader, text);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return false;
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;
  gl.useProgram(program);
  gl.viewport(0, 0, W, H);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const at = gl.getAttribLocation(program, 'p');
  gl.enableVertexAttribArray(at);
  gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
  const u = (name: string): WebGLUniformLocation | null => gl.getUniformLocation(program, name);
  const texture = (unit: number, source: HTMLVideoElement | HTMLImageElement): WebGLTexture | null => {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    for (const [k, v] of [
      [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
      [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
    ] as const) {
      gl.texParameteri(gl.TEXTURE_2D, k, v);
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    return t;
  };
  const mapFor = (picture: PictureSize, inset: number): [number, number, number, number] =>
    coverMap({ x: -inset * W, y: -inset * H, w: W * (1 + 2 * inset), h: H * (1 + 2 * inset) }, picture);
  const colour = (name: string): [number, number, number] => {
    const hex = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#000000';
    const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  };
  const useWall = (source: WallpaperMediaSource | null): void => {
    if (!source) return;
    texture(0, source.source);
    gl.uniform4f(u('wallMap'), ...mapFor(source, source.inset));
    gl.uniform3f(u('wallBg'), ...colour('--wp-bg'));
  };
  texture(1, velvetImage);
  gl.uniform1i(u('wall'), 0);
  gl.uniform1i(u('velvet'), 1);
  gl.uniform4f(u('velvetMap'), ...mapFor({ w: velvetImage.naturalWidth || 1600, h: velvetImage.naturalHeight || 1000 }, 0.07));
  gl.uniform3f(u('velvetBg'), 3 / 255, 3 / 255, 4 / 255);
  gl.uniform2f(u('res'), W, H);
  gl.uniform2f(u('origin'), x * dpr, y * dpr);
  gl.uniform1f(u('toVelvet'), toVelvet ? 1 : 0);
  gl.uniform1f(u('overlay'), document.documentElement.classList.contains('home') ? 0.22 : 0.3);
  const band = Math.max(60, 0.13 * Math.min(W, H) * 1.4);
  const far = reach(x * dpr, y * dpr, W, H) + band * 1.2;
  gl.uniform1f(u('band'), band);
  if (wall) useWall(wall);
  const wallpaper = host.querySelector('#wallpaper');
  if (wallpaper) wallpaper.after(canvas);
  else host.prepend(canvas);
  const draw = (progress: number): void => {
    if (wall?.live) {
      gl.activeTexture(gl.TEXTURE0);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, wall.source);
    }
    gl.uniform1f(u('front'), ease(progress) * far);
    gl.uniform1f(u('amp'), 0.045 * H * (1 - 0.65 * progress));
    gl.uniform1f(u('glow'), 0.6 * (1 - 0.55 * progress));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  try {
    // Coming back: velvet over everything while the wallpaper is put back underneath, then the ring opens it up.
    if (!toVelvet) {
      gl.uniform1f(u('front'), 0);
      draw(0);
      await swap();
      wall =
        (await wallpaperSource(host).catch(() => null)) ?? {
          source: velvetImage,
          w: velvetImage.naturalWidth || 1600,
          h: velvetImage.naturalHeight || 1000,
          inset: 0.07,
          live: false,
        };
      useWall(wall);
    }
    await new Promise<void>(resolve => {
      const start = performance.now();
      const step = (now: number): void => {
        const t = Math.min(1, (now - start) / duration);
        draw(t);
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    if (toVelvet) await swap();
    canvas.style.transition = 'opacity .35s ease';
    await new Promise<void>(resolve =>
      requestAnimationFrame(() => {
        canvas.style.opacity = '0';
        setTimeout(resolve, 360);
      }),
    );
    return true;
  } finally {
    canvas.remove();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

// toVelvet: pour the velvet in (true) or take it away (false). swap(): changes the saved background, at the moment the
// screen is all velvet. origin: where the ring starts, in the host's coordinates. Resolves when it's done.
export async function rippleVelvet({
  host,
  origin,
  toVelvet,
  swap,
  duration = 2600,
  reduced = matchMedia('(prefers-reduced-motion: reduce)').matches,
}: RippleVelvetOptions): Promise<void> {
  const box = host.getBoundingClientRect();
  const x = origin.x - box.left;
  const y = origin.y - box.top;
  const far = reach(x, y, box.width, box.height);
  // The background changes once, however the ripple is drawn.
  let swapped = false;
  const swapOnce = async (): Promise<void> => {
    if (!swapped) {
      swapped = true;
      await swap();
    }
  };
  // The phone's waves when WebGL can draw them; otherwise a clean circle.
  if (!reduced) {
    try {
      if (await rippleWithShader({ host, x, y, toVelvet, swap: swapOnce, duration: Math.max(duration, 2600) })) return;
    } catch (error) {
      console.warn('Velvet ripple fell back:', error instanceof Error ? error.message : String(error));
    }
  }
  swap = swapOnce;
  const layer = document.createElement('div');
  const ring = document.createElement('div');
  const layerStyle = layer.style as WebkitCSSStyleDeclaration;
  layer.className = 'velvet-ripple';
  ring.className = 'velvet-ring';
  layerStyle.backgroundImage = `url("${VELVET}")`;
  // Just above the wallpaper and below everything else in the window.
  const wallpaper = host.querySelector('#wallpaper');
  if (wallpaper) wallpaper.after(layer, ring);
  else host.prepend(layer, ring);
  const draw = (r: number): void => {
    if (toVelvet) {
      layerStyle.clipPath = `circle(${r}px at ${x}px ${y}px)`;
    } else {
      const mask = `radial-gradient(circle at ${x}px ${y}px, transparent ${Math.max(0, r - 1)}px, #000 ${r + 1}px)`;
      layerStyle.webkitMaskImage = mask;
      layerStyle.maskImage = mask;
    }
    Object.assign(ring.style, {
      left: `${x}px`,
      top: `${y}px`,
      width: `${r * 2}px`,
      height: `${r * 2}px`,
      opacity: String(0.95 * (1 - Math.pow(Math.min(1, r / far), 2))),
    });
  };
  const run = (): Promise<void> =>
    new Promise(resolve => {
      if (reduced) {
        draw(far);
        resolve();
        return;
      }
      const start = performance.now();
      const step = (now: number): void => {
        const t = Math.min(1, (now - start) / duration);
        draw(ease(t) * far);
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  try {
    if (toVelvet) {
      draw(0);
      await run();
      await swap();
    } else {
      draw(0);
      layerStyle.webkitMaskImage = layerStyle.maskImage = 'none';
      await swap();
      await new Promise(requestAnimationFrame);
      await run();
    }
    // Settled: the saved background is underneath, so the layer can go.
    layerStyle.transition = 'opacity .35s ease';
    ring.remove();
    await new Promise<void>(resolve => {
      requestAnimationFrame(() => {
        layerStyle.opacity = '0';
        setTimeout(resolve, 360);
      });
    });
  } finally {
    layer.remove();
    ring.remove();
  }
}
