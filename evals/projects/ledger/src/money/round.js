// Whole cents, rounding halves away from zero.
export const roundCents = cents => Math.sign(cents) * Math.round(Math.abs(cents));
