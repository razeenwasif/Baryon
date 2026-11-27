// Standalone headless Fairy runtime for the CLI.
// Runs purely under Node 22 with zero Electron dependencies, reading/writing Fairy's
// `<dataDir>` stores directly so headless sessions appear in Fairy's desktop sidebar.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { AntigravityConnection, defaultOpenTerminal } from '../antigravity.mjs';
import { providerName } from '../audiopulse-link.mjs';
import { ClaudeConnection } from '../claude.mjs';
import { CodexConnection } from '../codex.mjs';
import { DEFAULTS, cleanSettings, readJSON, writeJSON } from '../core.mjs';
import { createFairyMcpHandler } from '../fairy-mcp.mjs';
import { GoalStore } from '../goals.mjs';
import { JOURNAL_DIR, LabJournal, journalNote } from '../lab-journal.mjs';
import { LongTermMemory } from '../long-term-memory.mjs';
import { ConnectorStore } from '../mcp-client.mjs';
import { GOOGLE_SSO_PLUGINS, quickConnectPlugins } from '../plugin-quick-connect.mjs';
import { MEMORY_DIR, ProjectMemory, memoryNote } from '../project-memory.mjs';
import { PromiseBook } from '../promises.mjs';
import { SessionStore } from '../sessions.mjs';
import { collectTokenUsage } from '../token-usage.mjs';
import { runWork } from '../work-agent.mjs';
import { checkWorkFolder, runInSandbox, runOutsideSandbox, sandboxWorks } from '../work-sandbox.mjs';
import { WorkTools } from '../work-tools.mjs';
import { CLAUDE_MODELS, modelChange } from '../../src/model-menu.js';
import { defaultDataDir } from './paths.mjs';
import { formatApprovalBox } from './render.mjs';
import { useColor } from './sprite.mjs';

const normalizeBackend = value => {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'gemini') return 'antigravity';
  if (raw === 'chatgpt') return 'codex';
  return raw;
};

const modelOf = settings => ({
  claude: settings.claudeModel,
  antigravity: settings.antigravityModel,
  codex: settings.model,
})[settings.backend] || settings.model || '';

async function readSafeAccountSnapshot(filePath) {
  try {
    const raw = JSON.parse(await readFile(filePath, 'utf8'));
    const sealed = typeof raw === 'string' || typeof raw?.sealed === 'string';
    return {
      configured: Boolean(raw?.client || raw?.clientId || sealed),
      connected: Boolean(raw?.tokens?.refreshToken || raw?.refreshToken || sealed),
      email: typeof raw?.profile?.email === 'string' ? raw.profile.email : typeof raw?.email === 'string' ? raw.email : '',
      headlessSealed: sealed,
    };
  } catch {
    return { configured: false, connected: false, email: '', headlessSealed: false };
  }
}

function defaultApprovePrompt({ stdin, stderr, autoApprove, color }) {
  return async req => {
    const detail = req.command || req.detail || '';
    if (!stdin || stdin.isTTY !== true) {
      return autoApprove ? 'allow' : 'deny';
    }
    stderr?.write?.(`\n${formatApprovalBox({ title: req.title || 'Baryon needs your OK', detail, interactive: true, color })}\n`);
    const rl = createInterface({ input: stdin, output: stderr });
    try {
      const answer = String(await rl.question('  Choice [y/a/N]: ')).trim().toLowerCase();
      if (answer === 'a' || answer === 'always') {
        return req.kind === 'outside' ? 'allow' : 'always';
      }
      if (answer === 'y' || answer === 'yes' || answer === 'allow') {
        return 'allow';
      }
      return 'deny';
    } catch {
      return 'deny';
    } finally {
      rl.close();
    }
  };
}

/**
 * Creates a standalone headless backend operating directly against `dataDir`.
 */
