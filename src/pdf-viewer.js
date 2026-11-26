import './panels.css';
import { lineLink, pageLink } from './source-link.js';
import { ZOOMS, pageSize } from './pdf-layout.js';

// A PDF beside the chat: every page in one scroll, opening at the page asked for. Pages are drawn as they come near
// and let go when they're far away, so a long book stays light. Zoom is a share of the panel's width, so Fit always
// fills it, and each page is asked for big enough to stay sharp at that size. ⤢ fills the window, as a page does,
// Text shows the words from the current page on to copy, and Open in Preview hands the file to the Mac's PDF app.
// Pages show in Fairy's look by default, white words on the window's glass, with Original for photos and colour. The
// look is drawn by Fairy's document helper as see-through pictures, not by a filter, so the window's graphics only
// show pictures: a live filter on pages this size cost enough that the GPU process restarted.

// Where pages come from: by default a file in an approved folder, by its link; a notebook passes its own, for a source
// or a PDF its tutor made. at(n, size, ink) draws page n, in Fairy's look when ink is true, words(n) reads from page n on, and elsewhere() opens the PDF in
// the Mac's PDF app. A source without words or elsewhere leaves out their buttons.
export const folderPages = (api, link) => ({
  at: (n, size, ink) => api.filesPreview(pageLink(link, n), { size, ink }),
  words: n => api.filesPreview(lineLink(link, n)),
  elsewhere: api.filesOpen ? () => api.filesOpen(link) : null,
});

