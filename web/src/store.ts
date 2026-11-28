// Tree-based (DAG) conversation store for Baryon Web with branching, /fanout arena,
// Queue/Steer turn control, and ephemeral Side Chat state. Pure and Node-testable.

export const WEB_STORAGE_KEY = 'baryon-web-v1';

export type EngineId = 'demo' | 'gemini' | 'openai' | 'claude' | 'deepseek' | 'custom' | 'mac';
export type EffortLevel = 'low' | 'medium' | 'high';
export type NodeRole = 'user' | 'assistant' | 'system';

export interface NodeMeta {
  elapsedMs: number;
  approxTokens: number;
  tokPerSec: number;
}

export interface FanoutCandidate {
  model: string;
  content: string;
  meta: NodeMeta | null;
}

export interface ThreadNode {
  id: string;
  parentId: string | null;
  childrenIds: string[];
  role: NodeRole;
  content: string;
  model: string;
  mode: string;
  meta: NodeMeta | null;
  candidates: FanoutCandidate[] | null;
  chosenCandidateIndex: number | null;
  createdAt: number;
  streaming?: boolean;
}

export interface Thread {
  id: string;
  title: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  rootNodeIds: string[];
  nodes: Record<string, ThreadNode>;
  activeLeafId: string | null;
  selectedBranchAtParent: Record<string, string>;
}

export interface SideChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface WebSettings {
  engine: EngineId;
  model: string;
  effort: EffortLevel;
  fanoutModels?: string[];
  geminiKey: string;
  openaiKey: string;
  claudeKey: string;
  deepseekKey: string;
  customUrl: string;
  customKey: string;
  customModel: string;
  macUrl: string;
  macToken: string;
  speakReplies?: boolean;
  systemPrompt: string;
}

export interface WebStoreState {
  version: number;
  activeThreadId: string | null;
  threads: Record<string, Thread>;
  threadOrder: string[];
  sideChat: SideChatMessage[];
  settings: WebSettings;
}

export interface StorageLike {
  getItem?: (key: string) => string | null;
  setItem?: (key: string, value: string) => void;
}

export interface CreateThreadOptions {
  title?: string;
  model?: string;
}

export interface AppendNodeOptions {
  parentId?: string | null;
  role: NodeRole;
  content?: string;
  model?: string;
  mode?: string;
  meta?: NodeMeta | null;
  candidates?: FanoutCandidate[] | null;
}

export interface SiblingInfo {
  index: number;
  total: number;
  siblings: string[];
}

export interface ApiHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function uid(prefix = 'n'): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createEmptyState(): WebStoreState {
  return {
    version: 1,
    activeThreadId: null,
    threads: {},
    threadOrder: [],
    sideChat: [],
    settings: {
      engine: 'demo', // 'demo' | 'gemini' | 'openai' | 'claude' | 'deepseek' | 'custom' | 'mac'
      model: 'baryon-stratus',
      effort: 'medium', // 'low' | 'medium' | 'high'
      fanoutModels: ['gemini-neon', 'claude-fable', 'gpt-astra'],
      geminiKey: '',
      openaiKey: '',
      claudeKey: '',
      deepseekKey: '',
      customUrl: '',
      customKey: '',
      customModel: '',
      macUrl: '',
      macToken: '',
      speakReplies: false,
      systemPrompt: '',
    },
  };
}

