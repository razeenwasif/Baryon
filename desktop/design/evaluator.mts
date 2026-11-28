// Phase 4: Isolated Adversarial Visual Critique & Weighted Rubric Scoring.
import {
  buildPhase4EvaluatorPrompt,
  type CaptureReport,
  type DesignSpecInput,
  type StaticGateReport,
} from './skill.mjs';

export const RUBRIC_WEIGHTS = Object.freeze({
  designQuality: 0.35,
  originality: 0.30,
  craft: 0.20,
  functionality: 0.15,
});

export interface DesignScores {
  designQuality: number;
  originality: number;
  craft: number;
  functionality: number;
}

export interface EvalStaticGate extends StaticGateReport {
  passed?: boolean;
}

export interface EvalCaptureReport extends CaptureReport {
  hasOverflow?: boolean;
  consoleErrors?: string[];
}

export interface RawEvaluationInput {
  scores?: Partial<Record<keyof DesignScores, unknown>>;
  strengths?: unknown;
  criticalIssues?: unknown;
  [key: string]: unknown;
}

export interface NormalizeEvaluationOptions {
  threshold?: number;
  staticGate?: EvalStaticGate | null;
  captureReport?: EvalCaptureReport | null;
}

export interface DesignEvaluationResult {
  scores: DesignScores;
  weightedTotal: number;
  threshold: number;
  passed: boolean;
  strengths: string[];
  criticalIssues: string[];
}

export interface DesignCaptureInput {
  name?: string;
  dataUrl?: string;
  [key: string]: unknown;
}

export interface EvaluateAskAIRequest {
  instructions: string;
  prompt: string;
  images: Array<{ url: string; label?: string }>;
  providerOverride: string | null;
  timeoutMs: number;
  signal?: AbortSignal;
}

export type EvaluateAskAIFn = (
  request: EvaluateAskAIRequest,
) => Promise<{ text?: string } | null | undefined>;

export interface EvaluateDesignOptions {
  prompt?: string;
  spec?: DesignSpecInput | null;
  designMd?: string;
  html?: string;
  captures?: readonly DesignCaptureInput[];
  staticGate?: EvalStaticGate | null;
  captureReport?: EvalCaptureReport | null;
  askAI?: EvaluateAskAIFn | null;
  provider?: string;
  threshold?: number;
  signal?: AbortSignal;
}

const clampScore = (value: unknown): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 7.5;
  return Number(Math.max(1, Math.min(10, n)).toFixed(2));
};

export function computeWeightedScore(scores: Partial<Record<keyof DesignScores, unknown>> = {}): number {
  const dq = clampScore(scores.designQuality);
  const orig = clampScore(scores.originality);
  const craft = clampScore(scores.craft);
  const fn = clampScore(scores.functionality);
  const total =
    dq * RUBRIC_WEIGHTS.designQuality +
    orig * RUBRIC_WEIGHTS.originality +
    craft * RUBRIC_WEIGHTS.craft +
    fn * RUBRIC_WEIGHTS.functionality;
  return Number(total.toFixed(2));
}

export function extractJsonObject(text: unknown): Record<string, unknown> | null {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidate = fenced ? fenced[1].trim() : raw;
  try {
    return JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
      } catch {}
    }
  }
  return null;
}

/**
 * Normalize vision/critique JSON + merge static gate and runtime capture defects.
 */
