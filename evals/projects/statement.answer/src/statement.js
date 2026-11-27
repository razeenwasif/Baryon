import { format, lineAmount, toCents } from './money.js';

// A statement: one printed row per line, and the total, which is the sum of the rows as printed.
export function statement(lines) {
  const amounts = lines.map(line => toCents(lineAmount(line)));
  return { rows: lines.map((line, i) => ({ name: line.name, amount: format(amounts[i]) })), total: format(amounts.reduce((sum, cents) => sum + cents, 0)) };
}
