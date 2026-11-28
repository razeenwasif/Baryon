export type ClipboardRequest =
  | { kind: 'literal'; text: string }
  | { kind: 'previous'; code: boolean }
  | { kind: 'generate'; prompt: string }
  | { kind: 'clarify' };

// Only the current user's direct request authorizes a clipboard replacement.
// Quoted text and fenced code are payload, never commands or authorization.
const destination = String.raw`(?:to|into|on|in)\s+(?:(?:my|the|system|macOS)\s+)?clipboard`;
const stripPrefix = (text: string): string =>
  text.replace(/^(?:(?:hey|hi)[, ]+)?(?:(?:fairy|robin|lyra|stella)[,:]?\s+)?(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?|(?:i(?:'d| would) like|i want|i need)\s+you\s+to\s+)?/i, '');

export function clipboardRequest(text: unknown): ClipboardRequest | null {
  if (typeof text !== 'string') return null;
  const command = stripPrefix(text.trim());
  const visible = command.replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`]*`|"[^"\n]*"|“[^”\n]*”|(?<!\w)'[^'\n]*'/g, ' quoted-content ').replaceAll('’', "'");
  const header = visible.split(/[:\n]/, 1)[0];
  if (/^(?:how|what|why|explain how|translate)\b/i.test(header) || /\b(?:don't|do not|never|without|not yet|instead of|unless|if|example|hypothetical)\b/i.test(header)) return null;
  const implicit = /^copy\s+(?:that|it|your (?:last |previous )?(?:answer|reply|response)|the (?:last |previous )?(?:answer|reply|response|code|code block))[.!?]*$/i.test(visible);
  if (!implicit && !new RegExp(destination + '\\b', 'i').test(visible)) return null;
  if (!/^(?:copy|write|put|place|save|draft|compose|generate|summari[sz]e)\b/i.test(visible)) return null;
  const literal = command.match(new RegExp('^(?:copy|write|put|place|save)\\s+(?:(?:this|the following)(?:\\s+text)?\\s+)?' + destination + '\\s*(?::|\\n) ?([\\s\\S]+)$', 'i'));
  if (literal) return { kind: 'literal', text: literal[1] };
  const copy = command.match(new RegExp('^copy\\s+([\\s\\S]+?)(?:\\s+' + destination + ')?[.!?]*$', 'i'));
  if (copy) {
    const value = copy[1].trim();
    if (/^(?:that|it|this|your (?:(?:last|previous) )?(?:answer|reply|response)|the (?:(?:last|previous) )?(?:answer|reply|response))$/i.test(value)) return { kind: 'previous', code: false };
    if (/^(?:(?:the|that|your) )?(?:(?:last|previous) )?code(?: block)?$/i.test(value)) return { kind: 'previous', code: true };
    const quoted = value.match(/^(?:"([\s\S]*)"|“([\s\S]*)”|'([\s\S]*)'|`([^`]*)`)$/);
    if (quoted) return { kind: 'literal', text: quoted.slice(1).find(v => v !== undefined) ?? '' };
    const fenced = value.match(/^```[^\n]*\n([\s\S]*?)\n```$/);
    if (fenced) return { kind: 'literal', text: fenced[1] };
  }
  const generated = command.match(new RegExp('^((?:write|draft|compose|generate|summari[sz]e)\\s+[\\s\\S]+?)\\s*(?:,?\\s+and|,?\\s+then|,)\\s+(?:copy|put|save|place)\\s+(?:(?:it|that|the (?:text|answer|result|code|draft))\\s+)?' + destination + '[.!?]*$', 'i'));
  if (generated) return { kind: 'generate', prompt: generated[1] };
  return { kind: 'clarify' };
}
