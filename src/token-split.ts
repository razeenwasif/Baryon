// How a work turn's input splits by part (token-use plan, step 1), shared by the ledger and the work meter.
// The opening's parts are sent on every step of a turn, and tool results on the steps after them; `sent` is the
// ledger's estimate of everything sent across the turn, so what's left of it after the opening is tool results.
export const OPENING = ['instructions', 'guidance', 'memory', 'tools', 'earlier', 'message'] as const;
export const PARTS = [...OPENING, 'results', 'reply'] as const;
export const PART_NAMES: Record<string, string> = {
  instructions: 'instructions',
  guidance: 'project guidance',
  memory: 'memory rules',
  tools: 'tools',
  earlier: 'earlier turns',
  message: 'your message',
  results: 'tool results',
  reply: 'reply',
};

export interface TokenLedgerLine {
  steps?: number;
  sent?: number;
  parts?: Record<string, number | undefined>;
  byTool?: Record<string, { chars?: number } | undefined>;
}

export function sentByPart(line?: TokenLedgerLine | null): Record<string, number> {
  const steps = line?.steps || 1;
  const out: Record<string, number> = {};
  for (const part of OPENING) out[part] = (line?.parts?.[part] || 0) * steps;
  const opening = Object.values(out).reduce((a, b) => a + b, 0);
  out.results = Math.max(0, (line?.sent || 0) - opening);
  return out;
}

// The input's split as percentages, largest first, leaving out parts under 1%. lines: one ledger or several.
export function splitText(lines?: TokenLedgerLine | TokenLedgerLine[] | null): string {
  const list = Array.isArray(lines) ? lines : lines ? [lines] : [];
  const total: Record<string, number> = {};
  for (const line of list) {
    for (const [part, chars] of Object.entries(sentByPart(line))) {
      total[part] = (total[part] || 0) + chars;
    }
  }
  const sum = Object.values(total).reduce((a, b) => a + b, 0);
  if (!sum) return '';
  return Object.entries(total)
    .map(([part, chars]): [string, number] => [part, Math.round(chars / sum * 100)])
    .filter(([, share]) => share >= 1)
    .sort((a, b) => b[1] - a[1])
    .map(([part, share]) => `${PART_NAMES[part]} ${share}%`)
    .join(', ');
}

// The biggest tool results across the given ledgers, by characters returned: "read_file 61%, run_command 22%".
export function toolText(lines?: TokenLedgerLine | TokenLedgerLine[] | null, limit = 3): string {
  const list = Array.isArray(lines) ? lines : lines ? [lines] : [];
  const total: Record<string, number> = {};
  for (const line of list) {
    for (const [name, tool] of Object.entries(line?.byTool || {})) {
      total[name] = (total[name] || 0) + (tool?.chars || 0);
    }
  }
  const sum = Object.values(total).reduce((a, b) => a + b, 0);
  if (!sum) return '';
  return Object.entries(total)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, chars]) => `${name} ${Math.round(chars / sum * 100)}%`)
    .join(', ');
}
