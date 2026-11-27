// Fairy away from the mini, Away 2: the values a window call carries between the Macs. JSON, plus bytes (Buffer,
// ArrayBuffer, typed arrays) as { "$bytes": "<base64>" } and dates as { "$date": "<ISO>" }. Anything else JSON can't
// carry (a function, a symbol, a bigint, a cycle, NaN) makes encode throw, so a channel that needs more is found by its
// test, not in use.

// Values nest this deep at most; nothing a window call carries comes near it, and a body built to nest deeper is refused
// rather than walked.
export const MAX_DEPTH = 64;
const tooDeep = () => new TypeError('A value nested that deeply can’t be sent between the Macs.');
const plain = value => value !== null && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

export function encode(value, seen = new Set(), depth = 0) {
  if (depth > MAX_DEPTH) throw tooDeep();
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new TypeError('A number that isn’t finite can’t be sent between the Macs.'); return value; }
  if (value === undefined) return null;
  if (typeof value !== 'object') throw new TypeError(`A ${typeof value} can’t be sent between the Macs.`);
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) return { $bytes: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64') };
  if (value instanceof ArrayBuffer) return { $bytes: Buffer.from(value).toString('base64') };
  if (value instanceof Date) { if (Number.isNaN(value.getTime())) throw new TypeError('An invalid date can’t be sent between the Macs.'); return { $date: value.toISOString() }; }
  if (seen.has(value)) throw new TypeError('A value that contains itself can’t be sent between the Macs.');
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map(item => encode(item, seen, depth + 1));
    if (!plain(value)) throw new TypeError(`A ${value.constructor?.name || 'special'} object can’t be sent between the Macs.`);
    const out = {};
    for (const [key, item] of Object.entries(value)) if (item !== undefined && typeof item !== 'function') out[key] = encode(item, seen, depth + 1);
    // A function inside a plain object is a mistake, not data: say so rather than drop it quietly.
    for (const [key, item] of Object.entries(value)) if (typeof item === 'function') throw new TypeError(`“${key}” is a function and can’t be sent between the Macs.`);
    return out;
  } finally { seen.delete(value); }
}

export function decode(value, depth = 0) {
  if (depth > MAX_DEPTH) throw tooDeep();
  if (Array.isArray(value)) return value.map(item => decode(item, depth + 1));
  if (!plain(value)) return value;
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === '$bytes' && typeof value.$bytes === 'string') return Buffer.from(value.$bytes, 'base64');
  if (keys.length === 1 && keys[0] === '$date' && typeof value.$date === 'string') return new Date(value.$date);
  return Object.fromEntries(keys.map(key => [key, decode(value[key], depth + 1)]));
}
