// Auto: Fairy picks the model for each request, so you don't have to. Google's Gemini Decisions API (Gemini Decision 1)
// reads the request and chooses one of four tiers in about a fifth of a second; the tier then becomes a model of the
// provider you've chosen (Claude, Gemini or Codex), so Auto never switches who answers, only how big a model does.
//
//   light     Haiku 5.5      Gemini 3.8 Flash (low)    Luna     timers, reminders, a short email, small talk
//   standard  Sonnet 5.5     Gemini 3.8 Flash (high)   Terra    quick edits, web search, the news, small designs
//   heavy     Opus 5.5       Gemini 4 Argon            Sol      software engineering, research
//   extreme   Fable 5.2      Gemini 4 Carbon           Astra    the hardest research and software engineering
//
// It needs a Gemini API key (paid tier, so requests aren't used to improve Google's products). Without one, or if the
// call fails or is slow, the model you chose in the menu answers as before.
//
// For a work session the same call also asks the orchestrator's question, whether the request is one step or needs a
// plan, and the orchestrator (orchestrator.mjs) decides which role takes it: a plan, or an unsure answer, goes to the lead.
import {
  DECIDE_WAIT,
  PLAN_QUESTION,
  SWARM_QUESTION,
  chatRoute,
  classify,
  readPlan,
  readSwarm,
  type AutoDecision,
  type ClassifyResult,
  type DecisionChoiceAnswer,
  type Effort,
  type OfferedModelItem,
  type PlanDecision,
  type Role,
  type Shape,
  type SwarmDecision,
  type Tier,
} from './orchestrator.mjs';

export const TIERS = ['light', 'standard', 'heavy', 'extreme'] as const;
// How hard the model thinks, chosen alongside the tier, as Google's Gemini Notebook does with its thinking levels.
export const EFFORTS = ['low', 'medium', 'high', 'max'] as const;
export const EFFORT_NAMES: Record<Effort, string> = { low: 'quick', medium: 'some thought', high: 'careful', max: 'deepest' };
export const TIER_NAMES: Record<Tier, string> = { light: 'Light', standard: 'Standard', heavy: 'Heavy', extreme: 'Extreme' };
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/decisions', MODEL = 'gemini-decision-1';

export type TaskKind = 'code' | 'maths' | 'circuits' | 'research' | 'data' | 'business' | 'writing' | 'vision' | 'teaching' | 'everyday';

