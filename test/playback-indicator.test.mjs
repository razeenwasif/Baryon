import test from 'node:test';
import assert from 'node:assert/strict';
import {PlaybackIndicator} from '../src/playback-indicator.js';
test('music effects follow playing tracks, stop on pause, and poll at a bounded interval',async()=>{
 let time=0,calls=0,playing=true;const states=[];
 const p=new PlaybackIndicator({api:{spotifyStatus:async()=>({connected:true}),spotifyNow:async()=>{calls++;return {playing,track:{name:'Fixture'}}}},allowed:()=>true,onChange:s=>states.push(s),now:()=>time});
 await p.tick();await p.tick();assert.equal(calls,1);assert.deepEqual(states,[true]);
 time=15000;playing=false;await p.tick();assert.deepEqual(states,[true,false]);
});
test('pausing sensing rejects late playback and disconnected accounts never fetch music',async()=>{
 let allowed=true,resolve,requests=0;const states=[];
 const p=new PlaybackIndicator({api:{spotifyStatus:async()=>({connected:true}),spotifyNow:()=>new Promise(r=>{resolve=r})},allowed:()=>allowed,onChange:s=>states.push(s)});
 const job=p.tick();await Promise.resolve();allowed=false;await p.tick();resolve({playing:true,track:{}});await job;assert.deepEqual(states,[false]);
 const disconnected=new PlaybackIndicator({api:{spotifyStatus:async()=>({connected:false}),spotifyNow:async()=>{requests++}},allowed:()=>true,onChange:()=>{}});
 await disconnected.tick();assert.equal(requests,0);
});
test('playback errors hide notes and back off instead of polling repeatedly',async()=>{
 let now=0,calls=0;const states=[];
 const p=new PlaybackIndicator({api:{spotifyStatus:async()=>{calls++;throw Error('offline')}},allowed:()=>true,onChange:s=>states.push(s),now:()=>now});
 await p.tick();now=16000;await p.tick();assert.equal(calls,1);assert.deepEqual(states,[false]);
 now=60000;await p.tick();assert.equal(calls,2);
});

test('battery playback budget delays the next lookup without queuing work',async()=>{
 let now=0,calls=0;const p=new PlaybackIndicator({api:{spotifyStatus:async()=>({connected:true}),spotifyNow:async()=>{calls++;return null;}},allowed:()=>true,onChange:()=>{},now:()=>now,interval:()=>30000});
 await p.tick();now=15000;await p.tick();assert.equal(calls,1);assert.equal(p.next,30000);now=30000;await p.tick();assert.equal(calls,2);
});
