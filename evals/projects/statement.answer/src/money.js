// Amounts are kept in whole cents, so the rows and the total add up exactly.
export const format = cents => `$${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;

// What one line comes to in dollars, before rounding: price times quantity, less its discount (0.15 is 15% off).
export const lineAmount = line => line.price * line.quantity * (1 - (line.discount || 0));

// To the nearest cent, a half cent up. Twelve significant digits first, so 1.005 (really 1.00499999…) counts as 1.005.
export const toCents = amount => Math.round(Number((amount * 100).toPrecision(12)));
