import { GoogleConnection, type GoogleConnectionOptions, type GoogleConnectionStatus } from './google-connection.mjs';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
export const DRIVE_READ_SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];
export const DRIVE_WRITE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';
export const GOOGLE_SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
export const GOOGLE_SLIDES_MIME = 'application/vnd.google-apps.presentation';

export type DriveConnectionOptions = Omit<GoogleConnectionOptions, 'service' | 'apiRoot' | 'readScopes' | 'writeScope'>;

export interface DriveConnectionStatus extends GoogleConnectionStatus {
  canCreate: boolean;
}

export interface DriveRawFile {
  id?: unknown;
  name?: unknown;
  mimeType?: string;
  modifiedTime?: string;
  size?: string | number | null;
  webViewLink?: string;
  iconLink?: string;
  shared?: boolean;
  description?: string;
}

export interface DriveFileView {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size: number | null;
  shared: boolean;
  url: string;
}

export interface DriveProfile {
  name: string;
  email: string;
  quota: {
    limit: number;
    usage: number;
  } | null;
}

export interface DriveSearchArgs {
  query?: string;
  mimeType?: string;
  pageSize?: number | string;
  pageToken?: string;
}

export interface DriveSearchResult {
  query: string;
  files: DriveFileView[];
  nextPageToken: string | null;
  note: string;
}

export interface DriveReadFileResult extends DriveFileView {
  content: string;
  truncated: boolean;
  format: 'google-doc' | 'google-sheet-csv' | 'google-slides-text' | 'text' | 'binary';
}

export interface DriveApprovalRequest {
  action: 'create' | 'update';
  tool: string;
  fileId?: string;
  name: string;
  mimeType?: string;
  content: string;
  contentLength: number;
}

export type DriveApprove = (details: DriveApprovalRequest) => Promise<boolean> | boolean;

export interface DriveCreateFileArgs {
  name?: unknown;
  content?: unknown;
  mimeType?: string;
}

export interface DriveCreateDocArgs {
  name?: unknown;
  content?: unknown;
  format?: string;
}

export interface DriveCreateSheetArgs {
  name?: unknown;
  rows?: unknown;
  csv?: unknown;
}

export interface DriveSlideItem {
  title?: unknown;
  bullets?: unknown;
}

export interface DriveCreateSlidesArgs {
  name?: unknown;
  outline?: unknown;
  slides?: unknown;
}

export interface DriveUpdateFileArgs {
  fileId?: unknown;
  content?: unknown;
  format?: string;
  mimeType?: string;
}

export interface DriveExportArgs {
  fileId?: unknown;
  format?: unknown;
}

export interface DriveExportResult extends DriveFileView {
  content: string;
  truncated: boolean;
  exportMime: string;
}

interface DriveAboutResponse {
  user?: {
    displayName?: string;
    emailAddress?: string;
  };
  storageQuota?: {
    limit?: string | number;
    usage?: string | number;
  };
}

interface DriveFilesListResponse {
  files?: DriveRawFile[];
  nextPageToken?: string;
}

const id = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) {
    throw new Error('Choose a valid Google Drive file ID.');
  }
  return value;
};

const limited = (v: unknown, n = 300): string => String(v ?? '').slice(0, n);

