import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Replace Vite's asset URL only; exercise the actual microphone controller.
const source = (await readFile(new URL('../src/listening.js', import.meta.url), 'utf8'))
  .replace(/import workletURL[^;]+;/, "const workletURL = 'worklet.js';")
  .replace("'./listening-start.js'", JSON.stringify(new URL('../src/listening-start.js', import.meta.url).href))
  .replace("'./voice-gate.js'", JSON.stringify(new URL('../src/voice-gate.js', import.meta.url).href))
  .replace("'./recording.js'", JSON.stringify(new URL('../src/recording.js', import.meta.url).href));
const { HandsFreeMicrophone } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function mock(t, getUserMedia) {
  const previous = new Map(['navigator', 'AudioContext', 'AudioWorkletNode'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const track = { stops: 0, stop() { this.stops++; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const nodes = [], contexts = [];
  class Node { constructor() { this.port = {postMessage(value) { this.sent=value; },close() { this.closed=true; }}; this.gain = {}; nodes.push(this); } connect() {} disconnect() { this.disconnected=true; } }
  class Context {
    constructor() { this.state = 'suspended'; this.sampleRate = 48000; this.audioWorklet = { addModule: async () => {} }; contexts.push(this); }
    createMediaStreamSource() { return new Node(); } createGain() { return new Node(); }
    async resume() { this.state = 'running'; } async suspend() { this.state = 'suspended'; } async close() { this.state = 'closed'; }
  }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: getUserMedia || (async () => stream) } } });
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: Context });
  Object.defineProperty(globalThis, 'AudioWorkletNode', { configurable: true, value: Node });
  t.after(() => { for (const [key, value] of previous) if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key]; });
  return { track, stream, nodes, contexts, Context };
}
const options = { blocked: () => false, transcribe: async () => '', onText: () => {}, onStatus: () => {}, onFailure: () => {}, idleMs:30000, schedule:()=>0, clear:()=>{} };
test('pausing before microphone permission resolves releases the late stream', async t => {
  const ready = deferred(), fixture = mock(t, () => ready.promise);
  const mic = new HandsFreeMicrophone(options), start = mic.start();
  await mic.stop(); ready.resolve(fixture.stream); await start;
  assert.equal(mic.running, false); assert.equal(fixture.track.stops, 1); assert.equal(fixture.contexts.length, 0);
});
test('stopping a running microphone releases tracks and context, then can resume', async t => {
  const fixture = mock(t), mic = new HandsFreeMicrophone(options);
  await mic.start(); assert(mic.running);
  await mic.stop(); assert.equal(mic.running, false); assert.equal(fixture.track.stops, 1); assert.equal(fixture.contexts[0].state, 'suspended');
  await mic.start(); assert(mic.running); await mic.stop(); assert.equal(fixture.track.stops, 2);await mic.dispose();assert.equal(fixture.contexts[0].state,'closed');
});
test('recognition finishing after a lock/pause never dispatches a stale chat', async t => {
  const fixture = mock(t), transcription = deferred(); let delivered = 0;
  const mic = new HandsFreeMicrophone({ ...options, transcribe: () => transcription.promise, onText: () => { delivered++; } });
  await mic.start(); const port = mic.node.port;
  mic.detector.push = () => new Float32Array(48000);
  const message = port.onmessage({ data: {token:mic.epoch,samples:new Float32Array(1024)} });
  assert(mic.processing); await mic.stop(); transcription.resolve('Fairy, send this'); await message;
  assert.equal(delivered, 0); assert.equal(mic.running, false); assert.equal(fixture.track.stops, 1);
});
test('microphone failure surfaces once and closes the stream instead of using cloud fallback', async t => {
  const fixture = mock(t); const failures = [];
  const mic = new HandsFreeMicrophone({ ...options, transcribe: async () => { throw new Error('Model unavailable'); }, onFailure: text => failures.push(text) });
  await mic.start(); mic.detector.push = () => new Float32Array(48000);
  await mic.node.port.onmessage({ data: {token:mic.epoch,samples:new Float32Array(1024)} });
  assert.deepEqual(failures, ['Model unavailable']); assert.equal(fixture.track.stops, 1); assert.equal(mic.running, false);
});
test('failed resume closes the engine and releases input before permitting another start',async t=>{
 const fixture=mock(t),mic=new HandsFreeMicrophone(options),resume=fixture.Context.prototype.resume;
 fixture.Context.prototype.resume=async()=>{throw Error('resume failed');};
 await assert.rejects(mic.start(),/resume failed/);assert.equal(mic.session,null);assert.equal(mic.starting,false);assert.equal(fixture.track.stops,1);assert.equal(fixture.contexts[0].state,'closed');
 fixture.Context.prototype.resume=resume;await mic.start();assert(mic.running);await mic.dispose();
});
test('restart during pending resume waits for teardown and cannot inherit old ownership',async t=>{
 const fixture=mock(t),mic=new HandsFreeMicrophone(options),gate=deferred(),resume=fixture.Context.prototype.resume;
 let entered=false;fixture.Context.prototype.resume=()=>{entered=true;return gate.promise;};
 const old=mic.start();for(let i=0;i<50&&!entered;i++)await Promise.resolve();assert(entered);assert(mic.node);
 const stopping=mic.stop();fixture.Context.prototype.resume=resume;const restarting=mic.start();gate.resolve();
 await Promise.all([old,stopping,restarting]);assert(mic.running);assert.equal(mic.engine.owner,mic.session);await mic.dispose();
});
test('100 microphone cycles recycle bounded suspended graphs and release all input tracks and frames',async t=>{
 const fixture=mock(t),mic=new HandsFreeMicrophone(options);
 for(let i=0;i<100;i++){
  await mic.start();const detector=mic.detector;detector.frames.push(new Float32Array(1024));const port=mic.node.port;
  await mic.stop();assert.equal(port.onmessage,null);assert.equal(detector.frames.length,0);assert.equal(mic.session,null);assert.equal(fixture.contexts.at(-1).state,'suspended');
 }
 assert.equal(fixture.track.stops,100);assert.equal(fixture.contexts.length,4);assert(fixture.contexts.slice(0,-1).every(c=>c.state==='closed'));await mic.dispose();assert(fixture.contexts.every(c=>c.state==='closed'));assert(fixture.nodes.every(n=>n.disconnected));
});
test('idle expiry closes the graph while quick restart cancels expiry',async t=>{
 const fixture=mock(t),pending=new Map();let id=0;const mic=new HandsFreeMicrophone({...options,schedule:(fn,ms)=>{assert.equal(ms,30000);pending.set(++id,fn);return id;},clear:id=>pending.delete(id)});
 await mic.start();await mic.stop();assert.equal(pending.size,1);await mic.start();assert.equal(pending.size,0);await mic.stop();const fn=[...pending.values()][0];pending.clear();fn();await Promise.resolve();await Promise.resolve();await Promise.resolve();assert.equal(mic.engine,null);await mic.dispose();
});
test('critical heat, lock and unload can immediately dispose a suspended engine',async t=>{
 const fixture=mock(t),mic=new HandsFreeMicrophone(options);await mic.start();await mic.stop();await mic.stop({releaseEngine:true});assert.equal(mic.engine,null);assert.equal(fixture.contexts[0].state,'closed');
});
test('frames queued from a prior session cannot trigger recognition after restart',async t=>{
 mock(t);let reads=0;const mic=new HandsFreeMicrophone({...options,transcribe:async()=>{reads++;return '';}});
 await mic.start();const token=mic.epoch;await mic.stop();await mic.start();mic.detector.push=()=>new Float32Array(48000);
 await mic.node.port.onmessage({data:{token,samples:new Float32Array(1024)}});assert.equal(reads,0);
 await mic.node.port.onmessage({data:{token:mic.epoch,samples:new Float32Array(1024)}});assert.equal(reads,1);await mic.dispose();
});
test('speech activity emits state changes rather than an event for every microphone frame',async t=>{
 mock(t);let blocked=false;const changes=[];
 const mic=new HandsFreeMicrophone({...options,blocked:()=>blocked,onActivity:()=>changes.push(mic.detector.started)});
 await mic.start();const frame=new Float32Array(1024).fill(.2);
 for(let i=0;i<20;i++)await mic.node.port.onmessage({data:{token:mic.epoch,samples:frame}});
 assert.deepEqual(changes,[true]);blocked=true;
 for(let i=0;i<20;i++)await mic.node.port.onmessage({data:{token:mic.epoch,samples:frame}});
 assert.deepEqual(changes,[true,false]);await mic.stop();
});

