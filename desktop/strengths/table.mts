// The strengths table (docs/auto-by-task-plan.md, stage 2): a score from 0 to 100 for each model on each kind of task,
// kept per layer of evidence and blended only when asked. Pure, like orchestrator.mjs: no clock, no network, no files;
// everything is passed in.
//
//   public   numbers quoted from benchmark pages on the web (the lowest trust: often the maker's own, on tasks not yours)
//   evals    your own eval runs by kind: passed out of tasks (the highest; stage 3)
//   use      real use: picks kept, overridden, checks passed or failed (a little, fading; stage 6)
//
// A layer with nothing in it adds nothing; it never counts as zero. A cell with no evidence at all is empty, never
// guessed. Scores are compared only within a tier: Opus against Sol against Neon is the table's question; Opus against
// Haiku is the tier's.
import { KINDS, type TaskKind } from '../model-router.mjs';

export type RoutedTaskKind = Exclude<TaskKind, 'everyday'>;
export const ROUTED_KINDS: RoutedTaskKind[] = KINDS.filter((kind): kind is RoutedTaskKind => kind !== 'everyday');
export const LAYERS = ['public', 'evals', 'use'] as const;
export type EvidenceLayer = (typeof LAYERS)[number];

// How much each layer is trusted, and how much evidence makes it count in full.
const TRUST: Record<EvidenceLayer, number> = { public: 1, use: 1.5, evals: 3 };
const FULL: Record<EvidenceLayer, number> = { public: 2, use: 20, evals: 10 };
// The most confidence a layer can give on its own: web numbers alone never make a sure cell.
const CEILING: Record<EvidenceLayer, number> = { public: 0.5, use: 0.4, evals: 0.9 };

export interface PublicEvidenceRow {
  model: string;
  kind: string;
  score: number;
  source: string;
  benchmark?: string;
  value?: unknown;
  url?: string;
  quote?: string;
  fetched?: string;
  [key: string]: unknown;
}

export interface EvalEvidenceRow {
  model: string;
  kind: string;
  passed: number;
  total: number;
  [key: string]: unknown;
}

export interface UseEvidenceRow {
  model: string;
  kind: string;
  for?: boolean;
  weight?: number;
  [key: string]: unknown;
}

export interface StrengthsTableInput {
  version?: number;
  public?: PublicEvidenceRow[];
  aside?: unknown[];
  evals?: EvalEvidenceRow[];
  use?: UseEvidenceRow[];
  pinned?: Record<string, unknown>;
  sources?: Record<string, unknown>;
  known?: Record<string, unknown>;
  notices?: unknown[];
  [key: string]: unknown;
}

export interface StrengthsTable extends StrengthsTableInput {
  version: number;
  public: PublicEvidenceRow[];
  aside: unknown[];
  evals: EvalEvidenceRow[];
  use: UseEvidenceRow[];
  pinned: Record<string, unknown>;
  sources: Record<string, unknown>;
  known: Record<string, unknown>;
  notices: unknown[];
}

export interface LayerScoreResult<TRow = PublicEvidenceRow | EvalEvidenceRow | UseEvidenceRow> {
  score: number;
  amount: number;
  rows: TRow[];
}

export interface LayerSummary {
  score: number;
  amount: number;
}

export interface BlendedScore {
  score: number;
  confidence: number;
  layers: Partial<Record<EvidenceLayer, LayerSummary>>;
}

export interface RankedModelScore {
  model: string;
  score: number | null;
  confidence: number;
  layers: Partial<Record<EvidenceLayer, LayerSummary>>;
}

export interface TableViewModelInput {
  id: string;
  provider: string;
  tier: string;
  name?: string;
}

export interface TableViewColumn {
  model: string;
  provider: string;
  name: string;
}

export interface TableViewSource {
  source: string;
  benchmark?: string;
  value?: unknown;
  url?: string;
  quote?: string;
  fetched?: string;
}

export interface TableViewCell extends RankedModelScore {
  sources: TableViewSource[];
}

export interface TableViewRow {
  kind: RoutedTaskKind;
  cells: TableViewCell[];
}

