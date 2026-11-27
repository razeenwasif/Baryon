import { paintFairy, fairyHit, FAIRY_GRID, FAIRY_CENTER, FAIRY_SHAPE, OPEN_EXPRESSION } from './fairy-pixels.js';

const FAIRY_DISC = FAIRY_SHAPE.disc + 1.4;
import { seatedPose } from './seated-sequence.js';
import { drawFairySmooth } from './fairy-smooth.js';

const CURSOR_GAZE = [[-3.2, 0], [-2.3, -2.3], [0, -3.2], [2.3, -2.3], [3.2, 0], [0, 3]];
const EASED = ['lid', 'low', 'squint', 'tilt', 'gx', 'gy', 'pupil', 'glow', 'rot', 'scale', 'dashed', 'heart', 'rimHue'];
const clamp01 = x => Math.max(0, Math.min(1, x));
const pulse = (t, start, length) => { const p = (t - start) / length; return p <= 0 || p >= 1 ? 0 : 1 - Math.abs(2 * p - 1); };

/**
 * Fairy reads the SpriteAvatar's existing state machines (speech, thinking,
 * music, naps, seated rests, reactions, walks, cursor gaze) and turns each
 * into an eye expression. Values ease between states; blinks and spikes do not.
 */
export class FairyRenderer {
  constructor(random = Math.random) {
    this.random = random;
    this.buffer = document.createElement('canvas');this.buffer.width = this.buffer.height = FAIRY_GRID;
    this.bctx = this.buffer.getContext('2d');this.image = this.bctx.createImageData(FAIRY_GRID, FAIRY_GRID);
    this.state = { ...OPEN_EXPRESSION };this.last = null;
    this.nextBlink = 2 + random() * 3;this.blinkAt = -1;this.nextSaccade = 1;this.saccade = { x: 0, y: 0 };this.spin = 0;
  }

