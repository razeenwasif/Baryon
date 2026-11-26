// The checks a saved task is scored by. Each is a function of the finished run that says whether one thing held, and
// why not when it didn't.
import { check, excerpt, says } from '../desktop/eval-checks.mjs';
export { check, excerpt, says };
export const count = (record, tool) => record.calls.filter(call => call.tool === tool).length;
export const calls = (tool, { min = 1, max = Infinity } = {}) => check(max === Infinity ? `calls ${tool}` : `calls ${tool} ${min === max ? `exactly ${min}` : `${min}–${max}`} time${max === 1 ? '' : 's'}`,
  r => { const n = count(r, tool); return (n >= min && n <= max) || `It called ${tool} ${n} time${n === 1 ? '' : 's'}.`; });
export const callsAny = tools => check(`calls ${tools.join(' or ')}`, r => tools.some(tool => count(r, tool)) || `It called ${r.calls.map(c => c.tool).join(', ') || 'no tools'}.`);
export const never = tool => check(`never calls ${tool}`, r => !count(r, tool) || `It called ${tool} ${count(r, tool)} time${count(r, tool) === 1 ? '' : 's'}.`);
export const avoids = (pattern, name = `reply avoids ${pattern}`) => check(name, r => !pattern.test(r.reply) || `The reply was ${excerpt(r.reply)}.`);
export const approvals = n => check(`asks for approval ${n === 0 ? 'never' : `${n} time${n === 1 ? '' : 's'}`}`, r => r.approvals.length === n || `It asked ${r.approvals.length} time${r.approvals.length === 1 ? '' : 's'}.`);
export const creates = (kind, n, test = () => true, name = `creates ${n} ${kind}`) => check(name, r => {
  const made = r.created[kind] || [];
  if (made.length !== n) return `It created ${made.length}.`;
  return made.every(test) || `What it created didn’t match: ${excerpt(JSON.stringify(made))}.`;
});
