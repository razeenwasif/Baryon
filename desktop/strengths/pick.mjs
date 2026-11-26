// The pick by task (docs/auto-by-task-plan.md, stage 4): which provider's model would answer, given the kind of task
// and the strengths table. Pure, like orchestrator.mjs: no clock, no network, no files; everything is passed in.
//
// In stage 4 it's only recorded (a "shadow" pick: the reply's tooltip and routing.jsonl say what it would have chosen);
// nothing answers on it until stage 5, kind by kind, after the comparison and your yes. The rules, in order:
//
//   1. Size and effort as today: the tier comes in decided.
//   2. The kind from the same call. Unsure, everyday, none, or a spoken turn: today's pick stands.
//   3. Who may answer: providers Auto may use, signed in, not in trouble, with their bar under your allowance; a critic
//      never of its author's family. These outrank the table, and a pin.
//   4. A pin for the kind wins, among those.
//   5. The lead: the best blended score takes it only by a margin over your own provider's model (5 points to move,
//      10 to offer a move mid-chat) and with enough confidence. A leader known only from the web needs two sources, and
//      once your evals cover the kind, only a model with eval results can lead it (decision 4, 19 Nov).
//
// Decisions (19 Nov): 4 web numbers move a pick only with two agreeing sources and a clear margin, until your evals
// cover the kind; 6 a favourite past your allowance gives way to the next best without asking; 7 pins, yes; 8 in work,
// the session's provider at its first turn and each job, the lead never moving once the session has started.
//   6. Staying put: inside a chat that already has a provider, the pick stays; a clear enough lead is an offer.
import { AUTO_PROVIDERS, KINDS, modelFor } from '../model-router.mjs';
import { blended, modelKey } from './table.mjs';

export const MARGIN = { move: 5, offer: 10 };
export const MIN_CONFIDENCE = 0.5;
// A critic or judge is never of its author's family (orchestrator.mjs keeps the same map for its seats).
export const FAMILY = { claude: 'claude', gemini: 'gemini', codex: 'gpt' };
export const ALLOWANCE = { quality: 0.95, balanced: 0.85, saver: 0.7 };
const NAMES = { claude: 'Claude', gemini: 'Gemini', codex: 'Codex' };
// Where a move is free, and where it isn't.
export const PLACES = ['new-chat', 'chat', 'work-start', 'work', 'job', 'critic'];
const FREE = new Set(['new-chat', 'work-start', 'job', 'critic']);

// How full a provider's bar is for a model, from usageFrom's shape: the plan's own bar, or the model family's.
function fullness(usage, provider, model) {
  const bars = usage?.[provider];
  if (bars == null) return 0;
  if (typeof bars === 'number') return bars;
  const family = Object.keys(bars.models || {}).find(name => String(model).toLowerCase().includes(name));
  return Math.max(bars.all ?? 0, family ? bars.models[family] : 0);
}

