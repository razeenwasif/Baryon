import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const main=readFileSync(new URL('../build-ts/desktop/main.cjs',import.meta.url),'utf8');
const block=main.slice(main.indexOf('        const quizShortcutReady ='),main.indexOf('        micShortcutRegistered = globalShortcut.register('));
const flush=()=>new Promise(r=>setImmediate(r));
function fixture(register=true){
 const keys:Record<string,()=>any>={},warnings:any[]=[],errors:any[]=[],calls:any[]=[];
 const context:any={shortcutStatus:{},quitting:false,suspended:false,locked:false,ambientPaused:false,
 powerMonitor:{getSystemIdleState:()=> 'active'},window:{isDestroyed:()=>false},
 quiz:{enabled:true,enable:(v:boolean)=>{context.quiz.enabled=v;calls.push(['quiz',v]);}},quizTarget:{automatic:false},
 setQuizAutomatic:(v:boolean)=>{context.quizTarget.automatic=v;calls.push(['target',v]);},setSensesPaused:(v:boolean)=>{context.ambientPaused=v;calls.push(['senses',v]);},
 globalShortcut:{register:(key:string,fn:()=>any)=>{keys[key]=fn;return register;}},notify:(e:any)=>errors.push(e),console:{warn:(e:any)=>warnings.push(e)}};
 vm.runInNewContext(block,context);return {context,keys,calls,errors,warnings};
}
test('global quiz controls toggle current state without focusing the hidden companion',async()=>{
 const {context,keys,calls}=fixture();
 for(const key of ['H','H','T','T','P','P']){keys['CommandOrControl+Shift+'+key]();await flush();}
 assert.deepEqual(calls,[['quiz',false],['quiz',true],['target',true],['target',false],['senses',true],['senses',false]]);
 assert.equal(context.quiz.enabled,true);assert.equal(context.quizTarget.automatic,false);
});
test('quiz shortcuts ignore shutdown/sleep/lock and missing windows',async()=>{
 const {context,keys,calls}=fixture();
 for(const key of ['quitting','suspended','locked']){context[key]=true;Object.values(keys).forEach(fn=>fn());await flush();context[key]=false;}
 context.powerMonitor.getSystemIdleState=()=> 'locked';Object.values(keys).forEach(fn=>fn());await flush();
 context.powerMonitor.getSystemIdleState=()=> 'active';context.window=null;Object.values(keys).forEach(fn=>fn());await flush();assert.equal(calls.length,0);
});
test('shortcut conflicts and failed settings writes are surfaced',async()=>{
 const a=fixture(false);assert.equal(a.warnings.length,3);assert(Object.values(a.context.shortcutStatus).every(v=>v===false));
 const b=fixture();b.context.setSensesPaused=()=>Promise.reject(Error('Save failed'));b.keys['CommandOrControl+Shift+P']();await flush();assert.deepEqual(b.errors,['Save failed']);
});
test('pausing aborts work and clears sensing without disabling the quiz preference',async()=>{
 const handlers:Record<string,(...args:any[])=>any>={},saved:any[]=[],c:any={ambientPaused:false,awarenessError:'old',listeningError:'old',settings:{awarenessPaused:'off'},active:{abort:()=>saved.push('abort')},abortFor:(controller:any,reason:string)=>{assert.equal(reason,'senses');controller.abort();},
 clearAmbient:()=>saved.push('clear'),core:{cleanSettings:(v:any,s:any)=>({...s,...v}),writeJSON:async(_p:any,v:any)=>saved.push(v.awarenessPaused)},file:(n:string)=>n,ambientState:()=>({paused:c.ambientPaused}),handle:(id:string,fn:any)=>handlers[id]=fn};
 vm.runInNewContext(main.slice(main.indexOf('        const setSensesPaused ='),main.indexOf("        handle('awareness-display'")),c);
 assert.equal((await handlers['awareness-pause'](true)).paused,true);assert.equal((await handlers['awareness-pause'](false)).paused,false);
 assert.deepEqual(saved,['abort','clear','on','clear','off']);await assert.rejects(()=>handlers['awareness-pause']('true'),/Invalid/);
});
