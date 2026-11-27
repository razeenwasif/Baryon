import test from 'node:test';
import assert from 'node:assert/strict';
import {QuizMonitor,quizFingerprint} from '../desktop/quiz.mjs';
import {solveQuizWithCodex} from '../desktop/quiz-provider.mjs';
const text='Question 1\nWhat is six times seven?\nA. 36\nB. 42\nC. 48\nD. 56';
const observation=(value=text)=>({text:value,app:'com.apple.Safari',pid:1,windowId:1,windowTitle:'Practice',snapshot:{url:'data:image/png;base64,Zml4dHVyZQ==',width:1280,height:800}});
const answer=JSON.stringify({kind:'choice',question:'What is six times seven?',answer:'B',confident:true});
function fixture(solver=async()=>answer,options={}){
 let now=0,current=observation(),calls=0,reads=0;const shown=[];
 const monitor=new QuizMonitor({...options,now:()=>now,allowed:()=>true,publish:v=>shown.push(v),observe:async()=>{reads++;return current;},solve:async(...args)=>{calls++;return solver(...args);}});
 monitor.enable(true);
 return {monitor,shown,advance:v=>now+=v,current:v=>current=v,calls:()=>calls,reads:()=>reads,async start(){await monitor.tick();now+=250;await monitor.tick();},async ready(){await this.start();await monitor.job;}};
}
test('new stable questions do not inherit the former fifteen-second wait',async()=>{
 const f=fixture();await f.ready();assert.equal(f.calls(),1);
 f.current(observation(text.replace('Question 1','Question 2').replace('seven','eight')));
 await f.monitor.tick();assert.equal(f.shown.at(-1),'B');f.advance(250);await f.monitor.tick();assert.equal(f.shown.at(-1),'');
 f.advance(950);await f.monitor.tick();await f.monitor.job;assert.equal(f.calls(),2);
});
test('inline and split timers and hint buttons leave the question fingerprint stable',()=>{
 const withTimer=n=>observation(text+'\nTime remaining\n00:12:'+n+'\nShow hint\nNext question');
 assert.equal(quizFingerprint(withTimer('31')),quizFingerprint(withTimer('30')));
 assert.equal(quizFingerprint(observation(text+'\nTime remaining: 12:31')),quizFingerprint(observation(text+'\nTime remaining: 12:30')));
 assert.notEqual(quizFingerprint(observation(text.replace('42','43'))),quizFingerprint(observation(text)));
 assert.notEqual(quizFingerprint(observation('Which time is earlier?\nA. 12:30\nB. 12:31')),quizFingerprint(observation('Which time is earlier?\nA. 12:32\nB. 12:31')));
});
test('hint survives timer changes and buffer expiry without repeated solving',async()=>{
 const f=fixture();f.current(observation(text+'\nTime remaining: 12:31'));await f.ready();
 for(let i=0;i<5;i++){f.advance(1000);f.current(observation(text+'\nTime remaining: 12:'+(30-i)));await f.monitor.tick();}
 assert.deepEqual(f.shown,['','B']);assert.equal(f.calls(),1);
 f.advance(121000);await f.monitor.tick();assert.equal(f.monitor.buffer.frames.length,0);assert.equal(f.shown.at(-1),'B');assert.equal(f.calls(),1);
});
test('a single OCR glitch neither cancels an in-flight request nor clears a verified hint',async()=>{
 let resolve;const waiting=new Promise(r=>resolve=r);const f=fixture(()=>waiting);await f.start();
 f.advance(500);f.current(observation(text.replace('seven','sever')));await f.monitor.tick();assert.equal(f.monitor.controller.signal.aborted,false);
 f.advance(500);f.current(observation());await f.monitor.tick();resolve(answer);await f.monitor.job;
 assert.equal(f.shown.at(-1),'B');assert.equal(f.calls(),1);assert.equal(f.monitor.state().counts.cancelled,0);
 f.advance(500);f.current(observation(text.replace('42','4Z')));await f.monitor.tick();assert.equal(f.shown.at(-1),'B');
 f.advance(500);f.current(observation());await f.monitor.tick();assert.deepEqual(f.shown,['','B']);
});
test('confirmed changed options invalidate the hint and cancel pending work',async()=>{
 let resolve;const waiting=new Promise(r=>resolve=r);const f=fixture(()=>waiting);await f.start();const job=f.monitor.job;
 f.current(observation(text.replace('B. 42\nC. 48','B. 48\nC. 42')));f.advance(500);await f.monitor.tick();f.advance(250);await f.monitor.tick();
 assert.equal(f.monitor.controller.signal.aborted,true);resolve(answer);await job;assert(!f.shown.includes('B'));assert.equal(f.monitor.state().thinking,false);
});
test('current foreground changes clear hints immediately and an exact return uses cache',async()=>{
 const f=fixture();await f.ready();f.current({...observation(),app:'other.app'});await f.monitor.tick();assert.equal(f.shown.at(-1),'');
 f.current(observation());await f.monitor.tick();f.advance(250);await f.monitor.tick();await f.monitor.job;
 assert.equal(f.shown.at(-1),'B');assert.equal(f.calls(),1);assert.equal(f.monitor.state().counts.cacheHits,1);
});
test('a transient failed request retries once instead of caching a permanent blank',async()=>{
 let attempts=0;const f=fixture(async()=>{if(!attempts++)throw Error('Temporary server failure');return answer;});
 await f.ready();assert.match(f.monitor.status,/Retrying/);assert.equal(f.monitor.state().thinking,false);
 f.advance(1999);await f.monitor.tick();assert.equal(f.calls(),1);f.advance(1);await f.monitor.tick();await f.monitor.job;
 assert.equal(f.shown.at(-1),'B');assert.equal(f.calls(),2);assert.equal(f.monitor.state().counts.retries,1);
});
test('abstentions wait for new evidence rather than spending a second request',async()=>{
 const f=fixture(async()=>'{"kind":"none","answer":"","confident":false}');await f.ready();f.advance(2000);await f.monitor.tick();await f.monitor.job;
 assert.equal(f.calls(),1);assert.match(f.monitor.status,/No confident quiz answer/);assert.equal(f.monitor.state().thinking,false);
 for(let i=0;i<5;i++){f.advance(10000);await f.monitor.tick();}assert.equal(f.calls(),1);
});
test('a timed-out request ends thinking and retries with a bounded deadline',async()=>{
 let calls=0;const f=fixture((_raw,signal)=>++calls===1?new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})):Promise.resolve(answer),{timeoutMs:20});
 // The real timer is deliberately kept alive by this test, not by background work.
 const keepAlive=setTimeout(()=>{},1000);
 try{await f.ready();assert.match(f.monitor.status,/timed out/);assert.equal(f.monitor.state().thinking,false);f.advance(2000);await f.monitor.tick();await f.monitor.job;assert.equal(f.shown.at(-1),'B');}finally{clearTimeout(keepAlive);}
});
test('authentication and rate-limit failures do not trigger automatic retries',async()=>{
 for(const message of ['Sign in with ChatGPT','Rate limited']){
  const f=fixture(async()=>{throw Error(message);});await f.ready();f.advance(30000);await f.monitor.tick();assert.equal(f.calls(),1);assert.match(f.monitor.status,/Quiz paused/);
 }
});
test('a recent independent observation avoids a second OCR pass after inference',async()=>{
 let resolve;const waiting=new Promise(r=>resolve=r);const f=fixture(()=>waiting);await f.start();f.advance(1000);await f.monitor.tick();const reads=f.reads();resolve(answer);await f.monitor.job;
 assert.equal(f.reads(),reads);assert.equal(f.shown.at(-1),'B');assert.equal(f.monitor.state().timings.verifyMs,0);
});
test('concurrent OCR consumers share one operation',async()=>{
 let resolve;const waiting=new Promise(r=>resolve=r);let calls=0;
 const monitor=new QuizMonitor({observe:async()=>{calls++;return waiting;},solve:async()=>answer,allowed:()=>true,publish(){}});
 const a=monitor.read(),b=monitor.read();await Promise.resolve();assert.equal(calls,1);resolve(observation());assert.deepEqual(await a,await b);
});
test('provider progress records first text without exposing partial answers as hints',async()=>{
 let progress=0;
 await solveQuizWithCodex({observation:observation(),onText:()=>progress++,codex:{turn:async args=>{args.onText('{"kind":');return answer;}}});
 assert.equal(progress,1);
});
test('timing diagnostics contain durations and counters, not question content or screenshots',async()=>{
 const f=fixture(async(_raw,_signal,onText)=>{f.advance(1000);onText('partial');f.advance(400);return answer;});await f.ready();
 const state=f.monitor.state();assert.equal(state.timings.modelMs,1400);assert.equal(state.timings.firstTextMs,1000);assert.equal(state.counts.requests,1);
 assert(!JSON.stringify(state).includes('six times seven'));assert(!JSON.stringify(state).includes('data:image'));assert.equal(state.thinking,false);
});