const CRITERIA: Record<Tier, string> = {
  light: 'Quick and simple: setting a timer, alarm or reminder; writing or sending a short email or message; small talk or a greeting; a quick fact, definition or conversion; a yes or no.',
  standard: 'Everyday work: a quick edit to some text or a few lines of code; a mechanical change across several files, such as renaming something everywhere or updating every call to a function; summarising; a web search; the news or a daily brief; a small design, page or slide; explaining a familiar idea; ordinary questions and advice.',
  heavy: 'Serious work: software engineering that needs judgement (writing new features, debugging, restructuring or reviewing real code); multi-step research across sources; working through maths, proofs or exam problems in depth; planning a project; analysing long documents.',
  extreme: 'The very hardest work: open research questions; novel or long proofs; designing a large or complex software system; a hard bug across a big codebase; or anything the user says needs the deepest, most careful thinking.',
};
const EFFORT_CRITERIA: Record<Effort, string> = {
  low: 'Answer straight away with little thinking: small talk, a greeting, a quick fact, setting a timer or reminder, a short message.',
  medium: 'Some care: explaining something, summarising, a small edit, an everyday question with a few steps.',
  high: 'Careful step-by-step reasoning: maths, writing or debugging code, analysis, planning, comparing options, anything where a slip matters.',
  max: 'The deepest reasoning there is: hard proofs, open research questions, designing a complex system, a subtle bug, or when the user asks for the most careful thinking.',
};
// The kind of task a request is (docs/auto-by-task-plan.md, stage 1): asked in the same call, shown on the reply and kept
// in routing.jsonl, and nothing more yet. Auto still picks only the tier and effort; a pick by kind waits for stage 5,
// after Fairy's own evals by kind show it helps. everyday is never routed.
export const KINDS = ['code', 'maths', 'circuits', 'research', 'data', 'business', 'writing', 'vision', 'teaching', 'everyday'] as const;
export const KIND_NAMES: Record<TaskKind, string> = { code: 'code', maths: 'maths', circuits: 'circuits', research: 'research', data: 'data', business: 'business', writing: 'writing', vision: 'vision', teaching: 'teaching', everyday: 'everyday' };
export const KIND_CRITERIA: Record<TaskKind, string> = {
  code: 'Software: writing, fixing, reviewing, explaining or changing code; tests, builds, the command line, git and pull requests; a project’s files when the question is about how the code works.',
  maths: 'Mathematics: calculating, solving equations, proofs, statistics done by hand, physics or engineering problems worked through with equations, and exam or homework problems of that kind.',
  circuits: 'Electronics and digital logic: circuits, components, Kirchhoff’s laws, op-amps, logic gates, truth tables, Karnaugh maps, flip-flops, state machines and hardware description languages.',
  research: 'Finding out what is known: questions that need several sources, papers or the web weighed against each other; literature reviews; why something happens in nature or science; checking a claim with citations.',
  data: 'Working with data: reading, cleaning, summing or charting a spreadsheet, CSV or database; a number to be worked out from a file of data; analysing results or logs.',
  business: 'Running everyday affairs through apps: email, calendar, meetings, Drive documents and budgets, messages to colleagues, scheduling, and what needs acting on.',
  writing: 'Writing for people to read: drafting, rewriting or editing an essay, letter, post, story, report or speech, where the wording itself is the work.',
  vision: 'Understanding a picture: what is in an image, a screenshot, a photo, a diagram or a chart, or reading the text in one.',
  teaching: 'Learning something: being taught a topic step by step, quizzed, given practice questions or flashcards, or having an idea explained for study.',
  everyday: 'Everything else in daily life: small talk, a greeting, timers, alarms and reminders, a quick fact, the weather, the news, recipes, advice and plans for the day.',
};
const KIND_QUESTION = { type: 'choice' as const, instructions: 'What kind of task is this request? Choose the one kind it is mostly about. When it is several, choose the kind of the hardest part; when it is none of them, choose everyday.', criteria: KIND_CRITERIA };
// Where the kind is asked: a chat typed in the window or companion, and a work session. Spoken turns wait less for the
// decision, and the notebook's tutor and drawing aren't routed by kind, so they go without it.
const KIND_WHERE = new Set(['chat', 'work']);

const WHERE: Record<string, string> = {
  chat: 'a conversation with Fairy, a desktop companion, typed or spoken',
  work: 'a work session: an agent with tools working in a folder of code or files',
  notebook: 'a study notebook, where Fairy tutors from the user’s sources',
  draw: 'Fairy explaining by drawing on the user’s screen, or showing them step by step how to do something in an app',
  swarm: 'Swarm mode: strong models from different families each design a solution to a hard request separately, then argue it out; this decides how big a model and how much thinking every designer gets',
  build: 'a builder in a work session following a written brief that names its steps, its files and the check that proves it done',
};
// The least a surface gets: an agent with tools, or a tutor whose answers have to be right, never runs on the smallest.
// A swarm's designers never run below the heavy tier at high effort; a swarm's builder is work, on a written brief.
const FLOOR: Record<string, Tier> = { chat: 'light', work: 'standard', notebook: 'standard', draw: 'standard', swarm: 'heavy', build: 'standard' };
const EFFORT_FLOOR: Record<string, Effort> = { chat: 'low', work: 'medium', notebook: 'medium', draw: 'low', swarm: 'high', build: 'medium' };