export function loadState(storage: StorageLike | null | undefined = globalThis.localStorage): WebStoreState {
  const base = createEmptyState();
  try {
    const raw = storage?.getItem?.(WEB_STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<WebStoreState>;
    return {
      ...base,
      ...parsed,
      settings: { ...base.settings, ...(parsed.settings || {}) },
      threads: parsed.threads && typeof parsed.threads === 'object' ? parsed.threads : {},
      threadOrder: Array.isArray(parsed.threadOrder) ? parsed.threadOrder : [],
      sideChat: Array.isArray(parsed.sideChat) ? parsed.sideChat : [],
    };
  } catch {
    return base;
  }
}

export function saveState(
  state: WebStoreState,
  storage: StorageLike | null | undefined = globalThis.localStorage
): void {
  try {
    storage?.setItem?.(WEB_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore quota errors in private browsing.
  }
}

export function createThread(
  state: WebStoreState,
  { title = 'New thread', model }: CreateThreadOptions = {}
): Thread {
  const id = uid('t');
  const now = Date.now();
  const thread: Thread = {
    id,
    title,
    pinned: false,
    createdAt: now,
    updatedAt: now,
    rootNodeIds: [],
    nodes: {},
    activeLeafId: null,
    selectedBranchAtParent: {}, // parentId (or '__root__') -> childNodeId
  };
  state.threads[id] = thread;
  state.threadOrder = [id, ...state.threadOrder.filter(x => x !== id)];
  state.activeThreadId = id;
  if (model) state.settings.model = model;
  return thread;
}

export function deleteThread(state: WebStoreState, threadId: string): void {
  delete state.threads[threadId];
  state.threadOrder = state.threadOrder.filter(id => id !== threadId);
  if (state.activeThreadId === threadId) {
    state.activeThreadId = state.threadOrder[0] || null;
  }
}

export function togglePinThread(state: WebStoreState, threadId: string): boolean {
  const thread = state.threads[threadId];
  if (!thread) return false;
  thread.pinned = !thread.pinned;
  thread.updatedAt = Date.now();
  return thread.pinned;
}

export function appendNode(
  thread: Thread,
  {
    parentId = null,
    role,
    content = '',
    model = '',
    mode = 'chat',
    meta = null,
    candidates = null, // For /fanout comparison turns
  }: AppendNodeOptions = {} as AppendNodeOptions
): ThreadNode {
  const id = uid('m');
  const node: ThreadNode = {
    id,
    parentId: parentId || null,
    childrenIds: [],
    role,
    content,
    model,
    mode,
    meta,
    candidates,
    chosenCandidateIndex: candidates ? 0 : null,
    createdAt: Date.now(),
  };
  thread.nodes[id] = node;
  if (node.parentId && thread.nodes[node.parentId]) {
    thread.nodes[node.parentId].childrenIds.push(id);
    thread.selectedBranchAtParent[node.parentId] = id;
  } else {
    thread.rootNodeIds.push(id);
    thread.selectedBranchAtParent.__root__ = id;
  }
  thread.activeLeafId = id;
  thread.updatedAt = Date.now();
  return node;
}

/**
 * Walk from root following selectedBranchAtParent choices to yield the active linear timeline.
 */
export function getActivePath(thread: Thread | null | undefined): ThreadNode[] {
  if (!thread || !thread.rootNodeIds?.length) return [];
  const path: ThreadNode[] = [];
  let cursorId: string | undefined = thread.selectedBranchAtParent?.__root__;
  if (!cursorId || !thread.nodes[cursorId]) {
    cursorId = thread.rootNodeIds[thread.rootNodeIds.length - 1];
  }
  const seen = new Set<string>();
  while (cursorId && thread.nodes[cursorId] && !seen.has(cursorId)) {
    seen.add(cursorId);
    const node: ThreadNode = thread.nodes[cursorId];
    path.push(node);
    if (!node.childrenIds?.length) break;
    const preferred: string | undefined = thread.selectedBranchAtParent?.[node.id];
    cursorId = preferred && thread.nodes[preferred]
      ? preferred
      : node.childrenIds[node.childrenIds.length - 1];
  }
  return path;
}

/**
 * Switch the active timeline to pass through targetNodeId (going up to root and down preferred descendants).
 */
export function selectBranchNode(thread: Thread | null | undefined, targetNodeId: string): ThreadNode[] {
  if (!thread || !thread.nodes[targetNodeId]) return [];
  let cur: ThreadNode | null | undefined = thread.nodes[targetNodeId];
  while (cur) {
    const key = cur.parentId || '__root__';
    thread.selectedBranchAtParent[key] = cur.id;
    cur = cur.parentId ? thread.nodes[cur.parentId] : null;
  }
  const path = getActivePath(thread);
  thread.activeLeafId = path.length ? path[path.length - 1].id : null;
  thread.updatedAt = Date.now();
  return path;
}

/**
 * Return sibling branch metadata (index, count, siblingIds) for a given node.
 */
export function getSiblingInfo(thread: Thread | null | undefined, nodeId: string): SiblingInfo {
  const node = thread?.nodes?.[nodeId];
  if (!node || !thread) return { index: 0, total: 1, siblings: [] };
  const siblings = node.parentId
    ? (thread.nodes[node.parentId]?.childrenIds || [nodeId])
    : (thread.rootNodeIds || [nodeId]);
  const index = Math.max(0, siblings.indexOf(nodeId));
  return { index, total: siblings.length, siblings };
}

/**
 * Count total branches (nodes with >1 child + extra roots) inside a thread.
 */
export function countThreadBranches(thread: Thread | null | undefined): number {
  if (!thread) return 0;
  let extra = Math.max(0, (thread.rootNodeIds?.length || 0) - 1);
  for (const node of Object.values(thread.nodes || {})) {
    if ((node.childrenIds?.length || 0) > 1) {
      extra += node.childrenIds.length - 1;
    }
  }
  return extra;
}

/**
 * Pick a winner among /fanout candidates so subsequent messages continue cleanly from its text.
 */
export function chooseFanoutWinner(node: ThreadNode | null | undefined, index: number): boolean {
  if (!node || !Array.isArray(node.candidates) || !node.candidates[index]) return false;
  node.chosenCandidateIndex = index;
  node.content = node.candidates[index].content;
  node.model = node.candidates[index].model;
  node.meta = node.candidates[index].meta || node.meta;
  return true;
}

export function buildApiHistory(path: ThreadNode[], maxTurns = 24): ApiHistoryMessage[] {
  return path
    .filter((n): n is ThreadNode & { role: 'user' | 'assistant' } => n.role === 'user' || n.role === 'assistant')
    .filter(n => n.content && n.content.trim().length > 0)
    .slice(-maxTurns)
    .map(n => ({ role: n.role, content: n.content }));
}
