import { GoogleConnection } from './google-connection.mjs';
export const GMAIL_READ_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
export const GMAIL_DRAFT_SCOPE = 'https://www.googleapis.com/auth/gmail.compose';
const id = value => { if (typeof value !== 'string' || !/^[a-z0-9]{1,64}$/i.test(value)) throw new Error('Choose a message or thread returned by Gmail search.'); return value; };
const draftId = value => { if (typeof value !== 'string' || !/^[a-z0-9_-]{1,64}$/i.test(value)) throw new Error('Invalid Gmail draft ID.'); return value; };
const header = (message, name) => (message.payload?.headers || []).find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
function decode(bytes, charset = 'utf-8') { try { return new TextDecoder(charset).decode(bytes); } catch { return new TextDecoder().decode(bytes); } }
export function headerText(value) {
  return String(value).replace(/(\?=)\s+(?==\?)/g, '$1').replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (_, charset, kind, data) => {
    try { return decode(kind.toLowerCase() === 'b' ? Buffer.from(data, 'base64') : Buffer.from(data.replace(/_/g, ' ').replace(/=([a-f0-9]{2})/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16))), 'binary'), charset); } catch { return '[Unreadable header]'; }
  }).replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 500);
}
function htmlText(text) {
  return text.replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '').replace(/<!--[^]*?-->/g, '').replace(/<(?:br|\/p|\/div|\/li|\/tr)\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (m, entity) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }; const e = entity.toLowerCase();
    if (named[e]) return named[e]; const n = parseInt(e.startsWith('#x') ? e.slice(2) : e.slice(1), e.startsWith('#x') ? 16 : 10);
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : m;
  }).replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n/g, '\n\n').trim();
}
export function messageText(payload) {
  let visited = 0, unavailable = false, truncated = false;
  const read = (part, depth = 0) => {
    if (++visited > 100 || depth > 12) { truncated = true; return ''; }
    if (part.filename) return ''; // Attachments are not read or followed.
    if (part.mimeType?.startsWith('multipart/')) {
      if (part.mimeType === 'multipart/alternative') { const chosen = part.parts?.find(p => p.mimeType === 'text/plain') || part.parts?.find(p => p.mimeType === 'text/html') || part.parts?.[0]; return chosen ? read(chosen, depth + 1) : ''; }
      return (part.parts || []).map(p => read(p, depth + 1)).filter(Boolean).join('\n');
    }
    if (!['text/plain', 'text/html'].includes(part.mimeType)) return '';
    if (!part.body?.data) { if (part.body?.attachmentId) unavailable = true; return ''; }
    const data = part.body.data; if (data.length > 400000) truncated = true;
    const charset = ((part.headers || []).find(h => h.name.toLowerCase() === 'content-type')?.value || '').match(/charset=["']?([^\s;"']+)/i)?.[1];
    const text = decode(Buffer.from(data.slice(0, 400000), 'base64url'), charset);
    return part.mimeType === 'text/html' ? htmlText(text) : text;
  };
  const text = read(payload || {}).replace(/\x00/g, '').trim();
  return { text: text.slice(0, 8000), truncated: truncated || text.length > 8000, unavailable };
}
export function messageView(m, full = false) {
  return { id: id(m.id), threadId: id(m.threadId), from: headerText(header(m, 'From')), to: headerText(header(m, 'To')), subject: headerText(header(m, 'Subject')), date: headerText(header(m, 'Date')), unread: m.labelIds?.includes('UNREAD') || false, snippet: headerText(m.snippet || ''), url: `https://mail.google.com/mail/u/0/#all/${id(m.threadId)}`, ...(full ? { body: messageText(m.payload) } : {}) };
}
export function replyAddress(value) {
  const text = String(value || '');
  if (/[\r\n\x00]/.test(text) || text.length > 500) throw new Error('The reply address needs manual review in Gmail.');
  const matches = [...text.matchAll(/[A-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,}/gi)].map(m => m[0]);
  if (matches.length !== 1 || matches[0].length > 254) throw new Error('Could not identify one reply recipient. Open this message in Gmail.');
  return matches[0];
}
function encodedSubject(value) {
  // RFC 2047 encoded words, kept below the 75-character word limit.
  const chunks = []; let chunk = '';
  for (const ch of value) { if (Buffer.byteLength(chunk + ch) > 42) { chunks.push(chunk); chunk = ''; } chunk += ch; }
  if (chunk) chunks.push(chunk);
  return chunks.map(c => '=?UTF-8?B?' + Buffer.from(c).toString('base64') + '?=').join('\r\n ');
}
export function replyMime(source, body) {
  if (typeof body !== 'string' || !body.trim() || body.length > 12000 || body.includes('\x00')) throw new Error('Give the draft a body of 1–12,000 characters.');
  const to = replyAddress(header(source, 'Reply-To') || header(source, 'From'));
  const messageId = header(source, 'Message-ID').trim();
  if (!/^<[^<>\s\x00-\x1f]{1,250}>$/.test(messageId)) throw new Error('This message has no usable reply header. Draft the reply in Gmail.');
  const subject = headerText(header(source, 'Subject'));
  const replySubject = /^re\s*:/i.test(subject) ? subject : 'Re: ' + subject;
  const refs = [...header(source, 'References').matchAll(/<[^<>\s\x00-\x1f]{1,250}>/g)].map(m => m[0]).slice(-10);
  if (!refs.includes(messageId)) refs.push(messageId);
  const encodedBody = Buffer.from(body.trim()).toString('base64').match(/.{1,76}/g).join('\r\n');
  const raw = [`To: ${to}`, `Subject: ${encodedSubject(replySubject)}`, `In-Reply-To: ${messageId}`, `References: ${refs.join(' ')}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', encodedBody].join('\r\n');
  return { to, subject: replySubject, raw: Buffer.from(raw).toString('base64url') };
}
export class GmailConnection extends GoogleConnection {
  constructor(options) { super({ ...options, service: 'Gmail', apiRoot: 'https://gmail.googleapis.com/gmail/v1/users/me', readScopes: GMAIL_READ_SCOPES, writeScope: GMAIL_DRAFT_SCOPE }); }
  status() { const s = super.status(); return { ...s, canDraft: s.canWrite }; }
  request(path, options = {}) {
    const method = options.method || 'GET';
    // Even though Google's compose scope includes sending, this adapter cannot send.
    const allowed = method === 'GET' && /^(?:\/profile|\/messages(?:\/[a-z0-9]{1,64})?|\/threads\/[a-z0-9]{1,64}|\/drafts(?:\/[a-z0-9_-]{1,64})?)(?:\?|$)/i.test(path) || method === 'POST' && path === '/drafts';
    if (!allowed) throw new Error('This Gmail operation is unavailable. Only reading and creating unsent drafts are supported.');
    return super.request(path, options);
  }
  async profile(signal) { const p = await this.request('/profile', { signal }); return { email: p.emailAddress }; }
  // A count only, with nothing about the messages themselves. Google gives an estimate.
  async unreadEstimate(signal) {
    const data = await this.request(`/messages?${new URLSearchParams({ q: 'in:inbox is:unread', maxResults: '1' })}`, { signal });
    return Number(data.resultSizeEstimate) || 0;
  }
  // The IDs of the messages a search finds, nothing else: a check-in's look for anything new (token use, step 7).
  async unreadIds(query, signal) {
    const data = await this.request(`/messages?${new URLSearchParams({ q: query, maxResults: '100', includeSpamTrash: 'false' })}`, { signal });
    return (data.messages || []).map(m => String(m.id || '')).filter(Boolean);
  }
  async search(args = {}, signal) {
    const query = args.query ?? 'in:inbox is:unread';
    if (typeof query !== 'string' || query.length > 500 || /[\x00-\x1f]/.test(query)) throw new Error('Use a Gmail search query of at most 500 characters.');
    if (args.pageToken != null && (typeof args.pageToken !== 'string' || args.pageToken.length > 1000)) throw new Error('Invalid Gmail page token.');
    const q = new URLSearchParams({ q: query, maxResults: '10', includeSpamTrash: 'false', ...(args.pageToken ? { pageToken: args.pageToken } : {}) });
    const list = await this.request('/messages?' + q, { signal }), messages = [];
    for (const m of (list.messages || []).slice(0, 10)) messages.push(messageView(await this.request(`/messages/${id(m.id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`, { signal })));
    return { query, messages, nextPageToken: list.nextPageToken || null, estimatedMatches: list.resultSizeEstimate || 0, note: 'Search results contain snippets only. Read a thread for the message body. Links use Gmail account slot 0; select the connected account if needed.' };
  }
  async thread(threadId, signal) {
    const data = await this.request(`/threads/${id(threadId)}?format=full`, { signal });
    const all = (data.messages || []).sort((a,b) => Number(a.internalDate || 0) - Number(b.internalDate || 0));
    let remaining = 24000;
    const messages = all.slice(-20).map(m => { const v = messageView(m, true); const text = v.body.text.slice(0, remaining); remaining -= text.length; return { ...v, body: { ...v.body, text, truncated: v.body.truncated || text.length < v.body.text.length } }; });
    return { threadId: id(threadId), messages, truncated: all.length > 20 || messages.some(m => m.body.truncated), note: 'Attachments are excluded. HTML-only mail is converted to text without loading images or links.' };
  }
  async draftReply(args, signal) {
    if (!args || Object.keys(args).some(k => !['messageId', 'body'].includes(k))) throw new Error('Draft replies take only the source message ID and reply body. Recipients are derived from the source email.');
    if (!this.status().canDraft) throw new Error('Reconnect Gmail with Read + save reply drafts enabled.');
    const source = await this.request(`/messages/${id(args.messageId)}?format=metadata&metadataHeaders=From&metadataHeaders=Reply-To&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=References`, { signal });
    const draft = replyMime(source, args.body), profile = await this.profile(signal);
    if (draft.to.toLowerCase() === profile.email?.toLowerCase()) throw new Error('This would reply to your own address. Choose the incoming message in that thread.');
    signal?.throwIfAborted();
    const result = await this.request('/drafts', { method: 'POST', signal, body: { message: { raw: draft.raw, threadId: id(source.threadId) } } });
    if (!result.id) throw new Error('Gmail did not confirm the draft. Check Drafts before retrying.');
    return { saved: true, sent: false, draftId: result.id, threadId: source.threadId, to: draft.to, subject: draft.subject, body: args.body.trim(), url: 'https://mail.google.com/mail/u/0/#drafts', note: 'Saved as an unsent reply draft. Review it in Gmail.' };
  }
  // Part D lookup: checks whether a reply draft with this body already exists on the source message's thread.
  async findReplyDraft({ messageId, body = '' }, signal) {
    const source = await this.request(`/messages/${id(messageId)}?format=metadata&metadataHeaders=Subject`, { signal });
    const threadId = source?.threadId;
    if (!threadId) return null;
    const listed = await this.request('/drafts?maxResults=20', { signal });
    const drafts = Array.isArray(listed?.drafts) ? listed.drafts : [];
    const wanted = String(body || '').replace(/\s+/g, ' ').trim();
    for (const item of drafts) {
      if (item?.message?.threadId && item.message.threadId !== threadId) continue;
      if (!item?.id) continue;
      const full = await this.request(`/drafts/${draftId(item.id)}?format=full`, { signal });
      if (full?.message?.threadId !== threadId) continue;
      if (!wanted) return { id: full.id, threadId };
      const text = messageText(full.message?.payload)?.text || '';
      if (text.replace(/\s+/g, ' ').trim() === wanted) return { id: full.id, threadId };
    }
    return null;
  }
}
