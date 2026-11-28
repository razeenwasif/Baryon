import test from 'node:test';
import assert from 'node:assert/strict';
import {IdleAnimation,SITTING} from '../src/idle-animation.js';
const advance=(a:IdleAnimation,seconds:number,options?:any)=>{for(let t=0;t<seconds-.00001;t+=.05)a.tick(Math.min(.05,seconds-t),options);};
test('idle cycle waits a few minutes, sits for a while, and returns to standing',()=>{
 const a=new IdleAnimation(()=>0);advance(a,179);assert.equal(a.phase,'idle');advance(a,2);assert.equal(a.phase,'enter');
 advance(a,3);assert.equal(a.phase,'seated');advance(a,590);assert.equal(a.phase,'seated');advance(a,20);assert.equal(a.phase,'idle');assert(a.remaining>170);
});
test('busy periods and hidden windows cannot start or pile up idle animations',()=>{
 const a=new IdleAnimation(()=>0);advance(a,500,{eligible:false});assert.equal(a.phase,'idle');assert.equal(a.remaining,180);
 advance(a,500,{visible:false});assert.equal(a.remaining,180);a.start();advance(a,1,{eligible:false});assert.equal(a.phase,'enter');assert.equal(a.time,0);
});
test('sit and stand transitions join the same endpoint poses without a wrap jump',()=>{
 const a=new IdleAnimation(()=>0);a.start();assert.deepEqual(a.sample(),{from:'idle',to:'sit-enter-0',mix:0,active:true});
 a.time=8*SITTING.enterFrame+.2;assert.equal(a.sample().to,'sit-loop-0');assert.equal(a.sample().mix,1);
 a.phase='seated';a.time=0;assert.equal(a.sample().to,'sit-loop-0');a.stop();assert.equal(a.sample().from,'sit-loop-0');assert.equal(a.sample().to,'sit-enter-7');
 a.time=8*SITTING.enterFrame+.2;assert.equal(a.sample().to,'idle');assert.equal(a.sample().mix,1);
});
test('sitting expressions use a closed resting sequence, not a constant talking loop',()=>{
 const a=new IdleAnimation(()=>0);a.phase='seated';
 for(let t=0;t<20;t+=.05){a.time=t;const s=a.sample();assert(!['sit-loop-3','sit-loop-7'].includes(s.to));assert(s.mix>=0&&s.mix<=1);}
});

test('seated duration spans 10–15 minutes and pauses through conversation',()=>{
 for(const [random,hold] of [[0,600],[1,900]] as const){const a=new IdleAnimation(()=>random);a.start();advance(a,3);assert.equal(a.hold,hold);const before=a.time;advance(a,120,{eligible:false});assert.equal(a.phase,'seated');assert.equal(a.time,before);advance(a,hold-5);assert.equal(a.phase,'seated');advance(a,9);assert.equal(a.phase,'idle');}
});
