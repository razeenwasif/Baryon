// Words are runs of letters, digits and apostrophes.
export function countWords(text) {
  return (String(text).match(/[\p{L}\p{N}']+/gu) || []).length;
}
