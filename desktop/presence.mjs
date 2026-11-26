// Always-on presence: menu bar menu, login item and floating window levels.
// Pure helpers so the behaviour can be tested without Electron.

export function loginItemChange(settings, current = {}) {
  const openAtLogin = settings.startAtLogin === 'on';
  return openAtLogin === Boolean(current.openAtLogin) ? null : { openAtLogin };
}

// Floating Fairy should stay with the user across Spaces and over full-screen
// apps; the workspace window behaves like an ordinary window again.
export function windowPresence(floating, pinned = false) {
  return floating
    ? { alwaysOnTop: true, level: 'screen-saver', visibleOnAllWorkspaces: true, options: { visibleOnFullScreen: true, skipTransformProcessType: true } }
    : { alwaysOnTop: pinned, level: 'floating', visibleOnAllWorkspaces: false, options: { visibleOnFullScreen: false, skipTransformProcessType: true } };
}

// onFace: she is shown on a face on another Mac (two Macs), so this Mac can bring her back.
export function trayMenuTemplate({ settings = {}, companion = false, visible = false, meeting = 'off', name = 'Baryon', onFace = false } = {}) {
  return [
    { id: 'show', label: visible ? `Hide ${name}` : `Show ${name}` },
    ...(onFace ? [{ id: 'here', label: `Bring ${name} here` }] : []),
    { id: 'companion', label: 'Companion', type: 'checkbox', checked: companion },
    { type: 'separator' },
    { id: 'mute', label: 'Mute voice', type: 'checkbox', checked: settings.muted === 'on' },
    { id: 'meeting', label: meeting === 'off' ? 'Start meeting mode' : 'End meeting mode', type: 'checkbox', checked: meeting !== 'off' },
    { id: 'ideas', label: 'Start conversations', type: 'checkbox', checked: settings.proactiveMode === 'on' },
    { type: 'separator' },
    { id: 'login', label: 'Open at login', type: 'checkbox', checked: settings.startAtLogin === 'on' },
    { id: 'quit', label: `Quit ${name}` },
  ];
}

export function trayTooltip({ name = 'Baryon', meeting = 'off', settings = {} } = {}) {
  if (meeting !== 'off') return `${name} · transcribing this meeting`;
  if (settings.muted === 'on') return `${name} · muted`;
  return name;
}

// Two Macs: a Face's menu-bar item (face-main.cjs). link is the face client's state; host is the other Mac's name.
const FACE_STATUS = {
  unpaired: () => 'Not paired with your other Mac',
  connecting: () => 'Reaching your other Mac…',
  connected: host => `Connected to ${host || 'your other Mac'}`,
  unreachable: () => 'Can’t reach your other Mac',
  changed: () => 'Your other Mac’s certificate changed. Pair again.',
  forgotten: () => 'This Mac was removed. Pair again.',
};
export const shortHost = host => String(host || '').split('.')[0];
export const faceStatus = (link, host = '') => (FACE_STATUS[link] ?? FACE_STATUS.unreachable)(shortHost(host));

// Whether Tailscale reaches the other Mac directly or through a relay, from this Mac's `tailscale status --json` and the
// other Mac's name: 'direct', 'relayed', or '' when it can't tell (Fairy away from the mini, Away 1).
export function tailscalePath(json, host) {
  let data = null;
  try { data = typeof json === 'string' ? JSON.parse(json) : json; } catch { return ''; }
  const name = String(host || '').toLowerCase().replace(/\.$/, '');
  const peer = Object.values(data?.Peer ?? {}).find(item => String(item?.DNSName || '').toLowerCase().replace(/\.$/, '') === name);
  if (!peer || peer.Online === false) return '';
  return peer.CurAddr ? 'direct' : peer.Relay ? 'relayed' : '';
}

// Away 5: whether this Mac's Tailscale has no connection at all (stopped, signed out, or offline, as on hotel Wi-Fi
// before its sign-in page), from `tailscale status --json` and its exit code. Unsure means no: the other Mac is named.
export function tailscaleOffline(json, code = 0) {
  let status;
  try { status = JSON.parse(String(json || '')); } catch { return code !== 0 && /not running|stopped|logged out/i.test(String(json || '')); }
  return (typeof status?.BackendState === 'string' && status.BackendState !== 'Running') || status?.Self?.Online === false;
}
// quiz: { enabled, status } once the face's quiz is set up (two Macs, step 8), or null. path: tailscalePath's answer.
export function faceTrayTemplate({ link = 'unpaired', host = '', visible = true, muted = false, openAtLogin = false, here = null, follow = 'pointer', screen = false, quiz = null, path = '' } = {}) {
  return [
    { id: 'status', label: `${faceStatus(link, host)}${link === 'connected' && path ? ` (${path})` : ''}`, enabled: false },
    // Away 1: whether the other Mac will look after itself while you're away, and starting Fairy again there.
    ...(link === 'connected' ? [{ id: 'check', label: 'Check before you leave…' }, { id: 'restart', label: 'Restart Baryon on the other Mac…' }] : []),
    { type: 'separator' },
    { id: 'show', label: visible ? 'Hide Baryon' : 'Show Baryon' },
    ...(link === 'unpaired' ? [] : [{ id: 'window', label: 'Open Baryon’s window…', enabled: link === 'connected' }, { id: 'chats', label: 'Chats…' }]),
    ...(here === null ? [] : [{ id: 'here', label: 'Bring Baryon here', enabled: !here }, { id: 'follow', label: 'Follow the pointer', type: 'checkbox', checked: follow === 'pointer' }]),
    { id: 'mute', label: 'Mute voice', type: 'checkbox', checked: muted },
    ...(link === 'unpaired' ? [] : [{ id: 'screen', label: 'Let Baryon see this screen', type: 'checkbox', checked: screen }]),
    ...(link === 'unpaired' || !quiz ? [] : [{ id: 'quiz', label: 'Quiz hints', type: 'checkbox', checked: quiz.enabled === true },
      ...(quiz.enabled && quiz.status ? [{ id: 'quiz-status', label: String(quiz.status).slice(0, 60), enabled: false }] : [])]),
    { type: 'separator' },
    { id: 'login', label: 'Open at login', type: 'checkbox', checked: openAtLogin },
    ...(link === 'unpaired' ? [] : [{ id: 'forget', label: 'Forget the other Mac' }]),
    { id: 'home', label: 'Switch back to the full Baryon' },
    { id: 'quit', label: 'Quit Baryon' },
  ];
}
