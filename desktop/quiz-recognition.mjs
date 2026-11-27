import {spawn} from 'node:child_process';
import { nativeBin } from './bundle-path.cjs';
import { picturePng } from './screen-helper.mjs';
const error=(message,code)=>Object.assign(Error(message),{code});
const COLD_START_MS=8000;
const MAX_FRAME_BYTES=32*1024*1024-1;

class Frames {
 constructor(){this.chunks=[];this.length=0;}
 push(chunk){const buf=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);this.chunks.push(buf);this.length+=buf.length;}
 take(count){
  const all=this.chunks.length===1?this.chunks[0]:Buffer.concat(this.chunks,this.length);
  const taken=all.subarray(0,count),rest=all.subarray(count);
  this.chunks=rest.length?[rest]:[];this.length=rest.length;
  return taken;
 }
 line(){
  for(let i=0,seen=0;i<this.chunks.length;seen+=this.chunks[i].length,i+=1){
   const end=this.chunks[i].indexOf(10);
   if(end>=0){const line=this.take(seen+end+1);return line.subarray(0,line.length-1).toString('utf8');}
  }
  return null;
 }
}
const snapshotPng=snapshot=>picturePng(snapshot)||(typeof snapshot?.url==='string'&&snapshot.url.includes(',')?Buffer.from(snapshot.url.split(',')[1],'base64'):null);
export const isRecognitionError=e=>/^QUIZ_OCR_/.test(e?.code||'') || /^Local quiz (?:recognition|text recognition|recognition returned)/.test(e?.message||'');
export function recognitionAttempt(snapshot,exclude,signal,{fast=false,timeoutMs=4000,spawnProcess=spawn,previousVisualKey}={}){
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const child=spawnProcess(nativeBin('fairy-quiz-ocr'),[],{stdio:['pipe','pipe','pipe']});let out='',settled=false;
    const finish=(failure,result)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);failure?reject(failure):resolve(result);};
    const kill=failure=>{child.kill('SIGKILL');finish(failure);};
    const abort=()=>kill(signal.reason||error('Stopped.','QUIZ_OCR_CANCELLED'));
    const timer=setTimeout(()=>kill(error('Local quiz recognition timed out.','QUIZ_OCR_TIMEOUT')),timeoutMs);
    child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{out+=chunk;if(out.length>400000)kill(error('Quiz text exceeded the limit.','QUIZ_OCR_OUTPUT'));});
    child.stderr.resume();child.stdin.on('error',()=>{});
    child.on('error',()=>finish(error('Local quiz recognition helper unavailable.','QUIZ_OCR_UNAVAILABLE')));
    child.on('close',code=>{
      if(settled)return;
      if(code!==0)return finish(error('Local quiz recognition failed.','QUIZ_OCR_FAILED'));
      try{const data=JSON.parse(out);if(data.unchanged===true){if(!previousVisualKey || data.visualKey!==previousVisualKey)throw Error();}else if(typeof data.text!=='string'||data.text.length>24000)throw Error();finish(null,data);}catch{finish(error('Local quiz recognition returned invalid text.','QUIZ_OCR_OUTPUT'));}
    });
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}
    child.stdin.end(JSON.stringify({image:snapshot.url.split(',')[1],exclude,display:snapshot.bounds,fast,previousVisualKey}));
  });
}
// One serialized native worker, restarted after cancellation, malformed output,
// deadline, or process failure. Request IDs reject late/stale responses.
export class QuizOCRWorker {
 constructor({spawnProcess=spawn,idleMs=15000,maxResidentBytes=160*1024*1024,maxFrames=32}={}){Object.assign(this,{spawnProcess,idleMs,maxResidentBytes,maxFrames});this.serial=Promise.resolve();this.id=0;this.generation=0;}
 stop(failure=error('Stopped.','QUIZ_OCR_CANCELLED')){
  this.generation++;clearTimeout(this.idle);const child=this.child;this.child=null;
  this.pending?.finish(failure);child?.kill('SIGKILL');
 }
 start(){
  if(this.child)return this.child;
  const child=this.spawnProcess(this.path?this.path:nativeBin('fairy-quiz-ocr'),['--server'],{stdio:['pipe','pipe','pipe']});
  this.child=child;const framesOut=new Frames();let frames=0,header=null;child.stderr.resume();
  const fail=e=>{if(this.child===child)this.stop(e)};
  child.on('error',()=>fail(error('Local quiz recognition helper unavailable.','QUIZ_OCR_UNAVAILABLE')));
  child.on('close',()=>fail(error('Local quiz recognition failed.','QUIZ_OCR_FAILED')));
  child.stdin.on('error',()=>fail(error('Local quiz recognition failed.','QUIZ_OCR_FAILED')));
  child.stdout.on('data',chunk=>{
   if(this.child!==child)return;
   framesOut.push(chunk);
   for(;;){
    if(!header){
     if(framesOut.length>400000){fail(error('Quiz text exceeded the limit.','QUIZ_OCR_OUTPUT'));return;}
     const line=framesOut.line();
     if(line===null)return;
     try{header=JSON.parse(line);}catch{fail(error('Local quiz recognition returned invalid text.','QUIZ_OCR_OUTPUT'));return;}
    }
    const bytes=Number.isInteger(header.bytes)&&header.bytes>0?header.bytes:0;
    if(bytes>16*1024*1024){fail(error('Quiz text exceeded the limit.','QUIZ_OCR_OUTPUT'));return;}
    if(framesOut.length<bytes)return;
    const body=bytes?framesOut.take(bytes):null,result=header;header=null;
    try{
     const p=this.pending;
     if(!p||result.id!==p.id||result.error)throw Error();
     if(p.op==='crop'){
      if(!result.miss&&(!body||!Number.isInteger(result.width)||!Number.isInteger(result.height)))throw Error();
     }else if(p.op==='clear'){
      if(result.ok!==true)throw Error();
     }else if(result.unchanged?!p.previousVisualKey||result.visualKey!==p.previousVisualKey:typeof result.text!=='string'||result.text.length>24000){
      throw Error();
     }
     // Native image frameworks retain allocator/cache pages. Recycle between
     // frames at a measured RSS ceiling (or bounded lifetime), never mid-request.
     if(++frames>=this.maxFrames||result.workerRSSBytes>this.maxResidentBytes){this.child=null;child.kill('SIGKILL');}
     p.finish(null,body?{...result,url:`data:image/png;base64,${body.toString('base64')}`}:result);
    }catch{fail(error('Local quiz recognition returned invalid text.','QUIZ_OCR_OUTPUT'));return;}
   }
  });return child;
 }
 dispatch(op,payload,rawPng,signal,options={}){
  return new Promise((resolve,reject)=>{
   clearTimeout(this.idle);const cold=!this.child,child=this.start(),id=++this.id;let settled=false;
   const finish=(failure,result)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);this.pending=null;
    if(this.child===child){this.idle=setTimeout(()=>this.stop(),this.idleMs);this.idle.unref?.();}
    failure?reject(failure):resolve(result);
   };
   const abort=()=>this.stop(signal.reason||error('Stopped.','QUIZ_OCR_CANCELLED'));
   // Starting up loads the text recognizer. Counting that against the limit can end in a loop: too slow, restarted, cold again.
   const timer=setTimeout(()=>this.stop(error('Local quiz recognition timed out.','QUIZ_OCR_TIMEOUT')),(options.timeoutMs??2500)+(cold?COLD_START_MS:0));
   this.pending={id,op,finish,previousVisualKey:options.previousVisualKey};signal?.addEventListener('abort',abort,{once:true});
   if(signal?.aborted){abort();return;}
   const header=rawPng?JSON.stringify({...payload,id,bytes:rawPng.length})+'\n':JSON.stringify({...payload,id})+'\n';
   const totalBytes=Buffer.byteLength(header)+(rawPng?rawPng.length:0);
   if(totalBytes>MAX_FRAME_BYTES){this.stop(error('Quiz image exceeded the limit.','QUIZ_OCR_OUTPUT'));return;}
   child.stdin.write(header);
   if(rawPng)child.stdin.write(rawPng);
  });
 }
 request(snapshot,exclude=[],signal,options={}){
  const generation=this.generation;
  const run=()=>{signal?.throwIfAborted();if(generation!==this.generation)throw error('Stopped.','QUIZ_OCR_CANCELLED');
   const rawPng=picturePng(snapshot);
   const payload=rawPng?{exclude,display:snapshot.bounds,fast:options.fast??true,previousVisualKey:options.previousVisualKey}
    :{image:snapshot.url.split(',')[1],exclude,display:snapshot.bounds,fast:options.fast??true,previousVisualKey:options.previousVisualKey};
   return this.dispatch('recognize',payload,rawPng,signal,options);
  };
  const result=this.serial.then(run);this.serial=result.catch(()=>{});return result;
 }
 crop(snapshot,params={},signal,options={}){
  const generation=this.generation;
  const run=async ()=>{signal?.throwIfAborted();if(generation!==this.generation)throw error('Stopped.','QUIZ_OCR_CANCELLED');
   const base={op:'crop',region:params.region,contentRect:params.contentRect??null,exclude:params.exclude||[],scrollIgnore:params.scrollIgnore||[],...(params.padding!==undefined?{padding:params.padding}:{}),...(params.screenHeight!==undefined?{screenHeight:params.screenHeight}:{})};
   if(params.frameToken&&this.child){
    const hit=await this.dispatch('crop',{...base,frameToken:params.frameToken},null,signal,options);
    if(hit&&!hit.miss)return hit;
   }
   signal?.throwIfAborted();
   const rawPng=snapshotPng(snapshot);
   if(!rawPng||!rawPng.length)throw error('Local quiz recognition returned invalid text.','QUIZ_OCR_OUTPUT');
   return this.dispatch('crop',base,rawPng,signal,options);
  };
  const result=this.serial.then(run);this.serial=result.catch(()=>{});return result;
 }
 clearCache(signal,options={}){
  const generation=this.generation;
  const run=()=>{signal?.throwIfAborted();if(generation!==this.generation||!this.child)return {ok:true};return this.dispatch('clear',{op:'clear'},null,signal,options);};
  const result=this.serial.then(run);this.serial=result.catch(()=>{});return result;
 }
}
const worker=new QuizOCRWorker();
const IDENTICAL_FOR_MS=60000;
export class QuizRecognizer {
  constructor({attempt=(...args)=>worker.request(...args),now=Date.now,fastFirst=true}={}){Object.assign(this,{attempt,now,fastFirst});this.fastUntil=0;this.cached=null;this.cacheAt=0;}
  clear(){this.cached=null;this.cacheAt=0;this.lastImage=null;}
  async recognize(snapshot,exclude=[],signal){
    signal?.throwIfAborted();const started=this.now();let fast=this.fastFirst || this.now()<this.fastUntil;
    // The same bytes read the same, so an unchanged screen needn't wake the helper, which costs a good part of a CPU core per frame.
    const image=`${JSON.stringify(exclude)}:${snapshot.url}`;
    if(this.cached && snapshot.url && this.lastImage===image && this.now()-this.cacheAt<=IDENTICAL_FOR_MS)return {...this.cached,timings:{...this.cached.timings,recognitionMs:this.now()-started,ocrSkipped:true,ocrIdentical:true,ocrFallback:fast}};
    if(this.now()-this.cacheAt>5000)this.clear();
    const finish=result=>{
      signal?.throwIfAborted();
      this.lastImage=result.visualKey?image:null;
      if(result.unchanged){
        if(!this.cached || result.visualKey!==this.cached.visualKey)throw error('Local quiz recognition cache expired.','QUIZ_OCR_OUTPUT');
        return {...this.cached,...(result.frameToken?{frameToken:result.frameToken}:{}),timings:{...result.timings,recognitionMs:this.now()-started,ocrSkipped:true,ocrFallback:fast}};
      }
      this.cached=result.visualKey?result:null;this.cacheAt=this.now();
      return {...result,timings:{...result.timings,recognitionMs:this.now()-started,ocrSkipped:false,ocrFallback:fast}};
    };
    try{return finish(await this.attempt(snapshot,exclude,signal,{fast,timeoutMs:fast?2500:4000,...(this.cached?.visualKey?{previousVisualKey:this.cached.visualKey}:{})}));}
    catch(e){this.clear();signal?.throwIfAborted();if(fast || !['QUIZ_OCR_TIMEOUT','QUIZ_OCR_FAILED'].includes(e.code))throw e;
      // A fresh CPU-only fast request avoids waiting on the same Vision/GPU stall.
      this.fastUntil=this.now()+60000;fast=true;
      const result=await this.attempt(snapshot,exclude,signal,{fast:true,timeoutMs:2500});signal?.throwIfAborted();return finish(result);
    }
  }
}
// Quiz OCR identifies/assembles the question; Astra still receives the original images.
// The accurate engine on this macOS build can block in ANE compilation even with
// usesCPUOnly. Use the tested fast CPU path for continuous monitoring.
const recognizer=new QuizRecognizer();
export const recognizeQuiz=(snapshot,exclude=[],signal)=>recognizer.recognize(snapshot,exclude,signal);
export const cropQuiz=(snapshot,params,signal,options)=>worker.crop(snapshot,params,signal,options);

export const clearQuizRecognition=()=>{recognizer.clear();worker.stop();};
