export interface DriveStatus {
  configured?: boolean;
  connected?: boolean;
  canCreate?: boolean;
  error?: string;
}

export interface DriveCheckResult {
  email?: string;
  name?: string;
}

export interface DriveSettingsApi {
  driveStatus(): Promise<DriveStatus>;
  driveUseGoogleClient(): Promise<DriveStatus>;
  driveImport(): Promise<DriveStatus>;
  driveHelp(): Promise<unknown>;
  driveConnect(canCreate: boolean): Promise<DriveStatus>;
  driveDisconnect(): Promise<DriveStatus>;
  driveCheck(): Promise<DriveCheckResult>;
}

export interface SetupDriveSettingsOptions {
  api?: DriveSettingsApi | null;
  root: HTMLElement;
}

export interface DriveSettingsController {
  refresh: () => Promise<void>;
}

const errorMessage = (e: unknown): string =>
  e instanceof Error ? e.message : (typeof e === 'object' && e !== null && 'message' in e ? String((e as { message: unknown }).message) : String(e));

export function setupDriveSettings({ api, root }: SetupDriveSettingsOptions): DriveSettingsController {
  root.insertAdjacentHTML('beforeend', `
    <section aria-labelledby="drive-title"><h3 id="drive-title">Google Drive</h3>
    <p class="field-note">Search your Google Drive, read Google Docs and Google Sheets, inspect recent documents, and create notes or files. Document excerpts used to answer you go to your conversation provider, and responses remain in chat history.</p>
    <p class="field-note">Enable Google Drive API in your Google Cloud project. You can reuse the Google client from Calendar or Gmail with one click, or import a Desktop app JSON. Drive sign-in is separate; credentials stay encrypted on this Mac.</p>
    <div class="field-grid">
      <button type="button" id="drive-use-google-client" class="quiet">Use Calendar/Gmail client</button>
      <button type="button" id="drive-import" class="quiet">Import Google client JSON</button>
      <button type="button" id="drive-setup-help" class="quiet">Open Google setup</button>
    </div>
    <label>Google Drive access
      <select id="drive-access">
        <option value="read">Read files & docs</option>
        <option value="create">Read + create files</option>
      </select>
    </label>
    <p class="field-note">Read mode exports Google Docs as text and Google Sheets as CSV. Read + create mode allows Fairy to propose creating new files with your approval. Changing access requires reconnecting.</p>
    <div class="field-grid">
      <button type="button" id="drive-connect" class="quiet">Connect Google Drive</button>
      <button type="button" id="drive-disconnect" class="quiet">Disconnect / cancel sign-in</button>
      <button type="button" id="drive-check" class="quiet">Check connection</button>
    </div>
    <p id="drive-status" class="field-note" role="status">Not connected.</p>
    <p class="field-note">Disconnect removes the client and tokens from Fairy. Google access can also be revoked in your Google Account → Third-party connections.</p>
  </section>`);

  const $ = <T extends HTMLElement = HTMLElement>(id: string): T => root.querySelector<T>('#' + id)!;
  const btn = (id: string): HTMLButtonElement => $<HTMLButtonElement>(id);
  const select = (id: string): HTMLSelectElement => $<HTMLSelectElement>(id);
  let connecting = false;

  const status = (s: DriveStatus): void => {
    const expired = Boolean(s.error && s.configured && !s.connected);
    root.classList.toggle('is-connected', Boolean(s.connected));
    btn('drive-connect').textContent = `${expired ? 'Reconnect' : 'Connect'} Google Drive`; btn('drive-connect').classList.toggle('attention', expired); $('drive-status').classList.toggle('attention', expired);
    $('drive-status').textContent = s.error || (
      s.connected
        ? `Connected · ${s.canCreate ? 'read and create files' : 'read files & docs'}. Try “Search my Google Drive for notes.”`
        : s.configured
          ? 'Client ready. Connect to sign in with Google.'
          : 'Reuse Calendar/Gmail client or import your Desktop app JSON to begin.'
    );
    btn('drive-connect').disabled = !api || !s.configured || connecting;
    btn('drive-import').disabled = !api || connecting;
    btn('drive-use-google-client').disabled = !api || connecting;
    btn('drive-disconnect').disabled = !api;
    btn('drive-check').disabled = !s.connected || connecting;
  };

  const fail = (e: unknown): void => { $('drive-status').textContent = errorMessage(e); };

  const refresh = async (): Promise<void> => {
    if (!api) { status({}); return; }
    try {
      const s = await api.driveStatus();
      status(s);
      select('drive-access').value = s.canCreate ? 'create' : 'read';
    } catch (e) {
      fail(e);
    }
  };

  btn('drive-use-google-client').onclick = async () => {
    if (!api) return;
    try {
      status(await api.driveUseGoogleClient());
    } catch (e) {
      fail(e);
    }
  };

  btn('drive-import').onclick = async () => {
    if (!api) return;
    try {
      status(await api.driveImport());
    } catch (e) {
      fail(e);
    }
  };

  btn('drive-setup-help').onclick = () => { void api?.driveHelp().catch(fail); };

  btn('drive-connect').onclick = async () => {
    if (!api) return;
    connecting = true;
    btn('drive-connect').disabled = btn('drive-import').disabled = btn('drive-use-google-client').disabled = true;
    $('drive-status').textContent = 'Finish Google sign-in in your browser…';
    try {
      status(await api.driveConnect(select('drive-access').value === 'create'));
    } catch (e) {
      fail(e);
    } finally {
      connecting = false;
      btn('drive-import').disabled = btn('drive-use-google-client').disabled = false;
      try {
        const s = await api.driveStatus();
        btn('drive-connect').disabled = !s.configured;
        btn('drive-check').disabled = !s.connected;
      } catch {}
    }
  };

  btn('drive-disconnect').onclick = async () => {
    if (!api) return;
    try {
      connecting = false;
      status(await api.driveDisconnect());
    } catch (e) {
      fail(e);
    }
  };

  btn('drive-check').onclick = async () => {
    if (!api) return;
    btn('drive-check').disabled = true;
    try {
      const s = await api.driveCheck();
      $('drive-status').textContent = `Connection verified · ${s.email || s.name || 'connected'}.`;
    } catch (e) {
      fail(e);
    } finally {
      btn('drive-check').disabled = false;
    }
  };

  return { refresh };
}
