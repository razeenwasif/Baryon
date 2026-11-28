import './panels.css';

export type Unsubscribe = () => void;

export type ApprovalDecision = 'allow' | 'deny';

export interface ApprovalRequest {
  id: string;
  title: string;
  detail?: string;
  provider?: string;
  model?: string;
  denyLabel?: string;
  allowLabel?: string;
}

export interface ApprovalLogEntry {
  at: number | string;
  event: string;
  via?: string;
  title?: string;
  kind?: string;
  detail?: string;
}

export interface ApprovalApi {
  onApprovals?: (callback: (list: ApprovalRequest[]) => void) => Unsubscribe;
  approvalsPending?: () => Promise<ApprovalRequest[]>;
  approvalAnswer: (id: string, decision: ApprovalDecision) => Promise<unknown>;
  approvalsRecent: (limit?: number) => Promise<ApprovalLogEntry[]>;
}

export interface ApprovalTrayOptions {
  api?: ApprovalApi | null;
  onError?: (message: string) => void;
}

export interface ApprovalTrayController {
  draw: (list?: ApprovalRequest[]) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// A chat's own requests, such as a Calendar event or a Drive file, waiting for your OK: one card each, above the
// message box, in the same place whichever kind it is. A work session's requests stay in its chat, where its steps are.
// The phone and the companion can answer the same requests, and whoever answers first closes the card everywhere.
export function approvalTray({ api, onError = () => {} }: ApprovalTrayOptions): ApprovalTrayController {
  const tray = document.createElement('div');
  tray.className = 'approval-tray';
  tray.setAttribute('aria-live', 'polite');
  document.body.append(tray);
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string | null): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  function card(request: ApprovalRequest): HTMLDivElement {
    const box = el('div', 'approval-card');
    box.dataset.id = request.id;
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', request.title);
    box.append(el('h4', '', request.title));
    if (request.detail) box.append(el('pre', 'approval-detail', request.detail));
    const by = [request.provider, request.model].filter(Boolean).join(' · ');
    if (by) box.append(el('p', 'approval-by', `Asked by ${by}`));
    const buttons = el('div', 'approval-buttons');
    const answer = (decision: ApprovalDecision) => async () => {
      for (const button of buttons.children) (button as HTMLButtonElement).disabled = true;
      try { await api!.approvalAnswer(request.id, decision); } catch (error) { onError(errorMessage(error)); }
    };
    // The safe answer comes first; the other waits a moment, so a stray click as the card appears can't allow it.
    const no = el('button', 'panel-button quiet', request.denyLabel || 'Don’t allow');
    const yes = el('button', 'panel-button primary', request.allowLabel || 'Allow');
    no.type = yes.type = 'button';
    no.onclick = answer('deny');
    yes.onclick = answer('allow');
    yes.disabled = true;
    setTimeout(() => { yes.disabled = false; }, 800);
    buttons.append(no, yes);
    box.append(buttons);
    return box;
  }
  function draw(list: ApprovalRequest[] = []) {
    const keep = new Set(list.map(request => request.id));
    for (const node of [...tray.children]) {
      const id = (node as HTMLElement).dataset.id;
      if (id === undefined || !keep.has(id)) node.remove();
    }
    for (const request of list) {
      if (!tray.querySelector(`[data-id="${CSS.escape(request.id)}"]`)) tray.append(card(request));
    }
    tray.hidden = !list.length;
  }
  tray.hidden = true;
  api?.onApprovals?.(draw);
  api?.approvalsPending?.().then(draw, () => {});
  return { draw };
}

// The approvals log, most recent first, for Settings.
export async function drawApprovalLog(holder: HTMLElement, api: Pick<ApprovalApi, 'approvalsRecent'>, limit = 40): Promise<void> {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string | null): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  holder.replaceChildren(el('p', 'field-note', 'Reading the log…'));
  let entries: ApprovalLogEntry[];
  try { entries = await api.approvalsRecent(limit); } catch (error) { holder.replaceChildren(el('p', 'field-note', errorMessage(error))); return; }
  if (!entries.length) { holder.replaceChildren(el('p', 'field-note', 'Nothing has asked for your OK yet.')); return; }
  const SAID: Record<string, string> = {
    asked: 'Asked',
    allowed: 'Allowed',
    denied: 'Not allowed',
    'timed-out': 'No answer, so not allowed',
    stopped: 'Stopped',
    done: 'Done',
    failed: 'Failed',
    cancelled: 'Cancelled',
    'allowed-always': 'Allowed for this chat',
    'allowed-auto': 'Allowed to run on its own',
  };
  const VIA: Record<string, string> = { window: 'in the window', phone: 'on your phone', companion: 'in the companion' };
  const list = el('ol', 'approval-log');
  for (const entry of entries) {
    const row = el('li', `approval-entry ${entry.event}`);
    const when = new Date(entry.at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    row.append(
      el('span', 'approval-when', when),
      el('span', 'approval-what', entry.title || entry.kind),
      el('span', 'approval-event', `${SAID[entry.event] || entry.event}${entry.via ? ` ${VIA[entry.via] || entry.via}` : ''}`),
    );
    if (entry.detail) row.title = entry.detail;
    list.append(row);
  }
  holder.replaceChildren(list);
}