const escapeHtml = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function formatInlineMarkdown(escapedLine: string): string {
  // Replace inline code spans first using NUL sentinels so * and ** inside code stay literal.
  const codeSpans: string[] = [];
  const withPlaceholders = escapedLine.replace(/`([^`]+)`/g, (_: string, code: string) => {
    const idx = codeSpans.length;
    codeSpans.push(`<code>${code}</code>`);
    return `\u0000${idx}\u0000`;
  });
  const styled = withPlaceholders
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  return styled.replace(/\u0000(\d+)\u0000/g, (_: string, idx: string) => codeSpans[Number(idx)] || '');
}

// Converts simple Markdown into clean, XSS-safe HTML for native Google Docs import.
export function markdownToHtml(text: unknown): string {
  const lines = escapeHtml(String(text ?? '').slice(0, 50000)).split(/\r?\n/);
  const blocks: string[] = [];
  let listTag: 'ul' | 'ol' | null = null;
  let paragraph: string[] = [];

  const flushParagraph = (): void => {
    if (!paragraph.length) return;
    blocks.push(`<p>${paragraph.join('<br>')}</p>`);
    paragraph = [];
  };
  const closeList = (): void => {
    if (!listTag) return;
    blocks.push(`</${listTag}>`);
    listTag = null;
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      flushParagraph();
      closeList();
      continue;
    }
    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      blocks.push(`<h${level}>${formatInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    const ul = trimmed.match(/^[-*]\s+(.+)$/);
    if (ul) {
      flushParagraph();
      if (listTag !== 'ul') {
        closeList();
        listTag = 'ul';
        blocks.push('<ul>');
      }
      blocks.push(`<li>${formatInlineMarkdown(ul[1])}</li>`);
      continue;
    }
    const ol = trimmed.match(/^\d+\.\s+(.+)$/);
    if (ol) {
      flushParagraph();
      if (listTag !== 'ol') {
        closeList();
        listTag = 'ol';
        blocks.push('<ol>');
      }
      blocks.push(`<li>${formatInlineMarkdown(ol[1])}</li>`);
      continue;
    }
    closeList();
    paragraph.push(formatInlineMarkdown(rawLine));
  }
  flushParagraph();
  closeList();
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${blocks.join('\n')}</body></html>`;
}

// Converts a 2D array of spreadsheet cells into RFC 4180 CSV (capped to 50,000 chars).
export function rowsToCsv(rows: unknown): string {
  if (!Array.isArray(rows)) throw new Error('Rows must be a 2D array.');
  const maxRows = 5000;
  const maxCols = 200;
  const csvRows: string[] = [];
  for (const row of rows.slice(0, maxRows)) {
    const cells: unknown[] = Array.isArray(row) ? row.slice(0, maxCols) : [row];
    csvRows.push(
      cells
        .map(cell => {
          const str = cell === null || cell === undefined ? '' : String(cell);
          return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
        })
        .join(',')
    );
  }
  return csvRows.join('\r\n').slice(0, 50000);
}

export function escapeDriveQuery(term: unknown): string {
  return String(term || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function buildSearchQuery(query?: unknown, mimeType?: unknown): string {
  const parts = ['trashed = false'];
  if (query && typeof query === 'string' && query.trim()) {
    const escaped = escapeDriveQuery(query.trim().slice(0, 200));
    parts.push(`(name contains '${escaped}' or fullText contains '${escaped}')`);
  }
  if (mimeType && typeof mimeType === 'string' && mimeType.trim()) {
    const escapedMime = escapeDriveQuery(mimeType.trim().slice(0, 100));
    parts.push(`mimeType = '${escapedMime}'`);
  }
  return parts.join(' and ');
}

function defaultDriveUrl(cleanId: string, mimeType?: string): string {
  if (mimeType === GOOGLE_DOC_MIME) return `https://docs.google.com/document/d/${cleanId}/edit`;
  if (mimeType === GOOGLE_SHEET_MIME) return `https://docs.google.com/spreadsheets/d/${cleanId}/edit`;
  if (mimeType === GOOGLE_SLIDES_MIME) return `https://docs.google.com/presentation/d/${cleanId}/edit`;
  return `https://drive.google.com/file/d/${cleanId}/view`;
}

export function driveFileView(f: DriveRawFile): DriveFileView {
  const cleanId = id(f.id);
  let url: string | null = null;
  try {
    const u = new URL(f.webViewLink ?? '');
    if (u.protocol === 'https:' && ['drive.google.com', 'docs.google.com'].includes(u.hostname)) {
      url = u.href;
    }
  } catch {}
  return {
    id: cleanId,
    name: limited(f.name || '(Untitled file)'),
    mimeType: limited(f.mimeType || 'application/octet-stream'),
    modifiedTime: f.modifiedTime || '',
    size: f.size ? Number(f.size) : null,
    shared: Boolean(f.shared),
    url: url || defaultDriveUrl(cleanId, f.mimeType),
  };
}

