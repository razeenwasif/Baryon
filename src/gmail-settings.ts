export interface GmailStatus {
  configured?: boolean;
  connected?: boolean;
  canDraft?: boolean;
  error?: string;
}

export interface GmailCheckResult {
  email?: string;
}

export interface GmailSettingsApi {
  gmailStatus(): Promise<GmailStatus>;
  gmailUseCalendarClient(): Promise<GmailStatus>;
  gmailImport(): Promise<GmailStatus>;
  gmailHelp(): Promise<unknown>;
  gmailConnect(canDraft: boolean): Promise<GmailStatus>;
  gmailDisconnect(): Promise<GmailStatus>;
  gmailCheck(): Promise<GmailCheckResult>;
}

export interface SetupGmailSettingsOptions {
  api?: GmailSettingsApi | null;
  root: HTMLElement;
}

export interface GmailSettingsController {
  refresh: () => Promise<void>;
}

const errorMessage = (e: unknown): string =>
  e instanceof Error ? e.message : (typeof e === 'object' && e !== null && 'message' in e ? String((e as { message: unknown }).message) : String(e));

export function setupGmailSettings({ api, root }: SetupGmailSettingsOptions): GmailSettingsController {
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

  const $ = <T extends HTMLElement = HTMLElement>(id: string): T => root.querySelector<T>('#' + id)!;
  const btn = (id: string): HTMLButtonElement => $<HTMLButtonElement>(id);
  const select = (id: string): HTMLSelectElement => $<HTMLSelectElement>(id);
  let connecting = false;

  const status = (s: GmailStatus): void => {
    const expired = Boolean(s.error && s.configured && !s.connected);
    root.classList.toggle('is-connected', Boolean(s.connected));
    btn('gmail-connect').textContent = `${expired ? 'Reconnect' : 'Connect'} Gmail`; btn('gmail-connect').classList.toggle('attention', expired); $('gmail-status').classList.toggle('attention', expired);
    $('gmail-status').textContent = s.error || (s.connected ? `Connected · ${s.canDraft ? 'read and save reply drafts' : 'read email'}. Try “Summarize my unread emails.”` : s.configured ? 'Client imported. Connect to sign in with Google.' : 'Reuse Calendar’s Google client or import your Desktop app JSON to begin.');
    btn('gmail-connect').disabled = !api || !s.configured || connecting;
    btn('gmail-import').disabled = !api || connecting; btn('gmail-use-calendar').disabled = !api || connecting;
    btn('gmail-disconnect').disabled = !api;
    btn('gmail-check').disabled = !s.connected || connecting;
  };

  const fail = (e: unknown): void => { $('gmail-status').textContent = errorMessage(e); };
  const refresh = async (): Promise<void> => {
    if (!api) { status({}); return; }
    try { const s = await api.gmailStatus(); status(s); select('gmail-access').value = s.canDraft ? 'create' : 'read'; } catch (e) { fail(e); }
  };

  btn('gmail-use-calendar').onclick = async () => { if (!api) return; try { status(await api.gmailUseCalendarClient()); } catch (e) { fail(e); } };
  btn('gmail-import').onclick = async () => { if (!api) return; try { status(await api.gmailImport()); } catch (e) { fail(e); } };
  btn('gmail-setup-help').onclick = () => { void api?.gmailHelp().catch(fail); };
  btn('gmail-connect').onclick = async () => {
    if (!api) return;
    connecting = true; btn('gmail-connect').disabled = btn('gmail-import').disabled = btn('gmail-use-calendar').disabled = true; $('gmail-status').textContent = 'Finish Google sign-in in your browser…';
    try { status(await api.gmailConnect(select('gmail-access').value === 'create')); } catch (e) { fail(e); }
    finally {
      connecting = false; btn('gmail-import').disabled = btn('gmail-use-calendar').disabled = false;
      try { const s = await api.gmailStatus(); btn('gmail-connect').disabled = !s.configured; btn('gmail-check').disabled = !s.connected; } catch {}
    }
  };
  btn('gmail-disconnect').onclick = async () => { if (!api) return; try { connecting = false; status(await api.gmailDisconnect()); } catch (e) { fail(e); } };
  btn('gmail-check').onclick = async () => {
    if (!api) return;
    btn('gmail-check').disabled = true;
    try { const s = await api.gmailCheck(); $('gmail-status').textContent = `Connection verified · ${s.email}.`; }
    catch (e) { fail(e); } finally { btn('gmail-check').disabled = false; }
  };
  return { refresh };
}
