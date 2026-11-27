import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { CodexConnection, runSubscriptionDesktop } from '../desktop/codex.mjs';
import { DEFAULTS, cleanSettings } from '../desktop/core.mjs';

function fixture({ accountType = 'chatgpt', complete = true, failure = false, webSearch = false, models = [] } = {}) {
  const calls = []; let spawnOptions;
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  const emit = message => child.stdout.write(JSON.stringify(message) + '\n');
  child.kill = () => { child.stdout.end(); child.emit('close', 0); };
  child.stdin = new Writable({ write(chunk, _encoding, callback) {
    const message = JSON.parse(chunk); calls.push(message); callback();
    if (!message.method || message.id === undefined) return;
    let result = {};
    switch (message.method) {
      case 'config/read': result = { config: { mcp_servers: { personal: { enabled: true } } } }; break;
      case 'account/read': result = { account: { type: accountType, planType: 'pro' } }; break;
      case 'thread/start': result = { thread: { id: 'thread-1' } }; break;
      case 'turn/start': result = { turn: { id: 'turn-1' } }; break;
      case 'model/list': result = { data: models }; break;
    }
    queueMicrotask(() => {
      emit({ id: message.id, result });
      if (message.method === 'turn/start' && complete) {
        if (webSearch) emit({ method: 'item/completed', params: { threadId: 'thread-1', item: { type: 'webSearch', action: { type: 'search', query: 'science news' } } } });
        emit({ method: 'item/completed', params: { threadId: 'thread-1', item: { type: 'agentMessage', text: webSearch ? 'A discovery. [Paper](https://example.com/paper)' : 'Hello from subscription.' } } });
        emit({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { status: failure ? 'failed' : 'completed', error: failure ? { message: 'Subscription limit reached.' } : null } } });
      }
    });
  } });
  const connection = new CodexConnection({ cwd: '/private/tmp', executable: '/fake/codex', spawnProcess: (_bin, _args, options) => { spawnOptions = options; return child; } });
  return { connection, calls, child, emit, options: () => spawnOptions };
}
test('subscription chat uses authenticated app-server, bounded history and no inherited desktop capabilities', async () => {
  const f = fixture();
  try {
    const result = await f.connection.chat({ ...DEFAULTS, memory: 'Likes stars' }, [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }], 'How are you?');
    assert.equal(result.text, 'Hello from subscription.');
    assert.equal(f.options().env.OPENAI_API_KEY, undefined);
    assert.equal(f.options().env.CODEX_API_KEY, undefined);
    const thread = f.calls.find(c => c.method === 'thread/start').params;
    assert.equal(thread.ephemeral, true); assert.equal(thread.sandbox, 'read-only');
    assert.equal(thread.config.features.shell_tool, false); assert.equal(thread.config.mcp_servers.personal.enabled, false);
    assert.deepEqual(thread.dynamicTools, []); assert.match(thread.baseInstructions, /Likes stars/);
    assert.match(f.calls.find(c => c.method === 'turn/start').params.input[0].text, /How are you/);
    assert(f.calls.some(c => c.method === 'thread/unsubscribe'));
    assert.equal(f.connection.listeners.size, 0);
  } finally { f.connection.close(); }
});
test('subscription live search is scoped to the requested turn and requires search evidence', async () => {
  const f = fixture({ webSearch: true });
  try {
    const result = await f.connection.chat(DEFAULTS, [], 'Latest science news', undefined, null, { webSearch: true });
    assert.match(result.text, /https:\/\/example.com\/paper/);
    let thread = f.calls.find(c => c.method === 'thread/start').params;
    assert.equal(thread.config.web_search, 'live');
    assert.equal(thread.config.features.shell_tool, false);
    assert.equal(thread.config.mcp_servers.personal.enabled, false);
    assert.deepEqual(thread.dynamicTools, []);
    await f.connection.chat(DEFAULTS, [], 'Hello');
    thread = f.calls.filter(c => c.method === 'thread/start').at(-1).params;
    assert.equal(thread.config.web_search, 'disabled');
  } finally { f.connection.close(); }
  const unavailable = fixture();
  try { await assert.rejects(unavailable.connection.chat(DEFAULTS, [], 'News', undefined, null, { webSearch: true }), /verify fresh sources/); }
  finally { unavailable.connection.close(); }
});
test('API-key login is rejected instead of silently billing API usage', async () => {
  const f = fixture({ accountType: 'apiKey' });
  try { await assert.rejects(f.connection.chat(DEFAULTS, [], 'hello'), /Sign in with ChatGPT/); assert(!f.calls.some(c => c.method === 'turn/start')); }
  finally { f.connection.close(); }
});
test('warm subscription replies avoid redundant account checks, duplicated prompts and completion interrupts', async () => {
  const f=fixture();
  try {
    await f.connection.chat(DEFAULTS,[],'Hello');
    await f.connection.chat(DEFAULTS,[],'Hello again');
    assert.equal(f.calls.filter(c=>c.method==='account/read').length,1);
    assert.equal(f.calls.filter(c=>c.method==='turn/interrupt').length,0);
    for(const call of f.calls.filter(c=>c.method==='thread/start'))assert.equal(call.params.developerInstructions,'');
    await f.connection.account();assert.equal(f.calls.filter(c=>c.method==='account/read').length,2);
  } finally {f.connection.close();}
});
test('subscription failure is surfaced without saving a partial reply', async () => {
  const f = fixture({ failure: true });
  try { await assert.rejects(f.connection.chat(DEFAULTS, [], 'hello'), /Subscription limit/); }
  finally { f.connection.close(); }
});
test('cancellation interrupts the remote turn and releases listeners', async () => {
  const f = fixture({ complete: false }), controller = new AbortController();
  try {
    const pending = f.connection.chat(DEFAULTS, [], 'hello', controller.signal);
    setTimeout(() => controller.abort(), 20);
    await assert.rejects(pending, /Stopped/);
    assert(f.calls.some(c => c.method === 'turn/interrupt'));
    assert.equal(f.connection.listeners.size, 0);
  } finally { f.connection.close(); }
});
test('settings migration preserves existing custom voice and memory', () => {
  const old = { voiceProvider: 'fish', fishVoiceId: 'saved-voice', memory: 'Likes stars' };
  const migrated = cleanSettings(old);
  assert.equal(migrated.backend, 'deepseek'); assert.equal(migrated.fishVoiceId, 'saved-voice'); assert.equal(migrated.memory, old.memory);
});
function desktopFixture(approve) {
  let executions = 0, captures = 0;
  return { stats: () => ({ executions, captures }), args: {
    settings: DEFAULTS, task: 'click a button', signal: new AbortController().signal, onProgress() {}, approve,
    capture: async () => { captures++; return { url: 'data:image/png;base64,test', width: 100, height: 100 }; },
    execute: async () => { executions++; },
    provider: { turn: async ({ toolHandler, tools, input }) => {
      assert.equal(tools[0].name, 'fairy_desktop'); assert.equal(input[1].type, 'image');
      const result = await toolHandler({ tool: 'fairy_desktop', arguments: { actions: [{ type: 'click', x: 10, y: 10, button: 'left' }] } });
      assert.equal(result.contentItems[1].type, 'inputImage');
      return 'Done.';
    } },
  } };
}
test('subscription desktop executes only reviewed actions and returns screenshots', async () => {
  const f = desktopFixture(async () => true);
  assert.equal(await runSubscriptionDesktop(f.args), 'Done.');
  assert.deepEqual(f.stats(), { executions: 1, captures: 2 });
});
test('subscription desktop rejection prevents execution', async () => {
  const f = desktopFixture(async () => false);
  await assert.rejects(runSubscriptionDesktop(f.args), /cancelled/);
  assert.equal(f.stats().executions, 0);
});
test('app launches are reviewed and execute with the captured target context', async () => {
  let approved = false, executed = false;
  const focus = { pid: 123, bundleId: 'com.apple.finder' };
  const action = { type: 'open_app', bundle_id: 'com.apple.calculator' };
  await runSubscriptionDesktop({ settings: DEFAULTS, task: 'Open Calculator', signal: new AbortController().signal, onProgress() {},
    capture: async () => ({ width: 100, height: 100, url: 'data:image/png;base64,test', focus }),
    approve: async actions => { assert.deepEqual(actions, [action]); approved = true; return true; },
    execute: async (actions, dimensions) => { assert(approved); assert.equal(dimensions.focus, focus); assert.deepEqual(actions, [action]); executed = true; },
    provider: { turn: async ({ instructions, toolHandler }) => { assert.match(instructions, /Use open_app/); await toolHandler({ tool: 'fairy_desktop', arguments: { actions: [action] } }); return 'Opened'; } },
  });
  assert(executed);
});
test('stop during subscription desktop approval prevents execution', async () => {
  const controller = new AbortController();
  const f = desktopFixture(async () => { controller.abort(); return true; }); f.args.signal = controller.signal;
  await assert.rejects(runSubscriptionDesktop(f.args), { name: 'AbortError' });
  assert.equal(f.stats().executions, 0);
});

