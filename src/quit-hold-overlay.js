/**
 * Floating confirmation pill shown when holding ⌘Q (or pressing ⌘Q twice) to prevent accidental quits.
 */
export function setupQuitHoldOverlay({ api, host = document.body } = {}) {
  if (!api?.onQuitShortcut || !host) return () => {};
  let pill = null;
  let lingerTimer = null;

  function ensurePill() {
    if (pill) return pill;
    pill = document.createElement('div');
    pill.className = 'quit-hold-pill';
    pill.setAttribute('role', 'status');
    pill.setAttribute('aria-live', 'polite');
    pill.hidden = true;
    const label = document.createElement('span');
    label.className = 'quit-hold-label';
    const track = document.createElement('span');
    track.className = 'quit-hold-track';
    const fill = document.createElement('span');
    fill.className = 'quit-hold-fill';
    track.append(fill);
    pill.append(label, track);
    host.append(pill);
    return pill;
  }

  return api.onQuitShortcut(event => {
    const el = ensurePill();
    clearTimeout(lingerTimer);
    if (event?.state === 'down') {
      const mode = event.mode === 'double-click' ? 'double-click' : 'hold';
      const durationMs = Math.max(300, Number(event.durationMs) || 1200);
      el.querySelector('.quit-hold-label').textContent = mode === 'double-click'
        ? 'Press ⌘Q again to quit'
        : 'Hold ⌘Q or press twice to quit';
      const fill = el.querySelector('.quit-hold-fill');
      fill.style.transition = 'none';
      fill.style.width = mode === 'double-click' ? '100%' : '0%';
      el.dataset.mode = mode;
      el.hidden = false;
      el.classList.add('is-visible');
      if (mode === 'hold') {
        void el.offsetWidth;
        fill.style.transition = `width ${durationMs}ms linear`;
        fill.style.width = '100%';
      }
      lingerTimer = setTimeout(() => {
        el.classList.remove('is-visible');
        el.hidden = true;
      }, durationMs + 1200);
    } else {
      el.classList.remove('is-visible');
      lingerTimer = setTimeout(() => { el.hidden = true; }, 160);
    }
  });
}
