import { defineTool } from './tool-registry.mjs';

// Fairy's Google Calendar, Gmail and Drive tools, defined once for every agent and provider. Each runs against the
// connection in the request's context, so a request reaches only the accounts it was given.
const string = { type: 'string' };

export const CALENDAR_TOOLS = [
  defineTool({ name: 'calendar_list', description: 'List the connected user’s calendars and their IDs and time zones.', run: (_args, { calendar, signal }) => calendar.calendars(signal) }),
  defineTool({ name: 'calendar_events', description: 'Read up to 100 events in a range of at most 31 days. Use calendarId primary unless another calendar is requested. Recurring events are expanded. All-day end dates are exclusive. truncated means more events exist; narrow the time range.',
    properties: { calendarId: string, timeMin: string, timeMax: string, query: string }, required: ['timeMin', 'timeMax'], run: (args, { calendar, signal }) => calendar.events(args, signal) }),
  defineTool({ name: 'calendar_free_busy', description: 'Read occupied intervals for up to 10 calendars over at most 31 days. Never infer availability for calendars with errors or missing data.',
    properties: { timeMin: string, timeMax: string, calendarIds: { type: 'array', items: string, minItems: 1, maxItems: 10 } }, required: ['timeMin', 'timeMax'], run: (args, { calendar, signal }) => calendar.freeBusy(args, signal) }),
  defineTool({ name: 'calendar_create', description: 'Propose one personal event on the primary calendar. The host shows the exact event for approval before saving. No guests, invitations, recurring events, or deletion. An all-day end date is exclusive. Do not retry after cancellation or an uncertain result.',
    properties: { summary: string, start: string, end: string, timeZone: string, allDay: { type: 'boolean' } }, required: ['summary', 'start', 'end', 'timeZone', 'allDay'],
    risk: 'write', once: 'An event was already proposed in this request. Do not retry; ask the user to check Calendar.', run: (args, { calendar, approve, signal, outsideWriteClientId }) => calendar.create(args, approve, signal, outsideWriteClientId ? { eventId: outsideWriteClientId } : {}) }),
];

export const GMAIL_TOOLS = [
  defineTool({ name: 'gmail_search', description: 'Search Gmail, ten message snippets per page. Defaults to unread inbox. Supports Gmail operators such as from:, subject:, newer_than:, is:unread. Read threads before detailed summaries. nextPageToken means more results exist.',
    properties: { query: string, pageToken: string }, run: (args, { gmail, signal }) => gmail.search(args, signal) }),
  // Reading a thread is what lets a draft answer one of its messages.
  defineTool({ name: 'gmail_thread', description: 'Read a Gmail thread returned by search. Up to 20 recent messages and 24000 body characters. Attachments excluded; report unavailable or truncated content.',
    properties: { threadId: string }, required: ['threadId'],
    async run(args, { gmail, signal, state }) {
      const result = await gmail.thread(args.threadId, signal);
      state.observed ??= new Set();
      for (const message of result.messages) state.observed.add(message.id);
      return result;
    } }),
  defineTool({ name: 'gmail_save_reply_draft', description: 'Save one unsent reply draft to a source message read in this request. Recipient and threading headers are derived from the message. No sending, reply-all, CC/BCC, or attachments. Do not retry if the result is uncertain.',
    properties: { messageId: string, body: string }, required: ['messageId', 'body'], risk: 'write', once: 'A draft was already attempted. Check Gmail Drafts; do not retry.',
    guard: (args, { state }) => state.observed?.has(args.messageId) ? '' : 'Read the source thread in this request before drafting a reply.',
    run: (args, { gmail, signal }) => gmail.draftReply(args, signal) }),
];

export const DRIVE_TOOLS = [
  defineTool({ name: 'drive_search', description: 'Search files in Google Drive by name, keyword, or MIME type. Returns metadata and direct web links. Next page token indicates more results exist.',
    properties: { query: string, mimeType: string, pageSize: { type: 'number' }, pageToken: string }, run: (args, { drive, signal }) => drive.search(args, signal) }),
  defineTool({ name: 'drive_read_file', description: 'Read the text contents of a Google Doc, Google Sheet (exported as CSV), presentation, or text/markdown/code file by its fileId.',
    properties: { fileId: string }, required: ['fileId'], run: (args, { drive, signal }) => drive.readFile(args.fileId, signal) }),
  defineTool({ name: 'drive_list_recent', description: 'List recently modified files in Google Drive. Shows up to 15 recent files.',
    properties: { pageSize: { type: 'number' } }, run: (args, { drive, signal }) => drive.search({ ...args, pageSize: args.pageSize || 15 }, signal) }),
  defineTool({ name: 'drive_export_file', description: 'Export a Google Doc (markdown, html, or text), Google Sheet (csv or html), or Google Slides presentation (text) by its fileId.',
    properties: { fileId: string, format: { type: 'string', enum: ['markdown', 'html', 'text', 'csv'] } }, required: ['fileId'],
    run: (args, { drive, signal }) => drive.exportFile(args, signal) }),
  defineTool({ name: 'drive_create_file', description: 'Propose creating a new text document or file on Google Drive. The host shows an approval dialog before anything is created.',
    properties: { name: string, content: string, mimeType: string }, required: ['name', 'content'], risk: 'write', once: 'A file creation was already attempted. Do not retry; check Google Drive.',
    run: (args, { drive, approve, signal }) => drive.createFile(args, approve, signal) }),
  defineTool({ name: 'drive_create_doc', description: 'Propose creating a native Google Doc from Markdown or plain text. The host shows an approval card before creating.',
    properties: { name: string, content: string, format: { type: 'string', enum: ['markdown', 'plain'] } }, required: ['name', 'content'], risk: 'write', once: 'A Google Doc creation was already attempted. Do not retry; check Google Drive.',
    run: (args, { drive, approve, signal }) => drive.createDoc(args, approve, signal) }),
  defineTool({ name: 'drive_create_sheet', description: 'Propose creating a native Google Sheet from structured rows (2D array) or CSV text. The host shows an approval card before creating.',
    properties: { name: string, csv: string, rows: { type: 'array', items: { type: 'array', items: { type: ['string', 'number', 'boolean'] } } } }, required: ['name'], risk: 'write', once: 'A Google Sheet creation was already attempted. Do not retry; check Google Drive.',
    run: (args, { drive, approve, signal }) => drive.createSheet(args, approve, signal) }),
  defineTool({ name: 'drive_create_slides', description: 'Propose creating a new Google Slides presentation with an optional outline stored in its description. The host shows an approval card before creating.',
    properties: { name: string, outline: string }, required: ['name'], risk: 'write', once: 'A Google Slides presentation was already attempted. Do not retry; check Google Drive.',
    run: (args, { drive, approve, signal }) => drive.createSlides(args, approve, signal) }),
  defineTool({ name: 'drive_update_file', description: 'Propose replacing the text contents of an existing Google Doc (Markdown/plain), Google Sheet (CSV), or text file by its fileId. The host shows an approval card before updating.',
    properties: { fileId: string, content: string, format: { type: 'string', enum: ['markdown', 'plain'] } }, required: ['fileId', 'content'], risk: 'write', once: 'A file update was already attempted. Do not retry; check Google Drive.',
    run: (args, { drive, approve, signal }) => drive.updateFile(args, approve, signal) }),
];