export function createHeadlessBackend({
  dataDir = defaultDataDir(),
  env = process.env,
  stdin = process.stdin,
  stderr = process.stderr,
  providerOverride = '',
  modelOverride = '',
  autoApprove = false,
  providers = null,
  promptApproval = null,
  sandboxProbe = sandboxWorks,
} = {}) {
  const file = name => join(dataDir, name);
  const color = useColor(stderr, env);

  let loaded = false;
  let loadPromise = null;
  let settings = { ...DEFAULTS };
  let sessions = null;
  let longTermMemory = null;
  let projectMemory = null;
  let labJournal = null;
  let goalStore = null;
  let promiseBook = null;
  let connectors = null;
  let mcpHelper = null;
  let sandboxedCache = null;

  const conns = { claude: null, codex: null, antigravity: null };
  const activeControllers = new Map();
  const sessionAllowed = new Map();

  function getProviderInstance(backend) {
    if (providers && Object.hasOwn(providers, backend) && providers[backend]) {
      return providers[backend];
    }
    if (backend === 'claude') {
      conns.claude ??= new ClaudeConnection({ cwd: file('claude') });
      return conns.claude;
    }
    if (backend === 'codex') {
      conns.codex ??= new CodexConnection({ cwd: file('codex') });
      return conns.codex;
    }
    if (backend === 'antigravity') {
      conns.antigravity ??= new AntigravityConnection({
        cwd: file('antigravity'),
        warmAfterTurn: false,
        openTerminal: defaultOpenTerminal,
      });
      return conns.antigravity;
    }
    throw new Error(`Provider "${backend}" is not supported in standalone headless mode. Run with Baryon desktop app open or choose claude, codex, or gemini.`);
  }

  function workProviderConfig(kindOverride = '', explicitModel = '') {
    const backend = normalizeBackend(kindOverride || providerOverride || settings.workProvider || 'claude');
    const effort = settings.workEffort || 'high';
    const reasoning = ['low', 'medium', 'high'].includes(effort) ? effort : 'high';
    const pickedModel = explicitModel || modelOverride || '';
    let usedSettings;
    if (backend === 'antigravity') {
      usedSettings = { ...settings, backend: 'antigravity', antigravityModel: pickedModel || settings.workGeminiModel || settings.antigravityModel, reasoning };
    } else if (backend === 'codex') {
      usedSettings = { ...settings, backend: 'codex', model: pickedModel || settings.workCodexModel || settings.desktopModel, reasoning };
    } else if (backend === 'claude') {
      usedSettings = { ...settings, backend: 'claude', claudeModel: pickedModel || settings.workClaudeModel, reasoning: effort };
    } else {
      throw new Error(`Unsupported headless work provider "${backend}". Use claude, codex, or gemini.`);
    }
    return { backend, provider: getProviderInstance(backend), settings: usedSettings };
  }

  function chatProviderConfig(kindOverride = '', explicitModel = '') {
    const backend = normalizeBackend(kindOverride || providerOverride || settings.backend || 'claude');
    const pickedModel = explicitModel || modelOverride || '';
    const usedSettings = { ...settings, backend };
    if (pickedModel) {
      if (backend === 'antigravity') usedSettings.antigravityModel = pickedModel;
      else if (backend === 'claude') usedSettings.claudeModel = pickedModel;
      else usedSettings.model = pickedModel;
    }
    return { backend, provider: getProviderInstance(backend), settings: usedSettings };
  }

  async function ensureLoaded() {
    if (loaded) return;
    if (!loadPromise) {
      loadPromise = (async () => {
        await mkdir(dataDir, { recursive: true, mode: 0o700 });
        try {
          const rawSettings = await readJSON(file('settings.json'), {});
          settings = cleanSettings(rawSettings, DEFAULTS);
        } catch {
          settings = { ...DEFAULTS };
        }
        sessions = new SessionStore({
          dir: file('sessions'),
          legacyDir: dataDir,
          readJSON,
          writeJSON,
          trash: async p => { await rm(p, { force: true }); },
        });
        await sessions.load();
        longTermMemory = new LongTermMemory({
          read: () => readJSON(file('long-term-memory.json'), null),
          write: v => writeJSON(file('long-term-memory.json'), v),
        });
        await longTermMemory.load();
        projectMemory = new ProjectMemory({ dir: file(MEMORY_DIR) });
        labJournal = new LabJournal({ dir: file(JOURNAL_DIR) });
        goalStore = new GoalStore({
          path: file('goals.json'),
          checkFolder: folder => checkWorkFolder(folder, { dataDir }),
        });
        promiseBook = new PromiseBook({
          read: () => readJSON(file('promises.json'), null),
          write: v => writeJSON(file('promises.json'), v),
        });
        await promiseBook.load();
        connectors = new ConnectorStore({
          read: () => readJSON(file('connectors.json'), null),
          write: v => writeJSON(file('connectors.json'), v),
        });
        await connectors.load();
        mcpHelper = createFairyMcpHandler({ dataDir });
        loaded = true;
      })();
    }
    await loadPromise;
  }

  async function safeAccount(name) {
    try {
      const conn = getProviderInstance(name);
      if (typeof conn.account === 'function') {
        return await conn.account({ cached: true });
      }
    } catch {}
    return { connected: false };
  }

  async function hello() {
    await ensureLoaded();
    const wp = workProviderConfig();
    return {
      type: 'hello',
      name: settings.name || 'Fairy',
      provider: providerName(wp.settings) || wp.backend,
      model: modelOf(wp.settings),
      mode: 'headless',
      dataDir,
    };
  }

  async function rpc(method, params = {}) {
    await ensureLoaded();
    switch (method) {
      case 'status': {
        const wp = workProviderConfig();
        const ga = await readSafeAccountSnapshot(file('google-account.json'));
        return {
          ok: true,
          mode: 'headless',
          name: settings.name || 'Fairy',
          dataDir,
          workProvider: wp.backend,
          workModel: modelOf(wp.settings),
          workAutoModel: settings.workAutoModel,
          chatProvider: normalizeBackend(providerOverride || settings.backend),
          chatModel: modelOverride || modelOf({ ...settings, backend: normalizeBackend(providerOverride || settings.backend) }),
          autoModel: settings.autoModel,
          activeChat: sessions.active || null,
          googleAccount: ga,
        };
      }

      case 'models.list': {
        const quietly = fn => fn().catch(() => null);
        const [claudeAcc, agyAcc, codexAcc, codexModels] = await Promise.all([
          quietly(() => getProviderInstance('claude').account({ cached: true })),
          quietly(() => getProviderInstance('antigravity').account()),
          quietly(() => getProviderInstance('codex').account({ cached: true })),
          quietly(() => getProviderInstance('codex').models({ cached: true })),
        ]);
        const gemini = (agyAcc?.models || [])
          .filter(id => id.startsWith('gemini-'))
          .map(id => ({ id, name: agyAcc?.names?.[id] || id }));
        const wp = workProviderConfig();
        const cp = chatProviderConfig();
        return {
          claude: CLAUDE_MODELS,
          gemini,
          codex: codexModels || [],
          connected: {
            claude: Boolean(claudeAcc?.connected),
            gemini: Boolean(agyAcc?.connected),
            codex: Boolean(codexAcc?.connected),
          },
          current: {
            work: { provider: wp.backend, model: modelOf(wp.settings), auto: settings.workAutoModel === 'on', effort: settings.workEffort },
            chat: { provider: cp.backend, model: modelOf(cp.settings), auto: settings.autoModel === 'on', effort: cp.backend === 'claude' ? settings.claudeEffort : settings.reasoning },
          },
        };
      }

      case 'models.set': {
        const next = cleanSettings(modelChange({
          work: params.work === true,
          provider: params.provider,
          model: params.model,
          auto: params.auto,
          effort: params.effort,
        }), settings);
        await writeJSON(file('settings.json'), next);
        settings = next;
        return rpc('models.list');
      }

      case 'usage': {
        const data = await collectTokenUsage({
          sessionsDir: file('sessions'),
          index: sessions.state(),
          ledgerPath: file('token-ledger.jsonl'),
          routingPath: file('routing.jsonl'),
          plans: {},
        });
        const agyAcc = await safeAccount('antigravity');
        return { ...data, antigravity: agyAcc, mode: 'headless' };
      }

      case 'sessions.list': {
        const all = sessions.state().sessions;
        const folderFilter = typeof params.folder === 'string' && params.folder ? params.folder : '';
        const filtered = folderFilter ? all.filter(s => s.workPath === folderFilter) : all;
        const limit = Math.max(1, Math.min(200, Number(params.limit) || 40));
        return { active: sessions.active, sessions: filtered.slice(0, limit) };
      }

      case 'sessions.show': {
        const id = String(params.id || sessions.active || '');
        if (!id) throw new Error('Specify a session ID.');
        const session = sessions.find(id);
        const msgs = await sessions.read(id);
        const limit = Math.max(1, Math.min(200, Number(params.limit) || 40));
        return { session, messages: msgs.slice(-limit), totalMessages: msgs.length };
      }

      case 'sessions.search': {
        const q = String(params.query || '').trim();
        if (!q) throw new Error('Provide a search query.');
        return mcpHelper.callTool('fairy_recall_sessions', {
          query: q,
          ...(params.folder ? { folder: params.folder } : {}),
          limit: Number(params.limit) || 10,
        });
      }

      case 'sessions.rename': {
        await sessions.rename(String(params.id || ''), String(params.title || ''));
        return { session: sessions.find(String(params.id)) };
      }

      case 'sessions.fork': {
        const sourceId = String(params.id || sessions.active || '');
        if (!sourceId) throw new Error('Specify a session ID to fork.');
        const forkedId = await sessions.fork(sourceId);
        return { id: forkedId, session: sessions.find(forkedId) };
      }

      case 'sessions.compact':
        throw new Error('Session compaction runs inside the Baryon desktop app. Open Baryon or compact from desktop.');

      case 'recall': {
        const q = String(params.query || '').trim();
        if (!q) throw new Error('Provide a recall query.');
        const [sessRes, memRes] = await Promise.all([
          mcpHelper.callTool('fairy_recall_sessions', { query: q, ...(params.folder ? { folder: params.folder } : {}), limit: Number(params.limit) || 6 }),
          mcpHelper.callTool('fairy_memory_read', { kind: 'all', query: q }),
        ]);
        return { query: q, sessions: sessRes.hits || [], memory: memRes.items || [], rememberedFacts: memRes.rememberedFacts || [] };
      }

      case 'memory.list': {
        const lt = await mcpHelper.callTool('fairy_memory_read', { kind: params.kind || 'all', ...(params.query ? { query: params.query } : {}) });
        const proj = await mcpHelper.callTool('fairy_project_memory', params.folder ? { folder: params.folder } : {});
        return { ...lt, projectMemory: proj };
      }

      case 'memory.add': {
        await longTermMemory.add(params.kind || 'work', String(params.text || ''));
        return longTermMemory.state();
      }

      case 'memory.search':
        return mcpHelper.callTool('fairy_memory_read', { kind: params.kind || 'all', query: String(params.query || '') });

      case 'journal.list':
        return mcpHelper.callTool('fairy_lab_journal', {
          ...(params.folder ? { folder: params.folder } : {}),
          ...(params.query ? { query: params.query } : {}),
          ...(params.limit ? { limit: Number(params.limit) } : {}),
        });

      case 'journal.add': {
        const folder = String(params.folder || '');
        if (!folder) throw new Error('Specify a project folder with --folder.');
        return {
          folder,
          entries: await labJournal.add(folder, {
            title: String(params.title || 'CLI note'),
            tried: String(params.tried || ''),
            outcome: String(params.outcome || ''),
            decision: String(params.decision || ''),
            source: 'you',
            chat: String(params.chat || ''),
          }),
        };
      }

      case 'notes.search':
        return mcpHelper.callTool('fairy_notes_search', { query: String(params.query || ''), limit: Number(params.limit) || 8 });

      case 'notes.read':
        return mcpHelper.callTool('fairy_notes_read', {
          path: String(params.path || ''),
          ...(params.startLine ? { start_line: Number(params.startLine) } : {}),
          ...(params.maxLines ? { max_lines: Number(params.maxLines) } : {}),
        });

      case 'today': {
        const g = await goalStore.list();
        const ga = await readSafeAccountSnapshot(file('google-account.json'));
        return {
          now: new Date().toISOString(),
          mode: 'headless',
          calendar: { connected: ga.connected, events: null, error: ga.headlessSealed ? 'Live Calendar events require the Baryon desktop app (Keychain-sealed tokens).' : '' },
          email: { connected: ga.connected, unread: null, error: ga.headlessSealed ? 'Live Gmail counts require the Baryon desktop app.' : '' },
          promises: promiseBook.view().open || [],
          goals: (g?.goals || []).filter(item => item.state === 'active' || item.state === 'waiting-you'),
        };
      }

      case 'goals.list':
        return goalStore.list();

      case 'goals.add':
        return goalStore.add({
          outcome: params.outcome || params.title || '',
          folder: params.folder || null,
          ...(params.doneWhen ? { doneWhen: params.doneWhen } : {}),
          ...(params.steps ? { steps: params.steps } : {}),
        });

      case 'goals.continue':
        throw new Error('Use `baryon work` to work on a goal in headless mode, or run Baryon desktop for goal orchestration.');

      case 'promises.list':
        return promiseBook.view();

      case 'promises.done': {
        await promiseBook.setDone(String(params.id || ''), params.done !== false);
        return promiseBook.view();
      }

      case 'auth.status': {
        const [ga, claudeAcc, agyAcc, codexAcc] = await Promise.all([
          readSafeAccountSnapshot(file('google-account.json')),
          safeAccount('claude'),
          safeAccount('antigravity'),
          safeAccount('codex'),
        ]);
        return { googleAccount: ga, claude: claudeAcc, antigravity: agyAcc, codex: codexAcc, mode: 'headless' };
      }

      case 'auth.agyRefresh': {
        const conn = getProviderInstance('antigravity');
        if (typeof conn.refreshAccount === 'function') {
          return conn.refreshAccount();
        }
        return conn.account();
      }

      case 'plugins.status': {
        const ga = await readSafeAccountSnapshot(file('google-account.json'));
        return {
          googleAccount: ga,
          connectors: connectors.state(),
          supportedSso: Object.values(GOOGLE_SSO_PLUGINS).map(p => ({ id: p.id, name: p.name, authUrl: p.authUrl })),
          mode: 'headless',
        };
      }

      case 'plugins.connect': {
        const ga = await readSafeAccountSnapshot(file('google-account.json'));
        return quickConnectPlugins({
          pluginIds: Array.isArray(params.pluginIds) ? params.pluginIds : [],
          connectors,
          email: ga.email || '',
          openBrowser: false,
        });
      }

      default:
        throw new Error(`Unknown CLI method: ${method}`);
    }
  }

  async function runWorkTurn(req, onEvent = () => {}) {
    await ensureLoaded();
    const prompt = typeof req?.prompt === 'string' ? req.prompt.trim() : '';
    if (!prompt) throw new Error('Provide a prompt for Fairy.');
    const permission = req?.mode === 'read' || req?.permission === 'plan' ? 'plan' : 'auto';
    const root = checkWorkFolder(req?.folder || process.cwd(), { dataDir });

    let chatId = req?.chat ? String(req.chat) : '';
    if (chatId) {
      const existing = sessions.find(chatId);
      if (!existing.work || checkWorkFolder(existing.work.folder, { dataDir }) !== root) {
        throw new Error('That session isn’t working in this folder.');
      }
      await sessions.setWorkFor(chatId, { permission });
    } else {
      chatId = await sessions.addWork({ folder: root, permission });
    }

    onEvent({ type: 'started', chat: chatId });
    const before = await sessions.read(chatId);
    const at = new Date().toISOString();
    await sessions.append(chatId, [{ role: 'user', content: prompt, at, mode: 'work', from: 'cli-headless' }]);

    const controller = new AbortController();
    const signal = req?.signal ? AbortSignal.any([req.signal, controller.signal]) : controller.signal;
    activeControllers.set(chatId, controller);

    try {
      sandboxedCache ??= await sandboxProbe().catch(() => false);
      const { provider, settings: workSettings } = workProviderConfig(req?.provider, req?.model);
      let allowed = sessionAllowed.get(chatId);
      if (!allowed) {
        allowed = new Set();
        sessionAllowed.set(chatId, allowed);
      }
      const askApprove = promptApproval || defaultApprovePrompt({ stdin, stderr, autoApprove, color });
      const approve = async approvalReq => {
        const apId = randomUUID().slice(0, 8);
        onEvent({
          type: 'approval',
          approval: apId,
          title: approvalReq?.title || 'Fairy needs your OK',
          detail: approvalReq?.command || approvalReq?.detail || '',
        });
        try {
          return await askApprove(approvalReq);
        } finally {
          onEvent({ type: 'approval-closed', approval: apId });
        }
      };

      const tools = new WorkTools({
        root,
        permission,
        sandboxed: sandboxedCache,
        signal,
        allowed,
        runCommand: opts => (sandboxedCache ? runInSandbox(opts) : runOutsideSandbox(opts)),
        runOutside: opts => runOutsideSandbox(opts),
        approve,
        onEvent: ev => {
          if (ev?.type === 'tool') onEvent({ type: 'step', row: ev.row });
          else if (ev?.type === 'tasks') onEvent({ type: 'tasks', tasks: ev.tasks });
        },
        onPermission: nextPerm => {
          if (nextPerm === 'auto' || nextPerm === 'ask' || nextPerm === 'plan') {
            void sessions.setWorkFor(chatId, { permission: nextPerm }).catch(() => {});
          }
        },
      });

      const [memoryList, journalList] = await Promise.all([
        projectMemory.list(root).catch(() => []),
        labJournal.list(root).catch(() => []),
      ]);
      const memory = settings.workProjectMemory === 'off' ? '' : memoryNote(memoryList);
      const journal = journalNote(journalList);
      const rules = typeof longTermMemory?.workRules === 'function' ? longTermMemory.workRules() : '';

      const fullPrompt = req?.context ? `${req.context}\n\n${prompt}` : prompt;
      const reply = await runWork({
        provider,
        settings: workSettings,
        text: fullPrompt,
        history: before,
        tools,
        signal,
        rules,
        memory,
        journal,
        onText: text => onEvent({ type: 'text', text }),
        onThought: thought => onEvent({ type: 'thought', thought }),
      });

      const doneText = String(reply || '').trim();
      await sessions.append(chatId, [{ role: 'assistant', content: doneText, at: new Date().toISOString(), mode: 'work' }]);
      onEvent({ type: 'done', text: doneText, failed: false });
      return { chat: chatId, text: doneText, failed: false };
    } catch (error) {
      const msg = signal.aborted ? 'Stopped.' : String(error?.message || error || 'Work turn failed.');
      await sessions.append(chatId, [{ role: 'assistant', content: msg, at: new Date().toISOString(), mode: 'work', unfinished: true }]).catch(() => {});
      onEvent({ type: 'done', text: msg, failed: true });
      return { chat: chatId, text: msg, failed: true, error: msg };
    } finally {
      if (activeControllers.get(chatId) === controller) activeControllers.delete(chatId);
    }
  }

  async function askChat(req, onEvent = () => {}) {
    await ensureLoaded();
    const prompt = typeof req?.prompt === 'string' ? req.prompt.trim() : '';
    if (!prompt) throw new Error('Provide a prompt for Fairy.');

    let chatId = req?.chat ? String(req.chat) : '';
    if (chatId) {
      const existing = sessions.find(chatId);
      if (existing.work) throw new Error('That session is a work session. Use work mode or start a new chat.');
    } else {
      chatId = await sessions.addChat({ title: 'CLI chat', history: [] });
    }
    onEvent({ type: 'started', chat: chatId });

    const past = await sessions.read(chatId);
    const controller = new AbortController();
    const signal = req?.signal ? AbortSignal.any([req.signal, controller.signal]) : controller.signal;
    activeControllers.set(chatId, controller);

    try {
      const { provider, settings: chatSettings } = chatProviderConfig(req?.provider, req?.model);
      const fullPrompt = req?.context ? `${req.context}\n\n${prompt}` : prompt;
      const res = await provider.chat(chatSettings, past.slice(-60), fullPrompt, signal, null, {
        onText: text => onEvent({ type: 'text', text }),
        onThought: thought => onEvent({ type: 'thought', thought }),
      });
      const doneText = String(res?.text ?? res ?? '').trim();
      const at = new Date().toISOString();
      await sessions.append(chatId, [
        { role: 'user', content: prompt, at, mode: 'chat', from: 'cli-headless' },
        { role: 'assistant', content: doneText, at, mode: 'chat' },
      ]);
      onEvent({ type: 'done', text: doneText, failed: false });
      return { chat: chatId, text: doneText, failed: false };
    } catch (error) {
      const msg = signal.aborted ? 'Stopped.' : String(error?.message || error || 'Chat failed.');
      onEvent({ type: 'done', text: msg, failed: true });
      return { chat: chatId, text: msg, failed: true, error: msg };
    } finally {
      if (activeControllers.get(chatId) === controller) activeControllers.delete(chatId);
    }
  }

  function stop(id = '') {
    if (id && activeControllers.has(id)) {
      activeControllers.get(id)?.abort(new Error('Stopped.'));
      return;
    }
    for (const controller of activeControllers.values()) {
      controller.abort(new Error('Stopped.'));
    }
  }

  async function close() {
    stop();
    for (const conn of Object.values(conns)) {
      try { conn?.close?.(); } catch {}
    }
  }

  return {
    mode: 'headless',
    dataDir,
    hello,
    rpc,
    runWork: runWorkTurn,
    askChat,
    stop,
    close,
  };
}
