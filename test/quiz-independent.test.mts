import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {QuizTarget} from '../desktop/quiz-target.mjs';
import {ScreenAwareness} from '../desktop/awareness.mjs';
import {QuizMonitor,parseQuizSymbols} from '../desktop/quiz.mjs';
import {ConditionalTask} from '../src/conditional-task.js';
import * as attention from '../desktop/attention.mjs';
import {buildQuiz,quizTasks} from '../desktop/quiz-setup.mjs';
const main=readFileSync(new URL('../build-ts/desktop/main.cjs',import.meta.url),'utf8');
// One `new ConditionalTask({...})` from main.cjs, by something inside it, however many lines it spans.
function taskSource(marker:string){
 const at=main.indexOf(marker),start=main.lastIndexOf('new ConditionalTask(',at);
 let depth=0;
 for(let i=start;i<main.length;i++){
  if(main[i]==='(')depth++;
  else if(main[i]===')'&&!--depth)return main.slice(start,i+1);
 }
 throw new Error(`No task holds ${marker}`);
}
test('quiz capture retains Retina text pixels with a bounded size; ordinary capture keeps its prior size, away from the main process',async()=>{
 let requested:any,nativeCalls=0,electronCalls=0,display={id:1,size:{width:1512,height:982},scaleFactor:2,bounds:{x:0,y:0,width:1512,height:982}};
 const ctx:any=vm.createContext({process:{pid:4321},companionVisibility:{hidden:true},screenCapture:async(payload:any)=>{if(ctx.failHelper)throw new Error('helper failed');nativeCalls++;assert.equal(payload.excludePID,4321);assert.equal(payload.foregroundOnly,ctx.quiz.enabled?1:0);requested=payload;return {url:'fixture',width:payload.width,height:payload.height};},quiz:{enabled:true},desktopPresence:{active:false},systemPreferences:{getMediaAccessStatus:()=> 'granted'},screen:{getPrimaryDisplay:()=>display},desktopCapturer:{getSources:async(args:any)=>{electronCalls++;requested=args.thumbnailSize;return [{display_id:'1',thumbnail:{isEmpty:()=>false,getSize:()=>requested,toDataURL:()=> 'fixture'}}];}}});
 vm.runInContext(main.slice(main.indexOf('async function capture('),main.lastIndexOf('if (!earlyExit)',main.indexOf('app.whenReady().then'))),ctx);
 const run=()=>ctx.capture(new AbortController().signal,null,false,true);
 assert.equal((await run()).excludedFairy,true);assert.equal(nativeCalls,1);assert.equal(electronCalls,0);assert.equal(requested.width,3024);assert.equal(requested.height,1964);
 ctx.quiz.enabled=false;assert.equal((await run()).excludedFairy,true);assert.equal(electronCalls,0);assert.equal(nativeCalls,2);assert.equal(requested.width,1512);assert.equal(requested.height,982);
 ctx.failHelper=true;assert.equal((await run()).excludedFairy,undefined);assert.equal(electronCalls,1,'Electron’s capture is the fallback');ctx.failHelper=false;
 assert.equal((await ctx.capture(new AbortController().signal,null,false,false)).excludedFairy,undefined);assert.equal(electronCalls,2,'a capture you asked for keeps Electron’s path');
 ctx.quiz.enabled=false;assert.equal(requested.width,1512);assert.equal(requested.height,982);
 ctx.quiz.enabled=true;display={...display,size:{width:3840,height:2160}};await run();assert.equal(requested.width,3072);assert.equal(requested.height,1728);
});
function fixture(){
 let captures=0,release:(v?:any)=>void;const handlers:Record<string,any>={};
 const ctx:any=vm.createContext({traceQuiz:()=>false,ScreenAwareness,QuizMonitor,parseQuizSymbols,shortcutStatus:{},attention,quizPollMs:500,powerMonitor:{getSystemIdleState:()=>'active',getSystemIdleTime:()=>ctx.idle??0},notify(){},quizTarget:new QuizTarget(),screen:{getCursorScreenPoint:()=>({x:90,y:90})},AbortController,Boolean,settings:{screenAwareness:'off'},active:null,quizUIBlocked:false,paused:false,power:{quizMs:2000},window:{isDestroyed:()=>false,webContents:{send(){}}},floating:false,companionWindow:null,quitting:false,suspended:false,locked:false,
  clearQuizRecognition(){},syncBackgroundTasks(){},emitAmbient(){},publishQuiz(){},vorssaintLink:null,recognizeQuiz:async(snapshot:any,exclude:any)=>{ctx.lastExclude=exclude;return {text:'Is it true or false that 2 + 2 = 4?',region:null};},solveQuizWithCodex:async()=>{},codex:{},ambientController:null,
  capture:async()=>{captures++;if(ctx.delay)return new Promise(r=>release=r);return {url:'data:image/png;base64,fixture',excludedFairy:ctx.excludedFairy,bounds:{x:0,y:0,width:100,height:100}};},
  handle:(name:string,fn:any)=>handlers[name]=fn,globalShortcut:{register:(key:string,fn:any)=>handlers[key]=fn},nativeImage:{},solveQuizHere:async()=>{},quizTasks,
  // The watcher is built by quiz-setup.mjs (two Macs, step 8); the text reader stays this fixture's stand-in.
  buildQuiz:(options:any)=>buildQuiz({...options,recognize:(...args:any[])=>ctx.recognizeQuiz(...args)})});
 ctx.quizState=()=>ctx.quiz.state();ctx.ambientAllowed=()=>!ctx.paused&&!ctx.locked&&!ctx.suspended;ctx.energy=()=>ctx.power;
 // Whether the watchers look now, from main.cjs itself (desktop/attention.mjs).
 vm.runInContext(main.slice(main.indexOf('const idleSeconds ='),main.indexOf('const energy =')),ctx);
 vm.runInContext(main.slice(main.indexOf('const emitQuiz ='),main.indexOf('function publishQuiz(')),ctx);
 vm.runInContext(main.slice(main.indexOf('function clearAmbient('),main.indexOf('// Her data stays')),ctx);
 vm.runInContext(main.slice(main.indexOf('        awareness = new ScreenAwareness'),main.indexOf("        locked = powerMonitor.getSystemIdleState(900)")),ctx);
 vm.runInContext(main.slice(main.indexOf('        ({ quiz, target: quizTarget } = buildQuiz({'),main.indexOf('        app.setAboutPanelOptions')),ctx);
 vm.runInContext(main.slice(main.indexOf("        handle('quiz-enable'"),main.indexOf("        handle('quiz-ui-blocked'")),ctx);
 vm.runInContext(main.slice(main.indexOf('        const quizShortcutReady ='),main.indexOf('        micShortcutRegistered = globalShortcut.register')),ctx);
 return {ctx,handlers,captures:()=>captures,release:()=>release({url:'late',bounds:{}})};
}
test('quiz button and shortcut work with awareness off, using an isolated cache',async()=>{
 const f=fixture(),{ctx,handlers}=f;handlers['quiz-enable'](true);assert(ctx.quiz.enabled);assert(ctx.quiz.allowed());await ctx.quiz.observe();assert.equal(f.captures(),1);assert(ctx.quizAwareness.image);assert.equal(ctx.awareness.image,null);assert.equal(ctx.settings.screenAwareness,'off');
 await handlers['CommandOrControl+Shift+H']();assert.equal(ctx.quiz.enabled,false);assert.equal(ctx.quizAwareness.image,null);await assert.rejects(ctx.quizAwareness.fresh(),/paused/);
 await handlers['CommandOrControl+Shift+H']();assert(ctx.quiz.enabled);handlers['quiz-enable'](false);assert.throws(()=>handlers['quiz-enable']('yes'),/Invalid/);
});
test('quiz capture obeys pause, lock, sleep, work and power guards',async()=>{
 const f=fixture(),{ctx,handlers}=f;handlers['quiz-enable'](true);
 for(const key of ['paused','locked','suspended','active','quizUIBlocked']){ctx[key]=true;assert(!ctx.quiz.allowed());await assert.rejects(ctx.quizAwareness.fresh(),/paused/);ctx[key]=false;}
 ctx.power.quizMs=0;assert(!ctx.quiz.allowed());await assert.rejects(ctx.quizAwareness.fresh(),/paused/);assert.equal(f.captures(),0);
});
test('ongoing awareness shares its existing cache; stopping quiz retains that explicit awareness',async()=>{
 const f=fixture(),{ctx,handlers}=f;ctx.settings.screenAwareness='on';handlers['quiz-enable'](true);await ctx.awareness.fresh();await ctx.quiz.observe();assert.equal(f.captures(),1);assert.equal(ctx.quizAwareness.image,null);handlers['quiz-enable'](false);assert(ctx.awareness.image);
});
test('disabling quiz and pausing senses invalidate pending quiz-only snapshots',async()=>{
 for(const pause of [false,true]){
  const f=fixture(),{ctx,handlers}=f;handlers['quiz-enable'](true);ctx.delay=true;const pending=ctx.quizAwareness.fresh();
  if(pause){ctx.paused=true;vm.runInContext('clearAmbient()',ctx);}else handlers['quiz-enable'](false);
  f.release();await assert.rejects(pending,/changed/);assert.equal(ctx.quizAwareness.image,null);
 }
});

