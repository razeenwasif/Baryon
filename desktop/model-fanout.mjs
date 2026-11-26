export const DEFAULT_FANOUT_SEATS = ['claude', 'gemini', 'codex'];

/**
 * Normalizes requested model/provider seats for parallel read-only fan-out (2–4 unique seats).
 */
export function normalizeFanoutSeats(requested = [], available = []) {
  const availList = Array.isArray(available) && available.length ? available : DEFAULT_FANOUT_SEATS;
  const source = Array.isArray(requested) && requested.length ? requested : availList;
  const out = [];
  const seen = new Set();
  for (const item of source) {
    const id = typeof item === 'string' ? item.trim().toLowerCase() : String(item?.provider || '').trim().toLowerCase();
    if (!id || seen.has(id) || !availList.includes(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= 4) break;
  }
  return out;
}

/**
 * Executes a single read-only prompt in parallel across multiple model families, returning settled per-seat cards.
 */
export async function runModelFanout({
  prompt,
  seats = [],
  runSeat,
  timeoutMs = 120_000,
  signal = null,
} = {}) {
  const cleanPrompt = String(prompt ?? '').trim();
  if (!cleanPrompt || cleanPrompt.length > 12_000) throw new Error('Enter a prompt between 1 and 12,000 characters for /fanout.');
  if (typeof runSeat !== 'function') throw new Error('Fan-out runner is unavailable.');
  if (!Array.isArray(seats) || seats.length === 0) throw new Error('Connect at least one provider before running /fanout.');

  const results = await Promise.allSettled(
    seats.map(async seat => {
      const startedAt = Date.now();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(new Error('Timed out')), timeoutMs);
      timer.unref?.();
      const onParentAbort = () => ctrl.abort(new Error('Stopped'));
      signal?.addEventListener('abort', onParentAbort, { once: true });
      try {
        const res = await runSeat(seat, { prompt: cleanPrompt, signal: ctrl.signal });
        const text = typeof res === 'string' ? res : String(res?.text ?? '').trim();
        return {
          provider: typeof seat === 'string' ? seat : seat.provider,
          model: res?.model || (typeof seat === 'object' ? seat.model : ''),
          label: res?.label || (typeof seat === 'string' ? seat : seat.label || seat.provider),
          ok: Boolean(text),
          text,
          error: text ? '' : 'Empty response returned.',
          ms: Math.max(1, Date.now() - startedAt),
        };
      } catch (err) {
        return {
          provider: typeof seat === 'string' ? seat : seat.provider,
          model: typeof seat === 'object' ? seat.model || '' : '',
          label: typeof seat === 'string' ? seat : seat.label || seat.provider,
          ok: false,
          text: '',
          error: String(err?.message || 'Request failed'),
          ms: Math.max(1, Date.now() - startedAt),
        };
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onParentAbort);
      }
    }),
  );

  return {
    prompt: cleanPrompt,
    seats: seats.map(s => (typeof s === 'string' ? s : s.provider)),
    results: results.map((entry, idx) =>
      entry.status === 'fulfilled'
        ? entry.value
        : {
            provider: String(seats[idx]),
            model: '',
            label: String(seats[idx]),
            ok: false,
            text: '',
            error: String(entry.reason?.message || 'Fan-out failed'),
            ms: 0,
          },
    ),
  };
}
