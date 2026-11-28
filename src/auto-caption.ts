// The small line under a reply the orchestrator chose a model for: "Haiku 5.5 · quick".
import { CLAUDE_MODELS } from './model-menu.js';

export const EFFORT_NAMES: Record<string, string> = { low: 'quick', medium: 'some thought', high: 'careful', max: 'deepest' };

export interface AutoByTaskInfo {
  model?: string;
  reason?: string;
  offer?: { model: string };
  margin?: number | null;
  moved?: boolean;
  pinned?: boolean;
}

export interface AutoPickInfo {
  model?: string;
  effort?: string;
  tier?: string;
  standIn?: string;
  chosen?: boolean;
  byTaskMoved?: boolean;
  kind?: string;
  kindConfidence?: number;
  byTask?: AutoByTaskInfo | null;
  route?: {
    shape?: string;
    reason?: string;
  } | null;
}

// A model's name as people say it: Claude's from its list, others from their id ("gemini-4-argon-high" → "Gemini 4 Argon").
export function modelName(id = ''): string {
  const claude = CLAUDE_MODELS.find(model => model.id === id);
  if (claude?.name) return claude.name;
  // A Claude model no longer in the menu, such as claude-fable-5-1, still reads as "Fable 5.1".
  const older = /^claude-([a-z]+)-(\d+)-(\d+)$/.exec(String(id));
  if (older) return `${older[1][0].toUpperCase()}${older[1].slice(1)} ${older[2]}.${older[3]}`;
  const words = String(id).replace(/-(low|medium|high|xhigh)$/, '').split('-').filter(Boolean);
  return words.map(word => /^gpt$/i.test(word) ? 'GPT' : /^\d/.test(word) ? word : word[0].toUpperCase() + word.slice(1)).join(' ') || id;
}

// In a work session it also says whether the request was one step or needed a plan: "Opus 5.5 ·
// careful · needs a plan".
const SHAPE_NAMES: Record<string, string> = { step: 'one step', plan: 'needs a plan', unsure: 'lead decides' };

export function autoCaption(auto?: AutoPickInfo | null): string {
  if (!auto?.model) return '';
  return [
    modelName(auto.model),
    auto.effort ? EFFORT_NAMES[auto.effort] : '',
    auto.route?.shape ? SHAPE_NAMES[auto.route.shape] : '',
    auto.standIn ? 'stand-in' : '',
    auto.byTaskMoved && auto.kind ? `picked for ${auto.kind}` : '',
    auto.chosen ? 'your choice' : '',
  ].filter(Boolean).join(' · ');
}

// Why, for the line's tooltip: the tier, and the orchestrator's reason when there is one.
export function autoWhy(auto?: AutoPickInfo | null): string {
  if (!auto?.model) return '';
  return [auto.standIn, `The orchestrator picked the ${auto.tier || 'standard'} tier.`, auto.route?.reason, kindWords(auto), byTaskWords(auto)].filter(Boolean).join(' ');
}

// What the pick by task would have chosen (stage 4: recorded only): "By task: would pick Sol, leading by 7. Not used yet."
export function byTaskWords(auto?: AutoPickInfo | null): string {
  const by = auto?.byTask;
  if (auto?.chosen) return 'You chose this model with Choose another; the chat stays with it.';
  if (auto?.byTaskMoved && by?.model) return `Picked by task: ${by.reason || `${modelName(by.model)} leads on ${auto.kind}.`}`;
  if (!by?.model) return '';
  const name = modelName(by.model);
  if (by.offer) return `By task: would offer a move to ${modelName(by.offer.model)}${by.margin != null ? `, leading by ${by.margin}` : ''}. Not used yet.`;
  if (by.moved) return `By task: would pick ${name}${by.pinned ? ', pinned for this kind' : by.margin != null ? `, leading by ${by.margin}` : ''}. Not used yet.`;
  return `By task: the same, ${name}. ${by.reason || ''}`.trim();
}

// The kind of task Auto read the request as, with how sure: "Read as maths (82% sure)." It changes no pick yet.
export function kindWords(auto?: AutoPickInfo | null): string {
  if (!auto?.kind) return '';
  const sure = Number.isFinite(auto.kindConfidence) ? ` (${Math.round((auto.kindConfidence ?? 0) * 100)}% sure)` : '';
  return `Read as ${auto.kind === 'everyday' ? 'an everyday request' : auto.kind}${sure}.`;
}