// decided   { tier, effort, kind, kindConfidence, kindUnsure } from Auto's decision
// home      your provider ('claude' | 'gemini' | 'codex'), whose model today's pick is
// table     the strengths table
// offered   { claude: [...ids], gemini: [...], codex: [...] }
// allowed   the providers Auto may use (decision 2: Claude, Gemini and Codex)
// available { claude: true, ... }: signed in and not just failed
// usage     usageFrom(plans);  bias 'quality' | 'balanced' | 'saver', your allowance level
// place     one of PLACES;  chatProvider  the provider a chat already has;  author  the family a critic mustn't share
// spoken    a turn said aloud
// Returns { provider, model, moved, offer, kind, reason, leader, runnerUp, margin, candidates }.
export function pickByTask({ decided = {}, home = 'claude', table = {}, offered = {}, allowed = AUTO_PROVIDERS, available = {}, usage = {}, bias = 'balanced', place = 'new-chat', chatProvider = '', author = '', spoken = false } = {}) {
  const tier = decided.tier || 'standard', kind = decided.kind || null;
  const modelOf = provider => modelFor(provider, tier, offered[provider] || [], decided.effort);
  const today = { provider: home, model: modelOf(home) };
  const stay = reason => ({ ...today, moved: false, offer: null, kind, reason, leader: null, runnerUp: null, margin: null, candidates: [] });
  if (spoken) return stay('A spoken turn isn’t picked by task.');
  if (!kind || !KINDS.includes(kind)) return stay('No kind was read.');
  if (kind === 'everyday') return stay('Everyday requests aren’t picked by task.');
  if (decided.kindUnsure) return stay(`Not sure enough it’s ${kind} (${Math.round((decided.kindConfidence || 0) * 100)}%).`);
  if (!PLACES.includes(place)) return stay('This place isn’t picked by task.');

  // 3. Who may answer, before any score.
  const level = ALLOWANCE[bias] ?? ALLOWANCE.balanced;
  const candidates = [];
  for (const provider of allowed) {
    const model = modelOf(provider);
    if (!model) continue;
    const why = available[provider] === false ? 'signed out or in trouble'
      : fullness(usage, provider, model) >= level ? 'its bar is past your allowance'
      : place === 'critic' && FAMILY[provider] === author ? 'the same family as the author' : '';
    const score = blended(table, model, kind);
    candidates.push({ provider, model, key: modelKey(model), score: score?.score ?? null, confidence: score?.confidence ?? 0, layers: score?.layers || {}, ...(why ? { out: why } : {}) });
  }
  const open = candidates.filter(c => !c.out);
  const yours = open.find(c => c.provider === home) || null;
  if (!open.length) return { ...stay('No provider Auto may use can take it.'), candidates };
  // A critic can't be your provider when it's the author's family: the best of the others.
  const base = place === 'critic' && !yours ? null : yours;

  // 4. A pin wins, among those who may answer.
  const pin = table.pinned?.[kind];
  if (pin) {
    const pinned = open.find(c => c.key === modelKey(pin));
    if (pinned) return decide(pinned, `Pinned for ${kind}.`, { pinned: true });
  }

  // 5. The lead.
  // Once any model you may use has eval results on this kind, the web alone can't lead it (decision 4).
  const covered = open.some(c => c.layers.evals);
  const sure = c => c.score != null && c.confidence >= MIN_CONFIDENCE && (c.layers.evals || (!covered && (c.layers.use || (c.layers.public?.amount ?? 0) >= 2)));
  const ranked = open.filter(sure).sort((a, b) => b.score - a.score);
  const leader = ranked[0] || null, runnerUp = ranked[1] || null;
  if (!leader) return { ...stay(`Nothing sure enough is known about ${kind} yet.`), candidates };
  if (!base) return decide(leader, `${NAMES[home]} can’t take it here; ${NAMES[leader.provider]} leads on ${kind}.`, { runnerUp });
  if (leader.provider === home) return decide(leader, `${NAMES[home]} leads on ${kind}.`, { runnerUp });
  const margin = base.score == null ? null : Math.round((leader.score - base.score) * 10) / 10;
  if (margin == null) return { ...stay(`Nothing sure is known about ${NAMES[home]}’s model on ${kind}, so it isn’t moved.`), leader: brief(leader), candidates };
  const free = FREE.has(place) && !(place === 'new-chat' && chatProvider);
  if (free && margin >= MARGIN.move) return decide(leader, `${NAMES[leader.provider]} leads ${NAMES[home]} by ${margin} on ${kind} (${evidence(leader)}).`, { runnerUp: base, margin });
  if (!free && margin >= MARGIN.offer) return { ...stay(`${NAMES[leader.provider]} leads by ${margin} on ${kind}; mid-chat that’s an offer, not a move.`), offer: { provider: leader.provider, model: leader.model, margin }, leader: brief(leader), runnerUp: brief(base), margin, candidates };
  return { ...stay(`${NAMES[leader.provider]} leads by ${margin} on ${kind}, under the ${free ? MARGIN.move : MARGIN.offer} needed.`), leader: brief(leader), runnerUp: brief(base), margin, candidates };

  function decide(chosen, reason, { runnerUp = null, margin = null, pinned = false } = {}) {
    return { provider: chosen.provider, model: chosen.model, moved: chosen.provider !== home, offer: null, kind, reason, leader: brief(chosen), runnerUp: brief(runnerUp), margin, candidates, ...(pinned ? { pinned: true } : {}) };
  }
}
const brief = c => c && { provider: c.provider, model: c.model, score: c.score, confidence: c.confidence };
const evidence = c => [c.layers.evals && `your evals, ${c.layers.evals.amount} tasks`, c.layers.use && 'use', c.layers.public && `the web, ${c.layers.public.amount} source${c.layers.public.amount === 1 ? '' : 's'}`].filter(Boolean).join('; ');

// What the shadow pick keeps on a reply and in routing.jsonl: who it would have been, whether that's a move or an
// offer, by how much and why. No words of the request.
export function shadowRecord(result) {
  if (!result) return null;
  // others: the models that could answer instead, for Choose another (stage 5), with their scores.
  const others = (result.candidates || []).filter(c => !c.out && c.provider !== result.provider).map(c => ({ provider: c.provider, model: c.model, ...(c.score != null ? { score: c.score } : {}) }));
  return { provider: result.provider, model: result.model, moved: Boolean(result.moved), ...(result.offer ? { offer: { provider: result.offer.provider, model: result.offer.model } } : {}),
    ...(result.margin != null ? { margin: result.margin } : {}), ...(result.pinned ? { pinned: true } : {}), reason: result.reason, ...(others.length ? { others } : {}) };
}
