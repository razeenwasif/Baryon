import './styles.css';
import {
  loadState,
  saveState,
  createThread,
  deleteThread,
  appendNode,
  getActivePath,
  selectBranchNode,
  getSiblingInfo,
  countThreadBranches,
  chooseFanoutWinner,
  buildApiHistory,
  uid,
} from './store.js';
import type {
  FanoutCandidate,
  SiblingInfo,
  SideChatMessage,
  Thread,
  ThreadNode,
  WebStoreState,
} from './store.js';
import { renderMarkdown, extractArtifacts, buildArtifactSrcdoc, escapeHtml } from './markdown.js';
import type { MarkdownArtifact } from './markdown.js';
import {
  ENGINES,
  MODELS_BY_ENGINE,
  modelLabel,
  resolveEffectiveEngine,
  streamCompletion,
  testMacHostConnection,
} from './providers.js';
import type {
  EffortLevel,
  EngineId,
  ModelOption,
} from './providers.js';

interface StarterPrompt {
  title: string;
  tag: string;
  desc: string;
  prompt: string;
  fanout: boolean;
}

interface SlashCommand {
  cmd: string;
  desc: string;
}

type InspectorTab = 'artifact' | 'branches' | 'side';

interface SpeechRecognitionResultItem {
  transcript: string;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<ArrayLike<SpeechRecognitionResultItem>>;
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  onresult: ((evt: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

const STARTER_PROMPTS: readonly StarterPrompt[] = [
  {
    title: 'Multi-Model Arena',
    tag: '/fanout',
    desc: 'Race Gemini 4 Neon, Claude Fable & GPT-6 Astra side-by-side and keep the winner.',
    prompt: 'Compare event-sourced vs CRDT state sync for offline-first AI apps, with tradeoffs.',
    fanout: true,
  },
  {
    title: 'Interactive Web Artifact',
    tag: 'HTML Sandbox',
    desc: 'Generate a Stratus-dark interactive widget and run it live in the Artifact drawer.',
    prompt: 'Build an interactive Stratus telemetry dashboard HTML artifact with live controls.',
    fanout: false,
  },
  {
    title: 'SVG System Architecture',
    tag: 'Vector Diagram',
    desc: 'Sketch a clean system topology diagram and inspect it directly in the canvas pane.',
    prompt: 'Draw an SVG architecture diagram showing Baryon Web, Branch DAG, and Tailscale Mac pairing.',
    fanout: false,
  },
  {
    title: 'Branch & Time-Travel',
    tag: 'DAG Tree',
    desc: 'Fork any turn into an alternate timeline without losing your original conversation.',
    prompt: 'Design a fast RAG chunking pipeline for 500-page PDFs with citation anchors.',
    fanout: false,
  },
];

const SLASH_COMMANDS: readonly SlashCommand[] = [
  { cmd: '/fanout', desc: 'Send prompt to 3 models simultaneously in Arena compare mode' },
  { cmd: '/side', desc: 'Open disposable Side Chat in the inspector drawer' },
  { cmd: '/artifact', desc: 'Open the live sandboxed Artifact preview drawer' },
  { cmd: '/branches', desc: 'Inspect & switch conversation timeline branches' },
  { cmd: '/connect', desc: 'Configure Gemini/OpenAI/Claude/DeepSeek keys or Baryon Mac Host' },
  { cmd: '/export', desc: 'Download current conversation branch as Markdown' },
];

const $ = <T extends Element = HTMLElement>(sel: string, rootNode: ParentNode = document): T =>
  rootNode.querySelector<T>(sel)!;

let state: WebStoreState = loadState();
let streamingCtrl: AbortController | null = null;
let queuedTurn: string | null = null;
let fanoutMode = false;
let inspectorOpen = false;
let inspectorTab: InspectorTab = 'artifact'; // 'artifact' | 'branches' | 'side'
let mobileSideOpen = false;
let sidebarCollapsed = false;
let searchQuery = '';
let activeArtifact: MarkdownArtifact | null = null;
let artifactShowCode = false;
let slashIndex = 0;

const root = $('#root');

function isCompactViewport(): boolean {
  return window.innerWidth <= 900;
}

function activeThread(): Thread | null {
  return state.activeThreadId ? state.threads[state.activeThreadId] || null : null;
}

function persist(): void {
  saveState(state);
}

function availableModels(): ModelOption[] {
  const engine = state.settings.engine || 'demo';
  if (engine === 'custom' && state.settings.customModel?.trim()) {
    return [{ id: state.settings.customModel.trim(), label: state.settings.customModel.trim(), tag: 'Custom' }];
  }
  return MODELS_BY_ENGINE[engine as EngineId] || MODELS_BY_ENGINE.demo;
}

function ensureValidSelectedModel(): void {
  const list = availableModels();
  if (!list.some(m => m.id === state.settings.model)) {
    state.settings.model = list[0]?.id || 'baryon-stratus';
  }
}

function buildShell(): void {
  root.innerHTML = `
    <div class="bw-shell" id="bw-shell">
      <div class="bw-scrim" id="bw-scrim" hidden></div>
      <aside class="bw-sidebar" aria-label="Threads and connections">
        <div class="bw-brand-row">
          <div class="bw-brand">
            <img src="/icon.png" alt="Baryon" />
            <span class="bw-brand-name">Baryon</span>
            <span class="bw-brand-tag">WEB</span>
          </div>
          <button type="button" class="bw-icon-btn" id="bw-open-palette" title="Command palette (⌘K)">⌘K</button>
        </div>
        <button type="button" class="bw-new-btn" id="bw-new-thread">
          <span>+ New Thread</span>
          <kbd>⌘N</kbd>
        </button>
        <div class="bw-search-wrap">
          <input type="search" class="bw-search-input" id="bw-thread-search" placeholder="Search threads…" aria-label="Search threads" />
        </div>
        <div class="bw-thread-list" id="bw-thread-list"></div>
        <div class="bw-side-foot">
          <a href="/" class="bw-engine-card" style="text-decoration:none;padding:7px 11px">
            <div class="bw-engine-text">
              <strong>Baryon for macOS</strong>
              <span>Download installer &amp; overview</span>
            </div>
            <span style="color:var(--dim);font-size:12px">↗</span>
          </a>
          <button type="button" class="bw-engine-card" id="bw-open-settings">
            <span class="bw-status-dot" id="bw-status-dot"></span>
            <div class="bw-engine-text">
              <strong id="bw-engine-title">Demo Studio</strong>
              <span id="bw-engine-sub">Instant · Add keys or Mac Host</span>
            </div>
            <span style="color:var(--dim);font-size:12px">⚙</span>
          </button>
        </div>
      </aside>

      <main class="bw-main" id="bw-main">
        <header class="bw-topbar">
          <div class="bw-topbar-left">
            <button type="button" class="bw-icon-btn" id="bw-toggle-side" aria-label="Toggle sidebar">☰</button>
            <span class="bw-chat-title" id="bw-chat-title">Baryon Studio</span>
          </div>
          <div class="bw-topbar-right">
            <button type="button" class="bw-icon-btn" id="bw-tab-branches" title="Branch tree">⑂ <span class="bw-desktop-only">Branches</span></button>
            <button type="button" class="bw-icon-btn" id="bw-tab-artifact" title="Live Artifact sandbox">◈ <span class="bw-desktop-only">Artifact</span></button>
            <button type="button" class="bw-icon-btn" id="bw-tab-side" title="Ephemeral Side Chat">/side</button>
          </div>
        </header>

        <section class="bw-scroll" id="bw-scroll"></section>

        <div class="bw-composer-zone">
          <div class="bw-queue-banner" id="bw-queue-banner" hidden>
            <span id="bw-queue-text"></span>
            <button type="button" class="bw-act-btn" id="bw-queue-clear">Cancel</button>
          </div>
          <div class="bw-composer">
            <div class="bw-slash-menu" id="bw-slash-menu" hidden></div>
            <textarea id="bw-input" rows="1" placeholder="Ask anything, type / for Arena, Side Chat, or Artifacts…"></textarea>
            <div class="bw-composer-bar">
              <div class="bw-comp-pills">
                <select id="bw-model-select" class="bw-select-pill" aria-label="Model"></select>
                <button type="button" class="bw-pill-btn" id="bw-fanout-btn" title="Compare 3 models side-by-side">/fanout Arena</button>
                <button type="button" class="bw-pill-btn" id="bw-effort-btn" title="Reasoning depth">Effort: medium</button>
                <button type="button" class="bw-pill-btn" id="bw-mic-btn" title="Voice dictation">◉</button>
              </div>
              <div class="bw-send-group">
                <button type="button" class="bw-send-btn" id="bw-send-btn" aria-label="Send">Send ↑</button>
              </div>
            </div>
          </div>
        </div>
      </main>

      <aside class="bw-inspector" id="bw-inspector" aria-label="Workspace inspector">
        <div class="bw-insp-head">
          <div class="bw-tabs" role="tablist">
            <button type="button" class="bw-tab" data-insp="artifact">Artifact</button>
            <button type="button" class="bw-tab" data-insp="branches">Branches</button>
            <button type="button" class="bw-tab" data-insp="side">Side Chat</button>
          </div>
          <button type="button" class="bw-icon-btn" id="bw-close-insp" aria-label="Close drawer">✕</button>
        </div>
        <div class="bw-insp-body" id="bw-insp-body"></div>
      </aside>
    </div>

    <dialog class="bw-modal" id="bw-settings-modal">
      <div class="bw-modal-head">
        <h2>Engine, API Keys &amp; Baryon Mac Host</h2>
        <button type="button" class="bw-icon-btn" id="bw-settings-close">✕</button>
      </div>
      <div class="bw-modal-body" id="bw-settings-body"></div>
      <div class="bw-modal-foot">
        <button type="button" class="bw-pill-btn" id="bw-settings-cancel">Cancel</button>
        <button type="button" class="bw-send-btn" id="bw-settings-save">Save Settings</button>
      </div>
    </dialog>

    <dialog class="bw-modal" id="bw-palette-modal">
      <div class="bw-modal-head">
        <input type="search" id="bw-palette-input" class="bw-search-input" style="border:0;background:transparent;padding:0;font-size:15px" placeholder="Jump to thread, command, or model…" />
        <button type="button" class="bw-icon-btn" id="bw-palette-close">Esc</button>
      </div>
      <div class="bw-modal-body" id="bw-palette-list" style="max-height:360px"></div>
    </dialog>
  `;
}

function renderSidebar(): void {
  const list = $('#bw-thread-list');
  const q = searchQuery.trim().toLowerCase();
  const ids = state.threadOrder.filter(id => {
    const t = state.threads[id];
    if (!t) return false;
    if (!q) return true;
    return t.title.toLowerCase().includes(q);
  });

  if (!ids.length) {
    list.innerHTML = `<div style="padding:18px 10px;text-align:center;color:var(--muted);font-size:12.5px">No conversations yet.<br>Start below or pick a starter card.</div>`;
  } else {
    list.replaceChildren(...ids.map(id => {
      const t = state.threads[id];
      const branches = countThreadBranches(t);
      const row = document.createElement('div');
      row.className = `bw-thread-item${id === state.activeThreadId ? ' is-active' : ''}`;
      row.setAttribute('role', 'button');
      row.tabIndex = 0;

      const titleSpan = document.createElement('span');
      titleSpan.className = 'bw-thread-title';
      titleSpan.textContent = t.title || 'New thread';

      const meta = document.createElement('div');
      meta.className = 'bw-thread-meta';
      if (branches > 0) {
        const badge = document.createElement('span');
        badge.className = 'bw-mini-badge';
        badge.textContent = `+${branches}⑂`;
        meta.append(badge);
      }
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'bw-thread-del';
      delBtn.textContent = '×';
      delBtn.title = 'Delete thread';
      delBtn.onclick = e => {
        e.stopPropagation();
        deleteThread(state, id);
        persist();
        renderAll();
      };
      meta.append(delBtn);

      row.append(titleSpan, meta);
      row.onclick = () => {
        state.activeThreadId = id;
        mobileSideOpen = false;
        persist();
        renderAll();
      };
      return row;
    }));
  }

  const eff = resolveEffectiveEngine(state.settings);
  const dot = $('#bw-status-dot');
  const title = $('#bw-engine-title');
  const sub = $('#bw-engine-sub');
  const engObj = ENGINES.find(e => e.id === eff) || ENGINES[0];
  dot.className = `bw-status-dot${eff === 'demo' ? ' is-demo' : ''}`;
  title.textContent = eff === 'demo' ? 'Demo Studio (Live)' : engObj.label;
  sub.textContent = eff === 'mac'
    ? state.settings.macUrl || 'Paired Mac Host'
    : eff === 'demo'
      ? 'Instant · Add API key or Mac Host'
      : `Direct SSE · ${modelLabel(state.settings.model)}`;
}

function renderMainStream(): void {
  const main = $('#bw-main');
  const scroll = $('#bw-scroll');
  const thread = activeThread();
  const path = thread ? getActivePath(thread) : [];
  $('#bw-chat-title').textContent = thread ? thread.title : 'Baryon Studio';

  const wasAtBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 90;

  if (!path.length) {
    main.classList.add('is-home');
    scroll.innerHTML = `
      <div class="bw-home">
        <img class="bw-home-emblem" src="/icon.png" alt="Baryon" />
        <h1>What should we explore next?</h1>
        <p>Stratus-dark AI workspace with branching conversation timelines, 3-model <code>/fanout</code> arena racing, live HTML/SVG artifacts, and Mac Host pairing.</p>
        <div class="bw-starter-grid" id="bw-starters"></div>
      </div>
    `;
    const grid = $('#bw-starters');
    STARTER_PROMPTS.forEach(item => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bw-starter-card';
      btn.innerHTML = `
        <div class="bw-starter-head">
          <strong>${escapeHtml(item.title)}</strong>
          <span class="bw-starter-tag">${escapeHtml(item.tag)}</span>
        </div>
        <span class="bw-starter-desc">${escapeHtml(item.desc)}</span>
      `;
      btn.onclick = () => {
        fanoutMode = item.fanout;
        updateComposerControls();
        void submitPrompt(item.prompt);
      };
      grid.append(btn);
    });
    return;
  }

  main.classList.remove('is-home');
  const wrap = document.createElement('div');
  wrap.className = 'bw-stream';
  const currentThread = thread!;

  path.forEach(node => {
    const el = document.createElement('article');
    el.className = `bw-msg ${node.role === 'user' ? 'is-user' : 'is-assistant'}`;
    el.dataset.nodeId = node.id;

    if (node.role === 'user') {
      const sib = getSiblingInfo(currentThread, node.id);
      const bubble = document.createElement('div');
      bubble.className = 'bw-user-bubble';
      bubble.textContent = node.content;
      el.append(bubble);

      if (sib.total > 1) {
        el.append(buildBranchNav(currentThread, sib));
      }
    } else {
      const card = document.createElement('div');
      card.className = 'bw-assistant-card';
      const head = document.createElement('div');
      head.className = 'bw-msg-head';
      const mdl = document.createElement('span');
      mdl.className = 'bw-msg-model';
      mdl.textContent = node.candidates
        ? `/fanout Arena · ${node.candidates.length} models`
        : modelLabel(node.model);
      head.append(mdl);

      const sib = getSiblingInfo(currentThread, node.id);
      if (sib.total > 1) head.append(buildBranchNav(currentThread, sib));
      card.append(head);

      if (Array.isArray(node.candidates) && node.candidates.length) {
        const grid = document.createElement('div');
        grid.className = 'bw-fanout-grid';
        node.candidates.forEach((cand, idx) => {
          const isWin = node.chosenCandidateIndex === idx;
          const col = document.createElement('div');
          col.className = `bw-fanout-card${isWin ? ' is-winner' : ''}`;
          const stats = cand.meta ? `${cand.meta.elapsedMs}ms · ${cand.meta.tokPerSec}/s` : 'streaming…';
          col.innerHTML = `
            <div class="bw-fanout-head">
              <strong>${escapeHtml(modelLabel(cand.model))}</strong>
              <span class="bw-fanout-stats">${escapeHtml(stats)}</span>
            </div>
            <div class="bw-fanout-body bw-prose">${renderMarkdown(cand.content || 'Thinking…', { messageId: `${node.id}:${idx}` })}</div>
            <button type="button" class="bw-fanout-pick">${isWin ? 'Winner Selected ✓' : 'Use Winner & Continue'}</button>
          `;
          col.querySelector<HTMLButtonElement>('.bw-fanout-pick')!.onclick = () => {
            chooseFanoutWinner(node, idx);
            persist();
            renderAll();
          };
          grid.append(col);
        });
        card.append(grid);
      } else {
        const prose = document.createElement('div');
        prose.className = 'bw-prose';
        prose.innerHTML = renderMarkdown(node.content || (node.streaming ? 'Thinking…' : ''), { messageId: node.id });
        card.append(prose);
      }

      if (!node.streaming) {
        const actions = document.createElement('div');
        actions.className = 'bw-msg-actions';

        const addAct = (label: string, handler: () => void | Promise<void>) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'bw-act-btn';
          b.textContent = label;
          b.onclick = handler;
          actions.append(b);
        };

        addAct('Copy', async () => {
          try { await navigator.clipboard?.writeText(node.content || ''); } catch {}
        });

        addAct('Fork Branch ⑂', () => {
          const altPrompt = window.prompt('Fork timeline from previous turn with a new prompt:', path.find(n => n.id === node.parentId)?.content || '');
          if (altPrompt && altPrompt.trim()) {
            const forkParentId = node.parentId ? currentThread.nodes[node.parentId]?.parentId || null : null;
            void submitPrompt(altPrompt.trim(), { overrideParentId: forkParentId });
          }
        });

        addAct('Regenerate ↻', () => {
          const userNode = node.parentId ? currentThread.nodes[node.parentId] : undefined;
          if (userNode) void regenerateFromUserNode(currentThread, userNode);
        });

        if ('speechSynthesis' in window) {
          addAct('Speak ♪', () => {
            window.speechSynthesis.cancel();
            const utter = new SpeechSynthesisUtterance((node.content || '').replace(/```[\s\S]*?```/g, 'Code block omitted.').slice(0, 1200));
            window.speechSynthesis.speak(utter);
          });
        }

        const arts = extractArtifacts(node.content || '');
        if (arts.length) {
          addAct('Open Artifact ◈', () => openArtifact(arts[0]));
        }

        if (node.meta) {
          const stat = document.createElement('span');
          stat.className = 'bw-telemetry';
          stat.textContent = `${node.meta.elapsedMs}ms · ${node.meta.tokPerSec} tok/s`;
          actions.append(stat);
        }
        card.append(actions);
      }
      el.append(card);
    }
    wrap.append(el);
  });

  scroll.replaceChildren(wrap);
  if (wasAtBottom || streamingCtrl) {
    scroll.scrollTop = scroll.scrollHeight;
  }
}

function buildBranchNav(thread: Thread, sib: SiblingInfo): HTMLSpanElement {
  const nav = document.createElement('span');
  nav.className = 'bw-branch-nav';
  const prev = document.createElement('button');
  prev.type = 'button';
  prev.textContent = '‹';
  prev.onclick = () => {
    const nextIdx = (sib.index - 1 + sib.total) % sib.total;
    selectBranchNode(thread, sib.siblings[nextIdx]);
    persist();
    renderAll();
  };
  const label = document.createElement('span');
  label.textContent = `${sib.index + 1}/${sib.total}`;
  const next = document.createElement('button');
  next.type = 'button';
  next.textContent = '›';
  next.onclick = () => {
    const nextIdx = (sib.index + 1) % sib.total;
    selectBranchNode(thread, sib.siblings[nextIdx]);
    persist();
    renderAll();
  };
  nav.append(prev, label, next);
  return nav;
}

function openArtifact(art: MarkdownArtifact): void {
  activeArtifact = art;
  inspectorTab = 'artifact';
  inspectorOpen = true;
  renderAll();
}

function renderInspector(): void {
  const shell = $('#bw-shell');
  shell.classList.toggle('is-inspector-open', inspectorOpen);
  shell.classList.toggle('is-mobile-side-open', mobileSideOpen);
  shell.classList.toggle('is-sidebar-collapsed', sidebarCollapsed);
  $('#bw-scrim').hidden = !(mobileSideOpen || (inspectorOpen && window.innerWidth <= 1120));

  document.querySelectorAll<HTMLButtonElement>('.bw-tab[data-insp]').forEach(tab => {
    tab.classList.toggle('is-active', tab.dataset.insp === inspectorTab);
  });
  $('#bw-tab-branches').classList.toggle('is-active', inspectorOpen && inspectorTab === 'branches');
  $('#bw-tab-artifact').classList.toggle('is-active', inspectorOpen && inspectorTab === 'artifact');
  $('#bw-tab-side').classList.toggle('is-active', inspectorOpen && inspectorTab === 'side');

  if (!inspectorOpen) return;
  const body = $('#bw-insp-body');
  body.replaceChildren();

  if (inspectorTab === 'artifact') {
    if (!activeArtifact) {
      body.innerHTML = `<div style="margin:auto;text-align:center;color:var(--dim);font-size:13px;max-width:260px">Ask Baryon to generate an HTML dashboard or SVG diagram, or click <b>Run Artifact ↗</b> on any code block to launch the sandboxed preview here.</div>`;
      return;
    }
    const art = activeArtifact;
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px';
    const title = document.createElement('strong');
    title.style.fontSize = '13px';
    title.textContent = art.title;
    const btns = document.createElement('div');
    btns.style.cssText = 'display:flex;gap:6px';
    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'bw-act-btn';
    toggleBtn.textContent = artifactShowCode ? 'Preview' : 'Source';
    toggleBtn.onclick = () => { artifactShowCode = !artifactShowCode; renderInspector(); };

    const dlBtn = document.createElement('button');
    dlBtn.type = 'button';
    dlBtn.className = 'bw-act-btn';
    dlBtn.textContent = 'Download';
    dlBtn.onclick = () => {
      const blob = new Blob([buildArtifactSrcdoc(art)], { type: 'text/html' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `baryon-artifact.${art.lang === 'svg' ? 'html' : 'html'}`;
      a.click();
    };
    btns.append(toggleBtn, dlBtn);
    bar.append(title, btns);
    body.append(bar);

    if (artifactShowCode) {
      const pre = document.createElement('pre');
      pre.style.cssText = 'flex:1;overflow:auto;margin:0;padding:12px;border-radius:12px;background:var(--well);border:1px solid var(--line);font-size:12px;color:#e4e9f5';
      pre.textContent = art.code;
      body.append(pre);
    } else {
      const iframe = document.createElement('iframe');
      iframe.className = 'bw-artifact-frame';
      iframe.setAttribute('sandbox', 'allow-scripts');
      iframe.srcdoc = buildArtifactSrcdoc(art);
      body.append(iframe);
    }
    return;
  }

  if (inspectorTab === 'branches') {
    const thread = activeThread();
    if (!thread || !Object.keys(thread.nodes).length) {
      body.innerHTML = `<div style="color:var(--dim);font-size:13px">Start a conversation to inspect its DAG branch tree.</div>`;
      return;
    }
    const activeSet = new Set(getActivePath(thread).map(n => n.id));
    const list = document.createElement('div');
    list.className = 'bw-branch-list';

    function walk(nodeId: string, depth: number): void {
      if (!thread) return;
      const node = thread.nodes[nodeId];
      if (!node) return;
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `bw-branch-node${activeSet.has(node.id) ? ' is-on-path' : ''}`;
      item.style.marginLeft = `${Math.min(depth, 5) * 14}px`;
      item.innerHTML = `
        <strong>${node.role === 'user' ? 'Prompt' : modelLabel(node.model)} ${activeSet.has(node.id) ? '· Active' : ''}</strong>
        <span>${escapeHtml((node.content || '').slice(0, 90))}</span>
      `;
      item.onclick = () => {
        selectBranchNode(thread, node.id);
        persist();
        renderAll();
      };
      list.append(item);
      for (const cid of node.childrenIds || []) walk(cid, depth + 1);
    }
    for (const rid of thread.rootNodeIds || []) walk(rid, 0);
    body.append(list);
    return;
  }

  // Ephemeral Side Chat
  const note = document.createElement('div');
  note.style.cssText = 'display:flex;align-items:center;justify-content:space-between;font-size:12px;color:var(--dim)';
  note.innerHTML = '<span>Ephemeral scratchpad — never enters main timeline</span>';
  const clearSide = document.createElement('button');
  clearSide.type = 'button';
  clearSide.className = 'bw-act-btn';
  clearSide.textContent = 'Clear';
  clearSide.onclick = () => { state.sideChat = []; persist(); renderInspector(); };
  note.append(clearSide);
  body.append(note);

  const log = document.createElement('div');
  log.className = 'bw-side-log';
  if (!state.sideChat.length) {
    log.innerHTML = `<div style="color:var(--muted);font-size:12.5px">Ask quick side definitions, unit checks, or regex tests here.</div>`;
  } else {
    state.sideChat.forEach(msg => {
      const b = document.createElement('div');
      b.className = `bw-side-msg${msg.role === 'user' ? ' is-user' : ''}`;
      b.innerHTML = msg.role === 'user' ? escapeHtml(msg.content) : renderMarkdown(msg.content);
      log.append(b);
    });
  }
  const form = document.createElement('form');
  form.className = 'bw-side-form';
  const input = document.createElement('input');
  input.placeholder = 'Side question…';
  const go = document.createElement('button');
  go.type = 'submit';
  go.className = 'bw-send-btn';
  go.textContent = '↑';
  form.append(input, go);
  form.onsubmit = async e => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    input.value = '';
    state.sideChat.push({ role: 'user', content: q });
    const reply: SideChatMessage = { role: 'assistant', content: 'Thinking…' };
    state.sideChat.push(reply);
    renderInspector();
    try {
      const res = await streamCompletion({
        settings: state.settings,
        history: state.sideChat.slice(0, -1),
        model: state.settings.model,
        onChunk: txt => { reply.content = txt; renderInspector(); },
      });
      reply.content = res.text;
    } catch (err: unknown) {
      reply.content = `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
    persist();
    renderInspector();
  };
  body.append(log, form);
  log.scrollTop = log.scrollHeight;
}

function updateComposerControls(): void {
  ensureValidSelectedModel();
  const sel = $<HTMLSelectElement>('#bw-model-select');
  sel.innerHTML = availableModels()
    .map(m => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.label)}</option>`)
    .join('');
  sel.value = state.settings.model;

  $('#bw-fanout-btn').classList.toggle('is-on', fanoutMode);
  $('#bw-effort-btn').textContent = `Effort: ${state.settings.effort}`;

  const sendBtn = $('#bw-send-btn');
  if (streamingCtrl) {
    sendBtn.textContent = 'Stop ■';
    sendBtn.classList.add('is-stop');
  } else {
    sendBtn.textContent = fanoutMode ? 'Race 3 Models ↑' : 'Send ↑';
    sendBtn.classList.remove('is-stop');
  }

  const qBanner = $('#bw-queue-banner');
  if (queuedTurn) {
    qBanner.hidden = false;
    $('#bw-queue-text').textContent = `Queued next turn: “${queuedTurn.slice(0, 64)}”`;
  } else {
    qBanner.hidden = true;
  }
}

function renderAll(): void {
  renderSidebar();
  renderMainStream();
  renderInspector();
  updateComposerControls();
}

async function runSingleTurn(thread: Thread, userNode: ThreadNode, modelId: string): Promise<void> {
  const assistantNode = appendNode(thread, {
    parentId: userNode.id,
    role: 'assistant',
    content: '',
    model: modelId,
  });
  assistantNode.streaming = true;
  renderMainStream();

  const path = getActivePath(thread).slice(0, -1);
  const history = buildApiHistory(path);
  streamingCtrl = new AbortController();
  updateComposerControls();

  try {
    const res = await streamCompletion({
      settings: state.settings,
      history,
      model: modelId,
      signal: streamingCtrl.signal,
      onChunk: txt => {
        assistantNode.content = txt;
        renderMainStream();
      },
    });
    assistantNode.content = res.text;
    assistantNode.meta = res.meta;
    const arts = extractArtifacts(res.text);
    if (arts.length) {
      activeArtifact = arts[0];
      if (!isCompactViewport()) {
        inspectorTab = 'artifact';
        inspectorOpen = true;
      }
    }
  } catch (err: unknown) {
    const isAbort = (err instanceof Error || err instanceof DOMException) && err.name === 'AbortError';
    if (isAbort) {
      assistantNode.content = assistantNode.content || '*Stopped.*';
    } else {
      const message = err instanceof Error ? err.message : String(err);
      assistantNode.content = `**Request failed:** ${message}\n\nCheck your API key / endpoint in **Settings** or switch back to **Demo Studio**.`;
    }
  } finally {
    delete assistantNode.streaming;
    streamingCtrl = null;
    persist();
    renderAll();
    if (queuedTurn) {
      const nextText = queuedTurn;
      queuedTurn = null;
      await submitPrompt(nextText);
    }
  }
}

async function runFanoutTurn(thread: Thread, userNode: ThreadNode): Promise<void> {
  const eff = resolveEffectiveEngine(state.settings);
  const models = eff === 'demo'
    ? ['gemini-neon', 'claude-fable', 'gpt-astra']
    : [state.settings.model, ...availableModels().map(m => m.id).filter(x => x !== state.settings.model)].slice(0, 3);
  const candidates: FanoutCandidate[] = models.map(m => ({ model: m, content: '', meta: null }));

  const assistantNode = appendNode(thread, {
    parentId: userNode.id,
    role: 'assistant',
    content: '',
    model: models[0],
    candidates,
  });
  assistantNode.streaming = true;
  renderMainStream();

  const path = getActivePath(thread).slice(0, -1);
  const history = buildApiHistory(path);
  streamingCtrl = new AbortController();
  updateComposerControls();

  try {
    await Promise.all(candidates.map(async cand => {
      try {
        const res = await streamCompletion({
          settings: state.settings,
          history,
          model: cand.model,
          fanout: true,
          signal: streamingCtrl?.signal,
          onChunk: txt => {
            cand.content = txt;
            renderMainStream();
          },
        });
        cand.content = res.text;
        cand.meta = res.meta;
      } catch (err: unknown) {
        const isAbort = (err instanceof Error || err instanceof DOMException) && err.name === 'AbortError';
        cand.content = isAbort ? '*Stopped.*' : `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    }));
    chooseFanoutWinner(assistantNode, 0);
  } finally {
    delete assistantNode.streaming;
    streamingCtrl = null;
    persist();
    renderAll();
  }
}

async function regenerateFromUserNode(thread: Thread, userNode: ThreadNode): Promise<void> {
  if (streamingCtrl) return;
  if (fanoutMode) await runFanoutTurn(thread, userNode);
  else await runSingleTurn(thread, userNode, state.settings.model);
}

async function submitPrompt(
  rawText: string,
  { overrideParentId = undefined }: { overrideParentId?: string | null } = {},
): Promise<void> {
  const text = String(rawText || '').trim();
  if (!text) return;

  // Handle slash commands directly
  if (text === '/fanout') { fanoutMode = !fanoutMode; updateComposerControls(); return; }
  if (text === '/side') { inspectorTab = 'side'; inspectorOpen = true; renderAll(); return; }
  if (text === '/artifact') { inspectorTab = 'artifact'; inspectorOpen = true; renderAll(); return; }
  if (text === '/branches') { inspectorTab = 'branches'; inspectorOpen = true; renderAll(); return; }
  if (text === '/connect') { openSettingsModal(); return; }
  if (text === '/export') { exportCurrentBranch(); return; }

  if (streamingCtrl) {
    queuedTurn = text;
    updateComposerControls();
    return;
  }

  let useFanout = fanoutMode;
  let cleanText = text;
  if (cleanText.startsWith('/fanout ')) {
    useFanout = true;
    cleanText = cleanText.slice(8).trim();
  }

  let thread = activeThread();
  if (!thread) {
    thread = createThread(state, { title: cleanText.slice(0, 48) });
  } else if (!thread.rootNodeIds.length) {
    thread.title = cleanText.slice(0, 48);
  }

  const parentId = overrideParentId !== undefined ? overrideParentId : thread.activeLeafId;
  const userNode = appendNode(thread, {
    parentId,
    role: 'user',
    content: cleanText,
  });
  persist();
  renderAll();

  if (useFanout) await runFanoutTurn(thread, userNode);
  else await runSingleTurn(thread, userNode, state.settings.model);
}

function exportCurrentBranch(): void {
  const thread = activeThread();
  if (!thread) return;
  const md = getActivePath(thread)
    .map(n => `## ${n.role === 'user' ? 'You' : modelLabel(n.model)}\n\n${n.content}`)
    .join('\n\n---\n\n');
  const blob = new Blob([md], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(thread.title || 'baryon-chat').replace(/[^a-z0-9-_]+/gi, '-')}.md`;
  a.click();
}

function openSettingsModal(): void {
  const modal = $<HTMLDialogElement>('#bw-settings-modal');
  const body = $('#bw-settings-body');
  const s = state.settings;
  body.innerHTML = `
    <div class="bw-field">
      <label for="cfg-engine">Active AI Engine</label>
      <select id="cfg-engine">
        ${ENGINES.map(e => `<option value="${e.id}" ${s.engine === e.id ? 'selected' : ''}>${escapeHtml(e.label)} — ${escapeHtml(e.badge)}</option>`).join('')}
      </select>
    </div>
    <p id="cfg-note" style="margin:0;font-size:12px;color:var(--dim)"></p>
    <div class="bw-field"><label for="cfg-gemini">Gemini API Key (saved locally in browser)</label><input id="cfg-gemini" type="password" value="${escapeHtml(s.geminiKey || '')}" placeholder="AIza..." /></div>
    <div class="bw-field"><label for="cfg-openai">OpenAI API Key</label><input id="cfg-openai" type="password" value="${escapeHtml(s.openaiKey || '')}" placeholder="sk-..." /></div>
    <div class="bw-field"><label for="cfg-claude">Anthropic Claude API Key</label><input id="cfg-claude" type="password" value="${escapeHtml(s.claudeKey || '')}" placeholder="sk-ant-..." /></div>
    <div class="bw-field"><label for="cfg-deepseek">DeepSeek API Key</label><input id="cfg-deepseek" type="password" value="${escapeHtml(s.deepseekKey || '')}" placeholder="sk-..." /></div>
    <div class="bw-field"><label for="cfg-custom-url">Custom OpenAI-Compatible Endpoint</label><input id="cfg-custom-url" type="url" value="${escapeHtml(s.customUrl || '')}" placeholder="https://openrouter.ai/api/v1" /></div>
    <div class="bw-field"><label for="cfg-custom-model">Custom Model ID</label><input id="cfg-custom-model" type="text" value="${escapeHtml(s.customModel || '')}" placeholder="anthropic/claude-sonnet-4.5" /></div>
    <hr style="border:0;border-top:1px solid var(--line);width:100%" />
    <div class="bw-field"><label for="cfg-mac-url">Baryon Mac Host URL (Tailscale / HTTPS)</label><input id="cfg-mac-url" type="url" value="${escapeHtml(s.macUrl || '')}" placeholder="https://mac.tailnet.ts.net:3847" /></div>
    <div class="bw-field"><label for="cfg-mac-token">Mac Host Pairing Token</label><input id="cfg-mac-token" type="password" value="${escapeHtml(s.macToken || '')}" placeholder="Bearer token" /></div>
    <div style="display:flex;align-items:center;gap:10px">
      <button type="button" class="bw-pill-btn" id="cfg-mac-test">Test Mac Connection</button>
      <span id="cfg-mac-status" style="font-size:12px;color:var(--dim)"></span>
    </div>
    <div class="bw-field"><label for="cfg-sys">Custom System Prompt (optional)</label><textarea id="cfg-sys" rows="2" placeholder="Concise, direct engineering partner…">${escapeHtml(s.systemPrompt || '')}</textarea></div>
  `;

  const syncNote = () => {
    const engineSelect = $<HTMLSelectElement>('#cfg-engine');
    const chosen = ENGINES.find(e => e.id === engineSelect.value) || ENGINES[0];
    $('#cfg-note').textContent = chosen.note;
  };
  $<HTMLSelectElement>('#cfg-engine').onchange = syncNote;
  syncNote();

  $('#cfg-mac-test').onclick = async () => {
    const out = $('#cfg-mac-status');
    out.textContent = 'Testing…';
    try {
      const info = await testMacHostConnection(
        $<HTMLInputElement>('#cfg-mac-url').value,
        $<HTMLInputElement>('#cfg-mac-token').value,
      );
      out.style.color = 'var(--added)';
      out.textContent = `Connected (${info.name || 'Baryon Mac'})`;
    } catch (err: unknown) {
      out.style.color = 'var(--removed)';
      out.textContent = `Failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  };

  modal.showModal();
}

function saveSettingsModal(): void {
  state.settings.engine = $<HTMLSelectElement>('#cfg-engine').value as EngineId;
  state.settings.geminiKey = $<HTMLInputElement>('#cfg-gemini').value.trim();
  state.settings.openaiKey = $<HTMLInputElement>('#cfg-openai').value.trim();
  state.settings.claudeKey = $<HTMLInputElement>('#cfg-claude').value.trim();
  state.settings.deepseekKey = $<HTMLInputElement>('#cfg-deepseek').value.trim();
  state.settings.customUrl = $<HTMLInputElement>('#cfg-custom-url').value.trim();
  state.settings.customModel = $<HTMLInputElement>('#cfg-custom-model').value.trim();
  state.settings.macUrl = $<HTMLInputElement>('#cfg-mac-url').value.trim();
  state.settings.macToken = $<HTMLInputElement>('#cfg-mac-token').value.trim();
  state.settings.systemPrompt = $<HTMLTextAreaElement>('#bw-settings-body #cfg-sys').value;
  ensureValidSelectedModel();
  persist();
  $<HTMLDialogElement>('#bw-settings-modal').close();
  renderAll();
}

function openPalette(): void {
  const modal = $<HTMLDialogElement>('#bw-palette-modal');
  const input = $<HTMLInputElement>('#bw-palette-input');
  const list = $('#bw-palette-list');
  input.value = '';
  const items: Array<{ label: string; run: () => void | Promise<void> }> = [
    ...SLASH_COMMANDS.map(c => ({ label: `${c.cmd} — ${c.desc}`, run: () => submitPrompt(c.cmd) })),
    ...state.threadOrder.map(id => state.threads[id]).filter(Boolean).map(t => ({
      label: `Thread: ${t.title}`,
      run: () => { state.activeThreadId = t.id; persist(); renderAll(); },
    })),
  ];
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    const shown = items.filter(i => !q || i.label.toLowerCase().includes(q)).slice(0, 14);
    list.replaceChildren(...shown.map(it => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bw-slash-item';
      btn.textContent = it.label;
      btn.onclick = () => { modal.close(); void it.run(); };
      return btn;
    }));
  };
  input.oninput = draw;
  draw();
  modal.showModal();
  input.focus();
}

function updateSlashMenu(): void {
  const input = $<HTMLTextAreaElement>('#bw-input');
  const val = input.value;
  const menu = $('#bw-slash-menu');
  if (!val.startsWith('/') || val.includes(' ')) {
    menu.hidden = true;
    return;
  }
  const matches = SLASH_COMMANDS.filter(c => c.cmd.startsWith(val.toLowerCase()));
  if (!matches.length) { menu.hidden = true; return; }
  slashIndex = Math.min(slashIndex, matches.length - 1);
  menu.replaceChildren(...matches.map((m, idx) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `bw-slash-item${idx === slashIndex ? ' is-selected' : ''}`;
    row.innerHTML = `<code>${escapeHtml(m.cmd)}</code><span>${escapeHtml(m.desc)}</span>`;
    row.onclick = () => {
      menu.hidden = true;
      input.value = m.cmd === '/fanout' ? '/fanout ' : '';
      if (m.cmd !== '/fanout') void submitPrompt(m.cmd);
      else input.focus();
    };
    return row;
  }));
  menu.hidden = false;
}

function bindEvents(): void {
  const input = $<HTMLTextAreaElement>('#bw-input');

  $('#bw-new-thread').onclick = () => {
    createThread(state, { title: 'New thread' });
    mobileSideOpen = false;
    persist();
    renderAll();
    input.focus();
  };
  $<HTMLInputElement>('#bw-thread-search').oninput = e => {
    searchQuery = (e.target as HTMLInputElement).value;
    renderSidebar();
  };
  $('#bw-open-settings').onclick = openSettingsModal;
  $('#bw-settings-close').onclick = () => $<HTMLDialogElement>('#bw-settings-modal').close();
  $('#bw-settings-cancel').onclick = () => $<HTMLDialogElement>('#bw-settings-modal').close();
  $('#bw-settings-save').onclick = saveSettingsModal;

  $('#bw-open-palette').onclick = openPalette;
  $('#bw-palette-close').onclick = () => $<HTMLDialogElement>('#bw-palette-modal').close();

  $('#bw-toggle-side').onclick = () => {
    if (isCompactViewport()) mobileSideOpen = !mobileSideOpen;
    else sidebarCollapsed = !sidebarCollapsed;
    renderInspector();
  };
  $('#bw-scrim').onclick = () => {
    mobileSideOpen = false;
    if (window.innerWidth <= 1120) inspectorOpen = false;
    renderInspector();
  };

  const tabBindings: Array<[string, InspectorTab]> = [
    ['#bw-tab-artifact', 'artifact'],
    ['#bw-tab-branches', 'branches'],
    ['#bw-tab-side', 'side'],
  ];
  for (const [id, tab] of tabBindings) {
    $(id).onclick = () => {
      if (inspectorOpen && inspectorTab === tab) inspectorOpen = false;
      else { inspectorTab = tab; inspectorOpen = true; }
      renderInspector();
    };
  }
  document.querySelectorAll<HTMLButtonElement>('.bw-tab[data-insp]').forEach(btn => {
    btn.onclick = () => { inspectorTab = (btn.dataset.insp as InspectorTab) || 'artifact'; renderInspector(); };
  });
  $('#bw-close-insp').onclick = () => { inspectorOpen = false; renderInspector(); };

  $<HTMLSelectElement>('#bw-model-select').onchange = e => {
    state.settings.model = (e.target as HTMLSelectElement).value;
    persist();
    renderSidebar();
  };
  $('#bw-fanout-btn').onclick = () => {
    fanoutMode = !fanoutMode;
    updateComposerControls();
  };
  $('#bw-effort-btn').onclick = () => {
    const order: EffortLevel[] = ['low', 'medium', 'high'];
    state.settings.effort = order[(order.indexOf(state.settings.effort as EffortLevel) + 1) % order.length];
    persist();
    updateComposerControls();
  };
  $('#bw-queue-clear').onclick = () => { queuedTurn = null; updateComposerControls(); };

  // Voice dictation (Web Speech API)
  const speechWin = window as SpeechWindow;
  const SpeechRec = speechWin.SpeechRecognition || speechWin.webkitSpeechRecognition;
  let rec: SpeechRecognitionInstance | null = null;
  $('#bw-mic-btn').onclick = () => {
    if (!SpeechRec) return alert('Speech dictation requires Safari/Chrome SpeechRecognition support.');
    if (rec) { rec.stop(); rec = null; $('#bw-mic-btn').classList.remove('is-on'); return; }
    rec = new SpeechRec();
    rec.continuous = false;
    rec.interimResults = true;
    $('#bw-mic-btn').classList.add('is-on');
    rec.onresult = evt => {
      const text = Array.from(evt.results).map(r => r[0].transcript).join('');
      input.value = text;
    };
    rec.onend = () => { rec = null; $('#bw-mic-btn').classList.remove('is-on'); };
    rec.start();
  };

  input.oninput = () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(190, input.scrollHeight)}px`;
    updateSlashMenu();
  };
  input.onkeydown = e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (e.altKey && streamingCtrl) {
        // Steer: abort current generation and immediately submit follow-up
        queuedTurn = input.value;
        input.value = '';
        input.style.height = 'auto';
        streamingCtrl.abort();
        return;
      }
      const val = input.value;
      input.value = '';
      input.style.height = 'auto';
      $('#bw-slash-menu').hidden = true;
      void submitPrompt(val);
    }
  };

  $('#bw-send-btn').onclick = () => {
    if (streamingCtrl) {
      streamingCtrl.abort();
      return;
    }
    const val = input.value;
    input.value = '';
    input.style.height = 'auto';
    $('#bw-slash-menu').hidden = true;
    void submitPrompt(val);
  };

  // Delegated click handlers inside stream for Copy & Run Artifact buttons
  $('#bw-scroll').addEventListener('click', async e => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const copyBtn = target.closest<HTMLElement>('[data-copy-code]');
    if (copyBtn) {
      const code = decodeURIComponent(copyBtn.dataset.copyCode || '');
      try { await navigator.clipboard?.writeText(code); } catch {}
      copyBtn.textContent = 'Copied ✓';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1200);
      return;
    }
    const artBtn = target.closest<HTMLElement>('[data-run-artifact]');
    if (artBtn) {
      const msgKey = artBtn.dataset.msg || '';
      const artIdx = Number(artBtn.dataset.runArtifact || 0);
      const thread = activeThread();
      if (!thread) return;
      const [nodeId, candIdx] = msgKey.split(':');
      const node = thread.nodes[nodeId];
      if (!node) return;
      const md = candIdx !== undefined ? node.candidates?.[Number(candIdx)]?.content : node.content;
      const arts = extractArtifacts(md || '');
      if (arts[artIdx]) openArtifact(arts[artIdx]);
    }
  });

  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openPalette();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      $('#bw-new-thread').click();
    }
  });

  window.addEventListener('resize', () => renderInspector());
}

void uid;
buildShell();
bindEvents();
renderAll();
