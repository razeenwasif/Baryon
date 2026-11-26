import test from 'node:test';import assert from 'node:assert/strict';
import {QuizTarget,questionHeadings} from '../desktop/quiz-target.mjs';
const line=(text,y)=>({text,x:.1,y,width:.4,height:.025});
const a='This is the first question with sufficiently detailed context.';
const b='Its options and assumptions belong to the first question only.';
const raw={app:'Safari',pid:1,windowId:1,region:{x:0,y:.08,width:1,height:.9},text:'unused',lines:[line('Question 1',.15),line(a,.22),line(b,.3),line('Question 2',.55),line('The second question has different options.',.62)]};
test('OCR Question I and minor label damage still select the heading without changing mathematical text',()=>{
 for(const label of ['Question I','Question l','Question |','Queslion 1','Questlon 2']){
  const s=new QuizTarget({dwellMs:0});s.setAutomatic(false);
  const selected=s.select({...raw,lines:[line(label,.15),line(a,.22),line(b,.3)]},{x:.2,y:.16});
  assert.equal(selected.targetQuestion,label.endsWith('2')?'2':'1');
  assert(selected.text.includes(label));
 }
 assert.equal(questionHeadings([line('Question I think we should compare these values.',.15)]).length,0);
});
test('two vertical questions wait for a heading hover, then crop exactly one',()=>{
 let now=0;const s=new QuizTarget({now:()=>now});assert.equal(s.select(raw,{x:.9,y:.9}).targetPending,true);
 s.select(raw,{x:.2,y:.16});now=500;const selected=s.select(raw,{x:.2,y:.16});
 assert.equal(s.selected,'1');assert.match(selected.text,/first question/);assert(!selected.text.includes('Question 2'));assert(selected.region.y+selected.region.height<.55);
 const held=s.select(raw,{x:.8,y:.9});assert.equal(held.targetQuestion,'1');
 s.select(raw,{x:.2,y:.56});now+=500;assert.equal(s.select(raw,{x:.2,y:.56}).targetQuestion,'2');
});
test('references in body text do not select a question; hovering briefly does not commit',()=>{
 let now=0;const s=new QuizTarget({now:()=>now});s.select(raw,{x:.2,y:.16});now=200;s.select(raw,{x:.2,y:.22});now=800;assert.equal(s.select(raw,{x:.2,y:.22}).targetPending,true);assert.equal(s.selected,null);
});
test('selected heading can scroll away with corroborating overlap; jumps block',()=>{
 let now=0;const s=new QuizTarget({now:()=>now});s.select(raw,{x:.2,y:.16});now=500;s.select(raw,{x:.2,y:.16});
 const scroll={...raw,lines:[line(a,.1),line(b,.18),line('Question 2',.4),line('Other question',.5)]};
 const result=s.select(scroll,{x:.8,y:.8});assert.equal(result.targetQuestion,'1');assert.match(result.text,/^Question 1/);assert(!result.text.includes('Question 2'));
 assert.equal(s.select({...scroll,lines:[line('Unrelated unseen question content',.1),line('Question 2',.4)]},{x:.8,y:.8}).targetPending,true);
});
test('Auto, source change and expiry clear the lock; single-question automatic mode is unchanged',()=>{
 let now=0;const s=new QuizTarget({now:()=>now,dwellMs:0});s.select(raw,{x:.2,y:.16});assert.equal(s.selected,'1');
 s.select({...raw,windowId:2},{x:.8,y:.8});assert.equal(s.selected,null);
 s.select(raw,{x:.2,y:.16});now=120001;s.select(raw,{x:.8,y:.8});assert.equal(s.selected,null);
 s.setAutomatic(true);const single={...raw,lines:raw.lines.slice(0,3)};assert.equal(s.select(single,{x:.8,y:.8}),single);
});

