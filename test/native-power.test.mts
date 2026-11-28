import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {NativePower} from '../desktop/native-power.mjs';
function fixture(){const children:any[]=[],states:any[]=[],timers=new Map<number,{fn:()=>void;ms:number}>();let id=0;const worker=new NativePower({changed:x=>states.push(x),schedule:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},clear:(id:number)=>timers.delete(id),spawnProcess:()=>{const c:any=new EventEmitter();c.stdin=new PassThrough();c.stdout=new PassThrough();c.stderr=new PassThrough();c.kill=()=>{c.killed=true;};children.push(c);return c;}});worker.start();return {worker,children,states,timers};}
test('native power parses chunked snapshots and rejects malformed data without unbounded buffering',()=>{
 const f=fixture(),c=f.children[0];c.stdout.write('{"onBattery":true,"lowPower":');c.stdout.write('false,"batteryPercent":19}\n');assert.deepEqual(f.states.at(-1),{onBattery:true,lowPower:false,batteryPercent:19,nativeAvailable:true});
 c.stdout.write('{"onBattery":false,"lowPower":false,"batteryPercent":101}\n');assert(c.killed);assert.equal(f.states.at(-1).nativeAvailable,false);f.worker.stop();
 const big=fixture();big.children[0].stdout.write('x'.repeat(4097));assert(big.children[0].killed);big.worker.stop();
});
test('helper failures retry only three times; shutdown releases child and recovery timer',()=>{
 const f=fixture();for(let i=0;i<4;i++){f.children.at(-1).emit('close');if(i<3){assert.equal(f.timers.size,1);const [id,t]=f.timers.entries().next().value!;f.timers.delete(id);t.fn();}}
 assert.equal(f.children.length,4);assert.equal(f.timers.size,0);f.worker.stop();
 const g=fixture();g.children[0].emit('error',Error('missing'));g.children[0].emit('close');assert.equal(g.timers.size,1);g.worker.stop();assert.equal(g.timers.size,0);
});
test('resume requests a fresh snapshot and stop ignores late output',()=>{
 const f=fixture();let input='';f.children[0].stdin.on('data',(c:any)=>input+=c);f.worker.refresh();assert.equal(input,'refresh\n');f.worker.stop();assert(f.children[0].killed);f.children[0].stdout.write('{"onBattery":false,"lowPower":false,"batteryPercent":null}\n');assert.equal(f.states.length,0);f.children[0].emit('close');assert.equal(f.timers.size,0);
});
