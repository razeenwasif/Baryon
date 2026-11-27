import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { access, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AntigravityConnection, AGENT_NAME, SEARCH_AGENT_NAME, VISION_AGENT_NAME, TOOL_AGENT_NAME, agyEnv } from '../desktop/antigravity.mjs';
import { DEFAULTS, cleanSettings } from '../desktop/core.mjs';

async function fixture({ respond = (emit, message) => {
  emit({ event: 'step_update', step_update: { step_type: 'agent_response', state: 'ACTIVE', text_delta: 'Hello from ' } });
  emit({ event: 'step_update', step_update: { step_type: 'agent_response', state: 'DONE', text_delta: 'Gemini.\n' } });
  emit({ event: 'result', result: { status: 'SUCCESS', response: 'Hello from Gemini.\n' } });
} } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-agy-'));
  const children = [], fallbackCalls = [];
  const spawnProcess = (bin, args, options) => {
    const child = new EventEmitter();
    Object.assign(child, { bin, args, options, messages: [], killed: false });
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    const emit = event => child.stdout.write(JSON.stringify(event) + '\n');
    child.kill = () => { if (child.killed) return; child.killed = true; child.stdout.end(); queueMicrotask(() => child.emit('close', null)); };
    child.stdin = new Writable({ write(chunk, _encoding, callback) {
      const message = JSON.parse(chunk); child.messages.push(message); callback();
      queueMicrotask(() => respond(emit, message, child));
    } });
    children.push(child);
    return child;
  };
  const fallback = { chat: async (...args) => { fallbackCalls.push(args); return { text: 'From Codex.' }; } };
  const connection = new AntigravityConnection({ cwd: join(dir, 'workspace'), agentsDir: join(dir, 'agents'), executable: '/fake/agy', spawnProcess, fallback,
    listModels: async () => 'gemini-3.8-flash-low\tGemini 3.8 Flash (Low)\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\n' });
  return { connection, children, fallbackCalls, dir };
}


// Wait for a condition instead of a fixed delay: the suite runs files in
// parallel, so fixed sleeps make these tests flaky on a busy machine.
async function until(condition, description, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

test('antigravity chat streams a tool-free agent reply and warms the next process', async () => {
  const f = await fixture();
  try {
    const seen = [];
    const result = await f.connection.chat({ ...DEFAULTS, backend: 'antigravity', memory: 'Likes stars' }, [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }], 'How are you?', undefined, null, { onText: text => seen.push(text) });
    assert.equal(result.text, 'Hello from Gemini.');
    assert.deepEqual(seen, ['Hello from ', 'Hello from Gemini.\n', 'Hello from Gemini.']);
    const first = f.children[0];
    assert.deepEqual(first.args.slice(0, 6), ['--agent', AGENT_NAME, '--model', 'gemini-3.8-flash', '--effort', 'low']);
    assert(first.args.includes('--sandbox'));
    assert.equal(first.options.env.GEMINI_API_KEY, undefined);
    const content = first.messages[0].message.content;
    assert.equal(first.messages[0].event, 'user');
    assert.match(content, /Likes stars/); assert.match(content, /"content":"hello"/); assert.match(content, /Current message:\nHow are you\?$/);
    assert.equal(first.killed, true);
    await until(() => f.children.length > 1, 'the next process to start warming');
    const spare = f.children[1];
    assert(spare && !spare.killed, 'a spare process should be warming');
    const agent = await readFile(join(f.dir, 'agents', AGENT_NAME, 'agent.md'), 'utf8');
    assert.match(agent, /excludeDefaultComponents: true/); assert.match(agent, /tools: \[\]/); assert.match(agent, /inheritMcp: false/);
    await f.connection.chat({ ...DEFAULTS, backend: 'antigravity' }, [], 'Again');
    assert.equal(spare.messages.length, 1, 'the warm process serves the next turn');
  } finally { f.connection.close(); }
});

