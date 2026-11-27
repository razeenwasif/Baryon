// The to-do box above the composer, as Claude Code has: Fairy's task list in a work session, each task checked off as
// she does it. The header says how many are done; the box folds away once everything is, and opens again when there's
// something new to do. Opening or closing it yourself sticks until the list next completes or reopens.
//
// Tasks come from her update_tasks tool: { text, status } with status pending, in_progress, done or cancelled.
const SVG = 'http://www.w3.org/2000/svg';
export const STATUS_WORDS = { pending: 'Pending', in_progress: 'In progress', done: 'Completed', cancelled: 'Cancelled' };

// How far the list has got. A cancelled task is no longer one to do, so it's left out of the count, and a list whose
// other tasks are all done is complete.
export function todoProgress(tasks = []) {
  const done = tasks.filter(task => task.status === 'done').length, total = tasks.filter(task => task.status !== 'cancelled').length;
  return { done, total, complete: total > 0 && done === total };
}
// The latest task list in a chat's history, which is what the box shows when you open the chat.
export const latestTasks = (history = []) => history.findLast(entry => entry.role === 'assistant' && Array.isArray(entry.tasks) && entry.tasks.length)?.tasks || [];

const svg = (tag, attributes = {}) => { const node = document.createElementNS(SVG, tag); for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value); return node; };
const element = (tag, className = '', text = '') => { const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node; };
// A task's mark: a clean circle while pending, a 2x2 dot matrix in progress, a circled tick when done and a cross when cancelled.
// One drawing holds all four, and the item's status shows the right one, so a change of status transitions smoothly.
function mark() {
  const drawing = svg('svg', { viewBox: '0 0 24 24', class: 'todo-mark', 'aria-hidden': 'true' });
  const dots = svg('g', { class: 'todo-dots' });
  dots.append(
    svg('circle', { class: 'todo-dot todo-d1', cx: 9, cy: 9, r: 1.75 }),
    svg('circle', { class: 'todo-dot todo-d2', cx: 15, cy: 9, r: 1.75 }),
    svg('circle', { class: 'todo-dot todo-d3', cx: 9, cy: 15, r: 1.75 }),
    svg('circle', { class: 'todo-dot todo-d4', cx: 15, cy: 15, r: 1.75 }),
  );
  drawing.append(
    svg('circle', { class: 'todo-ring', cx: 12, cy: 12, r: 8.75 }),
    dots,
    svg('path', { class: 'todo-tick', d: 'M8.25 12.25 10.75 14.75 15.75 9.25', pathLength: 1 }),
    svg('path', { class: 'todo-cross', d: 'M9 9 15 15M15 9 9 15', pathLength: 1 }),
  );
  return drawing;
}
// The header's glyph: a little checklist, or, once everything is done, a green disc with a tick.
function glyph() {
  const holder = element('span', 'todo-glyph'); holder.setAttribute('aria-hidden', 'true');
  const list = svg('svg', { viewBox: '0 0 24 24', class: 'todo-glyph-list' });
  list.append(svg('rect', { x: 3.5, y: 5, width: 5.5, height: 5.5, rx: 1.2 }), svg('path', { d: 'm4.8 16.6 1.5 1.5 2.6-2.8' }), svg('path', { d: 'M12.5 7.75h8M12.5 16.75h8' }));
  const done = svg('svg', { viewBox: '0 0 24 24', class: 'todo-glyph-done' });
  done.append(svg('circle', { cx: 12, cy: 12, r: 9 }), svg('path', { d: 'M7.5 12.25 10.5 15.25 16.75 8.75', pathLength: 1 }));
  holder.append(list, done);
  return holder;
}
const chevron = () => { const drawing = svg('svg', { viewBox: '0 0 24 24', class: 'todo-chevron', 'aria-hidden': 'true' }); drawing.append(svg('path', { d: 'm6 9 6 6 6-6' })); return drawing; };

