import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
import {trayMenuTemplate,trayTooltip} from '../desktop/presence.mjs';
import {EventEmitter} from 'node:events';
const source=readFileSync(new URL('../build-ts/desktop/main.cjs',import.meta.url),'utf8');
test('sprite hide changes only visibility state and leaves the window and quiz alive',()=>{
 const events:any[]=[];let stops=0,hidden=0,closed=0;const handlers:Record<string,any>={};
 const c:any=vm.createContext({spriteHidden:false,desktopWalk:{stop:()=>stops++},window:{hide:()=>hidden++,close:()=>closed++,webContents:{send:(...v:any[])=>events.push(v)}},refreshTray:()=>{},hideWindow:()=>hidden++,handle:(name:string,fn:any)=>handlers[name]=fn});
 vm.runInContext(source.slice(source.indexOf('function setSpriteHidden('),source.indexOf('function applyLoginItem(')),c);
 vm.runInContext(source.slice(source.indexOf("        handle('close'"),source.indexOf("        handle('quiz-target-clear'")),c);
 assert.equal(handlers['sprite-hidden'](true),true);assert.equal(hidden,0);assert.equal(closed,0);assert.equal(stops,0,'no window walk to stop: floating mode is gone');assert.deepEqual(events[0],['fairy:sprite-hidden',true]);
 handlers['sprite-hidden'](false);assert.equal(c.spriteHidden,false);handlers.close();assert.equal(hidden,1);assert.equal(closed,0);
});
test('floating tray hides the whole companion and keeps Quit separate',()=>{
 assert.equal(trayMenuTemplate({floating:true,visible:true} as any)[0].label,'Hide Baryon');
 assert.equal(trayMenuTemplate({floating:true,visible:false} as any)[0].label,'Show Baryon');
 assert.equal(trayMenuTemplate({floating:true} as any).at(-1)!.id,'quit');
});

test('tray hide/show keeps the BrowserWindow alive in both layouts',async()=>{
 for(const floating of [false,true]){
  let visible=true,closed=0,refreshes=0;const c:any=vm.createContext({floating,spriteHidden:false,companionVisibility:{hidden:false},hideWindow:()=>{c.companionVisibility.hidden=true},
   window:{isDestroyed:()=>false,isVisible:()=>visible,hide:()=>{visible=false},close:()=>closed++},
   showWindow:()=>{visible=true;c.companionVisibility.hidden=false},setSpriteHidden:(v:any)=>{c.spriteHidden=v},refreshTray:()=>refreshes++});
  vm.runInContext(source.slice(source.indexOf('async function trayAction('),source.indexOf('function setUpTray(')),c);
  await c.trayAction('show');assert.equal(c.companionVisibility.hidden,true);assert.equal(visible,true);assert.equal(closed,0);
  await c.trayAction('show');assert.equal(visible,true);assert.equal(closed,0);assert.equal(refreshes,2);assert.equal(c.companionVisibility.hidden,false);
 }
});
test('manual/automatic IPC resets pending work but preserves question history',()=>{
 const handlers:Record<string,any>={},calls:any[]=[];const c:any=vm.createContext({
  handle:(id:string,fn:any)=>handlers[id]=fn,quizTarget:{setAutomatic:(v:any)=>{if(typeof v!=='boolean')throw Error('Invalid quiz targeting mode');calls.push(v)}},
  quiz:{reset:(status:any,opts:any)=>calls.push({status,keep:opts.keepQuestionHistory})},quizState:()=>({enabled:true})});
 const start=source.indexOf("        const setQuizAutomatic =");
 const end=source.indexOf("\n        handle(",source.indexOf("        handle('quiz-auto'"));
 vm.runInContext(source.slice(start,end),c);
 handlers['quiz-auto'](false);assert.equal(calls[0],false);assert.equal(calls[1].keep,true);assert.match(calls[1].status,/Hover/);
 handlers['quiz-auto'](true);assert.equal(calls[2],true);assert.equal(calls[3].keep,true);
 assert.throws(()=>handlers['quiz-auto']('false'),/Invalid/);assert.equal(calls.length,4);
});

test('one native bird-and-quiz item retains controls and falls back safely if its helper fails',()=>{
 const fallbacks:any[]=[],nativeMenus:any[]=[];let launches=0,notices=0;
 class Bridge {
  callbacks:any;running:boolean;
  constructor(callbacks:any){this.callbacks=callbacks;this.running=false;}
  start(){if(!this.running){this.running=true;launches++;}}
  setMenu(menu:any,tooltip:any){nativeMenus.push({menu,tooltip});}
 }
 class Fallback {
  destroyed:boolean;tooltip:any;menu:any;
  constructor(){this.destroyed=false;fallbacks.push(this);}
  on(){} setToolTip(value:any){this.tooltip=value;} setContextMenu(value:any){this.menu=value;}
  destroy(){this.destroyed=true;} isDestroyed(){return this.destroyed;}
 }
 const window:any=new EventEmitter();window.isDestroyed=()=>false;window.isVisible=()=>true;
 const c:any=vm.createContext({window,QuizOverlay:Bridge,Tray:Fallback,process:{platform:'darwin'},__dirname:'/app/desktop',join:(...v:string[])=>v.join('/'),beside:(path:string)=>`/app/${path}`,
  tray:null,quizOverlay:null,presence:{trayMenuTemplate,trayTooltip},settings:{name:'Fairy',muted:'off'},companionWindow:null,spriteHidden:false,
  companionVisibility:{hidden:false},meeting:{status:'off'},faceLink:null,quiz:{enable:(value:any)=>{c.quiz.enabled=value}},
  notify:()=>notices++,nativeImage:{createFromPath:()=>({isEmpty:()=>false,setTemplateImage(){}})},Menu:{buildFromTemplate:(value:any)=>value}});
 vm.runInContext(source.slice(source.indexOf('let lastTrayState = null;')),c);
 const setup=source.slice(source.indexOf('        quizOverlay = new QuizOverlay({'),source.indexOf("        // Two Macs, step 8: the watcher is built in quiz-setup.mjs"));
 vm.runInContext(setup,c);
 c.quizOverlay.callbacks.onReady();assert.equal(c.tray,c.quizOverlay);assert.equal(launches,1);assert.equal(fallbacks.length,0);
 assert.equal(nativeMenus[0].menu.at(-1).id,'quit');c.refreshTray();assert.equal(nativeMenus.length,1);
 c.settings.muted='on';c.refreshTray();assert.equal(nativeMenus.at(-1).menu.find((item:any)=>item.id==='mute').checked,true);
 c.quizOverlay.running=false;c.quizOverlay.callbacks.onError();assert.equal(c.tray,fallbacks[0]);assert.equal(c.quiz.enabled,false);
 assert.equal(notices,1);assert.equal(fallbacks[0].menu.at(-1).id,'quit');
 c.quizOverlay.callbacks.onReady();assert.equal(c.tray,c.quizOverlay);assert(fallbacks[0].destroyed);assert.equal(launches,2);
 for(const event of ['show','hide','minimize','restore'])assert.equal(window.listenerCount(event),1);
});
