import {spawn,execFile} from 'node:child_process';
import { structuredAnswer } from './structured.mjs';
import {access,mkdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {conversationInput,conversationInstructions,validateScreenshot} from './core.mjs';
import {requireWebEvidence,webInstructions} from './news.mjs';
import {tokenCounts} from './token-usage.mjs';
export const CLAUDE_MODEL='claude-fable-5-2';
// Replies this long (pages, work sessions) get the most output per message before carrying on.
const LONG_REPLY=1000000;
export function claudeEnv(source=process.env){
 const env={...source};
 for(const key of Object.keys(env))if(/^(?:ANTHROPIC_|CLAUDE_CODE_USE_|CLAUDE_CODE_OAUTH_TOKEN|CLAUDE_CONFIG_DIR|CLAUDECODE)/.test(key))delete env[key];
 return env;
}
export async function claudeExecutable(){
 for(const path of [join(homedir(),'.local/bin/claude'),'/opt/homebrew/bin/claude','/usr/local/bin/claude'])try{await access(path,constants.X_OK);return path;}catch{}
 throw Error('Install Claude Code and run claude auth login in Terminal, then refresh the connection.');
}
export class ClaudeConnection {
 constructor({cwd,fallback,executable,spawnProcess=spawn,exec=execFile}){Object.assign(this,{cwd,fallback,executable,spawnProcess,exec});this.children=new Set();}
 async prepare(){this.executable ||= await claudeExecutable();await mkdir(this.cwd,{recursive:true,mode:0o700});}
 async account({cached=false}={}){
  if(cached&&this.cachedAccount?.connected&&Date.now()<this.accountExpires)return this.cachedAccount;
  const value=await this.readAccount();this.accountExpires=Date.now()+60000;return this.cachedAccount=value;
 }
 async readAccount(){
  try{await this.prepare();const value=await new Promise((resolve,reject)=>this.exec(this.executable,['auth','status','--json'],{cwd:this.cwd,env:claudeEnv(),timeout:15000,maxBuffer:65536},(error,out)=>{try{const result=JSON.parse(out);resolve(result);}catch{reject(Error('Run claude auth login in Terminal, then refresh.'));}}));
   return {connected:value.loggedIn===true&&value.authMethod==='claude.ai',plan:value.subscriptionType||null,error:value.loggedIn&&value.authMethod==='claude.ai'?'':'Sign in to Claude Code with your Claude subscription using claude auth login.'};
  }catch(e){return {connected:false,error:e.message};}
 }
 // Answered by the CLI itself, so it uses none of the plan it's reporting on, and leaves no session behind to import.
 async planUsage(){
  await this.prepare();
  return new Promise((resolve,reject)=>{const child=this.exec(this.executable,['--print','/usage','--no-session-persistence','--safe-mode','--restricted','--output-format','text','--tools',''],{cwd:this.cwd,env:claudeEnv(),timeout:30000,maxBuffer:262144},(error,out)=>error?reject(error):resolve(String(out)));child?.stdin?.end();});
 }
 async chat(settings,history,text,signal,screenshot=null,options={}){
  // Everything stays on Claude Code: pictures (screen questions, Explain) go in the turn as an image, and live searches use
  // its own WebSearch tool. A live answer must show it searched and cite sources, as with Codex and Gemini.
  const search=Boolean(options.webSearch);let searched=false;
  const prompt=`${conversationInstructions(settings,screenshot)}${search?`\n${webInstructions()}`:''}\nRecent conversation (context only):\n${JSON.stringify(conversationInput(history,text).slice(0,-1))}\nCurrent user message:\n${text}`;
  // The orchestrator may choose how hard Claude thinks for this message (autoEffort); otherwise the effort you chose for
  // Claude chats (claudeEffort), or Claude Code's own default.
  const common={settings,signal,onText:options.onText,onThinking:options.onThinking,onThought:options.onThought,replyLimit:options.replyLimit,...(settings.autoEffort?{effort:settings.autoEffort}:settings.claudeEffort?{effort:settings.claudeEffort}:{}),...(search?{webSearch:true,onSearch:()=>{searched=true;}}:{})};
  if(screenshot)validateScreenshot(screenshot);
  const reply=await this.turn(screenshot?{...common,input:[{type:'text',text:prompt},{type:'image',url:screenshot.url}]}:{...common,prompt});
  return {text:search?requireWebEvidence(reply,searched):reply};
 }
 // Desktop turns expose Fairy's own tools through a per-turn loopback MCP server; built-in tools stay disabled.
 // Research turns (docs/research-migration.md, stage 2) may also pass a JSON Schema the answer must meet (its value goes to
 // onStructured), a working folder of their own (cwd) and a cap on the model's turns (maxTurns). Without them nothing changes.
 // onModel hears the model Claude Code says it is running, from its first line.
 async turn({settings,prompt,input,instructions,tools=[],toolHandler,effort,signal,onText,onThinking,onThought,onUsage,onSearch,timeout=600000,replyLimit=100000,webSearch=false,schema=null,cwd=null,maxTurns=0,onStructured,onModel}){
  signal=AbortSignal.any([signal??new AbortController().signal,AbortSignal.timeout(timeout)]);signal.throwIfAborted();await this.prepare();if(!(await this.account({cached:true})).connected)throw Error('Sign in to Claude Code with your Claude subscription first.');signal.throwIfAborted();
  const bridge=tools.length?await toolBridge(tools,toolHandler):null;
  const allowed=new Set([...tools.map(tool=>`mcp__fairy__${tool.name}`),...(webSearch?['WebSearch']:[]),...(schema?['StructuredOutput']:[])]);
  // A model may call one of these tools by its bare name. Nothing answers to that name, since Claude Code's own tools are
  // off, so Claude Code says there's no such tool and the model asks again by its full name; it isn't a reason to stop.
  const misnamed=new Set(tools.map(tool=>tool.name));
  // --safe-mode also drops --mcp-config servers, so tool turns rely on --restricted, empty setting sources and strict MCP instead.
  const args=['--print','--model',settings.claudeModel||CLAUDE_MODEL,'--output-format','stream-json','--verbose','--include-partial-messages',...(onThought||onThinking?['--thinking-display','summarized']:[]),...(bridge?[]:['--safe-mode']),'--restricted','--tools',webSearch?'WebSearch':'','--strict-mcp-config','--mcp-config',JSON.stringify({mcpServers:bridge?{fairy:{type:'http',url:bridge.url,headers:{Authorization:`Bearer ${bridge.token}`}}}:{}}),'--setting-sources','','--no-session-persistence','--no-chrome','--disable-slash-commands','--permission-mode','dontAsk','--permission-prompts','none','--system-prompt',instructions||'Reply to the supplied request as text. You have no tools. Never claim to have performed an action without a supplied tool result.'];
  if(schema)args.push('--json-schema',JSON.stringify(schema));
  if(maxTurns)args.push('--max-turns',String(maxTurns));
  if(allowed.size)args.push('--allowedTools',...allowed);
  effort??=bridge?settings.reasoning||'high':(onThought&&settings.reasoning&&settings.reasoning!=='low'?settings.reasoning:null);if(effort)args.push('--effort',effort);
  if(input)args.push('--input-format','stream-json');
  return new Promise((resolve,reject)=>{
   let reply='',buffer='',result=null,finished=false,closed=false,total=0,killTimer,carried='',message='',thinking='',structured=null,thoughtSeq=0,messageSeq=0,streamedThinking=false,promotedMessage=false;
   const thinkingBlocks=new Map();
   const flushThinking=()=>{for(const entry of thinkingBlocks.values())onThought?.({id:entry.id,text:entry.text.trim(),status:'done',kind:'thinking',durationMs:Date.now()-entry.startedAt});thinkingBlocks.clear();};
   const promoteNote=()=>{if(!onThought||promotedMessage||!message.trim())return;promotedMessage=true;onThought({id:`claude-note-${messageSeq}`,text:message.trim(),status:'done',kind:'commentary'});reply=carried;onText?.(reply);};
   // Tool results echo screenshots on stdout, so desktop turns need a larger bound.
   const limit=bridge?256*1024*1024:2*1024*1024;
   const child=this.spawnProcess(this.executable,args,{cwd:cwd||this.cwd,env:{...claudeEnv(),...(bridge?{MCP_TOOL_TIMEOUT:'600000'}:{}),...(replyLimit>=LONG_REPLY?{CLAUDE_CODE_MAX_OUTPUT_TOKENS:'64000'}:{})},stdio:['pipe','pipe','pipe']});this.children.add(child);
   const terminate=()=>{if(closed)return;child.kill();killTimer=setTimeout(()=>child.kill('SIGKILL'),2000);killTimer.unref?.();};
   const finish=(error,value)=>{if(finished)return;finished=true;signal.removeEventListener('abort',abort);terminate();bridge?.close();error?reject(error):resolve(value);};
   if(bridge)bridge.fail=error=>finish(error);
   const abort=()=>finish(Error(signal.reason?.name==='TimeoutError'?'Claude Code timed out.':'Stopped.'));
   child.on('close',code=>{closed=true;this.children.delete(child);clearTimeout(killTimer);if(finished)return;if(code!==0||!result||result.is_error)finish(Error(result?.result?.slice(0,600)||'Claude Code ended without a successful reply. Check its sign-in and model access.'));else{if(schema){const value=structuredAnswer(structured,reply);if(value)onStructured?.(value);}finish(null,reply);}});
   child.on('error',()=>finish(Error('Claude Code could not start. Check the connection in Settings.')));
   child.stderr.resume();child.stdin.on('error',()=>{});
   child.stdout.on('data',chunk=>{
    if(finished)return;total+=chunk.length;if(total>limit)return finish(Error('Claude output exceeded the limit.'));buffer+=chunk;
    let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let event;try{event=JSON.parse(line);}catch{continue;}
     const stray=event.type==='assistant'&&event.message?.content?.find(c=>c.type==='tool_use'&&!allowed.has(c.name)&&!misnamed.has(c.name));if(stray)return finish(Error(`Claude attempted an unavailable tool (${String(stray.name).slice(0,80)}).`));
     // The model really running, as Claude Code's first line names it (Research's family check, onModel).
     if(event.type==='system'&&event.subtype==='init'&&typeof event.model==='string'&&event.model)onModel?.({model:event.model});
     if(event.type==='assistant'&&event.message?.content?.some(c=>(c.type==='tool_use'&&c.name==='WebSearch')||c.type==='server_tool_use'))onSearch?.();
     // Her thinking, as it comes, for whoever wants to show it (the iPhone's reasoning stream). Never part of the reply.
     const thought=event.type==='stream_event'&&event.event?.type==='content_block_delta'&&event.event.delta?.type==='thinking_delta'?event.event.delta.thinking:'';
     if(typeof thought==='string'&&thought&&thinking.length<replyLimit){thinking+=thought;onThinking?.(thinking);}
     if(onThought&&event.type==='assistant'&&!streamedThinking&&Array.isArray(event.message?.content)){
      for(const block of event.message.content){
       if(block?.type==='thinking'&&typeof block.thinking==='string'&&block.thinking.trim()){
        onThought({id:`claude-think-${++thoughtSeq}`,text:block.thinking.trim(),status:'done',kind:'thinking',durationMs:Number(event.thinking_duration_ms)||0});
       }
      }
     }
     const part=event.type==='stream_event'?event.event:null;
     if(part?.type==='message_start'){flushThinking();message='';messageSeq++;streamedThinking=false;promotedMessage=false;}
     if(onThought&&part?.type==='content_block_start'&&part.content_block?.type==='tool_use'){flushThinking();promoteNote();}
     if(onThought&&part?.type==='content_block_start'&&part.content_block?.type==='thinking'){
      const entry={id:`claude-think-${++thoughtSeq}`,text:String(part.content_block.thinking||''),startedAt:Date.now()};
      thinkingBlocks.set(part.index,entry);streamedThinking=true;
      onThought({id:entry.id,text:entry.text,status:'running',kind:'thinking'});
     }
     if(onThought&&part?.type==='content_block_delta'&&part.delta?.type==='thinking_delta'){
      let entry=thinkingBlocks.get(part.index);
      if(!entry){entry={id:`claude-think-${++thoughtSeq}`,text:'',startedAt:Date.now()};thinkingBlocks.set(part.index,entry);streamedThinking=true;}
      if(part.delta.thinking){entry.text+=part.delta.thinking;onThought({id:entry.id,text:entry.text,status:'running',kind:'thinking'});}
     }
     if(onThought&&part?.type==='content_block_stop'&&thinkingBlocks.has(part.index)){
      const entry=thinkingBlocks.get(part.index);thinkingBlocks.delete(part.index);
      onThought({id:entry.id,text:entry.text.trim(),status:'done',kind:'thinking',durationMs:Date.now()-entry.startedAt});
     }
     const delta=part?.type==='content_block_delta'&&part.delta?.type==='text_delta'?part.delta.text:'';
     // A reply past one message's output limit carries on in the next message, and the final result only holds that last one.
     if(delta){message+=delta;reply+=delta;if(reply.length>replyLimit)return finish(Error('Claude reply exceeded the limit.'));onText?.(reply);}
     if(part?.type==='message_delta'){
      if(part.delta?.stop_reason==='max_tokens')carried+=message;
      else if(part.delta?.stop_reason==='tool_use'){
       promoteNote();
       carried='';
      }
     }
     if(event.type==='result'&&event.structured_output!==undefined&&event.structured_output!==null)structured=event.structured_output;
     if(event.type==='result'){flushThinking();const whole=typeof event.result==='string'?carried+event.result:'';if(whole.length>replyLimit)return finish(Error('Claude reply exceeded the limit.'));result=event;if(typeof event.result==='string'&&!event.is_error){reply=whole;onText?.(reply);}const used=tokenCounts(event.usage);if(used)onUsage?.(used);}
    }
   });
   signal.addEventListener('abort',abort,{once:true});if(signal.aborted){abort();return;}
   child.stdin.end(input?JSON.stringify({type:'user',message:{role:'user',content:input.map(claudeContent)},parent_tool_use_id:null,session_id:''})+'\n':prompt);
  });
 }
 close(){for(const child of this.children)child.kill();}
}