test('subscription emits answer deltas, excludes commentary/reasoning, and reconciles final text', async () => {
  const f = fixture({complete:false}); const parts=[];
  try {
    const result = f.connection.chat(DEFAULTS, [], 'hi', undefined, null, {onText: text=>parts.push(text)});
    while (!f.calls.some(c=>c.method==='turn/start')) await new Promise(r=>setTimeout(r,1));
    const emit=(method,params)=>f.emit({method,params:{threadId:'thread-1',...params}});
    emit('item/started',{item:{id:'comment',type:'agentMessage',phase:'commentary'}});
    emit('item/agentMessage/delta',{itemId:'comment',delta:'Searching…'});
    emit('item/reasoning/textDelta',{delta:'Private reasoning'});
    emit('item/started',{item:{id:'answer',type:'agentMessage',phase:'final_answer'}});
    emit('item/agentMessage/delta',{itemId:'answer',delta:'Hello '});
    emit('item/agentMessage/delta',{itemId:'answer',delta:'there'});
    emit('item/completed',{item:{id:'answer',type:'agentMessage',phase:'final_answer',text:'Hello there.'}});
    emit('turn/completed',{turn:{status:'completed'}});
    assert.equal((await result).text,'Hello there.');assert.deepEqual(parts,['Hello ','Hello there','Hello there.']);
  } finally { f.connection.close(); }
});

