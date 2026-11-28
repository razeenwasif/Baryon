import { spriteSeams } from './sprite-sheet.js';
import finger from '../assets/animation/prepared/finger-transparent.png';
import chin from '../assets/animation/prepared/chin-transparent.png';
import peek from '../assets/animation/peek-a-boo.png';
import yawn from '../assets/animation/yawn-and-stretch.png';
import laugh from '../assets/animation/prepared/laugh-transparent.png';
import surprise from '../assets/animation/prepared/surprise-transparent.png';
import pout from '../assets/animation/prepared/pout-transparent.png';
import stars from '../assets/animation/star-catching.png';
import cursor from '../assets/animation/cursor-tracking.png';
import headphones from '../assets/animation/headphone-dance-bop.png';
import hair from '../assets/animation/hair-twirl.png';
import halo from '../assets/animation/halo-adjust.png';
import sleep from '../assets/animation/sleeping.png';
import legs from '../assets/animation/swinging-legs.png';

export type AnimationSheetKind =
  | 'finger'
  | 'chin'
  | 'peek'
  | 'yawn'
  | 'laugh'
  | 'surprise'
  | 'pout'
  | 'stars'
  | 'cursor'
  | 'headphones'
  | 'hair'
  | 'halo'
  | 'sleep'
  | 'legs';

interface SheetSpec {
  readonly url: string;
  readonly count: number;
  readonly desk?: boolean;
}

export interface AnimationSheetFrame extends HTMLCanvasElement {
  naturalWidth: number;
  naturalHeight: number;
  loaded: boolean;
  companion: string;
  desk: boolean;
}

export interface AnimationSheetEntry {
  frames: AnimationSheetFrame[];
  used: number;
}

const SHEETS: Record<string, SheetSpec> = {
  finger: { url: finger, count: 5, desk: true },
  chin: { url: chin, count: 1, desk: true },
  peek: { url: peek, count: 8, desk: true },
  yawn: { url: yawn, count: 8 },
  laugh: { url: laugh, count: 6, desk: true },
  surprise: { url: surprise, count: 6, desk: true },
  pout: { url: pout, count: 6, desk: true },
  stars: { url: stars, count: 8 },
  cursor: { url: cursor, count: 8 },
  headphones: { url: headphones, count: 8 },
  hair: { url: hair, count: 8 },
  halo: { url: halo, count: 10 },
  sleep: { url: sleep, count: 8 },
  legs: { url: legs, count: 8 },
};

// Two decoded families maximum, one load in flight; original PNG files stay intact.
export class AnimationSheets {
  entries: Map<string, AnimationSheetEntry>;
  failed: Set<string>;
  pending: HTMLImageElement | null;
  disposed: boolean;
  serial: number;

  constructor() {
    this.entries = new Map();
    this.failed = new Set();
    this.pending = null;
    this.disposed = false;
    this.serial = 0;
  }

  get(kind: string): AnimationSheetFrame[] | null {
    const entry = this.entries.get(kind);
    if (entry) {
      entry.used = ++this.serial;
      return entry.frames;
    }
    return null;
  }

  ensure(kind: string): void {
    const spec = SHEETS[kind];
    if (this.disposed || this.entries.has(kind) || this.failed.has(kind) || this.pending || !spec) return;
    const image = new Image();
    this.pending = image;
    image.onload = () => {
      image.onload = image.onerror = null;
      this.pending = null;
      if (this.disposed) return;
      try {
        // Evict before allocating the next family, not after.
        if (this.entries.size >= 2) {
          const oldest = [...this.entries].sort((a, b) => a[1].used - b[1].used)[0];
          this.release(oldest[1]);
          this.entries.delete(oldest[0]);
        }
        const frames = this.extract(image, spec.count, kind);
        this.entries.set(kind, { frames, used: ++this.serial });
      } catch {
        this.failed.add(kind);
      }
    };
    image.onerror = () => {
      image.onload = image.onerror = null;
      this.pending = null;
      this.failed.add(kind);
    };
    image.src = spec.url;
  }

