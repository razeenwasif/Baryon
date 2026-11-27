export function setupDriveSettings({ api, root }) {
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

  const $ = id => root.querySelector('#' + id);
  let connecting = false;

  const status = s => {
    const expired = Boolean(s.error && s.configured && !s.connected);
    root.classList.toggle('is-connected', Boolean(s.connected));
    $('drive-connect').textContent = `${expired ? 'Reconnect' : 'Connect'} Google Drive`; $('drive-connect').classList.toggle('attention', expired); $('drive-status').classList.toggle('attention', expired);
    $('drive-status').textContent = s.error || (
      s.connected
        ? `Connected · ${s.canCreate ? 'read and create files' : 'read files & docs'}. Try “Search my Google Drive for notes.”`
        : s.configured
          ? 'Client ready. Connect to sign in with Google.'
          : 'Reuse Calendar/Gmail client or import your Desktop app JSON to begin.'
    );
    $('drive-connect').disabled = !api || !s.configured || connecting;
    $('drive-import').disabled = !api || connecting;
    $('drive-use-google-client').disabled = !api || connecting;
    $('drive-disconnect').disabled = !api;
    $('drive-check').disabled = !s.connected || connecting;
  };

  const fail = e => { $('drive-status').textContent = e.message; };

  const refresh = async () => {
    if (!api) { status({}); return; }
    try {
      const s = await api.driveStatus();
      status(s);
      $('drive-access').value = s.canCreate ? 'create' : 'read';
    } catch (e) {
      fail(e);
    }
  };

  $('drive-use-google-client').onclick = async () => {
    try {
      status(await api.driveUseGoogleClient());
    } catch (e) {
      fail(e);
    }
  };

  $('drive-import').onclick = async () => {
    try {
      status(await api.driveImport());
    } catch (e) {
      fail(e);
    }
  };

  $('drive-setup-help').onclick = () => api?.driveHelp().catch(fail);

  $('drive-connect').onclick = async () => {
    connecting = true;
    $('drive-connect').disabled = $('drive-import').disabled = $('drive-use-google-client').disabled = true;
    $('drive-status').textContent = 'Finish Google sign-in in your browser…';
    try {
      status(await api.driveConnect($('drive-access').value === 'create'));
    } catch (e) {
      fail(e);
    } finally {
      connecting = false;
      $('drive-import').disabled = $('drive-use-google-client').disabled = false;
      try {
        const s = await api.driveStatus();
        $('drive-connect').disabled = !s.configured;
        $('drive-check').disabled = !s.connected;
      } catch {}
    }
  };

  $('drive-disconnect').onclick = async () => {
    try {
      connecting = false;
      status(await api.driveDisconnect());
    } catch (e) {
      fail(e);
    }
  };

  $('drive-check').onclick = async () => {
    $('drive-check').disabled = true;
    try {
      const s = await api.driveCheck();
      $('drive-status').textContent = `Connection verified · ${s.email || s.name || 'connected'}.`;
    } catch (e) {
      fail(e);
    } finally {
      $('drive-check').disabled = false;
    }
  };

  return { refresh };
}
