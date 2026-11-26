export function setupGmailSettings({ api, root }) {
  root.insertAdjacentHTML('beforeend', `
    <section aria-labelledby="gmail-title"><h3 id="gmail-title">Gmail</h3>
    <p class="field-note">Search your mail, summarize unread messages or threads, save reply drafts, and suggest calendar events. Email details used to answer you go to your conversation provider, and your reply remains in chat history. Gmail requests use your ChatGPT connection when DeepSeek, Gemini or Claude is selected.</p>
    <p class="field-note">Enable Gmail API in the Google Cloud project used for Calendar. Reuse its Desktop app client here, or import its JSON. Gmail sign-in is separate; credentials stay encrypted on this Mac.</p>
    <div class="field-grid"><button type="button" id="gmail-use-calendar" class="quiet">Use Calendar’s Google client</button><button type="button" id="gmail-import" class="quiet">Import Google client JSON</button><button type="button" id="gmail-setup-help" class="quiet">Open Google setup</button></div>
    <label>Gmail access<select id="gmail-access"><option value="read">Read email</option><option value="create">Read + save reply drafts</option></select></label>
    <p class="field-note">Saved drafts remain unsent for you to review in Gmail. Google’s draft permission also mentions sending; Fairy has no sending operation. Changing access requires reconnecting.</p>
    <div class="field-grid"><button type="button" id="gmail-connect" class="quiet">Connect Gmail</button><button type="button" id="gmail-disconnect" class="quiet">Disconnect / cancel sign-in</button><button type="button" id="gmail-check" class="quiet">Check connection</button></div>
    <p id="gmail-status" class="field-note" role="status">Not connected.</p>
    <p class="field-note">Disconnect removes the client and tokens from Fairy. Google access can also be revoked in your Google Account → Third-party connections.</p></section>`);
  const $ = id => root.querySelector('#' + id);
  let connecting = false;
  const status = s => {
    const expired = Boolean(s.error && s.configured && !s.connected);
    root.classList.toggle('is-connected', Boolean(s.connected));
    $('gmail-connect').textContent = `${expired ? 'Reconnect' : 'Connect'} Gmail`; $('gmail-connect').classList.toggle('attention', expired); $('gmail-status').classList.toggle('attention', expired);
    $('gmail-status').textContent = s.error || (s.connected ? `Connected · ${s.canDraft ? 'read and save reply drafts' : 'read email'}. Try “Summarize my unread emails.”` : s.configured ? 'Client imported. Connect to sign in with Google.' : 'Reuse Calendar’s Google client or import your Desktop app JSON to begin.');
    $('gmail-connect').disabled = !api || !s.configured || connecting;
    $('gmail-import').disabled = !api || connecting; $('gmail-use-calendar').disabled = !api || connecting;
    $('gmail-disconnect').disabled = !api;
    $('gmail-check').disabled = !s.connected || connecting;
  };
  const fail = e => { $('gmail-status').textContent = e.message; };
  const refresh = async () => { if (!api) { status({}); return; } try { const s = await api.gmailStatus(); status(s); $('gmail-access').value = s.canDraft ? 'create' : 'read'; } catch (e) { fail(e); } };
  $('gmail-use-calendar').onclick = async () => { try { status(await api.gmailUseCalendarClient()); } catch (e) { fail(e); } };
  $('gmail-import').onclick = async () => { try { status(await api.gmailImport()); } catch (e) { fail(e); } };
  $('gmail-setup-help').onclick = () => api?.gmailHelp().catch(fail);
  $('gmail-connect').onclick = async () => {
    connecting = true; $('gmail-connect').disabled = $('gmail-import').disabled = $('gmail-use-calendar').disabled = true; $('gmail-status').textContent = 'Finish Google sign-in in your browser…';
    try { status(await api.gmailConnect($('gmail-access').value === 'create')); } catch (e) { fail(e); }
    finally {
      connecting = false; $('gmail-import').disabled = $('gmail-use-calendar').disabled = false;
      try { const s = await api.gmailStatus(); $('gmail-connect').disabled = !s.configured; $('gmail-check').disabled = !s.connected; } catch {}
    }
  };
  $('gmail-disconnect').onclick = async () => { try { connecting = false; status(await api.gmailDisconnect()); } catch (e) { fail(e); } };
  $('gmail-check').onclick = async () => {
    $('gmail-check').disabled = true;
    try { const s = await api.gmailCheck(); $('gmail-status').textContent = `Connection verified · ${s.email}.`; }
    catch (e) { fail(e); } finally { $('gmail-check').disabled = false; }
  };
  return { refresh };
}
