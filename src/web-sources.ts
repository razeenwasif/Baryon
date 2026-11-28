// The web pages a chat's work turns read, newest first, each once, with when they were read ("Improving existing
// features", item 7). They come from the turns' own records of what they did, so nothing has to be cited for a page to
// be listed.
export interface WebSourceActivityItem {
  tool?: string;
  status?: string;
  summary?: unknown;
}

export interface WebSourceHistoryEntry {
  role?: string;
  at?: string;
  activity?: WebSourceActivityItem[];
}

export interface WebSourceItem {
  url: string;
  at: string;
  name: string;
  site: string;
}

export function webSources(history: readonly WebSourceHistoryEntry[] = []): WebSourceItem[] {
  const seen = new Map<string, { url: string; at: string }>();
  for (const entry of history) {
    if (entry?.role !== 'assistant' || !Array.isArray(entry.activity)) continue;
    for (const row of entry.activity) {
      if (row?.tool !== 'web-read' || row.status !== 'done' || !/^https?:\/\//i.test(String(row.summary || ''))) continue;
      const url = String(row.summary), at = String(entry.at || '');
      const prev = seen.get(url);
      if (!prev || prev.at < at) seen.set(url, { url, at });
    }
  }
  return [...seen.values()]
    .sort((a, b) => b.at.localeCompare(a.at))
    .map(({ url, at }) => {
      let name = url, site = '';
      try {
        const parsed = new URL(url);
        site = parsed.hostname.replace(/^www\./, '');
        const last = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '');
        name = last ? `${site} · ${last}` : site;
      } catch {}
      return { url, at, name, site };
    });
}
