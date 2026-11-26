// Fairy away from the mini, Away 3: this window open on the face's Mac, answered by the Mac Fairy lives on. What only
// that Mac can do (its desktop, a project folder on it, pairing its phone) is shown but disabled, saying where to do it.
// The state says so with remote: true (main.cjs remoteCall). Its look is remote-window.css, loaded by app.js.

export const ELSEWHERE = 'Do this on your other Mac';
const MINI_ONLY = ['#tab-desktop', '#tab-projects', '#tab-phone', '#work-folder-choose', '#work-folder-clear'];

export function applyRemote(state, root = document) {
  if (!state?.remote) return false;
  root.documentElement.classList.add('remote-window');
  for (const control of root.querySelectorAll(MINI_ONLY.join(','))) {
    control.disabled = true;
    control.setAttribute('aria-disabled', 'true');
    control.title = ELSEWHERE;
  }
  return true;
}

// Away 5: a slow or dropped link to the other Mac. Down, the window stays readable but dimmed, saying so, and sending
// waits: what you were typing stays in the box (Enter and the send and record buttons do nothing until it's back).
// After 2 seconds without an answer it says it's waiting. Back, the face fetches what finished meanwhile.
export const SEND_CONTROLS = ['#send', '#record'];
export function linkLine({ down = false, waiting = false, tailscale = false } = {}) {
  if (down) return tailscale ? 'No connection to Tailscale. Fairy’s window catches up once it’s back.' : 'Can’t reach your other Mac. Trying again…';
  return waiting ? 'Waiting for your other Mac…' : '';
}
export function applyLink(value, root = document) {
  const line = linkLine(value), classes = root.documentElement.classList;
  if (value?.down) classes.add('remote-down'); else classes.remove('remote-down');
  let banner = root.getElementById('remote-link');
  if (!banner && line) {
    banner = root.createElement('div');
    banner.id = 'remote-link';
    banner.setAttribute('role', 'status');
    root.body.append(banner);
  }
  if (banner) { banner.textContent = line; banner.hidden = !line; }
  return line;
}
export function watchLink(api, root = document) {
  if (!api?.onRemoteLink) return () => {};
  const down = () => root.documentElement.classList.contains('remote-down');
  const hold = event => { event.preventDefault(); event.stopImmediatePropagation(); };
  root.addEventListener('keydown', event => { if (down() && event.key === 'Enter' && !event.shiftKey && event.target?.id === 'message') hold(event); }, true);
  root.addEventListener('click', event => { if (down() && event.target?.closest?.(SEND_CONTROLS.join(','))) hold(event); }, true);
  return api.onRemoteLink(value => applyLink(value, root));
}
