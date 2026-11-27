import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanSettings,DEFAULTS} from '../desktop/core.mjs';
import {prepareDesktopTask} from '../desktop/desktop-provider.mjs';
import {runSubscriptionDesktop,subscriptionConfig} from '../desktop/codex.mjs';
import {requestMode} from '../src/chat-routing.js';

test('desktop settings migrate without replacing the DeepSeek conversation model',()=>{
 const old={backend:'deepseek',model:'deepseek-chat',reasoning:'low'};
 const next=cleanSettings(old);assert.equal(next.desktopBackend,'antigravity');assert.equal(next.desktopAntigravityModel,'gemini-4-neon-medium');assert.equal(next.desktopModel,'gpt-6.1-sol');assert.equal(next.model,'deepseek-chat');assert.equal(next.backend,'deepseek');
 const changed=cleanSettings({desktopModel:'gpt-5.6-luna',desktopReasoning:'high'},next);assert.equal(changed.model,'deepseek-chat');assert.equal(changed.reasoning,'low');assert.equal(changed.desktopReasoning,'high');
 const api=cleanSettings({backend:'openai',model:'gpt-6-astra',reasoning:'medium'});assert.equal(api.desktopBackend,'openai');assert.equal(api.desktopModel,api.model);assert.equal(api.desktopReasoning,'medium');
 assert.equal(cleanSettings({backend:'codex',model:'gpt-5.6-luna'}).desktopModel,'gpt-5.6-luna');
 for(const input of [{desktopBackend:'deepseek'},{desktopModel:'deepseek-chat'},{desktopModel:''},{desktopAntigravityModel:''},{desktopReasoning:'unlimited'}])assert.throws(()=>cleanSettings(input));
});
test('Antigravity desktop provider uses Neon Medium by default and checks connection',async()=>{
 const settings=cleanSettings({...DEFAULTS,desktopReasoning:'medium'});
 assert.equal(settings.desktopBackend,'antigravity');assert.equal(settings.desktopAntigravityModel,'gemini-4-neon-medium');
 const antigravity={turn:()=>{},account:async()=>({connected:true})},runCodex=()=>{};
 const worker=await prepareDesktopTask({settings,antigravity,codex:{account:()=>assert.fail('Codex not needed')},runCodex});
 assert.equal(worker.provider,antigravity);assert.equal(worker.run,runCodex);assert.equal(worker.settings.antigravityModel,'gemini-4-neon-medium');assert.equal(worker.settings.reasoning,'medium');assert.equal(worker.vendor,'Google');assert.equal(worker.label,'Antigravity');
 await assert.rejects(prepareDesktopTask({settings,antigravity:{turn:()=>{},account:async()=>({connected:false,error:'Sign in to Gemini.'})},runCodex}),/Sign in to Gemini\..*desktop tasks/);
});
test('DeepSeek desktop requests use the Codex connection and independent model; no API key is needed',async()=>{
 const settings=cleanSettings({...DEFAULTS,desktopBackend:'codex',desktopReasoning:'medium'}),before=structuredClone(settings);let captures=0,executed=0,reviewed=0;
 const codex={account:async()=>({connected:true}),turn:async({settings:s,tools,input,toolHandler,instructions})=>{
  assert.equal(s.backend,'codex');assert.equal(s.model,settings.desktopModel);assert.equal(s.reasoning,'medium');assert.equal(tools[0].name,'fairy_desktop');assert.equal(input[1].type,'image');assert.match(instructions,/Do not create, edit or save local files/);
  const result=await toolHandler({tool:'fairy_desktop',arguments:{actions:[{type:'open_app',bundle_id:'com.apple.calculator'}]}});assert(result.success);assert.equal(captures,2);return 'Calculator opened and verified.';
 }};
 const worker=await prepareDesktopTask({settings,codex,apiProvider:{openaiKey:()=>assert.fail('No API key needed')},runCodex:runSubscriptionDesktop,runAPI:()=>assert.fail('Wrong provider')});
 assert.equal(await worker.run({provider:worker.provider,settings:worker.settings,task:'Open Calculator',signal:new AbortController().signal,onProgress:()=>{},capture:async()=>{captures++;return{width:800,height:600,url:'data:image/png;base64,YQ=='};},approve:async()=>{reviewed++;return true;},execute:async()=>{executed++;}}),'Calculator opened and verified.');
 assert.equal(reviewed,1);assert.equal(executed,1);assert.deepEqual(settings,before);
});
test('missing Codex authentication and cancellation stop before desktop capture or API fallback',async()=>{
 const fallback=()=>assert.fail('No silent fallback'),params={settings:{...DEFAULTS,desktopBackend:'codex'},codex:{account:async()=>({connected:false}),turn:()=>{}},apiProvider:{openaiKey:fallback},runCodex:fallback,runAPI:fallback};
 await assert.rejects(prepareDesktopTask(params),/Sign in with ChatGPT.*DeepSeek can remain/);
 const abort=new AbortController();abort.abort();await assert.rejects(prepareDesktopTask({...params,signal:abort.signal}),{name:'AbortError'});
 const mid=new AbortController();await assert.rejects(prepareDesktopTask({...params,signal:mid.signal,codex:{turn:()=>{},account:async()=>{mid.abort();return{connected:true};}}}),{name:'AbortError'});
});
test('explicit API desktop provider is independent of conversation and does not require Codex',async()=>{
 let checked=0;const settings=cleanSettings({...DEFAULTS,desktopBackend:'openai'}),apiProvider={openaiKey:()=>{checked++;}},runAPI=()=>{};
 const worker=await prepareDesktopTask({settings,apiProvider,runAPI,codex:{account:()=>assert.fail('Should not sign in')}});assert.equal(worker.provider,apiProvider);assert.equal(worker.run,runAPI);assert.equal(checked,1);assert.equal(worker.settings.model,settings.desktopModel);assert.equal(settings.backend,'deepseek');
});
test('desktop routing retains screen/chat handling, opt-out and explicit-file-write boundaries',()=>{
 assert.equal(requestMode('Open Calculator','chat',DEFAULTS),'desktop');assert.equal(requestMode('Can you scroll through this document?','chat',DEFAULTS),'desktop');
 assert.equal(requestMode('Explain the diagram on my screen','chat',DEFAULTS),'screen');assert.equal(requestMode('What is mixed integer programming?','chat',DEFAULTS),'chat');
 assert.equal(requestMode('How do I open Calculator?','chat',DEFAULTS),'chat');assert.equal(requestMode('Open Calculator','chat',{...DEFAULTS,autoDesktop:'off'}),'chat');
 for(const mode of ['chat','desktop'])assert.equal(requestMode('Create notes.md with a summary',''+mode,DEFAULTS),'files');
 assert.equal(subscriptionConfig.features.shell_tool,false);assert.equal(subscriptionConfig.features.computer_use,false);
});
test('Claude Code desktop provider uses its own model, sign-in check and screenshot fit',async()=>{
 const settings=cleanSettings({...DEFAULTS,desktopBackend:'claude',desktopClaudeModel:'claude-opus-5-5',desktopReasoning:'medium'});
 assert.equal(settings.desktopModel,'gpt-6.1-sol');assert.throws(()=>cleanSettings({desktopClaudeModel:'gpt-6'}));
 const claude={turn:()=>{},account:async()=>({connected:true})},runCodex=()=>{};
 const worker=await prepareDesktopTask({settings,claude,codex:{account:()=>assert.fail('Codex not needed')},runCodex});
 assert.equal(worker.provider,claude);assert.equal(worker.run,runCodex);assert.equal(worker.settings.claudeModel,'claude-opus-5-5');assert.equal(worker.settings.reasoning,'medium');assert.equal(worker.vendor,'Anthropic');assert.equal(worker.fit.edge,1568);
 await assert.rejects(prepareDesktopTask({settings,claude:{turn:()=>{},account:async()=>({connected:false,error:'Run claude auth login in Terminal, then refresh.'})},runCodex}),/claude auth login.*desktop tasks/);
});
