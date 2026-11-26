import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

// Providers report tokens differently, and not all of them do. Absent means not measured, not zero.
export function tokenCounts(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const number = (...keys) => { for (const key of keys) { const value = Number(raw[key]); if (Number.isFinite(value) && value > 0) return value; } return 0; };
  const cached = number('cache_read_input_tokens', 'cachedInputTokens', 'cached_input_tokens', 'cachedContentTokenCount');
  const input = number('input_tokens', 'inputTokens', 'promptTokenCount') + number('cache_creation_input_tokens') + (raw.cache_read_input_tokens ? cached : 0);
  const output = number('output_tokens', 'outputTokens', 'candidatesTokenCount');
  return input || output ? { input, output, cached } : null;
}

// Public API-equivalent USD per 1M tokens for estimating scale across subscription and API providers.
export const MODEL_RATES = Object.freeze({
  'claude-opus-5-5': { input: 15, output: 75, cacheRead: 1.5 },
  'claude-opus-4': { input: 15, output: 75, cacheRead: 1.5 },
  'claude-fable': { input: 15, output: 75, cacheRead: 1.5 },
  'claude-sonnet': { input: 3, output: 15, cacheRead: 0.3 },
  'claude-haiku': { input: 0.8, output: 4, cacheRead: 0.08 },
  'gemini-4-carbon': { input: 2.5, output: 15, cacheRead: 0.25 },
  'gemini-4-neon': { input: 1.25, output: 10, cacheRead: 0.125 },
  'gemini-4-argon': { input: 1.25, output: 5, cacheRead: 0.125 },
  'gemini-4-hydrogen': { input: 0.15, output: 0.6, cacheRead: 0.015 },
  'gemini-3.8-pro': { input: 1.25, output: 10, cacheRead: 0.125 },
  'gemini-3.8-flash': { input: 0.1, output: 0.4, cacheRead: 0.01 },
  'gemini-2.5-pro': { input: 1.25, output: 10, cacheRead: 0.31 },
  'gemini-2.5-flash': { input: 0.15, output: 0.6, cacheRead: 0.0375 },
  'gpt-6.1-sol': { input: 5, output: 20, cacheRead: 1.25 },
  'gpt-6-astra': { input: 2.5, output: 10, cacheRead: 0.625 },
  'gpt-5.6-luna': { input: 1.5, output: 6, cacheRead: 0.375 },
  'o4-mini': { input: 1.1, output: 4.4, cacheRead: 0.275 },
  'o3': { input: 2, output: 8, cacheRead: 0.5 },
  'deepseek-reasoner': { input: 0.55, output: 2.19, cacheRead: 0.14 },
  'deepseek-chat': { input: 0.27, output: 1.1, cacheRead: 0.07 },
  claude: { input: 3, output: 15, cacheRead: 0.3 },
  gemini: { input: 0.5, output: 2.5, cacheRead: 0.05 },
  codex: { input: 2.5, output: 10, cacheRead: 0.625 },
  deepseek: { input: 0.27, output: 1.1, cacheRead: 0.07 },
  other: { input: 2, output: 8, cacheRead: 0.2 },
});

/** Normalize provider names and infer a model's provider family. */
export function inferProvider(model = '', fallback = '') {
  const m = String(model || '').toLowerCase();
  if (m.includes('claude') || m.includes('opus') || m.includes('sonnet') || m.includes('haiku') || m.includes('fable')) return 'claude';
  if (m.includes('gemini') || m.includes('antigravity') || m.includes('carbon') || m.includes('neon') || m.includes('argon') || m.includes('hydrogen')) return 'gemini';
  if (m.includes('gpt') || m.includes('codex') || /\bo[1-9]\b/.test(m) || m.includes('sol') || m.includes('luna') || m.includes('astra')) return 'codex';
  if (m.includes('deepseek')) return 'deepseek';
  const f = String(fallback || '').toLowerCase().trim();
  if (f === 'antigravity' || f === 'google' || f === 'gemini') return 'gemini';
  if (f === 'openai' || f === 'codex') return 'codex';
  if (f === 'claude' || f === 'anthropic') return 'claude';
  if (f === 'deepseek') return 'deepseek';
  return 'other';
}

