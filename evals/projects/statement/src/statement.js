import { format, lineAmount } from './money.js';

// A statement: one printed row per line, and the total.
export function statement(lines) {
  const rows = lines.map(line => ({ name: line.name, amount: format(lineAmount(line)) }));
  const total = lines.reduce((sum, line) => sum + lineAmount(line), 0);
  return { rows, total: format(total) };
}
