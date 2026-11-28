import type { BaryonPreloadApi } from '../desktop/ipc-contract.js';

export interface MeetingLine {
  source: string;
  text: string;
}

export interface MeetingState {
  status: string;
  lines: number;
  recent?: MeetingLine[];
  startedAt?: string | number;
  microphone?: boolean;
  error?: string;
}

export interface SetupMeetingPanelOptions {
  api: BaryonPreloadApi | null | undefined;
  $: (selector: string) => Element | null;
  onChange?: (meeting: MeetingState) => void;
  onError?: (message: string) => void;
}

export interface MeetingPanelHandle {
  update: (value: MeetingState | null | undefined) => void;
  readonly state: MeetingState;
}

// Meeting mode controls. The transcript lives in the main process; this panel
// only shows its status and the most recent lines so it is always visible.
export function meetingActive(meeting: MeetingState | null | undefined): boolean {
  return Boolean(meeting && meeting.status !== 'off');
}

export function meetingSummary(meeting: MeetingState | null | undefined): string {
  if (!meeting || meeting.status === 'off') return meeting?.error || '';
  if (meeting.status === 'starting') return 'Starting meeting transcription…';
  const since = meeting.startedAt ? ` since ${new Date(meeting.startedAt).toTimeString().slice(0, 5)}` : '';
  return `Transcribing on this Mac${since} · ${meeting.lines} ${meeting.lines === 1 ? 'line' : 'lines'} kept${meeting.microphone ? '' : ' · meeting audio only'}`;
}

export function setupMeetingPanel({ api, $, onChange = () => {}, onError = () => {} }: SetupMeetingPanelOptions): MeetingPanelHandle {
  let meeting: MeetingState = { status: 'off', lines: 0, recent: [] };
  let pending = false;
  const panel = $('#meeting-panel') as HTMLElement;
  panel.innerHTML = '<div class="meeting-head"><span class="meeting-dot" aria-hidden="true"></span><span id="meeting-summary" role="status"></span></div><ol id="meeting-lines" aria-label="Recent meeting transcript"></ol><p class="meeting-note">Ask about the discussion in chat. Speakers are grouped as You and Others; recognition can be wrong. Nothing is saved, and the transcript clears when meeting mode ends.</p>';
  const render = (): void => {
    const active = meetingActive(meeting);
    panel.hidden = !active && !meeting.error;
    panel.classList.toggle('meeting-live', active);
    $('#meeting-summary')!.textContent = meetingSummary(meeting);
    const list = $('#meeting-lines') as HTMLOListElement;
    list.replaceChildren();
    list.hidden = !active;
    for (const line of meeting.recent || []) {
      const item = document.createElement('li');
      const who = document.createElement('b');
      who.textContent = line.source === 'me' ? 'You' : 'Others';
      item.append(who, document.createTextNode(` ${line.text}`));
      list.append(item);
    }
    for (const id of ['#meeting-toggle', '#floating-meeting']) {
      const button = $(id) as HTMLButtonElement | null;
      if (!button) continue;
      button.setAttribute('aria-pressed', String(active));
      button.disabled = pending || !api;
      button.title = active ? 'End meeting mode and clear the transcript' : 'Transcribe this meeting on your Mac so you can ask about it';
    }
    $('#meeting-toggle')!.textContent = active ? 'End meeting ■' : 'Meeting mode';
    $('#floating-meeting')?.classList.toggle('meeting-on', active);
    $('#floating-meeting')?.setAttribute('aria-label', active ? `End meeting mode · ${meetingSummary(meeting)}` : 'Meeting mode');
    onChange(meeting);
  };
  const toggle = async (): Promise<void> => {
    if (!api || pending) return;
    pending = true;
    render();
    try {
      meeting = (meetingActive(meeting) ? await api.meetingStop() : await api.meetingStart()) as MeetingState;
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      pending = false;
      render();
    }
  };
  for (const id of ['#meeting-toggle', '#floating-meeting']) {
    const button = $(id) as HTMLButtonElement | null;
    if (button) button.onclick = toggle;
  }
  return {
    update(value: MeetingState | null | undefined) {
      if (value) {
        meeting = value;
        render();
      }
    },
    get state() {
      return meeting;
    },
  };
}
