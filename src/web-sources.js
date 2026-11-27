// The web pages a chat's work turns read, newest first, each once, with when they were read ("Improving existing
// features", item 7). They come from the turns' own records of what they did, so nothing has to be cited for a page to
// be listed.
export function webSources(history = []) {
  const seen = new Map();
  for (const entry of history) {
    if (entry?.role !== 'assistant' || !Array.isArray(entry.activity)) continue;
    for (const row of entry.activity) {
      if (row?.tool !== 'web-read' || row.status !== 'done' || !/^https?:\/\//i.test(String(row.summary || ''))) continue;
      const url = String(row.summary), at = String(entry.at || '');
      if (!seen.has(url) || seen.get(url).at < at) seen.set(url, { url, at });
    }
  }
  return [...seen.values()].sort((a, b) => b.at.localeCompare(a.at)).map(({ url, at }) => {
    let name = url, site = '';
    try { const parsed = new URL(url); site = parsed.hostname.replace(/^www\./, ''); const last = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || ''); name = last ? `${site} · ${last}` : site; } catch {}
    return { url, at, name, site };
  });
}