let boxes = 0;
// root: the element the box lives in (hidden until there's a list). Returns { set(tasks, { live }), clear() }.
export function setupTodoBox({ root, title = 'To-dos' }) {
  const id = `todo-${++boxes}`;
  const head = element('button', 'todo-head'); head.type = 'button'; head.id = `${id}-head`; head.setAttribute('aria-controls', `${id}-body`);
  const heading = element('h3', 'todo-title', title), count = element('span', 'todo-count'), spoken = element('span', 'sr-only'), shown = element('span', 'todo-count-shown');
  const done = element('span', 'todo-count-done'), total = element('span', 'todo-count-total');
  shown.setAttribute('aria-hidden', 'true'); shown.append(done, element('span', '', '/'), total); count.append(spoken, shown);
  head.append(glyph(), heading, count, chevron());
  const body = element('div', 'todo-body'); body.id = `${id}-body`; body.setAttribute('role', 'region'); body.setAttribute('aria-labelledby', head.id);
  const inner = element('div', 'todo-inner'), scroller = element('div', 'todo-scroll'), list = element('ol', 'todo-items');
  list.setAttribute('aria-live', 'polite'); scroller.append(list); inner.append(scroller); body.append(inner);
  const box = element('section', 'todo-box'); box.setAttribute('aria-label', 'Fairy’s task list'); box.append(head, body);
  root.replaceChildren(box);
  let open = true, wasComplete = false, shownKey = '';
  const setOpen = next => { open = next; box.classList.toggle('closed', !open); head.setAttribute('aria-expanded', String(open)); };
  head.onclick = () => setOpen(!open);
  setOpen(true);

  return {
    // tasks: the whole list, as update_tasks sends it. live: it just changed in a turn on screen, so it animates.
    set(tasks = [], { live = false } = {}) {
      if (!tasks.length) { root.hidden = true; list.replaceChildren(); wasComplete = false; shownKey = ''; return; }
      const key = tasks.map(task => task.text).join('\n'), fresh = key !== shownKey && !tasks.slice(0, list.children.length).every((task, i) => list.children[i]?.dataset.text === task.text);
      // A new list (another turn's or another chat's) starts over, so the last one's completion doesn't carry across.
      if (fresh) { list.replaceChildren(); wasComplete = false; }
      box.classList.toggle('still', !live);
      tasks.forEach((task, i) => {
        let item = list.children[i];
        if (!item || item.dataset.text !== task.text) {
          const made = element('li', `todo-item${live && !fresh ? ' entering' : ''}`);
          made.dataset.text = task.text;
          made.append(mark(), element('span', 'sr-only'), Object.assign(element('span', 'todo-text'), { textContent: task.text }));
          if (item) item.replaceWith(made); else list.append(made);
          item = made;
          if (live && !fresh) requestAnimationFrame(() => made.classList.remove('entering')); else made.classList.remove('entering');
        }
        const status = STATUS_WORDS[task.status] ? task.status : 'pending';
        item.dataset.status = status;
        item.querySelector('.sr-only').textContent = `${STATUS_WORDS[status]}: `;
      });
      while (list.children.length > tasks.length) list.lastElementChild.remove();
      shownKey = key;
      const { done: finished, total: all, complete } = todoProgress(tasks);
      if (done.textContent !== String(finished)) { done.textContent = String(finished); if (live) { done.classList.remove('rolled'); void done.offsetWidth; done.classList.add('rolled'); } }
      total.textContent = String(all);
      spoken.textContent = `${finished} of ${all} tasks completed`;
      box.classList.toggle('complete', complete);
      // Folds away when everything's done, and opens again when there's more to do.
      if (complete && !wasComplete) setOpen(false);
      if (!complete && (wasComplete || fresh)) setOpen(true);
      wasComplete = complete;
      root.hidden = false;
      // Keeps the task under way in sight in a long list.
      const current = list.querySelector('[data-status="in_progress"]');
      if (current && open) current.scrollIntoView?.({ block: 'nearest', behavior: live && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto' });
    },
    clear() { this.set([]); },
    get open() { return open; },
  };
}
