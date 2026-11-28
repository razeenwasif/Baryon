// What the goals board shows (src/goals-view.js), kept apart so it can be tested without a window.

export interface GoalBoardItem {
  state: string;
  updated?: string | number;
}

export interface GoalBoardColumn<T extends GoalBoardItem = GoalBoardItem> {
  title: string;
  goals: T[];
  empty: string;
}

export interface DoneWhenSpec {
  kind?: string;
  command?: string;
  metric?: string;
  op?: string;
  value?: number | string;
}

export interface PaperIdentity {
  id?: string;
  version?: string;
}

export interface ClaimValueSpec {
  value?: number | null;
  uncertainty?: number | null;
  unit?: string;
}

export interface ToleranceSpec {
  kind?: string;
  value?: number | null;
}

export interface ComputeBudgetHours {
  forge?: number | null;
  atlas?: number | null;
  sandbox?: number | null;
}

export interface PlanHoursSummary {
  forge: number;
  atlas: number;
  sandbox: number;
  forgeBudget: number;
  atlasBudget: number;
  forgeOver: boolean;
  atlasOver: boolean;
  anyOver: boolean;
  line: string;
}

export interface SpentHoursSummary {
  forgeSpent: number;
  atlasSpent: number;
  forgeBudget: number;
  atlasBudget: number;
  forgeReached: boolean;
  atlasReached: boolean;
  anyReached: boolean;
  line: string;
}

export interface ComparisonSummaryInput {
  counts?: {
    total?: number;
    reproduced: number;
    accepted: number;
    notReproduced: number;
    scaledOnly: number;
  };
  rows?: Array<{
    verdict?: string;
    accepted?: boolean;
  }>;
}

// The board's three columns: what's moving, what's held, and what's finished.
export function boardColumns<T extends GoalBoardItem>(goals: readonly T[] = []): GoalBoardColumn<T>[] {
  const by = (states: readonly string[]): T[] =>
    goals.filter(goal => states.includes(goal.state)).sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  return [
    { title: 'Active', goals: by(['active']), empty: 'Nothing active.' },
    { title: 'Waiting or paused', goals: by(['waiting-you', 'waiting', 'paused']), empty: 'Nothing held.' },
    { title: 'Done', goals: by(['done', 'dropped']), empty: 'Nothing finished yet.' },
  ];
}

// A done-when in words: “npm test passes”, “a run’s accuracy is at least 0.9”, “every picked claim …”, “you say so”.
export function doneWhenWords(when: DoneWhenSpec = {}): string {
  if (when.kind === 'command') return `${when.command} passes`;
  if (when.kind === 'metric') return `a run’s ${when.metric} is ${when.op === '<=' ? 'at most' : 'at least'} ${when.value}`;
  if (when.kind === 'claims') return 'every picked claim has a finished full-scale run within its tolerance';
  return 'you say so';
}

export const folderName = (path?: string | null): string => String(path || '').split('/').filter(Boolean).at(-1) || String(path || '');
export const historyNewestFirst = <T>(history?: readonly T[] | null): T[] => [...(history || [])].reverse();

// Reproduce a paper (stage 1): display helpers and /reproduce slash-command parser.
export function paperLabel(paper?: PaperIdentity | null): string {
  if (!paper?.id) return '';
  return `arXiv:${paper.id}${paper.version || ''}`;
}

export function paperAuthors(authors: readonly (string | null | undefined)[] = [], max = 5): string {
  const list = Array.isArray(authors) ? authors.filter(Boolean) : [];
  if (!list.length) return '';
  if (list.length <= max) return list.join(', ');
  return `${list.slice(0, max).join(', ')}, et al. (${list.length} authors)`;
}

export const sourceKindWords = (kind?: string): string => (kind === 'pdf' ? 'PDF text' : 'LaTeX source');

export function parseReproduceCommand(text?: string | null): { matched: boolean; paper: string } {
  const match = /^\/reproduce(?:\s+([\s\S]+))?$/i.exec(String(text ?? '').trim());
  if (!match) return { matched: false, paper: '' };
  return { matched: true, paper: (match[1] || '').trim() };
}

