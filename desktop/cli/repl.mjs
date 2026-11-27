// Interactive Terminal Fairy REPL (Claude Code / Codex style).
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import {
  formatApprovalBox,
  formatDim,
  formatError,
  formatHeading,
  formatMarkdown,
  formatStep,
  formatSuccess,
  formatTable,
} from './render.mjs';
import { SPRITE_MOODS, createSpinner, renderBanner, renderSprite, useColor } from './sprite.mjs';

export const REPL_SLASH_COMMANDS = Object.freeze([
  '/help',
  '/plan',
  '/edit',
  '/work',
  '/chat',
  '/ask',
  '/model',
  '/new',
  '/resume',
  '/sessions',
  '/fork',
  '/compact',
  '/btw',
  '/stop',
  '/memory',
  '/journal',
  '/today',
  '/goals',
  '/promises',
  '/usage',
  '/auth',
  '/plugins',
  '/sprite',
  '/clear',
  '/exit',
]);

const SLASH_HELP = `
Slash commands:
  /plan               Switch work session to plan (read-only) mode
  /edit               Switch work session to edit (sandboxed) mode
  /work [dir]         Switch to folder work mode (optionally change folder)
  /chat               Switch to plain chat mode
  /ask <msg>          Send one quick plain-chat question without leaving work mode
  /btw <msg>          Side question (same as /ask without changing active work chat)
  /model [id]         Show active models or set model (or \`auto\` / \`claude\` / \`gemini\` / \`codex\`)
  /new                Start a fresh session on your next message
  /resume [id]        Resume an existing session ID (or list recent ones)
  /sessions [query]   List or search sessions
  /fork [id]          Fork the current (or specified) session
  /compact [id]       Compact older history into notes
  /memory [query]     List or search Fairy memory (\`/memory add <text>\` to save)
  /journal            List lab journal entries for the current folder
  /today              Show calendar, inbox, open promises, and active goals
  /goals              List active goals
  /promises           List open promises (\`/promises done <id>\` to complete)
  /usage              Show token usage & plan quotas
  /auth               Show account sign-in status
  /plugins [connect]  Show plugins or quick-connect (e.g. \`/plugins connect notion\`)
  /sprite [mood]      Preview Fairy sprite (${SPRITE_MOODS.join(', ')})
  /stop               Abort active turn
  /clear              Clear screen and redraw banner
  /exit               Exit Baryon CLI
`;

/**
 * Starts the interactive Fairy CLI REPL.
 * Returns numeric process exit code (`0` on clean exit).
 */