function rateFor(model = '', provider = '') {
  const m = String(model || '').toLowerCase();
  for (const [key, rates] of Object.entries(MODEL_RATES)) {
    if (key.includes('-') && m.includes(key)) return rates;
  }
  return MODEL_RATES[inferProvider(m, provider)] || MODEL_RATES.other;
}

/** Estimate public API-equivalent USD cost and cache savings for one turn. */
export function estimateCost(model = '', { input = 0, output = 0, cached = 0 } = {}, provider = '') {
  const rates = rateFor(model, provider);
  const cleanIn = Math.max(0, Number(input) || 0);
  const cleanOut = Math.max(0, Number(output) || 0);
  const cleanCached = Math.max(0, Number(cached) || 0);
  const freshIn = Math.max(0, cleanIn - cleanCached);
  const cost = (freshIn * rates.input + cleanCached * rates.cacheRead + cleanOut * rates.output) / 1_000_000;
  const cacheSaved = (cleanCached * Math.max(0, rates.input - rates.cacheRead)) / 1_000_000;
  return { cost, cacheSaved };
}

function normalizeUsage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.input !== undefined || raw.output !== undefined) {
    const input = Math.max(0, Number(raw.input) || 0);
    const output = Math.max(0, Number(raw.output) || 0);
    const cached = Math.max(0, Number(raw.cached) || 0);
    return input || output ? { input, output, cached } : null;
  }
  if (raw.prompt_tokens !== undefined || raw.completion_tokens !== undefined) {
    const input = Math.max(0, Number(raw.prompt_tokens) || 0);
    const output = Math.max(0, Number(raw.completion_tokens) || 0);
    const cached = Math.max(0, Number(raw.prompt_cache_hit_tokens ?? raw.prompt_tokens_details?.cached_tokens) || 0);
    return input || output ? { input, output, cached } : null;
  }
  return tokenCounts(raw);
}

async function readJsonSafe(path, fallback = null) {
  if (!path) return fallback;
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { return fallback; }
}

async function readJsonLines(path) {
  if (!path) return [];
  let text = '';
  try { text = await readFile(path, 'utf8'); }
  catch { return []; }
  const rows = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { rows.push(JSON.parse(trimmed)); } catch {}
  }
  return rows;
}

const minuteOf = iso => (typeof iso === 'string' && iso.length >= 16 ? iso.slice(0, 16) : '');

