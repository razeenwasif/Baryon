import { qrPicture } from './phone-settings.js';
import type { BaryonPreloadApi } from '../desktop/ipc-contract.js';

export interface PhoneLinkPairing {
  url: string;
  minutes: number;
}

export interface PhoneLinkDevice {
  id: string;
  name: string;
  kind?: 'mac' | 'phone' | string;
  paired: string | number;
  lastSeen?: string | number;
}

export interface PhoneLinkState {
  enabled: boolean;
  listening: boolean;
  pairing?: boolean;
  name?: string;
  problem?: string;
  keepAwake?: boolean;
  google?: boolean;
  firewall?: 'blocked' | 'waiting' | string;
  devices: PhoneLinkDevice[];
}

export interface PushKeyInfo {
  keyId: string;
  teamId: string;
}

export interface PushState {
  key?: PushKeyInfo | null;
  phones: string[];
}

export interface CheckInsConfig {
  enabled: boolean;
  everyHours: number;
  quietFrom: string;
  quietTo: string;
  topics: string;
}

export interface MorningBriefConfig {
  enabled: boolean;
  time: string;
}

export interface CheckInsView {
  checkIns: CheckInsConfig;
  brief: MorningBriefConfig;
  lastCheck?: string | number;
  lastBrief?: string;
}

export interface CheckInsPatch {
  checkIns?: Partial<CheckInsConfig>;
  brief?: Partial<MorningBriefConfig>;
}

export interface SetupPhoneLinkSettingsOptions {
  api: BaryonPreloadApi;
  root: HTMLElement;
}

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
function button(label: string, run: () => void, className = 'quiet'): HTMLButtonElement {
  const node = element('button', className, label);
  node.type = 'button';
  node.onclick = run;
  return node;
}
const when = (at: string | number): string => {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
};
const errorMessage = (error: unknown): string => (
  error instanceof Error ? error.message
    : typeof error === 'object' && error !== null && 'message' in error ? String((error as { message: unknown }).message)
      : String(error)
);