export async function startRepl({
  backend,
  cwd = process.cwd(),
  folder = cwd,
  initialMode = 'work',
  initialPermission = 'edit',
  initialChat = '',
  initialModel = '',
  initialProvider = '',
  stdin = process.stdin,
  stdout = process.stdout,
  stderr = process.stderr,
  env = process.env,
  handleSignals = true,
  openUrl = null,
} = {}) {
  const color = useColor(stdout, env);
  const stderrColor = useColor(stderr, env);

  const hello = await backend.hello().catch(() => ({
    name: 'Fairy',
    provider: initialProvider || '',
    model: initialModel || '',
    mode: backend.mode || 'headless',
  }));

  let mode = initialMode === 'chat' ? 'chat' : 'work';
  let permission = initialPermission === 'read' || initialPermission === 'plan' ? 'read' : 'edit';
  let workFolder = resolve(folder || cwd);
  let activeWorkChat = mode === 'work' ? initialChat : '';
  let activeChatId = mode === 'chat' ? initialChat : '';
  let activeModel = initialModel || hello.model || '';
  let activeProvider = initialProvider || hello.provider || '';
  let inFlightController = null;
  let lastSigintAt = 0;

  const drawBanner = (mood = 'idle') => {
    stdout.write(renderBanner({
      name: hello.name || 'Fairy',
      connectionMode: backend.mode || hello.mode || 'headless',
      provider: activeProvider,
      model: activeModel,
      folder: mode === 'work' ? workFolder : '',
      permission: permission === 'read' ? 'plan' : 'auto',
      mode,
      chatId: mode === 'work' ? activeWorkChat : activeChatId,
      mood,
      color,
    }));
  };

  drawBanner('idle');

  const rl = createInterface({
    input: stdin,
    output: stdout,
    terminal: Boolean(stdin?.isTTY),
    completer: line => {
      if (!line.startsWith('/')) return [[], line];
      const hits = REPL_SLASH_COMMANDS.filter(c => c.startsWith(line));
      return [hits.length ? hits : REPL_SLASH_COMMANDS, line];
    },
  });

  const onSigint = () => {
    if (inFlightController) {
      inFlightController.abort(new Error('Stopped.'));
      stderr.write(`\n${formatDim('[stopping current turn…]', stderrColor)}\n`);
      return;
    }
    const now = Date.now();
    if (now - lastSigintAt < 1800) {
      stdout.write('\n');
      rl.close();
      return;
    }
    lastSigintAt = now;
    stdout.write(`\n${formatDim('Press Ctrl+C again, Ctrl+D, or type /exit to leave Baryon CLI.', color)}\n`);
    rl.prompt(true);
  };

  if (handleSignals) {
    process.on('SIGINT', onSigint);
  }
  rl.on('SIGINT', onSigint);

  const runTurn = async (turnMode, promptText) => {
    const spinner = createSpinner({ stream: stderr, color: stderrColor });
    const seenSteps = new Map();
    const controller = new AbortController();
    inFlightController = controller;
    let printedText = false;
    let approvalShown = false;

    spinner.start(turnMode === 'chat' ? 'Thinking…' : 'Starting turn…', 'thinking');

    const onEvent = ev => {
      if (!ev || typeof ev !== 'object') return;
      if (ev.type === 'started' && ev.chat) {
        if (turnMode === 'work') activeWorkChat = ev.chat;
        else if (turnMode === 'chat') activeChatId = ev.chat;
        spinner.update(`Session #${String(ev.chat).slice(0, 10)} · working…`, 'working');
      } else if (ev.type === 'thinking') {
        spinner.update(ev.text ? `Thinking: ${ev.text.slice(0, 56)}` : 'Thinking…', 'thinking');
      } else if (ev.type === 'step' && ev.row) {
        const key = ev.row.id || `${ev.row.tool}:${ev.row.summary}`;
        const stamp = `${ev.row.status}:${ev.row.summary}`;
        if (seenSteps.get(key) !== stamp) {
          seenSteps.set(key, stamp);
          spinner.pause();
          stderr.write(`${formatStep(ev.row, { color: stderrColor })}\n`);
          spinner.start(`${ev.row.tool || 'Working'}…`, 'working');
        }
      } else if (ev.type === 'approval') {
        spinner.pause();
        approvalShown = true;
        if (backend.mode !== 'headless') {
          stderr.write(`\n${formatApprovalBox({ title: ev.title, detail: ev.detail, interactive: false, color: stderrColor })}\n`);
        }
      } else if (ev.type === 'approval-closed') {
        if (approvalShown) {
          approvalShown = false;
          spinner.start('Continuing…', 'working');
        }
      } else if (ev.type === 'text' && typeof ev.text === 'string' && ev.text.trim()) {
        spinner.update('Writing reply…', 'working');
        printedText = true;
      }
    };

    try {
      const result = turnMode === 'work'
        ? await backend.runWork({
          folder: workFolder,
          prompt: promptText,
          chat: activeWorkChat || null,
          mode: permission,
          model: activeModel,
          provider: activeProvider,
          signal: controller.signal,
        }, onEvent)
        : await backend.askChat({
          prompt: promptText,
          chat: turnMode === 'btw' ? null : (activeChatId || null),
          model: activeModel,
          provider: activeProvider,
          signal: controller.signal,
        }, onEvent);

      spinner.stop();
      if (result.chat) {
        if (turnMode === 'work') activeWorkChat = result.chat;
        else if (turnMode === 'chat') activeChatId = result.chat;
      }
      if (result.text) {
        stdout.write(`\n${formatMarkdown(result.text, { color })}\n\n`);
      } else if (!printedText && !result.failed) {
        stdout.write(`${formatDim('(empty reply)', color)}\n`);
      }
      if (result.failed && !controller.signal.aborted) {
        stderr.write(`${formatError('Turn ended with an error.', stderrColor)}\n`);
      }
    } catch (error) {
      spinner.stop();
      if (error?.name === 'AbortError' || controller.signal.aborted) {
        stderr.write(`${formatDim('[stopped]', stderrColor)}\n`);
      } else {
        stderr.write(`${formatError(error?.message || String(error), stderrColor)}\n`);
      }
    } finally {
      if (inFlightController === controller) inFlightController = null;
    }
  };

  const handleSlash = async raw => {
    const body = raw.slice(1).trim();
    const spaceAt = body.search(/\s/);
    const cmd = (spaceAt < 0 ? body : body.slice(0, spaceAt)).toLowerCase();
    const rest = spaceAt < 0 ? '' : body.slice(spaceAt + 1).trim();

    switch (cmd) {
      case '':
      case 'help':
      case '?':
        stdout.write(SLASH_HELP);
        return true;

      case 'exit':
      case 'quit':
      case 'q':
        return false;

      case 'clear':
        if (stdout.isTTY) stdout.write('\x1b[2J\x1b[H');
        drawBanner('happy');
        return true;

      case 'sprite': {
        const mood = SPRITE_MOODS.includes(rest) ? rest : 'happy';
        stdout.write(`\n${renderSprite({ mood, color })}\n\n`);
        return true;
      }

      case 'plan':
        mode = 'work';
        permission = 'read';
        stdout.write(`${formatSuccess('Switched to plan (read-only) mode.', color)}\n`);
        return true;

      case 'edit':
        mode = 'work';
        permission = 'edit';
        stdout.write(`${formatSuccess('Switched to edit (sandboxed) mode.', color)}\n`);
        return true;

      case 'work':
        mode = 'work';
        if (rest) {
          workFolder = resolve(workFolder, rest);
          activeWorkChat = '';
        }
        stdout.write(`${formatSuccess(`Work mode active in ${workFolder} (${permission}).`, color)}\n`);
        return true;

      case 'chat':
        mode = 'chat';
        stdout.write(`${formatSuccess('Plain chat mode active.', color)}\n`);
        return true;

      case 'ask':
      case 'btw':
        if (!rest) {
          stderr.write(`${formatError(`Usage: /${cmd} <question>`, stderrColor)}\n`);
          return true;
        }
        await runTurn('btw', rest);
        return true;

      case 'new':
        if (mode === 'work') activeWorkChat = '';
        else activeChatId = '';
        stdout.write(`${formatSuccess('Next message will start a fresh session.', color)}\n`);
        return true;

      case 'stop':
        if (inFlightController) inFlightController.abort(new Error('Stopped.'));
        else stdout.write(`${formatDim('Nothing is running right now.', color)}\n`);
        return true;

      case 'model': {
        if (!rest) {
          const data = await backend.rpc('models.list');
          stdout.write(`${formatHeading('Models', color)}\n`);
          stdout.write(`  Work: ${data?.current?.work?.provider || '?'} · ${data?.current?.work?.model || '?'}${data?.current?.work?.auto ? ' (Auto)' : ''}\n`);
          stdout.write(`  Chat: ${data?.current?.chat?.provider || '?'} · ${data?.current?.chat?.model || '?'}${data?.current?.chat?.auto ? ' (Auto)' : ''}\n`);
          return true;
        }
        const parts = rest.split(/\s+/);
        let provider = '';
        let model = parts[0];
        if (['claude', 'gemini', 'codex'].includes(parts[0]) && parts[1]) {
          provider = parts[0];
          model = parts[1];
        } else if (model.startsWith('claude-')) provider = 'claude';
        else if (model.startsWith('gemini-')) provider = 'gemini';
        else if (/^(?:gpt-|o\d|codex)/.test(model)) provider = 'codex';

        if (model === 'auto') {
          await backend.rpc('models.set', { work: mode === 'work', auto: true, ...(provider ? { provider } : {}) });
          stdout.write(`${formatSuccess('Enabled Auto model selection.', color)}\n`);
        } else {
          if (!provider) provider = activeProvider.toLowerCase().includes('gemini') ? 'gemini' : activeProvider.toLowerCase().includes('codex') ? 'codex' : 'claude';
          const res = await backend.rpc('models.set', { work: mode === 'work', provider, model });
          activeProvider = provider;
          activeModel = model;
          stdout.write(`${formatSuccess(`Active ${mode} model set to ${provider} · ${res?.current?.[mode]?.model || model}`, color)}\n`);
        }
        return true;
      }

      case 'sessions': {
        const res = rest
          ? await backend.rpc('sessions.search', { query: rest, limit: 12 })
          : await backend.rpc('sessions.list', { limit: 15 });
        const rows = rest ? (res?.hits || []) : (res?.sessions || []);
        stdout.write(`${formatTable([
          { label: 'ID', get: r => r.id || r.sessionId || '', max: 14 },
          { label: 'Title', get: r => r.title || '(untitled)', max: 42 },
          { label: 'Folder / Mode', get: r => r.workPath || r.folder || 'chat', max: 36 },
        ], rows, { color, empty: 'No sessions found.' })}\n`);
        return true;
      }

      case 'resume': {
        if (!rest) {
          const res = await backend.rpc('sessions.list', { limit: 10 });
          stdout.write(`${formatTable([
            { label: 'ID', get: r => r.id, max: 38 },
            { label: 'Title', get: r => r.title || '(untitled)', max: 36 },
            { label: 'Work Folder', get: r => r.workPath || 'chat', max: 34 },
          ], res?.sessions || [], { color })}\n`);
          stdout.write(`${formatDim('Pass an ID: /resume <id>', color)}\n`);
          return true;
        }
        const detail = await backend.rpc('sessions.show', { id: rest, limit: 5 });
        if (detail?.session?.work?.folder) {
          mode = 'work';
          workFolder = detail.session.work.folder;
          activeWorkChat = detail.session.id;
          permission = detail.session.work.permission === 'plan' ? 'read' : 'edit';
        } else {
          mode = 'chat';
          activeChatId = detail?.session?.id || rest;
        }
        stdout.write(`${formatSuccess(`Resumed ${detail?.session?.title || rest} (${mode})`, color)}\n`);
        return true;
      }

      case 'fork': {
        const target = rest || (mode === 'work' ? activeWorkChat : activeChatId);
        const res = await backend.rpc('sessions.fork', { id: target });
        if (mode === 'work') activeWorkChat = res.id;
        else activeChatId = res.id;
        stdout.write(`${formatSuccess(`Forked session -> ${res.id}`, color)}\n`);
        return true;
      }

      case 'compact': {
        const target = rest || (mode === 'work' ? activeWorkChat : activeChatId);
        await backend.rpc('sessions.compact', { id: target });
        stdout.write(`${formatSuccess(`Compacted session ${target}.`, color)}\n`);
        return true;
      }

      case 'memory': {
        if (rest.startsWith('add ')) {
          const text = rest.slice(4).trim();
          await backend.rpc('memory.add', { kind: 'work', text });
          stdout.write(`${formatSuccess('Saved memory item.', color)}\n`);
          return true;
        }
        const res = await backend.rpc('memory.list', { ...(rest ? { query: rest } : {}), ...(mode === 'work' ? { folder: workFolder } : {}) });
        stdout.write(`${formatTable([
          { label: 'Kind', get: r => r.kind, max: 10 },
          { label: 'Memory', get: r => r.text, max: 80 },
        ], res?.items || [], { color, empty: 'No long-term memory items saved.' })}\n`);
        return true;
      }

      case 'journal': {
        const res = await backend.rpc('journal.list', { folder: workFolder, limit: 15 });
        stdout.write(`${formatTable([
          { label: 'Date', get: r => r.date || '', max: 12 },
          { label: 'Title', get: r => r.title || '', max: 36 },
          { label: 'Decision', get: r => r.decision || r.outcome || '', max: 52 },
        ], res?.entries || [], { color, empty: `No lab journal entries in ${workFolder}.` })}\n`);
        return true;
      }

      case 'today': {
        const data = await backend.rpc('today');
        stdout.write(`${formatHeading('Today', color)}\n`);
        if (data?.calendar?.events?.length) {
          stdout.write(`${formatTable([
            { label: 'Time', get: e => e.start || '', max: 22 },
            { label: 'Event', get: e => e.title || '', max: 56 },
          ], data.calendar.events, { color })}\n`);
        } else if (data?.calendar?.error) {
          stdout.write(`  Calendar: ${formatDim(data.calendar.error, color)}\n`);
        }
        stdout.write(`  Open promises: ${(data?.promises || []).length}   Active goals: ${(data?.goals || []).length}\n`);
        return true;
      }

      case 'goals': {
        const res = await backend.rpc('goals.list');
        stdout.write(`${formatTable([
          { label: 'ID', get: g => g.id, max: 8 },
          { label: 'State', get: g => g.state, max: 14 },
          { label: 'Goal', get: g => g.outcome, max: 70 },
        ], res?.goals || [], { color, empty: 'No goals.' })}\n`);
        return true;
      }

      case 'promises': {
        if (rest.startsWith('done ')) {
          const id = rest.slice(5).trim();
          await backend.rpc('promises.done', { id, done: true });
          stdout.write(`${formatSuccess(`Marked promise ${id} done.`, color)}\n`);
          return true;
        }
        const res = await backend.rpc('promises.list');
        stdout.write(`${formatTable([
          { label: 'ID', get: p => p.id, max: 14 },
          { label: 'Due', get: p => p.due || '-', max: 18 },
          { label: 'Promise', get: p => p.what, max: 66 },
        ], res?.open || [], { color, empty: 'No open promises.' })}\n`);
        return true;
      }

      case 'usage': {
        const u = await backend.rpc('usage');
        stdout.write(`${formatHeading('Usage & Quotas', color)}\n`);
        stdout.write(`  Total messages: ${u?.totals?.messages ?? 0}   Tokens: ${u?.totals?.tokens ?? 0}\n`);
        if (u?.plans?.claude?.fiveHour !== undefined) {
          stdout.write(`  Claude 5h used: ${u.plans.claude.fiveHour}%   7d used: ${u.plans.claude.sevenDay ?? '?'}%\n`);
        }
        if (u?.antigravity?.connected) {
          stdout.write(`  Antigravity: connected (${u.antigravity.models?.length || 0} models)\n`);
        }
        return true;
      }

      case 'auth': {
        const a = await backend.rpc('auth.status');
        stdout.write(`${formatHeading('Accounts', color)}\n`);
        stdout.write(`  Google Account: ${a?.googleAccount?.connected ? `connected (${a.googleAccount.email || 'signed in'})` : 'not connected'}\n`);
        stdout.write(`  Claude:         ${a?.claude?.connected ? `connected (${a.claude.plan || 'subscription'})` : 'not connected'}\n`);
        stdout.write(`  Antigravity:    ${a?.antigravity?.connected ? 'connected' : 'not connected'}\n`);
        stdout.write(`  Codex:          ${a?.codex?.connected ? `connected (${a.codex.plan || 'ChatGPT'})` : 'not connected'}\n`);
        return true;
      }

      case 'plugins': {
        if (rest.startsWith('connect ')) {
          const ids = rest.slice(8).trim().split(/[\s,]+/).filter(Boolean);
          const res = await backend.rpc('plugins.connect', { pluginIds: ids });
          const results = Array.isArray(res?.results) ? res.results : [];
          const added = results.filter(r => r.added).map(r => r.id);
          const existing = results.filter(r => r.alreadyConnected).map(r => r.id);
          stdout.write(`${formatSuccess(`Configured: ${added.join(', ') || 'none'}   Existing: ${existing.join(', ') || 'none'}`, color)}\n`);
          for (const item of results) {
            if (!item?.authUrl) continue;
            stdout.write(`  Sign in (${item.name || item.id}): ${item.authUrl}\n`);
            if (openUrl) await openUrl(item.authUrl).catch(() => {});
          }
          return true;
        }
        const p = await backend.rpc('plugins.status');
        stdout.write(`${formatTable([
          { label: 'Plugin / SSO', get: r => r.id, max: 18 },
          { label: 'Connected', get: r => (p?.connectors || []).some(c => c.name === r.id) ? 'yes' : 'no', max: 12 },
          { label: 'Auth URL', get: r => r.authUrl, max: 52 },
        ], p?.supportedSso || [], { color })}\n`);
        return true;
      }

      default:
        stderr.write(`${formatError(`Unknown command "/${cmd}". Try /help.`, stderrColor)}\n`);
        return true;
    }
  };

  // Queue buffered lines so non-TTY/scripted streams don't lose queued lines on early close,
  // while keeping interactive TTY prompt display and Ctrl+C responsive.
  const lineQueue = [];
  let lineWaiter = null;
  let streamClosed = false;

  const wake = () => {
    if (lineWaiter) {
      const resolve = lineWaiter;
      lineWaiter = null;
      resolve();
    }
  };

  rl.on('line', line => {
    lineQueue.push(line);
    wake();
  });
  rl.on('close', () => {
    streamClosed = true;
    wake();
  });

  const nextLine = async promptText => {
    if (lineQueue.length) return lineQueue.shift();
    if (streamClosed) return null;
    if (stdin?.isTTY) {
      rl.setPrompt(promptText);
      rl.prompt();
    }
    await new Promise(resolve => { lineWaiter = resolve; });
    if (lineQueue.length) return lineQueue.shift();
    return null;
  };

  try {
    while (true) {
      const promptLabel = mode === 'chat'
        ? `${color ? '\x1b[38;5;141m' : ''}fairy (chat) ❯${color ? '\x1b[0m' : ''} `
        : permission === 'read'
          ? `${color ? '\x1b[38;5;221m' : ''}fairy (plan) ❯${color ? '\x1b[0m' : ''} `
          : `${color ? '\x1b[38;5;81m' : ''}fairy ❯${color ? '\x1b[0m' : ''} `;
      const line = await nextLine(promptLabel);
      if (line === null) break;
      const trimmed = String(line ?? '').trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('/')) {
        try {
          const keepGoing = await handleSlash(trimmed);
          if (!keepGoing) break;
        } catch (error) {
          stderr.write(`${formatError(error?.message || String(error), stderrColor)}\n`);
        }
        continue;
      }
      await runTurn(mode, trimmed);
    }
  } finally {
    if (handleSignals) process.off('SIGINT', onSigint);
    rl.close();
  }

  stdout.write(`\n${formatDim('Bye from Baryon ✦', color)}\n`);
  return 0;
}
