import {googleTaskProvider} from '../desktop/integration-provider.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';import {PassThrough,Writable} from 'node:stream';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {ClaudeConnection,claudeEnv} from '../desktop/claude.mjs';import {DEFAULTS,cleanSettings} from '../desktop/core.mjs';
async function fixture(t,respond){const cwd=await mkdtemp(join(tmpdir(),'fairy-claude-'));t.after(()=>rm(cwd,{recursive:true,force:true}));let invocation;
 const connection=new ClaudeConnection({cwd,executable:'/fake/claude',exec:(_bin,_args,_options,done)=>done(null,JSON.stringify({loggedIn:true,authMethod:'claude.ai'})),spawnProcess:(bin,args,options)=>{
 const child=new EventEmitter();invocation={bin,args,options,child};child.stdout=new PassThrough();child.stderr=new PassThrough();let dead=false;
 child.kill=()=>{if(dead)return;dead=true;queueMicrotask(()=>child.emit('close',null));};child.stdin=new Writable({write(chunk,_enc,done){invocation.prompt=String(chunk);done();queueMicrotask(()=>respond(event=>child.stdout.write(JSON.stringify(event)+'\n'),child));}});return child;
 }});return {connection,getInvocation:()=>invocation};}
test('a reply longer than one message keeps every part, and leaves out what came before tools',async t=>{
 const text=value=>({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:value}}});
 const start={type:'stream_event',event:{type:'message_start'}},stopped=reason=>({type:'stream_event',event:{type:'message_delta',delta:{stop_reason:reason}}});
 const f=await fixture(t,(emit,child)=>{for(const event of [start,text('I will read it.'),stopped('tool_use'),start,text('First half, '),stopped('max_tokens'),start,text('second half.'),stopped('end_turn')])emit(event);emit({type:'result',result:'second half.',is_error:false});child.emit('close',0);});
 const seen=[];
 assert.equal(await f.connection.turn({settings:DEFAULTS,prompt:'fixture',replyLimit:3000000,onText:value=>seen.push(value)}),'First half, second half.');
 assert.equal(seen.at(-1),'First half, second half.');
 assert.equal(f.getInvocation().options.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS,'64000','long jobs get the most per message');
 const short=await fixture(t,(emit,child)=>{emit(text('Hi'));emit({type:'result',result:'Hi',is_error:false});child.emit('close',0);});
 await short.connection.turn({settings:DEFAULTS,prompt:'fixture'});
 assert.equal(short.getInvocation().options.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS,undefined);
});
test('Claude streams Fable through subscription CLI without native tools or project customization',async t=>{
 const f=await fixture(t,(emit,child)=>{emit({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:'Hello'}}});emit({type:'result',result:'Hello',is_error:false});child.emit('close',0);});const chunks=[];
 assert.equal(await f.connection.turn({settings:DEFAULTS,prompt:'fixture',onText:t=>chunks.push(t)}),'Hello');const {args,options}=f.getInvocation();assert.equal(args[args.indexOf('--model')+1],'claude-fable-5-2');assert.equal(args[args.indexOf('--tools')+1],'');assert(args.includes('--safe-mode'));assert(args.includes('--restricted'));assert(args.includes('--strict-mcp-config'));assert(args.includes('--no-session-persistence'));assert(!args.includes('--dangerously-skip-permissions'));assert(chunks.includes('Hello'));assert.equal(f.connection.children.size,0);
});
test('Claude tool attempts, errors and cancellation fail instead of claiming success',async t=>{
 const tool=await fixture(t,emit=>emit({type:'assistant',message:{content:[{type:'tool_use',name:'Bash'}]}}));await assert.rejects(tool.connection.turn({settings:DEFAULTS,prompt:'fixture'}),/unavailable tool/);
 const error=await fixture(t,(emit,child)=>{emit({type:'result',result:'Model unavailable',is_error:true});child.emit('close',1);});await assert.rejects(error.connection.turn({settings:DEFAULTS,prompt:'fixture'}),/Model unavailable/);
 const cancelled=await fixture(t,()=>{});const c=new AbortController();const promise=cancelled.connection.turn({settings:DEFAULTS,prompt:'fixture',signal:c.signal});setTimeout(()=>c.abort(),30);await assert.rejects(promise,/Stopped/);
});
test('provider validates model settings and removes API billing and endpoint overrides',()=>{
 assert.equal(cleanSettings({backend:'claude'}).claudeModel,'claude-fable-5-2');assert.throws(()=>cleanSettings({claudeModel:'--bad'}));assert.throws(()=>cleanSettings({workFolder:'relative/folder'}));
 const env=claudeEnv({ANTHROPIC_API_KEY:'secret',ANTHROPIC_BASE_URL:'bad',CLAUDE_CODE_USE_BEDROCK:'1',CLAUDE_CONFIG_DIR:'/bad',PATH:'ok'});assert.deepEqual(env,{PATH:'ok'});
});
test('live searches and screen pictures both stay on Claude Code',async()=>{
 let n=0,seen=null;const c=new ClaudeConnection({fallback:{chat:async()=>{n++;return{text:'Codex'};}}});
 c.turn=async options=>{seen=options;options.onSearch?.();return 'A new telescope image [NASA](https://www.nasa.gov/x).';};
 assert.match((await c.chat(DEFAULTS,[],'news',null,null,{webSearch:true})).text,/nasa\.gov/);
 assert.equal(seen.webSearch,true);assert.match(seen.prompt,/Live web search is available/);assert.equal(n,0);
 // An answer that never searched, or cites nothing, isn't passed off as fresh.
 c.turn=async()=>'From memory, nothing new.';await assert.rejects(c.chat(DEFAULTS,[],'news',null,null,{webSearch:true}),/could not verify fresh sources/);
 c.turn=async options=>{seen=options;return 'Looks like a black hole.';};
 const shot={url:'data:image/png;base64,AAAA',width:10,height:10};
 assert.equal((await c.chat({...DEFAULTS,inkContext:'\nScreen ink: draw'},[],'explain this',null,shot)).text,'Looks like a black hole.');
 assert.equal(n,0);assert.equal(seen.input[1].url,shot.url);assert.equal(seen.webSearch,undefined);assert.match(seen.input[0].text,/fresh screenshot/);assert.match(seen.input[0].text,/Screen ink: draw/);assert.match(seen.input[0].text,/explain this$/);
 await assert.rejects(c.chat(DEFAULTS,[],'screen',null,{url:'fixture'}),/Invalid screen image/);
});


