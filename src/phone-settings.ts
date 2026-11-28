import qrcode from 'qrcode-generator';

export interface PhonePairing {
  url: string;
  minutes: number;
}

export interface PhoneDevice {
  id: string;
  name: string;
  paired: string | number;
  lastSeen?: string | number;
}

export interface PhoneState {
  enabled: boolean;
  listening: boolean;
  pairing?: boolean;
  onOtherNetwork?: boolean;
  address?: string;
  problem?: string;
  firewall?: 'blocked' | 'waiting' | string;
  devices: PhoneDevice[];
}

export interface PhoneSettingsApi {
  phoneState: () => Promise<PhoneState>;
  phoneSet: (on: boolean) => Promise<PhoneState>;
  phonePair: () => Promise<PhonePairing>;
  phoneForget: (id: string) => Promise<PhoneState>;
  onPhone?: (callback: (state: PhoneState) => void) => unknown;
}

export interface SetupPhoneSettingsOptions {
  api: PhoneSettingsApi;
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

// Dark squares on white with a clear edge, which is what phone cameras need whatever the theme.
export function qrPicture(text: string): SVGSVGElement {
  const code = qrcode(0, 'M');
  code.addData(text, 'Byte');
  code.make();
  const size = code.getModuleCount(), edge = 4, ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg'), path = document.createElementNS(ns, 'path');
  let squares = '';
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) if (code.isDark(y, x)) squares += `M${x + edge} ${y + edge}h1v1h-1z`;
  svg.setAttribute('viewBox', `0 0 ${size + edge * 2} ${size + edge * 2}`); svg.setAttribute('class', 'phone-code'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Code to scan with your phone');
  path.setAttribute('d', squares); path.setAttribute('fill', '#000');
  svg.append(path);
  return svg;
}

export function setupPhoneSettings({ api, root }: SetupPhoneSettingsOptions): { render: () => Promise<void> } {
  let pairing: PhonePairing | null = null;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  const failure = element('p', 'automation-error');
  const guard = async <T>(run: () => Promise<T>): Promise<T | undefined> => {
    failure.textContent = '';
    try { return await run(); } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failure.textContent = String(message).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
      return undefined;
    }
  };
  const row = (title: string, detail: string, actions: HTMLElement[] = []): HTMLDivElement => {
    const node = element('div', 'automation-row'), words = element('div', 'automation-words');
    words.append(element('strong', '', title));
    if (detail) words.append(element('span', '', detail));
    node.append(words, ...actions);
    return node;
  };
  const clearPairing = () => { pairing = null; clearTimeout(expiry); };
  function pairingView(): HTMLDivElement {
    const current = pairing!;
    const box = element('div', 'phone-pairing');
    box.append(qrPicture(current.url), element('p', 'automation-note', `Scan this with your phone’s camera while it’s on the same Wi-Fi. It works once and lasts ${current.minutes} minutes. Anyone who sees it can pair, so don’t share it.`));
    return box;
  }
  function draw(state: PhoneState): void {
    if (!state.listening || state.pairing === false) clearPairing();
    const parts: HTMLElement[] = [element('p', 'automation-note', 'Follow work sessions and answer Fairy’s questions from your phone while it’s on your home network. It stays off until you turn it on, and it only works while Fairy is open and this Mac is awake.')];
    if (!state.enabled) {
      parts.push(element('p', 'automation-note', 'Turning this on opens a small web server on the network you’re on now, and only that one. Traffic on it isn’t encrypted, so someone else on your Wi-Fi with the right tools could read what the phone shows. Only use a network you trust. If macOS asks whether Fairy can accept incoming connections, choose Allow, or your phone won’t be able to connect.'));
      parts.push(button('Turn on for this network', () => { void guard(async () => draw(await api.phoneSet(true))); }, 'primary'));
    } else {
      const words = state.onOtherNetwork ? 'Closed on this network'
        : state.listening ? `On, at ${state.address}`
          : state.problem || 'Waiting for your home network.';
      parts.push(row('Phone access', words, [button('Turn off', () => { void guard(async () => draw(await api.phoneSet(false))); })]));
      if (state.onOtherNetwork) parts.push(element('p', 'automation-note', 'This Mac is on a different network from the one you chose. To use this one instead, turn this off and on again.'));
      if (state.firewall === 'blocked') parts.push(element('p', 'automation-error', 'Your Mac’s firewall is blocking Fairy, so your phone can’t connect. In System Settings, open Network, then Firewall, then Options, and set Fairy to allow incoming connections. If Electron is listed and blocked, remove it too.'));
      if (state.firewall === 'waiting') parts.push(element('p', 'automation-note', 'Your Mac’s firewall hasn’t let Fairy through yet. If macOS is asking whether Fairy can accept incoming connections, choose Allow.'));
      if (state.listening) parts.push(element('p', 'automation-note', 'If your phone can’t connect, check it isn’t on a guest network. If the address above changes, pair your phone again.'));
      if (state.listening) {
        parts.push(pairing ? pairingView() : button('Pair a phone', () => {
          void guard(async () => {
            pairing = await api.phonePair();
            clearTimeout(expiry);
            expiry = setTimeout(render, pairing.minutes * 60000);
            draw(await api.phoneState());
          });
        }, 'primary'));
      }
    }
    if (state.devices.length) {
      parts.push(element('h4', 'phone-heading', 'Paired phones'));
      for (const device of state.devices) parts.push(row(device.name, `Paired ${when(device.paired)}${device.lastSeen ? ` · last used ${when(device.lastSeen)}` : ''}`, [button('Remove', () => { void guard(async () => draw(await api.phoneForget(device.id))); })]));
    }
    root.replaceChildren(...parts, failure);
  }
  async function render(): Promise<void> { await guard(async () => draw(await api.phoneState())); }
  api?.onPhone?.(draw);
  return { render };
}