// Each tier's models, best first, as patterns over the ids a provider offers. A tier a provider doesn't have falls to
// the nearest one below it that it does (Gemini 4 Carbon, until your plan offers it, is Argon at its highest).
const LADDERS: Record<string, Record<Tier, RegExp[]>> = {
  claude: { light: [/^claude-haiku-5-5$/], standard: [/^claude-sonnet-5-5$/], heavy: [/^claude-opus-5-5$/], extreme: [/^claude-fable-5-2$/, /^claude-fable-5-1$/] },
  // Gemini 4 Hydrogen, the newest Flash, before 3.8 Flash, which stays for plans that don't offer it yet.
  gemini: { light: [/^gemini-4-hydrogen-low$/, /^gemini-3\.8-flash-low$/, /flash-lite/, /flash-low$/], standard: [/^gemini-4-hydrogen-high$/, /^gemini-4-hydrogen-medium$/, /^gemini-3\.8-flash-high$/, /^gemini-3\.8-flash-medium$/, /flash-(high|medium)$/],
    // Gemini 4 Neon (18 Nov 2026) is Argon's successor, between Hydrogen and Carbon, so it comes before Argon at both
    // tiers; Argon stays for plans that don't offer it yet. Carbon still leads the extreme tier where a plan has it.
    heavy: [/^gemini-4-neon-high$/, /^gemini-4-neon/, /^gemini-4-argon-medium$/, /^gemini-4-argon/],
    extreme: [/^gemini-4-carbon-high$/, /^gemini-4-carbon/, /^gemini-4-neon-xhigh$/, /^gemini-4-neon-high$/, /^gemini-4-argon-high$/] },
  codex: { light: [/luna/i], standard: [/terra/i], heavy: [/^gpt-6\.1-sol$/, /sol/i], extreme: [/astra/i] },
};

export interface RouterChoiceAnswer extends DecisionChoiceAnswer {
  probabilities?: Record<string, number>;
}

export interface ReadTierResult {
  tier: Tier;
  confidence: number;
  unsure: boolean;
}

export interface ReadKindResult {
  kind: TaskKind;
  confidence: number;
  unsure: boolean;
}

export interface DecisionContextItem {
  role?: string;
  content?: unknown;
}

export interface DecideTierOptions {
  key?: string;
  text?: string;
  context?: readonly DecisionContextItem[];
  where?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  timeout?: number;
  askPlan?: boolean;
  askSwarm?: boolean;
  askKind?: boolean;
  spoken?: boolean;
}

export interface DecideTierResult {
  tier: Tier;
  confidence: number;
  unsure?: boolean;
  effort?: Effort | null;
  kind?: TaskKind;
  kindConfidence?: number;
  kindUnsure?: boolean;
  plan?: PlanDecision | null;
  swarm?: SwarmDecision | null;
  [key: string]: unknown;
}

export interface ShadowPick {
  provider: string;
  model: string;
  moved?: boolean;
  offer?: boolean;
  margin?: number | null;
  pinned?: boolean;
}

export interface ModelPickRoute {
  shape?: Shape | 'unsure';
  role: Role;
  tier?: Tier;
  effort?: Effort;
  reason: string;
  confidence?: number;
}

export interface ModelPick extends DecideTierResult {
  provider: string;
  model: string;
  where: string;
  at: string;
  route?: ModelPickRoute;
  yours?: boolean;
  shadow?: ShadowPick;
}

export interface ModelRouterOptions {
  key?: () => string;
  offered?: () => Record<string, OfferedModelItem[] | undefined>;
  decide?: (options: DecideTierOptions) => Promise<DecideTierResult | null>;
  onPick?: (pick: ModelPick) => void;
  log?: (message: string) => void;
  shadow?: ((pick: ModelPick, context: { place: string; spoken: boolean }) => ShadowPick | null | undefined) | null;
}

export interface RouterDecisionOptions {
  text: string;
  context?: readonly DecisionContextItem[];
  where?: string;
  signal?: AbortSignal;
  spoken?: boolean;
}

