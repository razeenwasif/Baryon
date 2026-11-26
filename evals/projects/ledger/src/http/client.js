import { config } from '../config.js';
import { withRetries } from './retry.js';

export function fetchJson(url) {
  return withRetries(async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(config.timeoutMs) });
    return response.json();
  }, config.retries);
}
