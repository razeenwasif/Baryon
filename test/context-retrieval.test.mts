import test from 'node:test';
import assert from 'node:assert/strict';
import {ConversationMemory} from '../desktop/memory.mjs';
import {conversationInput} from '../desktop/core.mjs';

test('short recent context retains turns and falls back to a bounded long last exchange',()=>{
  const history=Array.from({length:40},(_,i)=>({role:i%2?'assistant':'user',content:'message '+i+' '+'.'.repeat(500)}));
  const input=conversationInput(history,'Next');assert.equal(input.length,11);assert.equal(input[0].content,history[30].content);
  const large=conversationInput([{role:'user',content:'Explain this equation'},{role:'assistant',content:'x'.repeat(20000)}],'Why?');
  assert.equal(large[0].content,'Explain this equation');assert.match(large[1].content,/truncated/);assert(large[1].content.length<6100);
});
test('retrieval matches related wording, uses follow-up context and avoids irrelevant memories',async()=>{
  const m=new ConversationMemory({read:async()=>null,write:async()=>{}});await m.init([]);
  await m.remember('My song Aurora is in D minor.','You composed the tune Aurora.');
  await m.remember('My telescope lens cracked.','We discussed repairing the lens.');
  assert.match(m.retrieve('Aurora music'),/D minor/);
  assert.match(m.retrieve('Tell me more about that',[{role:'user',content:'Aurora music'}]),/D minor/);
  assert.equal(m.retrieve('baking sourdough bread'),'');
  assert.doesNotMatch(m.retrieve('Aurora music',[{role:'user',content:'My song Aurora is in D minor.'}]),/D minor/);
});
test('retrieval extracts relevant passages within a small budget and refreshes its index after changes',async()=>{
  const m=new ConversationMemory({read:async()=>null,write:async()=>{}});await m.init([]);
  for(let i=0;i<8;i++)await m.remember('Unrelated introduction. '.repeat(50)+`My telescope lens ${i} needs a repair.`, 'We discussed telescope lens repairs. '.repeat(50));
  const recall=m.retrieve('telescope lens');assert(recall.length<3000);assert.match(recall,/needs a repair/);
  await m.remember('My violin bridge broke.','A luthier can repair the violin bridge.');assert.match(m.retrieve('violin bridge'),/luthier/);
  await m.clear();assert.equal(m.retrieve('violin bridge'),'');
});