  target(a, t) {
    const e = { ...OPEN_EXPRESSION, glow: .42 + Math.sin(t * 2.2) * .08 }, extras = [];let bob = Math.sin(t * 2.2) * .8, blink = true;
    const speaking = a.activity === 'speaking' || a._mouth > .05, waving = t < a.waveUntil;
    const reaction = a.reaction.kind && a.reactionEligible() ? a.reaction : null, companion = a.companion.kind ? a.companion.sample() : null;
    const resting = a.idleAnimation.phase !== 'idle' && a.canSit();
    const music = a.activity === 'singing' || a.vocalMusic || companion?.kind === 'headphones';
    if (waving) {
      // A double wink with a bounce and a sparkle on each side.
      const w = 2.8 - (a.waveUntil - t);
      e.lid = -1.2 + 2.3 * Math.max(pulse(w, .35, .35), pulse(w, 1.2, .35));e.glow = .75;bob = Math.sin(t * 10) * 1.6;e.rot = Math.sin(t * 8) * .06;blink = false;
      extras.push({ glyph: 'spark', x: 8, y: 18 + Math.sin(t * 6) * 2 }, { glyph: 'spark', x: 72, y: 16 + Math.cos(t * 6) * 2 });
    } else if (speaking) {
      const m = Math.max(a._mouth, .2);
      // Relaxed, with the upper lid resting on the iris rings as in the reference art.
      e.lid = -.8;e.pupil = 1 + m * .28;e.glow = .55 + m * .45;bob = Math.sin(t * 12) * m * 1.3;e.gx = Math.sin(t * 1.7) * .8;
    } else if (a.activity === 'thinking') {
      // Half-lidded, looking up and to the side while the iris ring scans.
      e.lid = -.2;e.gx = 2 + Math.sin(t * .9) * .9;e.gy = -2.2;e.dashed = 1;this.spin += a.lastDt * 2.4;e.glow = .5;bob = Math.sin(t * 2) * .5;blink = false;
    } else if (reaction) {
      const r = reaction.time;
      if (reaction.kind === 'laugh') { e.squint = 1;e.glow = .85;bob = -Math.abs(Math.sin(t * 9)) * 2.2;e.rot = Math.sin(t * 6) * .05;extras.push({ glyph: 'spark', x: 10, y: 14 }, { glyph: 'spark', x: 70, y: 14 }); }
      else if (reaction.kind === 'surprise') { e.lid = -1.6;e.pupil = .68;e.scale = 1 + .05 * clamp01(1 - r / .5);e.glow = .9;bob = -3 * clamp01(1 - r / .4); }
      else { e.lid = -.25;e.tilt = .28;e.gx = -2.2;e.gy = 1.6;e.rot = -.06;e.glow = .3; }
      blink = false;
    } else if (music) {
      // Bounce on the beat (~108 BPM), lavender rim, a happy squint on downbeats.
      const beat = Math.abs(Math.sin(t * 3.6 * Math.PI));
      bob = -beat * 2.6;e.rot = Math.sin(t * 1.8 * Math.PI) * .08;e.gx = Math.cos(t * 1.8 * Math.PI) * 2;e.glow = .55 + beat * .45;e.rimHue = .5 + beat * .5;
      e.squint = beat > .82 ? 1 : 0;blink = false;
    } else if (companion?.kind === 'sleep') {
      if (companion.phase === 'yawn') { e.lid = .45;e.pupil = 1.15;e.glow = .3; }
      else if (companion.phase === 'stretch') { e.lid = -1.6;e.scale = 1.04;bob = -2;e.glow = .7; }
      else {
        e.lid = 1.15;e.glow = .12;bob = Math.sin(t * 1.1) * .9;
        for (let k = 0; k < 3; k++) { const p = (t * .35 + k / 3) % 1;extras.push({ glyph: 'z', x: 62 + p * 10, y: 16 - p * 14, alpha: 1 - p }); }
      }
      blink = false;
    } else if (companion?.kind === 'yawn') {
      const y = a.companion.time / 7.2;e.lid = y < .45 ? .5 : y < .7 ? -1.5 : -1.1;e.pupil = y < .45 ? 1.15 : .8;bob = y < .45 ? 1 : -1.5;blink = false;
    } else if (companion?.kind === 'hair') {
      // Eye roll: the iris circles once.
      const angle = a.companion.time / 3.8 * Math.PI * 2 - Math.PI / 2;e.gx = Math.cos(angle) * 3.2;e.gy = Math.sin(angle) * 3.2;e.lid = -.9;
    } else if (companion?.kind === 'halo') {
      // A comet of light races around the rim.
      const angle = a.companion.time / 1.4 * Math.PI * 2;e.glow = .85;
      for (let k = 0; k < 3; k++) extras.push({ glyph: 'spark', x: FAIRY_CENTER.x + Math.cos(angle - k * .25) * 31, y: FAIRY_CENTER.y + Math.sin(angle - k * .25) * 31, alpha: 1 - k * .3 });
    } else if (companion?.kind === 'stars') {
      // Track a falling star, then a happy squint when it is caught.
      const p = clamp01(a.companion.time / 6);const sx = 10 + p * 60, sy = 8 + Math.sin(p * Math.PI) * -4 + p * 6;
      e.gx = (sx - FAIRY_CENTER.x) / 10;e.gy = (sy - FAIRY_CENTER.y) / 10;e.glow = .6;
      if (p < 1) extras.push({ glyph: 'star', x: sx, y: sy });else { e.squint = 1;e.glow = .9; }
    } else if (companion?.kind === 'legs') {
      e.rot = Math.sin(t * 1.3) * .07;e.gx = Math.sin(t * 1.3) * 2.6;bob = Math.sin(t * 2.6) * .9;
    } else if (a.walking) {
      const dir = a.walking.direction > 0 ? 1 : -1;e.rot = dir * .08;e.gx = dir * 2.6;bob = Math.sin((a.walking.travel || 0) * .6) * 1.2;
    } else if (resting) {
      // Rests replace Fairy's seated scenes: dreamy, with heart and peek-a-boo gestures.
      e.lid = -.1;e.gy = 1.4;bob = Math.sin(t * 1.4) * .6;
      if (a.idleAnimation.phase === 'seated') {
        const pose = seatedPose(a.idleAnimation.time, this.seated ??= {});
        if (pose.kind === 'finger') { e.heart = 1;e.lid = -.7;e.glow = .7;e.gy = 0; }
        else if (pose.kind === 'peek') { e.lid = pose.frame >= 1 && pose.frame <= 3 ? 1.15 : pose.frame >= 4 && pose.frame <= 5 ? -1.6 : -.6;if (pose.frame === 4) extras.push({ glyph: 'spark', x: 70, y: 18 });blink = false; }
        else e.gx = Math.sin(t * .4) * 1.5;
      }
    } else if (a.cursorEligible() && a.cursorGaze.frame !== null) {
      [e.gx, e.gy] = CURSOR_GAZE[a.cursorGaze.frame];
    } else {
      // Idle: small saccades between longer fixations.
      if (t >= this.nextSaccade) { this.saccade = { x: (this.random() - .5) * 3, y: (this.random() - .5) * 2 };this.nextSaccade = t + 1.4 + this.random() * 2.8; }
      e.gx = this.saccade.x;e.gy = this.saccade.y;
    }
    e.spin = this.spin;
    return { e, extras, bob, blink };
  }

