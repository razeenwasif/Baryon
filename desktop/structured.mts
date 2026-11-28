// A structured answer (docs/research-migration.md, stage 2): the value a CLI returned for a JSON Schema, else what a
// text answer holds as JSON, whole or cut from its first `{` to its last `}`, the Studio's way. null when there's none.
export function structuredAnswer(value: unknown, text = ''): Record<string, unknown> | null {
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  const raw = String(text ?? '').trim();
  for (const candidate of [raw, raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)]) {
    if (!candidate) continue;
    try { const parsed: unknown = JSON.parse(candidate); if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>; } catch {}
  }
  return null;
}
