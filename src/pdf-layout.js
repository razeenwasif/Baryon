// How big the PDF viewer draws a page. Apart from the viewer so it can be tested without a window.
export const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];

// The longest side, in pixels, a page needs at this width and zoom: its width on screen, times the display's
// density, stretched by the page's height for an upright page. Rounded so small changes reuse what's drawn.
export function pageSize(width, zoom, density = 1, ratio = 1.3) {
  const needed = Math.round(width * zoom * density * Math.max(1, ratio) / 200) * 200;
  return Math.min(3200, Math.max(1200, needed || 1200));
}
