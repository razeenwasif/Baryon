import test from 'node:test';import assert from 'node:assert/strict';
import {CompanionVisibility} from '../desktop/companion-visibility.cjs';
function fixture(){
 const events=[],state={opacity:.9,focusable:true,passthrough:false,destroyed:false};
 const window={isDestroyed:()=>state.destroyed,isFocusable:()=>state.focusable,getOpacity:()=>state.opacity,
 setFocusable:v=>state.focusable=v,setOpacity:v=>state.opacity=v,setIgnoreMouseEvents:v=>state.passthrough=v,
 hide:()=>assert.fail('Must not order out the native window'),close:()=>assert.fail('Must not close the window')};
 return {state,events,visibility:new CompanionVisibility(window,hidden=>events.push(hidden))};
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
