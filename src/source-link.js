// A citation is lyra-file://<folder>/<path, base64url>?line=N or ?page=N.
export function describeSource(link, label = '') {
  try {
    const url = new URL(link);
    if (url.protocol !== 'lyra-file:') return null;
    const encoded = url.pathname.slice(1).replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(encoded + '==='.slice((encoded.length + 3) % 4));
    const path = new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0)));
    const page = url.searchParams.get('page'), line = url.searchParams.get('line');
    // Models often link a file's first line but name the lines they mean in the link's text, so that wins.
    const named = !page && /\blines?\s+(\d+)(?:\s*[–—-]\s*(\d+))?/i.exec(label);
    const from = named ? Number(named[1]) : line ? Number(line) : 1, to = named?.[2] ? Math.max(from, Number(named[2])) : from;
    return { link, path, name: path.split('/').pop() || path, where: page ? `Page ${page}` : from === to ? `Line ${from}` : `Lines ${from}–${to}`, page: page ? Number(page) : null, line: line ? Number(line) : null, from, to };
  } catch { return null; }
}

export const isPdf = path => /\.pdf$/i.test(String(path || ''));
// The same file's link at another page, for drawing a PDF a page at a time.
export const pageLink = (link, page) => `${String(link).replace(/\?.*$/, '')}?page=${Math.max(1, Math.floor(Number(page)) || 1)}`;
// The same file's link from a line, or a PDF's text from a page, for reading its words.
export const lineLink = (link, line) => `${String(link).replace(/\?.*$/, '')}?line=${Math.max(1, Math.floor(Number(line)) || 1)}`;