test('invalid mouse arguments return correction feedback without executing; valid retry is reviewed', async () => {
 const f=desktopFixture(async()=>true);
 f.args.provider.turn=async({toolHandler})=>{
  const bad=await toolHandler({tool:'fairy_desktop',arguments:{actions:[{type:'click',x:10,y:10,button:'primary'}]}});
  assert.equal(bad.success,false);assert.match(bad.contentItems[0].text,/No actions were executed.*Unsupported mouse button/);assert.equal(f.stats().executions,0);
  const good=await toolHandler({tool:'fairy_desktop',arguments:{actions:[{type:'click',x:10,y:10,button:'left'}]}});assert.equal(good.success,true);return 'Verified';
 };
 assert.equal(await runSubscriptionDesktop(f.args),'Verified');assert.equal(f.stats().executions,1);
});
test('repeated invalid desktop batches are bounded and never executed',async()=>{
 const f=desktopFixture(async()=>assert.fail('invalid actions must not request approval'));
 f.args.provider.turn=async({toolHandler})=>{for(let i=0;i<3;i++)await toolHandler({tool:'fairy_desktop',arguments:{actions:[{type:'click',x:10,y:10,button:'primary'}]}})};
 await assert.rejects(runSubscriptionDesktop(f.args),/Unsupported mouse button/);assert.equal(f.stats().executions,0);
});
test('quiz routing reaches Astra on both thread and turn requests with no tools or conversation context',async()=>{
 const {solveQuizWithCodex}=await import('../desktop/quiz-provider.mjs');const f=fixture();
 try{
  await solveQuizWithCodex({codex:f.connection,observation:{snapshot:{url:'data:image/png;base64,dGVzdA==',width:1280,height:800}}});
  const thread=f.calls.find(c=>c.method==='thread/start').params,turn=f.calls.find(c=>c.method==='turn/start').params;
  assert.equal(thread.model,'gpt-6-astra');assert.equal(turn.model,'gpt-6-astra');assert.equal(turn.effort,'low');
  assert.deepEqual(thread.dynamicTools,[]);assert.equal(thread.config.web_search,'disabled');assert.equal(thread.ephemeral,true);
  assert.match(thread.baseInstructions,/silent answer-choice assistant/);assert.equal(f.connection.listeners.size,0);
 }finally{f.connection.close();}
});
test('plan usage and the model list come from the CLI, without hidden models', async () => {
  const asked = [];
  const connection = Object.assign(new CodexConnection({ cwd: '/tmp' }), { start: async () => {}, request: async (method, params) => {
    asked.push([method, params]);
    return method === 'model/list' ? { data: [{ id: 'gpt-5.6-terra', displayName: 'GPT-5.6-Terra' }, { id: 'old', displayName: 'Old', hidden: true }, { id: 'plain' }] } : { rateLimits: { primary: { usedPercent: 3 } } };
  } });
  assert.equal((await connection.planUsage()).rateLimits.primary.usedPercent, 3);
  assert.deepEqual(await connection.models(), [{ id: 'gpt-5.6-terra', name: 'GPT-5.6-Terra', isDefault: false }, { id: 'plain', name: 'plain', isDefault: false }]);
  assert.deepEqual(asked.map(([method]) => method), ['account/rateLimits/read', 'model/list']);
});

