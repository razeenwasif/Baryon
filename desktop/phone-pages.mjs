import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CLAUDE_MODELS } from '../src/model-menu.js';
import { buildDailySeries, filterUsageEvents, groupByModel, groupByProvider, summarizeUsage } from '../src/usage-logic.js';
import { hasFeature, optionalImport } from './edition.mjs';

const researchReportMod = hasFeature('research') ? await optionalImport('./research/report.mjs', import.meta.url) : null;
const researchHomeMod = hasFeature('research') ? await optionalImport('./research/home.mjs', import.meta.url) : null;
const readInvestigation = researchReportMod?.readInvestigation || (async () => null);
const summariseInvestigation = researchHomeMod?.summarise || (async () => null);

// What a phone may read of pages and memory: just enough to show them, with nothing that could change them.
const MAX_PAGES = 200;
const REMOTE_SCRIPT = /<script\b[^>]*\bsrc\s*=\s*["']?(?:https?:)?\/\//i;
export const WORK_PROVIDERS = { claude: 'Claude', codex: 'Codex', antigravity: 'Antigravity' };

export function phonePages(state) {
  return state.items.flatMap(({ id, kind, title, description, updatedAt, session, versions }) => {
    const usable = versions.filter(version => version.file);
    if (!usable.length) return [];
    return [{ id, kind, title, description, updatedAt, session: session || null,
      // A dashboard asks the Mac's window for your calendar or mail, which a phone can't answer.
      opens: kind !== 'dashboard',
      versions: usable.map(({ seq, at, file, concepts }) => ({ seq, at, file, concepts: concepts?.map(concept => ({ name: concept.name, file: concept.file })) ?? [] })) }];
  }).slice(0, MAX_PAGES);
}

// One of a page's own files. The store checks the path stays inside that version, and the policy lets it reach nothing else.
export async function phonePageFile(store, { id, seq, path, range }) {
  const refuse = (status, words) => { throw Object.assign(new Error(words), { status }); };
  if (!id || !seq || !path) refuse(400, 'Not understood.');
  const item = store.state().items.find(entry => entry.id === id);
  if (!item) refuse(404, 'That page is no longer here.');
  if (item.kind === 'dashboard') refuse(409, 'This dashboard reads from your Mac, so it opens there.');
  const pathname = `/${[id, seq, ...path.split('/')].map(encodeURIComponent).join('/')}`;
  const { status, headers, body } = await store.serve(pathname, range, { offline: true });
  if (status === 404) refuse(404, 'That page’s file is no longer on this Mac.');
  const sent = { 'Content-Type': headers['content-type'], 'Content-Security-Policy': headers['content-security-policy'] ?? "default-src 'none'" };
  for (const [from, to] of [['accept-ranges', 'Accept-Ranges'], ['content-range', 'Content-Range'], ['content-length', 'Content-Length']]) if (headers[from]) sent[to] = headers[from];
  // So the app can say a page will look different, instead of leaving you to wonder why it's broken.
  if (typeof body === 'string' && REMOTE_SCRIPT.test(body)) sent['X-Fairy-Needs-Internet'] = '1';
  return { status, headers: sent, body };
}

export function phoneMemory({ items, used, lastReflection }, reflectionMode) {
  const usedNow = new Set(used), changes = lastReflection?.changes ?? [];
  return {
    notes: items.map(({ id, kind, text, source }) => ({ id, kind, text, fromReflection: source === 'reflection', used: usedNow.has(id) })),
    reflection: { on: reflectionMode === 'on', at: lastReflection?.at ?? null, undone: lastReflection?.undone === true,
      added: changes.filter(change => change.action === 'added').length, changed: changes.filter(change => change.action !== 'added').length },
  };
}

export function phoneAbout({ pages, memory, schedules, workProvider, checkIns = null, providers = null }) {
  return {
    pages: phonePages(pages).length,
    notes: memory.items.length,
    routines: schedules.filter(schedule => schedule.enabled).length,
    workProvider: WORK_PROVIDERS[workProvider] ?? WORK_PROVIDERS.claude,
    ...(checkIns || providers ? { appName: 'Baryon' } : {}),
    ...(checkIns ? {
      brief: {
        enabled: checkIns.brief?.enabled === true,
        time: checkIns.brief?.time || '07:30',
        lastBrief: checkIns.lastBrief || '',
        lastError: checkIns.lastBriefError || null,
      },
      checkIns: {
        enabled: checkIns.checkIns?.enabled === true,
        everyHours: Number(checkIns.checkIns?.everyHours) || 3,
        lastCheck: checkIns.lastCheck || '',
        lastError: checkIns.lastCheckError || null,
      },
    } : {}),
    ...(providers ? { providers } : {}),
  };
}

export function phoneUsageReport({ generatedAt = '', events = [], plans = {}, now = new Date() } = {}) {
  const recent30 = filterUsageEvents(events, { range: '30d', now });
  const recent24 = filterUsageEvents(events, { range: '24h', now });
  const summary30 = summarizeUsage(recent30);
  const summary24 = summarizeUsage(recent24);
  const byProvider = groupByProvider(recent30).slice(0, 8);
  const byModel = groupByModel(recent30).slice(0, 12);
  const tokenSeries = buildDailySeries(recent30, { range: '30d', metric: 'tokens', groupBy: 'split', now });
  const costSeries = buildDailySeries(recent30, { range: '30d', metric: 'cost', groupBy: 'split', now });
  const costByDay = new Map((costSeries.days || []).map(d => [d.day, Number(d.total) || 0]));
  const daily = (tokenSeries.days || []).slice(-14).map(d => ({
    day: d.day,
    label: d.label,
    tokens: Number(d.total) || 0,
    cost: costByDay.get(d.day) ?? 0,
  }));
  return {
    generatedAt: generatedAt || now.toISOString(),
    summary30,
    summary24,
    byProvider,
    byModel,
    daily,
    plans,
  };
}

export function phoneModelsCatalog({ settings = {}, connected = {}, geminiModels = [], codexModels = [], deepseekModels = [] } = {}) {
  const currentProvider = settings.backend || 'deepseek';
  const currentModel = currentProvider === 'claude' ? (settings.claudeModel || '') : currentProvider === 'antigravity' ? (settings.antigravityModel || '') : (settings.model || '');
  const currentEffort = currentProvider === 'claude' ? (settings.claudeEffort || '') : (settings.reasoning || '');
  const listGemini = Array.isArray(geminiModels) && geminiModels.length ? geminiModels : ['gemini-3.8-flash', 'gemini-3.8-pro', 'gemini-4-neon-medium', 'gemini-4-carbon-high'].map(id => ({ id, name: id }));
  const listCodex = Array.isArray(codexModels) && codexModels.length ? codexModels.map(m => ({ id: typeof m === 'string' ? m : m.id, name: typeof m === 'string' ? m : (m.name || m.id) })) : [{ id: 'gpt-6-astra', name: 'GPT-6 Astra' }, { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol' }, { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna' }];
  const listDeepseek = Array.isArray(deepseekModels) && deepseekModels.length ? deepseekModels.map(m => ({ id: typeof m === 'string' ? m : m.id, name: typeof m === 'string' ? m : (m.name || m.id) })) : [{ id: 'deepseek-flash', name: 'DeepSeek Flash' }, { id: 'deepseek-chat', name: 'DeepSeek Chat' }, { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' }];
  const providers = [
    { id: 'claude', name: 'Claude', connected: Boolean(connected.claude), models: CLAUDE_MODELS, efforts: ['', 'low', 'medium', 'high', 'xhigh', 'max'] },
    { id: 'antigravity', name: 'Gemini', connected: Boolean(connected.antigravity), models: listGemini.slice(0, 20), efforts: ['low', 'medium', 'high'] },
    { id: 'codex', name: 'Codex', connected: Boolean(connected.codex), models: listCodex.slice(0, 16), efforts: ['low', 'medium', 'high'] },
    { id: 'deepseek', name: 'DeepSeek', connected: Boolean(connected.deepseek), models: listDeepseek.slice(0, 12), efforts: ['low', 'medium', 'high'] },
  ];
  return { current: { provider: currentProvider, model: currentModel, effort: currentEffort }, providers };
}

export async function phoneResearchDetail(folder, slug) {
  const dir = join(folder, slug);
  const [summary, inv] = await Promise.all([
    summariseInvestigation(dir, slug).catch(() => null),
    readInvestigation(dir).catch(() => null),
  ]);
  if (!summary && !inv) throw Object.assign(new Error('That investigation was not found.'), { status: 404 });
  let report = '';
  try { report = (await readFile(join(dir, 'REPORT.md'), 'utf8')).slice(0, 32000); } catch {}
  return {
    slug,
    title: summary?.title || inv?.investigation?.title || slug,
    discipline: summary?.discipline || inv?.investigation?.discipline || '',
    rounds: summary?.rounds ?? (inv?.rounds?.length || 0),
    round: summary?.round || null,
    waiting: summary?.waiting || [],
    hypotheses: (inv?.hypotheses || []).slice(0, 24).map(h => ({
      id: h.id, title: h.title, status: h.status, elo: h.elo, wins: h.wins, losses: h.losses, statement: String(h.statement || '').slice(0, 400),
    })),
    papers: Object.values(inv?.papers || {}).slice(0, 20),
    runs: summary?.runs || [],
    report,
  };
}

export function phoneBoardDetail({ meta, document }) {
  const entries = Object.values(document?.elements || {}).slice(0, 250).map(el => ({
    id: String(el.id || ''),
    type: String(el.type || 'rect'),
    x: Number(el.x) || 0,
    y: Number(el.y) || 0,
    w: Number(el.w ?? el.width) || 180,
    h: Number(el.h ?? el.height) || 90,
    title: String(el.title || el.label || '').slice(0, 120),
    text: String(el.text || el.content || '').slice(0, 800),
    color: String(el.color || el.fill || ''),
    from: typeof el.from === 'string' ? el.from : typeof el.fromId === 'string' ? el.fromId : '',
    to: typeof el.to === 'string' ? el.to : typeof el.toId === 'string' ? el.toId : '',
  }));
  return { meta, background: document?.background || 'dots', elements: entries };
}
