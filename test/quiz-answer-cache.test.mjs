import {test} from 'node:test';import assert from 'node:assert/strict';
import {QuizAnswerCache} from '../desktop/quiz-answer-cache.mjs';
import {QuizMonitor,parseQuizAnswer} from '../desktop/quiz.mjs';
import {QuestionHistory} from '../desktop/question-history.mjs';
const a='The objective function is convex and differentiable everywhere on the feasible domain.';
const b='Choose the conclusion that must hold under the assumptions stated in the question.';
const c='A. The value decreases monotonically. B. The value increases on every iteration.';
const raw=(id,body)=>({text:`Question ${id}\n${body}`,app:'com.apple.Safari',pid:1,windowId:2,snapshot:{url:'fixture'}});
const full=raw(1,[a,b,c].join('\n'));const history={entries:[]};
test('newly captured shared graphs invalidate answers made without them, and changed graphs invalidate dependencies',()=>{
 const h=new QuestionHistory(),cache=new QuizAnswerCache();
 const current={...raw(5,'In the feasible region described above, which vertex is optimal?'),visualKey:'q5'};
 cache.remember('without-setup','A',current);
 const setup={...raw(1,'For this question and questions 2 to 7, consider the feasible region in this graph.'),visualKey:'graph-a',snapshot:{url:'graph-a',visualKey:'graph-a'}};
 h.remember(setup);assert.equal(cache.find(current,h),null);
 cache.clear();cache.remember('with-setup','B',h.attach(current));assert.equal(cache.find(current,h)?.answer,'B');
 h.remember({...setup,visualKey:'graph-b',snapshot:{url:'graph-b',visualKey:'graph-b'}});
 assert.equal(cache.find(current,h),null);
});
test('successful cache recognizes exact revisits and ordered scrolling fragments, without images',()=>{
 const cache=new QuizAnswerCache();cache.remember('key','A',full);
 assert.equal(cache.find(full,history).answer,'A');
 assert.equal(cache.find({...full,text:[b,c].join('\n')},history).answer,'A');
 assert.equal(cache.find({...full,text:[c,b].join('\n')},history),null);
 assert.equal(cache.find({...full,text:full.text.replace('decreases','does not decrease')},history),null);
 assert.equal(cache.find({...full,text:full.text.replace('Question 1','Question 2')},history),null);
 assert.equal(cache.find({...full,windowId:99},history),null);
 assert(!JSON.stringify(cache.entries).includes('fixture'));
});
test('ambiguous fragments, changed dependencies and newly available sources cannot reuse answers',()=>{
 const cache=new QuizAnswerCache();cache.remember('one','A',full);cache.remember('two','B',raw(2,[a,b,c].join('\n')));
 assert.equal(cache.find({...full,text:[b,c].join('\n')},history),null);
 const question=raw(3,'Using question 1, explain why this conclusion follows from the given constraints.');
 cache.remember('three',{written:'Explanation.'},{...question,previousQuestions:[{id:'1',text:full.text,snapshots:[{url:'original pixels'}]}]});
 assert.equal(cache.find(question,{entries:[{id:'1',text:full.text,snapshots:[{url:'different pixels'}]}]}),null);
 assert.equal(cache.find(question,{entries:[{id:'1',text:full.text.replace('convex','nonconvex')}]}),null);
 cache.clear();cache.remember('three',{written:'Explanation.'},question);
 assert.equal(cache.find(question,{entries:[{id:'1',text:full.text}]}),null);
});
test('answered cache is bounded, expires and never stores abstentions',()=>{
 let now=0;const cache=new QuizAnswerCache({now:()=>now,maxEntries:2,ttl:50});
 for(let i=1;i<=3;i++)cache.remember(String(i),'A',raw(i,a));
 assert.equal(cache.entries.length,2);cache.remember('none','',full);assert.equal(cache.entries.length,2);
 now=50;assert.equal(cache.find(raw(3,a),history),null);assert.equal(cache.entries.length,0);
});
test('scrolling and revisiting answered questions makes no additional model calls or clipboard writes',async()=>{
 let current=full,now=0,calls=0,copies=0;const shown=[];
 const monitor=new QuizMonitor({now:()=>now,observe:async()=>current,allowed:()=>true,publish:v=>shown.push(v),copyWritten:()=>copies++,parseAnswer:t=>parseQuizAnswer(t,{writtenAnswers:true}),solve:async()=>{calls++;return JSON.stringify({kind:'written',answer:'One short explanation.',question:'Explain.',confident:true})}});
 monitor.enable(true);
 const visit=async value=>{current=value;now+=2000;await monitor.tick();now+=250;await monitor.tick();await monitor.job;};
 await visit(full);await visit(raw(2,'Explain an unrelated problem about integer points and their convex hull.'));
 assert.equal(calls,2);assert.equal(copies,2);monitor.copied.clear(); // Simulate delivery-map eviction.
 await visit({...full,text:[b,c].join('\n')});await visit(full);await visit({...full,text:[a,b].join('\n')});await visit(full);
 assert.equal(calls,2);assert.equal(copies,2);assert.equal(shown.at(-1),'star');
 await visit({...full,text:full.text.replace('convex','not convex')});assert.equal(calls,3);
 monitor.enable(false);assert.equal(monitor.answered.entries.length,0);
});
test('scroll fragments cannot confuse shortened numbers or missing words with old content',()=>{
 const cache=new QuizAnswerCache();cache.remember('one','B',raw(1,[a,b,'The final bound is 10'].join('\n')));
 assert.equal(cache.find({...full,text:[a,b,'The final bound is 1'].join('\n')},history),null);
 assert.equal(cache.find({...full,text:[a,b,'The final bound is'].join('\n')},history),null);
});