test('Google tool tasks keep a valid Codex model independent of the chat provider',()=>{
 const codex={},provider={};for(const backend of ['deepseek','claude','antigravity']){const task=googleTaskProvider({settings:{...DEFAULTS,backend,model:'deepseek-flash'},provider,codex});assert.equal(task.provider,codex);assert.equal(task.settings.backend,'codex');assert.equal(task.settings.model,'gpt-6.1-sol');}
 assert.equal(googleTaskProvider({settings:{...DEFAULTS,backend:'openai'},provider,codex}).provider,provider);
 const antigravity={};assert.equal(googleTaskProvider({settings:{...DEFAULTS,backend:'codex',integrationProvider:'antigravity'},provider,codex,antigravity}).provider,antigravity);assert.equal(cleanSettings({...DEFAULTS,integrationProvider:'antigravity'}).integrationProvider,'antigravity');
 const claude={};for(const backend of ['antigravity','codex','openai']){const task=googleTaskProvider({settings:{...DEFAULTS,backend,integrationProvider:'claude',integrationClaudeModel:'claude-sonnet-5-5'},provider,codex,claude});assert.equal(task.provider,claude);assert.equal(task.settings.backend,'claude');assert.equal(task.settings.claudeModel,'claude-sonnet-5-5');}
});