test('antigravity stops a turn as soon as the model starts a tool', async () => {
  const f = await fixture({ respond: emit => emit({ event: 'step_update', step_update: { step_type: 'tool', state: 'ACTIVE', tool_name: 'view_file' } }) });
  try {
    await assert.rejects(f.connection.chat(DEFAULTS, [], 'Read my files'), /tried to use a tool \(view_file\), so Fairy stopped/);
    assert.equal(f.children[0].killed, true);
  } finally { f.connection.close(); }
});

test('antigravity abort kills the process and reports failures', async () => {
  const f = await fixture({ respond: () => {} });
  try {
    const controller = new AbortController();
    const pending = f.connection.chat(DEFAULTS, [], 'Long question', controller.signal).then(() => null, error => error);
    await until(() => f.children[0]?.messages.length, 'the turn to reach agy');
    controller.abort();
    assert.match((await pending)?.message ?? '', /Stopped/);
    assert.equal(f.children[0].killed, true);
  } finally { f.connection.close(); }
  const failing = await fixture({ respond: emit => emit({ event: 'result', result: { status: 'ERROR', error: 'quota exhausted' } }) });
  try { await assert.rejects(failing.connection.chat(DEFAULTS, [], 'hi'), /Antigravity: quota exhausted/); }
  finally { failing.connection.close(); }
});

test('screen questions and live search run on Gemini with minimal, tool-limited agents', async () => {
  const tool = (name, state, parameters) => ({ event: 'step_update', step_update: { step_type: 'tool', tool_name: name, state, ...(parameters ? { tool_info: { name, parameters } } : {}) } });
  const f = await fixture({ respond: (emit, message) => {
    const content = message.message.content, path = /Screenshot of the user's display \(1×1\): (\S+)/.exec(content)?.[1];
    if (/peek elsewhere/.test(content)) emit(tool('view_file', 'ACTIVE', { AbsolutePath: '/etc/passwd' }));
    else if (/new name elsewhere/.test(content)) emit(tool('read_file', 'ACTIVE', { Path: '"/etc/passwd"' }));
    else if (path && /new name/.test(content)) { emit(tool('read_file', 'ACTIVE', { Path: `"${path}"` })); emit(tool('read_file', 'DONE', { Path: `"${path}"` })); emit({ event: 'result', result: { status: 'SUCCESS', response: 'Still a blank screen.' } }); }
    else if (path) { emit(tool('view_file', 'ACTIVE', { AbsolutePath: path })); emit(tool('view_file', 'DONE', { AbsolutePath: path })); emit({ event: 'result', result: { status: 'SUCCESS', response: 'A blank screen.' } }); }
    else if (/\buncited/.test(content)) { emit(tool('search_web', 'DONE')); emit({ event: 'result', result: { status: 'SUCCESS', response: 'Node 26 is LTS.' } }); }
    else if (/\bcited/.test(content)) { emit(tool('search_web', 'ACTIVE')); emit(tool('search_web', 'DONE')); emit(tool('read_url_content', 'DONE')); emit({ event: 'result', result: { status: 'SUCCESS', response: 'Node 26 is LTS ([nodejs.org](https://nodejs.org/en/about/previous-releases)).' } }); }
    else if (/shell/.test(content)) emit(tool('run_command', 'ACTIVE'));
    else emit({ event: 'result', result: { status: 'SUCCESS', response: 'See https://example.com without searching.' } });
  } });
  try {
    const settings = { ...DEFAULTS, backend: 'antigravity', model: 'gemini-4-argon-medium', antigravityModel: 'gemini-4-argon-medium' };
    const shot = { url: 'data:image/png;base64,iVBORw0KGgo=', width: 1, height: 1 };
    assert.equal((await f.connection.chat(settings, [], 'What is on my screen?', undefined, shot)).text, 'A blank screen.');
    const vision = f.children.at(-1);
    assert.equal(vision.args[vision.args.indexOf('--agent') + 1], VISION_AGENT_NAME);assert.equal(f.fallbackCalls.length, 0, 'screen questions never reach Codex');
    assert.deepEqual((await readdir(join(f.dir, 'workspace'))).filter(name => name.startsWith('screen-')), [], 'the screenshot file is deleted');
    await assert.rejects(f.connection.chat(settings, [], 'peek elsewhere', undefined, shot), /tried to use a tool/);
    assert.equal((await f.connection.chat(settings, [], 'What now, new name?', undefined, shot)).text, 'Still a blank screen.', 'agy 1.5.2 calls it read_file, and Gemini may quote the path');
    await assert.rejects(f.connection.chat(settings, [], 'new name elsewhere', undefined, shot), /tried to use a tool/);
    assert.deepEqual((await readdir(join(f.dir, 'workspace'))).filter(name => name.startsWith('screen-')), [], 'deleted after a refusal too');
    const reply = await f.connection.chat(settings, [], 'Latest Node LTS, cited', undefined, null, { webSearch: true });
    assert.match(reply.text, /nodejs\.org/);assert.equal(f.fallbackCalls.length, 0, 'live search does not touch Codex');
    const searchChild = f.children.at(-1);
    assert.equal(searchChild.args[searchChild.args.indexOf('--agent') + 1], SEARCH_AGENT_NAME);
    assert.deepEqual(JSON.parse(searchChild.args[searchChild.args.indexOf('--settings') + 1]), { permissions: { allow: ['read_url(*)'] } });
    assert.match(searchChild.messages[0].message.content, /Live web search is available/);
    assert(!searchChild.args.includes('--dangerously-skip-permissions'));
    await assert.rejects(f.connection.chat(settings, [], 'Latest, uncited', undefined, null, { webSearch: true }), /could not verify fresh sources/);
    await assert.rejects(f.connection.chat(settings, [], 'Latest, no search', undefined, null, { webSearch: true }), /could not verify fresh sources/);
    await assert.rejects(f.connection.chat(settings, [], 'Latest, use the shell', undefined, null, { webSearch: true }), /tried to use a tool/);
    await assert.rejects(f.connection.chat(settings, [], 'Plain chat, cited'), /tried to use a tool/, 'ordinary chat stays tool-free');
    const agents = await readdir(join(f.dir, 'agents'));assert.deepEqual(agents.sort(), [AGENT_NAME, SEARCH_AGENT_NAME, VISION_AGENT_NAME].sort());
    assert.match(await readFile(join(f.dir, 'agents', SEARCH_AGENT_NAME, 'agent.md'), 'utf8'), /tools: \[search_web, read_url_content\]/);
    assert.match(await readFile(join(f.dir, 'agents', VISION_AGENT_NAME, 'agent.md'), 'utf8'), /tools: \[view_file\]/);
  } finally { f.connection.close(); }
});