/** Aggregate per-turn token counts and estimated costs across sessions, token-ledger, and routing logs. */
export async function collectTokenUsage({ sessionsDir, index = null, ledgerPath = '', routingPath = '', plans = {}, now = new Date() } = {}) {
  const indexData = index || (sessionsDir ? await readJsonSafe(join(sessionsDir, 'index.json'), {}) : {});
  const sessionMeta = new Map();
  for (const s of Array.isArray(indexData?.sessions) ? indexData.sessions : []) {
    if (!s?.id) continue;
    const project = typeof s.work === 'string'
      ? s.work
      : (s.work?.folder ? basename(String(s.work.folder)) : (s.workPath ? basename(String(s.workPath)) : ''));
    const defaultProvider = inferProvider('', (typeof s.work === 'object' ? s.work?.provider : '') || s.provider || '');
    sessionMeta.set(s.id, { title: s.title || 'Untitled chat', project, defaultProvider });
  }

  const [ledgerRows, routingRows, files] = await Promise.all([
    readJsonLines(ledgerPath),
    readJsonLines(routingPath),
    sessionsDir ? readdir(sessionsDir).catch(() => []) : Promise.resolve([]),
  ]);

  const hints = new Map();
  for (const row of routingRows) {
    const sid = String(row?.chat || ''), mk = minuteOf(row?.at);
    if (sid && mk && (row.model || row.provider)) hints.set(`${sid}:${mk}`, { model: row.model || '', provider: row.provider || '' });
  }
  for (const row of ledgerRows) {
    const sid = String(row?.session || ''), mk = minuteOf(row?.at);
    if (sid && mk && (row.model || row.provider) && !hints.has(`${sid}:${mk}`)) {
      hints.set(`${sid}:${mk}`, { model: row.model || '', provider: row.provider || '' });
    }
  }

  const events = [];
  const seen = new Set();

  for (const file of files) {
    if (!file.endsWith('.json') || file === 'index.json') continue;
    const sid = file.slice(0, -5);
    const messages = await readJsonSafe(join(sessionsDir, file), null);
    if (!Array.isArray(messages)) continue;
    const meta = sessionMeta.get(sid) || { title: 'Chat', project: '', defaultProvider: 'other' };
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (!msg || msg.role !== 'assistant' || !msg.usage) continue;
      const norm = normalizeUsage(msg.usage);
      if (!norm) continue;
      const at = msg.at || msg.replyTo || '';
      if (!at) continue;
      const mk = minuteOf(at);
      const hint = mk ? hints.get(`${sid}:${mk}`) : null;
      const model = msg.auto?.model || msg.seat?.model || msg.model || hint?.model || '';
      const provider = inferProvider(model, msg.seat?.provider || msg.auto?.provider || hint?.provider || meta.defaultProvider);
      if (mk) seen.add(`${sid}:${mk}`);
      const { cost, cacheSaved } = estimateCost(model, norm, provider);
      events.push({
        id: `s:${sid}:${i}`,
        at,
        sessionId: sid,
        title: meta.title,
        project: meta.project || (msg.mode === 'work' ? 'Work' : 'Chat'),
        provider,
        model: model || provider,
        mode: msg.mode || 'chat',
        input: norm.input,
        output: norm.output,
        cached: norm.cached,
        total: norm.input + norm.output,
        cost,
        cacheSaved,
      });
    }
  }

  for (let i = 0; i < ledgerRows.length; i++) {
    const row = ledgerRows[i];
    if (!row?.at) continue;
    const sid = String(row.session || '');
    const mk = minuteOf(row.at);
    if (sid && mk && seen.has(`${sid}:${mk}`)) continue;
    const norm = normalizeUsage(row.usage) || (() => {
      const input = Math.max(0, Number(row.sent) || 0);
      const output = Math.max(0, Number(row.parts?.reply) || 0);
      return input || output ? { input, output, cached: 0 } : null;
    })();
    if (!norm) continue;
    if (sid && mk) seen.add(`${sid}:${mk}`);
    const model = String(row.model || '');
    const provider = inferProvider(model, row.provider || '');
    const meta = sid ? sessionMeta.get(sid) : null;
    const role = String(row.role || '');
    const title = meta?.title || (role ? role.replace(':', ' · ') : 'Background turn');
    const project = meta?.project || (role.startsWith('research:') ? 'Research' : 'Background');
    const { cost, cacheSaved } = estimateCost(model, norm, provider);
    events.push({
      id: `l:${i}`,
      at: row.at,
      sessionId: sid,
      title,
      project,
      provider,
      model: model || provider,
      mode: role.startsWith('research:') ? 'research' : 'work',
      input: norm.input,
      output: norm.output,
      cached: norm.cached,
      total: norm.input + norm.output,
      cost,
      cacheSaved,
    });
  }

  for (let i = 0; i < routingRows.length; i++) {
    const row = routingRows[i];
    if (!row?.at || !row.tokens) continue;
    const sid = String(row.chat || '');
    const mk = minuteOf(row.at);
    if (sid && mk && seen.has(`${sid}:${mk}`)) continue;
    const norm = normalizeUsage(row.tokens);
    if (!norm) continue;
    if (sid && mk) seen.add(`${sid}:${mk}`);
    const model = String(row.model || '');
    const provider = inferProvider(model, row.provider || '');
    const meta = sid ? sessionMeta.get(sid) : null;
    const { cost, cacheSaved } = estimateCost(model, norm, provider);
    events.push({
      id: `r:${i}`,
      at: row.at,
      sessionId: sid,
      title: meta?.title || 'Work turn',
      project: meta?.project || 'Work',
      provider,
      model: model || provider,
      mode: 'work',
      input: norm.input,
      output: norm.output,
      cached: norm.cached,
      total: norm.input + norm.output,
      cost,
      cacheSaved,
    });
  }

  events.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  return {
    generatedAt: now.toISOString(),
    events: events.slice(-5000),
    plans,
  };
}
