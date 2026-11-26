// The message scroller, after beui.dev's: a thin tick for each message down the right of the chat. The tick for what's
// in view is longer and brighter, the ticks swell a little round the pointer, hovering one shows that message (and the
// start of Fairy's answer to it), and clicking one glides there. It shows only once the chat is longer than the window.
export const RAIL = { title: 56, description: 88, follow: 56, tick: 12, wide: 22, spread: 2.5, visible: 10, step: 18, dot: 7 };

// Text cut at a word near the limit, with an ellipsis.
export function shorten(text, limit) {
  if (text.length <= limit) return text;
  const excerpt = text.slice(0, limit), boundary = excerpt.lastIndexOf(' ');
  return `${excerpt.slice(0, boundary > limit * 0.65 ? boundary : limit).trim()}…`;
}

// What the card says for a message: a short message is the title and the reply after it the description; a long one
// is cut into title and the rest.
export function railPreview(text, reply = '') {
  const clean = String(text || '').replace(/\s+/g, ' ').trim(), answer = String(reply || '').replace(/\s+/g, ' ').trim();
  if (!clean) return { title: 'Message', description: answer ? shorten(answer, RAIL.description) : '' };
  if (clean.length <= RAIL.title) return { title: clean, description: answer ? shorten(answer, RAIL.description) : '' };
  const title = shorten(clean, RAIL.title), rest = answer || clean.slice(title.length - 1).trim();
  return { title, description: rest ? shorten(rest, RAIL.description) : '' };
}

// Which message is in view: the first at the top, the last at the bottom, otherwise the one nearest the middle.
export function activeMessage({ top, height, scrollHeight, centres }) {
  if (!centres.length) return -1;
  if (top <= RAIL.follow) return 0;
  if (scrollHeight - top - height <= RAIL.follow) return centres.length - 1;
  const middle = top + height / 2;
  let best = 0;
  centres.forEach((centre, index) => { if (Math.abs(centre - middle) < Math.abs(centres[best] - middle)) best = index; });
  return best;
}

// How long each tick is: full length for the one in view, and a swell round the one under the pointer.
export function tickWidth(index, active, hovered) {
  const swell = hovered < 0 ? 0 : Math.max(0, 1 - Math.abs(index - hovered) / RAIL.spread);
  const base = index === active ? RAIL.wide : RAIL.tick;
  return Math.round(base + (RAIL.wide - RAIL.tick) * swell * swell * (index === active ? 0 : 1));
}

// Compact rail geometry: show at most `visible` dots (default 10) at a time and scroll when longer.
export function railLayout({ count, room, visible = RAIL.visible, step = RAIL.step, dot = RAIL.dot }) {
  if (count <= 0 || room <= 0) return { shown: 0, step, dot, height: 0, scrollable: false };
  const shown = Math.min(count, visible);
  const fitStep = Math.min(step, Math.max(10, Math.floor(room / shown)));
  const fitDot = Math.max(4, Math.min(dot, Math.round(fitStep - 3)));
  const height = Math.min(room, shown * fitStep);
  return { shown, step: fitStep, dot: fitDot, height, scrollable: count > shown || count * fitStep > height + 1 };
}

// Target scrollTop inside the rail container so the active dot sits centered within the visible window.
export function railScrollTop({ index, count, step, viewport }) {
  if (index < 0 || count <= 0 || step <= 0 || viewport <= 0) return 0;
  const maxTop = Math.max(0, count * step - viewport);
  if (maxTop === 0) return 0;
  const centred = index * step + step / 2 - viewport / 2;
  return Math.max(0, Math.min(maxTop, Math.round(centred)));
}

// Target scrollTop inside the message scroller when jumping to a message from a rail dot.
export function railTargetTop({ scrollTop = 0, itemTop = 0, scrollerTop = 0, clientHeight = 0, itemHeight = 0, scrollHeight = 0, isLast = false }) {
  const maxTop = Math.max(0, scrollHeight - clientHeight);
  if (isLast) return maxTop;
  const offset = scrollTop + (itemTop - scrollerTop);
  const raw = itemHeight >= clientHeight - 32
    ? offset - 16
    : offset - (clientHeight - itemHeight) / 2;
  return Math.max(0, Math.min(maxTop, Math.round(raw)));
}

// Forward wheel deltas from the minimap rail to the main scroller whenever the rail isn't scrollable or is at an edge.
export function railWheelDelta({ deltaY = 0, ticksScrollTop = 0, ticksScrollHeight = 0, ticksClientHeight = 0 } = {}) {
  const dy = Number(deltaY) || 0;
  if (!dy) return 0;
  const maxTop = Math.max(0, (Number(ticksScrollHeight) || 0) - (Number(ticksClientHeight) || 0));
  if (maxTop <= 1) return dy;
  const atTop = (Number(ticksScrollTop) || 0) <= 1 && dy < 0;
  const atBottom = (Number(ticksScrollTop) || 0) >= maxTop - 1 && dy > 0;
  return atTop || atBottom ? dy : 0;
}