export function setupPhoneLinkSettings({ api, root }: SetupPhoneLinkSettingsOptions): { render: () => Promise<void> } {
  let pairing: PhoneLinkPairing | null = null;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let macPairing: PhoneLinkPairing | null = null;
  let macExpiry: ReturnType<typeof setTimeout> | undefined;
  const failure = element('p', 'automation-error');
  const guard = async <T>(run: () => Promise<T>): Promise<T | undefined> => {
    failure.textContent = '';
    try { return await run(); } catch (error) { failure.textContent = String(errorMessage(error)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''); return undefined; }
  };
  const row = (title: string, detail: string, actions: HTMLElement[] = []): HTMLDivElement => {
    const node = element('div', 'automation-row'), words = element('div', 'automation-words');
    words.append(element('strong', '', title));
    if (detail) words.append(element('span', '', detail));
    node.append(words, ...actions);
    return node;
  };
  const clearPairing = (): void => { pairing = null; clearTimeout(expiry); macPairing = null; clearTimeout(macExpiry); };
  // Notifications: your APNs key, so this Mac can push to the paired iPhones directly, and a test.
  const notifications = element('div', 'phone-notifications'), checkIns = element('div', 'phone-check-ins');
  function draw(state: PhoneLinkState): void {
    if (!state.listening || !state.pairing) clearPairing();
    const parts: HTMLElement[] = [element('h4', 'phone-heading', 'iPhone app'), element('p', 'automation-note', 'Follow work sessions, answer Fairy’s questions and ask her to do small things from the iPhone app, wherever you are. It uses Tailscale, so nothing is open to the internet. It only works while Fairy is open and this Mac is awake.')];
    if (!state.enabled) parts.push(button('Turn on the iPhone link', () => { void guard(async () => draw(await api.phoneLinkSet(true) as PhoneLinkState)); }, 'primary'));
    else {
      const words = state.problem || (state.listening ? `On, at ${state.name}` : 'Waiting for Tailscale. Open it on this Mac and sign in.');
      parts.push(row('iPhone link', words, [button('Turn off', () => { void guard(async () => draw(await api.phoneLinkSet(false) as PhoneLinkState)); })]));
      parts.push(row('Keep this Mac awake', state.keepAwake ? 'On while a work session is running. Closing the lid on battery still puts it to sleep.' : 'Off. A session can stall if this Mac goes to sleep.', [button(state.keepAwake ? 'Turn off' : 'Turn on', () => { void guard(async () => draw(await api.phoneLinkKeepAwake(!state.keepAwake) as PhoneLinkState)); })]));
      parts.push(row('Gmail and Calendar', state.google !== false ? 'On. Your iPhone can ask Fairy to go through your email and to add Google Calendar events, each one after Face ID on the phone.' : 'Off. The iPhone gets plain conversation only.', [button(state.google !== false ? 'Turn off' : 'Turn on', () => { void guard(async () => draw(await api.phoneLinkGoogle(state.google === false) as PhoneLinkState)); })]));
      if (state.firewall === 'blocked') parts.push(element('p', 'automation-error', 'Your Mac’s firewall is blocking Fairy, so your phone can’t connect. In System Settings, open Network, then Firewall, then Options, and set Fairy to allow incoming connections.'));
      if (state.firewall === 'waiting') parts.push(element('p', 'automation-note', 'Your Mac’s firewall hasn’t let Fairy through yet. If macOS is asking whether Fairy can accept incoming connections, choose Allow.'));
      if (state.listening) {
        if (pairing) {
          const box = element('div', 'phone-pairing');
          box.append(qrPicture(pairing.url), element('p', 'automation-note', `Scan this in the Fairy app, or with your iPhone’s camera. It works once and lasts ${pairing.minutes} minutes. Anyone who sees it can pair, so don’t share it.`));
          parts.push(box);
        } else parts.push(button('Pair an iPhone', () => {
          void guard(async () => {
            macPairing = null; clearTimeout(macExpiry);
            const nextPairing = await api.phoneLinkPair() as PhoneLinkPairing;
            pairing = nextPairing;
            clearTimeout(expiry);
            expiry = setTimeout(() => { void render(); }, nextPairing.minutes * 60000);
            draw(await api.phoneLinkState() as PhoneLinkState);
          });
        }, 'primary'));
        // Two Macs: a link to paste into Fairy on a Mac that will be a face of this one (desktop/face-client.mjs).
        if (api.phoneLinkPairMac) {
          if (macPairing) {
            const currentMacPairing = macPairing;
            const box = element('div', 'phone-pairing'), copied = element('span', 'automation-note');
            box.append(element('p', 'automation-note', `Copy this link and paste it into Fairy on the Mac you’re making a face. It works once and lasts ${currentMacPairing.minutes} minutes. Anyone who has it can pair, so don’t share it.`),
              element('code', 'mac-pair-link', currentMacPairing.url),
              button('Copy link', () => { void guard(async () => { await navigator.clipboard.writeText(currentMacPairing.url); copied.textContent = ' Copied.'; }); }), copied);
            parts.push(box);
          } else parts.push(button('Pair a Mac', () => {
            void guard(async () => {
              pairing = null; clearTimeout(expiry);
              const nextMacPairing = await api.phoneLinkPairMac() as PhoneLinkPairing;
              macPairing = nextMacPairing;
              clearTimeout(macExpiry);
              macExpiry = setTimeout(() => { void render(); }, nextMacPairing.minutes * 60000);
              draw(await api.phoneLinkState() as PhoneLinkState);
            });
          }));
        }
      }
    }
    if (state.devices.length) parts.push(notifications);
    parts.push(checkIns);
    if (state.devices.length) {
      parts.push(element('h4', 'phone-heading', 'Paired with the app'));
      for (const device of state.devices) parts.push(row(device.name, `${device.kind === 'mac' ? 'A Mac, as a face · ' : ''}Paired ${when(device.paired)}${device.lastSeen ? ` · last used ${when(device.lastSeen)}` : ''}`, [button('Remove', () => { void guard(async () => draw(await api.phoneLinkForget(device.id) as PhoneLinkState)); })]));
    }
    // Two Macs: this Mac as a face of the Fairy on another Mac (desktop/face-main.cjs).
    if (api.roleSetFace) {
      parts.push(element('h4', 'phone-heading', 'Another Mac'));
      parts.push(row('Use this Mac as a face', 'The Fairy on your other Mac does the thinking and keeps your chats; this Mac shows her and passes on what you say. Nothing here is changed or removed, and you can switch back from the menu bar.',
        [button('Use as a face…', () => { void guard(() => api.roleSetFace()); })]));
    }
    root.replaceChildren(...parts, failure);
  }
  function drawPush(push: PushState): void {
    const testNote = element('p', 'automation-note');
    const parts: HTMLElement[] = [element('h4', 'phone-heading', 'Notifications'), element('p', 'automation-note', 'With your own APNs key, this Mac sends notifications to your iPhone through Apple, with no server in between. What they say is sealed so only your phone can read it. Make the key at developer.apple.com, under Certificates, Identifiers & Profiles, then Keys: tick Apple Push Notifications service and download the .p8 file.')];
    if (push.key) {
      parts.push(row('APNs key', `Key ${push.key.keyId}, team ${push.key.teamId}`,
        [button('Send a test', () => { void guard(async () => { await api.pushTest(); failure.textContent = ''; testNote.textContent = 'Sent. It should arrive on your iPhone in a moment.'; }); }),
         button('Remove', () => { void guard(async () => drawPush(await api.pushKeyRemove() as PushState)); })]));
      parts.push(element('p', 'automation-note', push.phones.length ? `Sends to ${push.phones.join(', ')}.` : 'No iPhone has allowed notifications yet. Open Fairy on your iPhone and allow them when it asks.'));
    } else {
      const team = element('input', 'phone-team'); team.placeholder = 'Team ID'; team.maxLength = 10; team.setAttribute('aria-label', 'Your Apple Developer Team ID');
      parts.push(element('p', 'automation-note', 'Enter your Team ID (under Membership details on developer.apple.com), then choose the AuthKey_….p8 file.'));
      parts.push(row('APNs key', 'Not added', [team, button('Choose key file', () => { void guard(async () => drawPush(await api.pushKeyChoose(team.value) as PushState)); }, 'primary')]));
    }
    notifications.replaceChildren(...parts, testNote);
  }
  // Fairy checks in: how often, quiet hours, what to hear about, and the morning brief.
  function drawCheckIns(view: CheckInsView): void {
    const runNote = element('p', 'automation-note');
    const save = (change: CheckInsPatch) => guard(async () => drawCheckIns(await api.checkInsSet(change) as CheckInsView));
    const field = (label: string, control: HTMLElement): HTMLLabelElement => { const node = element('label', 'phone-field'); node.append(element('span', '', label), control); return node; };
    const select = (value: number | string, options: ReadonlyArray<readonly [number | string, string]>, change: (value: string) => void): HTMLSelectElement => {
      const node = element('select');
      for (const [key, label] of options) {
        const option = element('option', '', label);
        option.value = String(key);
        option.selected = String(key) === String(value);
        node.append(option);
      }
      node.onchange = () => change(node.value);
      return node;
    };
    const clock = (value: string, change: (value: string) => void): HTMLInputElement => {
      const node = element('input');
      node.type = 'time';
      node.value = value;
      node.onchange = () => change(node.value);
      return node;
    };
    const parts: HTMLElement[] = [element('h4', 'phone-heading', 'Fairy checks in'), element('p', 'automation-note', 'Every few hours Fairy looks at your unread email, your calendar and your work sessions, and messages you only when something deserves it. Each look is a turn on your integrations provider, so it counts against your plan. She only reads: nothing is sent, drafted or added.')];
    const c = view.checkIns, b = view.brief;
    parts.push(row('Check-ins', c.enabled ? `On, every ${c.everyHours} hour${c.everyHours === 1 ? '' : 's'}${view.lastCheck ? `; last looked ${when(view.lastCheck)}` : ''}` : 'Off',
      [button(c.enabled ? 'Turn off' : 'Turn on', () => { void save({ checkIns: { enabled: !c.enabled } }); }, c.enabled ? 'quiet' : 'primary'),
       button('Check in now', () => { void guard(async () => { const result = await api.checkInsRun('check') as { said?: boolean } | null | undefined; runNote.textContent = result?.said ? 'Fairy had something to say: it’s in the “From Fairy” chat.' : 'Nothing needed your attention.'; drawCheckIns(await api.checkInsState() as CheckInsView); }); })]));
    const topics = element('textarea', 'phone-topics'); topics.rows = 2; topics.maxLength = 1200; topics.value = c.topics; topics.placeholder = 'Flights and travel changes, anything from my supervisor, PR reviews…';
    topics.onchange = () => { void save({ checkIns: { topics: topics.value } }); };
    const fields = element('div', 'phone-fields');
    fields.append(field('Every', select(c.everyHours, [1, 2, 3, 4, 6, 8, 12].map(hours => [hours, `${hours} hour${hours === 1 ? '' : 's'}`] as const), value => { void save({ checkIns: { everyHours: Number(value) } }); })),
      field('Quiet from', clock(c.quietFrom, value => { void save({ checkIns: { quietFrom: value } }); })), field('Until', clock(c.quietTo, value => { void save({ checkIns: { quietTo: value } }); })),
      field('Tell me about', topics));
    parts.push(fields);
    parts.push(element('p', 'automation-note', 'Each morning, a short brief: your day’s calendar, email that needs you, and what your work sessions did.'));
    parts.push(row('Morning brief', b.enabled ? `On, at ${b.time}${view.lastBrief ? `; last sent ${view.lastBrief}` : ''}` : 'Off',
      [clock(b.time, value => { void save({ brief: { time: value } }); }),
       button(b.enabled ? 'Turn off' : 'Turn on', () => { void save({ brief: { enabled: !b.enabled } }); }, b.enabled ? 'quiet' : 'primary'),
       button('Brief me now', () => { void guard(async () => { await api.checkInsRun('brief'); runNote.textContent = 'Your brief is in the “From Fairy” chat.'; drawCheckIns(await api.checkInsState() as CheckInsView); }); })]));
    checkIns.replaceChildren(...parts, runNote);
  }
  async function render(): Promise<void> {
    await guard(async () => draw(await api.phoneLinkState() as PhoneLinkState));
    if (api?.pushState) await guard(async () => drawPush(await api.pushState() as PushState));
    if (api?.checkInsState) await guard(async () => drawCheckIns(await api.checkInsState() as CheckInsView));
  }
  api?.onPhoneLink?.(draw);
  return { render };
}