test('a model with a fixed reasoning level is retried without --effort', async () => {
  const f = await fixture({ respond: (emit, _message, child) => {
    if (child.args.includes('--effort')) { emit({ event: 'result', result: { status: 'ERROR', error: 'invalid model selection (--model "gemini-3.8-flash-high" --effort "low"): --model gemini-3.8-flash-high conflicts with --effort=low' } }); return; }
    emit({ event: 'result', result: { status: 'SUCCESS', response: 'Hello.' } });
  } });
  try {
    const settings = { ...DEFAULTS, antigravityModel: 'gemini-3.8-flash-high' };
    assert.equal((await f.connection.chat(settings, [], 'hi')).text, 'Hello.');
    assert(f.children[0].args.includes('--effort'), 'first attempt passes the effort flag');
    assert.equal(f.children[1].args.includes('--effort'), false, 'retry drops it');
    await f.connection.chat(settings, [], 'again');
    assert.equal(f.children.find(child => child.messages.length && child !== f.children[0] && child !== f.children[1])?.args.includes('--effort'), false, 'later turns remember');
  } finally { f.connection.close(); }
});

test('two replies at once both survive a model with a fixed reasoning level', async () => {
  const f = await fixture({ respond: (emit, _message, child) => {
    if (child.args.includes('--effort')) { setTimeout(() => emit({ event: 'result', result: { status: 'ERROR', error: 'invalid model selection (--model "gemini-4-argon-medium" --effort "low"): --model gemini-4-argon-medium conflicts with --effort=low' } }), 5); return; }
    emit({ event: 'result', result: { status: 'SUCCESS', response: 'Hello.' } });
  } });
  try {
    const settings = { ...DEFAULTS, antigravityModel: 'gemini-4-argon-medium' };
    assert.deepEqual((await Promise.all([f.connection.chat(settings, [], 'from the phone'), f.connection.chat(settings, [], 'from the Mac')])).map(reply => reply.text), ['Hello.', 'Hello.']);
  } finally { f.connection.close(); }
});