export interface RouterPickOptions extends RouterDecisionOptions {
  provider: string;
  permission?: string;
  chosen?: Record<string, string | undefined>;
  place?: string;
}

// The model for a tier, from what the provider offers (ids); null when it offers nothing that fits. Gemini's models come
// in thinking levels (Argon low, medium, high; Hydrogen up to xhigh), so with an effort the same model at that level
// is chosen when offered: max is the highest it has.
export function modelFor(provider: string, tier: Tier, offered: readonly OfferedModelItem[] = [], effort: Effort | string | null = null): string | null {
  const found = modelForTier(provider, tier, offered);
  if (!found || provider !== 'gemini' || !effort) return found;
  const ids = offered.map(item => typeof item === 'string' ? item : item?.id);
  for (const level of effort === 'max' ? ['xhigh', 'high'] : [effort]) { const same = found.replace(/-(low|medium|high|xhigh)$/, `-${level}`); if (ids.includes(same)) return same; }
  return found;
}
function modelForTier(provider: string, tier: Tier, offered: readonly OfferedModelItem[] = []): string | null {
  const ladder = LADDERS[provider], ids = offered.map(item => typeof item === 'string' ? item : item?.id).filter((id): id is string => Boolean(id));
  if (!ladder) return null;
  for (let at = TIERS.indexOf(tier); at >= 0; at--) {
    for (const pattern of ladder[TIERS[at]]) { const found = ids.find(id => pattern.test(id)); if (found) return found; }
  }
  // Nothing at or below: the smallest above it.
  for (let at = TIERS.indexOf(tier) + 1; at < TIERS.length; at++) {
    for (const pattern of ladder[TIERS[at]]) { const found = ids.find(id => pattern.test(id)); if (found) return found; }
  }
  return null;
}

// Which tier a provider's model is on its ladder, or null: for the Strengths page, which compares models only within a
// tier. A model on two ladders (Gemini 4 Neon heads the heavy tier and stands in for Carbon) is on its lowest, its own.
// A model on no ladder (an older one, a stand-in) has none.
export function tierOf(provider: string, id: unknown): Tier | null {
  const ladder = LADDERS[provider];
  if (!ladder) return null;
  for (const tier of TIERS) if (ladder[tier].some(pattern => pattern.test(String(id)))) return tier;
  return null;
}
// The providers Auto knows, in one list (decision 2: Claude, Gemini and Codex to start). A provider added later needs a
// connection, a ladder here, a family in orchestrator.mjs, readable sign-in and usage, and your tick.
export const AUTO_PROVIDERS: readonly string[] = Object.freeze(Object.keys(LADDERS));

// The answer to the tier question. When it's unsure, the tier its probabilities centre on, so a close call between
// light and standard lands on standard rather than a coin toss.
export function readTier(answer: RouterChoiceAnswer | null | undefined, where = 'chat'): ReadTierResult | null {
  if (!answer || answer.type !== 'choice' || !answer.choice || !(TIERS as readonly string[]).includes(answer.choice)) return null;
  const confidence = Number(answer.confidence) || 0, chances = answer.probabilities || {};
  let tier: Tier = answer.choice as Tier, unsure = false;
  if (confidence < 0.6) {
    const centre = TIERS.reduce((sum, name, index) => sum + (Number(chances[name]) || 0) * index, 0);
    tier = TIERS[Math.max(0, Math.min(TIERS.length - 1, Math.round(centre)))]; unsure = true;
  }
  if (TIERS.indexOf(tier) < TIERS.indexOf(FLOOR[where] || 'light')) tier = FLOOR[where];
  return { tier, confidence: Math.round(confidence * 100) / 100, unsure };
}

