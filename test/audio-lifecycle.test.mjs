import test from 'node:test';
import assert from 'node:assert/strict';
import {ReplyAudio} from '../src/reply-audio.js';
import {ClipPlayback,speechGain} from '../src/audio-playback.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('a stalled playback decodes only one clip ahead, preserves order and drops finished clips',async()=>{
 const gate=deferred(),prepared=[],played=[];
 const q=new ReplyAudio({allowed:()=>true,prepare:async p=>{prepared.push(p.sequence);return p;},play:async p=>{played.push(p.sequence);if(p.sequence===0)await gate.promise;}});
 for(let sequence=0;sequence<100;sequence++)q.push({sequence,bytes:new Uint8Array(128),pauseBeforeMs:0});
 await flush();assert.deepEqual(prepared,[0,1]);assert.deepEqual(played,[0]);assert.equal(q.preparedCount,2);
 gate.resolve();await q.finish();assert.deepEqual(played,Array.from({length:100},(_,i)=>i));
 assert.equal(q.queue.length,0);assert.equal(q.bytes,0);assert.equal(q.preparedCount,0);assert.equal(q.waiters.size,0);
 // Accept a later streamed sentence after the earlier queue drained.
 q.push({sequence:100,pauseBeforeMs:0});await q.finish();assert.equal(played.at(-1),100);q.cancel();
});
test('cancel releases queued bytes immediately and finish does not wait for a stale decode',async()=>{
 const gate=deferred();let plays=0;
 const q=new ReplyAudio({allowed:()=>true,prepare:()=>gate.promise,play:async()=>{plays++;}});
 for(let sequence=0;sequence<80;sequence++)q.push({sequence,bytes:new Uint8Array(1024)});
 await flush();q.cancel();await q.finish();assert.equal(q.bytes,0);assert.equal(q.queue.length,0);assert.equal(q.waiters.size,0);
 gate.resolve({buffer:new Float32Array(1000)});await flush();assert.equal(plays,0);
});
test('voice backlog has explicit byte/part bounds and reports failure rather than truncating silently',async()=>{
 for(const limits of [{maxBytes:3},{maxParts:1}]){
  const q=new ReplyAudio({allowed:()=>true,prepare:()=>new Promise(()=>{}),play:async()=>{},...limits});
  q.push({sequence:0,bytes:new Uint8Array(2)});q.push({sequence:1,bytes:new Uint8Array(2)});
  await assert.rejects(q.finish(),/memory limit/);assert.equal(q.bytes,0);assert.equal(q.queue.length,0);
 }
});
test('decode failure clears the queue and mute before decoding starts avoids work',async()=>{
 const q=new ReplyAudio({allowed:()=>true,prepare:async()=>{throw Error('bad audio');},play:async()=>{throw Error('must not play');}});
 q.push({sequence:0});await assert.rejects(q.finish(),/bad audio/);assert.equal(q.queue.length,0);
 let calls=0;const muted=new ReplyAudio({allowed:()=>false,prepare:()=>calls++,play:()=>calls++});muted.push({sequence:0});await muted.finish();assert.equal(calls,0);
});