  render(a, ctx, cssW, cssH, dpr) {
    const t = a.elapsed, dt = Math.max(0, Math.min(.1, this.last === null ? 0 : t - this.last));this.last = t;a.lastDt = dt;
    const still = a.reducedMotion.matches || !a.optionalMotion;
    const { e, extras, bob, blink } = still ? { e: { ...OPEN_EXPRESSION }, extras: [], bob: 0, blink: false } : this.target(a, t);
    const k = Math.min(1, dt * 9);
    for (const key of EASED) this.state[key] += (e[key] - this.state[key]) * (dt ? k : 1);
    this.state.spin = e.spin;
    const shown = { ...this.state };
    if (blink) {
      if (t >= this.nextBlink) { this.blinkAt = t;this.nextBlink = t + 2.5 + this.random() * 3.5 + (this.random() < .2 ? -2 : 0); }
      const b = pulse(t, this.blinkAt, .2);if (b) shown.lid = shown.lid + (1.15 - shown.lid) * Math.min(1, b * 1.6);
    } else this.nextBlink = Math.max(this.nextBlink, t + 1.5);
    // Floating, she's the pixel sprite; in the window she's drawn smooth (fairy-smooth.js), the same eye at any size.
    const pixel = a.floating;
    if (pixel) { paintFairy(this.image.data, shown, extras);this.bctx.putImageData(this.image, 0, 0); }

    // Integer device-pixel scale keeps every Fairy pixel square and sharp; smooth, she takes the size she fits.
    // Floating: small enough that the radial menu's outer arcs fit beside the eye in a 350px window.
    const fit = a.floating ? Math.min(cssW * .6, cssH * .5) : Math.min(cssW, cssH) * .6;
    const scale = pixel ? Math.max(1, Math.floor(fit * dpr / FAIRY_GRID)) / dpr : fit / FAIRY_GRID, size = FAIRY_GRID * scale;
    // Floating: the eye's centre sits about 200px above the bottom, leaving room for the menu and status line.
    let destX = Math.round((cssW - size) / 2), destY = a.floating ? Math.max(0, Math.round(cssH - 200 - size * FAIRY_CENTER.y / FAIRY_GRID)) : Math.round((cssH - size) / 2 - cssH * .04);
    // The radial menu centres on the eye without the idle bob, so it does not jitter.
    this.anchor = { x: destX + size * FAIRY_CENTER.x / FAIRY_GRID, y: destY + size * FAIRY_CENTER.y / FAIRY_GRID, r: size * FAIRY_DISC / FAIRY_GRID };
    destY += pixel ? Math.round(bob * scale) : bob * scale;
    if (pixel) { ctx.imageSmoothingEnabled = false;ctx.drawImage(this.buffer, destX, destY, size, size); }
    else drawFairySmooth(ctx, destX, destY, size, shown, extras);
    this.layout = { destX, destY, size };
    return { x: destX + size * FAIRY_CENTER.x / FAIRY_GRID, y: destY + size * .2 };
  }

  hitTest(canvas, clientX, clientY) {
    if (!this.layout) return false;
    const rect = canvas.getBoundingClientRect(), { destX, destY, size } = this.layout;
    return fairyHit((clientX - rect.left - destX) / size * FAIRY_GRID, (clientY - rect.top - destY) / size * FAIRY_GRID);
  }
}