export function normalizeEvaluation(
  raw: RawEvaluationInput | null | undefined,
  { threshold = 8.0, staticGate = null, captureReport = null }: NormalizeEvaluationOptions = {},
): DesignEvaluationResult {
  const rawScores = raw?.scores && typeof raw.scores === 'object' ? raw.scores : {};
  const scores: DesignScores = {
    designQuality: clampScore(rawScores.designQuality),
    originality: clampScore(rawScores.originality),
    craft: clampScore(rawScores.craft),
    functionality: clampScore(rawScores.functionality),
  };

  const criticalIssues = new Set<string>(
    Array.isArray(raw?.criticalIssues)
      ? raw.criticalIssues.map(s => String(s || '').trim()).filter(Boolean)
      : [],
  );

  for (const err of staticGate?.errors || []) criticalIssues.add(err);
  if (captureReport?.hasOverflow) {
    criticalIssues.add('Horizontal viewport overflow detected during rendered capture.');
    scores.craft = Math.min(scores.craft, 6.5);
  }
  if (captureReport?.consoleErrors?.length) {
    criticalIssues.add(`Runtime console errors: ${captureReport.consoleErrors[0]}`);
    scores.functionality = Math.min(scores.functionality, 6.5);
  }
  if (staticGate && !staticGate.passed) {
    scores.craft = Math.min(scores.craft, 6.5);
  }

  const weightedTotal = computeWeightedScore(scores);
  const issuesList = [...criticalIssues];
  const passed = weightedTotal >= threshold && issuesList.length === 0;

  return {
    scores,
    weightedTotal,
    threshold,
    passed,
    strengths: Array.isArray(raw?.strengths) ? raw.strengths.map(s => String(s).trim()).filter(Boolean).slice(0, 4) : [],
    criticalIssues: issuesList,
  };
}

function deterministicFallbackEvaluation({
  html = '',
  staticGate = null,
  captureReport = null,
  threshold = 8.0,
}: {
  html?: string;
  staticGate?: EvalStaticGate | null;
  captureReport?: EvalCaptureReport | null;
  threshold?: number;
} = {}): DesignEvaluationResult {
  const hasRichStructure = /<style\b/i.test(html) && /<(main|header|section)\b/i.test(html);
  const rawScores = {
    designQuality: staticGate?.passed && hasRichStructure ? 8.4 : 7.0,
    originality: staticGate?.metrics?.bannedFontsFound?.length ? 5.5 : 8.3,
    craft: staticGate?.passed && !captureReport?.hasOverflow ? 8.6 : 6.4,
    functionality: captureReport?.consoleErrors?.length ? 6.0 : /<(button|input|select)\b/i.test(html) ? 8.5 : 7.8,
  };
  return normalizeEvaluation(
    {
      scores: rawScores,
      strengths: staticGate?.passed ? ['Follows DESIGN.md CSS custom properties with clean contrast and structure.'] : [],
      criticalIssues: staticGate?.errors || [],
    },
    { threshold, staticGate, captureReport },
  );
}

/**
 * Run isolated Phase 4 evaluation using a fresh model context and captured screenshots.
 */
export async function evaluateDesign({
  prompt,
  spec,
  designMd = '',
  html = '',
  captures = [],
  staticGate = null,
  captureReport = null,
  askAI = null,
  provider = 'auto',
  threshold = 8.0,
  signal,
}: EvaluateDesignOptions = {}): Promise<DesignEvaluationResult> {
  if (typeof askAI !== 'function') {
    return deterministicFallbackEvaluation({ html, staticGate, captureReport, threshold });
  }

  const evalPrompt = buildPhase4EvaluatorPrompt({ prompt, spec, designMd, staticGate, captureReport });
  const images = (captures || [])
    .filter((c): c is DesignCaptureInput & { dataUrl: string } => Boolean(c?.dataUrl))
    .map(c => ({ url: c.dataUrl, label: c.name }));

  try {
    const res = await askAI({
      instructions: 'You are an isolated Principal Product Designer performing objective visual verification. Reply ONLY with valid JSON.',
      prompt: `${evalPrompt}\n\nHTML SOURCE SNAPSHOT (for layout/token verification alongside screenshots):\n${String(html).slice(0, 5000)}`,
      images,
      providerOverride: provider && provider !== 'auto' ? provider : null,
      timeoutMs: 75_000,
      signal,
    });
    const parsed = extractJsonObject(res?.text);
    if (parsed && typeof parsed === 'object' && 'scores' in parsed && parsed.scores) {
      return normalizeEvaluation(parsed as RawEvaluationInput, { threshold, staticGate, captureReport });
    }
  } catch {}

  return deterministicFallbackEvaluation({ html, staticGate, captureReport, threshold });
}