export class DriveConnection extends GoogleConnection {
  constructor(options: DriveConnectionOptions) {
    super({
      ...options,
      service: 'Drive',
      apiRoot: API,
      readScopes: DRIVE_READ_SCOPES,
      writeScope: DRIVE_WRITE_SCOPE,
    });
  }

  override status(): DriveConnectionStatus {
    const s = super.status();
    return { ...s, canCreate: s.canWrite };
  }

  async profile(signal?: AbortSignal): Promise<DriveProfile> {
    const data = await this.request<DriveAboutResponse>('/about?fields=user(displayName,emailAddress),storageQuota', { signal });
    return {
      name: data.user?.displayName || '',
      email: data.user?.emailAddress || '',
      quota: data.storageQuota ? {
        limit: Number(data.storageQuota.limit) || 0,
        usage: Number(data.storageQuota.usage) || 0,
      } : null,
    };
  }

  async search(args: DriveSearchArgs = {}, signal?: AbortSignal): Promise<DriveSearchResult> {
    const query = args.query ?? '';
    const mimeType = args.mimeType ?? '';
    const q = buildSearchQuery(query, mimeType);
    const pageSize = Math.min(Math.max(1, Number(args.pageSize) || 10), 25);
    const params = new URLSearchParams({
      q,
      pageSize: String(pageSize),
      orderBy: 'modifiedTime desc',
      fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,size,webViewLink,iconLink,shared)',
      ...(args.pageToken ? { pageToken: args.pageToken } : {}),
    });

