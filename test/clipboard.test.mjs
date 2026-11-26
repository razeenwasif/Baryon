import {test} from 'node:test';
import assert from 'node:assert/strict';
import {clipboardRequest} from '../src/clipboard-request.js';
import {copyRequestedText} from '../desktop/clipboard.mjs';
import {requestMode} from '../src/chat-routing.js';
import {DEFAULTS,cleanSettings} from '../desktop/core.mjs';
const previous=[{role:'assistant',content:'Here is the result:\n```js\nconst n = 42;\n```'}];
test('explicit clipboard commands route locally; quoted instructions and negations do not authorize writes',()=>{
 for(const prompt of ['Copy your last answer','Hey Fairy, can you copy the code to my clipboard?','Fairy, copy your last answer','Copy to my clipboard: hello','Write a draft and copy it to my clipboard'])assert.equal(requestMode(prompt,'chat',DEFAULTS),'clipboard',prompt);
 for(const prompt of ['Do not copy your last answer','Copy your last answer, but not yet','How can I copy your last answer to my clipboard?','Translate "copy to my clipboard: hello"','"copy your last answer"','Write a story about "copy to my clipboard"','If I ask, copy your last answer','Write an example of copying to my clipboard'])assert.equal(clipboardRequest(prompt),null,prompt);
 assert.equal(cleanSettings({quizClipboard:'off'}).quizClipboard,'off');assert.throws(()=>cleanSettings({quizClipboard:'yes'}));
});
test('previous text and code copy without model calls; confirmation is not recopy payload',async()=>{
 const written=[];const run=(text,history=previous)=>copyRequestedText({text,history,writeText:t=>written.push(t),generate:()=>{throw Error('no model needed');}});
 const answer=await run('copy your last answer');assert.equal(written.at(-1),previous[0].content);
 await run('copy your last answer',[{role:'assistant',content:answer.text,mode:'clipboard'}]);assert.equal(written.at(-1),previous[0].content);
 await run('copy the code to my clipboard');assert.equal(written.at(-1),'const n = 42;');
 await assert.rejects(run('copy the code to my clipboard',[{role:'assistant',content:'```js\na\n```\n```js\nb\n```'}]),/several/);
 await assert.rejects(run('copy your last answer',[]),/no previous/);
});
test('literal and generated copies preserve content and reject failed, empty, oversize or cancelled results',async()=>{
 const written=[];let calls=0;const writeText=t=>written.push(t);
 const generate=async prompt=>{calls++;assert.match(prompt,/Write a greeting/);return 'Hello, world!';};
 await copyRequestedText({text:'Copy to my clipboard: first\n  second',writeText,generate});assert.equal(written.at(-1),'first\n  second');assert.equal(calls,0);
 await copyRequestedText({text:'Copy "hello" to my clipboard',writeText,generate});assert.equal(written.at(-1),'hello');
 await copyRequestedText({text:'Write a greeting and copy it to my clipboard',writeText,generate});assert.equal(written.at(-1),'Hello, world!');assert.equal(calls,1);
 const before=written.length;
 for(const content of ['', 'a'.repeat(24001), 'bad\0text'])await assert.rejects(copyRequestedText({text:'Write a draft and copy it to my clipboard',writeText,generate:async()=>content}));
 const controller=new AbortController();await assert.rejects(copyRequestedText({text:'Write a draft and copy it to my clipboard',writeText,signal:controller.signal,generate:async()=>{controller.abort();return 'late';}}));
 assert.equal(written.length,before);
 const clarify=await copyRequestedText({text:'Put something in my clipboard',writeText});assert.equal(clarify.copied,false);assert.equal(written.length,before);
});
