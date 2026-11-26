// Velvet's dot field: a faint grid of dots over the near-black that gathers round the pointer, the dots near it pushed a
// little outwards and brighter, after beui.dev's image-generation dither. Kept quiet so it doesn't pull at you: away
// from the pointer the grid is barely there, and the light fades more and more with distance from it. It draws only
// while the pointer moves or the field is still settling, and only the patch that changed, so a still window costs nothing.
export const DOT_FIELD = { gap: 14, radius: 230, push: 9, base: 0.035, peak: 0.62, colour: '201, 208, 236' };

// How much the pointer moves a dot at this distance: smoothly from full at the pointer to none at the radius.
export function dotInfluence(distance, radius = DOT_FIELD.radius) {
  const near = Math.max(0, 1 - distance / radius);
  return near * near * (3 - 2 * near);
}

export function dotField(canvas) {
  const context = canvas.getContext('2d');
  const { gap, radius, push, base, peak, colour } = DOT_FIELD;
  const pointer = { x: 0, y: 0, toX: 0, toY: 0, strength: 0, to: 0 };
  let width = 0, height = 0, scale = 1, mode = 'off', frame = 0, drawn = null;

  // Every dot whose resting place falls in the patch, drawn where the pointer has moved it.
  function paint(left, top, right, bottom) {
    context.save();
    context.beginPath();
    context.rect(left, top, right - left, bottom - top);
    context.clip();
    context.clearRect(left, top, right - left, bottom - top);
    const columns = Math.ceil(width / gap) + 1, offsetX = (width - (columns - 1) * gap) / 2;
    const rows = Math.ceil(height / gap) + 1, offsetY = (height - (rows - 1) * gap) / 2;
    const first = { column: Math.max(0, Math.floor((left - push - offsetX) / gap)), row: Math.max(0, Math.floor((top - push - offsetY) / gap)) };
    const last = { column: Math.min(columns - 1, Math.ceil((right + push - offsetX) / gap)), row: Math.min(rows - 1, Math.ceil((bottom + push - offsetY) / gap)) };
    for (let row = first.row; row <= last.row; row++) {
      for (let column = first.column; column <= last.column; column++) {
        const anchorX = offsetX + column * gap, anchorY = offsetY + row * gap;
        const dx = anchorX - pointer.x, dy = anchorY - pointer.y, distance = Math.hypot(dx, dy);
        const pull = dotInfluence(distance) * pointer.strength, moved = pull * pull * push;
        const x = distance > 0 ? anchorX + dx / distance * moved : anchorX, y = distance > 0 ? anchorY + dy / distance * moved : anchorY;
        // Brightest at the pointer, then a falloff steeper than the push, so the light trails away into the grid.
        const light = Math.pow(pull, 1.8);
        context.fillStyle = `rgba(${colour}, ${base + light * (peak - base)})`;
        context.beginPath();
        context.arc(x, y, 0.7 + light * 1.0, 0, Math.PI * 2);
        context.fill();
      }
    }
    context.restore();
  }
  // The square round the pointer that its dots can reach.
  const patch = () => {
    const reach = radius + push + gap;
    return [pointer.x - reach, pointer.y - reach, pointer.x + reach, pointer.y + reach];
  };
  function whole() {
    paint(0, 0, width, height);
    drawn = pointer.strength > 0.001 ? patch() : null;
  }
  function step() {
    frame = 0;
    pointer.x += (pointer.toX - pointer.x) * 0.16;
    pointer.y += (pointer.toY - pointer.y) * 0.16;
    pointer.strength += (pointer.to - pointer.strength) * 0.12;
    const now = patch(), before = drawn ?? now;
    paint(Math.min(before[0], now[0]), Math.min(before[1], now[1]), Math.max(before[2], now[2]), Math.max(before[3], now[3]));
    drawn = pointer.strength > 0.001 ? now : null;
    const settling = Math.abs(pointer.toX - pointer.x) > 0.3 || Math.abs(pointer.toY - pointer.y) > 0.3 || Math.abs(pointer.to - pointer.strength) > 0.004;
    if (settling && mode === 'live') frame = requestAnimationFrame(step);
    else if (pointer.to === 0 && pointer.strength < 0.01) { pointer.strength = 0; whole(); }
  }
  const wake = () => { if (!frame && mode === 'live') frame = requestAnimationFrame(step); };

  function resize() {
    const box = canvas.getBoundingClientRect();
    width = box.width; height = box.height; scale = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    context.setTransform(scale, 0, 0, scale, 0, 0);
    if (mode !== 'off') whole();
  }
  const resizes = new ResizeObserver(resize);
  resizes.observe(canvas);

  window.addEventListener('pointermove', event => {
    if (mode !== 'live') return;
    const box = canvas.getBoundingClientRect();
    pointer.toX = event.clientX - box.left;
    pointer.toY = event.clientY - box.top;
    // Arriving, the field gathers where the pointer is rather than sweeping in from where it last was.
    if (pointer.strength < 0.01) { pointer.x = pointer.toX; pointer.y = pointer.toY; }
    pointer.to = 1;
    wake();
  }, { passive: true });
  const away = () => { pointer.to = 0; wake(); };
  document.documentElement.addEventListener('mouseleave', away);
  window.addEventListener('blur', away);

  return {
    // 'live' follows the pointer; 'paused' keeps what's drawn; 'still' (Reduce Motion) is the grid alone; 'off' is blank.
    set(next) {
      if (next === mode) return;
      const was = mode;
      mode = next;
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      if (mode === 'off') { context.clearRect(0, 0, width, height); drawn = null; return; }
      if (mode === 'still' || was === 'off' || was === 'still') { pointer.strength = 0; pointer.to = 0; whole(); }
      if (mode === 'paused' && pointer.strength > 0) { pointer.to = 0; pointer.strength = 0; whole(); }
    },
  };
}