test('cancelled transcription resets recognition without disabling the microphone',async t=>{
 mock(t);let failures=0,delivered=0;
 const mic=new HandsFreeMicrophone({...options,transcribe:async()=>{throw Error("Error invoking remote method 'fairy:ambient-transcribe': AbortError: This operation was aborted")},onFailure:()=>failures++,onText:()=>delivered++});
 await mic.start();mic.detector.push=()=>new Float32Array(48000);
 await mic.node.port.onmessage({data:{token:mic.epoch,samples:new Float32Array(1024)}});
 assert.equal(mic.running,true);assert.equal(mic.processing,false);assert.equal(failures,0);assert.equal(delivered,0);await mic.dispose();
});

test('a clip with no words is never acted on, whatever it sounds like', async t => {
  const env = mock(t); const heard = [];
  const microphone = new HandsFreeMicrophone({ ...options, transcribe: async () => '', matchWake: () => 'whole', onText: async (text, _started, wake) => { heard.push([text, wake]); } });
  await microphone.start();
  const node = env.nodes.find(n => n.port.onmessage);
  microphone.session.detector.push = () => new Float32Array(4800);
  await node.port.onmessage({ data: { token: microphone.epoch, samples: new Float32Array(480) } });
  assert.deepEqual(heard, []);
  await microphone.dispose();
});
