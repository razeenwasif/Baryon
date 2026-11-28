export interface ProviderDescriptor {
  key: string;
  family: string;
  name: string;
}

export interface HandoffSeat {
  provider?: string;
  model?: string;
}

export interface HandoffParty {
  provider: string;
  family: string;
  model: string;
  label: string;
}

export interface ProviderHandoff {
  from: HandoffParty;
  to: HandoffParty;
}

export interface HandoffActivityRow {
  tool?: string;
  status?: string;
  summary?: unknown;
}

export interface HandoffHistoryEntry {
  role?: string;
  content?: unknown;
  from?: unknown;
  seat?: HandoffSeat;
  auto?: HandoffSeat;
  activity?: HandoffActivityRow[];
  verdict?: { line?: unknown };
  tasks?: Array<{ status?: unknown; text?: unknown }>;
  [key: string]: unknown;
}

const PROVIDER_MAP: Readonly<Record<string, ProviderDescriptor>> = Object.freeze({
  claude: { key: 'claude', family: 'anthropic', name: 'Claude' },
  anthropic: { key: 'claude', family: 'anthropic', name: 'Claude' },
  codex: { key: 'codex', family: 'openai', name: 'OpenAI' },
  openai: { key: 'codex', family: 'openai', name: 'OpenAI' },
  antigravity: { key: 'gemini', family: 'google', name: 'Gemini' },
  gemini: { key: 'gemini', family: 'google', name: 'Gemini' },
  google: { key: 'gemini', family: 'google', name: 'Gemini' },
  deepseek: { key: 'deepseek', family: 'deepseek', name: 'DeepSeek' },
});

const EFFORT_SUFFIX = /-(low|medium|high|xhigh)$/i;

/**
 * Normalize internal provider/backend identifiers into a canonical provider descriptor.
 */
export function normalizeProvider(provider?: string): ProviderDescriptor {
  const raw = String(provider || '').trim().toLowerCase();
  if (Object.hasOwn(PROVIDER_MAP, raw)) return PROVIDER_MAP[raw];
  return { key: raw || 'unknown', family: raw || 'unknown', name: raw ? raw[0].toUpperCase() + raw.slice(1) : 'Assistant' };
}

/**
 * Format a model identifier into a readable label while preserving provider family cues.
 */
export function formatModelLabel(modelId?: string, provider = ''): string {
  const info = normalizeProvider(provider);
  const cleaned = String(modelId || '').trim().replace(EFFORT_SUFFIX, '');
  if (!cleaned) return info.name;

  if (/^gpt-/i.test(cleaned)) {
    const rest = cleaned.slice(4).split('-').filter(Boolean).map(tok =>
      /^[a-z]/i.test(tok) ? tok[0].toUpperCase() + tok.slice(1) : tok
    );
    return `GPT-${rest.join('-')}`;
  }

  if (/^claude-/i.test(cleaned)) {
    const parts = cleaned.replace(/^claude-/i, '').replace(/(\d+)-(\d+)$/, '$1.$2').split('-').filter(Boolean);
    const title = parts.map(tok => (/^[a-z]/i.test(tok) ? tok[0].toUpperCase() + tok.slice(1) : tok)).join(' ');
    return `Claude ${title}`.trim();
  }

  if (/^gemini-/i.test(cleaned)) {
    const parts = cleaned.replace(/^gemini-/i, '').split('-').filter(Boolean);
    const title = parts.map(tok => (/^[a-z]/i.test(tok) ? tok[0].toUpperCase() + tok.slice(1) : tok)).join(' ');
    return `Gemini ${title}`.trim();
  }

  if (/^deepseek-/i.test(cleaned)) {
    const parts = cleaned.replace(/^deepseek-/i, '').split('-').filter(Boolean);
    const title = parts.map(tok => (/^[a-z]/i.test(tok) ? tok[0].toUpperCase() + tok.slice(1) : tok)).join(' ');
    return `DeepSeek ${title}`.trim();
  }

  return cleaned
    .split('-')
    .filter(Boolean)
    .map(tok => (/^gpt$/i.test(tok) ? 'GPT' : /^[a-z]/i.test(tok) ? tok[0].toUpperCase() + tok.slice(1) : tok))
    .join(' ');
}

function seatFromEntry(entry: HandoffHistoryEntry | null | undefined): { provider: string; model: string } | null {
  if (!entry || entry.role !== 'assistant') return null;
  if (entry.seat?.provider) {
    return { provider: entry.seat.provider, model: entry.seat.model || '' };
  }
  if (entry.auto?.provider) {
    return { provider: entry.auto.provider, model: entry.auto.model || '' };
  }
  return null;
}

