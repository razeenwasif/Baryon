// Labelled requests for Auto's kind question (docs/auto-by-task-plan.md, stage 1): each is a request and the kind it
// is. Stage 1 is done when nine in ten get the right kind (scripts/kind-check.mjs). Most are the eval tasks' own
// requests, read from their files so they stay in step; kinds the tasks don't cover yet have requests of their own here.
// Requests whose kind is honestly arguable (a test of the bridge, "what is 2 + 2?", a library's default found on the
// web) are left out rather than given a label to argue with.
import { TASKS } from './tasks.mjs';
import { HARD_TASKS } from './work-tasks.mjs';
import { RESEARCH_TASKS } from './research-tasks.mjs';

export interface KindLabel {
  id: string;
  kind: string;
  where: 'chat' | 'work';
  text: string;
}

export interface KindScoreInput {
  id: string;
  kind: string;
  got?: string | null;
  confidence?: number | null;
}

export interface KindScoreRow {
  right: number;
  asked: number;
}

export interface KindScoreMiss {
  id: string;
  kind: string;
  got: string;
  confidence: number | null | undefined;
}

export interface KindScoreSummary {
  right: number;
  asked: number;
  share: number;
  byKind: Record<string, KindScoreRow>;
  misses: KindScoreMiss[];
  passes: boolean;
}

const FROM_TASKS: Record<string, readonly string[]> = {
  business: ['calendar-first-meeting', 'calendar-busy-check', 'calendar-create-approved', 'calendar-injection', 'gmail-act-on', 'gmail-draft-reply', 'gmail-injection', 'drive-budget-total', 'files-injection'],
  code: ['files-dev-port', 'github-ci-failure', 'github-review-reply', 'github-injection', 'work-review-feedback', 'work-fix-bug', 'work-find-fact', 'work-config-readers', 'work-rename', 'work-json-option', 'work-export-formats', 'work-injection', 'work-plan-mode',
    'hard-statement-drift', 'hard-loader-dedupe', 'hard-reminder-dst'],
  data: ['work-number-from-data'],
};

// Kinds the eval tasks don't reach yet. Where says where it's asked: a chat, or a work session.
const OWN: ReadonlyArray<readonly [string, 'chat' | 'work', string]> = [
  ['maths', 'chat', 'Solve 3x² − 12x + 9 = 0 and show each step.'],
  ['maths', 'chat', 'Prove that the square root of 2 is irrational.'],
  ['maths', 'chat', 'A ball is thrown up at 14 m/s. How long until it lands, and how high does it go? Take g as 9.8.'],
  ['circuits', 'chat', 'Two 4 kΩ resistors in parallel, in series with a 2 kΩ, across 12 V. What current flows from the supply?'],
  ['circuits', 'chat', 'Simplify F = A′B′C + A′BC + AB′C + ABC with a Karnaugh map.'],
  ['circuits', 'chat', 'What gain does an inverting op-amp with Rf = 47k and Rin = 4.7k have, and why is it negative?'],
  ['writing', 'chat', 'Rewrite this cover letter opening so it sounds less stiff: “I am writing to express my interest in the position of graduate engineer at your esteemed firm.”'],
  ['writing', 'chat', 'Draft a short speech for my sister’s wedding, warm and a bit funny, about three minutes long.'],
  ['writing', 'chat', 'Edit this paragraph of my essay for flow and cut it to about 120 words.'],
  ['vision', 'chat', 'What does the error in this screenshot say? [image attached]'],
  ['vision', 'chat', 'What plant is this in the photo I’ve attached, and is it safe for cats? [image attached]'],
  ['teaching', 'chat', 'Teach me how eigenvalues work, step by step, then quiz me with three questions.'],
  ['teaching', 'chat', 'Make me ten flashcards on the causes of the First World War for my history exam.'],
  ['teaching', 'chat', 'I don’t get recursion. Explain it like I’m new to programming, with a small example I can trace.'],
  ['everyday', 'chat', 'Set a timer for 20 minutes.'],
  ['everyday', 'chat', 'Good morning! What’s the weather like today?'],
  ['everyday', 'chat', 'What can I cook tonight with chicken, rice and a lemon?'],
  ['data', 'work', 'Read results.csv and tell me the mean and median latency per region, then chart it.'],
];

export function kindLabels(): KindLabel[] {
  const all = [...TASKS, ...HARD_TASKS], labels: KindLabel[] = [];
  for (const [kind, ids] of Object.entries(FROM_TASKS)) for (const id of ids) {
    const task = all.find(item => item.id === id);
    if (!task) throw new Error(`No eval task called ${id}`);
    labels.push({ id, kind, where: task.kind === 'work' || /^(work|hard)-/.test(id) ? 'work' : 'chat', text: task.ask });
  }
  for (const task of RESEARCH_TASKS) labels.push({ id: task.id, kind: 'research', where: 'chat', text: task.title });
  OWN.forEach(([kind, where, text], index) => labels.push({ id: `own-${kind}-${index + 1}`, kind, where, text }));
  return labels;
}

// How the answers did: right out of how many, by kind, and what each miss was read as.
export function kindScore(results: readonly KindScoreInput[]): KindScoreSummary {
  const byKind: Record<string, KindScoreRow> = {}, misses: KindScoreMiss[] = [];
  for (const { id, kind, got, confidence } of results) {
    const row = byKind[kind] ||= { right: 0, asked: 0 };
    row.asked++;
    if (got === kind) row.right++; else misses.push({ id, kind, got: got || 'no answer', confidence });
  }
  const right = results.filter(result => result.got === result.kind).length;
  return { right, asked: results.length, share: results.length ? right / results.length : 0, byKind, misses, passes: results.length > 0 && right / results.length >= 0.9 };
}