test('Claude desktop turns reach only Fairy tools through an authenticated loopback MCP bridge',async t=>{
 const {runSubscriptionDesktop}=await import('../desktop/codex.mjs');
 const shot='data:image/png;base64,iVBORw0KGgo=';let invocation,executed=0,captures=0;
 const f=await fixture(t,async(emit,child)=>{
  const {args,prompt}=invocation=f.getInvocation();const server=JSON.parse(args[args.indexOf('--mcp-config')+1]).mcpServers.fairy;
  const rpc=async(body,headers=server.headers)=>fetch(server.url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  assert.equal((await rpc({jsonrpc:'2.0',id:0,method:'tools/list'},{})).status,401);
  assert.equal((await (await rpc({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}})).json()).result.serverInfo.name,'robin');
  assert.equal((await rpc({jsonrpc:'2.0',method:'notifications/initialized'})).status,202);
  assert.deepEqual((await (await rpc({jsonrpc:'2.0',id:2,method:'tools/list'})).json()).result.tools.map(x=>x.name),['fairy_desktop']);
  const message=JSON.parse(prompt);assert.equal(message.message.content[1].type,'image');assert.equal(message.message.content[1].source.media_type,'image/png');
  emit({type:'assistant',message:{content:[{type:'tool_use',name:'mcp__fairy__fairy_desktop'}]}});
  const {result}=await (await rpc({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'fairy_desktop',arguments:{actions:[{type:'open_app',bundle_id:'com.apple.calculator'}]}}})).json();
  assert.equal(result.isError,false);assert.deepEqual(result.content[1],{type:'image',mimeType:'image/png',data:'iVBORw0KGgo='});
  emit({type:'result',result:'Calculator opened.',is_error:false});child.emit('close',0);
 });
 const reply=await runSubscriptionDesktop({provider:f.connection,settings:{...DEFAULTS,claudeModel:'claude-fable-5-2',reasoning:'medium'},task:'Open Calculator',signal:new AbortController().signal,onProgress:()=>{},
  capture:async()=>{captures++;return{width:800,height:600,url:shot};},approve:async()=>true,execute:async()=>{executed++;}});
 assert.equal(reply,'Calculator opened.');assert.equal(executed,1);assert.equal(captures,2);
 const {args}=invocation;assert.deepEqual(args.slice(args.indexOf('--allowedTools')+1,args.indexOf('--allowedTools')+2),['mcp__fairy__fairy_desktop']);assert.equal(args[args.indexOf('--effort')+1],'medium');assert.equal(args[args.indexOf('--tools')+1],'');assert(args.includes('--strict-mcp-config'));assert.equal(args[args.indexOf('--input-format')+1],'stream-json');assert(!args.includes('--safe-mode'));assert(args.includes('--restricted'));assert.equal(args[args.indexOf('--setting-sources')+1],'');assert.match(args[args.indexOf('--system-prompt')+1],/ONLY fairy_desktop/);
 const rogue=await fixture(t,emit=>emit({type:'assistant',message:{content:[{type:'tool_use',name:'Bash'}]}}));
 await assert.rejects(rogue.connection.turn({settings:DEFAULTS,input:[{type:'text',text:'x'}],tools:[{name:'fairy_desktop',inputSchema:{type:'object'}}],toolHandler:()=>{}}),/unavailable tool/);
});
test('Claude sign-in checks are cached for turns but settings refresh reads live status',async t=>{
 let checks=0;const cwd=await mkdtemp(join(tmpdir(),'fairy-claude-'));t.after(()=>rm(cwd,{recursive:true,force:true}));
 const c=new ClaudeConnection({cwd,executable:'/fake/claude',exec:(_b,_a,_o,done)=>{checks++;done(null,JSON.stringify({loggedIn:true,authMethod:'claude.ai'}));}});
 await c.account({cached:true});await c.account({cached:true});assert.equal(checks,1);await c.account();assert.equal(checks,2);
 const f=await fixture(t,(emit,child)=>{emit({type:'result',result:'ok',is_error:false});child.emit('close',0);});
 await f.connection.turn({settings:DEFAULTS,input:[{type:'text',text:'q'}],instructions:'quiz',effort:'low'});const {args}=f.getInvocation();
 assert.equal(args[args.indexOf('--effort')+1],'low');assert.equal(args[args.indexOf('--system-prompt')+1],'quiz');assert(!args.includes('--allowedTools'));
});
test('a tool called by its bare name is not a reason to stop the turn, but any other tool still is',async t=>{
 const tools=[{name:'search_sources',inputSchema:{type:'object'}}];
 const bare=await fixture(t,(emit,child)=>{emit({type:'assistant',message:{content:[{type:'tool_use',name:'search_sources'}]}});emit({type:'result',result:'Done.',is_error:false});child.emit('close',0);});
 assert.equal(await bare.connection.turn({settings:DEFAULTS,prompt:'x',tools,toolHandler:()=>{}}),'Done.');
 const rogue=await fixture(t,emit=>emit({type:'assistant',message:{content:[{type:'tool_use',name:'Read'}]}}));
 await assert.rejects(rogue.connection.turn({settings:DEFAULTS,prompt:'x',tools,toolHandler:()=>{}}),/unavailable tool \(Read\)/);
});
test('a Claude chat runs at the effort you chose, unless the orchestrator chose one for this message', async () => {
 const { ClaudeConnection } = await import('../desktop/claude.mjs');
 const c = new ClaudeConnection({ cwd: '/tmp' }), seen = [];
 c.turn = async options => { seen.push(options.effort); return 'ok'; };
 await c.chat({ ...DEFAULTS, claudeEffort: 'xhigh' }, [], 'hi');
 await c.chat({ ...DEFAULTS, claudeEffort: 'xhigh', autoEffort: 'low' }, [], 'hi');
 await c.chat({ ...DEFAULTS }, [], 'hi');
 assert.deepEqual(seen, ['xhigh', 'low', undefined]);
});
test('her thinking streams to onThinking and never into the reply',async t=>{
 const delta=d=>({type:'stream_event',event:{type:'content_block_delta',delta:d}});
 const f=await fixture(t,(emit,child)=>{for(const event of [delta({type:'thinking_delta',thinking:'Thursday is '}),delta({type:'thinking_delta',thinking:'the tight day.'}),delta({type:'text_delta',text:'Friday works.'})])emit(event);emit({type:'result',result:'Friday works.',is_error:false});child.emit('close',0);});
 const thoughts=[],texts=[];
 assert.equal(await f.connection.turn({settings:DEFAULTS,prompt:'fixture',onText:v=>texts.push(v),onThinking:v=>thoughts.push(v)}),'Friday works.');
 assert.deepEqual(thoughts,['Thursday is ','Thursday is the tight day.']);
 assert(texts.every(v=>!v.includes('Thursday')));
});