/**
 * Detect when the next model seat switches across provider families compared to the previous assistant turn.
 */
export function detectProviderHandoff(history: HandoffHistoryEntry[] = [], nextSeat: HandoffSeat | null = null): ProviderHandoff | null {
  if (!Array.isArray(history) || !history.length || !nextSeat?.provider) return null;
  let prevSeat: { provider: string; model: string } | null = null;
  for (let i = history.length - 1; i >= 0; i--) {
    const candidate = seatFromEntry(history[i]);
    if (candidate) {
      prevSeat = candidate;
      break;
    }
  }
  if (!prevSeat) return null;

  const fromInfo = normalizeProvider(prevSeat.provider);
  const toInfo = normalizeProvider(nextSeat.provider);
  if (fromInfo.family === toInfo.family) return null;

  return {
    from: {
      provider: fromInfo.key,
      family: fromInfo.family,
      model: String(prevSeat.model || ''),
      label: formatModelLabel(prevSeat.model, prevSeat.provider),
    },
    to: {
      provider: toInfo.key,
      family: toInfo.family,
      model: String(nextSeat.model || ''),
      label: formatModelLabel(nextSeat.model, nextSeat.provider),
    },
  };
}

/**
 * Build a concise cross-provider handoff context brief from recent conversation history and work state.
 */
export function buildHandoffContext({
  history = [],
  from,
  to,
  isWork = false,
  summary = null,
  maxChars = 6000,
}: {
  history?: HandoffHistoryEntry[];
  from?: Partial<HandoffParty> | null;
  to?: Partial<HandoffParty> | null;
  isWork?: boolean;
  summary?: { text?: unknown } | null;
  maxChars?: number;
} = {}): string {
  if (!from?.label || !to?.label) return '';
  const sections = [
    `[Context handoff: ${from.label} -> ${to.label}]`,
    `You are taking over this conversation seamlessly from ${from.label}. Continue directly from the prior context without repeating completed steps or asking the user to restate earlier details. Keep the same voice and conciseness; do not introduce yourself, announce the handoff, or re-summarize earlier turns back to the user.`,
  ];

  if (typeof summary?.text === 'string' && summary.text.trim()) {
    sections.push(`Earlier compacted summary:\n${summary.text.trim().slice(0, 1400)}`);
  }

  const relevant = (Array.isArray(history) ? history : [])
    .filter(entry => entry && (entry.role === 'user' || entry.role === 'assistant') && !entry.from)
    .slice(-8);

  if (relevant.length) {
    const lines = relevant.map(entry => {
      const text = String(entry.content || '').replace(/\s+/g, ' ').trim();
      const snippet = text.length > 520 ? `${text.slice(0, 517)}…` : text;
      if (entry.role === 'user') return `User: ${snippet}`;
      const priorSeat = seatFromEntry(entry);
      const tag = priorSeat ? formatModelLabel(priorSeat.model, priorSeat.provider) : from.label;
      return `${tag}: ${snippet}`;
    }).filter(Boolean);
    if (lines.length) sections.push(`Recent exchanges:\n${lines.join('\n')}`);
  }

  if (isWork) {
    const changed = new Set<string>();
    let latestVerdict = '';
    let openTasks: string[] = [];
    for (const entry of history || []) {
      if (entry?.role !== 'assistant') continue;
      for (const row of entry.activity || []) {
        if (row && ['write', 'edit'].includes(row.tool ?? '') && row.status === 'done' && row.summary) {
          changed.add(String(row.summary));
        }
      }
      if (entry.verdict?.line) latestVerdict = String(entry.verdict.line);
      if (Array.isArray(entry.tasks)) {
        openTasks = entry.tasks.filter(task => task && task.status !== 'done').map(task => String(task.text || '')).filter(Boolean);
      }
    }
    const workState: string[] = [];
    if (changed.size) workState.push(`Files changed recently: ${[...changed].slice(-12).join(', ')}`);
    if (latestVerdict) workState.push(`Latest check verdict: ${latestVerdict}`);
    if (openTasks.length) workState.push(`Remaining tasks: ${openTasks.slice(0, 8).join('; ')}`);
    if (workState.length) sections.push(`Work state:\n${workState.join('\n')}`);
  }

  const out = sections.join('\n\n');
  return out.length > maxChars ? `${out.slice(0, maxChars - 1)}…` : out;
}
