import { FAIRY_CENTER, FAIRY_COLORS, FAIRY_GRID, FAIRY_SHAPE, OPEN_EXPRESSION } from './fairy-pixels.js';

// Fairy drawn smooth, for the full window: the same eye as the pixel art in fairy-pixels.js (the same shapes, colours,
// lids, gaze and expressions, in the same grid units) but drawn with vector paths at any size, with soft gradients where
// the pixel art dithers. The floating sprite keeps the pixels.
const rgb = (c, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));

// The casing's squircle: |x|⁴ + |y|⁴ = r⁴.
function squircle(ctx, r) {
  ctx.beginPath();
  for (let i = 0; i <= 96; i++) {
    const t = i / 96 * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
    const x = r * Math.sign(c) * Math.sqrt(Math.abs(c)), y = r * Math.sign(s) * Math.sqrt(Math.abs(s));
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.closePath();
}

// The lids as two curves across the eye, as fairy-pixels.js shapes them.
function lids(e, S) {
  const lidY = (e.lid ?? -1.2) * S.sclera, lowY = (e.low ?? 1.2) * S.sclera, tilt = e.tilt || 0, sq = clamp(e.squint || 0);
  return ex => {
    const bulge = 1 - Math.min(1, (ex / S.sclera) ** 2);
    let upper = lidY + bulge * 2.2 + tilt * ex, lower = lowY - bulge * 3.2;
    if (sq) { upper = upper * (1 - sq) + (1.5 - 8 * bulge) * sq; lower = lower * (1 - sq) + (6 - 8 * bulge) * sq; }
    return { upper, lower, happy: 1.5 - 8 * bulge };
  };
}
// A band between two curves across the eye, f(ex) → [top, bottom].
function band(ctx, r, f) {
  const steps = 48;
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) { const ex = -r + 2 * r * i / steps, [top] = f(ex); i ? ctx.lineTo(ex, top) : ctx.moveTo(ex, top); }
  for (let i = steps; i >= 0; i--) { const ex = -r + 2 * r * i / steps, [, bottom] = f(ex); ctx.lineTo(ex, bottom); }
  ctx.closePath();
}

function glyph(ctx, { glyph: kind, x, y, color, alpha = 1 }) {
  const C = FAIRY_COLORS, c = color || (kind === 'z' ? C.z : kind === 'star' ? C.star : C.spark);
  ctx.save();
  ctx.globalAlpha *= clamp(alpha);
  ctx.translate(x, y);
  ctx.fillStyle = rgb(c);
  if (kind === 'z') {
    ctx.font = '700 5.2px ui-rounded, -apple-system, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('z', 0, 0);
  } else if (kind === 'star') {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) { const r = i % 2 ? 1.1 : 2.7, t = -Math.PI / 2 + i * Math.PI / 5; ctx.lineTo(Math.cos(t) * r, Math.sin(t) * r); }
    ctx.closePath(); ctx.fill();
  } else {
    // A four-pointed sparkle with a soft glow.
    ctx.shadowColor = rgb(C.sparkGlow, .9); ctx.shadowBlur = 2;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) { const r = i % 2 ? .45 : 2.1, t = -Math.PI / 2 + i * Math.PI / 4; ctx.lineTo(Math.cos(t) * r, Math.sin(t) * r); }
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

/**
 * Draws one frame of Fairy into ctx with her grid's top left at (x, y), `size` CSS pixels across (the grid is
 * FAIRY_GRID units square). Takes the same expression and extras as paintFairy.
 */
