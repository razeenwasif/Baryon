import { cleanLayout, type PaneGroup } from '../src/pane-layout.js';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const INDEX = 'index.json', MAX_PROPOSALS = 8, MAX_SESSIONS = 2000, MAX_FOLDERS = 100, MAX_CATEGORIES = 30, MAX_NAME = 80, SEARCH_RESULTS = 30, TRASH_AT_ONCE = 8;
const SAFE_ID = /^[a-z0-9-]{1,64}$/, SOURCE = /^history(?:-backup-\d+)?\.json$/;
const EARLIER_TITLE = 'Earlier conversations', IMPORT_FOLDER = 'Claude Code';
const OFFER_KINDS = ['code', 'maths', 'circuits', 'research', 'data', 'business', 'writing', 'vision', 'teaching'] as const;

export type OfferKind = (typeof OFFER_KINDS)[number];
export type PermissionMode = 'ask' | 'plan' | 'auto';
export type ProviderKind = 'claude' | 'gemini' | 'codex';
export type ProposalWhere = 'this_folder' | 'own_branch' | 'other_folder';
export type ProposalStatus = 'started' | 'dismissed';

export interface PaneView {
  artifact: string;
  seq: number;
}

export interface PaneState {
  open: boolean;
  tab: string;
  view: PaneView | null;
  layout: PaneGroup | null;
}

export interface WorkConfig {
  folder: string;
  permission: PermissionMode;
  isolate?: boolean;
  provider?: ProviderKind;
  root?: string;
  branch?: string;
  worktree?: string;
  gitCommon?: string;
}

export interface SummarizedState {
  through: number;
  lastAt: string;
  at: string;
  chars?: number;
}

export interface SessionProposal {
  id: string;
  title: string;
  brief: string;
  where: ProposalWhere;
  folder: string;
  at: string;
  expires: string;
  status?: ProposalStatus;
  session?: string;
}

export interface ImportedInfo {
  from: string;
  project: string;
  turns: number;
  notebook?: boolean;
}

export interface SessionRecord {
  id: string;
  title: string;
  named: boolean;
  createdAt: string;
  updatedAt: string;
  turns: number;
  pinned: boolean;
  folder: string | null;
  pane: PaneState;
  source?: string;
  work?: WorkConfig;
  summarized?: SummarizedState;
  parent?: string;
  declined?: OfferKind[];
  done?: string;
  snoozedUntil?: string;
  proposals?: SessionProposal[];
  imported?: ImportedInfo;
}

export interface SessionFolder {
  id: string;
  name: string;
  collapsed: boolean;
  section?: 'notebooks';
  category?: string;
}

export interface SessionCategory {
  id: string;
  name: string;
  collapsed: boolean;
}

export interface HistoryEntry {
  role?: string;
  content?: unknown;
  at?: string;
  [key: string]: unknown;
}

export interface SessionLinkInfo {
  parent: { id: string; title: string } | null;
  children: Array<{ id: string; title: string; branch?: string; queued?: boolean }>;
  proposals: SessionProposal[];
}

export interface SessionSummaryItem {
  id: string;
  title: string;
  updatedAt: string;
  turns: number;
  pinned: boolean;
  folder: string | null;
  work: string;
  workPath?: string;
  branch?: string;
  isolate?: boolean;
  provider?: ProviderKind;
  parent?: string;
  done?: string;
  snoozedUntil?: string;
}

export interface SessionStoreState {
  active: string | null;
  pane: PaneState;
  folders: SessionFolder[];
  categories: SessionCategory[];
  summarized?: SummarizedState;
  declined?: OfferKind[];
  running: Record<string, string>;
  finished: string[];
  swarms: Record<string, unknown>;
  queued: string[];
  work: (WorkConfig & { name: string; path: string; summarized?: SummarizedState }) | null;
  links: SessionLinkInfo | null;
  sessions: SessionSummaryItem[];
}

export interface SessionStoreOptions {
  dir: string;
  legacyDir: string;
  readJSON: (path: string, fallback?: any) => Promise<unknown>;
  writeJSON: (path: string, value: unknown) => Promise<unknown>;
  trash: (path: string) => Promise<unknown>;
  now?: () => string;
  onChange?: (state: SessionStoreState) => void;
  id?: () => string;
}

export interface AddWorkOptions {
  title?: string;
  work?: (Partial<WorkConfig> & { folder: string }) | null;
  parent?: string | null;
  history?: HistoryEntry[];
  folder?: string;
  permission?: PermissionMode | string;
}

export interface RemoveManyResult {
  removed: string[];
  failed: Array<{ id: string; message: string }>;
}

export interface SessionSearchHit {
  id: string;
  title: string;
  snippet: string;
}

const errMsg = (error: unknown): string =>
  error && typeof error === 'object' && 'message' in error ? String((error as { message: unknown }).message) : String(error);
const errCode = (error: unknown): unknown =>
  error && typeof error === 'object' && 'code' in error ? (error as { code?: unknown }).code : undefined;

