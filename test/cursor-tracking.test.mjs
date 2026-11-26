import test from 'node:test';
import assert from 'node:assert/strict';
import {cursorFrame,CursorGaze,CursorSampler} from '../src/cursor-tracking.js';
import {DesktopCursor} from '../desktop/cursor-tracking.mjs';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const advance=(g,n)=>{for(let i=0;i<n;i++)g.tick(.1);};
test('gaze covers the supplied directions and rejects a central/invalid point',()=>{
 for(const [x,y,f] of [[-300,0,0],[-300,-300,1],[0,-300,2],[300,-300,3],[300,0,4],[0,300,5],[-80,300,5]])assert.equal(cursorFrame(x,y),f);
 assert.equal(cursorFrame(10,10),null);assert.equal(cursorFrame(NaN,0),null);
});
test('gaze dwells through boundary jitter and relaxes after stationary cursor',()=>{
 const g=new CursorGaze(),head={x:0,y:0};g.point(300,0,head);g.tick(.1);assert.equal(g.frame,null);g.tick(.03);assert.equal(g.frame,4);
 g.point(300,-150,head);g.tick(.05);g.point(300,0,head);g.tick(.05);assert.equal(g.frame,4);
 for(let i=0;i<40;i++){g.point(300,0,head);g.tick(.1);}assert.equal(g.frame,null);
 g.point(-300,0,head);advance(g,2);assert.equal(g.frame,0);
});
test('gaze resets on interruption and never catches up across sleep',()=>{
 const g=new CursorGaze();g.point(100,0,{x:0,y:0});g.tick(99);assert.equal(g.frame,null);g.tick(.1);assert.equal(g.frame,4);g.tick(.1,false);assert.equal(g.frame,null);assert.equal(g.x,null);
 g.point(Infinity,2,{x:0,y:0});assert.equal(g.frame,null);
});
test('one request in flight and stale response cannot revive disabled gaze',async()=>{
 let resolve,enabled=true,calls=0;const points=[];
 const s=new CursorSampler({read:()=>{calls++;return new Promise(r=>resolve=r);},eligible:()=>enabled,update:p=>points.push(p)});
 s.tick(.1);await flush();for(let i=0;i<100;i++)s.tick(.1);assert.equal(calls,1);
 enabled=false;s.tick(.1);enabled=true;s.tick(.1);resolve({x:1,y:1});await flush();assert.deepEqual(points,[null]);
 s.tick(.1);await flush();assert.equal(calls,2);s.dispose();resolve({x:2,y:2});await flush();assert.deepEqual(points,[null,null]);
});
test('sampler backs off stationary points, caps active requests and stops when ineligible',async()=>{
 let calls=0,enabled=true;const s=new CursorSampler({read:async()=>{calls++;return {x:4,y:8}},eligible:()=>enabled,update:()=>{}});
 for(let i=0;i<100;i++){s.tick(.02);await flush();}assert.ok(calls<=20);const before=calls;
 for(let i=0;i<100;i++){s.tick(.02);await flush();}assert.ok(calls-before<=5);
 enabled=false;for(let i=0;i<100;i++){s.tick(.02);await flush();}assert.equal(calls-before<=5,true);s.dispose();
});
test('sampling failures clear gaze and back off without unhandled rejection',async()=>{
 let calls=0,last;const s=new CursorSampler({read:async()=>{calls++;throw Error('unavailable')},eligible:()=>true,update:p=>last=p});s.tick(.1);await flush();assert.equal(last,null);
 for(let i=0;i<10;i++){s.tick(.1);await flush();}assert.equal(calls,1);s.dispose();
});
function desktop(){let allowed=true,time=0,display=1,visible=true,minimized=false,reads=0;
 const d=new DesktopCursor({window:{isDestroyed:()=>false,isVisible:()=>visible,isMinimized:()=>minimized,getContentBounds:()=>({x:-1600,y:-100,width:350,height:820})},screen:{getCursorScreenPoint:()=>{reads++;return{x:-1200,y:50}},getDisplayNearestPoint:()=>({id:display}),getDisplayMatching:()=>({id:1})},allowed:()=>allowed,now:()=>time});
 return {d,set:v=>{({allowed=allowed,time=time,display=display,visible=visible,minimized=minimized}=v)},reads:()=>reads};
}
test('desktop converts negative display DIP coordinates to window-relative values and rate limits',()=>{
 const f=desktop();assert.deepEqual(f.d.sample(),{x:400,y:150});f.d.sample();assert.equal(f.reads(),1);f.set({time:100});f.d.sample();assert.equal(f.reads(),2);
});
test('desktop clears cached coordinates on lock/task/power guard, hidden/minimized and other display',()=>{
 const f=desktop();f.d.sample();f.set({allowed:false});assert.equal(f.d.sample(),null);f.set({allowed:true,display:2,time:100});assert.equal(f.d.sample(),null);
 f.set({visible:false});assert.equal(f.d.sample(),null);f.set({visible:true,minimized:true});assert.equal(f.d.sample(),null);
});

test('battery interval caps moving cursor samples at five per second',async()=>{
 let calls=0;const s=new CursorSampler({read:async()=>({x:++calls,y:0}),eligible:()=>true,update:()=>{},interval:()=>.2});
 for(let i=0;i<100;i++){s.tick(.02);await flush();}assert.ok(calls<=10);assert.ok(calls>=8);s.dispose();
});