const chatText = item => (item.querySelector('.rich-reply') ?? item.children[1] ?? item).textContent || '';

// scroller: the scrolling list; host: what the rail is placed in. The defaults suit the chat's articles; a notebook chat
// passes its own: which children are messages, which of them are yours, and their words. inset puts the rail inside
// the host's right edge rather than just outside it.
export function setupMessageRail({ scroller, host, isMessage = child => child.classList.contains('message'), isMine = item => item.classList.contains('user'), textOf = chatText, inset = false }) {
  const rail = document.createElement('nav');
  rail.className = `message-rail${inset ? ' inset' : ''}`; rail.setAttribute('aria-label', 'Messages in this chat'); rail.hidden = true;
  const ticks = document.createElement('div'); ticks.className = 'message-rail-ticks';
  const card = document.createElement('div'); card.className = 'message-rail-card'; card.setAttribute('aria-hidden', 'true'); card.hidden = true;
  const cardTitle = document.createElement('p'), cardText = document.createElement('p');
  cardTitle.className = 'message-rail-title'; cardText.className = 'message-rail-text';
  card.append(cardTitle, cardText); rail.append(card, ticks); host.append(rail);

  let messages = [], active = -1, hovered = -1, frame = 0, landing = 0;
  let pointerInRail = false, currentStep = RAIL.step, currentHeight = 0, railTop = 0;
  const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  function widths() {
    [...ticks.children].forEach((button, index) => {
      button.style.setProperty('--w', `${tickWidth(index, active, hovered)}px`);
      button.classList.toggle('is-active', index === active);
      if (index === active) button.setAttribute('aria-current', 'true'); else button.removeAttribute('aria-current');
    });
  }
  function syncFades() {
    const maxTop = Math.max(0, ticks.scrollHeight - ticks.clientHeight);
    ticks.classList.toggle('has-more-top', maxTop > 1 && ticks.scrollTop > 1);
    ticks.classList.toggle('has-more-bottom', maxTop > 1 && ticks.scrollTop < maxTop - 1);
  }
  function syncRailScroll({ instant = false } = {}) {
    if (active < 0 || !messages.length || pointerInRail) return;
    const viewport = ticks.clientHeight || currentHeight;
    const target = railScrollTop({ index: active, count: messages.length, step: currentStep, viewport });
    if (Math.abs(ticks.scrollTop - target) > 1) {
      if (instant || still()) ticks.scrollTop = target;
      else ticks.scrollTo({ top: target, behavior: 'smooth' });
    }
    syncFades();
  }
  function findActive() {
    const box = scroller.getBoundingClientRect(), top = scroller.scrollTop;
    const centres = messages.map(item => { const r = item.getBoundingClientRect(); return r.top - box.top + top + r.height / 2; });
    const next = activeMessage({ top, height: scroller.clientHeight, scrollHeight: scroller.scrollHeight, centres });
    if (next !== active) { active = next; widths(); syncRailScroll(); }
  }
  function show(index) {
    hovered = index; widths();
    if (index < 0) { card.hidden = true; return; }
    const tick = ticks.children[index];
    if (!tick) { card.hidden = true; return; }
    const item = messages[index], reply = isMine(item) ? messages.slice(index + 1).find(next => !isMine(next)) : null;
    const { title, description } = railPreview(textOf(item), reply ? textOf(reply) : '');
    cardTitle.textContent = title; cardText.textContent = description; cardText.hidden = !description;
    card.hidden = false;
    // Level with its tick, clamped within the chat scroller's vertical bounds.
    const railBox = rail.getBoundingClientRect(), tickBox = tick.getBoundingClientRect();
    const at = tickBox.top - railBox.top + tickBox.height / 2 - card.offsetHeight / 2;
    const minTop = (scroller.offsetTop + 8) - railTop;
    const maxTop = (scroller.offsetTop + scroller.clientHeight - 8 - card.offsetHeight) - railTop;
    card.style.top = `${Math.max(minTop, Math.min(at, Math.max(minTop, maxTop)))}px`;
  }
  function go(index) {
    const item = messages[index]; if (!item) return;
    const behavior = still() ? 'auto' : 'smooth';
    const itemRect = item.getBoundingClientRect(), scrollerRect = scroller.getBoundingClientRect();
    const top = railTargetTop({
      scrollTop: scroller.scrollTop,
      itemTop: itemRect.top,
      scrollerTop: scrollerRect.top,
      clientHeight: scroller.clientHeight,
      itemHeight: item.offsetHeight || itemRect.height,
      scrollHeight: scroller.scrollHeight,
      isLast: index === messages.length - 1,
    });
    active = index; widths(); syncRailScroll();
    // While it glides, the scroll doesn't move the highlight back through the messages it passes.
    landing = performance.now() + (behavior === 'smooth' ? 900 : 0);
    if (typeof scroller.scrollTo === 'function') scroller.scrollTo({ top, behavior });
    else scroller.scrollTop = top;
  }
  function build() {
    frame = 0;
    const next = [...scroller.children].filter(isMessage);
    const overflowing = scroller.scrollHeight > scroller.clientHeight + 1 && next.length > 1 && scroller.clientHeight > 0;
    rail.hidden = !overflowing;
    // The rail stands in for the scroll bar, which would sit right beside it.
    scroller.classList.toggle('has-rail', overflowing);
    if (!overflowing) { messages = next; return; }
    // The rail shows at most 10 dots at a time, vertically centered beside the messages.
    const room = Math.max(0, scroller.clientHeight - 48);
    const layout = railLayout({ count: next.length, room });
    currentStep = layout.step; currentHeight = layout.height;
    railTop = scroller.offsetTop + 24 + Math.max(0, Math.round((room - layout.height) / 2));
    rail.style.top = `${railTop}px`; rail.style.height = `${layout.height}px`;
    ticks.style.setProperty('--step', `${layout.step}px`);
    ticks.style.setProperty('--dot', `${layout.dot}px`);
    if (next.length !== messages.length || next.some((item, index) => item !== messages[index])) {
      messages = next;
      const count = messages.length;
      ticks.replaceChildren(...messages.map((item, index) => {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'message-rail-tick';
        button.setAttribute('aria-label', `Go to ${isMine(item) ? 'your' : 'Fairy’s'} message, ${index + 1} of ${count}`);
        button.append(document.createElement('span'));
        // Avoid focus-scrolling the rail viewport on mouse press before click fires.
        button.onmousedown = event => event.preventDefault();
        button.onclick = event => { event.stopPropagation(); go(index); };
        button.onkeydown = event => {
          const targetIdx = event.key === 'ArrowDown' ? Math.min(count - 1, index + 1)
            : event.key === 'ArrowUp' ? Math.max(0, index - 1)
            : event.key === 'Home' ? 0
            : event.key === 'End' ? count - 1
            : -1;
          if (targetIdx < 0) return;
          event.preventDefault();
          const targetBtn = ticks.children[targetIdx];
          targetBtn?.focus();
          go(targetIdx);
        };
        button.onpointerenter = () => show(index);
        button.onfocus = () => show(index);
        button.onblur = () => show(-1);
        return button;
      }));
      hovered = -1; card.hidden = true;
    }
    active = -1; findActive(); widths();
    syncRailScroll({ instant: true });
    syncFades();
  }
  const schedule = () => { frame ||= requestAnimationFrame(build); };
  rail.addEventListener('pointerenter', () => { pointerInRail = true; });
  rail.addEventListener('pointerleave', () => { pointerInRail = false; show(-1); });
  rail.addEventListener('wheel', event => {
    const forward = railWheelDelta({ deltaY: event.deltaY, ticksScrollTop: ticks.scrollTop, ticksScrollHeight: ticks.scrollHeight, ticksClientHeight: ticks.clientHeight });
    if (!forward) return;
    event.preventDefault();
    scroller.scrollTop += forward;
  }, { passive: false });
  ticks.addEventListener('scroll', () => { syncFades(); if (hovered >= 0) show(-1); }, { passive: true });
  scroller.addEventListener('scroll', () => { if (performance.now() > landing) findActive(); }, { passive: true });
  scroller.addEventListener('scrollend', () => { landing = 0; findActive(); });
  const added = new MutationObserver(schedule); added.observe(scroller, { childList: true });
  const sizes = new ResizeObserver(schedule);
  sizes.observe(scroller);
  // A reply growing changes how far the chat scrolls without adding a message.
  const growing = new MutationObserver(() => { if (rail.hidden) schedule(); }); growing.observe(scroller, { childList: true, subtree: true, characterData: true });
  schedule();
  // A list drawn afresh (a notebook chat, each time the notebook redraws) ends the old rail first.
  const stop = () => { added.disconnect(); sizes.disconnect(); growing.disconnect(); if (frame) cancelAnimationFrame(frame); rail.remove(); scroller.classList.remove('has-rail'); };
  return { refresh: schedule, stop };
}
