// The checks a saved task is scored by. Each is a function of the finished run that says whether one thing held, and
// why not when it didn't.
import {
  check,
  excerpt,
  says,
  type EvalCheckFn,
  type EvalCheckResult,
  type EvalRunRecord,
  type EvalToolCall,
} from '../desktop/eval-checks.mjs';

export { check, excerpt, says };
export type { EvalCheckFn, EvalCheckResult, EvalRunRecord, EvalToolCall };

export interface CallsOptions {
  min?: number;
  max?: number;
}

export const count = (record: Pick<EvalRunRecord, 'calls'>, tool: string): number =>
  record.calls.filter(call => call.tool === tool).length;

export const calls = (tool: string, { min = 1, max = Infinity }: CallsOptions = {}): EvalCheckFn =>
  check(
    max === Infinity
      ? `calls ${tool}`
      : `calls ${tool} ${min === max ? `exactly ${min}` : `${min}–${max}`} time${max === 1 ? '' : 's'}`,
    r => {
      const n = count(r, tool);
      return (n >= min && n <= max) || `It called ${tool} ${n} time${n === 1 ? '' : 's'}.`;
    },
  );

export const callsAny = (tools: readonly string[]): EvalCheckFn =>
  check(
    `calls ${tools.join(' or ')}`,
    r => tools.some(tool => count(r, tool)) || `It called ${r.calls.map(c => c.tool).join(', ') || 'no tools'}.`,
  );

export const never = (tool: string): EvalCheckFn =>
  check(
    `never calls ${tool}`,
    r => !count(r, tool) || `It called ${tool} ${count(r, tool)} time${count(r, tool) === 1 ? '' : 's'}.`,
  );

export const avoids = (pattern: RegExp, name = `reply avoids ${pattern}`): EvalCheckFn =>
  check(name, r => !pattern.test(r.reply) || `The reply was ${excerpt(r.reply)}.`);

export const approvals = (n: number): EvalCheckFn =>
  check(
    `asks for approval ${n === 0 ? 'never' : `${n} time${n === 1 ? '' : 's'}`}`,
    r => {
      const asked = r.approvals as unknown[];
      return asked.length === n || `It asked ${asked.length} time${asked.length === 1 ? '' : 's'}.`;
    },
  );

export function creates<T = Record<string, unknown>>(
  kind: string,
  n: number,
  test: (item: T) => boolean = () => true,
  name = `creates ${n} ${kind}`,
): EvalCheckFn {
  return check(name, r => {
    const made = ((r.created as unknown as Record<string, T[] | undefined>)[kind]) || [];
    if (made.length !== n) return `It created ${made.length}.`;
    return made.every(test) || `What it created didn’t match: ${excerpt(JSON.stringify(made))}.`;
  });
}
