// Doc 7, #6: Run trace side pane — timeline of a work turn's steps, tools, model seats, durations,
// tokens, handoff briefs/reports (builders, helpers, workers, critic), and routing.jsonl decisions.
import type { BaryonPreloadApi } from '../desktop/ipc-contract.js';

export interface TraceSeat {
  model?: string;
  role?: string;
}

export interface TraceModelInfo {
  role: string;
  model: string;
  effort?: string;
  standIn?: string;
}

export interface TraceHandoff {
  kind: string;
  attempt?: number;
  check?: string;
  passed?: boolean;
  brief?: string;
  report?: string;
}

export interface TraceTimelineStep {
  index: number;
  tool: string;
  summary: string;
  status: string;
  kind?: string;
  ms: number | null;
  offsetMs: number | null;
  seat?: TraceSeat;
  detail?: string;
  handoff?: TraceHandoff;
  output?: string;
}

export interface TraceToolBreakdown {
  calls: number;
  ms?: number;
  chars?: number;
  failed?: number;
}

export interface TraceRoutingEvent {
  at?: string;
  role?: string;
  type?: string;
  provider?: string;
  model?: string;
  outcome?: string;
  passed?: boolean;
  ms?: number;
  standIn?: string;
  why?: string;
}

export interface RunTraceEntry {
  id: string;
  at?: string;
  replyAt?: string;
  request?: string;
  outcome: string;
  ms?: number;
  seat?: TraceSeat;
  auto?: { why?: string };
  verdict?: { status: string; line?: string };
  tokens?: { input: number; output: number; cached?: number };
  ledger?: { sent?: number; steps?: number };
  models?: TraceModelInfo[];
  stepCount: number;
  handoffCount: number;
  failedCount: number;
  timeline: TraceTimelineStep[];
  byTool?: Record<string, TraceToolBreakdown>;
  routing?: TraceRoutingEvent[];
}

export interface RunTraceResponse {
  traces?: RunTraceEntry[];
}

export interface TracePaneContext {
  view?: unknown;
  setView(view: string): void;
  redraw(): void;
}

export interface TracePaneOptions {
  api?: Pick<BaryonPreloadApi, 'runTrace'> | null;
  currentSession?: () => string | null | undefined;
  onError?: (message: string) => void;
}

export interface TracePaneController {
  id: string;
  title: string;
  wide(): boolean;
  reset(): void;
  render(body: HTMLElement, context: TracePaneContext): Promise<void>;
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text: string | undefined = undefined,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export function formatTraceDuration(ms: number | string | null | undefined): string {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 1000) return `${Math.round(n)} ms`;
  if (n < 60000) return `${(n / 1000).toFixed(1)} s`;
  return `${Math.floor(n / 60000)}m ${Math.round((n % 60000) / 1000)}s`;
}

function formatTokens(trace: RunTraceEntry): string {
  const parts: string[] = [];
  if (trace.tokens) {
    const t = trace.tokens;
    parts.push(`${t.input.toLocaleString()} in · ${t.output.toLocaleString()} out${t.cached ? ` (${t.cached.toLocaleString()} cached)` : ''}`);
  }
  if (trace.ledger?.sent) {
    parts.push(`~${Math.round(trace.ledger.sent / 4).toLocaleString()} est. tok (${trace.ledger.steps || 1} steps)`);
  }
  return parts.join(' · ') || 'No token counts';
}