const name = (value: unknown, fallback = ''): string => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME) || fallback;
function list<T = unknown>(value: unknown): T[] { return Array.isArray(value) ? (value as T[]) : []; }
const newestFirst = (a: { updatedAt: string }, b: { updatedAt: string }): number => String(b.updatedAt).localeCompare(String(a.updatedAt));
// Proton keeps a notebook's working files in a hidden folder inside it.
export const inNotebook = (path: unknown): boolean => /\/\.notebook(?:\/|$)/.test(String(path ?? ''));
// A chat is named after what was first asked in it, or Fairy's opening thought.
export function titleFor(history: HistoryEntry[]): string {
  const first = history.find(entry => entry.role === 'user') || history[0];
  return name(first?.content, 'New chat');
}
function snippet(text: unknown, query: string): string {
  const flat = String(text).replace(/\s+/g, ' ').trim(), at = flat.toLowerCase().indexOf(query);
  if (at < 0) return '';
  const start = Math.max(0, at - 30);
  return `${start ? '…' : ''}${flat.slice(start, at + query.length + 70)}${at + query.length + 70 < flat.length ? '…' : ''}`;
}
const baseName = (path: string): string => String(path).split('/').filter(Boolean).pop() || path;
// A notebook is known by its own name, not the working folder hidden inside it.
const workName = (path: string): string => baseName(String(path).replace(/\/\.notebook(?:\/.*)?$/, ''));
const cleanView = (value: unknown): PaneView | null => {
  const v = value as Record<string, any> | null | undefined;
  return typeof v?.artifact === 'string' && Number.isInteger(v.seq) ? { artifact: v.artifact.slice(0, 64), seq: v.seq } : null;
};
// The side panel: open or not, the pane you were last in, its view, and (up to three panes) how they're laid out.
const cleanPane = (value?: unknown): PaneState => {
  const v = value as Record<string, any> | null | undefined;
  return { open: v?.open === true, tab: typeof v?.tab === 'string' ? v.tab.slice(0, 40) : '', view: cleanView(v?.view), layout: cleanLayout(v?.layout) };
};
function cleanSession(value: unknown): SessionRecord | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, any>;
  if (!SAFE_ID.test(v.id)) return null;
  const clean: SessionRecord = { id: v.id, title: name(v.title, 'Chat'), named: v.named === true, createdAt: String(v.createdAt || ''), updatedAt: String(v.updatedAt || ''),
    turns: Number(v.turns) || 0, pinned: v.pinned === true, folder: typeof v.folder === 'string' ? v.folder : null, pane: cleanPane(v.pane) };
  if (SOURCE.test(v.source || '')) clean.source = v.source;
  if (typeof v.work?.folder === 'string') clean.work = cleanWork(v.work);
  if (Number.isInteger(v.summarized?.through)) clean.summarized = { through: v.summarized.through, lastAt: String(v.summarized.lastAt ?? ''), at: String(v.summarized.at ?? ''), ...(Number.isInteger(v.summarized.chars) && v.summarized.chars >= 0 ? { chars: v.summarized.chars } : {}) };
  if (SAFE_ID.test(v.parent || '')) clean.parent = v.parent;
  // Kinds of task whose mid-chat move you turned down in this chat (Auto by task, stage 6): not offered again here.
  if (Array.isArray(v.declined)) { const kinds = v.declined.filter((kind): kind is OfferKind => OFFER_KINDS.includes(kind)); if (kinds.length) clean.declined = [...new Set(kinds)]; }
  // When you marked a task done; only you can, never Fairy.
  if (typeof v.done === 'string' && v.done) clean.done = v.done.slice(0, 40);
  if (typeof v.snoozedUntil === 'string' && v.snoozedUntil) clean.snoozedUntil = v.snoozedUntil.slice(0, 40);
  const proposals = list(v.proposals).map(cleanProposal).filter((p): p is SessionProposal => Boolean(p));
  if (proposals.length) clean.proposals = proposals.slice(-MAX_PROPOSALS);
  if (typeof v.imported?.from === 'string') clean.imported = { from: v.imported.from.slice(0, 40), project: name(v.imported.project), turns: Number(v.imported.turns) || 0, ...(v.imported.notebook === true ? { notebook: true } : {}) };
  return clean;
}
// A card for a session the agent noticed, which the user can start until it expires.
const cleanProposal = (value: unknown): SessionProposal | null => {
  const v = value as Record<string, any> | null | undefined;
  return v && SAFE_ID.test(v.id) && typeof v.brief === 'string' && typeof v.folder === 'string' ? { id: v.id, title: name(v.title, 'Session'), brief: v.brief.slice(0, 8000), where: (['this_folder', 'own_branch', 'other_folder'].includes(v.where) ? v.where : 'this_folder') as ProposalWhere, folder: v.folder, at: String(v.at || ''), expires: String(v.expires || ''), ...(v.status === 'started' || v.status === 'dismissed' ? { status: v.status as ProposalStatus } : {}), ...(SAFE_ID.test(v.session || '') ? { session: v.session } : {}) } : null;
};
const cleanPermission = (value: unknown): PermissionMode => (['ask', 'plan', 'auto'].includes(String(value)) ? value : 'ask') as PermissionMode;
// provider: the one Auto by task moved the session to at its first turn (stage 5), kept for the rest of it.
const cleanWork = (value: unknown): WorkConfig => {
  const v = (value ?? {}) as Record<string, any>;
  return { folder: String(v.folder), permission: cleanPermission(v.permission), ...(v.isolate === true ? { isolate: true } : {}), ...(['claude', 'gemini', 'codex'].includes(v.provider) ? { provider: v.provider as ProviderKind } : {}), ...(typeof v.root === 'string' ? { root: v.root, branch: String(v.branch || '').slice(0, 120), worktree: String(v.worktree || v.root), gitCommon: String(v.gitCommon || '') } : {}) };
};
const cleanFolder = (value: unknown): SessionFolder | null => {
  const v = value as Record<string, any> | null | undefined;
  return v && SAFE_ID.test(v.id) ? { id: v.id, name: name(v.name, 'Folder'), collapsed: v.collapsed === true, ...(v.section === 'notebooks' ? { section: 'notebooks' as const } : {}), ...(SAFE_ID.test(v.category || '') ? { category: v.category } : {}) } : null;
};
// A section above folders (Research, Development…), holding folders in the order you dragged them.
const cleanCategory = (value: unknown): SessionCategory | null => {
  const v = value as Record<string, any> | null | undefined;
  return v && SAFE_ID.test(v.id) ? { id: v.id, name: name(v.name, 'Section'), collapsed: v.collapsed === true } : null;
};
// Moves an item in a list to just before another (or to the end), keeping everything else in order.
const placeBefore = <T extends { id: string }>(items: T[], item: T, before: string | null): T[] => {
  const rest = items.filter(entry => entry !== item), at = before ? rest.findIndex(entry => entry.id === before) : -1;
  rest.splice(at < 0 ? rest.length : at, 0, item);
  return rest;
};

