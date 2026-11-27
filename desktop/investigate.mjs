// Parallel multi-source investigation for Doc 7 #12 (/investigate <question>).
// Scouts inspect project code, live web sources, and personal notes / saved papers in parallel;
// the lead synthesizes one cited answer separating confirmed facts from unconfirmed gaps.
import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const STOP_WORDS = new Set([
  'about', 'after', 'again', 'against', 'all', 'also', 'and', 'any', 'are', 'been', 'before',
  'being', 'between', 'both', 'but', 'can', 'could', 'did', 'does', 'doing', 'done', 'down',
  'during', 'each', 'few', 'for', 'from', 'further', 'had', 'has', 'have', 'having', 'her',
  'here', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'into', 'its', 'itself', 'just',
  'more', 'most', 'not', 'now', 'off', 'once', 'only', 'other', 'our', 'ours', 'out', 'over',
  'own', 'same', 'she', 'should', 'some', 'such', 'than', 'that', 'the', 'their', 'theirs',
  'them', 'then', 'there', 'these', 'they', 'this', 'those', 'through', 'under', 'until',
  'very', 'was', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why',
  'will', 'with', 'would', 'your', 'yours',
]);

const SAFE_URL = /^https?:\/\/[^\s<>"{}|\\^`[\]]+$/i;
const MAX_DOSSIER_CHARS = 36000;
const MAX_CODE_CHARS = 12000;
const MAX_WEB_PAGE_CHARS = 4500;
const MAX_WEB_PAGES = 3;
const MAX_PAPERS = 12;

export const CODE_SCOUT_INSTRUCTIONS = [
  'You are the codebase scout for a parallel /investigate run.',
  'Read project files, inspect definitions and call sites, and gather concrete facts with exact relative file paths and line numbers (e.g. src/foo.js#L42).',
  'Reply with concise bullet points citing only verified file paths, line numbers, symbol names, and observed behavior. State explicitly what was not found or could not be checked.',
].join(' ');

export const INVESTIGATE_LEAD_INSTRUCTIONS = [
  'You are the lead synthesizer for Fairy’s /investigate workflow.',
  'You receive a question and evidence dossiers returned by parallel scouts (Codebase, Web sources, Personal notes & papers) plus an explicit list of gaps or failed scouts.',
  'Rules:',
  '- Rely ONLY on the evidence provided in the dossiers below. Never invent URLs, file paths, line numbers, metrics, or facts.',
  '- Cite repository files using Markdown links with relative path and line number, e.g. [work-tools.mjs line 42](desktop/work-tools.mjs#L42).',
  '- Cite web pages using their exact verified https:// or http:// Markdown link from the Web sources dossier.',
  '- Cite personal notes or local documents using their exact [Title](lyra-file://...) links when provided, or note their title/path verbatim.',
  '- Structure your response clearly with these exact headings:',
  '## Answer',
  '## Sources & Evidence',
  '## What could not be confirmed',
  '- Under "What could not be confirmed", explicitly note any failed scouts, skipped searches, missing sources, or unverified claims.',
].join('\n');

export function parseInvestigateCommand(text) {
  const value = String(text ?? '');
  const match = /^\s*\/investigate(?:\s+([\s\S]+))?$/i.exec(value);
  if (!match) return { matched: false, question: '' };
  return { matched: true, question: (match[1] || '').trim() };
}

export function extractQueryTerms(question) {
  const raw = String(question || '').toLowerCase().match(/[a-z0-9][a-z0-9_-]{1,}/g) || [];
  const out = [];
  const seen = new Set();
  for (const term of raw) {
    if (term.length < 3 || STOP_WORDS.has(term) || seen.has(term)) continue;
    seen.add(term);
    out.push(term);
    if (out.length >= 12) break;
  }
  return out;
}

export function extractUrlsFromText(text, limit = 8) {
  const matches = String(text || '').match(/https?:\/\/[^\s<>"'`)\]]+/gi) || [];
  const out = [];
  const seen = new Set();
  for (const candidate of matches) {
    const cleaned = candidate.replace(/[.,;:!?]+$/, '');
    if (!SAFE_URL.test(cleaned) || seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
    if (out.length >= limit) break;
  }
  return out;
}

// Reads saved literature matrices across research investigation folders under `researchFolder`.
export async function collectLiteratureItems(researchFolder, { maxDirs = 40 } = {}) {
  if (!researchFolder) return [];
  let entries;
  try {
    entries = await readdir(researchFolder, { withFileTypes: true });
  } catch {
    return [];
  }
  const items = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (maxDirs-- <= 0) break;
    const filePath = join(researchFolder, entry.name, 'literature.json');
    try {
      const parsed = JSON.parse(await readFile(filePath, 'utf8'));
      const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.papers) ? parsed.papers : [];
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        items.push({
          id: String(item.id || item.arxivId || item.doi || '').slice(0, 120),
          title: String(item.title || '').trim().slice(0, 300),
          year: item.year ? String(item.year) : '',
          url: SAFE_URL.test(String(item.url || '')) ? String(item.url) : '',
          authors: Array.isArray(item.authors) ? item.authors.slice(0, 6).join(', ') : String(item.authors || '').slice(0, 200),
          summary: String(item.abstract || item.summary || item.notes || item.relevance || '').trim().slice(0, 800),
          investigation: entry.name,
        });
      }
    } catch {
      // Missing or invalid literature.json for a folder is normal; skip quietly.
    }
  }
  return items;
}

function scoreMatch(haystack, terms) {
  if (!terms.length) return 0;
  const lower = String(haystack || '').toLowerCase();
  let hits = 0;
  for (const term of terms) {
    if (lower.includes(term)) hits += 1;
  }
  return hits;
}

export function collectPaperEvidence({ question, notesHits = [], literatureItems = [], watcherPapers = [] } = {}) {
  const terms = extractQueryTerms(question);
  const notes = [];
  for (const hit of Array.isArray(notesHits) ? notesHits : []) {
    if (!hit || typeof hit !== 'object') continue;
    const pathStr = String(hit.path || '');
    const line = Number(hit.line) > 0 ? Number(hit.line) : 0;
    const page = Number(hit.page) > 0 ? Number(hit.page) : 0;
    notes.push({
      kind: 'note',
      id: String(hit.id || ''),
      title: String(hit.question || (pathStr ? basename(pathStr) : '') || 'Personal note').slice(0, 200),
      path: pathStr,
      line,
      page,
      source: String(hit.source || ''),
      excerpt: String(hit.answer || hit.excerpt || '').trim().slice(0, 900),
      score: Number(hit.score) || 0,
    });
  }

  const combinedPapers = [];
  const seenKey = new Set();
  const pushPaper = (kind, raw) => {
    if (!raw || typeof raw !== 'object') return;
    const title = String(raw.title || '').trim();
    const url = SAFE_URL.test(String(raw.url || '')) ? String(raw.url) : '';
    const id = String(raw.id || '').trim();
    if (!title && !url && !id) return;
    const key = (id || url || title).toLowerCase();
    if (seenKey.has(key)) return;
    seenKey.add(key);
    const haystack = `${title} ${raw.summary || ''} ${raw.authors || ''} ${id}`;
    const score = scoreMatch(haystack, terms);
    combinedPapers.push({
      kind,
      id: id.slice(0, 120),
      title: (title || id || url).slice(0, 300),
      year: raw.year ? String(raw.year) : '',
      url,
      authors: String(raw.authors || '').slice(0, 200),
      summary: String(raw.summary || '').trim().slice(0, 700),
      investigation: String(raw.investigation || ''),
      score,
    });
  };

  for (const item of Array.isArray(literatureItems) ? literatureItems : []) pushPaper('paper', item);
  for (const item of Array.isArray(watcherPapers) ? watcherPapers : []) pushPaper('watcher-paper', item);

  const matched = combinedPapers.filter(p => p.score > 0).sort((a, b) => b.score - a.score);
  const papers = (matched.length ? matched : combinedPapers.slice(0, 5)).slice(0, MAX_PAPERS);
  return {
    notes,
    papers,
    matchedPaperCount: matched.length,
    totalCandidatePapers: combinedPapers.length,
  };
}

export async function defaultWebScout({ searchWeb, readPage, question, signal, maxPages = MAX_WEB_PAGES, onRow = () => {} }) {
  const gaps = [];
  const pages = [];
  let results = [];
  let searchText = '';

  const searchRow = onRow({ id: 'investigate-web-search', tool: 'web-search', status: 'running', summary: question });
  try {
    const found = await searchWeb({ query: question, signal });
    results = Array.isArray(found?.results) ? found.results : [];
    searchText = String(found?.text || '').slice(0, 6000);
    const candidateUrls = [];
    const seen = new Set();
    for (const item of results) {
      if (SAFE_URL.test(String(item?.url || '')) && !seen.has(item.url)) {
        seen.add(item.url);
        candidateUrls.push({ url: item.url, title: String(item.title || '').slice(0, 200), snippet: String(item.snippet || '').slice(0, 600) });
      }
    }
    if (!candidateUrls.length && searchText) {
      for (const url of extractUrlsFromText(searchText, maxPages)) {
        if (!seen.has(url)) { seen.add(url); candidateUrls.push({ url, title: url, snippet: '' }); }
      }
    }
    onRow({
      id: searchRow.id,
      tool: 'web-search',
      status: 'done',
      summary: question,
      detail: `${candidateUrls.length} ${candidateUrls.length === 1 ? 'result' : 'results'}`,
      output: candidateUrls.map(c => `${c.title || c.url} — ${c.url}`).join('\n') || 'No structured links returned.',
    });

    const toRead = candidateUrls.slice(0, Math.max(0, maxPages));
    if (toRead.length && readPage) {
      await Promise.allSettled(toRead.map(async (item, index) => {
        const rowId = `investigate-web-read-${index + 1}`;
        onRow({ id: rowId, tool: 'web-read', status: 'running', summary: item.url });
        try {
          const read = await readPage({ url: item.url, signal });
          if (read?.redirected && !read?.text) {
            const msg = `Redirected to ${read.redirected} without readable content`;
            onRow({ id: rowId, tool: 'web-read', status: 'failed', summary: item.url, output: msg });
            gaps.push(`Web page ${item.url}: ${msg}.`);
            return;
          }
          const finalUrl = SAFE_URL.test(String(read?.url || '')) ? read.url : item.url;
          const title = String(read?.title || item.title || finalUrl).slice(0, 200);
          const text = String(read?.text || '').trim().slice(0, MAX_WEB_PAGE_CHARS);
          pages.push({ url: finalUrl, title, snippet: item.snippet, text });
          // Summary MUST be the https URL so src/web-sources.js lists the read page in the Sources pane.
          onRow({
            id: rowId,
            tool: 'web-read',
            status: 'done',
            summary: finalUrl,
            detail: title,
            output: text.slice(0, 1200) || item.snippet,
          });
        } catch (error) {
          onRow({ id: rowId, tool: 'web-read', status: 'failed', summary: item.url, output: error.message });
          gaps.push(`Could not read web page ${item.url}: ${error.message}`);
        }
      }));
    } else if (!toRead.length) {
      gaps.push('Web search returned no readable http(s) URLs.');
    }
  } catch (error) {
    onRow({ id: searchRow.id, tool: 'web-search', status: 'failed', summary: question, output: error.message });
    gaps.push(`Web search failed: ${error.message}`);
  }

  return { results, searchText, pages, gaps };
}

export function buildInvestigateDossier({ question, code, web, notesPapers, gaps = [] }) {
  const parts = [`Question: ${question}`];

  parts.push('=== CODEBASE SCOUT ===');
  if (code?.status === 'skipped') {
    parts.push(`(Skipped: ${code.reason})`);
  } else if (code?.status === 'failed') {
    parts.push(`(Failed: ${code.error})`);
  } else if (code?.summary) {
    parts.push(String(code.summary).trim().slice(0, MAX_CODE_CHARS));
  } else {
    parts.push('(No codebase findings returned.)');
  }

  parts.push('=== WEB SOURCES SCOUT ===');
  if (web?.status === 'skipped') {
    parts.push(`(Skipped: ${web.reason})`);
  } else if (web?.status === 'failed') {
    parts.push(`(Failed: ${web.error})`);
  } else {
    const pages = web?.pages || [];
    const results = web?.results || [];
    if (pages.length) {
      for (const page of pages) {
        parts.push(`Page: [${page.title}](${page.url})\n${page.text || page.snippet || '(empty body)'}`);
      }
    }
    const unreadResults = results.filter(r => r?.url && !pages.some(p => p.url === r.url));
    if (unreadResults.length) {
      parts.push('Search snippets (not opened in full):');
      for (const item of unreadResults.slice(0, 5)) {
        parts.push(`- [${item.title || item.url}](${item.url}): ${item.snippet || ''}`);
      }
    }
    if (!pages.length && !unreadResults.length) {
      parts.push(web?.searchText ? `Search text:\n${web.searchText}` : '(No web results returned.)');
    }
  }

  parts.push('=== PERSONAL NOTES & PAPERS SCOUT ===');
  if (notesPapers?.status === 'failed') {
    parts.push(`(Failed: ${notesPapers.error})`);
  } else {
    const notes = notesPapers?.notes || [];
    const papers = notesPapers?.papers || [];
    if (notesPapers?.rawNotesContext) {
      parts.push('Personal notes context:');
      parts.push(String(notesPapers.rawNotesContext).trim().slice(0, 6000));
    } else if (notes.length) {
      parts.push('Personal notes hits:');
      for (const n of notes) {
        const link = n.source ? `[${n.title}](${n.source})` : `${n.title}${n.path ? ` (${n.path}${n.line ? `#L${n.line}` : ''})` : ''}`;
        parts.push(`- ${link}: ${n.excerpt}`);
      }
    } else {
      parts.push('Personal notes: no matching excerpts found.');
    }
    if (papers.length) {
      parts.push('Saved papers & arXiv watchers:');
      for (const p of papers) {
        const ref = p.url ? `[${p.title}](${p.url})` : p.title;
        parts.push(`- ${ref}${p.year ? ` (${p.year})` : ''}${p.id ? ` [${p.id}]` : ''}: ${p.summary || 'No summary'}`);
      }
    } else {
      parts.push('Saved papers & arXiv watchers: no matching saved papers found.');
    }
  }

  parts.push('=== UNCONFIRMED GAPS & FAILURES REPORTED BY SCOUTS ===');
  if (gaps.length) {
    for (const gap of gaps) parts.push(`- ${gap}`);
  } else {
    parts.push('- None reported automatically; verify whether anything asked in the question lacked primary evidence.');
  }

  return parts.join('\n\n').slice(0, MAX_DOSSIER_CHARS);
}

export async function runInvestigate({
  question,
  root = '',
  runCodeScout = null,
  runWebScout = null,
  searchNotes = null,
  listPapers = null,
  runLead,
  formatNotesContext = null,
  linkCitations = null,
  withNoteSources = null,
  onEvent = () => {},
  onText = () => {},
  signal,
} = {}) {
  const cleanQuestion = String(question || '').trim();
  if (!cleanQuestion) {
    throw new Error('Ask a question after /investigate, such as “/investigate how does attention scale cleanly?”.');
  }
  if (typeof runLead !== 'function') {
    throw new Error('Lead synthesizer is required for /investigate.');
  }

  const activity = [];
  const rowById = new Map();
  let seq = 0;
  const upsertRow = (partial) => {
    const id = String(partial.id || `investigate-${++seq}`);
    const existing = rowById.get(id);
    const row = existing
      ? { ...existing, ...partial, id }
      : { id, tool: partial.tool || 'scout', status: partial.status || 'running', summary: partial.summary || '', ...(partial.detail ? { detail: partial.detail } : {}), ...(partial.output ? { output: partial.output } : {}) };
    if (!existing) {
      rowById.set(id, row);
      activity.push(row);
    } else {
      Object.assign(existing, row);
    }
    onEvent({ type: 'step', row: { ...row } });
    return row;
  };

  const gaps = [];
  const scouts = { code: null, web: null, notesPapers: null };

  onEvent({ type: 'status', text: 'Scouting project code, web & notes in parallel…' });

  // 1. Project code scout
  const codeTask = (async () => {
    const started = Date.now();
    if (!root || typeof runCodeScout !== 'function') {
      const reason = !root ? 'No project folder open in this chat; open a work session to inspect code too.' : 'Code scout unavailable.';
      gaps.push(`Project code search skipped: ${reason}`);
      scouts.code = { status: 'skipped', reason, ms: Date.now() - started };
      return;
    }
    const row = upsertRow({ id: 'investigate-code-scout', tool: 'scout', status: 'running', summary: 'Code scout: searching project files' });
    try {
      const out = await runCodeScout({
        question: cleanQuestion,
        root,
        signal,
        onEvent: event => { if (event?.type === 'step' && event.row?.summary) upsertRow({ id: row.id, detail: String(event.row.summary).slice(0, 120) }); },
      });
      const summary = String(typeof out === 'string' ? out : out?.summary || out?.text || '').trim();
      if (!summary) gaps.push('Code scout completed without specific project findings.');
      upsertRow({ id: row.id, status: 'done', detail: summary ? 'Finished' : 'No matches', output: summary.slice(0, 1200) });
      scouts.code = { status: 'done', summary, ms: Date.now() - started };
    } catch (error) {
      const msg = error?.message || 'Code scout failed';
      upsertRow({ id: row.id, status: 'failed', output: msg });
      gaps.push(`Project code scout failed: ${msg}`);
      scouts.code = { status: 'failed', error: msg, ms: Date.now() - started };
    }
  })();

  // 2. Web scout
  const webTask = (async () => {
    const started = Date.now();
    if (typeof runWebScout !== 'function') {
      const reason = 'Web scout unavailable.';
      gaps.push(`Web search skipped: ${reason}`);
      scouts.web = { status: 'skipped', reason, ms: Date.now() - started };
      return;
    }
    try {
      const out = await runWebScout({
        question: cleanQuestion,
        signal,
        onRow: row => upsertRow(row),
      });
      if (Array.isArray(out?.gaps) && out.gaps.length) gaps.push(...out.gaps);
      scouts.web = {
        status: 'done',
        results: Array.isArray(out?.results) ? out.results : [],
        pages: Array.isArray(out?.pages) ? out.pages : [],
        searchText: String(out?.searchText || ''),
        ms: Date.now() - started,
      };
    } catch (error) {
      const msg = error?.message || 'Web scout failed';
      gaps.push(`Web scout failed: ${msg}`);
      scouts.web = { status: 'failed', error: msg, ms: Date.now() - started };
    }
  })();

  // 3. Personal notes & papers scout
  let rawNoteResult = null;
  const notesTask = (async () => {
    const started = Date.now();
    if (typeof searchNotes !== 'function' && typeof listPapers !== 'function') {
      const reason = 'Notes and paper indexes unavailable.';
      gaps.push(`Personal notes & papers search skipped: ${reason}`);
      scouts.notesPapers = { status: 'skipped', reason, notes: [], papers: [], ms: Date.now() - started };
      return;
    }
    const row = upsertRow({ id: 'investigate-notes-scout', tool: 'scout', status: 'running', summary: 'Notes & papers scout' });
    try {
      const [notesSettled, papersSettled] = await Promise.allSettled([
        typeof searchNotes === 'function' ? searchNotes(cleanQuestion, { signal }) : Promise.resolve({ hits: [], status: 'unavailable' }),
        typeof listPapers === 'function' ? listPapers(cleanQuestion, { signal }) : Promise.resolve({ literatureItems: [], watcherPapers: [] }),
      ]);
      if (notesSettled.status === 'fulfilled') {
        rawNoteResult = notesSettled.value || { hits: [] };
      } else {
        gaps.push(`Personal notes lookup failed: ${notesSettled.reason?.message || 'error'}`);
      }
      const paperData = papersSettled.status === 'fulfilled'
        ? (papersSettled.value || {})
        : (() => { gaps.push(`Saved papers lookup failed: ${papersSettled.reason?.message || 'error'}`); return {}; })();

      const evidence = collectPaperEvidence({
        question: cleanQuestion,
        notesHits: rawNoteResult?.hits || [],
        literatureItems: paperData.literatureItems || [],
        watcherPapers: paperData.watcherPapers || [],
      });
      const rawNotesContext = typeof formatNotesContext === 'function' && rawNoteResult?.hits?.length
        ? formatNotesContext(rawNoteResult)
        : '';
      const detail = `${evidence.notes.length} ${evidence.notes.length === 1 ? 'note' : 'notes'}, ${evidence.papers.length} ${evidence.papers.length === 1 ? 'paper' : 'papers'}`;
      upsertRow({ id: row.id, status: 'done', detail, output: `Matched ${detail}` });
      scouts.notesPapers = { status: 'done', ...evidence, rawNotesContext, ms: Date.now() - started };
    } catch (error) {
      const msg = error?.message || 'Notes & papers scout failed';
      upsertRow({ id: row.id, status: 'failed', output: msg });
      gaps.push(`Notes & papers scout failed: ${msg}`);
      scouts.notesPapers = { status: 'failed', error: msg, notes: [], papers: [], ms: Date.now() - started };
    }
  })();

  await Promise.allSettled([codeTask, webTask, notesTask]);
  signal?.throwIfAborted();

  onEvent({ type: 'status', text: 'Synthesizing cited answer…' });
  const dossier = buildInvestigateDossier({
    question: cleanQuestion,
    code: scouts.code,
    web: scouts.web,
    notesPapers: scouts.notesPapers,
    gaps,
  });

  const leadRow = upsertRow({ id: 'investigate-lead', tool: 'scout', status: 'running', summary: 'Lead synthesis' });
  const leadPrompt = `Synthesize an evidence-based investigation report answering the question below.\n\n${dossier}`;
  let replyText = '';
  try {
    const leadOut = await runLead({
      instructions: INVESTIGATE_LEAD_INSTRUCTIONS,
      prompt: leadPrompt,
      question: cleanQuestion,
      dossier,
      tools: [],
      signal,
      onText,
    });
    replyText = String(typeof leadOut === 'string' ? leadOut : leadOut?.text || '').trim();
    upsertRow({ id: leadRow.id, status: 'done', detail: 'Synthesized' });
  } catch (error) {
    upsertRow({ id: leadRow.id, status: 'failed', output: error?.message || 'Synthesis failed' });
    throw error;
  }

  if (root && typeof linkCitations === 'function' && replyText) {
    replyText = await linkCitations(replyText, { root }).catch(() => replyText);
  }
  if (rawNoteResult?.hits?.length && typeof withNoteSources === 'function' && replyText) {
    replyText = withNoteSources(replyText, rawNoteResult, { asked: true });
  }

  return {
    question: cleanQuestion,
    text: replyText,
    activity,
    scouts,
    gaps,
    dossier,
  };
}
