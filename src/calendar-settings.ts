export interface CalendarStatusState {
  error?: string;
  configured?: boolean;
  connected?: boolean;
  canCreate?: boolean;
}

export interface CalendarCheckResult {
  count: number;
  primary?: string;
}

export interface CalendarSettingsApi {
  calendarStatus: () => Promise<CalendarStatusState>;
  calendarImport: () => Promise<CalendarStatusState>;
  calendarHelp: () => Promise<unknown>;
  calendarConnect: (writeAccess?: boolean) => Promise<CalendarStatusState>;
  calendarDisconnect: () => Promise<CalendarStatusState>;
  calendarCheck: () => Promise<CalendarCheckResult>;
}

export interface SetupCalendarSettingsOptions {
  api?: CalendarSettingsApi | null;
  root: HTMLElement;
}

export interface CalendarSettingsController {
  refresh: () => Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function setupCalendarSettings({ api, root }: SetupCalendarSettingsOptions): CalendarSettingsController {
  root.insertAdjacentHTML('beforeend', `
    <section aria-labelledby="calendar-title"><h3 id="calendar-title">Google Calendar</h3>
    <p class="field-note">Ask about your schedule, search events, or find free time. Calendar details used to answer you go to your conversation provider, and your reply remains in chat history. Calendar requests use your ChatGPT connection when DeepSeek, Gemini or Claude is selected.</p>
    <p class="field-note">Create a Google OAuth client of type Desktop app, enable Calendar API, and download its JSON. Import it here; credentials stay encrypted on this Mac.</p>
    <div class="field-grid"><button type="button" id="calendar-import" class="quiet">Import Google client JSON</button><button type="button" id="calendar-setup-help" class="quiet">Open Google setup</button></div>
    <label>Calendar access<select id="calendar-access"><option value="read">Read schedules and availability</option><option value="create">Read + create personal events</option></select></label>
    <p class="field-note">Creation shows an exact preview before saving to your primary calendar. No invitations, editing, or deletion. Changing access requires reconnecting.</p>
    <div class="field-grid"><button type="button" id="calendar-connect" class="quiet">Connect Google Calendar</button><button type="button" id="calendar-disconnect" class="quiet">Disconnect / cancel sign-in</button><button type="button" id="calendar-check" class="quiet">Check connection</button></div>
    <p id="calendar-status" class="field-note" role="status">Not connected.</p>
    <p class="field-note">Disconnect removes the client and tokens from Fairy. Google access can also be revoked in your Google Account → Third-party connections.</p></section>`);
  const $ = <T extends HTMLElement = HTMLElement>(id: string): T => root.querySelector<T>('#' + id)!;
  let connecting = false;
  const status = (s: CalendarStatusState) => {
    const expired = Boolean(s.error && s.configured && !s.connected);
    root.classList.toggle('is-connected', Boolean(s.connected));
    const connectBtn = $<HTMLButtonElement>('calendar-connect');
    const statusEl = $('calendar-status');
    connectBtn.textContent = `${expired ? 'Reconnect' : 'Connect'} Google Calendar`;
    connectBtn.classList.toggle('attention', expired);
    statusEl.classList.toggle('attention', expired);
    statusEl.textContent = s.error || (
      s.connected
        ? `Connected · ${s.canCreate ? 'read and create personal events' : 'read schedules and availability'}. Try “What’s on my calendar tomorrow?”`
        : s.configured
          ? 'Client imported. Connect to sign in with Google.'
          : 'Import your Google Desktop app JSON to begin.'
    );
    connectBtn.disabled = !api || !s.configured || connecting;
    $<HTMLButtonElement>('calendar-import').disabled = !api || connecting;
    $<HTMLButtonElement>('calendar-disconnect').disabled = !api;
    $<HTMLButtonElement>('calendar-check').disabled = !s.connected || connecting;
  };
  const fail = (e: unknown) => { $('calendar-status').textContent = errorMessage(e); };
  const refresh = async () => {
    if (!api) { status({}); return; }
    try {
      const s = await api.calendarStatus();
      status(s);
      $<HTMLSelectElement>('calendar-access').value = s.canCreate ? 'create' : 'read';
    } catch (e) { fail(e); }
  };
  $('calendar-import').onclick = async () => { try { status(await api!.calendarImport()); } catch (e) { fail(e); } };
  $('calendar-setup-help').onclick = () => void api?.calendarHelp().catch(fail);
  $<HTMLButtonElement>('calendar-connect').onclick = async () => {
    connecting = true;
    $<HTMLButtonElement>('calendar-connect').disabled = $<HTMLButtonElement>('calendar-import').disabled = true;
    $('calendar-status').textContent = 'Finish Google sign-in in your browser…';
    try {
      status(await api!.calendarConnect($<HTMLSelectElement>('calendar-access').value === 'create'));
    } catch (e) {
      fail(e);
    } finally {
      connecting = false;
      $<HTMLButtonElement>('calendar-import').disabled = false;
      try {
        const s = await api!.calendarStatus();
        $<HTMLButtonElement>('calendar-connect').disabled = !s.configured;
        $<HTMLButtonElement>('calendar-check').disabled = !s.connected;
      } catch {}
    }
  };
  $('calendar-disconnect').onclick = async () => {
    try { connecting = false; status(await api!.calendarDisconnect()); } catch (e) { fail(e); }
  };
  $<HTMLButtonElement>('calendar-check').onclick = async () => {
    $<HTMLButtonElement>('calendar-check').disabled = true;
    try {
      const s = await api!.calendarCheck();
      $('calendar-status').textContent = `Connection verified · ${s.count} calendar${s.count === 1 ? '' : 's'} accessible${s.primary ? ' · ' + s.primary : ''}.`;
    } catch (e) {
      fail(e);
    } finally {
      $<HTMLButtonElement>('calendar-check').disabled = false;
    }
  };
  return { refresh };
}
