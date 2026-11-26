import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const main=readFileSync(new URL('../desktop/main.cjs',import.meta.url),'utf8');
const block=main.slice(main.indexOf("  micShortcutRegistered = globalShortcut.register("),main.indexOf("  await window.loadFile(join(__dirname, '../dist/index.html'));"));
test('global mic shortcut only sends a renderer event and respects lock/quit lifecycle',()=>{
 let callback,received=[],warnings=[];
 const context={startupTimes:{mark(){}},micShortcutRegistered:false,quitting:false,suspended:false,locked:false,powerMonitor:{getSystemIdleState:()=> 'active'},window:{isDestroyed:()=>false,webContents:{send:e=>received.push(e)}},globalShortcut:{register:(key,fn)=>{assert.equal(key,'CommandOrControl+Shift+M');callback=fn;return true;}},console:{warn:s=>warnings.push(s)}};
 vm.runInNewContext(block,context);assert.equal(context.micShortcutRegistered,true);callback();assert.deepEqual(received,['fairy:mic-toggle']);
 for(const key of ['quitting','suspended','locked']){context[key]=true;callback();context[key]=false;}
 context.powerMonitor.getSystemIdleState=()=> 'locked';callback();context.powerMonitor.getSystemIdleState=()=> 'active';context.window.isDestroyed=()=>true;callback();context.window=null;callback();assert.equal(received.length,1);assert.equal(warnings.length,0);
});
test('shortcut collision is exposed and logged',()=>{let warning='';const context={startupTimes:{mark(){}},globalShortcut:{register:()=>false},console:{warn:s=>warning=s}};vm.runInNewContext(block,context);assert.equal(context.micShortcutRegistered,false);assert.match(warning,/compact microphone button/);});
test('preload microphone event is removable and exposes no event object',()=>{
 let api;const listeners=new Map();const ipcRenderer={on:(event,callback)=>listeners.set(event,callback),removeListener:(event,callback)=>{assert.equal(listeners.get(event),callback);listeners.delete(event);}};
 vm.runInNewContext(readFileSync(new URL('../desktop/preload.cjs',import.meta.url),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(_name,value)=>api=value},ipcRenderer})});
 let count=0;const off=api.onMicToggle((...args)=>{assert.equal(args.length,0);count++;});listeners.get('fairy:mic-toggle')({secret:'event'});assert.equal(count,1);off();assert.equal(listeners.has('fairy:mic-toggle'),false);
});