// Reproduce a paper (stage 2): claim display, tolerance input conversion, and budget formatting.
export function claimValueWords(claim: ClaimValueSpec = {}): string {
  const val = typeof claim.value === 'number' && Number.isFinite(claim.value) ? String(claim.value) : '';
  const pm = typeof claim.uncertainty === 'number' && Number.isFinite(claim.uncertainty) && claim.uncertainty > 0 ? ` ± ${claim.uncertainty}` : '';
  const unit = claim.unit === '%' ? '%' : claim.unit ? ` ${claim.unit}` : '';
  return `${val}${pm}${unit}`.trim();
}

export function directionWords(direction?: string): string {
  if (direction === 'lower') return '↓ lower is better';
  if (direction === 'match') return '≈ match value';
  return '↑ higher is better';
}

export function toleranceWords(tol: ToleranceSpec | null = {}, unit = ''): string {
  if (!tol || typeof tol.value !== 'number' || !Number.isFinite(tol.value)) return '';
  if (tol.kind === 'rel') {
    const pct = Number((tol.value * 100).toFixed(4));
    return `±${pct}% rel`;
  }
  return unit === '%' ? `±${tol.value} pt` : `±${tol.value}`;
}

export function toleranceToInput(tol: ToleranceSpec | null = {}): { kind: 'abs' | 'rel'; value: number } {
  const kind = tol?.kind === 'abs' ? 'abs' : 'rel';
  const raw = Number(tol?.value);
  const value = Number.isFinite(raw) ? (kind === 'rel' ? Number((raw * 100).toFixed(4)) : raw) : (kind === 'rel' ? 5 : 1);
  return { kind, value };
}

export function toleranceFromInput(kind: string, inputValue: unknown): { kind: 'abs' | 'rel'; value: number } {
  const num = Number(inputValue);
  if (kind === 'abs') return { kind: 'abs', value: num };
  return { kind: 'rel', value: Number((num / 100).toFixed(8)) };
}

export function formatBudgetHours(hours?: ComputeBudgetHours | null): string {
  const forge = typeof hours?.forge === 'number' && Number.isFinite(hours.forge) ? hours.forge : 8;
  const atlas = typeof hours?.atlas === 'number' && Number.isFinite(hours.atlas) ? hours.atlas : 4;
  return `${forge}h GPU (forge) · ${atlas}h CPU (atlas)`;
}

// Reproduce a paper (stage 3): plan card display helpers (machine, scale, hours & budget summary).
export function machineLabel(machine?: string): string {
  if (machine === 'forge') return 'forge (GPU)';
  if (machine === 'atlas') return 'atlas (CPU)';
  return 'sandbox (local)';
}

export function scaleLabel(scale?: string): string {
  if (scale === 'smoke') return 'Smoke';
  if (scale === 'scaled') return 'Scaled down';
  return 'Full scale';
}

export function formatHours(hours: unknown): string {
  const value = Number(hours);
  if (!Number.isFinite(value) || value < 0) return '0h';
  const rounded = Math.round(value * 100) / 100;
  return `${rounded}h`;
}

export function planHoursSummary(plan: { hours?: ComputeBudgetHours | null } | null = null, budget: ComputeBudgetHours | null = null): PlanHoursSummary {
  const forge = typeof plan?.hours?.forge === 'number' && Number.isFinite(plan.hours.forge) ? plan.hours.forge : 0;
  const atlas = typeof plan?.hours?.atlas === 'number' && Number.isFinite(plan.hours.atlas) ? plan.hours.atlas : 0;
  const sandbox = typeof plan?.hours?.sandbox === 'number' && Number.isFinite(plan.hours.sandbox) ? plan.hours.sandbox : 0;
  const forgeBudget = typeof budget?.forge === 'number' && Number.isFinite(budget.forge) ? budget.forge : 8;
  const atlasBudget = typeof budget?.atlas === 'number' && Number.isFinite(budget.atlas) ? budget.atlas : 4;
  const forgeOver = forge > forgeBudget;
  const atlasOver = atlas > atlasBudget;
  return {
    forge,
    atlas,
    sandbox,
    forgeBudget,
    atlasBudget,
    forgeOver,
    atlasOver,
    anyOver: forgeOver || atlasOver,
    line: `forge: ${formatHours(forge)} / ${formatHours(forgeBudget)} · atlas: ${formatHours(atlas)} / ${formatHours(atlasBudget)}${sandbox > 0 ? ` · sandbox: ${formatHours(sandbox)}` : ''}`,
  };
}