test('identical OCR with a changed diagram invalidates both displayed and cached answers',async()=>{
 let current={...full,visualKey:'graph-a'},now=0,calls=0;const monitor=new QuizMonitor({now:()=>now,observe:async()=>current,allowed:()=>true,publish:()=>{},solve:async()=>{calls++;return '{"kind":"choice","answer":"A","confident":true,"question":"Graph"}'}});
 monitor.enable(true);const visit=async raw=>{current=raw;now+=2000;await monitor.tick();now+=250;await monitor.tick();await monitor.job;};
 await visit(current);assert.equal(calls,1);
 await visit({...full,visualKey:'graph-b'});assert.equal(calls,2);
 await visit({...full,visualKey:'graph-a'});assert.equal(calls,2);
 monitor.enable(false);
});


test('identical question pixels reuse an answer despite OCR-only spelling changes',()=>{
 const cache=new QuizAnswerCache();const original={...full,visualKey:'exact-question-pixels'};
 cache.remember('original','A',original);
 const reread={...original,text:original.text.replace('convex','c0nvex')};
 assert.equal(cache.find(reread,history)?.answer,'A');
 assert.equal(cache.find({...reread,visualKey:'edited-formula'},history),null);
});
test('prerequisite pixels keep dependencies stable across OCR refreshes, but changed diagrams invalidate',()=>{
 const cache=new QuizAnswerCache();const current={...raw(2,'Explain your answer to question 1 using its complete setup.'),visualKey:'follow-up'};
 const earlier={id:'1',text:full.text,snapshots:[{url:'image',visualKey:'source-pixels'}]};
 cache.remember('answer',{written:'Concise explanation.'},{...current,previousQuestions:[earlier]});
 assert(cache.find(current,{entries:[{...earlier,text:earlier.text.replace('convex','c0nvex')}]}));
 assert.equal(cache.find(current,{entries:[{...earlier,snapshots:[{url:'changed',visualKey:'changed-diagram'}]}]}),null);
});
test('duplicate OCR versions of the same visual answer do not make a revisit ambiguous',()=>{
 const cache=new QuizAnswerCache(),original={...full,visualKey:'same-pixels'};
 cache.remember('first','A',original);cache.remember('second','A',{...original,text:original.text.replace('convex','c0nvex')});
 assert.equal(cache.find(original,history)?.answer,'A');
 cache.remember('conflicting','B',original);assert.equal(cache.find(original,history),null);
});
