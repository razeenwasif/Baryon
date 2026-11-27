import test from 'node:test';
import assert from 'node:assert/strict';
import {solveQuizWithCodex,QUIZ_MODEL} from '../desktop/quiz-provider.mjs';
const observation={snapshot:{url:'data:image/png;base64,dGVzdA==',width:1280,height:800}};
test('quiz uses Astra with only the quiz image and instructions, independent of chat settings',async()=>{
 let args;const codex={turn:async input=>{args=input;return '{"kind":"yes_no","answer":"Y","question":"Is two even?","confident":true}';}};
 const result=await solveQuizWithCodex({codex,observation});assert.match(result,/"Y"/);
 assert.equal(QUIZ_MODEL,'gpt-6-astra');assert.deepEqual(args.settings,{model:'gpt-6-astra',reasoning:'low'});assert.equal(args.webSearch,false);assert.deepEqual(args.tools,[]);
 assert.equal(args.input.length,2);assert.equal(args.input[1].url,observation.snapshot.url);assert.match(args.instructions,/No reasoning/);assert.match(args.instructions,/practice quiz embedded in a chat or search page is a valid quiz/);
 assert.match(args.instructions,/1-based position from top to bottom/);assert.match(args.instructions,/Count complete answer options, not wrapped text lines/);assert.match(args.instructions,/Binary formats take priority/);assert.match(args.instructions,/Never return option text or an excerpt/);assert.match(args.instructions,/selecting 20 must return position 2, not 20/);
 assert.equal(args.history,undefined);assert.equal(args.toolHandler,undefined);
});
test('quiz cancellation, invalid images and missing connection fail without a fallback',async()=>{
 let calls=0;const codex={turn:async()=>calls++};const controller=new AbortController();controller.abort();
 await assert.rejects(solveQuizWithCodex({codex,observation,signal:controller.signal}),{name:'AbortError'});
 await assert.rejects(solveQuizWithCodex({codex,observation:{snapshot:{}}}));
 await assert.rejects(solveQuizWithCodex({observation}),/Codex connection/);assert.equal(calls,0);
 const error=Error('Sign in with ChatGPT');await assert.rejects(solveQuizWithCodex({codex:{turn:async()=>{throw error;}},observation}),e=>e===error);
});
test('written support is explicit and keeps Astra, no tools and binary priority',async()=>{
 let args;await solveQuizWithCodex({codex:{turn:async value=>{args=value;return '{}';}},observation,writtenAnswers:true});
 assert.match(args.instructions,/"written"/);assert.match(args.instructions,/at most 1,200 characters/);
 assert.doesNotMatch(args.instructions,/For purely long-form questions/);
 assert.match(args.instructions,/one or two short, complete sentences/);
 assert.match(args.instructions,/justification still gets its usual short choice/);
 assert.match(args.input[0].text,/For a written question/);
 assert.deepEqual(args.tools,[]);assert.equal(args.settings.model,QUIZ_MODEL);assert.equal(args.webSearch,false);
});
test('written follow-ups require their own format, not earlier choices, and essential missing facts still abstain',async()=>{
 let args;await solveQuizWithCodex({codex:{turn:async value=>{args=value;return '{}';}},observation,writtenAnswers:true});
 assert.doesNotMatch(args.instructions,/No reasoning, prose/);
 assert.doesNotMatch(args.input[0].text,/No reasoning or explanation/);
 assert.match(args.instructions,/Written questions do not need choices/);
 assert.match(args.instructions,/reference to an earlier question alone is not a reason to abstain/);
 assert.match(args.instructions,/Do not invent a missing formula/);
 assert.match(args.instructions,/essential earlier data, a claim, a diagram/);
 assert.match(args.input[0].text,/Earlier questions never determine the current answer format/);
});

test('duplicate screenshots are removed without changing active viewport or prior-question attribution',async()=>{
 const a=observation.snapshot,b={...a,url:'data:image/png;base64,b3RoZXI='};let args;
 await solveQuizWithCodex({codex:{turn:async value=>{args=value;return '{}';}},observation:{text:'Question 2',snapshots:[a,a,b],currentFrame:1,previousQuestions:[{id:'1',text:'Question 1 setup',snapshots:[a,a]}]}});
 assert.deepEqual(args.input.filter(x=>x.type==='image').map(x=>x.url),[a.url,b.url,a.url]);
 assert.match(args.input[1].text,/current viewport is image 1/);
 assert.match(args.input.find(x=>x.text?.startsWith('EARLIER QUESTION')).text,/Its 1 image/);
 await assert.rejects(solveQuizWithCodex({codex:{turn:async()=>assert.fail('oversized input reached provider')},observation:{snapshots:Array(7).fill(a)}}),/Invalid question buffer/);
});
test('Claude Code quiz route sends the same images and instructions without tools, at low effort',async()=>{
 const {solveQuiz,QUIZ_CLAUDE_MODEL}=await import('../desktop/quiz-provider.mjs');
 let args;const claude={turn:async value=>{args=value;return '{"kind":"yes_no","answer":"Y"}';}};
 assert.match(await solveQuiz({provider:'claude',claude,codex:{turn:()=>assert.fail('Codex not used')},observation}),/"Y"/);
 assert.equal(QUIZ_CLAUDE_MODEL,'claude-opus-5-5');assert.deepEqual(args.settings,{claudeModel:'claude-opus-5-5'});assert.equal(args.effort,'low');
 assert.equal(args.tools,undefined);assert.equal(args.toolHandler,undefined);assert.equal(args.input[1].url,observation.snapshot.url);assert.match(args.instructions,/No reasoning/);
 await solveQuiz({provider:'claude',claude,claudeModel:'claude-sonnet-5-5',observation});assert.equal(args.settings.claudeModel,'claude-sonnet-5-5');
 await assert.rejects(solveQuiz({provider:'claude',codex:{turn:()=>assert.fail('No fallback')},observation}),/Claude Code connection/);
});
