// The counts as one JSON object: each file's words, and the total.
export function formatJson(counts) {
  const files = Object.fromEntries(counts.map(({ file, words }) => [file, words]));
  return JSON.stringify({ files, total: counts.reduce((sum, { words }) => sum + words, 0) });
}
