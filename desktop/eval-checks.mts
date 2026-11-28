// The checks an eval task is scored by (evals/ and Fairy's own saved evals, docs/evals-from-sessions.md). Each is a
// function of the finished run that says whether one thing held, and why not when it didn't. Kept here so the app,
// which doesn't carry evals/, scores a saved task exactly as scripts/eval.mjs does.

export interface EvalToolCall {
  tool?: string;
  arguments?: {
    command?: unknown;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

export interface EvalRunRecord {
  reply: string;
  verify?: {
    exitCode?: number | null;
    output?: unknown;
  } | null;
  created: {
    localFiles: string[];
    removedFiles: string[];
  };
  calls: EvalToolCall[];
  [key: string]: unknown;
}

export type EvalCheckResult =
  | { name: string; ok: true }
  | { name: string; ok: false; detail: string };

export type EvalCheckFn<TRecord = EvalRunRecord> = ((record: TRecord) => EvalCheckResult) & {
  label: string;
};

export const excerpt = (text: unknown): string => `“${String(text || '').replace(/\s+/g, ' ').trim().slice(0, 160)}”`;

export function check<TRecord = EvalRunRecord>(
  name: string,
  test: (record: TRecord) => boolean | string,
): EvalCheckFn<TRecord> {
  const run = (record: TRecord): EvalCheckResult => {
    const outcome = test(record);
    return outcome === true
      ? { name, ok: true }
      : { name, ok: false, detail: typeof outcome === 'string' ? outcome : 'It didn’t hold.' };
  };
  return Object.assign(run, { label: name });
}

export const says = (pattern: RegExp, name = `reply says ${pattern}`): EvalCheckFn =>
  check(name, r => pattern.test(r.reply) || `The reply was ${excerpt(r.reply)}.`);

// What a work task is scored on, besides its reply and tool calls: what the folder holds once the turn is over.
export const testsPass: EvalCheckFn = check(
  'the tests pass afterwards, hidden ones too',
  r => r.verify?.exitCode === 0 || `The tests exited ${r.verify?.exitCode ?? 'without running'}: ${excerpt(r.verify?.output)}.`,
);

export const changed = (r: EvalRunRecord): string[] => [...r.created.localFiles, ...r.created.removedFiles];

export const changesOnly = (allowed: RegExp | string[], name = `changes only ${allowed}`): EvalCheckFn =>
  check(name, r => {
    const extra = changed(r).filter(path => !(allowed instanceof RegExp ? allowed.test(path) : allowed.includes(path)));
    return !extra.length || `It also changed ${extra.join(', ')}.`;
  });

export const changesNothing: EvalCheckFn = check(
  'changes no files',
  r => !changed(r).length || `It changed ${changed(r).join(', ')}.`,
);

export const commands = (r: EvalRunRecord): string[] =>
  r.calls.filter(call => call.tool === 'run_command').map(call => String(call.arguments?.command || ''));

export const neverRuns = (pattern: RegExp, name: string): EvalCheckFn =>
  check(name, r => !commands(r).some(command => pattern.test(command)) || `It ran ${excerpt(commands(r).find(command => pattern.test(command)))}.`);

export const checksItsWork: EvalCheckFn = check(
  'runs the tests itself',
  r => commands(r).some(command => /\b(?:node\s+--test|npm\s+(?:run\s+)?test)\b/.test(command)) || `It ran ${commands(r).map(excerpt).join(', ') || 'nothing'}.`,
);

export const WORK_CHECKS = Object.freeze({ testsPass, changesOnly, changesNothing, neverRuns, checksItsWork });
