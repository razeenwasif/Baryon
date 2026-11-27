import test from 'node:test';
import assert from 'node:assert/strict';
import {DesktopWalk} from '../desktop/walking.mjs';
import {WalkingAnimation} from '../src/walking-animation.js';
const flush=()=>new Promise(r=>setImmediate(r));
function rig(overrides={}){
 let time=0,allowed=true,visible=true,bounds={x:1100,y:24,width:350,height:740},area={x:0,y:0,width:1500,height:800};const moves=[];
 const window={isDestroyed:()=>false,isVisible:()=>visible,getBounds:()=>({...bounds}),setPosition:(x,y,animate)=>{bounds={...bounds,x,y};moves.push({x,y,animate});}};
 const walk=new DesktopWalk({window,screen:{getDisplayMatching:()=>({id:1,workArea:area})},allowed:()=>allowed,now:()=>time,random:()=>0,...overrides});
 return {walk,moves,advance:ms=>time+=ms,block:()=>allowed=false,hide:()=>visible=false,drag:()=>bounds.x-=20,resize:()=>area.width-=200,bounds:()=>bounds,setBounds:b=>bounds=b};
}
test('walk completes leftward with bounded speed and no vertical motion or animation',()=>{
 const r=rig(),s=r.walk.start();assert.equal(s.direction,-1);let last=1100,v;
 for(let i=0;i<110;i++){r.advance(50);v=r.walk.step(s.token);if(!v)break;const b=r.bounds();assert.ok(last-b.x<=2);assert.equal(b.y,24);last=b.x;if(v.done)break;}
 assert.equal(v.done,true);assert.equal(last,920);assert.ok(r.moves.every(m=>m.animate===false));assert.equal(r.walk.walk,null);
});
test('negative-coordinate display and left edge select the available direction',()=>{
 let b={x:-1488,y:0,width:350,height:700};const walk=new DesktopWalk({window:{isDestroyed:()=>false,isVisible:()=>true,getBounds:()=>b},screen:{getDisplayMatching:()=>({id:3,workArea:{x:-1500,y:0,width:1500,height:800}})},allowed:()=>true});
 assert.equal(walk.start().direction,1);
});
test('outside display and insufficient room refuse movement',()=>{
 const r=rig();r.setBounds({x:0,y:0,width:1500,height:700});assert.equal(r.walk.start(),null);
});
for(const condition of ['block','hide','drag','resize'])test(`${condition} cancels walk without taking another step`,()=>{
 const r=rig(),s=r.walk.start();r[condition]();r.advance(50);assert.equal(r.walk.step(s.token),null);assert.equal(r.moves.length,0);
});
test('long renderer stall cancels instead of jumping; stale token cannot cancel a later walk',()=>{
 const r=rig(),a=r.walk.start();r.advance(2000);assert.equal(r.walk.step(a.token),null);const b=r.walk.start();r.walk.stop(a.token);assert.equal(r.walk.walk.token,b.token);assert.equal(r.walk.step(a.token),null);
});
function renderer(){let eligible=true,view=null,starts=0,steps=0,stops=[];const api={walkStart:async()=>({token:++starts,direction:1}),walkStep:async token=>{steps++;return {token,direction:1,travel:steps*2}},walkStop:async t=>stops.push(t)};const w=new WalkingAnimation({api,eligible:()=>eligible,display:v=>view=v,random:()=>0});return {w,api,block:()=>eligible=false,view:()=>view,steps:()=>steps,starts:()=>starts,stops};}
test('idle clock freezes while blocked, then starts exactly one walk',async()=>{
 const r=renderer();r.block();r.w.tick(1000);assert.equal(r.w.remaining,240);const a=renderer();a.w.tick(240);await flush();assert.equal(a.starts(),1);assert.equal(a.view().token,1);
});
test('renderer caps movement requests and stops immediately when conversation starts',async()=>{
 const r=renderer();await r.w.start();r.w.tick(.01);assert.equal(r.steps(),0);r.w.tick(.05);r.w.tick(.05);assert.equal(r.steps(),1);await flush();r.block();r.w.tick(.03);assert.equal(r.view(),null);assert.deepEqual(r.stops,[1]);
});
test('late start is cancelled after mode switch, without resurrecting the sprite',async()=>{
 const r=renderer();let resolve;r.api.walkStart=()=>new Promise(r=>resolve=r);const p=r.w.start();r.w.cancel();resolve({token:8,direction:-1});await p;assert.equal(r.view(),null);assert.deepEqual(r.stops,[8]);
});
test('failed and completed movements restore idle and defer next attempt',async()=>{
 const r=renderer();await r.w.start();r.api.walkStep=async()=>({done:true});r.w.tick(.05);await flush();assert.equal(r.view(),null);assert.equal(r.w.remaining,240);
 r.api.walkStart=async()=>{throw Error('closed')};assert.equal(await r.w.start(),false);assert.equal(r.w.pending,false);
});

import {spriteSeams} from '../src/sprite-sheet.js';
test('atlas seams follow transparent gaps instead of slicing neighboring artwork',()=>{
 const width=200,height=80,pixels=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const gap=100+Math.round(18*Math.sin(y/15));
  if(Math.abs(x-gap)>4)pixels[(y*width+x)*4+3]=255;
 }
 const seams=spriteSeams(pixels,width,height,[35,165]);
 assert.equal(seams.length,3);
 for(let y=0;y<height;y++){assert.equal(pixels[(y*width+seams[1][y])*4+3],0);assert.equal(seams[0][y],0);assert.equal(seams[2][y],width);}
});
