// Renders Baryon's minimalist macOS/iOS app icons and matching 3-fold vortex menu bar template icons.
// Run: node scripts/render-fairy-icons.mts
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { writeFileSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveRepoRoot } from './repo-root.mjs';

const root = resolveRepoRoot(import.meta.url);
const table: number[] = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (bytes: Uint8Array): number => {
  let x = -1;
  for (const v of bytes) x = table[(x ^ v) & 255] ^ (x >>> 8);
  return (x ^ -1) >>> 0;
};
const chunk = (type: string, data: Buffer): Buffer => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};
function pngRect(path: string, width: number, height: number, pixels: Buffer, channels = 4): void {
  const raw = Buffer.alloc((width * channels + 1) * height);
  for (let y = 0; y < height; y++) pixels.copy(raw, y * (width * channels + 1) + 1, y * width * channels, (y + 1) * width * channels);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = channels === 4 ? 6 : 2;
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
function png(path: string, size: number, pixels: Buffer, channels = 4): void {
  pngRect(path, size, size, pixels, channels);
}

// Analytical 3-fold braided singularity shader compiled with swiftc -O:
// Zero cut seams, exact cyclic symmetry (0 over 1 over 2 over 0), silky minimalist gradients + Dock-legible form.
const swiftShader = `
import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let macOutPath = CommandLine.arguments[1]
let iosOutPath = CommandLine.arguments[2]
let size = 1024
let halfS = 512.0

@inline(__always) func clamp(_ v: Double, _ lo: Double, _ hi: Double) -> Double {
  return v < lo ? lo : (v > hi ? hi : v)
}
@inline(__always) func smoothstep(_ e0: Double, _ e1: Double, _ x: Double) -> Double {
  let t = clamp((x - e0) / (e1 - e0), 0.0, 1.0)
  return t * t * (3.0 - 2.0 * t)
}
@inline(__always) func mix(_ a: Double, _ b: Double, _ t: Double) -> Double {
  return a + (b - a) * t
}
struct Vec3 {
  var r: Double; var g: Double; var b: Double
  init(_ r: Double, _ g: Double, _ b: Double) { self.r = r; self.g = g; self.b = b }
  static func mix(_ a: Vec3, _ b: Vec3, _ t: Double) -> Vec3 {
    let k = clamp(t, 0.0, 1.0)
    return Vec3(a.r + (b.r - a.r) * k, a.g + (b.g - a.g) * k, a.b + (b.b - a.b) * k)
  }
  static func + (_ a: Vec3, _ b: Vec3) -> Vec3 { Vec3(a.r + b.r, a.g + b.g, a.b + b.b) }
  static func * (_ a: Vec3, _ s: Double) -> Vec3 { Vec3(a.r * s, a.g * s, a.b * s) }
}

struct Node { let x: Double; let y: Double; let nx: Double; let ny: Double; let hw: Double; let t: Double }

let N = 180
var nodes: [Node] = []
do {
  var raw: [(x: Double, y: Double, hw: Double, t: Double)] = []
  for i in 0...N {
    let t = Double(i) / Double(N)
    let r: Double
    if t <= 0.48 {
      let u = t / 0.48
      r = 2.0 + 314.0 * pow(sin(u * Double.pi * 0.5), 1.08)
    } else {
      let u = (t - 0.48) / 0.52
      r = 316.0 - 28.0 * pow(u, 1.55)
    }
    let phi = -Double.pi / 2.0 + t * (1.18 * Double.pi)
    let hw: Double
    if t < 0.44 {
      let u = t / 0.44
      hw = 1.5 + 60.5 * pow(sin(u * Double.pi * 0.5), 0.92)
    } else if t <= 0.68 {
      hw = 62.0 + 2.0 * sin(((t - 0.44) / 0.24) * Double.pi)
    } else {
      let u = (t - 0.68) / 0.32
      hw = 62.0 - 38.0 * pow(u, 1.35)
    }
    raw.append((r * cos(phi), r * sin(phi), hw, t))
  }
  for i in 0...N {
    let a = raw[max(0, i - 1)]
    let b = raw[min(N, i + 1)]
    let dx = b.x - a.x
    let dy = b.y - a.y
    let len = max(1e-6, hypot(dx, dy))
    // Right-hand outward normal along spiraling ribbon
    var nx = dy / len
    var ny = -dx / len
    if nx * raw[i].x + ny * raw[i].y < 0 {
      nx = -nx; ny = -ny
    }
    nodes.append(Node(x: raw[i].x, y: raw[i].y, nx: nx, ny: ny, hw: raw[i].hw, t: raw[i].t))
  }
}

let cos120 = cos(2.0 * Double.pi / 3.0)
let sin120 = sin(2.0 * Double.pi / 3.0)
let cos240 = cos(4.0 * Double.pi / 3.0)
let sin240 = sin(4.0 * Double.pi / 3.0)

struct Hit { let alpha: Double; let color: Vec3; let z: Double; let shadowDist: Double }

func evalRibbon(_ px: Double, _ py: Double, radDist: Double) -> Hit {
  // Coarse search over nodes every 4 steps, then refine closest Euclidean distance to swept circular cross-section
  var bestI = 0
  var bestD2 = Double.infinity
  var idx = 0
  while idx <= N {
    let dx = px - nodes[idx].x
    let dy = py - nodes[idx].y
    let d2 = dx * dx + dy * dy
    if d2 < bestD2 { bestD2 = d2; bestI = idx }
    idx += 4
  }
  let lo = max(0, bestI - 8)
  let hi = min(N - 1, bestI + 8)
  var minD = Double.infinity
  var bestT = 0.0
  var bestU = 0.0
  for i in lo...hi {
    let a = nodes[i]
    let b = nodes[i + 1]
    let abx = b.x - a.x
    let aby = b.y - a.y
    let ab2 = max(1e-8, abx * abx + aby * aby)
    let proj = clamp(((px - a.x) * abx + (py - a.y) * aby) / ab2, 0.0, 1.0)
    let cx = a.x + abx * proj
    let cy = a.y + aby * proj
    let nx = a.nx + (b.nx - a.nx) * proj
    let ny = a.ny + (b.ny - a.ny) * proj
    let hw = a.hw + (b.hw - a.hw) * proj
    let t = a.t + (b.t - a.t) * proj
    let lat = (px - cx) * nx + (py - cy) * ny
    let d = hypot(px - cx, py - cy) - hw
    if d < minD {
      minD = d
      bestU = clamp(lat / max(1e-5, hw), -1.0, 1.0)
      bestT = t
    }
  }

  let alpha = smoothstep(1.2, -1.2, minD)
  if alpha <= 0.001 && minD > 36.0 {
    return Hit(alpha: 0.0, color: Vec3(0, 0, 0), z: 1.0 - bestT, shadowDist: minD)
  }

  // Smooth minimalist Baryon palette:
  // Inner core (radDist < 175): molten cream-gold & fiery amber
  // Outer sweeps: silky deep obsidian-indigo shadow -> cobalt-violet -> crisp icy-cyan outer satin edge
  let warmMix = 1.0 - smoothstep(42.0, 215.0, radDist)
  let innerDark = Vec3(0.035, 0.045, 0.145)
  let cobaltMid = Vec3(0.20, 0.30, 0.78)
  let violetAccent = Vec3(0.32, 0.34, 0.92)
  let cyanRim = Vec3(0.56, 0.90, 1.00)
  let iceSpec = Vec3(0.88, 0.98, 1.00)

  let amberHot = Vec3(1.00, 0.92, 0.72)
  let orangeMid = Vec3(0.96, 0.45, 0.12)
  let deepCopper = Vec3(0.36, 0.12, 0.06)

  // Cross-section volumetric shading: concave side darkens into glassy shadow, outer convex side catches cyan rim light
  let foldT = smoothstep(-0.75, 0.45, bestU)
  let cobaltBand = Vec3.mix(cobaltMid, violetAccent, smoothstep(0.35, 0.75, bestT))
  var col = Vec3.mix(innerDark, cobaltBand, foldT)

  // Smooth icy-cyan rim highlight sweeping gracefully across the upper-outer crest (fades at both ends so zero blunt stops)
  let crestFade = smoothstep(0.18, 0.40, bestT) * (1.0 - smoothstep(0.68, 0.95, bestT))
  let rimBand = exp(-pow((bestU - 0.74) / 0.24, 2.0)) * crestFade
  let rimCore = exp(-pow((bestU - 0.78) / 0.10, 2.0)) * crestFade
  col = Vec3.mix(col, cyanRim, rimBand * 0.72)
  col = Vec3.mix(col, iceSpec, rimCore * 0.65)

  // Blend in molten warm Baryon amber-gold near the central singularity
  let warmBody = Vec3.mix(deepCopper, orangeMid, smoothstep(-0.65, 0.35, bestU))
  let warmLit = Vec3.mix(warmBody, amberHot, pow(1.0 - smoothstep(14.0, 125.0, radDist), 1.4))
  col = Vec3.mix(col, warmLit, warmMix)

  // Subtle fade out at t -> 1 where ribbon tucks completely under the next ribbon
  let tailAlpha = alpha * (1.0 - smoothstep(0.86, 0.99, bestT))
  return Hit(alpha: tailAlpha, color: col, z: 1.0 - bestT, shadowDist: minD)
}

var iosRGB = [UInt8](repeating: 0, count: size * size * 4)
var seed: UInt64 = 1234567

for y in 0..<size {
  for x in 0..<size {
    let px = Double(x) + 0.5 - halfS
    let py = Double(y) + 0.5 - halfS
    let rad = hypot(px, py)

    // Smooth dark obsidian sky + subtle ambient top-indigo glow + molten amber core halo
    let topGlow = max(0.0, 1.0 - hypot(px, py - 140.0) / 600.0)
    var base = Vec3(0.022, 0.025, 0.044)
    base = Vec3.mix(base, Vec3(0.070, 0.092, 0.215), topGlow * topGlow * 0.42)
    let ambientHalo = exp(-pow(rad / 205.0, 2.0)) * 0.32
    base = base + Vec3(0.95, 0.46, 0.12) * ambientHalo

    if rad <= 390.0 {
      // Three exact 120-deg rotations
      let h0 = evalRibbon(px, py, radDist: rad)
      let p1x = px * cos120 + py * sin120
      let p1y = -px * sin120 + py * cos120
      let h1 = evalRibbon(p1x, p1y, radDist: rad)
      let p2x = px * cos240 + py * sin240
      let p2y = -px * sin240 + py * cos240
      let h2 = evalRibbon(p2x, p2y, radDist: rad)

      var hits = [h0, h1, h2]
      hits.sort { $0.z < $1.z }

      for i in 0..<3 {
        let h = hits[i]
        // Cast soft occlusion shadow from any ribbon above h onto h
        var occ = 1.0
        if i < 2 {
          for j in (i + 1)..<3 {
            let above = hits[j]
            if above.shadowDist < 34.0 {
              let sMask = smoothstep(34.0, -4.0, above.shadowDist) * (1.0 - smoothstep(0.0, 0.25, above.alpha) * 0.15)
              occ *= (1.0 - sMask * 0.62)
            }
          }
        }
        if h.alpha > 0.001 {
          base = Vec3.mix(base, h.color * occ, h.alpha)
        }
      }
    }

    // Radiant Baryon ignition core light right at the center vortex
    let coreGlow = exp(-pow(rad / 46.0, 2.0)) * 0.72 + exp(-pow(rad / 120.0, 2.0)) * 0.24
    base = base + Vec3(1.00, 0.85, 0.56) * coreGlow

    // Seeded micro-dither prevents gradient banding on dark obsidian
    seed = (seed &* 16807) % 2147483647
    let noise = (Double(seed) / 2147483647.0 - 0.5) * 1.6 / 255.0
    let idx = (y * size + x) * 4
    iosRGB[idx]     = UInt8(clamp(round((base.r + noise) * 255.0), 0.0, 255.0))
    iosRGB[idx + 1] = UInt8(clamp(round((base.g + noise) * 255.0), 0.0, 255.0))
    iosRGB[idx + 2] = UInt8(clamp(round((base.b + noise) * 255.0), 0.0, 255.0))
    iosRGB[idx + 3] = 255
  }
}

let cs = CGColorSpace(name: CGColorSpace.sRGB)!
iosRGB.withUnsafeMutableBytes { buf in
  guard let ctx = CGContext(
    data: buf.baseAddress, width: size, height: size, bitsPerComponent: 8, bytesPerRow: size * 4,
    space: cs, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
  ), let img = ctx.makeImage(),
        let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: iosOutPath) as CFURL, UTType.png.identifier as CFString, 1, nil) else { exit(1) }
  CGImageDestinationAddImage(dest, img, [kCGImagePropertyHasAlpha: false] as CFDictionary)
  CGImageDestinationFinalize(dest)
}

// Mask into Apple's 824x824 continuous superellipse squircle + subtle top specular glass rim for macOS
var rgba = [UInt8](repeating: 0, count: size * size * 4)
let tile: Double = 824.0
let inset: Double = (Double(size) - tile) / 2.0
let scale: Double = Double(size) / tile

@inline(__always) func squircle(_ u: Double, _ v: Double, _ half: Double = 512.0) -> Double {
  return pow(abs(u - 512.0) / half, 5.2) + pow(abs(v - 512.0) / half, 5.2)
}

for y in 0..<size {
  for x in 0..<size {
    let midU = (Double(x) + 0.5 - inset) * scale
    let midV = (Double(y) + 0.5 - inset) * scale
    let midSq = squircle(midU, midV)
    if midSq > 1.18 { continue }
    let n = (midSq < 0.86) ? 1 : 4
    let sx = max(0, min(size - 1, Int(round(midU))))
    let sy = max(0, min(size - 1, Int(round(midV))))
    let sIdx = (sy * size + sx) * 4
    let r0 = Double(iosRGB[sIdx])
    let g0 = Double(iosRGB[sIdx + 1])
    let b0 = Double(iosRGB[sIdx + 2])

    var hits = 0
    var rimHits = 0
    for j in 0..<n {
      for i in 0..<n {
        let u = (Double(x) + (Double(i) + 0.5) / Double(n) - inset) * scale
        let v = (Double(y) + (Double(j) + 0.5) / Double(n) - inset) * scale
        if squircle(u, v) <= 1.0 {
          hits += 1
          if squircle(u, v, 508.5) > 1.0 { rimHits += 1 }
        }
      }
    }
    if hits == 0 { continue }
    let a = Double(hits) / Double(n * n)
    let rimFrac = Double(rimHits) / Double(hits)
    let topShade = max(0.03, 0.14 * (1.0 - Double(y) / Double(size)))
    let mixWhite = rimFrac * topShade
    let idx = (y * size + x) * 4
    rgba[idx]     = UInt8(min(255.0, round((r0 + (225.0 - r0) * mixWhite) * a)))
    rgba[idx + 1] = UInt8(min(255.0, round((g0 + (235.0 - g0) * mixWhite) * a)))
    rgba[idx + 2] = UInt8(min(255.0, round((b0 + (255.0 - b0) * mixWhite) * a)))
    rgba[idx + 3] = UInt8(round(255.0 * a))
  }
}

rgba.withUnsafeMutableBytes { buf in
  guard let macCtx = CGContext(
    data: buf.baseAddress, width: size, height: size, bitsPerComponent: 8, bytesPerRow: size * 4,
    space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
  ), let macImg = macCtx.makeImage(),
        let macDest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: macOutPath) as CFURL, UTType.png.identifier as CFString, 1, nil) else {
    exit(1)
  }
  CGImageDestinationAddImage(macDest, macImg, nil)
  CGImageDestinationFinalize(macDest)
}
`;

interface VortexPoint {
  x: number;
  y: number;
  halfW: number;
}

// Sleek 3-fold spiral vortex / triskelion knot for the menu bar template icon (22 units across, centered at 0,0).
const VORTEX_ARMS: VortexPoint[][] = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3].map((offset) => {
  const pts: VortexPoint[] = [];
  const steps = 40;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const r = 2.35 + 6.55 * Math.pow(t, 0.92);
    const angle = offset - Math.PI / 2 + t * 2.25;
    const halfW = 0.65 + 1.05 * Math.sin(Math.pow(t, 0.78) * Math.PI * 0.94);
    pts.push({ x: r * Math.cos(angle), y: r * Math.sin(angle), halfW });
  }
  return pts;
});

