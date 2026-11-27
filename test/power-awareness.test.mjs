import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PowerAwareness,powerPolicy} from '../desktop/power-awareness.mjs';
import {ConditionalTask} from '../src/conditional-task.js';
function fixture(initial={}) {
 const monitor=new EventEmitter();monitor.isOnBatteryPower=()=>initial.onBattery??false;monitor.getCurrentThermalState=()=>initial.thermal??'nominal';
 let id=0;const timers=new Map(),changes=[];
 const power=new PowerAwareness({monitor,changed:p=>changes.push(p),schedule:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},clear:id=>timers.delete(id),watch:{schedule:()=>0,clear:()=>{}}});
 return {monitor,power,timers,changes,fire(){const [key,value]=timers.entries().next().value;timers.delete(key);value.fn();}};
}
test('AC, battery, thermal and CPU pressure choose bounded background budgets',()=>{
 const ac=powerPolicy();assert.deepEqual([ac.fps,ac.screenMs,ac.quizMs,ac.playbackMs],[30,5000,500,15000]);
 const battery=powerPolicy({onBattery:true});assert.deepEqual([battery.fps,battery.screenMs,battery.quizMs,battery.playbackMs],[20,15000,1000,30000]);assert.equal(battery.warmProvider,false);
 const warm=powerPolicy({thermal:'serious'});assert.equal(warm.optional,false);assert.equal(warm.screenMs,0);assert.equal(warm.quizMs,0);assert.equal(warm.handsFree,true);
 const hot=powerPolicy({thermal:'critical'});assert.equal(hot.fps,0);assert.equal(hot.handsFree,false);
 assert.equal(powerPolicy({speedLimit:70}).level,2);assert.equal(powerPolicy({speedLimit:30}).level,3);
});
test('initial native state is sampled without periodic polling; duplicate events are inert',()=>{
 const f=fixture({onBattery:true,thermal:'fair'});assert.equal(f.power.state().level,1);assert.equal(f.timers.size,0);
 for(let i=0;i<100;i++)f.monitor.emit('on-battery');assert.equal(f.changes.length,0);assert.equal(f.timers.size,0);f.power.dispose();
});
test('escalation is immediate; recovery waits once and rising heat cancels it',()=>{
 const f=fixture();f.monitor.emit('thermal-state-change',{state:'serious'});assert.equal(f.power.state().level,2);
 f.monitor.emit('thermal-state-change',{state:'nominal'});for(let i=0;i<10;i++)f.monitor.emit('on-ac');assert.equal(f.timers.size,1);assert.equal(f.power.state().level,2);assert.equal([...f.timers.values()][0].ms,30000);
 f.monitor.emit('thermal-state-change',{state:'critical'});assert.equal(f.timers.size,0);assert.equal(f.power.state().level,3);
 f.monitor.emit('thermal-state-change',{state:'nominal'});f.fire();assert.equal(f.power.state().level,0);f.power.dispose();
});
test('sleep cancels recovery; resume samples state; disposal removes listeners and deadlines',()=>{
 const f=fixture();f.monitor.emit('on-battery');f.monitor.emit('on-ac');assert.equal(f.timers.size,1);
 f.monitor.emit('suspend');assert.equal(f.timers.size,0);f.monitor.emit('on-ac');assert.equal(f.timers.size,0);
 f.monitor.emit('resume');assert.equal(f.timers.size,1);f.power.dispose();assert.equal(f.timers.size,0);assert.equal(f.monitor.eventNames().length,0);
 f.monitor.emit('on-battery');assert.equal(f.timers.size,0);
});
test('invalid thermal and speed notifications do not change or schedule policy',()=>{
 const f=fixture();f.monitor.emit('thermal-state-change',{state:'bad'});for(const limit of [-1,101,NaN,'5'])f.monitor.emit('speed-limit-change',{limit});assert.equal(f.power.state().level,0);assert.equal(f.changes.length,0);assert.equal(f.timers.size,0);f.power.dispose();
});
test('background deadline reschedules for battery and owns no timer under serious heat',()=>{
 const f=fixture();let taskID=0;const pending=new Map();const task=new ConditionalTask({enabled:()=>f.power.state().screenMs>0,delay:()=>f.power.state().screenMs,run:async()=>{},schedule:(fn,ms)=>{pending.set(++taskID,{fn,ms});return taskID;},clear:id=>pending.delete(id)});
 task.sync();assert.equal([...pending.values()][0].ms,5000);f.monitor.emit('on-battery');task.sync(true);assert.equal(pending.size,1);assert.equal([...pending.values()][0].ms,15000);
 f.monitor.emit('thermal-state-change',{state:'serious'});task.sync(true);assert.equal(pending.size,0);task.dispose();f.power.dispose();
});

test('Low Power Mode on AC and low battery use appropriate budgets without overriding heat',()=>{
 const lpm=powerPolicy({onBattery:false,lowPower:true,batteryPercent:80,nativeAvailable:true});assert.equal(lpm.level,1);assert.equal(lpm.label,'Low Power Mode');assert.equal(lpm.warmProvider,false);
 const low=powerPolicy({onBattery:true,batteryPercent:20});assert.equal(low.level,2);assert.equal(low.optional,false);assert.equal(low.handsFree,true);assert.match(low.label,/Low battery/);
 assert.equal(powerPolicy({onBattery:true,batteryPercent:21}).level,1);
 assert.equal(powerPolicy({onBattery:false,batteryPercent:5}).level,0);
 assert.equal(powerPolicy({onBattery:true,batteryPercent:null}).level,1);
 assert.equal(powerPolicy({onBattery:true,batteryPercent:2,thermal:'critical'}).level,3);
});
test('charging and Low Power Mode recovery use the same single hysteresis deadline',()=>{
 const f=fixture();f.power.update({onBattery:true,batteryPercent:18,nativeAvailable:true});assert.equal(f.power.state().level,2);
 f.monitor.emit('on-ac');assert.equal(f.timers.size,1);f.fire();assert.equal(f.power.state().level,0);
 f.power.update({lowPower:true});assert.equal(f.power.state().level,1);f.power.update({lowPower:false});f.fire();assert.equal(f.power.state().level,0);f.power.dispose();
});