// onFull, when given, is what ⤢ does instead of filling the window, as the notebook's own panel needs.
// clip, when given, lets you keep part of a page (a notebook's clippings): hold ⌥ and drag a box, or press Clip and drag.
// clip.preview(page, box, ink) answers with the box grown to the lines it touches, its picture and a name; clip.keep
// (preview, name) keeps it. A box is fractions of the page as shown, from its top left. mark: { page, box } outlines a
// clipping's place on its page for a moment, when it's opened there.
// onPlace(page, y): the line you're reading, 40% down the view, as a page and a share of it, whenever it moves
// (the notebook follows the question you're on); onPick(page, y): a plain click on a page, to fix it there.
export function pdfViewer({ api, link, page = 1, onError = () => {}, pages: from = folderPages(api, link), onFull = null, clip = null, mark = null, onPlace = null, onPick = null }) {
  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
  const button = (className, text, onclick, label = text) => { const node = el('button', className, text); node.type = 'button'; node.onclick = onclick; node.title = label; node.setAttribute('aria-label', label); return node; };
  const root = el('div', 'pdf-viewer'), bar = el('div', 'pdf-bar'), pages = el('div', 'pdf-pages'), words = el('pre', 'pdf-text');
  const number = el('input', 'pdf-page-number'), of = el('span', 'pdf-of', '');
  number.type = 'number'; number.min = '1'; number.value = String(page); number.setAttribute('aria-label', 'Page');
  const smaller = button('pdf-tool', '−', () => zoomTo(step(-1)), 'Smaller');
  const fit = button('pdf-tool pdf-fit', 'Fit', () => zoomTo(1), 'Fit the width');
  const bigger = button('pdf-tool', '+', () => zoomTo(step(1)), 'Bigger');
  const text = button('pdf-tool', 'Text', () => showText(!reading), 'The words from this page on, to copy');
  const full = button('pdf-tool', '⤢', () => (onFull ? onFull() : document.documentElement.classList.toggle('pane-full')), onFull ? 'Fill the notebook' : 'Fill the window');
  // The bar in groups: the page with its arrows, the zoom, then the look as a two-way switch.
  const prev = button('pdf-tool pdf-step', '‹', () => go(current - 1), 'Previous page'), next = button('pdf-tool pdf-step', '›', () => go(current + 1), 'Next page');
  const fairy = button('pdf-tool', 'Fairy', () => setLook(true), 'White words on the window’s glass'), original = button('pdf-tool', 'Original', () => setLook(false), 'Show the pages as printed, for photos and colour');
  const where = el('span', 'pdf-where'), zooms = el('span', 'pdf-zooms'), looks = el('span', 'pdf-looks');
  looks.setAttribute('role', 'group'); looks.setAttribute('aria-label', 'Page look');
  where.append(prev, number, of, next); zooms.append(smaller, fit, bigger); looks.append(fairy, original);
  const clipTool = clip ? button('pdf-tool', 'Clip', () => setClipping(!clipping), 'Drag a box on a page to keep it on the shelf (or hold ⌥ and drag)') : null;
  bar.append(where, zooms, el('span', 'pdf-gap'), looks, ...(clipTool ? [clipTool] : []), ...(from.words ? [text] : []), full);
  if (from.elsewhere) bar.append(button('pdf-tool', 'Open in Preview', () => Promise.resolve().then(from.elsewhere).catch(error => onError(error.message)), 'Open it in the Mac’s PDF app'));
  pages.tabIndex = 0; words.hidden = true;
  root.append(bar, pages, words);

  let total = 0, zoom = 1, ratio = 1.3, current = page, reading = false, alive = true, boxes = [];
  const drawn = new Map();

  // The look you chose last time, kept on this Mac only.
  let fairyLook = true;
  try { fairyLook = localStorage.getItem('fairy.pdfLook') !== 'original'; } catch {}
  function setLook(on) {
    fairyLook = on;
    root.classList.toggle('fairy-look', on);
    // Pages already drawn are drawn again in the new look; the old picture stays until the new one comes.
    if (boxes.length) for (const n of [...drawn.keys()]) void draw(n);
    fairy.setAttribute('aria-pressed', String(on)); original.setAttribute('aria-pressed', String(!on));
    try { localStorage.setItem('fairy.pdfLook', on ? 'fairy' : 'original'); } catch {}
  }
  setLook(fairyLook);

  const wanted = () => pageSize(pages.clientWidth || 600, zoom, window.devicePixelRatio || 1, ratio);

  // Two pages are drawn at a time, newest first, so the one you've scrolled to comes before ones you scrolled past.
  let running = 0;
  const waiting = [];
  const queue = task => new Promise((resolve, reject) => { waiting.push({ task, resolve, reject }); pump(); });
  function pump() {
    while (running < 2 && waiting.length) {
      const { task, resolve, reject } = waiting.pop();
      running++;
      task().then(resolve, reject).finally(() => { running--; pump(); });
    }
  }
  const show = (box, n, data, size) => {
    const image = el('img'); image.alt = `Page ${n}`; image.decoding = 'async'; image.src = data.url;
    if (data.width && data.height) box.style.aspectRatio = `${data.width} / ${data.height}`;
    box.replaceChildren(image); drawn.set(n, { size, ink: data.ink === true });
    if (mark && mark.page === n) { const outline = outlineOf(mark.box, 'pdf-clip-mark'); box.append(outline); setTimeout(() => outline.classList.add('done'), 2600); }
    return image;
  };
  // A box on a page, as fractions of it, drawn over it.
  const outlineOf = (frame, className) => {
    const outline = el('div', className);
    Object.assign(outline.style, { left: `${frame[0] * 100}%`, top: `${frame[1] * 100}%`, width: `${frame[2] * 100}%`, height: `${frame[3] * 100}%` });
    return outline;
  };

  // Clipping: drag a box, see it grown to its lines with a name, and keep it or not.
  let clipping = false, dialog = null;
  function setClipping(on) {
    clipping = on && !!clip;
    root.classList.toggle('clipping', clipping);
    clipTool?.setAttribute('aria-pressed', String(clipping));
  }
  setClipping(false);
  const closeDialog = () => { dialog?.remove(); dialog = null; for (const box of root.querySelectorAll('.pdf-clip-box')) box.remove(); };
  pages.addEventListener('pointerdown', event => {
    if (!clip || event.button !== 0 || !(event.altKey || clipping)) return;
    const pageBox = event.target instanceof Element ? event.target.closest('.pdf-page') : null;
    if (!pageBox || !drawn.has(Number(pageBox.dataset.page))) return;
    event.preventDefault(); closeDialog();
    const rect = pageBox.getBoundingClientRect(), at = e => [Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)), Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))];
    const [x0, y0] = at(event), outline = outlineOf([x0, y0, 0, 0], 'pdf-clip-box');
    let frame = [x0, y0, 0, 0];
    pageBox.append(outline);
    const move = e => {
      const [x1, y1] = at(e);
      frame = [Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)];
      Object.assign(outline.style, { left: `${frame[0] * 100}%`, top: `${frame[1] * 100}%`, width: `${frame[2] * 100}%`, height: `${frame[3] * 100}%` });
    };
    const up = () => {
      pages.removeEventListener('pointermove', move); pages.removeEventListener('pointerup', up); pages.removeEventListener('pointercancel', up);
      if (frame[2] * rect.width < 12 || frame[3] * rect.height < 8) { outline.remove(); return; }
      void ask(Number(pageBox.dataset.page), frame, outline, pageBox);
    };
    pages.setPointerCapture?.(event.pointerId);
    pages.addEventListener('pointermove', move); pages.addEventListener('pointerup', up); pages.addEventListener('pointercancel', up);
  });
  async function ask(n, frame, outline, pageBox) {
    dialog = el('div', 'pdf-clip-dialog'); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-label', 'Clip this part');
    const asked = dialog;
    dialog.append(el('span', 'pdf-clip-eyebrow', 'Clip this part'), el('p', 'panel-note busy', 'Finding its lines…'));
    dialog.style.top = `${Math.max(8, pageBox.offsetTop - pages.scrollTop + (frame[1] + frame[3]) * pageBox.offsetHeight + 8)}px`;
    root.append(dialog);
    let preview;
    try { preview = await clip.preview(n, frame, fairyLook); } catch (error) { if (dialog === asked) { dialog.replaceChildren(el('p', 'pdf-error', error.message), button('pdf-tool', 'Close', closeDialog)); } return; }
    if (dialog !== asked) return;
    Object.assign(outline.style, { left: `${preview.box[0] * 100}%`, top: `${preview.box[1] * 100}%`, width: `${preview.box[2] * 100}%`, height: `${preview.box[3] * 100}%` });
    const picture = el('img', 'pdf-clip-picture'); picture.alt = ''; picture.src = preview.url;
    const name = el('input', 'pdf-clip-name'); name.value = preview.name; name.maxLength = 60; name.setAttribute('aria-label', 'Name');
    const note = el('p', 'pdf-clip-note', preview.words ? 'Grown to the lines it touches. Named from its first line.' : 'No words in it, so it’s kept as drawn.');
    const keep = button('pdf-tool primary', 'Pin to the shelf', async () => {
      keep.disabled = true;
      try { await clip.keep(preview, name.value); closeDialog(); setClipping(false); } catch (error) { keep.disabled = false; note.textContent = error.message; note.className = 'pdf-error'; }
    });
    const actions = el('div', 'pdf-clip-actions'); actions.append(keep, button('pdf-tool', 'Cancel', closeDialog));
    dialog.replaceChildren(el('span', 'pdf-clip-eyebrow', 'Clip this part'), picture, name, note, actions);
    name.onkeydown = event => { if (event.key === 'Enter') keep.click(); if (event.key === 'Escape') closeDialog(); };
    name.focus(); name.select();
  }
  root.addEventListener('keydown', event => { if (event.key === 'Escape' && (dialog || clipping)) { closeDialog(); setClipping(false); } });
  async function draw(n) {
    const box = boxes[n - 1], size = wanted();
    const had = drawn.get(n);
    if (!box || box.dataset.loading || (had && had.size >= size * 0.85 && had.ink === fairyLook)) return;
    box.dataset.loading = '1';
    try {
      const data = await queue(() => (box.dataset.far ? Promise.resolve(null) : from.at(n, size, fairyLook)));
      if (alive && data && !box.dataset.far) show(box, n, data, size);
    } catch (error) { if (alive) box.replaceChildren(el('p', 'pdf-error', `Page ${n}: ${error.message}`)); }
    finally { delete box.dataset.loading; }
  }
  const forget = n => { if (!drawn.delete(n)) return; boxes[n - 1].replaceChildren(el('span', 'pdf-number', String(n))); };
  const near = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const n = Number(entry.target.dataset.page);
      if (entry.isIntersecting) { delete entry.target.dataset.far; void draw(n); } else { entry.target.dataset.far = '1'; forget(n); }
    }
  }, { root: pages, rootMargin: '200% 0px' });

  // The page a third of the way down the view is the one you're on.
  let ticking = false;
  pages.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const line = pages.scrollTop + pages.clientHeight / 3;
      let low = 0, high = boxes.length - 1;
      while (low < high) { const mid = (low + high + 1) >> 1; if (boxes[mid].offsetTop <= line) low = mid; else high = mid - 1; }
      current = low + 1;
      if (document.activeElement !== number) number.value = String(current);
      steps();
      tellPlace();
    });
  }, { passive: true });
  const steps = () => { prev.disabled = current <= 1; next.disabled = !total || current >= total; };
  // Where the reading line falls: the page under it, and how far down that page.
  let told = '';
  function tellPlace() {
    if (!onPlace || !boxes.length) return;
    const line = pages.scrollTop + pages.clientHeight * 0.4;
    let low = 0, high = boxes.length - 1;
    while (low < high) { const mid = (low + high + 1) >> 1; if (boxes[mid].offsetTop <= line) low = mid; else high = mid - 1; }
    const box = boxes[low], y = Math.min(1, Math.max(0, (line - box.offsetTop) / (box.offsetHeight || 1)));
    const now = `${low + 1}:${y.toFixed(2)}`;
    if (now === told) return;
    told = now; onPlace(low + 1, y);
  }
  pages.addEventListener('click', event => {
    if (!onPick || event.altKey || clipping || dialog) return;
    const pageBox = event.target instanceof Element ? event.target.closest('.pdf-page') : null;
    if (!pageBox) return;
    const rect = pageBox.getBoundingClientRect();
    onPick(Number(pageBox.dataset.page), Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)));
  });
  const go = n => { current = Math.min(total, Math.max(1, Math.round(n) || 1)); number.value = String(current); steps(); boxes[current - 1]?.scrollIntoView({ block: 'start' }); };
  number.onchange = () => go(Number(number.value));

  const step = direction => ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, ZOOMS.indexOf(zoom) + direction))];
  function zoomTo(next) {
    const keep = current;
    zoom = next;
    pages.style.setProperty('--pdf-zoom', String(zoom));
    fit.textContent = zoom === 1 ? 'Fit' : `${Math.round(zoom * 100)}%`;
    smaller.disabled = zoom <= ZOOMS[0]; bigger.disabled = zoom >= ZOOMS.at(-1);
    go(keep);
    for (const n of [...drawn.keys()]) void draw(n);
  }
  // A wider panel, or the whole window, asks for sharper pages.
  let resized = 0;
  // Taken out of the page and put back, as a pane's redraw does, a scroller starts again at the top. So the viewer
  // remembers where it was, and keepPlace() puts it back; a host calls it once the element is back on the page.
  let keptTop = 0;
  pages.addEventListener('scroll', () => { if (pages.isConnected && pages.clientHeight) keptTop = pages.scrollTop; }, { passive: true });
  const keepPlace = () => { if (alive && pages.isConnected && keptTop && Math.abs(pages.scrollTop - keptTop) > 1) pages.scrollTop = keptTop; };
  const resize = new ResizeObserver(() => { clearTimeout(resized); resized = setTimeout(() => { for (const n of [...drawn.keys()]) void draw(n); }, 250); });

  async function showText(on) {
    reading = on;
    text.setAttribute('aria-pressed', String(on));
    pages.hidden = on; words.hidden = !on;
    for (const tool of [smaller, fit, bigger]) tool.disabled = on || (tool === smaller && zoom <= ZOOMS[0]) || (tool === bigger && zoom >= ZOOMS.at(-1));
    if (!on) return;
    words.textContent = 'Reading the words…';
    try {
      const data = await from.words(current);
      const read = (data.pages || []).map(item => `Page ${item.page}\n\n${String(item.text || '').trim() || '(No words on this page; it may be a picture.)'}`).join('\n\n\n');
      words.textContent = read || String(data.text || 'There are no words to show.');
      if (data.nextPage) words.append(`\n\n\nThat’s up to page ${data.nextPage - 1}. Go further in the pages and choose Text again for the rest.`);
    } catch (error) { words.textContent = error.message; }
  }

  // The first page on screen: a move into the paper view waits a moment for it, so the paper doesn't arrive blank.
  let shown = null;
  const ready = new Promise(resolve => { shown = resolve; });
  // Once it's on the page, so it knows how wide the pages are: straight after it's put there when it can be, so the
  // first page is on its way before the next frame.
  const begin = async () => {
    const size = wanted();
    pages.replaceChildren(el('p', 'panel-note busy', 'Opening it…'));
    try {
      const first = await from.at(page, size, fairyLook);
      if (!alive) return;
      total = Math.max(page, Number(first.totalPages) || page);
      if (first.width && first.height) ratio = first.height / first.width;
      number.max = String(total); of.textContent = `of ${total}`; steps();
      boxes = Array.from({ length: total }, (_, i) => {
        const box = el('div', 'pdf-page'); box.dataset.page = String(i + 1); box.style.aspectRatio = `${1} / ${ratio}`;
        box.append(el('span', 'pdf-number', String(i + 1)));
        return box;
      });
      pages.replaceChildren(...boxes);
      const image = show(boxes[page - 1], page, first, size);
      for (const box of boxes) near.observe(box);
      resize.observe(pages);
      go(page);
      requestAnimationFrame(tellPlace);
      await image.decode?.().catch(() => {});
    } catch (error) { if (alive) pages.replaceChildren(el('p', 'pdf-error', error.message)); }
    finally { shown(); }
  };
  queueMicrotask(() => (root.isConnected && pages.clientWidth ? begin() : requestAnimationFrame(begin)));

  return { element: root, ready, page: () => current, keepPlace, destroy() { alive = false; closeDialog(); near.disconnect(); resize.disconnect(); clearTimeout(resized); waiting.length = 0; } };
}