// The answer to the effort question, read the same way: unsure lands where its chances centre.
export function readEffort(answer: RouterChoiceAnswer | null | undefined, where = 'chat'): Effort | null {
  if (!answer || answer.type !== 'choice' || !answer.choice || !(EFFORTS as readonly string[]).includes(answer.choice)) return null;
  const confidence = Number(answer.confidence) || 0, chances = answer.probabilities || {};
  let effort: Effort = answer.choice as Effort;
  if (confidence < 0.6) effort = EFFORTS[Math.max(0, Math.min(EFFORTS.length - 1, Math.round(EFFORTS.reduce((sum, name, index) => sum + (Number(chances[name]) || 0) * index, 0))))];
  if (EFFORTS.indexOf(effort) < EFFORTS.indexOf(EFFORT_FLOOR[where] || 'low')) effort = EFFORT_FLOOR[where];
  return effort;
}

// The answer to the kind question: the kind, how sure, and unsure below 0.6 (an unsure kind never moves a pick).
export function readKind(answer: RouterChoiceAnswer | null | undefined): ReadKindResult | null {
  if (!answer || answer.type !== 'choice' || !answer.choice || !(KINDS as readonly string[]).includes(answer.choice)) return null;
  const confidence = Math.round((Number(answer.confidence) || 0) * 100) / 100;
  return { kind: answer.choice as TaskKind, confidence, unsure: confidence < 0.6 };
}

// What the decision reads: where it's asked, a little of the conversation before it, and the request itself.
export function decisionInput({ text, context = [], where = 'chat' }: { text?: string; context?: readonly DecisionContextItem[]; where?: string }): string {
  const earlier = context.slice(-4).map(item => `${item.role === 'assistant' ? 'Fairy' : 'User'}: ${String(item.content || '').replace(/\s+/g, ' ').slice(0, 400)}`).join('\n');
  return `Where: ${WHERE[where] || WHERE.chat}\n${earlier ? `Earlier in the conversation:\n${earlier}\n` : ''}The request to answer now:\n${String(text || '').slice(0, 8000)}`;
}

// askPlan: false leaves the plan question out, askSwarm: false Swarm's, and askKind: false the kind's, once the API has
// refused them. spoken: a turn said aloud, which goes without the kind.
export async function decideTier({ key, text, context = [], where = 'chat', signal, fetchImpl = fetch, timeout = 2500, askPlan = true, askSwarm = true, askKind = true, spoken = false }: DecideTierOptions): Promise<DecideTierResult | null> {
  if (!key) return null;
  const plan = where === 'work' && askPlan, swarm = plan && askSwarm, kind = askKind && !spoken && KIND_WHERE.has(where);
  const response = await fetchImpl(ENDPOINT, {
    method: 'POST', signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(timeout)]),
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ model: MODEL, input: decisionInput({ text, context, where }), questions: {
      tier: { type: 'choice', instructions: 'Which size of model does this request need to be answered well? Choose the smallest tier that will answer it well; a bigger one only costs more time and allowance.', criteria: CRITERIA },
      effort: { type: 'choice', instructions: 'How much thinking does this request need before answering? Choose the least that will answer it well; more only makes the answer slower.', criteria: EFFORT_CRITERIA },
      ...(kind ? { kind: KIND_QUESTION } : {}), ...(plan ? { plan: PLAN_QUESTION } : {}), ...(swarm ? { swarm: SWARM_QUESTION } : {}) } }),
  });
  if (!response.ok) {
    let reason = ''; try { reason = ((await response.json()) as { error?: { message?: string } })?.error?.message || ''; } catch {}
    throw new Error(`Gemini Decisions answered ${response.status}${reason ? `: ${String(reason).slice(0, 160)}` : ''}`);
  }
  const answers = ((await response.json()) as { answers?: Record<string, RouterChoiceAnswer | undefined> })?.answers || {}, tier = readTier(answers.tier, where);
  const read = kind ? readKind(answers.kind) : null;
  return tier && { ...tier, effort: readEffort(answers.effort, where), ...(read ? { kind: read.kind, kindConfidence: read.confidence, kindUnsure: read.unsure } : {}), ...(plan ? { plan: readPlan(answers.plan) } : {}), ...(swarm ? { swarm: readSwarm(answers.swarm, tier.tier) } : {}) };
}