test('a model that refuses even without the effort setting says so, after one retry', async () => {
  const f = await fixture({ respond: emit => emit({ event: 'result', result: { status: 'ERROR', error: 'invalid model selection (--model "x" --effort "low"): conflicts' } }) });
  try {
    await assert.rejects(f.connection.chat({ ...DEFAULTS, antigravityModel: 'gemini-x' }, [], 'hi'), /invalid model selection/);
    assert.equal(f.children.filter(child => child.messages.length).length, 2);
  } finally { f.connection.close(); }
});

test('a launch failure before any message is reported, not left hanging', async () => {
  const f = await fixture({ respond: () => {} });
  try {
    const settled = f.connection.chat({ ...DEFAULTS, antigravityModel: 'nope' }, [], 'hi').then(() => null, error => error);
    await until(() => f.children.length && f.children[f.children.length - 1].messages.length, 'the turn to reach agy');
    const child = f.children[f.children.length - 1];
    child.stdout.write(JSON.stringify({ event: 'result', result: { status: 'ERROR', error: 'model nope is not recognized as a known model' } }) + '\n');
    assert.match((await settled)?.message ?? '', /not recognized as a known model/);
  } finally { f.connection.close(); }
});

test('antigravity account reports available models and settings validate the backend', async () => {
  const f = await fixture();
  assert.deepEqual(await f.connection.account(), { connected: true, models: ['gemini-3.8-flash-low', 'gemini-3.8-flash-high'], names: { 'gemini-3.8-flash-low': 'Gemini 3.8 Flash (Low)', 'gemini-3.8-flash-high': 'Gemini 3.8 Flash (High)' } });
  assert.equal(cleanSettings({ backend: 'antigravity', antigravityModel: 'gemini-3.8-flash' }).backend, 'antigravity');
  assert.throws(() => cleanSettings({ antigravityModel: '--sandbox' }), /Gemini model/);
});


test('project-only Gemini does not leave a warm spare process after its reply',async()=>{
 const f=await fixture();f.connection.warmAfterTurn=false;
 assert.equal((await f.connection.chat({...DEFAULTS,antigravityModel:'gemini-3.8-flash-low'},[],'Hello')).text,'Hello from Gemini.');
 await new Promise(r=>setTimeout(r,20));assert.equal(f.children.length,1);assert.equal(f.connection.spare,null);assert(f.children[0].killed);f.connection.close();
});


test('project Gemini sends at once despite agy listing its own tools, and a tool step still stops it', async () => {
 const f=await fixture({respond:(emit,message)=>{
  emit({event:'init',init:{tools:['run_command','write_to_file']}});
  if(/run something/.test(message.message.content))emit({event:'step_update',step_update:{step_type:'tool',state:'ACTIVE',tool_name:'run_command'}});
  else emit({event:'result',result:{status:'SUCCESS',response:'{"tool":"done","text":"Listed."}'}});
 }}); f.connection.warmAfterTurn=false;
 try {
  assert.equal(await f.connection.turn({settings:DEFAULTS,prompt:'Synthetic project prompt'}),'{"tool":"done","text":"Listed."}');
  assert.equal(f.children[0].messages.length,1,'the prompt goes without waiting for agy to say it has no tools, which it never does');
  const stopped=await f.connection.turn({settings:DEFAULTS,prompt:'Please run something'}).then(()=>null,e=>e);
  assert.match(stopped.message,/tried to use a tool \(run_command\), so Fairy stopped/);assert.equal(stopped.tool,'run_command');
  assert(f.children.at(-1).killed);
 } finally {f.connection.close();}
});

test('power-saving cancellation prevents a pending warm-up from launching later',async()=>{
 const f=await fixture();let release;f.connection.prepare=()=>new Promise(r=>{release=r;});
 const warm=f.connection.warmUp(DEFAULTS);f.connection.dismissSpare();release();await warm;
 assert.equal(f.children.length,0);assert.equal(f.connection.spare,null);f.connection.close();
});

