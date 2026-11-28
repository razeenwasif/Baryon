import test from 'node:test';import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const {CompanionVisibility} = createRequire(import.meta.url)('../desktop/companion-visibility.cjs') as {
  CompanionVisibility: new (window: unknown, changed?: (hidden: boolean) => void) => {
    hidden: boolean;
    hide: (opts?: { opacity?: number }) => void;
    restore: (opts?: { opacity?: number }) => void;
  };
};
function fixture(){
 const events: boolean[]=[],state={opacity:.9,focusable:true,passthrough:false,destroyed:false};
 const window={isDestroyed:()=>state.destroyed,isFocusable:()=>state.focusable,getOpacity:()=>state.opacity,
 setFocusable:(v: boolean)=>state.focusable=v,setOpacity:(v: number)=>state.opacity=v,setIgnoreMouseEvents:(v: boolean)=>state.passthrough=v,
 hide:()=>assert.fail('Must not order out the native window'),close:()=>assert.fail('Must not close the window')};
 return {state,events,visibility:new CompanionVisibility(window as any,(hidden: boolean)=>events.push(hidden))};
}
test('hiding keeps native window alive but invisible, unfocusable and click-through',()=>{
 const {state,events,visibility}=fixture();visibility.hide();
 assert.equal(state.opacity,0);assert.equal(state.focusable,false);assert.equal(state.passthrough,true);assert.equal(visibility.hidden,true);
 visibility.hide();assert.deepEqual(events,[true]);
 visibility.restore();assert.equal(state.opacity,.9);assert.equal(state.focusable,true);assert.equal(state.passthrough,false);assert.equal(visibility.hidden,false);
 visibility.restore();assert.deepEqual(events,[true,false]);
});
test('restore preserves initially nonfocusable desktop overlay and tolerates disposal',()=>{
 const {state,visibility}=fixture();state.focusable=false;visibility.hide();visibility.restore();assert.equal(state.focusable,false);
 state.destroyed=true;visibility.hide();assert.equal(visibility.hidden,false);
});
