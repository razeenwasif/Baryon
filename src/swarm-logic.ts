// Pure UI logic for Fairy's Antigravity-style parallel agent swarm mode (src/swarm-pane.js), kept apart for testing.

export const AGENT_STATE_WORDS = Object.freeze({
  queued: 'Queued',
  copying: 'Cloning copy',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  stopped: 'Stopped',
  merged: 'Merged',
  discarded: 'Discarded',
} as const);

export const PROVIDER_WORDS = Object.freeze({
  auto: 'Auto',
  claude: 'Claude',
  gemini: 'Gemini',
  codex: 'Codex',
} as const);

export const KIND_WORDS = Object.freeze({
  write: 'Isolated copy',
  read: 'Read-only',
} as const);

export interface TeamworkCommandMatch {
  matched: boolean;
  brief: string;
}

// Parse /swarm <brief>, /teamwork <brief>, or /agents <brief> slash commands.
export function parseTeamworkCommand(text: unknown): TeamworkCommandMatch {
  const match = /^\/(?:swarm|teamwork|agents)(?:\s+([\s\S]+))?$/i.exec(String(text ?? '').trim());
  if (!match) return { matched: false, brief: '' };
  return { matched: true, brief: (match[1] || '').trim() };
}

export function elapsedWords(startedAt?: string | null, endedAt = '', now = Date.now()): string {
  if (!startedAt) return '';
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return '';
  const end = endedAt ? Date.parse(endedAt) : now;
  const secs = Math.max(0, Math.floor(((Number.isFinite(end) ? end : now) - start) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60), rem = secs % 60;
  return `${mins}m ${rem}s`;
}

export interface SwarmCounts {
  active?: number;
  queued?: number;
  done?: number;
  merged?: number;
  failed?: number;
  stopped?: number;
  unmerged?: number;
  total?: number;
}

export interface SwarmSummaryInput {
  counts?: SwarmCounts | null;
}

export function swarmSummaryLine(swarm?: SwarmSummaryInput | null): string {
  if (!swarm?.counts) return '';
  const c = swarm.counts;
  const parts: string[] = [];
  if (c.active) parts.push(`${c.active} running`);
  if (c.queued) parts.push(`${c.queued} queued`);
  if (c.done) parts.push(`${c.done} done`);
  if (c.merged) parts.push(`${c.merged} merged`);
  if (c.failed) parts.push(`${c.failed} failed`);
  if (c.stopped) parts.push(`${c.stopped} stopped`);
  if (c.unmerged) parts.push(`${c.unmerged} ready to merge`);
  return parts.join(' · ') || `${c.total || 0} agents`;
}

export function swarmWorkBarBadge(swarm?: SwarmSummaryInput | null): string {
  if (!swarm?.counts) return 'Swarm';
  if ((swarm.counts.active ?? 0) > 0) return `Swarm · ${swarm.counts.active} running`;
  if ((swarm.counts.unmerged ?? 0) > 0) return `Swarm · ${swarm.counts.unmerged} to merge`;
  return 'Swarm';
}

export function parseCommaList(text: unknown): string[] {
  return String(text ?? '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

export function parseDependsList(text: unknown): string[] {
  return [...new Set(parseCommaList(text).map(id => id.toUpperCase()).filter(id => /^A\d{1,3}$/.test(id)))];
}

export interface SwarmAgentSpec {
  id: string;
  role: string;
  kind: 'write' | 'read';
  provider: 'auto' | 'claude' | 'gemini' | 'codex';
  scope: string[];
  dependsOn: string[];
  task: string;
}

export function createBlankAgent(existing: readonly { id?: string }[] = []): SwarmAgentSpec {
  const used = new Set((Array.isArray(existing) ? existing : []).map(a => a?.id));
  let n = (existing?.length || 0) + 1;
  while (used.has(`A${n}`)) n += 1;
  return {
    id: `A${n}`,
    role: n === 1 ? 'Backend Engineer' : n === 2 ? 'Frontend Engineer' : n === 3 ? 'Test Author' : `Agent ${n}`,
    kind: 'write',
    provider: 'auto',
    scope: [],
    dependsOn: [],
    task: '',
  };
}