function toolFixture(respond) {
  return fixture({ respond }).then(async ({ connection, children, dir }) => {
    const realHome = join(dir, 'home');
    await mkdir(join(realHome, '.gemini', 'config'), { recursive: true });
    await writeFile(join(realHome, '.gemini', 'oauth_creds.json'), '{}');
    await writeFile(join(realHome, '.gemini', 'config', 'mcp_config.json'), '{"mcpServers":{"personal":{}}}');
    let closed = 0;
    connection.realHome = realHome;
    connection.createBridge = async () => ({ url: 'http://127.0.0.1:9/mcp', token: 'one-time-token', close: () => { closed++; } });
    return { connection, children, realHome, closedCount: () => closed };
  });
}
const toolRequest = { settings: { ...DEFAULTS, antigravityModel: 'gemini-3.8-flash-low', reasoning: 'high' }, instructions: 'Calendar rules.', input: [{ type: 'text', text: 'What is on today?' }],
  tools: [{ name: 'calendar_events', description: 'Events', inputSchema: { type: 'object' } }], toolHandler: async () => ({ success: true, contentItems: [] }) };

test('a tool turn runs under a temporary home with only Fairy tools and leaves the real config alone', async () => {
  let seen;
  const { connection, children, realHome, closedCount } = await toolFixture(async (emit, message, child) => {
    const gemini = join(child.options.env.HOME, '.gemini');
    seen = { message, mcp: JSON.parse(await readFile(join(gemini, 'config', 'mcp_config.json'), 'utf8')), agent: await readFile(join(gemini, 'config', 'agents', TOOL_AGENT_NAME, 'agent.md'), 'utf8'), login: await readFile(join(gemini, 'oauth_creds.json'), 'utf8'), home: child.options.env.HOME };
    emit({ event: 'step_update', step_update: { step_type: 'tool', tool_name: 'mcp_fairy_calendar_events', state: 'DONE' } });
    emit({ event: 'result', result: { status: 'SUCCESS', response: 'A dentist visit.\n' } });
  });
  assert.equal(await connection.turn(toolRequest), 'A dentist visit.');
  const [child] = children.filter(c => c.options.env.HOME !== process.env.HOME);
  assert.deepEqual(child.args.slice(0, 4), ['--agent', TOOL_AGENT_NAME, '--settings', JSON.stringify({ permissions: { allow: ['mcp(*)'] } })]);
  assert(child.args.includes('--sandbox'));
  assert.equal(seen.message.message.content, 'What is on today?');
  assert.deepEqual(Object.keys(seen.mcp.mcpServers), ['fairy'], 'the personal server is not inherited');
  assert.equal(seen.mcp.mcpServers.fairy.headers.Authorization, 'Bearer one-time-token');
  assert.equal(seen.mcp.mcpServers.fairy.tools.calendar_events.eager, true);
  assert.match(seen.agent, /tools: \[\]/); assert.match(seen.agent, /Calendar rules\./);
  assert.equal(seen.login, '{}', 'the existing agy login is reachable');
  await assert.rejects(access(seen.home), { code: 'ENOENT' });
  assert.equal(closedCount(), 1);
  assert.equal(await readFile(join(realHome, '.gemini', 'config', 'mcp_config.json'), 'utf8'), '{"mcpServers":{"personal":{}}}');
});

test('a tool turn stops if the agent reaches for anything but Fairy tools, and cleans up', async () => {
  let home;
  const { connection, closedCount } = await toolFixture((emit, _message, child) => {
    home = child.options.env.HOME;
    emit({ event: 'step_update', step_update: { step_type: 'tool', tool_name: 'run_command', state: 'ACTIVE' } });
  });
  await assert.rejects(connection.turn(toolRequest), /tried to use a tool/);
  await assert.rejects(access(home), { code: 'ENOENT' });
  assert.equal(closedCount(), 1);
});

