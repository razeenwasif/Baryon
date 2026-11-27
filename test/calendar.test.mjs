import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CalendarConnection, READ_SCOPES, WRITE_SCOPE, googleClient, eventDraft, timeRange } from '../desktop/calendar.mjs';
import { runCalendar } from '../desktop/calendar-agent.mjs';
import { wantsCalendar, requestMode } from '../src/chat-routing.js';
import { DEFAULTS } from '../src/defaults.js';
import { ConversationMemory } from '../desktop/memory.mjs';
const client = { clientId: '123-test.apps.googleusercontent.com', clientSecret: 'client-secret' };
const value = { client, tokens: { accessToken: 'access', refreshToken: 'refresh', scope: [...READ_SCOPES, WRITE_SCOPE].join(' '), expiresAt: 1000000 } };
const range = { timeMin: '2026-09-15T00:00:00+10:00', timeMax: '2026-09-16T00:00:00+10:00' };
const draft = { summary: 'Study time', start: '2026-09-15T15:00:00+10:00', end: '2026-09-15T16:00:00+10:00', timeZone: 'Australia/Sydney', allDay: false };
const json = (body, status = 200) => Response.json(body, { status });
function connection(fetchImpl, initial = value) {
  let saved = structuredClone(initial);
  const api = new CalendarConnection({ read: async () => saved, write: async v => { saved = v; }, openExternal: async () => {}, fetchImpl, now: () => 1000 });
  return { api, saved: () => saved };
}
test('client import accepts only desktop clients and ignores supplied token endpoints', () => {
  assert.deepEqual(googleClient({ installed: { client_id: client.clientId, client_secret: client.clientSecret, token_uri: 'https://attacker.test' } }), client);
  assert.throws(() => googleClient({ web: { client_id: client.clientId } }), /Desktop app/);
  assert.throws(() => googleClient({ type: 'service_account' }));
});
test('date ranges, all-day end dates, and daylight saving are validated', () => {
  assert.deepEqual(timeRange(range), range);
  assert.throws(() => timeRange({ ...range, timeMax: range.timeMin }));
  assert.throws(() => timeRange({ ...range, timeMax: '2027-09-15T00:00:00Z' }));
  assert.throws(() => timeRange({ ...range, timeMin: '2026-09-15T00:00:00' }));
  assert.equal(eventDraft(draft).start.timeZone, 'Australia/Sydney');
  assert.throws(() => eventDraft({ ...draft, start: '2026-09-15T15:00:00+11:00' }), /time zone/);
  assert.throws(() => eventDraft({ ...draft, attendees: ['someone@example.com'] }), /personal events/);
  assert.throws(() => eventDraft({ ...draft, allDay: true, start: '2026-02-30', end: '2026-03-03' }));
  assert.equal(eventDraft({ ...draft, allDay: true, start: '2026-09-15', end: '2026-09-16' }).end.date, '2026-09-16');
});
test('refresh coalesces, rotates tokens, and status never exposes secrets', async () => {
  let calls = 0;
  const { api, saved } = connection(async () => { calls++; return json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 }); }, { ...value, tokens: { ...value.tokens, expiresAt: 0 } });
  await api.load(); await Promise.all([api.accessToken(), api.accessToken()]); assert.equal(calls, 1);
  assert.equal(saved().tokens.refreshToken, 'new-refresh'); assert(!JSON.stringify(api.status()).includes('new-refresh')); assert(!JSON.stringify(api.status()).includes('client-secret'));
});
test('disconnect during refresh cannot resurrect a connection', async () => {
  let release; const gate = new Promise(r => { release = r; });
  const { api, saved } = connection(async () => { await gate; return json({ access_token: 'late', expires_in: 3600 }); }, { ...value, tokens: { ...value.tokens, expiresAt: 0 } });
  await api.load(); const promise = api.accessToken(); await api.disconnect(); release(); await assert.rejects(promise, /connection changed/); assert.equal(saved(), null);
});
test('event queries encode IDs, expand recurrences, mark truncation, and omit private extra fields', async () => {
  let url;
  const { api } = connection(async u => { url = new URL(u); return json({ nextPageToken: 'more', timeZone: 'Australia/Sydney', items: [{ id: 'event', summary: '<script>data</script>', description: 'private notes', attendees: ['private'], start: { date: '2026-09-15' }, end: { date: '2026-09-16' }, htmlLink: 'https://attacker.test/' }, { status: 'cancelled' }] }); });
  await api.load(); const result = await api.events({ ...range, calendarId: 'x/y?@group.calendar.google.com' });
  assert(url.pathname.includes('x%2Fy%3F')); assert.equal(url.searchParams.get('singleEvents'), 'true'); assert.equal(result.events.length, 1); assert.equal(result.truncated, true); assert.equal(result.events[0].url, null); assert(!JSON.stringify(result).includes('private'));
});
test('availability failures never look like an empty free calendar', async () => {
  const { api } = connection(async () => json({ calendars: { primary: { errors: [{ reason: 'notFound' }] } } }));
  await api.load(); assert.equal((await api.freeBusy(range)).incomplete, true);
  assert.equal((await api.freeBusy({ ...range, calendarIds: ['missing'] })).incomplete, true);
});
test('creation requires permission, exact preview approval and verified primary ownership', async () => {
  const posts = []; let approved;
  const { api } = connection(async (url, opts) => {
    if (url.includes('calendarList')) return json({ items: [{ id: 'me@example.com', summary: 'Personal', primary: true, accessRole: 'owner' }] });
    posts.push({ url, body: JSON.parse(opts.body) }); return json({ id: 'saved', summary: draft.summary, start: { dateTime: draft.start }, end: { dateTime: draft.end } });
  });
  await api.load(); assert.deepEqual(await api.create(draft, async p => { approved = p; return false; }), { created: false, cancelled: true }); assert.equal(posts.length, 0);
  const result = await api.create(draft, async () => true); assert(result.created); assert.equal(approved.calendarId, 'me@example.com'); assert.equal(approved.start.dateTime, draft.start);
  assert(posts[0].url.endsWith('/calendars/primary/events?sendUpdates=none')); assert.equal(posts[0].body.attendees, undefined); assert.match(posts[0].body.id, /^[0-9a-f]{32}$/);
  const read = connection(async () => { throw new Error('Must not fetch'); }, { ...value, tokens: { ...value.tokens, scope: READ_SCOPES.join(' ') } }).api;
  await read.load(); await assert.rejects(read.create(draft, async () => true), /Enable event creation/);
});
test('cancel after approval prevents a POST; ambiguous write failures do not retry', async () => {
  let posts = 0;
  const { api } = connection(async url => { if (url.includes('calendarList')) return json({ items: [{ id: 'me', primary: true, accessRole: 'owner' }] }); posts++; throw new Error('network'); });
  await api.load(); const abort = new AbortController();
  await assert.rejects(api.create(draft, async () => { abort.abort(); return true; }, abort.signal)); assert.equal(posts, 0);
  await assert.rejects(api.create(draft, async () => true), /may have been saved/); assert.equal(posts, 1);
});
test('calendar routing handles personal schedule questions and bounded followups', () => {
  for (const s of ["What's on my calendar tomorrow?", 'Am I free this afternoon?', 'Find my availability next week', 'Schedule a study session tomorrow', 'Add a workout to my calendar']) assert(wantsCalendar(s), s);
  for (const s of ['How do I use Google Calendar?', 'Explain photosynthesis', 'Translate "my calendar"', 'Do not look at my calendar']) assert.equal(wantsCalendar(s), false, s);
  assert(wantsCalendar('What about Friday?', [{ mode: 'calendar' }])); assert.equal(wantsCalendar('What about Friday?', []), false);
  assert.equal(requestMode('What is on my calendar?', 'chat', DEFAULTS), 'calendar');
  for (const [service, last] of [['calendar', { mode: 'calendar' }], ['gmail', { mode: 'gmail' }], ['drive', { mode: 'drive' }]]) for (const s of ['try again', 'Try again.', 'Okay, try it again', 'Can you try again?', 'retry', 'check again', 'I reconnected']) assert.equal(requestMode(s, 'chat', DEFAULTS, [last]), service, `${service}: ${s}`);
  for (const s of ['try again', 'Tried again yesterday, it was fine', 'Try another approach']) assert.equal(requestMode(s, 'chat', DEFAULTS, [{ mode: 'chat' }]), 'chat', s);
  assert.equal(requestMode('Tried again yesterday, it was fine', 'chat', DEFAULTS, [{ mode: 'calendar' }]), 'chat');
  assert.equal(requestMode('Explain my calendar on my screen', 'chat', DEFAULTS), 'screen');
});
test('calendar replies do not seed automatic long-term recall after a restart', async () => {
  const memory = new ConversationMemory({ read: async () => null, write: async () => {} });
  await memory.init([{ role: 'user', mode: 'calendar', content: 'My calendar tomorrow?' }, { role: 'assistant', mode: 'calendar', content: 'A private appointment.' }]);
  assert.equal(memory.episodes.length, 0);
});
test('subscription runner only exposes calendar tools and limits creation to one attempt', async () => {
  let creates = 0, spoken;
  const calendar = { status: () => ({ connected: true }), create: async () => { creates++; return { created: false, cancelled: true }; } };
  const provider = { turn: async options => {
    assert(options.tools.every(t => t.name.startsWith('calendar_'))); assert(!options.input[0].text.includes('unrelated secret'));
    const first = await options.toolHandler({ tool: 'calendar_create', arguments: draft }); assert(first.contentItems[0].text.includes('cancelled'));
    const second = await options.toolHandler({ tool: 'calendar_create', arguments: draft }); assert(second.contentItems[0].text.includes('already proposed'));
    return 'Nothing was created.';
  } };
  assert.equal(await runCalendar({ provider, settings: DEFAULTS, history: [{ role: 'user', content: 'unrelated secret', mode: 'chat' }], text: 'Add study to my calendar', calendar, approve: async () => false, signal: new AbortController().signal, onText: s => { spoken = s; } }), 'Nothing was created.');
  assert.equal(creates, 1); assert.equal(spoken, 'Nothing was created.');
});
test('OpenAI runner feeds function results back without screenshots or desktop tools', async () => {
  let calls = 0;
  const provider = { response: async body => { calls++; assert(body.tools.every(t => t.name.startsWith('calendar_'))); if (calls === 1) return { output: [{ type: 'function_call', name: 'calendar_events', arguments: JSON.stringify(range), call_id: 'c' }] }; assert(body.input.at(-1).output.includes('No events')); return { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Your calendar is empty.' }] }] }; } };
  const calendar = { status: () => ({ connected: true }), events: async () => ({ result: 'No events' }) };
  assert.equal(await runCalendar({ provider, settings: { ...DEFAULTS, backend: 'openai' }, history: [], text: 'Check my calendar', calendar, signal: new AbortController().signal }), 'Your calendar is empty.'); assert.equal(calls, 2);
});
test('Google OAuth uses a random loopback port, state and PKCE, with optional creation access', async () => {
  let open; const opened = new Promise(r => { open = r; }); let tokenBody;
  const { api, saved } = connection(async (url, opts) => { assert.equal(url, 'https://oauth2.googleapis.com/token'); tokenBody = opts.body; return json({ access_token: 'new', refresh_token: 'new-refresh', scope: READ_SCOPES.join(' '), expires_in: 3600 }); }, { client });
  await api.load(); api.openExternal = async url => open(new URL(url));
  const login = api.connect(false); const auth = await opened;
  try {
    assert.equal(auth.hostname, 'accounts.google.com'); assert.equal(auth.searchParams.get('access_type'), 'offline'); assert(!auth.searchParams.get('scope').includes(WRITE_SCOPE));
    const redirect = auth.searchParams.get('redirect_uri'); assert.equal(new URL(redirect).hostname, '127.0.0.1');
    assert.equal((await fetch(redirect + '?state=wrong&code=code')).status, 400);
    assert.equal((await fetch(redirect + '?state=' + auth.searchParams.get('state') + '&code=code')).status, 200);
    assert((await login).connected); assert.equal(createHash('sha256').update(tokenBody.get('code_verifier')).digest('base64url'), auth.searchParams.get('code_challenge')); assert.equal(saved().tokens.refreshToken, 'new-refresh');
  } finally { api.close(); }
});
