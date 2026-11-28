export const DEFAULT_FANOUT_SEATS = ['claude', 'gemini', 'codex'];

export interface FanoutSeatObject {
  provider: string;
  model?: string;
  label?: string;
}

export type FanoutSeat = string | FanoutSeatObject;

export interface FanoutSeatResponseObject {
  text?: string;
  model?: string;
  label?: string;
}

export type FanoutSeatRunner = (
  seat: FanoutSeat,
  context: { prompt: string; signal: AbortSignal },
) => Promise<string | FanoutSeatResponseObject | null | undefined>;

export interface RunModelFanoutOptions {
  prompt?: unknown;
  seats?: FanoutSeat[];
  runSeat?: FanoutSeatRunner;
  timeoutMs?: number;
  signal?: AbortSignal | null;
}

export interface FanoutSeatResult {
  provider: string;
  model: string;
  label: string;
  ok: boolean;
  text: string;
  error: string;
  ms: number;
}

export interface ModelFanoutResult {
  prompt: string;
  seats: string[];
  results: FanoutSeatResult[];
}

/**
 * Normalizes requested model/provider seats for parallel read-only fan-out (2–4 unique seats).
 */
export function normalizeFanoutSeats(requested: Array<string | { provider?: string } | null | undefined> = [], available: string[] = []): string[] {
  const availList = Array.isArray(available) && available.length ? available : DEFAULT_FANOUT_SEATS;
  const source = Array.isArray(requested) && requested.length ? requested : availList;
  const out: string[] = [];
  const seen = new Set<string>();
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
}: RunModelFanoutOptions = {}): Promise<ModelFanoutResult> {
  const cleanPrompt = String(prompt ?? '').trim();
  if (!cleanPrompt || cleanPrompt.length > 12_000) throw new Error('Enter a prompt between 1 and 12,000 characters for /fanout.');
  if (typeof runSeat !== 'function') throw new Error('Fan-out runner is unavailable.');
  if (!Array.isArray(seats) || seats.length === 0) throw new Error('Connect at least one provider before running /fanout.');

  const results = await Promise.allSettled(
    seats.map(async (seat): Promise<FanoutSeatResult> => {
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
          model: (typeof res === 'object' && res !== null ? res.model : undefined) || (typeof seat === 'object' ? seat.model : '') || '',
          label: (typeof res === 'object' && res !== null ? res.label : undefined) || (typeof seat === 'string' ? seat : seat.label || seat.provider),
          ok: Boolean(text),
          text,
          error: text ? '' : 'Empty response returned.',
          ms: Math.max(1, Date.now() - startedAt),
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : (typeof err === 'object' && err !== null && 'message' in err ? String((err as { message?: unknown }).message ?? '') : '');
        return {
          provider: typeof seat === 'string' ? seat : seat.provider,
          model: typeof seat === 'object' ? seat.model || '' : '',
          label: typeof seat === 'string' ? seat : seat.label || seat.provider,
          ok: false,
          text: '',
          error: String(msg || 'Request failed'),
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
            error: String((entry.reason as { message?: unknown } | undefined)?.message || 'Fan-out failed'),
            ms: 0,
          },
    ),
  };
}
