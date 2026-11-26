// A part of a window as a JPEG data URL: the part of a page you selected, kept as a clipping's picture (docs: "Notebook
// paper view and clippings", follow-ons). The rectangle is in the window's points and is clipped to the window; one
// that's empty, or isn't four numbers, is refused. Pictures wider than 1600 pixels are scaled down.
function cleanRect(rect, bounds) {
  if (!rect || typeof rect !== 'object') throw new Error('Not a part of the window.');
  const values = ['x', 'y', 'width', 'height'].map(key => Number(rect[key]));
  if (!values.every(Number.isFinite)) throw new Error('Not a part of the window.');
  const [x, y, width, height] = values;
  const left = Math.max(0, Math.floor(x)), top = Math.max(0, Math.floor(y));
  const right = Math.min(bounds.width, Math.ceil(x + width)), bottom = Math.min(bounds.height, Math.ceil(y + height));
  if (right - left < 4 || bottom - top < 4) throw new Error('Not a part of the window.');
  return { x: left, y: top, width: right - left, height: bottom - top };
}
async function captureWindowRect(window, rect) {
  if (!window || window.isDestroyed()) throw new Error('The window isn’t open.');
  const bounds = window.getContentBounds(), part = cleanRect(rect, bounds);
  let image = await window.webContents.capturePage(part);
  const size = image.getSize();
  if (size.width > 1600) image = image.resize({ width: 1600, quality: 'good' });
  return `data:image/jpeg;base64,${image.toJPEG(82).toString('base64')}`;
}
module.exports = { cleanRect, captureWindowRect };
