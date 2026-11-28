// Match direct requests only, not quoted examples or questions about singing.
export function wantsSinging(text: unknown): boolean {
  if (typeof text !== 'string') return false;
  return /^(?:(?:hey\s+)?(?:fairy|robin|lyra|stella)[,!]?\s+)?(?:(?:can|could|would) you\s+)?(?:please\s+)?(?:sing(?: (?:my|our|the|your) (?:original )?song| for me| something)?|play (?:my|our|the) (?:original )?song)(?:\s+please)?[.!?]*$/i.test(text.trim());
}
