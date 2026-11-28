import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import {PassThrough} from 'node:stream';
import {QuizRecognizer,recognitionAttempt} from '../desktop/quiz-recognition.mjs';import {QuizMonitor} from '../desktop/quiz.mjs';
const timeout=()=>Object.assign(Error('Local quiz recognition timed out.'),{code:'QUIZ_OCR_TIMEOUT'});
const raw={text:'Question 1\nWhat is six times seven?\nA. 36\nB. 42\nC. 48\nD. 56',app:'com.apple.Safari',pid:1,windowId:1,windowTitle:'Quiz',snapshot:{url:'data:image/png;base64,Zml4dHVyZQ==',width:100,height:100}};
const reply=JSON.stringify({kind:'choice',answer:'B',question:'What is six times seven?',confident:true});
function fixture(){let now=0,fail=false,current:any=raw,calls=0;const shown:string[]=[];const m=new QuizMonitor({now:()=>now,observe:async()=>{if(fail)throw timeout();return current;},solve:async()=>{calls++;return reply;},allowed:()=>true,publish:x=>shown.push(x)});m.enable(true);return {m,shown,calls:()=>calls,advance:(n:number)=>now+=n,fail:(v:boolean)=>fail=v,current:(v:any)=>current=v,async start(){await m.tick();now+=250;await m.tick();}};}
test('accurate OCR times out into one bounded CPU-fast retry, then holds fast mode briefly',async()=>{
 let now=100,calls:any[]=[];const r=new QuizRecognizer({fastFirst:false,now:()=>now,attempt:async(_s,_e,_sig,o)=>{calls.push(o);if(calls.length===1)throw timeout();return raw;}});
 assert.equal((await r.recognize(raw.snapshot)).timings!.ocrFallback,true);assert.deepEqual(calls.map(x=>[x.fast,x.timeoutMs]),[[false,4000],[true,2500]]);await r.recognize(raw.snapshot);assert(calls.at(-1).fast);now+=61000;await r.recognize(raw.snapshot);assert(!calls.at(-1).fast);
});
test('unavailable helper and cancellation do not launch fallback work',async()=>{
 const c=new AbortController();let calls=0;const r=new QuizRecognizer({fastFirst:false,attempt:async()=>{calls++;c.abort();throw timeout();}});await assert.rejects(r.recognize(raw.snapshot,[],c.signal),{name:'AbortError'});assert.equal(calls,1);
 const broken=new QuizRecognizer({fastFirst:false,attempt:async()=>{throw Object.assign(Error('Missing'),{code:'QUIZ_OCR_UNAVAILABLE'});}});await assert.rejects(broken.recognize(raw.snapshot),/Missing/);
});
test('two OCR failures stop this attempt; fast mode is not retried recursively',async()=>{
 let calls=0;const r=new QuizRecognizer({fastFirst:false,attempt:async()=>{calls++;throw timeout();}});await assert.rejects(r.recognize(raw.snapshot));assert.equal(calls,2);await assert.rejects(r.recognize(raw.snapshot));assert.equal(calls,3);
});
test('helper deadline settles even if a hung child never emits close',async()=>{
 let killed:any;const child:any=new EventEmitter();Object.assign(child,{stdout:new PassThrough(),stderr:new PassThrough(),stdin:new PassThrough(),kill:(s:any)=>killed=s});
 await assert.rejects(recognitionAttempt(raw.snapshot,[],undefined,{timeoutMs:10,spawnProcess:()=>child}),{code:'QUIZ_OCR_TIMEOUT'});assert.equal(killed,'SIGKILL');child.emit('close',0);
});
test('observation timeout backs off, hides stale hint, and restores cached answer after fresh recognition',async()=>{
 const f=fixture();await f.start();await f.m.job;assert.equal(f.shown.at(-1),'B');const key=f.m.key;f.fail(true);await f.m.tick();assert.equal(f.m.key,key);assert.equal(f.shown.at(-1),'');assert.match(f.m.status,/Recovering/);assert(!f.m.failures.has(key));f.fail(false);f.advance(1000);await f.m.tick();assert.equal(f.shown.at(-1),'B');assert.equal(f.calls(),1);
});
test('verification OCR timeout retains model result until recognition recovers, without another model call',async()=>{
 const f=fixture();f.m.solve=async()=>{f.fail(true);return reply;};let models=0;const solve=f.m.solve;f.m.solve=async()=>{models++;return (solve as any)();};await f.start();await f.m.job;assert(f.m.pendingAnswer);assert.match(f.m.status,/Recovering/);f.fail(false);f.advance(2000);await f.m.tick();await f.m.job;assert.equal(f.shown.at(-1),'B');assert.equal(models,1);assert.equal(f.m.pendingAnswer,null);assert.equal(f.m.state().counts.requests,1);
});
test('changed question discards held model answer rather than publishing it on another page',async()=>{
 const f=fixture();let models=0;f.m.solve=async()=>{models++;if(models===1)f.fail(true);return models===1?reply:JSON.stringify({kind:'none'});};await f.start();await f.m.job;f.fail(false);f.current({...raw,text:raw.text.replace('seven','eight')});f.advance(2000);await f.m.tick();f.advance(250);await f.m.tick();await f.m.job;assert.equal(models,2);assert(!f.shown.includes('B'));
});
test('Stop cancels a pending local observation, releases it, and cannot revive the quiz',async()=>{
 const f=fixture();let signal!:AbortSignal;f.m.observe=(s:AbortSignal)=>{signal=s;return new Promise((_resolve,reject)=>s.addEventListener('abort',()=>reject(s.reason),{once:true}));};const tick=f.m.tick();await Promise.resolve();f.m.enable(false);await tick;assert(signal.aborted);assert.equal(f.m.reading,null);assert.equal(f.m.status,'Off');
});

