import test from 'node:test';
import assert from 'node:assert/strict';
import {FrameLoop} from '../src/frame-loop.js';
function fixture(){let now=0,id=0;const frames=new Map(),timers=new Map(),draws=[];const loop=new FrameLoop((t,dt)=>draws.push([t,dt]),{now:()=>now,request:cb=>{frames.set(++id,cb);return id;},cancel:id=>frames.delete(id),schedule:(cb,delay)=>{timers.set(++id,{cb,delay});return id;},clear:id=>timers.delete(id)});return {loop,frames,timers,draws,setNow:v=>{now=v;},frame:t=>{now=t;const [id,cb]=frames.entries().next().value;frames.delete(id);cb(t);},timer:()=>{const [id,v]=timers.entries().next().value;timers.delete(id);v.cb();}};}
test('one render deadline; stopping cancels every scheduled callback',()=>{
 const f=fixture();f.loop.setRunning(true);f.loop.setRunning(true);assert.equal(f.frames.size,1);f.frame(16);assert.equal(f.draws.length,1);assert.equal(f.frames.size,0);assert.equal(f.timers.size,1);assert(f.timers.values().next().value.delay>25);
 f.loop.setRunning(false);assert.equal(f.timers.size,0);assert.equal(f.frames.size,0);f.loop.setRunning(true);f.loop.setRunning(false);assert.equal(f.frames.size,0);
});
test('resume resets elapsed time rather than replaying sleep time',()=>{
 const f=fixture();f.loop.setRunning(true);f.frame(16);f.loop.setRunning(false);f.setNow(100000);f.loop.setRunning(true);f.frame(100016);assert.equal(f.draws.at(-1)[1],.016);
 f.timer();f.loop.dispose();assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);
});
test('disposal inside a frame does not schedule another callback',()=>{
 const f=fixture();f.loop.draw=()=>f.loop.dispose();f.loop.setRunning(true);f.frame(16);assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);
});

test('battery FPS lowers callback frequency without adding a second loop',()=>{
 const f=fixture();f.loop.setRunning(true);f.loop.setFPS(20);f.frame(16);assert(f.timers.values().next().value.delay>=48);assert.equal(f.timers.size,1);
 f.loop.setFPS(10);f.timer();f.frame(66);assert(f.timers.values().next().value.delay>=98);assert.equal(f.timers.size,1);
 f.loop.setRunning(false);assert.equal(f.timers.size,0);f.loop.dispose();
});