test('manual mode waits even for one question, and auto resumes without a lock',()=>{
 const s=new QuizTarget({dwellMs:0}),single={...raw,lines:raw.lines.slice(0,3)};
 assert.equal(s.automatic,true);s.setAutomatic(false);
 assert.equal(s.select(single,{x:.8,y:.8}).targetPending,true);
 assert.equal(s.select(single,{x:.2,y:.16}).targetQuestion,'1');
 assert.equal(s.automatic,false);s.setAutomatic(true);
 assert.equal(s.selected,null);assert.equal(s.select(single,{x:.8,y:.8}),single);
 assert.throws(()=>s.setAutomatic('false'),/Invalid/);assert.equal(s.automatic,true);
});
test('heading selection switches to manual, which survives source and pause resets',()=>{
 const s=new QuizTarget({dwellMs:0});s.select(raw,{x:.2,y:.16});assert.equal(s.automatic,false);
 s.select({...raw,windowId:2,lines:raw.lines.slice(0,3)},{x:.8,y:.8});
 assert.equal(s.selected,null);assert.equal(s.waiting,true);assert.equal(s.automatic,false);
 s.clear();assert.equal(s.automatic,false);
 assert.equal(s.select({...raw,lines:[]},{x:.8,y:.8}).targetPending,true);
});

test('common heading formats and spatially split OCR labels preserve exact IDs',()=>{
 for(const text of ['Question 3 of 12','Question 3 / 12','Question 3 (2 points)','Question 3 1 pts','Question\u00a03:','Q. 3','Problem #3','Exercise 3b']){
  const heads=questionHeadings([line(text,.15)]);assert.equal(heads.length,1,text);assert.equal(heads[0].id,text.endsWith('3b')?'3b':'3');
 }
 const label={text:'Question',x:.1,y:.15,width:.08,height:.025};
 for(const number of [{text:'3',x:.19,y:.15,width:.02,height:.025},{text:'3',x:.1,y:.18,width:.02,height:.025}]){
  const heads=questionHeadings([label,number,line(a,.22),line('Question 4',.55)]);
  assert.deepEqual(heads.map(h=>h.id),['3','4']);assert(heads[0].line.height>=.025-1e-9);
  const s=new QuizTarget({dwellMs:0});s.setAutomatic(false);
  const selected=s.select({...raw,lines:[label,number,line(a,.22),line('Question 4',.55)]},{x:number.x+.01,y:number.y+.01});
  assert.equal(selected.targetQuestion,'3');assert(!selected.text.includes('Question 4'));
 }
});

test('body references, distant numbers, ambiguous split labels and overlapping hits never select',()=>{
 assert.equal(questionHeadings([line('Question 3 asks us to compare two values.',.15),line('Refer to Question 3',.2)]).length,0);
 const label={text:'Question',x:.1,y:.15,width:.08,height:.025};
 assert.equal(questionHeadings([label,{text:'3',x:.8,y:.15,width:.02,height:.025}]).length,0);
 assert.equal(questionHeadings([label,{text:'3',x:.19,y:.15,width:.02,height:.025},{text:'4',x:.205,y:.15,width:.02,height:.025}]).length,0);
 const s=new QuizTarget({dwellMs:0});s.setAutomatic(false);
 assert(s.select({...raw,lines:[line('Question 1',.15),line('Question 2',.17)]},{x:.2,y:.17}).targetPending);
 assert.equal(s.selected,null);
});

test('100 ms hover samples detect a dwell between slow scans and require a fresh confirmation',()=>{
 let now=0;const s=new QuizTarget({now:()=>now});s.setAutomatic(false);s.select(raw,{x:.9,y:.9});
 let ready=0;
 for(now=100;now<=600;now+=100)if(s.sampleHover({x:.2,y:.16}))ready++;
 assert.equal(ready,1);assert.equal(s.selected,null,'cached boxes must not commit a target');
 assert.equal(s.select(raw,{x:.2,y:.16}).targetQuestion,'1');
 assert(!s.sampleHover({x:.2,y:.16}),'holding the selected heading must not rescan');
});

