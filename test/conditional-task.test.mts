import test from 'node:test';
import assert from 'node:assert/strict';
import {ConditionalTask, type ConditionalTimerHandle} from '../src/conditional-task.js';
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve};};
function clock(){let now=0,id=0;const jobs=new Map<number,{fn:()=>void;at:number}>();return {now:()=>now,jobs,schedule:(fn:()=>void,ms:number)=>{jobs.set(++id,{fn,at:now+ms});return id as unknown as ConditionalTimerHandle;},clear:(id:ConditionalTimerHandle)=>{jobs.delete(id as unknown as number);},advance:async(ms:number)=>{const end=now+ms;for(;;){const next=[...jobs].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;now=next[1].at;jobs.delete(next[0]);next[1].fn();for(let i=0;i<8;i++)await Promise.resolve();}now=end;}};}
test('disabled features own zero timers over ten simulated idle minutes',async()=>{
 const c=clock();let enabled=false,calls=0;
 const task=new ConditionalTask({...c,enabled:()=>enabled,delay:2000,run:()=>calls++});task.sync();await c.advance(600000);assert.equal(calls,0);assert.equal(c.jobs.size,0);
 enabled=true;task.sync();await c.advance(6000);assert.equal(calls,3);
 enabled=false;task.sync();assert.equal(c.jobs.size,0);await c.advance(600000);assert.equal(calls,3);
});
test('slow work never overlaps, disable/re-enable waits for it, and disposal prevents resurrection',async()=>{
 const c=clock(),gate=deferred();let enabled=true,calls=0;
 const task=new ConditionalTask({...c,enabled:()=>enabled,delay:1000,run:async()=>{calls++;await gate.promise;}});
 task.sync();await c.advance(1000);assert.equal(calls,1);assert.equal(c.jobs.size,0);
 enabled=false;task.sync();enabled=true;task.sync();await c.advance(5000);assert.equal(calls,1);
 task.dispose();gate.resolve();await Promise.resolve();await Promise.resolve();assert.equal(c.jobs.size,0);
});
test('deadline moves with user activity; unrelated updates do not create duplicate timers',async()=>{
 const c=clock();let due=300000,calls=0;const task=new ConditionalTask({...c,enabled:()=>calls===0,delay:()=>due-c.now(),run:()=>calls++});
 task.sync();await c.advance(100000);due=400000;for(let i=0;i<100;i++)task.sync(true);assert.equal(c.jobs.size,1);
 await c.advance(299999);assert.equal(calls,0);await c.advance(1);assert.equal(calls,1);assert.equal(c.jobs.size,0);
});
test('errors are reported once and retry waits for its next interval',async()=>{
 const c=clock(),errors: string[]=[];let calls=0;
 const task=new ConditionalTask({...c,enabled:()=>true,delay:5000,run:async()=>{calls++;throw Error('offline');},onError:(e:unknown)=>errors.push(e instanceof Error?e.message:String(e))});
 task.sync();await c.advance(15000);assert.equal(calls,3);assert.deepEqual(errors,['offline','offline','offline']);assert.equal(c.jobs.size,1);task.dispose();
});