function playbackFixture(t){
 const keys=['Audio','requestAnimationFrame','cancelAnimationFrame'];const originals=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 const create=URL.createObjectURL,revoke=URL.revokeObjectURL;const urls=new Set(),frames=new Map(),nodes=[],media=[];let id=0;
 globalThis.requestAnimationFrame=cb=>{frames.set(++id,cb);return id;};globalThis.cancelAnimationFrame=id=>frames.delete(id);
 URL.createObjectURL=()=>{const url='blob:test-'+(++id);urls.add(url);return url;};URL.revokeObjectURL=url=>urls.delete(url);
 class Audio{constructor(src){this.src=src;this.start=deferred();media.push(this);}play(){return this.start.promise;}pause(){this.paused=true;this.onpause?.();}removeAttribute(){this.src='';}load(){this.released=true;}}
 globalThis.Audio=Audio;
 function node(){const n={connect(target){this.target=target;},disconnect(){this.disconnected=true;},stop(){this.stopped=true;this.onended?.();},start(){},getByteTimeDomainData(a){a.fill(128);},gain:{setValueAtTime(){},linearRampToValueAtTime(){},setTargetAtTime(value){this.value=value;}}};nodes.push(n);return n;}
 const context={resume:async()=>{},destination:{},currentTime:0,createAnalyser:node,createBufferSource:node,createGain:node,createMediaElementSource:node};
 t.after(()=>{for(const [key,value] of originals)if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];URL.createObjectURL=create;URL.revokeObjectURL=revoke;});
 return {context,frames,nodes,media,urls};
}
test('the voice volume slider follows a loudness curve',()=>{
 assert.equal(speechGain('100'),1);assert.equal(speechGain('50'),.25);assert(Math.abs(speechGain('5')-.0025)<1e-9);
 assert.equal(speechGain(undefined),1);assert.equal(speechGain('150'),1);assert.equal(speechGain('-5'),0);
});
test('voice volume sits after the analyser and changes while a clip plays',async t=>{
 const f=playbackFixture(t);
 for(const part of [{buffer:{duration:1},duration:1},{bytes:new Uint8Array(4)}]){
  f.nodes.length=0;
  const clip=new ClipPlayback({context:f.context,gain:.25});const done=clip.play(part);await flush();
  const [output,analyser]=f.nodes;
  assert.equal(output.gain.value,.25);assert.equal(output.target,f.context.destination);assert.equal(analyser.target,output);
  clip.setGain(.5);assert.equal(output.gain.value,.5);
  clip.pause();await done;assert(f.nodes.every(n=>n.disconnected));
  // A slider moved after the clip ended has nothing left to change.
  clip.setGain(1);
 }
});
test('stop during pending media.play releases graph/blob and late completion cannot restart frames',async t=>{
 const f=playbackFixture(t);let starts=0;const clip=new ClipPlayback({context:f.context,onStart:()=>starts++});
 const done=clip.play({bytes:new Uint8Array(4),maxSeconds:10});await flush();assert.equal(f.urls.size,1);
 clip.pause();await done;assert.equal(f.urls.size,0);assert(f.nodes.every(n=>n.disconnected));assert.equal(f.media[0].onended,null);assert(f.media[0].released);
 f.media[0].start.resolve();await flush();assert.equal(starts,0);assert.equal(f.frames.size,0);assert.equal(clip.timer,null);
});
test('natural end, rejected start and graph-construction failure all release playback resources',async t=>{
 const f=playbackFixture(t);
 for(const path of ['end','reject','graph']){
  const make=f.context.createMediaElementSource;if(path==='graph')f.context.createMediaElementSource=()=>{throw Error('graph failed');};
  const clip=new ClipPlayback({context:f.context});const done=clip.play({bytes:new Uint8Array(4)});const handled=done.catch(e=>e);await flush();
  if(path==='end'){f.media.at(-1).start.resolve();await flush();f.media.at(-1).onended();}
  if(path==='reject')f.media.at(-1).start.reject(Error('play failed'));
  const result=await handled;if(path!=='end')assert(result instanceof Error);
  assert.equal(f.urls.size,0);assert.equal(f.frames.size,0);assert(f.nodes.every(n=>n.disconnected));f.context.createMediaElementSource=make;
 }
});
test('100 buffered playback cycles release node buffers, callbacks and scheduled frames',async t=>{
 const f=playbackFixture(t);
 for(let i=0;i<100;i++){
  const clip=new ClipPlayback({context:f.context});const done=clip.play({buffer:{duration:1},offset:0,duration:1});await flush();
  const source=f.nodes.at(-2);assert(source.buffer);if(i%2)source.onended();else clip.pause();await done;
  assert.equal(source.buffer,null);assert.equal(source.onended,null);assert.equal(clip.cleanups.length,0);assert.equal(f.frames.size,0);
 }
 assert(f.nodes.every(n=>n.disconnected));
});
test('stop during context resume does not create nodes or await the stalled resume',async t=>{
 const f=playbackFixture(t),gate=deferred();f.context.resume=()=>gate.promise;
 const clip=new ClipPlayback({context:f.context});const done=clip.play({buffer:{duration:1}});clip.pause();await done;gate.resolve();await flush();assert.equal(f.nodes.length,0);
});