// The router Fairy keeps: the key, what each provider offers, and the last pick, for the model menu to show.
// decision() is the tier and effort alone, for a choice that isn't one provider's model, such as a swarm's designers.
export class ModelRouter {
  key: () => string;
  offered: () => Record<string, OfferedModelItem[] | undefined>;
  decide: (options: DecideTierOptions) => Promise<DecideTierResult | null>;
  onPick: (pick: ModelPick) => void;
  log: (message: string) => void;
  shadow: ((pick: ModelPick, context: { place: string; spoken: boolean }) => ShadowPick | null | undefined) | null;
  last: ModelPick | null;
  problem: string;
  askPlan: boolean;
  askSwarm: boolean;
  askKind: boolean;

  // shadow(pick, { place, spoken }) → what the pick by task would have chosen (strengths/pick.mjs, stage 4), kept on the
  // pick and never acted on: it can't change the model.
  constructor({ key = () => '', offered = () => ({}), decide = decideTier, onPick = () => {}, log = () => {}, shadow = null }: ModelRouterOptions = {}) {
    this.key = key;
    this.offered = offered;
    this.decide = decide;
    this.onPick = onPick;
    this.log = log;
    this.shadow = shadow;
    this.last = null; this.problem = ''; this.askPlan = true; this.askSwarm = true; this.askKind = true;
  }
  // If the API turns down a question, Auto carries on without it rather than stopping altogether. The kind goes when the
  // refusal names it, or when it's the only extra question asked (a chat); otherwise Swarm's suggestion goes first, and
  // the orchestrator's plan question only if it's refused on its own.
  async decideOnce(options: DecideTierOptions): Promise<DecideTierResult | null> {
    for (;;) {
      try { return await this.decide({ ...options, askPlan: this.askPlan, askSwarm: this.askSwarm, askKind: this.askKind }); }
      catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const kindAsked = this.askKind && !options.spoken && KIND_WHERE.has(options.where || 'chat'), workAsked = options.where === 'work' && this.askPlan;
        if (options.signal?.aborted || !/answered 400\b/.test(message) || !(kindAsked || workAsked)) throw error;
        if (kindAsked && (/\bkind\b/i.test(message) || !workAsked)) { this.askKind = false; this.log(`Auto’s kind question was refused, so Auto goes without it: ${message}`); }
        else if (this.askSwarm) { this.askSwarm = false; this.log(`Auto’s Swarm question was refused, so work sessions go without it: ${message}`); }
        else { this.askPlan = false; this.log(`Auto’s plan question was refused, so work sessions go without it: ${message}`); }
      }
    }
  }
  // Resolves { tier, effort, confidence, unsure } (and plan and swarm for work), or null without a key or an answer.
  async decision({ text, context = [], where = 'chat', signal, spoken = false }: RouterDecisionOptions): Promise<DecideTierResult | null> {
    const key = this.key();
    if (!key || !String(text || '').trim()) return null;
    try { const decided = await this.decideOnce({ key, text, context, where, signal, spoken, ...(where === 'chat' ? { timeout: spoken ? DECIDE_WAIT.spoken : DECIDE_WAIT.chat } : {}) }); this.problem = ''; return decided; }
    catch (error: unknown) { if (signal?.aborted) throw error; const message = error instanceof Error ? error.message : String(error); this.problem = message; this.log(`Auto couldn’t choose a model: ${message}`); return null; }
  }
  // provider: 'claude' | 'gemini' | 'codex'. Resolves { model, tier, confidence } or null (use the chosen model). A work
  // turn's also carries route: { shape, role, reason } from the orchestrator, which may have raised its tier and effort.
  // permission is the work chat's mode, since plan mode means the lead plans first whatever the message says.
  // spoken: a chat message said aloud, which waits less for the decision and thinks less below the lead.
  // chosen: your lead model per provider (Settings → Work sessions → Models), used for a work turn the orchestrator
  // gives the lead (one that needs a plan, or heavy or harder work), while the provider offers it; Auto still chooses
  // the effort.
  // place: where a move would be free (a new chat, a work session's first turn) or not; only the shadow reads it.
  async pick({ provider, text, context = [], where = 'chat', signal, permission = '', spoken = false, chosen = {}, place = '' }: RouterPickOptions): Promise<ModelPick | null> {
    if (!LADDERS[provider]) return null;
    let decided = await this.decision({ text, context, where, signal, spoken });
    if (!decided) return null;
    let routeInfo: ModelPickRoute | undefined;
    if (where === 'work') { const route: ClassifyResult = classify(decided as AutoDecision, { permission }); decided = { ...decided, tier: route.tier, effort: route.effort }; routeInfo = route; }
    else if (where === 'chat') { const route = chatRoute(decided as AutoDecision, { spoken }); decided = { ...decided, effort: route.effort }; routeInfo = { role: route.role, reason: route.reason }; }
    const offered = this.offered()[provider] || [], yours = where === 'work' && routeInfo?.role === 'lead' ? chosen[provider] : '';
    const ids = offered.map(item => typeof item === 'string' ? item : item?.id);
    const model = yours && ids.includes(yours) ? yours : modelFor(provider, decided.tier, offered, decided.effort ?? null);
    if (yours && model === yours) decided = { ...decided, yours: true };
    if (!model) return null;
    this.last = { ...decided, ...(routeInfo ? { route: routeInfo } : {}), provider, model, where, at: new Date().toISOString() };
    if (this.shadow && decided.kind) {
      try { const shadow = this.shadow({ ...this.last }, { place: place || (where === 'work' ? 'work' : 'chat'), spoken }); if (shadow) this.last = { ...this.last, shadow }; }
      catch (error: unknown) { const message = error instanceof Error ? error.message : String(error); this.log(`The pick by task couldn’t be worked out: ${message}`); }
    }
    this.onPick(this.last);
    return this.last;
  }
}

