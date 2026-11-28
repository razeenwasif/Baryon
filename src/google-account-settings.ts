import type { BaryonPreloadApi } from '../desktop/ipc-contract.js';

export interface GoogleAccountServiceStatus {
  connected?: boolean;
  [key: string]: unknown;
}

export interface GoogleAccountStatus {
  connected?: boolean;
  configured?: boolean;
  email?: string;
  name?: string;
  error?: string;
  services?: {
    calendar?: GoogleAccountServiceStatus;
    gmail?: GoogleAccountServiceStatus;
    drive?: GoogleAccountServiceStatus;
    [key: string]: GoogleAccountServiceStatus | undefined;
  };
  antigravitySwitch?: {
    message?: string;
    [key: string]: unknown;
  };
  antigravitySwitched?: boolean;
  [key: string]: unknown;
}

export interface SetupGoogleAccountSettingsOptions {
  api: BaryonPreloadApi | null | undefined;
  root: HTMLElement;
  onChanged?: (status: GoogleAccountStatus) => void;
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const msg = (error as { message?: unknown }).message;
    if (msg) return String(msg);
  }
  return String(error);
}

export function setupGoogleAccountSettings({ api, root, onChanged = () => {} }: SetupGoogleAccountSettingsOptions): { refresh: () => Promise<void> } {
  root.insertAdjacentHTML('beforeend', `
    <section aria-labelledby="google-account-title"><h4 id="google-account-title">Google Account</h4>
    <p class="field-note">Sign in with one Google account to auto-connect Google Calendar, Gmail, Google Drive, Docs, Sheets, and Slides together, and switch accounts anytime.</p>
    <div class="field-grid">
      <button type="button" id="google-account-import" class="quiet">Import Google client JSON</button>
      <button type="button" id="google-account-help" class="quiet">Google setup ↗</button>
    </div>
    <label>Workspace access<select id="google-account-access">
      <option value="read">Read Gmail, Calendar &amp; Drive</option>
      <option value="create">Read + save drafts, events &amp; Docs</option>
    </select></label>
    <label class="check"><input type="checkbox" id="google-account-also-agy"> Also switch Antigravity (agy) Gemini account when switching</label>
    <div class="field-grid">
      <button type="button" id="google-account-connect" class="quiet">Sign in with Google &amp; Auto-Connect</button>
      <button type="button" id="google-account-switch" class="quiet">Switch Google account</button>
      <button type="button" id="google-account-disconnect" class="quiet">Sign out</button>
    </div>
    <p id="google-account-status" class="field-note" role="status">Not signed in.</p>
    <p id="google-account-services" class="field-note"></p>
    </section>`);

  const $ = <T extends HTMLElement = HTMLElement>(id: string): T => root.querySelector('#' + id) as T;
  let busy = false;

  const renderStatus = (s?: GoogleAccountStatus | null): void => {
    const data: GoogleAccountStatus = s || {};
    const svcs = data.services || {};
    const linkedNames = [
      svcs.calendar?.connected ? 'Calendar' : '',
      svcs.gmail?.connected ? 'Gmail' : '',
      svcs.drive?.connected ? 'Drive / Docs / Sheets / Slides' : '',
    ].filter(Boolean);
    root.classList.toggle('is-connected', Boolean(data.connected));
    const connectBtn = $<HTMLButtonElement>('google-account-connect');
    connectBtn.textContent = data.connected ? 'Reconnect & Auto-Connect' : 'Sign in with Google & Auto-Connect';
    connectBtn.disabled = !api || !data.configured || busy;
    $<HTMLButtonElement>('google-account-switch').disabled = !api || !data.configured || busy;
    $<HTMLButtonElement>('google-account-import').disabled = !api || busy;
    $<HTMLButtonElement>('google-account-disconnect').disabled = !api || busy || !data.connected;

    const statusEl = $<HTMLParagraphElement>('google-account-status');
    if (data.error) {
      statusEl.textContent = data.error;
      statusEl.classList.add('attention');
    } else {
      statusEl.classList.remove('attention');
      statusEl.textContent = data.connected
        ? `Signed in${data.email ? ` as ${data.name ? `${data.name} (${data.email})` : data.email}` : ''}.`
        : data.configured
          ? 'Google OAuth client ready. Click Sign in with Google to auto-connect Workspace plugins.'
          : 'Import your Google Desktop app OAuth JSON once to enable one-click Google Workspace sign-in.';
    }
    $<HTMLParagraphElement>('google-account-services').textContent = linkedNames.length
      ? `Auto-connected plugins: ${linkedNames.join(', ')}.`
      : 'Connected Workspace plugins will appear here.';
  };

  const fail = (error: unknown): void => {
    $<HTMLParagraphElement>('google-account-status').textContent = errorMessage(error);
  };

  const refresh = async (): Promise<void> => {
    if (!api?.googleAccountStatus) { renderStatus({}); return; }
    try { renderStatus(await api.googleAccountStatus() as GoogleAccountStatus); } catch (e) { fail(e); }
  };

  $<HTMLButtonElement>('google-account-help').onclick = () => api?.googleAccountHelp?.().catch(fail);

  $<HTMLButtonElement>('google-account-import').onclick = async () => {
    busy = true; renderStatus(await api?.googleAccountStatus?.().catch(() => ({})) as GoogleAccountStatus | undefined);
    try {
      const next = await api!.googleAccountImport() as GoogleAccountStatus;
      busy = false;
      renderStatus(next);
      onChanged({});
    } catch (e) {
      busy = false;
      fail(e);
    }
  };

  $<HTMLButtonElement>('google-account-connect').onclick = async () => {
    busy = true;
    $<HTMLButtonElement>('google-account-connect').disabled = $<HTMLButtonElement>('google-account-switch').disabled = $<HTMLButtonElement>('google-account-import').disabled = true;
    $<HTMLParagraphElement>('google-account-status').textContent = 'Finish Google sign-in in your browser…';
    try {
      const res = await api!.googleAccountConnect({ writeAccess: $<HTMLSelectElement>('google-account-access').value === 'create' }) as GoogleAccountStatus;
      busy = false;
      renderStatus(res);
      onChanged(res);
    } catch (e) {
      busy = false;
      fail(e);
      await refresh();
    }
  };

  $<HTMLButtonElement>('google-account-switch').onclick = async () => {
    const alsoSwitchAntigravity = Boolean($<HTMLInputElement>('google-account-also-agy').checked);
    busy = true;
    $<HTMLButtonElement>('google-account-connect').disabled = $<HTMLButtonElement>('google-account-switch').disabled = $<HTMLButtonElement>('google-account-import').disabled = true;
    $<HTMLParagraphElement>('google-account-status').textContent = 'Choose a Google account in your browser…';
    try {
      const res = await api!.googleAccountSwitch({
        writeAccess: $<HTMLSelectElement>('google-account-access').value === 'create',
        alsoSwitchAntigravity,
      }) as GoogleAccountStatus;
      busy = false;
      renderStatus(res);
      if (res?.antigravitySwitch?.message) {
        $<HTMLParagraphElement>('google-account-status').textContent += ` ${res.antigravitySwitch.message}`;
      }
      onChanged({ ...res, antigravitySwitched: alsoSwitchAntigravity });
    } catch (e) {
      busy = false;
      fail(e);
      await refresh();
    }
  };

  $<HTMLButtonElement>('google-account-disconnect').onclick = async () => {
    busy = true;
    try {
      const res = await api!.googleAccountDisconnect({ keepClient: true, disconnectServices: true }) as GoogleAccountStatus;
      busy = false;
      renderStatus(res);
      onChanged(res);
    } catch (e) {
      busy = false;
      fail(e);
    }
  };

  return { refresh };
}