test('the temporary home is removed only after agy has exited', async () => {
  let home, exitedFirst = false;
  const { connection, children } = await toolFixture((emit, _message, child) => {
    home = child.options.env.HOME;
    const kill = child.kill;
    child.kill = () => { child.kill = () => {}; setTimeout(async () => { exitedFirst = await access(home).then(() => true, () => false); kill(); }, 20); };
    emit({ event: 'result', result: { status: 'SUCCESS', response: 'Done.' } });
  });
  assert.equal(await connection.turn(toolRequest), 'Done.');
  assert.equal(exitedFirst, true, 'the home still existed while agy shut down');
  await assert.rejects(access(home), { code: 'ENOENT' });
  assert(children.at(-1).killed);
});

test('stopping a tool turn kills agy and removes the temporary home', async () => {
  let home; const controller = new AbortController();
  const { connection, children, closedCount } = await toolFixture((_emit, _message, child) => { home = child.options.env.HOME; controller.abort(); });
  await assert.rejects(connection.turn({ ...toolRequest, signal: controller.signal }), /Stopped/);
  assert(children.at(-1).killed);
  await assert.rejects(access(home), { code: 'ENOENT' });
  assert.equal(closedCount(), 1);
});

test('a tool turn’s temporary home links in ~/.gemini and ~/Library, and removing it leaves both alone', async t => {
  const { linkedHome } = await import('../desktop/antigravity.mjs');
  const { mkdtemp, mkdir, writeFile, readFile, readlink, rm, readdir } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os'), { join } = await import('node:path');
  const real = await mkdtemp(join(tmpdir(), 'fairy-real-home-')); t.after(() => rm(real, { recursive: true, force: true }));
  await mkdir(join(real, '.gemini', 'config'), { recursive: true }); await writeFile(join(real, '.gemini', 'oauth_creds.json'), '{}');
  await mkdir(join(real, 'Library', 'Keychains'), { recursive: true }); await writeFile(join(real, 'Library', 'Keychains', 'login.keychain-db'), 'keep');
  const { home, gemini } = await linkedHome(real);
  assert.equal(await readlink(join(home, 'Library')), join(real, 'Library'), 'macOS finds the login Keychain through HOME');
  assert.equal(await readlink(join(gemini, 'oauth_creds.json')), join(real, '.gemini', 'oauth_creds.json'));
  assert.deepEqual(await readdir(join(gemini, 'config')), [], 'its own empty config, not yours');
  await rm(home, { recursive: true, force: true });
  assert.equal(await readFile(join(real, 'Library', 'Keychains', 'login.keychain-db'), 'utf8'), 'keep');
  assert.equal(await readFile(join(real, '.gemini', 'oauth_creds.json'), 'utf8'), '{}');
});

test('a tool-free turn with instructions forwards them in the prompt (repro-claims / repro-plan)', async () => {
  let sentContent = '';
  const { connection } = await toolFixture(async (emit, message) => {
    sentContent = message.message.content;
    emit({ event: 'result', result: { status: 'SUCCESS', response: '{"claims":[]}' } });
  });
  const reply = await connection.turn({
    settings: { ...DEFAULTS, antigravityModel: 'gemini-3.8-flash-low' },
    instructions: 'Return JSON only.',
    prompt: 'Extract claims from paper.',
    tools: [],
  });
  assert.equal(reply, '{"claims":[]}');
  assert.match(sentContent, /Instructions:\nReturn JSON only\./);
  assert.match(sentContent, /Extract claims from paper\./);
});

test('agyEnv strips API keys and SSH session variables so agy reads the login Keychain', () => {
  const env = agyEnv({ HOME: '/Users/test', PATH: '/usr/bin', GEMINI_API_KEY: 'k1', GOOGLE_API_KEY: 'k2', SSH_CLIENT: '10.0.0.1 1234 22', SSH_CONNECTION: '10.0.0.1 1234 10.0.0.2 22', SSH_TTY: '/dev/ttys001' }, { HOME: '/tmp/fairy-agy' });
  assert.equal(env.HOME, '/tmp/fairy-agy');
  assert.equal(env.PATH, '/usr/bin');
  for (const key of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'SSH_CLIENT', 'SSH_CONNECTION', 'SSH_TTY']) assert.equal(key in env, false, `${key} stripped`);
});