test('fast hover task wakes normal verification only on dwell and obeys quiz/sensing guards while hidden',async()=>{
 const {ctx}=fixture();let samples=0,reads=0,ready=false;
 ctx.ConditionalTask=ConditionalTask;
 ctx.quizTarget.sampleScreenPoint=()=>{samples++;return ready;};
 ctx.quiz.tick=async()=>reads++;
 // The full Fairy's own call to quizTasks (quiz-setup.mjs), with its guards and cadence.
 vm.runInContext(main.slice(main.indexOf('const { poll, hover } = quizTasks('),main.indexOf('quizHoverTask = hover;'))+'hoverTask = hover; pollTask = poll;',ctx);
 try{
  assert.equal(ctx.hoverTask.delay(),1000,'no heading to hover: a look a second');assert(ctx.hoverTask.enabled());
  Object.assign(ctx.quizTarget,{bounds:{x:0,y:0,width:100,height:100},heads:[{id:'q1',line:{x:0,y:0,width:1,height:1}}],headingAt:Date.now()});
  assert.equal(ctx.hoverTask.delay(),100,'a heading to hover: quick looks');
  // Away from the Mac the pointer isn't moving: it stops sampling and only keeps a heartbeat.
  ctx.idle=attention.AWAY_SECONDS;assert.equal(ctx.hoverTask.delay(),attention.HEARTBEAT_MS);
  await ctx.hoverTask.run();assert.equal(samples,0,'it doesn’t look while you’re away');
  ctx.idle=0;assert.equal(ctx.hoverTask.delay(),100);
  await ctx.hoverTask.run();assert.equal(samples,1);assert.equal(reads,0);
  ready=true;await ctx.hoverTask.run();assert.equal(reads,1);
  let release!:()=>void;ctx.quiz.tick=()=>new Promise<void>(resolve=>{release=resolve;});
  ctx.hoverTask.schedule=()=>1;ctx.hoverTask.clear=()=>{};
  await ctx.hoverTask.fire();
  assert(!ctx.hoverTask.running,'a slow OCR verification must not suspend cursor sampling');
  assert(ctx.hoverTask.timer!==null,'the next cursor sample remains scheduled');release();
  for(const flag of ['quitting','paused','locked','suspended','active','quizUIBlocked']){
   ctx[flag]=true;assert(!ctx.hoverTask.enabled(),flag);ctx[flag]=false;
  }
  ctx.quiz.enable(false);assert(!ctx.hoverTask.enabled());ctx.quiz.enable(true);
  ctx.power.quizMs=0;assert(!ctx.hoverTask.enabled());ctx.power.quizMs=500;
  ctx.window=null;assert(!ctx.hoverTask.enabled());
 }finally{ctx.hoverTask.dispose();}
});

test('native quiz capture retains question content beneath the excluded companion',async()=>{
 const {ctx}=fixture();
 ctx.companionWindow={isDestroyed:()=>false,isVisible:()=>true,getBounds:()=>({x:70,y:10,width:30,height:90})};
 ctx.excludedFairy=true;await ctx.quiz.observe();assert.equal(ctx.lastExclude.length,0);
 ctx.quizAwareness.clear();ctx.excludedFairy=false;await ctx.quiz.observe();assert.equal(ctx.lastExclude.length,1);
});
