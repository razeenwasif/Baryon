// Amounts are dollars, held as numbers.
export const format = amount => `$${amount.toFixed(2)}`;

// What one line comes to before rounding: price times quantity, less its discount (0.15 is 15% off).
export const lineAmount = line => line.price * line.quantity * (1 - (line.discount || 0));
