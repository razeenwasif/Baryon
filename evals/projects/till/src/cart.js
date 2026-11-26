// The till's sums. Prices are in dollars.
export function total(items) {
  let sum = 0;
  for (const item of items) sum += item.price;
  return Math.round(sum * 100) / 100;
}
