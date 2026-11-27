// Where Fairy's ink cards go: in the free space beside the window being read, next to the text each one explains, never
// on top of each other or of Fairy. Pure, so it can be tested.
const MARGIN = 28, GAP = 18, MIN_SIDE = 300, MAX_COLUMNS = 5;
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// width/height: the display; region: the window being read (or null); avoid: rects to keep clear (Fairy); minX: keep
// columns right of this (labels in the margin); cards: [{id, w, h, tie}] in drawing order, tie being the rect of the text
// the card explains. Returns { places: {id: {x, y, w}}, over } — over is true when some cards had to sit over the content.
export function layoutCards({ width, height, region = null, avoid = [], cards, minX = 0 }) {
  const right = region ? { x: region.x + region.w + MARGIN, w: width - (region.x + region.w) - 2 * MARGIN } : { x: width / 2, w: width / 2 - MARGIN };
  const left = region ? { x: MARGIN, w: region.x - 2 * MARGIN } : { x: MARGIN, w: 0 };
  const towardLeft = left.w > right.w && left.w >= MIN_SIDE;
  const columnWidth = Math.min(Math.max(0, ...cards.map(card => card.w)) || 360, width - 2 * MARGIN);
  // Column positions, best first: in the free side next to the content, then further into it, then over the content.
  const xs = [];
  const fits = x => x >= MARGIN && x + columnWidth <= width - MARGIN;
  if (towardLeft) {
    for (let x = left.x + left.w - columnWidth; xs.length < MAX_COLUMNS && x >= MARGIN; x -= columnWidth + GAP) xs.push(x);
    for (let x = left.x + left.w + GAP; xs.length < MAX_COLUMNS && fits(x); x += columnWidth + GAP) xs.push(x);
  } else {
    const start = Math.max(minX, right.w >= columnWidth ? right.x + Math.min(Math.max(0, (right.w - columnWidth) / 2), 96) : width - MARGIN - columnWidth);
    for (let x = Math.min(start, width - MARGIN - columnWidth); xs.length < MAX_COLUMNS && fits(x); x += columnWidth + GAP) xs.push(x);
    for (let x = xs[0] - columnWidth - GAP; xs.length < MAX_COLUMNS && x >= MARGIN; x -= columnWidth + GAP) xs.push(x);
  }
  if (!xs.length) xs.push(Math.max(MARGIN, width - MARGIN - columnWidth));
  const placed = [], places = {}, limit = height - MARGIN;
  // The first y at or below `from` in this column where the card is clear of Fairy and the cards already placed.
  const clearAt = (x, w, h, from) => {
    let y = Math.max(MARGIN, from);
    for (let guard = 0; guard < 50; guard++) {
      const box = { x, y, w, h }, hit = [...avoid, ...placed].find(rect => overlaps(box, rect));
      if (!hit) return y + h <= limit ? y : null;
      y = hit.y + hit.h + GAP;
    }
    return null;
  };
  const order = cards.map((card, index) => ({ ...card, index })).sort((a, b) => (a.tie ? a.tie.y : a.index * 1e-3 - 1) - (b.tie ? b.tie.y : b.index * 1e-3 - 1));
  for (const card of order) {
    const w = Math.min(card.w, columnWidth), h = Math.min(card.h, limit - MARGIN);
    const wanted = card.tie ? card.tie.y + card.tie.h / 2 - h / 3 : MARGIN;
    let spot = null;
    for (const x of xs) {
      // Beside its words if it fits there, else as high as it fits in this column.
      const y = clearAt(x, w, h, Math.min(wanted, limit - h)) ?? clearAt(x, w, h, MARGIN);
      if (y !== null) { spot = { x, y }; break; }
    }
    // Nowhere clear at all: the column with the most room left, as low as it can go without leaving the screen.
    if (!spot) spot = { x: xs[0], y: Math.max(MARGIN, limit - h) };
    places[card.id] = { x: Math.round(spot.x), y: Math.round(spot.y), w: Math.round(w) };
    placed.push({ x: spot.x, y: spot.y, w, h });
  }
  const over = Boolean(region) && placed.some(box => overlaps(box, region));
  return { places, over };
}

// The point on a card's edge nearest a rect, and the rect's nearest point: the two ends of a tie line.
export function tieEnds(card, rect) {
  const cx = Math.max(rect.x, Math.min(card.x + card.w / 2, rect.x + rect.w));
  const target = { x: cx, y: rect.y + rect.h / 2 };
  const fromLeft = target.x < card.x, fromRight = target.x > card.x + card.w;
  const start = fromLeft ? { x: card.x, y: Math.max(card.y + 20, Math.min(target.y, card.y + card.h - 20)) }
    : fromRight ? { x: card.x + card.w, y: Math.max(card.y + 20, Math.min(target.y, card.y + card.h - 20)) }
    : { x: card.x + card.w / 2, y: target.y < card.y ? card.y : card.y + card.h };
  const end = fromLeft ? { x: rect.x + rect.w + 6, y: target.y } : fromRight ? { x: rect.x - 6, y: target.y } : { x: cx, y: target.y < card.y ? rect.y + rect.h + 4 : rect.y - 4 };
  return { start, end };
}