test('a pass over the heading between scans restarts dwell instead of appearing continuous',()=>{
 let now=0;const s=new QuizTarget({now:()=>now});s.setAutomatic(false);s.select(raw,{x:.2,y:.16});
 now=200;assert(!s.sampleHover({x:.2,y:.16}));now=300;s.sampleHover({x:.8,y:.8});
 now=500;assert(s.select(raw,{x:.2,y:.16}).targetPending);
 now=800;assert(!s.sampleHover({x:.2,y:.16}));
 now=1000;assert(s.sampleHover({x:.2,y:.16}));assert.equal(s.select(raw,{x:.2,y:.16}).targetQuestion,'1');
});

test('a completed hover survives pointer departure during OCR but requires a capture after the gesture',()=>{
 let now=0;const s=new QuizTarget({now:()=>now});s.setAutomatic(false);s.select(raw,{x:.2,y:.16});
 now=500;assert(s.sampleHover({x:.2,y:.16}));assert.equal(s.selected,null);
 now=600;assert(s.select(raw,{x:.9,y:.9},{capturedAt:400}).targetPending);
 now=700;assert(s.sampleHover({x:.9,y:.9}),'verification retries if an earlier scan was already running');
 now=800;assert.equal(s.select(raw,{x:.9,y:.9},{capturedAt:750}).targetQuestion,'1');
 assert.equal(s.pendingHover,null);assert(!s.sampleHover({x:.9,y:.9}));
});

test('fresh confirmation rejects stale heading coordinates, scrolling and a foreground switch',()=>{
 for(const change of ['scroll','source','gone']){
  let now=0;const s=new QuizTarget({now:()=>now});s.setAutomatic(false);s.select(raw,{x:.2,y:.16});
  now=500;assert(s.sampleHover({x:.2,y:.16}));
  const moved=change==='scroll'?{...raw,lines:raw.lines.map(l=>({...l,y:l.y+.12}))}:change==='source'?{...raw,windowId:2}:{...raw,lines:[]};
  assert(s.select(moved,{x:.2,y:.16}).targetPending);assert.equal(s.selected,null,change);
 }
 let now=0;const s=new QuizTarget({now:()=>now});s.select(raw,{x:.2,y:.16});now=2501;
 assert(!s.sampleHover({x:.2,y:.16}));assert.equal(s.hover,null);
});

test('display-relative hit padding works on offset displays and tolerates small OCR jitter',()=>{
 let now=0;const bounds={x:-1920,y:-300,width:1920,height:1080};
 const s=new QuizTarget({now:()=>now});s.setAutomatic(false);
 s.select(raw,{x:.9,y:.9},{bounds});
 const point={x:bounds.x+.1*bounds.width-10,y:bounds.y+.16*bounds.height};
 assert(!s.sampleScreenPoint(point));now=500;assert(s.sampleScreenPoint(point));
 const jitter={...raw,lines:raw.lines.map(l=>({...l,x:l.x+.0005,y:l.y+.001}))};
 assert.equal(s.select(jitter,{x:(point.x-bounds.x)/bounds.width,y:.16},{bounds}).targetQuestion,'1');
 s.clear();assert(!s.sampleScreenPoint(point));
});

test('hover detection has a bounded delay across every 25 ms phase of a 1.5 s scan cycle',()=>{
 for(let phase=0;phase<1500;phase+=25){
  let now=0;const s=new QuizTarget({now:()=>now});s.setAutomatic(false);s.select(raw,{x:.9,y:.9});
  let requestedAt;
  for(now=0;now<=phase+650;now+=100){
   const cursor=now>=phase?{x:.2,y:.16}:{x:.9,y:.9};
   if(s.sampleHover(cursor)){requestedAt=now;break;}
  }
  assert(requestedAt!==undefined,`missed hover at phase ${phase}`);
  assert(requestedAt-phase>=450&&requestedAt-phase<650);
  assert.equal(s.selected,null);
  assert.equal(s.select(raw,{x:.2,y:.16}).targetQuestion,'1');
 }
});