export interface TableViewTier {
  tier: string;
  columns: TableViewColumn[];
  rows: TableViewRow[];
}

export function emptyTable(): StrengthsTable {
  return { version: 1, public: [], aside: [], evals: [], use: [], pinned: {}, sources: {}, known: {}, notices: [] };
}

// A model as Fairy knows it: its id without a thinking level ("gemini-4-neon-high" → "gemini-4-neon"), so a web number
// for Gemini 4 Neon counts for each level the plan offers.
export const modelKey = (id: unknown): string => String(id || '').trim().toLowerCase().replace(/-(minimal|low|medium|high|xhigh)$/, '');

// The names a model goes by on a web page, from its id: "claude-opus-5-5" → "claude opus 5.5", "opus 5.5";
// "gemini-4-neon" → "gemini 4 neon"; "gpt-6.1-sol" → "gpt 6.1 sol", "gpt-6.1 sol".
export function namesOf(id: unknown): string[] {
  const key = modelKey(id);
  const words = key.split('-').filter(Boolean), joined: string[] = [];
  for (const word of words) {
    const last = joined.at(-1);
    // Version numbers written with dashes in ids are written with a point on the page: "5-5" is "5.5".
    if (/^\d+$/.test(word) && last && /^\d+(\.\d+)?$/.test(last) && !last.includes('.')) joined[joined.length - 1] = `${last}.${word}`;
    else joined.push(word);
  }
  const full = joined.join(' ');
  const makers = new Set(['claude', 'gemini', 'gpt', 'openai', 'anthropic', 'google']);
  const names = new Set([full]);
  if (makers.has(joined[0]) && joined.length > 1) names.add(joined.slice(1).join(' '));
  return [...names];
}
// A web page's way of writing a model name, made comparable: case, punctuation, a bracketed note and the maker's name
// put aside. "Claude Opus 5.5 (Thinking)" → "opus 5.5"; "GPT‑6.1-Sol" → "gpt 6.1 sol".
export function plainName(text: unknown): string {
  return String(text || '').toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/[‐-―]/g, '-')
    .replace(/\b(anthropic|google|openai|deepmind)\b/g, ' ').replace(/[^a-z0-9.]+/g, ' ').trim().replace(/\s+/g, ' ')
    // A thinking level written after the name ("gemini-4-neon-high", "Sol high") is the same model.
    .replace(/ (minimal|low|medium|high|xhigh)$/, '');
}
// Which of the models you're offered a name on a page means, or null. Exact after plainName, so "Opus 5" never counts
// for Opus 5.5 and "Gemini 4 Neon Flash" never for Neon.
export function matchModel(name: unknown, offered: readonly string[] = []): string | null {
  const plain = plainName(name), bare = plain.replace(/^(claude|gemini|gpt) /, '');
  for (const id of offered) {
    const names = namesOf(id).map(plainName);
    if (names.includes(plain) || names.includes(bare)) return modelKey(id);
  }
  return null;
}