function inBaryon(x: number, y: number): boolean {
  const d = Math.hypot(x, y);
  if (d < 1.35 || d > 10.6) return false;
  for (const arm of VORTEX_ARMS) {
    for (let i = 0; i < arm.length; i++) {
      const p = arm[i];
      if (Math.hypot(x - p.x, y - p.y) <= p.halfW) return true;
    }
  }
  return false;
}

// Fairy's classic eye for the menu bar pair: notched ring, relaxed lid, and pupil. Measured from the centre, 22 units across.
function inEye(x: number, y: number): boolean {
  const d = Math.hypot(x, y);
  const turn = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 90;
  if (d > 9 && d <= 10.8) return Math.abs(turn - 45) > 9;
  if (d > 7.4) return false;
  if (y < -2.1 + x * 0.12 || d > 6.2) return true;
  return Math.hypot(x, y - 0.6) <= 3.4 && Math.hypot(x + 1.4, y - 0.2) > 1;
}

// Menu bar template: black pixels with alpha; macOS tints them for light/dark menus.
function trayIcon(size: number, samples = 5): Buffer {
  const out = Buffer.alloc(size * size * 4);
  const scale = 22 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let j = 0; j < samples; j++) {
        for (let i = 0; i < samples; i++) {
          if (inBaryon((x + (i + 0.5) / samples) * scale - 11, (y + (j + 0.5) / samples) * scale - 11)) hits++;
        }
      }
      out[(y * size + x) * 4 + 3] = Math.round((255 * hits) / samples ** 2);
    }
  }
  return out;
}