  extract(image: HTMLImageElement, count: number, kind: string): AnimationSheetFrame[] {
    const source = document.createElement('canvas');
    source.width = image.width;
    source.height = image.height;
    const sc = source.getContext('2d', { willReadFrequently: true });
    if (!sc) throw new Error('2D canvas context unavailable');
    sc.drawImage(image, 0, 0);
    // The sheet's external arrows are direction annotations, not avatar art.
    // Do not use the final two poses (one arrow overlaps the chest).
    if (kind === 'cursor') {
      for (const [x, y, w, h] of [[25, 128, 45, 66], [302, 65, 45, 61], [696, 8, 45, 62], [1040, 64, 45, 62], [1312, 164, 43, 64], [1590, 221, 44, 65]] as const) {
        sc.clearRect(x, y, w, h);
      }
    }
    // Restore the small halo area occluded by the up-arrow from the clean left pose.
    if (kind === 'cursor') sc.drawImage(image, 156, 40, 45, 40, 696, 50, 45, 40);
    const pixels = sc.getImageData(0, 0, image.width, image.height).data;
    const centers = Array.from({ length: count }, (_, i) => (i + .5) * image.width / count);
    const seams = spriteSeams(pixels, image.width, image.height, centers);
    const frames: AnimationSheetFrame[] = [];
    const desk = Boolean(SHEETS[kind]?.desk);
    let top = image.height;
    let bottom = 0;
    if (desk) {
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          if (pixels[(y * image.width + x) * 4 + 3] > 24) {
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
          }
        }
      }
    }
    const deskScale = desk ? Math.min(400 / (image.width / count * (kind === 'chin' ? .75 : 1)), 500 / Math.max(1, bottom - top + 1)) : 0;
    try {
      for (let i = 0; i < (kind === 'cursor' ? 6 : count); i++) {
        let left = image.width;
        let right = 0;
        for (let y = 0; y < image.height; y++) {
          for (let x = seams[i][y]; x < seams[i + 1][y]; x++) {
            if (pixels[(y * image.width + x) * 4 + 3] > 24) {
              left = Math.min(left, x);
              right = Math.max(right, x);
            }
          }
        }
        if (right <= left) throw Error('Empty pose');
        const canvas = document.createElement('canvas') as AnimationSheetFrame;
        canvas.width = 210;
        canvas.height = 380;
        canvas.naturalWidth = 840;
        canvas.naturalHeight = 1520;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('2D canvas context unavailable');
        ctx.scale(.5, .5);
        ctx.imageSmoothingEnabled = false;
        const scale = desk ? deskScale : Math.min(700 / image.height, 400 / (right - left + 1));
        ctx.translate(210 - (desk ? centers[i] : (left + right + 1) / 2) * scale, desk ? 520 - (bottom + 1) * scale : 700 - image.height * scale);
        ctx.scale(scale, scale);
        ctx.beginPath();
        ctx.moveTo(seams[i][0], 0);
        for (let y = 0; y < image.height; y++) ctx.lineTo(seams[i][y], y);
        for (let y = image.height - 1; y >= 0; y--) ctx.lineTo(seams[i + 1][y], y);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(source, 0, 0);
        canvas.loaded = true;
        canvas.companion = kind;
        canvas.desk = desk;
        frames.push(canvas);
      }
      return frames;
    } catch (error) {
      for (const frame of frames) frame.width = frame.height = 0;
      throw error;
    } finally {
      source.width = source.height = 0;
    }
  }

  release(entry: AnimationSheetEntry): void {
    for (const frame of entry.frames) frame.width = frame.height = 0;
  }

  dispose(): void {
    this.disposed = true;
    if (this.pending) {
      this.pending.onload = this.pending.onerror = null;
      this.pending.src = '';
      this.pending = null;
    }
    for (const e of this.entries.values()) this.release(e);
    this.entries.clear();
    this.failed.clear();
  }
}
