import type { BoardDocument } from '../shared/document';

export interface BoardMeta {
  id: string;
  name: string;
  description?: string;
  session?: string;
  docId?: string;
  elementCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface BoardRecord {
  meta: BoardMeta;
  document: BoardDocument;
}

export interface BoardAskPayload {
  boardId?: string | null;
  prompt: string;
  doc: BoardDocument;
  selectedIds?: string[];
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface BoardAskResult {
  reply: string;
  document: BoardDocument | null;
  changed: boolean;
  opsApplied: number;
  summary: string;
  provider?: string;
  model?: string;
}

type FairyBoardsAPI = {
  boardsList?: () => Promise<BoardMeta[]>;
  boardsGet?: (id: string) => Promise<BoardRecord>;
  boardsCreate?: (payload: {
    name?: string;
    doc?: BoardDocument;
    session?: string;
    docId?: string;
    description?: string;
  }) => Promise<BoardRecord>;
  boardsSave?: (
    id: string,
    document: BoardDocument,
    metaPatch?: Partial<BoardMeta>,
  ) => Promise<BoardRecord>;
  boardsRename?: (id: string, name: string) => Promise<BoardRecord>;
  boardsDelete?: (id: string) => Promise<boolean>;
  boardsAsk?: (payload: BoardAskPayload) => Promise<BoardAskResult>;
  boardsExportFile?: (req: {
    data: string;
    encoding: 'base64' | 'utf8';
    extension: 'png' | 'jpg' | 'svg' | 'json';
    defaultName: string;
  }) => Promise<{ canceled: boolean; filePath?: string; error?: string }>;
  boardsImportImage?: () => Promise<{ canceled: boolean; images?: string[]; error?: string }>;
  boardsOpenFile?: () => Promise<
    { canceled: boolean; error?: string } & Partial<BoardRecord>
  >;
  onBoardsChanged?: (cb: (items: BoardMeta[]) => void) => () => void;
};

function api(): FairyBoardsAPI {
  return (window as unknown as { fairy?: FairyBoardsAPI }).fairy ?? {};
}

export const boardBridge = {
  list: async (): Promise<BoardMeta[]> => (await api().boardsList?.()) ?? [],
  get: async (id: string): Promise<BoardRecord> => {
    const fn = api().boardsGet;
    if (!fn) throw new Error('Boards storage is not available.');
    return fn(id);
  },
  create: async (payload: {
    name?: string;
    doc?: BoardDocument;
    session?: string;
    docId?: string;
    description?: string;
  } = {}): Promise<BoardRecord> => {
    const fn = api().boardsCreate;
    if (!fn) throw new Error('Boards storage is not available.');
    return fn(payload);
  },
  save: async (
    id: string,
    document: BoardDocument,
    metaPatch?: Partial<BoardMeta>,
  ): Promise<BoardRecord> => {
    const fn = api().boardsSave;
    if (!fn) throw new Error('Boards storage is not available.');
    return fn(id, document, metaPatch);
  },
  rename: async (id: string, name: string): Promise<BoardRecord> => {
    const fn = api().boardsRename;
    if (!fn) throw new Error('Boards storage is not available.');
    return fn(id, name);
  },
  remove: async (id: string): Promise<boolean> => (await api().boardsDelete?.(id)) ?? false,
  ask: async (payload: BoardAskPayload): Promise<BoardAskResult> => {
    const fn = api().boardsAsk;
    if (!fn) throw new Error('Boards assistant is not available.');
    return fn(payload);
  },
  exportFile: async (req: {
    data: string;
    encoding: 'base64' | 'utf8';
    extension: 'png' | 'jpg' | 'svg' | 'json';
    defaultName: string;
  }): Promise<{ canceled: boolean; filePath?: string; error?: string }> =>
    (await api().boardsExportFile?.(req)) ?? { canceled: true },
  importImage: async (): Promise<{ canceled: boolean; images?: string[]; error?: string }> =>
    (await api().boardsImportImage?.()) ?? { canceled: true },
  openFile: async (): Promise<{ canceled: boolean; error?: string } & Partial<BoardRecord>> =>
    (await api().boardsOpenFile?.()) ?? { canceled: true },
  onChanged: (cb: (items: BoardMeta[]) => void): (() => void) =>
    api().onBoardsChanged?.(cb) ?? (() => {}),
};