// Paired menu bar template: Baryon vortex on left + Fairy's classic eye on right (46 x 22 logical pt).
function trayPairIcon(width: number, height: number, samples = 5): Buffer {
  const out = Buffer.alloc(width * height * 4);
  const scale = 22 / height;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let hits = 0;
      for (let j = 0; j < samples; j++) {
        for (let i = 0; i < samples; i++) {
          const ux = (x + (i + 0.5) / samples) * scale;
          const uy = (y + (j + 0.5) / samples) * scale - 11;
          if (inBaryon((ux - 11) * 1.12, uy * 1.12) || inEye(ux - 35, uy)) hits++;
        }
      }
      out[(y * width + x) * 4 + 3] = Math.round((255 * hits) / samples ** 2);
    }
  }
  return out;
}

const swiftSrcPath = join(tmpdir(), 'baryon-icon-shader.swift');
const swiftBinPath = join(tmpdir(), 'baryon-icon-shader');
writeFileSync(swiftSrcPath, swiftShader);
try {
  execFileSync('/usr/bin/swiftc', ['-O', '-module-cache-path', '/tmp/fairy-swift-cache', swiftSrcPath, '-o', swiftBinPath], { stdio: 'inherit' });
  execFileSync(swiftBinPath, [join(root, 'assets/app-icon.png'), join(root, 'ios/Fairy/Assets.xcassets/AppIcon.appiconset/icon-1024.png')], { stdio: 'inherit' });
} finally {
  rmSync(swiftSrcPath, { force: true });
  rmSync(swiftBinPath, { force: true });
}

const keep = (from: string, to: string): void => {
  if (existsSync(from) && !existsSync(to)) copyFileSync(from, to);
};
keep(join(root, 'assets/tray/trayTemplate.png'), join(root, 'assets/tray/trayTemplate-classic.png'));
keep(join(root, 'assets/tray/trayTemplate@2x.png'), join(root, 'assets/tray/trayTemplate-classic@2x.png'));
png(join(root, 'assets/tray/trayTemplate.png'), 22, trayIcon(22));
png(join(root, 'assets/tray/trayTemplate@2x.png'), 44, trayIcon(44));
pngRect(join(root, 'assets/tray/trayPairTemplate.png'), 46, 22, trayPairIcon(46, 22));
pngRect(join(root, 'assets/tray/trayPairTemplate@2x.png'), 92, 44, trayPairIcon(92, 44));
console.log('Rendered minimalist Baryon app and menu bar icons.');
