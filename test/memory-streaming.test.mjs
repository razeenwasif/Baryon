import test from 'node:test';
import assert from 'node:assert/strict';
import { readResponseStream } from '../desktop/streaming.mjs';
import { ConversationMemory, parseFacts, memoryCommand, updateFacts } from '../desktop/memory.mjs';
import { isPlaybackEcho, VoiceGate } from '../src/voice-gate.js';
import { Providers, DEFAULTS, conversationInstructions } from '../desktop/core.mjs';

function stream(events, step = 1) {
  const bytes = new TextEncoder().encode(events.map(e => `data: ${JSON.stringify(e)}\r\n\r\n`).join(''));
  return new Response(new ReadableStream({start(c) {for(let i=0;i<bytes.length;i+=step)c.enqueue(bytes.slice(i,i+step));c.close();}}));
}
const finished = {status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Hello café.'}]}]};
test('SSE reconstructs byte-split UTF-8 and publishes incremental text before final completion', async()=>{
 const parts=[];
 const result=await readResponseStream(stream([{type:'response.output_text.delta',delta:'Hello '},{type:'response.output_text.delta',delta:'café.'},{type:'response.completed',response:finished}]),s=>parts.push(s));
 assert.deepEqual(parts,['Hello ','Hello café.']);assert.deepEqual(result,finished);
});
test('failed, truncated and aborted streams never become completed answers',async()=>{
 for(const events of [[{type:'response.output_text.delta',delta:'Partial'}],[{type:'response.failed'}]]) await assert.rejects(readResponseStream(stream(events),()=>{}),/complete|ended early/);
 const control=new AbortController();control.abort();await assert.rejects(readResponseStream(stream([]),()=>{},control.signal),{name:'AbortError'});
});
test('API conversation requests real streaming and uses authoritative final answer',async()=>{
 const p=new Providers({openai:'fixture'},async(_url,opts)=>{assert.equal(JSON.parse(opts.body).stream,true);return stream([{type:'response.output_text.delta',delta:'Hello café'},{type:'response.completed',response:finished}],7);});
 const partial=[];const result=await p.chat(DEFAULTS,[],'Hi',undefined,null,{onText:s=>partial.push(s)});
 assert.equal(result.text,'Hello café.');assert.deepEqual(partial,['Hello café']);
});
test('durable recall survives restart, excludes recent messages, and clears without resurrection',async()=>{
 let disk=null;const args={read:async()=>disk,write:async v=>{disk=structuredClone(v)}};
 const m=new ConversationMemory(args);await m.init([]);await m.remember('My telescope has a cracked lens.','We discussed replacing the telescope lens.');
 const restarted=new ConversationMemory(args);await restarted.init([]);
 assert.match(restarted.retrieve('What about my telescope lens?'),/cracked lens/);
 assert.equal(restarted.retrieve('telescope lens',[{content:'My telescope has a cracked lens.'}]),'');
 assert.equal(restarted.retrieve('bread recipe'), '');
 await restarted.clear();const again=new ConversationMemory(args);await again.init([{role:'user',content:'telescope lens'},{role:'assistant',content:'old'}]);assert.equal(again.episodes.length,0);
});
test('remember/forget preserves unrelated notes and never infers facts from arbitrary statements',()=>{
 assert.equal(memoryCommand('I think that astronomy is interesting.'),null);
 const command=memoryCommand('Remember that I enjoy astronomy.');
 const saved=updateFacts('I prefer brief replies.',command);assert.match(saved.facts,/astronomy/);
 const removed=updateFacts(saved.facts,memoryCommand('Forget that I enjoy astronomy.'));assert.equal(removed.facts,'I prefer brief replies.');
 assert.throws(()=>parseFacts('a'.repeat(501)),/500/);
 assert.match(conversationInstructions({...DEFAULTS,rememberedFacts:'I enjoy astronomy.',recalledMemory:'Older telescope discussion'},null),/Older telescope discussion/);
});
test('memory command turns and desktop operations do not seed recall; write failures roll back',async()=>{
 const m=new ConversationMemory({read:async()=>null,write:async()=>{}});
 await m.init([{role:'user',content:'Remember that private fact'},{role:'assistant',content:'Saved'},{role:'user',mode:'desktop',content:'Open settings'},{role:'assistant',content:'Opened'}]);assert.equal(m.episodes.length,0);
 m.write=async()=>{throw Error('disk full')};await assert.rejects(m.remember('new fact','reply'));assert.equal(m.episodes.length,0);
});
test('interruptions require a wake name during playback and filter recognizable self-echo',()=>{
 const gate=new VoiceGate();gate.engage();
 assert.equal(gate.accept('That sounds interesting',{followups:false}),null);
 assert.deepEqual(gate.accept('Hey Fairy, stop',{followups:false}),{kind:'message',text:'stop'});
 assert.deepEqual(gate.accept('Mav, explain it simply',{followups:false}),{kind:'message',text:'explain it simply'});
 assert(isPlaybackEcho('Fairy can help with astronomy.','Hello! Fairy can help with astronomy.'));
 assert(!isPlaybackEcho('Fairy, stop','The stars are beautiful.'));
});