    const data = await this.request<DriveFilesListResponse>('/files?' + params, { signal });
    return {
      query,
      files: (data.files || []).map(driveFileView),
      nextPageToken: data.nextPageToken || null,
      note: 'Search results show file metadata and links. Use drive_read_file with a fileId to inspect text or spreadsheet contents.',
    };
  }

  async readFile(fileId: unknown, signal?: AbortSignal): Promise<DriveReadFileResult> {
    const cleanId = id(fileId);
    const meta = await this.request<DriveRawFile>(`/files/${cleanId}?fields=id,name,mimeType,modifiedTime,size,webViewLink,shared,description`, { signal });
    const view = driveFileView(meta);

    // Google Docs -> export plain text
    if (meta.mimeType === 'application/vnd.google-apps.document') {
      const text = await this.requestRaw(`/files/${cleanId}/export?mimeType=text/plain`, { signal });
      const capped = text.slice(0, 16000);
      return {
        ...view,
        content: capped,
        truncated: text.length > 16000,
        format: 'google-doc',
      };
    }

    // Google Sheets -> export CSV
    if (meta.mimeType === 'application/vnd.google-apps.spreadsheet') {
      const csv = await this.requestRaw(`/files/${cleanId}/export?mimeType=text/csv`, { signal });
      const capped = csv.slice(0, 16000);
      return {
        ...view,
        content: capped,
        truncated: csv.length > 16000,
        format: 'google-sheet-csv',
      };
    }

    // Google Slides -> export plain text
    if (meta.mimeType === 'application/vnd.google-apps.presentation') {
      const text = await this.requestRaw(`/files/${cleanId}/export?mimeType=text/plain`, { signal });
      const capped = text.slice(0, 16000);
      return {
        ...view,
        content: capped,
        truncated: text.length > 16000,
        format: 'google-slides-text',
      };
    }

    // Plain text, markdown, csv, json, source code
    const isTextMime = /^(?:text\/|application\/(?:json|javascript|x-javascript|xml|xhtml\+xml|csv|x-yaml|yaml|toml|sql))/.test(meta.mimeType || '');
    if (isTextMime) {
      const text = await this.requestRaw(`/files/${cleanId}?alt=media`, { signal });
      const capped = text.slice(0, 16000);
      return {
        ...view,
        content: capped,
        truncated: text.length > 16000,
        format: 'text',
      };
    }

    // Binary / PDF / images
    return {
      ...view,
      content: `[Binary file (${meta.mimeType}). Text extraction not available directly. Open in browser: ${view.url}]`,
      truncated: false,
      format: 'binary',
    };
  }

  async requestRaw(path: string, { method = 'GET', signal }: { method?: string; signal?: AbortSignal } = {}): Promise<string> {
    const epoch = this.epoch;
    if (this.now() < this.retryAt) throw new Error(`Google Drive asked Fairy to wait. Try again later.`);
    let token = await this.accessToken();
    for (let i = 0; i < 2; i++) {
      signal?.throwIfAborted();
      if (epoch !== this.epoch) throw new Error('Drive connection changed.');
      let r: Response;
      try {
        r = await this.fetch(this.apiRoot + path, {
          method,
          redirect: 'follow',
          signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(25000)]),
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch (e) {
        throw e;
      }
      if (r.status === 401 && i === 0) {
        token = await this.accessToken(true);
        continue;
      }
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        let msg = `Google Drive request failed (${r.status}).`;
        try {
          const errJson = JSON.parse(text) as { error?: { message?: string } };
          if (errJson.error?.message) msg = errJson.error.message;
        } catch {}
        throw new Error(msg);
      }
      return await r.text();
    }
    throw new Error('Google Drive request failed after authentication retry.');
  }

  #assertWriteAccess(): void {
    if (!this.status().canCreate) {
      throw new Error('Enable file creation and reconnect Google Drive in Settings first.');
    }
  }

  async #writeRequest<T = DriveRawFile>(url: string, { method = 'POST', contentType, body, errorLabel = 'create file', signal }: { method?: string; contentType: string; body: string; errorLabel?: string; signal?: AbortSignal }): Promise<T> {
    const epoch = this.epoch;
    if (epoch !== this.epoch) throw new Error('Drive connection changed.');
    const token = await this.accessToken();
    const r = await this.fetch(url, {
      method,
      signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(30000)]),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': contentType,
      },
      body,
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      throw new Error(`Failed to ${errorLabel} in Google Drive: ${errText || r.statusText}`);
    }
    return await r.json() as T;
  }

  async #uploadMultipart({ metadata, uploadMime, body, errorLabel, signal, fields = '' }: { metadata: Record<string, unknown>; uploadMime: string; body: string; errorLabel: string; signal?: AbortSignal; fields?: string }): Promise<{ created: true; file: DriveFileView }> {
    const boundary = '-------314159265358979323846';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;
    const multipartBody =
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      delimiter +
      `Content-Type: ${uploadMime}\r\n\r\n` +
      body +
      closeDelimiter;
    const fieldsParam = fields ? `&fields=${encodeURIComponent(fields)}` : '';
    const result = await this.#writeRequest(`${UPLOAD_API}/files?uploadType=multipart${fieldsParam}`, {
      method: 'POST',
      contentType: `multipart/related; boundary=${boundary}`,
      body: multipartBody,
      errorLabel,
      signal,
    });
    return { created: true, file: driveFileView(result) };
  }

  async createFile(args: DriveCreateFileArgs, approve: DriveApprove, signal?: AbortSignal): Promise<{ created: true; file: DriveFileView } | { created: false; cancelled: true }> {
    if (!args || typeof args !== 'object') throw new Error('Invalid file creation arguments.');
    const name = limited(args.name || 'Untitled Document', 200).trim();
    const content = typeof args.content === 'string' ? args.content.slice(0, 50000) : '';
    const mimeType = args.mimeType || 'text/plain';

    this.#assertWriteAccess();
    signal?.throwIfAborted();
    if (!await approve({ action: 'create', tool: 'drive_create_file', name, mimeType, content, contentLength: content.length })) {
      return { created: false, cancelled: true };
    }
    signal?.throwIfAborted();

    return await this.#uploadMultipart({
      metadata: { name, mimeType },
      uploadMime: mimeType,
      body: content,
      errorLabel: 'create file',
      signal,
    });
  }

  async createDoc(args: DriveCreateDocArgs, approve: DriveApprove, signal?: AbortSignal): Promise<{ created: true; file: DriveFileView } | { created: false; cancelled: true }> {
    if (!args || typeof args !== 'object') throw new Error('Invalid Google Doc arguments.');
    const name = limited(args.name || 'Untitled Document', 200).trim();
    const content = typeof args.content === 'string' ? args.content.slice(0, 50000) : '';

    this.#assertWriteAccess();
    signal?.throwIfAborted();
    if (!await approve({ action: 'create', tool: 'drive_create_doc', name, mimeType: GOOGLE_DOC_MIME, content, contentLength: content.length })) {
      return { created: false, cancelled: true };
    }
    signal?.throwIfAborted();

    const plain = args.format === 'plain';
    return await this.#uploadMultipart({
      metadata: { name, mimeType: GOOGLE_DOC_MIME },
      uploadMime: plain ? 'text/plain; charset=UTF-8' : 'text/html; charset=UTF-8',
      body: plain ? content : markdownToHtml(content),
      errorLabel: 'create Google Doc',
      fields: 'id,name,mimeType,modifiedTime,webViewLink,shared',
      signal,
    });
  }

  async createSheet(args: DriveCreateSheetArgs, approve: DriveApprove, signal?: AbortSignal): Promise<{ created: true; file: DriveFileView } | { created: false; cancelled: true }> {
    if (!args || typeof args !== 'object') throw new Error('Invalid Google Sheet arguments.');
    const name = limited(args.name || 'Untitled Spreadsheet', 200).trim();
    let csvText: string;
    if (Array.isArray(args.rows)) csvText = rowsToCsv(args.rows);
    else if (typeof args.csv === 'string') csvText = args.csv.slice(0, 50000);
    else throw new Error('Provide rows or csv content for the Google Sheet.');

    this.#assertWriteAccess();
    signal?.throwIfAborted();
    if (!await approve({ action: 'create', tool: 'drive_create_sheet', name, mimeType: GOOGLE_SHEET_MIME, content: csvText, contentLength: csvText.length })) {
      return { created: false, cancelled: true };
    }
    signal?.throwIfAborted();

    return await this.#uploadMultipart({
      metadata: { name, mimeType: GOOGLE_SHEET_MIME },
      uploadMime: 'text/csv; charset=UTF-8',
      body: csvText,
      errorLabel: 'create Google Sheet',
      fields: 'id,name,mimeType,modifiedTime,webViewLink,shared',
      signal,
    });
  }

  async createSlides(args: DriveCreateSlidesArgs, approve: DriveApprove, signal?: AbortSignal): Promise<{ created: true; file: DriveFileView } | { created: false; cancelled: true }> {
    if (!args || typeof args !== 'object') throw new Error('Invalid Google Slides arguments.');
    const name = limited(args.name || 'Untitled Presentation', 200).trim();
    const outline = typeof args.outline === 'string'
      ? args.outline.slice(0, 4000)
      : Array.isArray(args.slides)
        ? (args.slides as Array<string | DriveSlideItem | null | undefined>)
            .map(s => (typeof s === 'string' ? s : [s?.title, ...(Array.isArray(s?.bullets) ? s.bullets : [])].filter(Boolean).join('\n')))
            .join('\n\n')
            .slice(0, 4000)
        : '';

    this.#assertWriteAccess();
    signal?.throwIfAborted();
    if (!await approve({ action: 'create', tool: 'drive_create_slides', name, mimeType: GOOGLE_SLIDES_MIME, content: outline || '(Blank Google Slides presentation)', contentLength: outline.length })) {
      return { created: false, cancelled: true };
    }
    signal?.throwIfAborted();

    const metadata = {
      name,
      mimeType: GOOGLE_SLIDES_MIME,
      ...(outline ? { description: limited(outline, 2000) } : {}),
    };
    const result = await this.#writeRequest(`${API}/files?fields=${encodeURIComponent('id,name,mimeType,modifiedTime,webViewLink,shared')}`, {
      method: 'POST',
      contentType: 'application/json; charset=UTF-8',
      body: JSON.stringify(metadata),
      errorLabel: 'create Google Slides presentation',
      signal,
    });
    return { created: true, file: driveFileView(result) };
  }

  async updateFile(args: DriveUpdateFileArgs, approve: DriveApprove, signal?: AbortSignal): Promise<{ updated: true; file: DriveFileView } | { updated: false; cancelled: true }> {
    if (!args || typeof args !== 'object') throw new Error('Invalid file update arguments.');
    const cleanId = id(args.fileId);
    if (typeof args.content !== 'string') throw new Error('Provide text content to update the file.');
    const content = args.content.slice(0, 50000);

    this.#assertWriteAccess();
    const meta = await this.request<DriveRawFile>(`/files/${cleanId}?fields=id,name,mimeType,modifiedTime,webViewLink,shared`, { signal });

    let uploadMime: string;
    let body: string;
    if (meta.mimeType === GOOGLE_DOC_MIME) {
      const plain = args.format === 'plain';
      uploadMime = plain ? 'text/plain; charset=UTF-8' : 'text/html; charset=UTF-8';
      body = plain ? content : markdownToHtml(content);
    } else if (meta.mimeType === GOOGLE_SHEET_MIME) {
      uploadMime = 'text/csv; charset=UTF-8';
      body = content;
    } else {
      uploadMime = args.mimeType || meta.mimeType || 'text/plain; charset=UTF-8';
      body = content;
    }

    signal?.throwIfAborted();
    if (!await approve({ action: 'update', tool: 'drive_update_file', fileId: cleanId, name: String(meta.name ?? ''), mimeType: meta.mimeType, content, contentLength: content.length })) {
      return { updated: false, cancelled: true };
    }
    signal?.throwIfAborted();

    const fieldsParam = encodeURIComponent('id,name,mimeType,modifiedTime,webViewLink,shared');
    const result = await this.#writeRequest(`${UPLOAD_API}/files/${cleanId}?uploadType=media&fields=${fieldsParam}`, {
      method: 'PATCH',
      contentType: uploadMime,
      body,
      errorLabel: 'update file',
      signal,
    });
    return { updated: true, file: driveFileView(result) };
  }

  async exportFile(args: DriveExportArgs, signal?: AbortSignal): Promise<DriveExportResult> {
    const cleanId = id(args?.fileId);
    const meta = await this.request<DriveRawFile>(`/files/${cleanId}?fields=id,name,mimeType,modifiedTime,size,webViewLink,shared`, { signal });
    const format = String(args?.format || '').toLowerCase();

    let exportMime: string;
    if (meta.mimeType === GOOGLE_DOC_MIME) {
      exportMime = format === 'html' ? 'text/html' : format === 'text' ? 'text/plain' : 'text/markdown';
    } else if (meta.mimeType === GOOGLE_SHEET_MIME) {
      exportMime = format === 'html' ? 'text/html' : 'text/csv';
    } else if (meta.mimeType === GOOGLE_SLIDES_MIME) {
      exportMime = 'text/plain';
    } else {
      throw new Error('This file type cannot be exported via Google Workspace export; use drive_read_file instead.');
    }

    const text = await this.requestRaw(`/files/${cleanId}/export?mimeType=${encodeURIComponent(exportMime)}`, { signal });
    const capped = text.slice(0, 24000);
    return {
      ...driveFileView(meta),
      content: capped,
      truncated: text.length > 24000,
      exportMime,
    };
  }
}
