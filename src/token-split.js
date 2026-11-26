// How a work turn's input splits by part (token-use plan, step 1), shared by the ledger and the work meter.
// The opening's parts are sent on every step of a turn, and tool results on the steps after them; `sent` is the
// ledger's estimate of everything sent across the turn, so what's left of it after the opening is tool results.
export const OPENING = ['instructions', 'guidance', 'memory', 'tools', 'earlier', 'message'];
export const PARTS = [...OPENING, 'results', 'reply'];
export const PART_NAMES = { instructions: 'instructions', guidance: 'project guidance', memory: 'memory rules', tools: 'tools', earlier: 'earlier turns', message: 'your message', results: 'tool results', reply: 'reply' };

export function sentByPart(line) {
  const steps = line?.steps || 1, out = {};
  for (const part of OPENING) out[part] = (line?.parts?.[part] || 0) * steps;
  const opening = Object.values(out).reduce((a, b) => a + b, 0);
  out.results = Math.max(0, (line?.sent || 0) - opening);
  return out;
}

// The input's split as percentages, largest first, leaving out parts under 1%. lines: one ledger or several.
export function splitText(lines) {
  const total = {};
  for (const line of [].concat(lines || [])) for (const [part, chars] of Object.entries(sentByPart(line))) total[part] = (total[part] || 0) + chars;
  const sum = Object.values(total).reduce((a, b) => a + b, 0);
  if (!sum) return '';
  return Object.entries(total).map(([part, chars]) => [part, Math.round(chars / sum * 100)]).filter(([, share]) => share >= 1)
    .sort((a, b) => b[1] - a[1]).map(([part, share]) => `${PART_NAMES[part]} ${share}%`).join(', ');
}

// The biggest tool results across the given ledgers, by characters returned: "read_file 61%, run_command 22%".
export function toolText(lines, limit = 3) {
  const total = {};
  for (const line of [].concat(lines || [])) for (const [name, tool] of Object.entries(line?.byTool || {})) total[name] = (total[name] || 0) + (tool.chars || 0);
  const sum = Object.values(total).reduce((a, b) => a + b, 0);
  if (!sum) return '';
  return Object.entries(total).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([name, chars]) => `${name} ${Math.round(chars / sum * 100)}%`).join(', ');
}