test('continuous quiz monitoring defaults to the fast CPU path without accurate-engine startup',async()=>{
 let options:any;const r=new QuizRecognizer({attempt:async(_s,_e,_sig,o)=>{options=o;return raw;}});await r.recognize(raw.snapshot);assert.deepEqual(options,{fast:true,timeoutMs:2500});
});

test('identical scoped pixels reuse OCR text, with periodic refresh and explicit clearing',async()=>{
 let now=0,passes=0;const key='a'.repeat(64);
 const r=new QuizRecognizer({now:()=>now,attempt:async(_s,_e,_sig,o)=>{if(o!.previousVisualKey===key)return {unchanged:true,visualKey:key,timings:{visionMs:0}};passes++;return {...raw,visualKey:key};}});
 // Other pixels outside the scoped region change the image's bytes while the helper's visual key holds.
 let frame=0;const snapshot=()=>({...raw.snapshot,url:`${raw.snapshot.url}${frame++}`});
 await r.recognize(snapshot());
 for(let i=0;i<9;i++){now+=500;assert.equal((await r.recognize(snapshot())).timings!.ocrSkipped,true);}
 assert.equal(passes,1);now=5500;await r.recognize(snapshot());assert.equal(passes,2);
 r.clear();await r.recognize(snapshot());assert.equal(passes,3);
});
test('changed scoped pixels run OCR again; failures discard cached text',async()=>{
 let fail=false,key='a'.repeat(64);const r=new QuizRecognizer({attempt:async()=>{if(fail)throw timeout();return {...raw,visualKey:key};}});
 let frame=0;const snapshot=()=>({...raw.snapshot,url:`${raw.snapshot.url}${frame++}`});
 await r.recognize(snapshot());key='b'.repeat(64);assert.equal((await r.recognize(snapshot())).visualKey,key);
 fail=true;await assert.rejects(r.recognize(snapshot()));assert.equal(r.cached,null);
});

test('persistent OCR serializes frames in one process and restarts after cancellation',async()=>{
 const {QuizOCRWorker}=await import('../desktop/quiz-recognition.mjs');let spawned=0,block=false,killed=0;const children:any[]=[];
 const worker=new QuizOCRWorker({spawnProcess:()=>{
  spawned++;const child:any=new EventEmitter();Object.assign(child,{stdout:new PassThrough(),stderr:new PassThrough(),stdin:new PassThrough(),kill:()=>killed++});children.push(child);
  child.stdin.on('data',(chunk:Buffer)=>{const p=JSON.parse(String(chunk));if(!block)setImmediate(()=>child.stdout.write(JSON.stringify({id:p.id,text:raw.text})+'\n'));});return child;
 }});
 try{
  const replies=await Promise.all([worker.request(raw.snapshot),worker.request(raw.snapshot)]);assert.equal(replies.length,2);assert.equal(spawned,1);
  block=true;const c=new AbortController();const pending=worker.request(raw.snapshot,[],c.signal);await new Promise(r=>setImmediate(r));c.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(killed,1);
  block=false;await worker.request(raw.snapshot);assert.equal(spawned,2);
  children[0].stdout.write('{"id":1,"text":"late stale result"}\n');await worker.request(raw.snapshot);assert.equal(spawned,2);
 }finally{worker.stop()}
});
test('persistent OCR deadlines kill a hung worker and a new request can recover',async()=>{
 const {QuizOCRWorker}=await import('../desktop/quiz-recognition.mjs');let killed=0;
 const worker=new QuizOCRWorker({spawnProcess:()=>{const child:any=new EventEmitter();Object.assign(child,{stdout:new PassThrough(),stderr:new PassThrough(),stdin:new PassThrough(),kill:()=>killed++});return child;}});
 try{await assert.rejects(worker.request(raw.snapshot,[],undefined,{timeoutMs:10}),{code:'QUIZ_OCR_TIMEOUT'});assert.equal(killed,1);assert.equal(worker.pending,null);assert.equal(worker.child,null);}finally{worker.stop()}
});