function formatClock(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function markdownSummary(trace: RunTraceEntry): string {
  const lines = [
    `# Run trace (${trace.at || trace.replyAt || 'turn'})`,
    `- Request: ${trace.request || '(none)'}`,
    `- Outcome: ${trace.outcome} · Duration: ${formatTraceDuration(trace.ms)}`,
  ];
  if (trace.seat?.model) lines.push(`- Model: ${trace.seat.model} (${trace.seat.role || 'turn'})`);
  if (trace.auto?.why) lines.push(`- Routing: ${trace.auto.why}`);
  if (trace.verdict?.line) lines.push(`- Verdict: ${trace.verdict.line}`);
  if (trace.tokens) lines.push(`- Tokens: ${trace.tokens.input.toLocaleString()} in / ${trace.tokens.output.toLocaleString()} out`);
  if (trace.timeline?.length) {
    lines.push('', '## Steps');
    for (const s of trace.timeline) {
      const dur = s.ms !== null ? ` (${formatTraceDuration(s.ms)})` : '';
      const seat = s.seat?.model ? ` [${s.seat.role || 'helper'}: ${s.seat.model}]` : '';
      lines.push(`${s.index}. ${s.tool}: ${s.summary} — ${s.status}${dur}${seat}`);
      if (s.handoff?.brief) lines.push(`   Brief: ${s.handoff.brief.replace(/\s+/g, ' ').slice(0, 300)}`);
      if (s.handoff?.report) lines.push(`   Report: ${s.handoff.report.replace(/\s+/g, ' ').slice(0, 300)}`);
    }
  }
  return lines.join('\n');
}

export function tracePane({ api, currentSession, onError = () => {} }: TracePaneOptions): TracePaneController {
  let selectedId = '';
  let cached: RunTraceResponse | null = null;
  let showOnlyHandoffs = false;

  const pane: TracePaneController = {
    id: 'trace',
    title: 'Run trace',
    wide: () => true,
    reset() {
      selectedId = '';
      cached = null;
      showOnlyHandoffs = false;
    },
    async render(body, context) {
      const sessionId = currentSession?.() || '';
      if (!api?.runTrace) {
        body.replaceChildren(el('p', 'pane-empty', 'Run trace isn’t available here.'));
        return;
      }
      if (typeof context.view === 'string' && context.view) selectedId = context.view;
      let data: RunTraceResponse | null | undefined;
      try {
        data = (await api.runTrace(sessionId)) as RunTraceResponse | null | undefined;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        onError(msg);
        body.replaceChildren(el('p', 'pane-empty', `Couldn’t load run trace: ${msg}`));
        return;
      }
      cached = data ?? null;
      void cached;
      const traces = Array.isArray(data?.traces) ? data.traces : [];
      if (!traces.length) {
        body.replaceChildren(el('p', 'pane-empty', 'No work turns recorded in this chat yet. Every work turn leaves a trace of its steps, models, timings, tokens, and handoffs here.'));
        return;
      }

      const active = traces.find(t => t.id === selectedId || t.replyAt === selectedId || t.at === selectedId) || traces[0];
      selectedId = active.id;

      const wrap = el('div', 'trace-pane');

      // Header with turn selector, refresh & copy buttons
      const head = el('div', 'trace-head');
      const titleGroup = el('div', 'trace-title-group');
      titleGroup.append(el('strong', '', 'Run trace'));
      if (traces.length > 1) {
        const select = document.createElement('select');
        select.className = 'trace-select';
        select.setAttribute('aria-label', 'Select work turn');
        for (const [idx, t] of traces.entries()) {
          const opt = document.createElement('option');
          opt.value = t.id;
          const time = formatClock(t.at || t.replyAt);
          const snippet = (t.request || 'Work turn').slice(0, 44);
          opt.textContent = `#${traces.length - idx}${time ? ` · ${time}` : ''} — ${snippet}${(t.request?.length ?? 0) > 44 ? '…' : ''}`;
          opt.selected = t.id === active.id;
          select.append(opt);
        }
        select.onchange = () => {
          selectedId = select.value;
          context.setView(selectedId);
        };
        titleGroup.append(select);
      }
      const actions = el('div', 'trace-actions');
      const copyBtn = el('button', 'page-link', 'Copy');
      copyBtn.type = 'button';
      copyBtn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(markdownSummary(active));
          copyBtn.textContent = 'Copied';
          setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1400);
        } catch (err) {
          onError(err instanceof Error ? err.message : String(err));
        }
      };
      const refreshBtn = el('button', 'page-link', 'Refresh');
      refreshBtn.type = 'button';
      refreshBtn.onclick = () => context.redraw();
      actions.append(copyBtn, refreshBtn);
      head.append(titleGroup, actions);
      wrap.append(head);

      // Summary card
      const summary = el('div', 'trace-summary');
      if (active.request) summary.append(el('div', 'trace-request', active.request));

      const stats = el('div', 'trace-stats');
      const outcomePill = el('span', `trace-pill trace-pill--${active.outcome === 'done' ? 'ok' : active.outcome === 'stopped' ? 'warn' : 'bad'}`, active.outcome);
      stats.append(outcomePill);
      if (active.verdict?.line) {
        stats.append(el('span', `trace-pill trace-pill--verdict-${active.verdict.status}`, active.verdict.line));
      }
      stats.append(el('span', 'trace-stat', formatTraceDuration(active.ms)));
      stats.append(el('span', 'trace-stat', `${active.stepCount} ${active.stepCount === 1 ? 'step' : 'steps'}${active.handoffCount ? ` · ${active.handoffCount} handoff${active.handoffCount === 1 ? '' : 's'}` : ''}${active.failedCount ? ` · ${active.failedCount} failed` : ''}`));
      summary.append(stats);

      summary.append(el('div', 'trace-meta-line', formatTokens(active)));
      if (active.auto?.why) {
        summary.append(el('div', 'trace-routing-why', `Routing: ${active.auto.why}`));
      }

      if (active.models?.length) {
        const modelsRow = el('div', 'trace-models');
        for (const m of active.models) {
          const chip = el('span', 'trace-model-chip', `${m.role}: ${m.model}${m.effort ? ` (${m.effort})` : ''}${m.standIn ? ` · stand-in` : ''}`);
          if (m.standIn) chip.title = `Stand-in reason: ${m.standIn}`;
          modelsRow.append(chip);
        }
        summary.append(modelsRow);
      }
      wrap.append(summary);

      // Filter toolbar for steps
      if (active.handoffCount > 0) {
        const filters = el('div', 'trace-filters');
        const allBtn = el('button', `trace-filter${!showOnlyHandoffs ? ' active' : ''}`, `All steps (${active.stepCount})`);
        const handBtn = el('button', `trace-filter${showOnlyHandoffs ? ' active' : ''}`, `Handoffs only (${active.handoffCount})`);
        allBtn.type = 'button';
        handBtn.type = 'button';
        allBtn.onclick = () => {
          showOnlyHandoffs = false;
          context.redraw();
        };
        handBtn.onclick = () => {
          showOnlyHandoffs = true;
          context.redraw();
        };
        filters.append(allBtn, handBtn);
        wrap.append(filters);
      }

      // Timeline waterfall
      const list = el('ol', 'trace-timeline');
      const timeline = active.timeline || [];
      const shownSteps = showOnlyHandoffs ? timeline.filter(s => s.kind === 'handoff') : timeline;
      const maxSpan = Math.max(active.ms || 0, ...timeline.map(s => (s.offsetMs || 0) + (s.ms || 0)), 1);

      for (const step of shownSteps) {
        const li = el('li', `trace-step trace-step--${step.status === 'failed' ? 'failed' : step.kind === 'handoff' ? 'handoff' : 'ok'}`);
        const top = el('div', 'trace-step-top');
        const left = el('div', 'trace-step-left');
        left.append(el('span', 'trace-step-idx', `#${step.index}`));
        left.append(el('span', `trace-tool-tag${step.kind === 'handoff' ? ' trace-tool-tag--handoff' : ''}`, step.tool));
        left.append(el('span', 'trace-step-summary', step.summary || step.tool));
        const right = el('div', 'trace-step-right');
        if (step.seat?.model) {
          right.append(el('span', 'trace-seat-badge', `${step.seat.role || 'helper'} · ${step.seat.model}`));
        }
        if (step.detail) right.append(el('span', 'trace-step-detail', step.detail));
        if (step.ms !== null) right.append(el('span', 'trace-step-ms', formatTraceDuration(step.ms)));
        top.append(left, right);
        li.append(top);

        // Timeline bar when duration is known
        if (step.ms !== null && maxSpan > 0) {
          const track = el('div', 'trace-bar-track');
          const bar = el('div', `trace-bar trace-bar--${step.status === 'failed' ? 'failed' : step.kind === 'handoff' ? 'handoff' : 'ok'}`);
          const leftPct = step.offsetMs !== null ? Math.min(96, (step.offsetMs / maxSpan) * 100) : 0;
          const widthPct = Math.max(2, Math.min(100 - leftPct, (step.ms / maxSpan) * 100));
          bar.style.marginLeft = `${leftPct.toFixed(1)}%`;
          bar.style.width = `${widthPct.toFixed(1)}%`;
          track.append(bar);
          li.append(track);
        }

        // Handoff brief & report
        if (step.handoff) {
          const det = document.createElement('details');
          det.className = 'trace-handoff';
          det.open = step.status === 'failed' || shownSteps.length <= 6;
          const sum = document.createElement('summary');
          sum.textContent = `${step.handoff.kind} handoff${step.handoff.attempt ? ` · attempt ${step.handoff.attempt}` : ''}${step.handoff.check ? ` · check: ${step.handoff.passed === true ? 'passed' : step.handoff.passed === false ? 'failed' : step.handoff.check}` : ''}`;
          det.append(sum);
          if (step.handoff.brief) {
            const b = el('div', 'trace-handoff-block');
            b.append(el('span', 'trace-handoff-label', 'Brief sent'));
            b.append(el('pre', 'trace-pre', step.handoff.brief));
            det.append(b);
          }
          if (step.handoff.report) {
            const r = el('div', 'trace-handoff-block');
            r.append(el('span', 'trace-handoff-label', 'Report returned'));
            r.append(el('pre', 'trace-pre', step.handoff.report));
            det.append(r);
          }
          li.append(det);
        } else if (step.output && step.status === 'failed') {
          const det = document.createElement('details');
          det.className = 'trace-handoff';
          const sum = document.createElement('summary');
          sum.textContent = 'Failure output';
          det.append(sum, el('pre', 'trace-pre', step.output));
          li.append(det);
        }

        list.append(li);
      }
      wrap.append(list);

      // Routing events & per-tool breakdown
      const toolEntries = Object.entries(active.byTool || {}).sort((a, b) => (b[1].ms || b[1].chars || 0) - (a[1].ms || a[1].chars || 0));
      if (toolEntries.length) {
        const det = document.createElement('details');
        det.className = 'trace-section';
        const sum = document.createElement('summary');
        sum.textContent = `Tool breakdown (${toolEntries.length} tools)`;
        det.append(sum);
        const tbl = el('table', 'trace-table');
        const tbody = document.createElement('tbody');
        for (const [name, info] of toolEntries) {
          const tr = document.createElement('tr');
          tr.append(
            el('td', 'trace-mono', name),
            el('td', '', `${info.calls}×`),
            el('td', '', info.ms ? formatTraceDuration(info.ms) : '—'),
            el('td', '', info.chars ? `${info.chars.toLocaleString()} ch` : '—'),
            el('td', info.failed ? 'trace-bad' : '', info.failed ? `${info.failed} err` : ''),
          );
          tbody.append(tr);
        }
        tbl.append(tbody);
        det.append(tbl);
        wrap.append(det);
      }

      if (active.routing?.length) {
        const det = document.createElement('details');
        det.className = 'trace-section';
        const sum = document.createElement('summary');
        sum.textContent = `Routing log (${active.routing.length} ${active.routing.length === 1 ? 'event' : 'events'})`;
        det.append(sum);
        const ul = el('ul', 'trace-routing-list');
        for (const ev of active.routing) {
          const bits = [
            formatClock(ev.at),
            ev.role || ev.type,
            ev.model ? `${ev.provider ? `${ev.provider}/` : ''}${ev.model}` : '',
            ev.outcome || (ev.passed === true ? 'check passed' : ev.passed === false ? 'check failed' : ''),
            ev.ms ? formatTraceDuration(ev.ms) : '',
            ev.standIn ? `stand-in: ${ev.standIn}` : '',
            ev.why || '',
          ].filter(Boolean);
          ul.append(el('li', '', bits.join(' · ')));
        }
        det.append(ul);
        wrap.append(det);
      }

      body.replaceChildren(wrap);
    },
  };
  return pane;
}
