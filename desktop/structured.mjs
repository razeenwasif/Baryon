// A structured answer (docs/research-migration.md, stage 2): the value a CLI returned for a JSON Schema, else what a
// text answer holds as JSON, whole or cut from its first `{` to its last `}`, the Studio's way. null when there's none.
export function structuredAnswer(value, text = '') {
  if (value && typeof value === 'object') return value;
  const raw = String(text ?? '').trim();
  for (const candidate of [raw, raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)]) {
    if (!candidate) continue;
    try { const parsed = JSON.parse(candidate); if (parsed && typeof parsed === 'object') return parsed; } catch {}
  }
  return null;
}