test('scrolling to an unchanged literal portion of the answered question retains its hint',async()=>{
 const f=fixture();await f.ready();f.current(observation('What is six times seven?\nA. 36\nB. 42\nC. 48\nD. 56'));
 await f.monitor.tick();f.advance(1500);await f.monitor.tick();assert.equal(f.shown.at(-1),'B');assert.equal(f.calls(),1);
 f.current(observation('What is six times eight?\nA. 36\nB. 42\nC. 48\nD. 56'));await f.monitor.tick();f.advance(250);await f.monitor.tick();assert.equal(f.shown.at(-1),'');
});

test('continuous scroll changes defer model requests until the latest view settles',async()=>{
 const f=fixture(async()=>answer,{requestSettleMs:650});await f.start();assert.equal(f.calls(),0);
 for(let i=2;i<=5;i++){f.advance(250);f.current(observation(text.replace('Question 1',`Question ${i}`)));await f.monitor.tick();f.advance(200);await f.monitor.tick();assert.equal(f.calls(),0);}
 f.advance(449);await f.monitor.tick();assert.equal(f.calls(),0);f.advance(1);await f.monitor.tick();await f.monitor.job;assert.equal(f.calls(),1);
});


test('settled answers reduce polling, while changed views and model work stay responsive',()=>{
 let now=0;const m=new QuizMonitor({now:()=>now,observe:async()=>null,solve:async()=>'',allowed:()=>true,publish:()=>{}});
 m.changedViewAt=0;m.shown='p2';assert.equal(m.nextPollMs(500),500);now=3001;
 assert.equal(m.nextPollMs(500),1500);assert.equal(m.nextPollMs(1000),1500);
 m.candidate={key:'new'};assert.equal(m.nextPollMs(500),500);m.candidate=null;
 m.job=Promise.resolve();assert.equal(m.nextPollMs(500),500);m.job=null;
 assert.equal(m.nextPollMs(0),0);m.shown='';assert.equal(m.nextPollMs(500),500);
});


test('a transient new viewport cannot enter the answer cache of an in-flight question',async()=>{
 let resolve;const waiting=new Promise(r=>resolve=r);const f=fixture(()=>waiting);
 const original={...observation(),visualKey:'original-view'};f.current(original);await f.start();
 f.current({...observation(text.replace('Question 1','Question 2')),visualKey:'transient-other-question'});f.advance(300);await f.monitor.tick();
 f.current(original);f.advance(300);await f.monitor.tick();resolve(answer);await f.monitor.job;
 assert.equal(f.monitor.answered.entries.length,1);
 assert.deepEqual(f.monitor.answered.entries[0].visualKeys,['original-view']);
});