test('worker recycles above its memory ceiling without cancelling queued frames',async()=>{
 const {QuizOCRWorker}=await import('../desktop/quiz-recognition.mjs');let starts=0,kills=0;
 const worker=new QuizOCRWorker({maxResidentBytes:100,spawnProcess:()=>{starts++;const child:any=new EventEmitter();Object.assign(child,{stdout:new PassThrough(),stderr:new PassThrough(),stdin:new PassThrough(),kill:()=>kills++});child.stdin.on('data',(chunk:Buffer)=>{const {id}=JSON.parse(String(chunk));setImmediate(()=>child.stdout.write(JSON.stringify({id,text:raw.text,workerRSSBytes:101})+'\n'));});return child;}});
 try{await Promise.all([worker.request(raw.snapshot),worker.request(raw.snapshot)]);assert.equal(starts,2);assert.equal(kills,2);assert.equal(worker.child,null);}finally{worker.stop()}
});

test('worker sends raw binary PNG bytes via picturePng and propagates frameToken for binary crop with miss recovery', async () => {
 const { QuizOCRWorker } = await import('../desktop/quiz-recognition.mjs');
 const png = Buffer.from('\x89PNGBINARY');
 const cropOut = Buffer.from('\x89PNGCROPPED');
 const requests: Array<{ header: any; body: Buffer | null }> = [];
 const worker = new QuizOCRWorker({
  spawnProcess: () => {
   const child: any = new EventEmitter();
   Object.assign(child, { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: () => {} });
   let pendingHeader: any = null, buf: Buffer = Buffer.alloc(0);
   child.stdin.on('data', (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
     if (pendingHeader) {
      if (buf.length < pendingHeader.bytes) return;
      const body = buf.subarray(0, pendingHeader.bytes); buf = buf.subarray(pendingHeader.bytes);
      const h = pendingHeader; pendingHeader = null;
      requests.push({ header: h, body });
      if (h.op === 'crop') {
       const res = Buffer.from(JSON.stringify({ id: h.id, visualKey: 'vk-bin', width: 12, height: 10, bytes: cropOut.length, scrollEvidence: { rows: [] }, crop: { x: 1, y: 2, width: 12, height: 10 } }) + '\n');
       setImmediate(() => child.stdout.write(Buffer.concat([res, cropOut])));
      } else {
       setImmediate(() => child.stdout.write(JSON.stringify({ id: h.id, text: raw.text, visualKey: 'v0', frameToken: 'tok-1' }) + '\n'));
      }
     } else {
      const nl = buf.indexOf(10); if (nl < 0) return;
      const line = buf.subarray(0, nl).toString('utf8'); buf = buf.subarray(nl + 1);
      const h = JSON.parse(line);
      if (h.bytes) { pendingHeader = h; continue; }
      requests.push({ header: h, body: null });
      if (h.op === 'crop') setImmediate(() => child.stdout.write(JSON.stringify({ id: h.id, miss: true }) + '\n'));
     }
    }
   });
   return child;
  },
 });
 try {
  const snap = { url: `data:image/png;base64,${png.toString('base64')}`, png, width: 10, height: 10, bounds: { x: 0, y: 0, width: 10, height: 10 } };
  const ocr = await worker.request(snap);
  assert.equal(ocr.frameToken, 'tok-1');
  assert.equal(requests[0].header.image, undefined);
  assert.equal(requests[0].header.bytes, png.length);
  assert.ok(requests[0].body!.equals(png));
  const cropped = await worker.crop(snap, { frameToken: ocr.frameToken, region: { x: 0, y: 0, width: 10, height: 10 }, contentRect: null });
  assert.equal(requests.length, 3, 'initial frameToken crop returned miss, then transparently sent binary PNG');
  assert.equal(cropped.visualKey, 'vk-bin');
  assert.equal(cropped.url, `data:image/png;base64,${cropOut.toString('base64')}`);
 } finally { worker.stop(); }
});

test('QuizRecognizer keeps frameToken across unchanged responses', async () => {
 let n = 0;
 const r = new QuizRecognizer({
  attempt: async (_s, _e, _sig, o) => {
   n++;
   if (o!.previousVisualKey === 'vk1') return { unchanged: true, visualKey: 'vk1', frameToken: 'tok-2', timings: { visionMs: 0 } };
   return { ...raw, visualKey: 'vk1', frameToken: 'tok-1' };
  },
 });
 const first = await r.recognize(raw.snapshot);
 assert.equal(first.frameToken, 'tok-1');
 const second = await r.recognize({ ...raw.snapshot, url: `${raw.snapshot.url}2` });
 assert.equal(second.frameToken, 'tok-2');
 assert.equal(n, 2);
});
