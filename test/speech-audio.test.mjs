import test from 'node:test';
import assert from 'node:assert/strict';
import {speechRange,joinDelay} from '../src/speech-audio.js';
function buffer(channels,rate=1000){return{sampleRate:rate,length:channels[0].length,duration:channels[0].length/rate,numberOfChannels:channels.length,getChannelData:i=>channels[i]};}
test('speech trimming retains soft edges and interior pauses, on either stereo channel',()=>{
  const samples=new Float32Array(2000);samples.fill(.001,300,500);samples.fill(.2,500,800);samples.fill(.1,1300,1500);samples.fill(.001,1500,1600);
  const range=speechRange(buffer([new Float32Array(2000),samples]));
  assert.equal(range.offset,.26);assert.equal(range.duration,1.42);assert.equal(range.leadingMs,40);assert.equal(range.trailingMs,80);
  assert(range.offset+range.duration>1.6); // Quiet ending remains, as does the interior pause.
  assert.equal(speechRange(buffer([new Float32Array(2000)])).duration,2);
});
test('joining counts provider padding and time waiting for synthesis instead of doubling the pause',()=>{
  const previous={endedAt:1000,trailingMs:80};
  assert.equal(joinDelay({pauseBeforeMs:160,leadingMs:40},previous,1000),40);
  assert.equal(joinDelay({pauseBeforeMs:300,leadingMs:40},previous,1000),180);
  assert.equal(joinDelay({pauseBeforeMs:300,leadingMs:40},previous,1300),0);
  assert.equal(joinDelay({},null,0),0);
});
