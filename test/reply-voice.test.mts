import test from 'node:test';
import assert from 'node:assert/strict';
import {ReplyVoice, speechBoundary} from '../desktop/reply-voice.mjs';
import {speechText} from '../desktop/speech.mjs';
import {ReplyAudio} from '../src/reply-audio.js';
const first='Here is the first complete sentence for your answer. ';
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('voice starts before the final text, preserves order, and never repeats the first sentence',async()=>{
  const emitted:any[]=[],spoken:string[]=[];
  const v=new ReplyVoice({speak:async text=>{spoken.push(speechText(text));return new Uint8Array([1]);},emit:part=>emitted.push(part)});
  for(let i=1;i<=first.length;i++)v.update(first.slice(0,i));
  await tick();assert.equal(emitted.length,1);assert.equal(emitted[0].text,first.trim());
  await v.finish(first+'The second part follows.');
  assert.deepEqual(spoken,[first.trim(),'The second part follows.']);
  assert.deepEqual(emitted.map(e=>e.sequence),[0,1]);
});
test('token-split equations, fences, links and decimal numbers stay intact',async()=>{
  const text=String.raw`An equation needs to stay intact even when it is quite long: \(x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}\). `+'\n\n```js\nconsole.log("Never speak this sentence.");\n```\n\nRead the value 3.14 carefully. [source](https://example.com/a_(b))';
  const spoken:string[]=[];const v=new ReplyVoice({speak:async t=>{spoken.push(speechText(t));return new Uint8Array([1]);},emit:()=>{}});
  for(let i=1;i<=text.length;i++)v.update(text.slice(0,i));await v.finish(text);
  assert.match(spoken.join(' '),/denominator 2 a/);assert.match(spoken.join(' '),/3\.14/);
  assert.doesNotMatch(spoken.join(' '),/console|Never speak|https|\\frac|\\sqrt/);
  assert.equal(speechBoundary('A long explanation of some math expression: $1.5 + x. still math'),null);
});
test('paragraph breaks use a brief pause and incomplete constructs wait',()=>{
  assert.equal(speechBoundary(first.trim()+'\n\nMore text')!.pauseMs,260);
  assert.equal(speechBoundary('A paragraph long enough to stand as an opening\n\nMore text')!.pauseMs,260);
  for(const tail of ['`code sentence. still code','\\(x. more math','[source text. more text','<pre>some code. still code']) assert.equal(speechBoundary('An introduction with enough words to meet the limit '+tail),null);
});
test('stopping cancels in-flight synthesis, drops queued clips, and provider errors stop speech only',async()=>{
  let release:((v:Uint8Array)=>void)|undefined;const parts:any[]=[];
  const v=new ReplyVoice({speak:()=>new Promise<Uint8Array>(r=>{release=r}),emit:p=>parts.push(p)});
  v.update(first);await tick();v.cancel();release!(new Uint8Array([1]));await v.finish(first+'Next.');assert.equal(parts.length,0);
  const failed=new ReplyVoice({speak:async()=>{throw Error('voice unavailable')},emit:()=>assert.fail()});
  assert.equal(await failed.finish(first),'voice unavailable');
});
test('provider revisions stop queued voice rather than replaying a changed answer',async()=>{
  const v=new ReplyVoice({speak:async()=>new Uint8Array([1]),emit:()=>{}});
  v.update(first);await tick();assert.match((await v.finish('A different answer.'))!,/revised/);
});
test('renderer plays only one clip at a time and ignores duplicate and stale events',async()=>{
  let release:(()=>void)|undefined;const played:number[]=[];let allowed=true;
  const q=new ReplyAudio({allowed:()=>allowed,play:async (p:any)=>{played.push(p.sequence);if(p.sequence===0)await new Promise<void>(r=>{release=r});}});
  q.push({sequence:0});q.push({sequence:0});q.push({sequence:1});await tick();assert.deepEqual(played,[0]);
  allowed=false;release!();await q.finish();assert.deepEqual(played,[0]);
  q.cancel();q.push({sequence:2});await q.finish();assert.deepEqual(played,[0]);
});
test('later sentences coalesce while the first synthesis is in flight and paragraph pauses survive late tokens',async()=>{
  const spoken:string[]=[],parts:any[]=[];let release:((v:void)=>void)|undefined;
  const v=new ReplyVoice({speak:async t=>{spoken.push(t);if(spoken.length===1)await new Promise<void>(r=>{release=r});return new Uint8Array([1])},emit:p=>parts.push(p)});
  v.update(first);await tick();
  const later='This next sentence gives a little more detail about the subject. '.repeat(4);
  v.update(first+'\n\n'+later);release!();await v.finish(first+'\n\n'+later);
  assert.equal(spoken.length,2);assert.equal(parts[1].pauseBeforeMs,300);
});


test('streamed inline-code words survive token boundaries and are spoken once',async()=>{
  const text='The important name for this constraint is `capacity_limit`. Then use ``another `term` ``.';
  const spoken:string[]=[];const v=new ReplyVoice({speak:async t=>{spoken.push(speechText(t));return new Uint8Array([1]);},emit:()=>{}});
  for(let i=1;i<=text.length;i++)v.update(text.slice(0,i));await v.finish(text);
  assert.equal(spoken.join(' '),'The important name for this constraint is capacity limit. Then use another term.');
});