export function drawFairySmooth(ctx, x, y, size, e = OPEN_EXPRESSION, extras = []) {
  const S = FAIRY_SHAPE, C = FAIRY_COLORS, unit = size / FAIRY_GRID;
  const glow = clamp(e.glow ?? .45), rim = mix(C.rim, [196, 168, 255], e.rimHue || 0);
  const pupilR = Math.max(4.5, Math.min(9.4, S.pupil * (e.pupil ?? 1))), irisR = Math.max(pupilR + 2.2, S.iris), lavR = Math.max(irisR + 2.4, S.lavender);
  const gx = e.gx || 0, gy = e.gy || 0, lid = lids(e, S), sq = clamp(e.squint || 0);
  ctx.save();
  ctx.translate(x, y); ctx.scale(unit, unit);
  ctx.save();
  ctx.translate(FAIRY_CENTER.x, FAIRY_CENTER.y);
  ctx.rotate(e.rot || 0); ctx.scale(e.scale || 1, e.scale || 1);

  // Halo, brighter with speech and music.
  const inner = S.disc + 1.4, outer = inner + 4.2, halo = ctx.createRadialGradient(0, 0, inner, 0, 0, outer);
  const haloAlpha = (.25 + .6 * glow) * (90 + 110 * glow) / 255;
  halo.addColorStop(0, rgb(C.glow, haloAlpha)); halo.addColorStop(1, rgb(C.glow, 0));
  ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(0, 0, outer, 0, Math.PI * 2); ctx.fill();
  // Rim and disc, shaded toward the lower right.
  ctx.fillStyle = rgb(rim); ctx.beginPath(); ctx.arc(0, 0, inner, 0, Math.PI * 2); ctx.fill();
  const shade = ctx.createLinearGradient(0, 0, S.disc / .9, S.disc / .9);
  shade.addColorStop(0, rgb(C.disc)); shade.addColorStop(1, rgb(C.discShade));
  ctx.fillStyle = shade; ctx.beginPath(); ctx.arc(0, 0, S.disc, 0, Math.PI * 2); ctx.fill();
  // The casing: diagonal ears behind a squircle, darker below.
  ctx.save();
  ctx.beginPath(); ctx.arc(0, 0, S.ear, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = rgb(C.casingShade);
  for (const turn of [Math.PI / 4, -Math.PI / 4]) { ctx.save(); ctx.rotate(turn); ctx.fillRect(-S.ear, -3.2, S.ear * 2, 6.4); ctx.restore(); }
  ctx.restore();
  const casing = ctx.createLinearGradient(0, 4, 0, S.casing);
  casing.addColorStop(0, rgb(C.casing)); casing.addColorStop(1, rgb(mix(C.casing, C.casingShade, .55)));
  ctx.fillStyle = casing; squircle(ctx, S.casing); ctx.fill();

  // The eye, a little below the centre. Lids are the casing, covering it from above and below.
  ctx.translate(0, .5);
  ctx.save();
  ctx.beginPath(); ctx.arc(0, 0, S.sclera, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = rgb(C.casing); ctx.fillRect(-S.sclera, -S.sclera, S.sclera * 2, S.sclera * 2);
  band(ctx, S.sclera, ex => { const l = lid(ex); return [l.upper, l.lower]; });
  ctx.save();
  ctx.clip();
  if (sq > .5) {
    // A happy ^ eye: the white below the arched lid, with a bright edge.
    ctx.fillStyle = rgb(C.sclera); ctx.fillRect(-S.sclera, -S.sclera, S.sclera * 2, S.sclera * 2);
    ctx.fillStyle = rgb(C.spark); band(ctx, S.sclera, ex => { const l = lid(ex); return [l.happy - 2, l.happy + 1.2]; }); ctx.fill();
  } else {
    const ux = .4 / 1.077, uy = 1 / 1.077, white = ctx.createLinearGradient(ux * 9.2, uy * 9.2, ux * 17.6, uy * 17.6);
    white.addColorStop(0, rgb(C.sclera)); white.addColorStop(1, rgb(C.scleraShade));
    ctx.fillStyle = white; ctx.fillRect(-S.sclera, -S.sclera, S.sclera * 2, S.sclera * 2);
    ctx.translate(gx, gy);
    ctx.fillStyle = rgb(C.lavender); ctx.beginPath(); ctx.arc(0, 0, lavR, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = rgb(C.iris); ctx.beginPath(); ctx.arc(0, 0, irisR, 0, Math.PI * 2); ctx.fill();
    if (e.dashed) {
      // The scanning iris: lighter arcs turning round the ring while she thinks.
      ctx.fillStyle = rgb(C.irisLight);
      const width = Math.PI / 4 * .55 * e.dashed;
      for (let k = 0; k < 4; k++) {
        const start = k * Math.PI / 2 - (e.spin || 0);
        ctx.beginPath(); ctx.arc(0, 0, irisR, start, start + width); ctx.arc(0, 0, pupilR, start + width, start, true); ctx.closePath(); ctx.fill();
      }
    }
    ctx.fillStyle = rgb(C.irisLight); ctx.beginPath(); ctx.arc(0, 0, pupilR + 1.1, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = rgb(C.pupil); ctx.beginPath(); ctx.arc(0, 0, pupilR, 0, Math.PI * 2); ctx.fill();
    // The highlight at the lower right of the iris, or a heart.
    ctx.translate(4.2, 5.4);
    if (e.heart) {
      ctx.fillStyle = rgb(C.heart);
      ctx.beginPath(); ctx.moveTo(0, 2.6);
      ctx.bezierCurveTo(-3.4, .2, -2.6, -3.1, 0, -1.4);
      ctx.bezierCurveTo(2.6, -3.1, 3.4, .2, 0, 2.6);
      ctx.fill();
    } else {
      const sheen = ctx.createRadialGradient(0, 0, 3.2, 0, 0, 4.8);
      sheen.addColorStop(0, rgb(C.sparkGlow, .6)); sheen.addColorStop(1, rgb(C.sparkGlow, 0));
      ctx.fillStyle = sheen; ctx.beginPath(); ctx.arc(0, 0, 4.8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = rgb(C.spark); ctx.beginPath(); ctx.arc(0, 0, 3.4, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
  // The upper lid's edge, a shade darker, once it has come down into the eye.
  if ((e.lid ?? -1.2) * S.sclera > -S.sclera) {
    ctx.fillStyle = rgb(C.casingShade);
    band(ctx, S.sclera, ex => { const l = lid(ex); return [l.upper - 1.2, l.upper]; }); ctx.fill();
  }
  ctx.restore();
  ctx.restore();

  // Glyphs in the margin, upright whatever the eye is doing.
  for (const item of extras) glyph(ctx, item);
  ctx.restore();
}