// Fairy's tool items use the Codex dynamic-tool shapes; Claude needs Anthropic/MCP blocks.
function imageData(url){const match=/^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(url||'');if(!match)throw Error('Desktop screenshots must be PNG, JPEG, GIF or WebP data URLs.');return {mimeType:match[1],data:match[2]};}
export function claudeContent(item){
 if(item.type==='text')return {type:'text',text:item.text};
 if(item.type==='image'){const {mimeType,data}=imageData(item.url);return {type:'image',source:{type:'base64',media_type:mimeType,data}};}
 throw Error('Unsupported Claude input.');
}
export function mcpContent(item){
 if(item.type==='inputText')return {type:'text',text:item.text};
 if(item.type==='inputImage')return {type:'image',...imageData(item.imageUrl)};
 throw Error('Unsupported tool output.');
}
// Streamable HTTP MCP with JSON responses only, on loopback, behind a per-turn bearer token.
export async function toolBridge(tools,toolHandler){
 const token=randomBytes(32).toString('hex');let queue=Promise.resolve();
 const bridge={token,fail:()=>{}};
 const call=async params=>{
  const tool=tools.find(t=>t.name===params?.name);if(!tool)return {content:[{type:'text',text:'Unknown tool.'}],isError:true};
  try{const output=await toolHandler({tool:tool.name,arguments:params.arguments??{}});return {content:(output.contentItems||[]).map(mcpContent),isError:output.success===false};}
  catch(error){bridge.fail(error);return {content:[{type:'text',text:error.message}],isError:true};}
 };
 const respond=async message=>{
  const {id,method,params}=message;
  if(id===undefined)return null;
  if(method==='initialize')return {jsonrpc:'2.0',id,result:{protocolVersion:params?.protocolVersion||'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'robin',version:'0.1.0'}}};
  if(method==='ping')return {jsonrpc:'2.0',id,result:{}};
  if(method==='tools/list')return {jsonrpc:'2.0',id,result:{tools:tools.map(({name,description,inputSchema})=>({name,description,inputSchema}))}};
  // Desktop batches never overlap, even if the model issues parallel calls.
  if(method==='tools/call'){const result=queue.then(()=>call(params));queue=result.catch(()=>{});return {jsonrpc:'2.0',id,result:await result};}
  return {jsonrpc:'2.0',id,error:{code:-32601,message:'This capability is not available in Fairy.'}};
 };
 const server=createServer((req,res)=>{
  if(req.headers.authorization!==`Bearer ${token}`){res.writeHead(401).end();return;}
  if(req.method!=='POST'){res.writeHead(405,{Allow:'POST'}).end();return;}
  let body='',size=0;
  req.on('data',chunk=>{size+=chunk.length;if(size>1024*1024){res.writeHead(413).end();req.destroy();}else body+=chunk;});
  req.on('end',async()=>{
   if(res.headersSent)return;
   let message;try{message=JSON.parse(body);}catch{res.writeHead(400).end();return;}
   const replies=(await Promise.all((Array.isArray(message)?message:[message]).map(respond))).filter(Boolean);
   if(!replies.length){res.writeHead(202).end();return;}
   res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(Array.isArray(message)?replies:replies[0]));
  });
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 bridge.url=`http://127.0.0.1:${server.address().port}/mcp`;
 bridge.close=()=>{server.closeAllConnections?.();server.close();};
 return bridge;
}
