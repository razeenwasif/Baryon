export function setupGoogleAccountSettings({ api, root, onChanged = () => {} }) {
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

  const $ = id => root.querySelector('#' + id);
  let busy = false;

  const renderStatus = s => {
    const data = s || {};
    const svcs = data.services || {};
    const linkedNames = [
      svcs.calendar?.connected ? 'Calendar' : '',
      svcs.gmail?.connected ? 'Gmail' : '',
      svcs.drive?.connected ? 'Drive / Docs / Sheets / Slides' : '',
    ].filter(Boolean);
    root.classList.toggle('is-connected', Boolean(data.connected));
    const connectBtn = $('google-account-connect');
    connectBtn.textContent = data.connected ? 'Reconnect & Auto-Connect' : 'Sign in with Google & Auto-Connect';
    connectBtn.disabled = !api || !data.configured || busy;
    $('google-account-switch').disabled = !api || !data.configured || busy;
    $('google-account-import').disabled = !api || busy;
    $('google-account-disconnect').disabled = !api || busy || !data.connected;

    if (data.error) {
      $('google-account-status').textContent = data.error;
      $('google-account-status').classList.add('attention');
    } else {
      $('google-account-status').classList.remove('attention');
      $('google-account-status').textContent = data.connected
        ? `Signed in${data.email ? ` as ${data.name ? `${data.name} (${data.email})` : data.email}` : ''}.`
        : data.configured
          ? 'Google OAuth client ready. Click Sign in with Google to auto-connect Workspace plugins.'
          : 'Import your Google Desktop app OAuth JSON once to enable one-click Google Workspace sign-in.';
    }
    $('google-account-services').textContent = linkedNames.length
      ? `Auto-connected plugins: ${linkedNames.join(', ')}.`
      : 'Connected Workspace plugins will appear here.';
  };

  const fail = error => {
    $('google-account-status').textContent = error?.message || String(error);
  };

  const refresh = async () => {
    if (!api?.googleAccountStatus) { renderStatus({}); return; }
    try { renderStatus(await api.googleAccountStatus()); } catch (e) { fail(e); }
  };

  $('google-account-help').onclick = () => api?.googleAccountHelp?.().catch(fail);

  $('google-account-import').onclick = async () => {
    busy = true; renderStatus(await api?.googleAccountStatus?.().catch(() => ({})));
    try {
      const next = await api.googleAccountImport();
      busy = false;
      renderStatus(next);
      onChanged({});
    } catch (e) {
      busy = false;
      fail(e);
    }
  };

  $('google-account-connect').onclick = async () => {
    busy = true;
    $('google-account-connect').disabled = $('google-account-switch').disabled = $('google-account-import').disabled = true;
    $('google-account-status').textContent = 'Finish Google sign-in in your browser…';
    try {
      const res = await api.googleAccountConnect({ writeAccess: $('google-account-access').value === 'create' });
      busy = false;
      renderStatus(res);
      onChanged(res);
    } catch (e) {
      busy = false;
      fail(e);
      await refresh();
    }
  };

  $('google-account-switch').onclick = async () => {
    const alsoSwitchAntigravity = Boolean($('google-account-also-agy').checked);
    busy = true;
    $('google-account-connect').disabled = $('google-account-switch').disabled = $('google-account-import').disabled = true;
    $('google-account-status').textContent = 'Choose a Google account in your browser…';
    try {
      const res = await api.googleAccountSwitch({
        writeAccess: $('google-account-access').value === 'create',
        alsoSwitchAntigravity,
      });
      busy = false;
      renderStatus(res);
      if (res?.antigravitySwitch?.message) {
        $('google-account-status').textContent += ` ${res.antigravitySwitch.message}`;
      }
      onChanged({ ...res, antigravitySwitched: alsoSwitchAntigravity });
    } catch (e) {
      busy = false;
      fail(e);
      await refresh();
    }
  };

  $('google-account-disconnect').onclick = async () => {
    busy = true;
    try {
      const res = await api.googleAccountDisconnect({ keepClient: true, disconnectServices: true });
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