// A pick as a line for routing.jsonl: where, the provider and model, the tier and effort, the role, and the kind with how
// sure. Never the request or anything said.
export function pickLine(pick: ModelPick): Record<string, unknown> {
  return { type: 'pick', where: pick.where, provider: pick.provider, model: pick.model, tier: pick.tier, effort: pick.effort, ...(pick.route?.role ? { role: pick.route.role } : {}),
    ...(pick.kind ? { kind: pick.kind, kindConfidence: pick.kindConfidence } : {}), ...(pick.yours ? { yours: true } : {}),
    // What the pick by task would have chosen (stage 4): only the provider, model, whether it's a move or an offer, and
    // the margin.
    ...(pick.shadow ? { byTask: { provider: pick.shadow.provider, model: pick.shadow.model, moved: pick.shadow.moved, ...(pick.shadow.offer ? { offer: true } : {}), ...(pick.shadow.margin != null ? { margin: pick.shadow.margin } : {}), ...(pick.shadow.pinned ? { pinned: true } : {}) } } : {}) };
}

// The settings a chat or tutor turn runs with, once Auto has picked: each provider reads its own model setting, and its
// own kind of effort (Claude's effort level, Codex's reasoning; Gemini's is in the model's name, with reasoning to match).
export function withModel<T extends Record<string, unknown>>(settings: T, provider: string, model: string, effort: Effort | string | null = null): T & Record<string, unknown> {
  const three = effort === 'max' ? 'high' : effort;
  if (provider === 'claude') return { ...settings, claudeModel: model, ...(effort ? { autoEffort: effort } : {}) };
  if (provider === 'gemini') return { ...settings, antigravityModel: model, ...(three ? { reasoning: three } : {}) };
  if (provider === 'codex') return { ...settings, model, ...(three ? { reasoning: three } : {}) };
  return settings;
}