// One layer's score for a model on a kind, with how much evidence is behind it.
// public: each source's numbers for that model and kind are averaged first, then the sources, so one page listing
// five benchmarks doesn't outvote two pages.
export function layerScore(table: StrengthsTableInput, layer: 'public', model: unknown, kind: string): LayerScoreResult<PublicEvidenceRow> | null;
export function layerScore(table: StrengthsTableInput, layer: 'evals', model: unknown, kind: string): LayerScoreResult<EvalEvidenceRow> | null;
export function layerScore(table: StrengthsTableInput, layer: 'use', model: unknown, kind: string): LayerScoreResult<UseEvidenceRow> | null;
export function layerScore(table: StrengthsTableInput, layer: string, model: unknown, kind: string): LayerScoreResult | null;
export function layerScore(table: StrengthsTableInput, layer: string, model: unknown, kind: string): LayerScoreResult | null {
  const key = modelKey(model);
  if (layer === 'public') {
    const rows = (table.public || []).filter(row => row.model === key && row.kind === kind && Number.isFinite(row.score));
    if (!rows.length) return null;
    const bySource = new Map<string, number[]>();
    for (const row of rows) {
      let list = bySource.get(row.source);
      if (!list) { list = []; bySource.set(row.source, list); }
      list.push(row.score);
    }
    const means = [...bySource.values()].map(list => list.reduce((a, b) => a + b, 0) / list.length);
    return { score: means.reduce((a, b) => a + b, 0) / means.length, amount: means.length, rows };
  }
  if (layer === 'evals') {
    const rows = (table.evals || []).filter(row => row.model === key && row.kind === kind && row.total > 0);
    const passed = rows.reduce((sum, row) => sum + row.passed, 0), total = rows.reduce((sum, row) => sum + row.total, 0);
    return total ? { score: (100 * passed) / total, amount: total, rows } : null;
  }
  if (layer === 'use') {
    const rows = (table.use || []).filter(row => row.model === key && row.kind === kind);
    const weight = rows.reduce((sum, row) => sum + Math.abs(row.weight ?? 1), 0);
    if (!weight) return null;
    const support = rows.reduce((sum, row) => sum + (row.for ? 1 : 0) * Math.abs(row.weight ?? 1), 0);
    return { score: (100 * support) / weight, amount: rows.length, rows };
  }
  return null;
}

// The blended score for a model on a kind, and how sure it is: layers weighted by trust and by how much each holds,
// confidence from the amount of evidence, capped per layer. null when nothing is known.
export function blended(table: StrengthsTableInput, model: unknown, kind: string): BlendedScore | null {
  let weighted = 0, weights = 0, doubt = 1;
  const layers: Partial<Record<EvidenceLayer, LayerSummary>> = {};
  for (const layer of LAYERS) {
    const found = layerScore(table, layer, model, kind);
    if (!found) continue;
    const share = Math.min(1, found.amount / FULL[layer]);
    weighted += TRUST[layer] * share * found.score; weights += TRUST[layer] * share;
    doubt *= 1 - CEILING[layer] * share;
    layers[layer] = { score: round(found.score), amount: found.amount };
  }
  if (!weights) return null;
  return { score: round(weighted / weights), confidence: round(1 - doubt, 2), layers };
}

// The models of one tier ranked on a kind, best first; models with no evidence come last, unranked.
export function rankWithinTier(table: StrengthsTableInput, kind: string, models: readonly string[]): RankedModelScore[] {
  const scored = models.map(model => ({ model: modelKey(model), ...(blended(table, model, kind) || { score: null, confidence: 0, layers: {} }) }));
  return scored.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}

// What the Strengths page draws: for each tier, its models (one per provider and thinking level folded together) and,
// for each routed kind, each model's cell with its sources.
export function tableView(table: StrengthsTableInput, { models = [] }: { models?: readonly TableViewModelInput[] } = {}): TableViewTier[] {
  const tiers = new Map<string, Map<string, TableViewColumn>>();
  for (const { id, provider, tier, name } of models) {
    const key = modelKey(id);
    let tierMap = tiers.get(tier);
    if (!tierMap) { tierMap = new Map(); tiers.set(tier, tierMap); }
    if (!tierMap.has(key)) tierMap.set(key, { model: key, provider, name: name || key });
  }
  const view: TableViewTier[] = [];
  for (const tier of ['extreme', 'heavy', 'standard', 'light']) {
    const tierMap = tiers.get(tier);
    if (!tierMap) continue;
    const columns = [...tierMap.values()];
    const rows: TableViewRow[] = ROUTED_KINDS.map(kind => ({ kind, cells: columns.map(column => {
      const found = blended(table, column.model, kind), pub = layerScore(table, 'public', column.model, kind);
      return { model: column.model, ...(found || { score: null, confidence: 0, layers: {} }),
        sources: (pub?.rows || []).map(row => ({ source: row.source, benchmark: row.benchmark, value: row.value, url: row.url, quote: row.quote, fetched: row.fetched })) };
    }) }));
    view.push({ tier, columns, rows });
  }
  return view;
}

const round = (value: number, places = 1): number => Math.round(value * 10 ** places) / 10 ** places;