test('a model the ChatGPT plan doesn’t offer runs on the plan’s default, and says so', async () => {
  const free = [{ id: 'gpt-5.6-terra', displayName: 'GPT-5.6-Terra', isDefault: true }, { id: 'gpt-5.6-luna', displayName: 'GPT-5.6-Luna' }];
  const f = fixture({ models: free });
  try {
    const swaps = [];
    assert.equal(await f.connection.turn({ settings: { model: 'gpt-6-astra', reasoning: 'high' }, input: [], onModel: used => swaps.push(used) }), 'Hello from subscription.');
    assert.deepEqual(swaps, [{ model: 'gpt-5.6-terra', name: 'GPT-5.6-Terra', wanted: 'gpt-6-astra', swapped: true }]);
    assert.equal(f.calls.find(c => c.method === 'thread/start').params.model, 'gpt-5.6-terra');
    assert.equal(f.calls.find(c => c.method === 'turn/start').params.model, 'gpt-5.6-terra');
    await f.connection.turn({ settings: { model: 'gpt-5.6-luna', reasoning: 'low' }, input: [], onModel: used => swaps.push(used) });
    assert.equal(swaps.length, 1, 'a model the plan has is used as asked');
    assert.equal(f.calls.filter(c => c.method === 'turn/start').at(-1).params.model, 'gpt-5.6-luna');
    assert.equal(f.calls.filter(c => c.method === 'model/list').length, 1, 'the list is kept for a while');
  } finally { f.connection.close(); }
  const unknown = fixture();
  try {
    await unknown.connection.turn({ settings: { model: 'gpt-6-astra', reasoning: 'high' }, input: [] });
    assert.equal(unknown.calls.find(c => c.method === 'thread/start').params.model, 'gpt-6-astra', 'with no list to go on, it asks as before');
  } finally { unknown.connection.close(); }

  const rejected = fixture({ models: [{ id: 'gpt-6-astra' }, ...free] });
  let attempt = 0;
  const origTurn = rejected.connection.runSingleTurn.bind(rejected.connection);
  rejected.connection.runSingleTurn = async opts => {
    attempt += 1;
    if (attempt === 1) throw new Error('Model gpt-6-astra is not supported on your ChatGPT Free plan.');
    return origTurn(opts);
  };
  try {
    const swaps = [];
    const reply = await rejected.connection.turn({ settings: { model: 'gpt-6-astra', reasoning: 'high' }, input: [], onModel: used => swaps.push(used) });
    assert.equal(reply, 'Hello from subscription.');
    assert.equal(attempt, 2);
    assert.equal(swaps[0].model, 'gpt-5.6-terra');
    assert.equal(swaps[0].swapped, true);
  } finally { rejected.connection.close(); }
});
