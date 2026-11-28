import test from 'node:test';
import assert from 'node:assert/strict';
import { DesktopPresence } from '../desktop/desktop-presence.mjs';
function fixture() {
 const state={visible:true,hidden:false,focused:true,focusable:true,ignore:false,events:[] as boolean[],hides:0};
 const window={isDestroyed:()=>false,isFocusable:()=>state.focusable,isFocused:()=>state.focused,
 setFocusable:(v:boolean)=>{state.focusable=v;},setIgnoreMouseEvents:(v:boolean)=>{state.ignore=v;},
 showInactive:()=>{state.visible=!state.hidden;},show:()=>{state.focused=true;},
 webContents:{send:(_name:string,v:boolean)=>state.events.push(v)}};
 const app={hide:()=>{state.hides++;state.hidden=true;state.visible=false;state.focused=false;},show:()=>{state.hidden=false;state.visible=true;}};
 return {state,presence:new DesktopPresence({app:app as any,window:window as any})};
}
test('desktop overlay remains visible and cannot take mouse or keyboard input',()=>{
 const {state,presence}=fixture();presence.enter();
 assert.equal(state.visible,true);assert.equal(state.focusable,false);assert.equal(state.ignore,true);assert.equal(state.focused,false);
 const hides=state.hides;presence.passive();presence.passive();assert.equal(state.hides,hides);
 assert.deepEqual(state.events,[true]);presence.leave();assert.equal(state.focusable,true);assert.equal(state.ignore,false);assert.deepEqual(state.events,[true,false]);
});
test('review is interactive; resume relinquishes focus; cleanup is idempotent',()=>{
 const {state,presence}=fixture();presence.enter();presence.review();assert.equal(state.focused,true);assert.equal(state.ignore,false);assert.equal(state.focusable,true);
 presence.passive();assert.equal(state.focused,false);assert.equal(state.visible,true);assert.equal(state.ignore,true);
 presence.leave();presence.leave();assert.deepEqual(state.events,[true,false]);
});
