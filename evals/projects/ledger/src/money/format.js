import { config } from '../config.js';
import { roundCents } from './round.js';

export function formatMoney(cents) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: config.currency }).format(roundCents(cents) / 100);
}