// Reproduce a paper (stage 4): live spent cluster hours from Nexus runs against the goal's compute budget.
export function spentHoursSummary(spent: ComputeBudgetHours | null = null, budget: ComputeBudgetHours | null = null): SpentHoursSummary {
  const forgeSpent = typeof spent?.forge === 'number' && Number.isFinite(spent.forge) ? spent.forge : 0;
  const atlasSpent = typeof spent?.atlas === 'number' && Number.isFinite(spent.atlas) ? spent.atlas : 0;
  const forgeBudget = typeof budget?.forge === 'number' && Number.isFinite(budget.forge) ? budget.forge : 8;
  const atlasBudget = typeof budget?.atlas === 'number' && Number.isFinite(budget.atlas) ? budget.atlas : 4;
  const forgeReached = forgeBudget <= 0 || forgeSpent >= forgeBudget;
  const atlasReached = atlasBudget <= 0 || atlasSpent >= atlasBudget;
  return {
    forgeSpent,
    atlasSpent,
    forgeBudget,
    atlasBudget,
    forgeReached,
    atlasReached,
    anyReached: forgeReached || atlasReached,
    line: `Used from Nexus runs: forge ${formatHours(forgeSpent)} / ${formatHours(forgeBudget)} · atlas ${formatHours(atlasSpent)} / ${formatHours(atlasBudget)}`,
  };
}

// Reproduce a paper (stage 5): comparison table display helpers.
export function verdictLabel(verdict?: string, accepted = false): string {
  if (verdict === 'reproduced') return 'Reproduced';
  if (verdict === 'not-reproduced') return accepted ? 'Not reproduced (accepted)' : 'Not reproduced';
  if (verdict === 'couldnt-run') return 'Couldn’t run';
  if (verdict === 'scaled-only') return 'Scaled only';
  return 'Pending';
}

export function comparisonValueWords(value: unknown, unit = ''): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return unit === '%' ? `${value}%` : unit ? `${value} ${unit}` : String(value);
}

export function diffWords(diff: unknown, relDiff: unknown = null, unit = ''): string {
  if (typeof diff !== 'number' || !Number.isFinite(diff)) return '—';
  const rounded = Number(diff.toFixed(4));
  const signed = rounded > 0 ? `+${rounded}` : String(rounded);
  const suffix = unit === '%' ? ' pt' : unit ? ` ${unit}` : '';
  const rel = unit !== '%' && typeof relDiff === 'number' && Number.isFinite(relDiff)
    ? ` (${relDiff > 0 ? '+' : ''}${Number((relDiff * 100).toFixed(1))}%)`
    : '';
  return `${signed}${suffix}${rel}`;
}

export function comparisonSummaryLine(comparison: ComparisonSummaryInput | null = null): string {
  const c = comparison?.counts;
  if (!c?.total) return 'No claims picked';
  const parts = [`${c.reproduced} of ${c.total} reproduced`];
  if (c.accepted > 0) parts.push(`${c.accepted} accepted`);
  const unacceptedFailed = Math.max(0, c.notReproduced - (comparison?.rows || []).filter(r => r.verdict === 'not-reproduced' && r.accepted).length);
  if (unacceptedFailed > 0) parts.push(`${unacceptedFailed} outside tolerance`);
  if (c.scaledOnly > 0) parts.push(`${c.scaledOnly} scaled only`);
  return parts.join(' · ');
}