// Each chat is its own file, with one small index for the sidebar. The chat on screen is
// `history`; `active` is null for a new chat, which isn't written until something is said.
export class SessionStore {
  dir: string;
  legacyDir: string;
  readJSON: (path: string, fallback?: any) => Promise<unknown>;
  writeJSON: (path: string, value: unknown) => Promise<unknown>;
  trash: (path: string) => Promise<unknown>;
  now: () => string;
  onChange: (state: SessionStoreState) => void;
  id: () => string;
  sessions: SessionRecord[];
  folders: SessionFolder[];
  categories: SessionCategory[];
  active: string | null;
  history: HistoryEntry[];
  draftPane: PaneState;
  draftWork: WorkConfig | null;
  migrated = false;
  importsSorted = false;
  turns: Promise<void> | undefined = undefined;
  running?: () => Record<string, string>;
  finished?: () => string[];
  swarms?: () => Record<string, unknown>;
  queued?: () => string[];

  constructor({ dir, legacyDir, readJSON, writeJSON, trash, now = () => new Date().toISOString(), onChange = () => {}, id = randomUUID }: SessionStoreOptions) {
    this.dir = dir; this.legacyDir = legacyDir; this.readJSON = readJSON; this.writeJSON = writeJSON; this.trash = trash; this.now = now; this.onChange = onChange; this.id = id;
    this.sessions = []; this.folders = []; this.categories = []; this.active = null; this.history = []; this.draftPane = cleanPane(); this.draftWork = null;
  }
  path(id: string): string { return join(this.dir, `${id}.json`); }
  find(id: string): SessionRecord {
    const session = this.sessions.find(entry => entry.id === id);
    if (!session) throw new Error('That chat is no longer here.');
    return session;
  }
  folder(id: string): SessionFolder {
    const folder = this.folders.find(entry => entry.id === id);
    if (!folder) throw new Error('That folder is no longer here.');
    return folder;
  }
  async read(id: string): Promise<HistoryEntry[]> { return list<HistoryEntry>(await this.readJSON(this.path(id), [])); }
  async load(): Promise<void> {
    let index: Record<string, unknown> | null = null, damaged = false;
    try { index = (await this.readJSON(join(this.dir, INDEX), null)) as Record<string, unknown> | null; }
    catch (error) { console.warn('Rebuilding the chat list:', errMsg(error)); damaged = true; }
    this.sessions = list(index?.sessions).map(cleanSession).filter((s): s is SessionRecord => Boolean(s));
    this.folders = list(index?.folders).map(cleanFolder).filter((f): f is SessionFolder => Boolean(f));
    this.categories = list(index?.categories).map(cleanCategory).filter((c): c is SessionCategory => Boolean(c));
    const categories = new Set(this.categories.map(category => category.id));
    for (const folder of this.folders) if (folder.category && !categories.has(folder.category)) delete folder.category;
    this.active = typeof index?.active === 'string' ? index.active : null;
    this.migrated = index?.migrated === true;
    this.importsSorted = index?.importsSorted === true;
    const onDisk = await this.files();
    if (damaged || !index) await this.recover(onDisk);
    this.sessions = this.sessions.filter(session => onDisk.has(session.id));
    if (!this.migrated) await this.migrate();
    const folders = new Set(this.folders.map(folder => folder.id));
    for (const session of this.sessions) if (session.folder && !folders.has(session.folder)) session.folder = null;
    if (!this.importsSorted) this.sortImports();
    if (!this.sessions.some(session => session.id === this.active)) this.active = null;
    this.history = this.active ? await this.read(this.active) : [];
    await this.saveIndex();
  }
  async files(): Promise<Set<string>> {
    try { return new Set((await readdir(this.dir)).filter(file => file.endsWith('.json') && file !== INDEX).map(file => file.slice(0, -5)).filter(id => SAFE_ID.test(id))); }
    catch (error) { if (errCode(error) === 'ENOENT') return new Set(); throw error; }
  }
  // A damaged index costs names and folders, never the chats themselves.
  async recover(onDisk: Set<string>): Promise<void> {
    if (onDisk.size) this.migrated = true;
    for (const id of onDisk) {
      if (this.sessions.some(session => session.id === id)) continue;
      let history: HistoryEntry[];
      try { history = await this.read(id); } catch (error) { console.warn(`Skipping unreadable chat ${id}:`, errMsg(error)); continue; }
      const stamp = history.at(-1)?.at || this.now();
      const session = cleanSession({ id, title: id === 'earlier' ? EARLIER_TITLE : titleFor(history), createdAt: history[0]?.at || stamp, updatedAt: stamp, turns: history.length });
      if (session) this.sessions.push(session);
    }
  }
  // The originals stay where they are until their chat is deleted, so nothing depends on this
  // copy being right. Fixed ids make it safe to run again after a crash.
  async migrate(): Promise<void> {
    const backups = (await this.legacyFiles()).sort();
    for (const source of [...backups, 'history.json']) {
      let history: HistoryEntry[];
      try { history = list<HistoryEntry>(await this.readJSON(join(this.legacyDir, source), [])); }
      catch (error) { console.warn(`Skipping ${source}:`, errMsg(error)); throw error; }
      if (!history.length) continue;
      const current = source === 'history.json', id = current ? 'earlier' : `backup-${source.match(/\d+/)?.[0] ?? ''}`;
      if (this.sessions.some(session => session.id === id)) continue;
      await this.writeJSON(this.path(id), history);
      const session = cleanSession({ id, title: current ? EARLIER_TITLE : titleFor(history), named: current, createdAt: history[0].at || this.now(), updatedAt: history.at(-1)?.at || this.now(), turns: history.length, source });
      if (session) this.sessions.push(session);
      if (current) this.active = id;
    }
    this.migrated = true;
  }
  async legacyFiles(): Promise<string[]> {
    try { return (await readdir(this.legacyDir)).filter(file => /^history-backup-\d+\.json$/.test(file)); }
    catch (error) { if (errCode(error) === 'ENOENT') return []; throw error; }
  }
  saveIndex(): Promise<unknown> {
    return this.writeJSON(join(this.dir, INDEX), { version: 1, migrated: this.migrated, importsSorted: this.importsSorted, active: this.active, sessions: this.sessions, folders: this.folders, categories: this.categories });
  }
  async changed(): Promise<SessionStoreState> { await this.saveIndex(); this.onChange(this.state()); return this.state(); }
  state(): SessionStoreState {
    const current = this.sessions.find(session => session.id === this.active);
    const work = this.work();
    return { active: this.active, pane: current ? current.pane : this.draftPane, folders: this.folders, categories: this.categories, ...(current?.summarized ? { summarized: current.summarized } : {}), ...(current?.declined ? { declined: current.declined } : {}), running: this.running?.() || {}, finished: this.finished?.() || [], swarms: this.swarms?.() || {}, queued: this.queued?.() || [], work: work ? { ...work, name: workName(work.folder), path: work.root || work.folder, ...(current?.summarized ? { summarized: current.summarized } : {}) } : null,
      links: current ? this.links(current) : null,
      sessions: this.sessions.map(({ id, title, updatedAt, turns, pinned, folder, work: kind, parent, done, snoozedUntil }) => ({ id, title, updatedAt, turns, pinned, folder, work: kind ? workName(kind.folder) : '', ...(kind?.folder ? { workPath: kind.folder } : {}), ...(kind?.branch ? { branch: kind.branch } : {}), ...(kind?.isolate ? { isolate: true } : {}), ...(kind?.provider ? { provider: kind.provider } : {}), ...(parent ? { parent } : {}), ...(done ? { done } : {}), ...(snoozedUntil ? { snoozedUntil } : {}) })) };
  }
  // The chats linked to this one: the one that started it, the sessions it started, and its cards still open.
  links(current: SessionRecord): SessionLinkInfo | null {
    const parent = current.parent ? this.sessions.find(session => session.id === current.parent) : null, now = this.now(), queued = new Set(this.queued?.() || []);
    const children = this.sessions.filter(session => session.parent === current.id).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
      .map(({ id, title, work }) => ({ id, title, ...(work?.branch ? { branch: work.branch } : work?.isolate ? { branch: 'its own branch' } : {}), ...(queued.has(id) ? { queued: true } : {}) }));
    const proposals = (current.proposals || []).filter(item => !item.status && item.expires > now);
    return parent || children.length || proposals.length ? { parent: parent ? { id: parent.id, title: parent.title } : null, children, proposals } : null;
  }
  // The chat on screen, if it's a work session in a folder.
  work(): WorkConfig | null { return this.active ? this.sessions.find(session => session.id === this.active)?.work || null : this.draftWork; }
  async createWork(folder: string): Promise<SessionStoreState> { this.active = null; this.history = []; this.draftPane = cleanPane(); this.draftWork = { folder, permission: 'ask' }; return this.changed(); }
  convertToWork(id: string | null | undefined, folder: string): Promise<SessionStoreState> {
    return this.inTurn(async () => {
      const targetId = id == null || id === '' ? this.active : id;
      if (!targetId) return this.createWork(folder);
      const session = this.find(targetId);
      if (session.work) throw new Error('This chat is already a work session.');
      session.work = cleanWork({ folder, permission: 'ask' });
      session.updatedAt = this.now();
      if (this.active !== targetId) {
        this.active = targetId;
        this.history = await this.read(targetId);
        this.draftWork = null;
      }
      return this.changed();
    });
  }
  async setWork(patch: Partial<WorkConfig>): Promise<SessionStoreState> {
    if (this.active) return this.setWorkFor(this.active, patch);
    if (!this.draftWork) throw new Error('This chat isn’t a work session.');
    this.draftWork = cleanWork({ ...this.draftWork, ...patch });
    return this.changed();
  }
  async setWorkFor(id: string, patch: Partial<WorkConfig>): Promise<SessionStoreState> {
    const session = this.find(id);
    if (!session.work) throw new Error('This chat isn’t a work session.');
    session.work = cleanWork({ ...session.work, ...patch });
    return this.changed();
  }
  // Adds to a chat whether or not it's on screen, for work carrying on in the background.
  append(id: string, entries: HistoryEntry[]): Promise<HistoryEntry[]> {
    return this.inTurn(async () => {
      if (id === this.active) return this.save([...this.history, ...entries].slice(-1000));
      const session = this.find(id), next = [...await this.read(id), ...entries].slice(-1000);
      await this.writeJSON(this.path(id), next);
      session.updatedAt = this.now(); session.turns = next.length;
      if (!session.named) session.title = titleFor(next);
      await this.changed();
      return next;
    });
  }
  // Adds fields to one saved message (the first with that time and role), whether or not its chat is on screen. The
  // message's words stay as they were. For cards attached to a reply after it was saved, such as project memory's.
  annotate(id: string, at: string, role: string, patch: Record<string, unknown>): Promise<HistoryEntry[] | null> {
    return this.inTurn(async () => {
      const saved = id === this.active ? this.history : await this.read(id), index = saved.findIndex(entry => entry.at === at && entry.role === role);
      if (index < 0) return null;
      const next = saved.map((entry, place) => (place === index ? { ...entry, ...patch, content: entry.content, role: entry.role, at: entry.at } : entry));
      if (id === this.active) this.history = next;
      await this.writeJSON(this.path(id), next);
      return next;
    });
  }
  // Opening a chat and adding to it take turns, so one can't read what the other is about to replace.
  inTurn<T>(work: () => Promise<T>): Promise<T> {
    const result = (this.turns ?? Promise.resolve()).then(work, work);
    this.turns = result.then(() => {}, () => {});
    return result;
  }
  // Chats copied from elsewhere, with their files already written. They go together in a closed folder, so yours stay easy to find.
  // A project's new chats join the folder you keep most of its others in, even after you rename or merge it. Otherwise each
  // project gets its own closed folder, unless one already goes by that name. Notebooks have their own section.
  importFolder({ imported, work }: { imported?: Partial<ImportedInfo> | null; work?: Partial<WorkConfig> | null }, { follow = true }: { follow?: boolean } = {}): SessionFolder | undefined {
    const wanted = name(imported?.project, IMPORT_FOLDER), section: 'notebooks' | undefined = imported?.notebook || inNotebook(work?.folder) ? 'notebooks' : undefined;
    const tally = new Map<SessionFolder, { count: number; latest: string }>();
    for (const session of follow ? this.sessions : []) {
      const home = session.imported && session.imported.project.toLowerCase() === wanted.toLowerCase() && this.folders.find(entry => entry.id === session.folder);
      if (!home || home.section !== section) continue;
      const seen = tally.get(home) || { count: 0, latest: '' };
      tally.set(home, { count: seen.count + 1, latest: session.updatedAt > seen.latest ? session.updatedAt : seen.latest });
    }
    let folder: SessionFolder | undefined = [...tally].sort(([, a], [, b]) => b.count - a.count || b.latest.localeCompare(a.latest))[0]?.[0];
    folder ||= this.folders.find(entry => entry.section === section && entry.name.toLowerCase() === wanted.toLowerCase());
    if (!folder && this.folders.length < MAX_FOLDERS) { folder = { id: this.id(), name: wanted, collapsed: true, ...(section ? { section } : {}) }; this.folders.push(folder); }
    return folder;
  }
  // Imports used to share one folder. What's still in it moves out, once, so a folder you name that later is left alone.
  sortImports(): void {
    this.importsSorted = true;
    const old = this.folders.find(entry => entry.name === IMPORT_FOLDER);
    if (!old) return;
    for (const session of [...this.sessions].sort(newestFirst)) {
      if (session.imported && session.folder === old.id) session.folder = this.importFolder(session, { follow: false })?.id ?? old.id;
    }
    if (!this.sessions.some(session => session.folder === old.id)) this.folders = this.folders.filter(entry => entry !== old);
  }
  async addImported(chats: Array<Record<string, any>>): Promise<number> {
    let added = 0;
    for (const chat of [...chats].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))) {
      const existing = this.sessions.find(session => session.id === chat.id);
      if (existing) { Object.assign(existing, { turns: chat.turns, updatedAt: chat.updatedAt, imported: chat.imported }); continue; }
      if (this.sessions.length >= MAX_SESSIONS) break;
      const session = cleanSession({ ...chat, named: true, folder: this.importFolder(chat)?.id ?? null });
      if (session) { this.sessions.push(session); added++; }
    }
    await this.changed();
    return added;
  }
  // A finished chat that didn't start on screen, such as a scheduled task's result.
  async addChat({ title, history }: { title: string; history: HistoryEntry[] }): Promise<string> {
    const at = this.now(), session = cleanSession({ id: this.id(), title, named: true, createdAt: at, updatedAt: at, turns: history.length })!;
    await this.writeJSON(this.path(session.id), history);
    this.sessions.push(session);
    await this.changed();
    return session.id;
  }
  // A work session that runs off screen from the start: one another chat started, with its title, parent and opening
  // turns, or one another app started (Electron's vault agent) in a folder, which its first message names.
  async addWork({ title, work, parent, history = [], folder, permission }: AddWorkOptions): Promise<string> {
    if (this.sessions.length >= MAX_SESSIONS) throw new Error(`Delete a chat first; up to ${MAX_SESSIONS} are kept.`);
    const at = this.now(), session = cleanSession({ id: this.id(), title: title || 'New chat', named: Boolean(title), createdAt: at, updatedAt: at, turns: history.length, work: work || { folder, permission }, parent, folder: parent ? this.sessions.find(entry => entry.id === parent)?.folder ?? null : null })!;
    await this.writeJSON(this.path(session.id), history);
    this.sessions.push(session);
    await this.changed();
    return session.id;
  }
  // A copy of a chat as it stands, to go another way from here (/fork): its messages and panel, in the same sidebar
  // folder. A work session's copy works in the same folder with the same permission, on a branch of its own if the
  // original had one; its rewind points, summaries and helpers stay with the original.
  async fork(id: string): Promise<string> {
    if (this.sessions.length >= MAX_SESSIONS) throw new Error(`Delete a chat first; up to ${MAX_SESSIONS} are kept.`);
    const source = this.find(id), history = await this.read(id), at = this.now();
    if (!history.length) throw new Error('There’s nothing to fork yet: send a message first.');
    const work = source.work ? { folder: source.work.folder, permission: source.work.permission, ...(source.work.isolate || source.work.root ? { isolate: true } : {}) } : null;
    const session = cleanSession({ id: this.id(), title: `${source.title} (fork)`, named: true, createdAt: at, updatedAt: at, turns: history.length, folder: source.folder, pane: source.pane, ...(work ? { work } : {}) })!;
    await this.writeJSON(this.path(session.id), history);
    this.sessions.push(session);
    await this.changed();
    return session.id;
  }
  async setProposals(id: string, proposals: unknown[]): Promise<SessionStoreState> {
    const session = this.find(id), clean = list(proposals).map(cleanProposal).filter((p): p is SessionProposal => Boolean(p)).slice(-MAX_PROPOSALS);
    if (clean.length) session.proposals = clean; else delete session.proposals;
    return this.changed();
  }
  // Drops a chat's later turns, for rewinding.
  async truncate(id: string, length: number): Promise<HistoryEntry[]> {
    if (id !== this.active) throw new Error('Open that chat first.');
    return this.save(this.history.slice(0, Math.max(0, length)));
  }
  async declineOffer(id: string, kind: OfferKind | string): Promise<SessionStoreState> {
    if (!OFFER_KINDS.includes(kind as OfferKind)) throw new Error('That isn’t a kind of task.');
    const session = this.find(id);
    session.declined = [...new Set([...(session.declined || []), kind as OfferKind])];
    return this.changed();
  }
  async snooze(id: string, untilIso: string | null = null): Promise<SessionStoreState> {
    const session = this.find(id);
    if (untilIso && typeof untilIso === 'string') session.snoozedUntil = untilIso.slice(0, 40);
    else delete session.snoozedUntil;
    return this.changed();
  }
  async setSummarized(id: string, summarized: SummarizedState): Promise<SessionStoreState> {
    this.find(id).summarized = summarized;
    return this.changed();
  }
  async setPermission(permission: PermissionMode | string): Promise<SessionStoreState> {
    const work = this.work();
    if (!work) throw new Error('This chat isn’t a work session.');
    work.permission = cleanPermission(permission);
    return this.changed();
  }
  // Saves the chat on screen. The first turn of a new chat is what brings it into being.
  async save(history: HistoryEntry[]): Promise<HistoryEntry[]> {
    const at = this.now();
    if (!this.active) {
      if (this.sessions.length >= MAX_SESSIONS) throw new Error(`Delete a chat first; up to ${MAX_SESSIONS} are kept.`);
      const session = cleanSession({ id: this.id(), title: titleFor(history), createdAt: at, updatedAt: at, turns: 0, pane: this.draftPane, work: this.draftWork })!;
      await this.writeJSON(this.path(session.id), history);
      this.sessions.push(session); this.active = session.id; this.draftPane = cleanPane(); this.draftWork = null;
    } else await this.writeJSON(this.path(this.active), history);
    const session = this.find(this.active);
    session.updatedAt = at; session.turns = history.length;
    if (!session.named) session.title = titleFor(history);
    this.history = history;
    await this.changed();
    return history;
  }
  async create(): Promise<SessionStoreState> { this.active = null; this.history = []; this.draftPane = cleanPane(); this.draftWork = null; return this.changed(); }
  open(id: string): Promise<SessionStoreState> {
    return this.inTurn(async () => {
      this.find(id);
      const history = await this.read(id);
      this.active = id; this.history = history; this.draftWork = null;
      return this.changed();
    });
  }
  async rename(id: string, title: string): Promise<SessionStoreState> {
    const session = this.find(id), clean = name(title);
    if (!clean) throw new Error('Give the chat a name.');
    session.title = clean; session.named = true;
    return this.changed();
  }
  async pin(id: string, pinned: boolean): Promise<SessionStoreState> { this.find(id).pinned = pinned === true; return this.changed(); }
  // A task you've checked and marked done, or brought back.
  async markDone(id: string, done: boolean): Promise<SessionStoreState> { const session = this.find(id); if (done) session.done = new Date().toISOString(); else delete session.done; return this.changed(); }
  async move(id: string, folderId: string | null | undefined): Promise<SessionStoreState> {
    if (folderId) this.folder(folderId);
    this.find(id).folder = folderId || null;
    return this.changed();
  }
  async setPane(pane: unknown): Promise<SessionStoreState> {
    const clean = cleanPane(pane), current = this.sessions.find(session => session.id === this.active);
    if (current) current.pane = clean; else this.draftPane = clean;
    return this.changed();
  }
  // Goes to the Trash rather than away for good, along with any file it was first imported from.
  async trashFiles(session: SessionRecord): Promise<void> {
    await this.trash(this.path(session.id));
    if (session.source) await this.trash(join(this.legacyDir, session.source)).catch(error => { if (errCode(error) !== 'ENOENT') console.warn('Could not trash the imported chat:', errMsg(error)); });
  }
  forget(ids: string[]): void {
    this.sessions = this.sessions.filter(entry => !ids.includes(entry.id));
    if (this.active && ids.includes(this.active)) { this.active = null; this.history = []; this.draftPane = cleanPane(); this.draftWork = null; }
  }
  async remove(id: string): Promise<SessionStoreState> {
    await this.trashFiles(this.find(id));
    this.forget([id]);
    return this.changed();
  }
  // A chat that can't go stays, and the rest still go.
  async removeMany(ids: string[]): Promise<RemoveManyResult> {
    const removed: string[] = [], failed: Array<{ id: string; message: string }> = [];
    for (let start = 0; start < ids.length; start += TRASH_AT_ONCE) {
      await Promise.all(ids.slice(start, start + TRASH_AT_ONCE).map(async id => {
        try { await this.trashFiles(this.find(id)); removed.push(id); }
        catch (error) { failed.push({ id, message: errMsg(error) }); }
      }));
    }
    this.forget(removed);
    await this.changed();
    return { removed, failed };
  }
  async createFolder(folderName: string): Promise<SessionStoreState> {
    if (this.folders.length >= MAX_FOLDERS) throw new Error(`Delete a folder first; up to ${MAX_FOLDERS} are kept.`);
    this.folders.push({ id: this.id(), name: name(folderName, 'New folder'), collapsed: false });
    return this.changed();
  }
  async renameFolder(id: string, folderName: string): Promise<SessionStoreState> {
    const clean = name(folderName);
    if (!clean) throw new Error('Give the folder a name.');
    this.folder(id).name = clean;
    return this.changed();
  }
  async collapseFolder(id: string, collapsed: boolean): Promise<SessionStoreState> { this.folder(id).collapsed = collapsed === true; return this.changed(); }
  // Deleting a folder puts its chats back in the list.
  async removeFolder(id: string): Promise<SessionStoreState> {
    this.folder(id);
    this.folders = this.folders.filter(folder => folder.id !== id);
    for (const session of this.sessions) if (session.folder === id) session.folder = null;
    return this.changed();
  }
  category(id: string): SessionCategory {
    const category = this.categories.find(entry => entry.id === id);
    if (!category) throw new Error('That section is no longer here.');
    return category;
  }
  async createCategory(categoryName: string): Promise<SessionStoreState> {
    if (this.categories.length >= MAX_CATEGORIES) throw new Error(`Delete a section first; up to ${MAX_CATEGORIES} are kept.`);
    this.categories.push({ id: this.id(), name: name(categoryName, 'New section'), collapsed: false });
    return this.changed();
  }
  async renameCategory(id: string, categoryName: string): Promise<SessionStoreState> {
    const clean = name(categoryName);
    if (!clean) throw new Error('Give the section a name.');
    this.category(id).name = clean;
    return this.changed();
  }
  async collapseCategory(id: string, collapsed: boolean): Promise<SessionStoreState> { this.category(id).collapsed = collapsed === true; return this.changed(); }
  // Deleting a section keeps its folders and their chats; they just stop being grouped.
  async removeCategory(id: string): Promise<SessionStoreState> {
    this.category(id);
    this.categories = this.categories.filter(category => category.id !== id);
    for (const folder of this.folders) if (folder.category === id) delete folder.category;
    return this.changed();
  }
  // Where a dragged folder lands: in a section (or none), just before another folder or at the end.
  async placeFolder(id: string, { category = null, before = null }: { category?: string | null; before?: string | null } = {}): Promise<SessionStoreState> {
    const folder = this.folder(id);
    if (category) this.category(category);
    // Dropped on itself: nothing moves.
    if (before === id) return this.changed();
    if (category) folder.category = category; else delete folder.category;
    this.folders = placeBefore(this.folders, folder, before);
    return this.changed();
  }
  async placeCategory(id: string, before: string | null = null): Promise<SessionStoreState> {
    const category = this.category(id);
    if (before !== id) this.categories = placeBefore(this.categories, category, before);
    return this.changed();
  }
  async search(query: unknown): Promise<SessionSearchHit[]> {
    const text = String(query || '').trim().toLowerCase().slice(0, 200);
    if (!text) return [];
    const found: SessionSearchHit[] = [];
    for (const session of [...this.sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
      if (found.length >= SEARCH_RESULTS) break;
      const inTitle = session.title.toLowerCase().includes(text);
      let hit = '';
      try { for (const entry of session.id === this.active ? this.history : await this.read(session.id)) if ((hit = snippet(entry.content, text))) break; }
      catch (error) { console.warn(`Skipping unreadable chat ${session.id}:`, errMsg(error)); }
      if (inTitle || hit) found.push({ id: session.id, title: session.title, snippet: inTitle ? '' : hit });
    }
    return found;
  }
  // Every chat's turns in time order, for what looks across chats, such as reflection. since: only chats changed at or
  // after that time, which the index says without reading a chat (efficiency audit, fix 10). A chat changed earlier
  // can't hold a later turn; one whose time can't be read is read all the same.
  async allHistory({ since = '' }: { since?: string } = {}): Promise<HistoryEntry[]> {
    const all: HistoryEntry[] = [], from = Date.parse(since);
    for (const session of this.sessions) {
      // An import nobody has added to has nothing of yours in it, and may be large.
      if (session.imported && session.turns === session.imported.turns) continue;
      if (Number.isFinite(from) && Date.parse(session.updatedAt) < from && session.id !== this.active) continue;
      try { all.push(...(session.id === this.active ? this.history : await this.read(session.id))); }
      catch (error) { console.warn(`Skipping unreadable chat ${session.id}:`, errMsg(error)); }
    }
    if (!this.active) all.push(...this.history);
    return all.map((entry, order) => ({ entry, order })).sort((a, b) => String(a.entry.at || '').localeCompare(String(b.entry.at || '')) || a.order - b.order).map(({ entry }) => entry);
  }
}
