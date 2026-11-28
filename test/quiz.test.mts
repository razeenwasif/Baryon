import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QuizMonitor, parseQuizAnswer, parseQuizSymbols, quizFingerprint } from '../desktop/quiz.mjs';
import { QuizOverlay } from '../desktop/quiz-overlay.mjs';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const result = (answer: string) => JSON.stringify({ kind: 'choice', question: 'What is six times seven?', answer, confident: true });
const obs = (text?: string) => ({ text: text || 'What is six times seven? A. 36 B. 42 C. 48 D. 56', app: 'com.apple.Safari', snapshot: { url: 'fixture' } });
const deferred = () => { let resolve!: (value?: any) => void; const promise = new Promise<any>(r => { resolve = r; }); return { promise, resolve }; };
function fixture(solve: (...args: any[]) => Promise<string> = async () => result('B'), options: any = {}) {
  let now = 0, current: any = obs(), allowed = true; const shown: string[] = []; let calls = 0;
  const monitor = new QuizMonitor({ ...options, now: () => now, observe: async () => current, allowed: () => allowed, publish: text => shown.push(text), solve: async (...args) => { calls++; return solve(...args); } });
  monitor.enable(true);
  return { monitor, shown, advance: (ms: number) => { now += ms; }, change: (value: any) => { current = value; }, allow: (value: boolean) => { allowed = value; }, calls: () => calls };
}
test('choice output is bounded text only; abstentions and reasoning never become hints', () => {
  assert.equal(parseQuizAnswer(result('B')), 'B'); assert.equal(parseQuizAnswer(result('B, D')), 'B, D');
  assert.throws(() => parseQuizAnswer(result('Mars')), /short choice/);
  assert.equal(parseQuizAnswer(result('2')), '2');
  assert.equal(parseQuizAnswer(result('Yes')), 'Y');
  assert.equal(parseQuizAnswer(result('No')), 'N');
  assert.equal(parseQuizAnswer('{"kind":"none","answer":"","confident":false}'), '');
  assert.equal(parseQuizAnswer(result('A').replace('true','false')), '');
  for (const text of ['B because 6 times 7 is 42', 'B\nHere is why', '<script>alert(1)</script>', 'x'.repeat(61)]) assert.throws(() => parseQuizAnswer(result(text)), /short choice/);
  assert.throws(() => parseQuizAnswer('B is correct.'), /invalid/);
});
test('question keys retain changed numbers and option order but ignore labeled timers', () => {
  const a = obs(); assert.notEqual(quizFingerprint(a), quizFingerprint(obs(a.text.replace('seven', 'eight'))));
  assert.notEqual(quizFingerprint(a), quizFingerprint(obs(a.text.replace('B. 42 C. 48', 'B. 48 C. 42'))));
  assert.equal(quizFingerprint(obs(a.text+'\nTime remaining: 12:31')), quizFingerprint(obs(a.text+'\nTime remaining: 12:30')));
  assert.notEqual(quizFingerprint(obs('Which is earlier? A. 12:30 B. 12:31')), quizFingerprint(obs('Which is earlier? A. 12:32 B. 12:31')));
  assert.equal(quizFingerprint({ ...a, app: 'dev.razeen.stella' }), '');
});
test('exact question pixels tolerate OCR drift but changed pixels, source and manual target invalidate the view',()=>{
 const original={...obs(),visualKey:'same-source-pixels',targetQuestion:'1'};
 const drift={...original,text:original.text.replace('seven','5even')};
 assert.equal(quizFingerprint(original),quizFingerprint(drift));
 for(const change of [{visualKey:'changed-graph'},{windowId:2},{targetQuestion:'2'}])assert.notEqual(quizFingerprint(original),quizFingerprint({...drift,...change}));
});
test('OCR drift on identical pixels does not discard a completed model answer',async()=>{
 const original={...obs(),visualKey:'unchanged-question'};
 const f=fixture(async()=>{f.change({...original,text:original.text.replace('seven','5even')});return result('B');});
 f.change(original);await f.monitor.tick();f.advance(2000);await f.monitor.tick();await f.monitor.job;
 assert.equal(f.shown.at(-1),'B');assert.equal(f.monitor.status,'Choice ready');assert.equal(f.calls(),1);
 f.monitor.enable(false);
});
test('binary answers normalize to one letter and never accept another answer family or explanations',()=>{
  const binary=(kind:string,answer:string,confident=true)=>JSON.stringify({kind,answer,confident,question:'Is it the case that two is even?'});
  for(const [kind,answer,expected] of [['yes_no','Yes','Y'],['yes_no','n','N'],['true_false','true','T'],['true_false','F','F']])assert.equal(parseQuizAnswer(binary(kind,answer)),expected);
  for(const [kind,answer] of [['yes_no','T'],['true_false','Y'],['yes_no','Y/N'],['true_false','T, F'],['yes_no','Yes, it is'],['true_false','True because it is even'],['true_false','True\nExplanation']])assert.throws(()=>parseQuizAnswer(binary(kind,answer)));
  assert.equal(parseQuizAnswer(binary('yes_no','Y',false)),'');
  assert.equal(parseQuizAnswer(binary('true_false','F',false)),'');
});
test('binary hints share the existing cache and clear when a different question appears',async()=>{
  let answer={kind:'yes_no',question:'Is it the case that 7 is a prime number?',answer:'Y',confident:true};
  const f=fixture(async()=>JSON.stringify(answer));
  f.change(obs(answer.question));await f.monitor.tick();f.advance(2000);await f.monitor.tick();await f.monitor.job;
  assert.equal(f.shown.at(-1),'Y');f.advance(15000);await f.monitor.tick();assert.equal(f.calls(),1);
  answer={kind:'true_false',question:'True or false: 9 is a prime number.',answer:'F',confident:true};
  f.change(obs(answer.question));await f.monitor.tick();f.advance(250);await f.monitor.tick();assert.equal(f.shown.at(-1),'');
  f.advance(2000);await f.monitor.tick();await f.monitor.job;assert.equal(f.shown.at(-1),'F');
  f.change(obs('Explain how prime numbers are distributed.'));await f.monitor.tick();f.advance(250);await f.monitor.tick();assert.equal(f.shown.at(-1),'');
});
test('stable question is solved once, cached and displayed without speech or chat history', async () => {
  const f = fixture(); await f.monitor.tick(); assert.equal(f.calls(), 0);
  f.advance(2000); await f.monitor.tick(); await f.monitor.job;
  assert.equal(f.shown.at(-1), 'B'); assert.equal(f.calls(), 1);
  f.advance(30000); await f.monitor.tick(); assert.equal(f.calls(), 1);
  f.change(obs('Explain your answer to this new long form question.')); await f.monitor.tick(); f.advance(250); await f.monitor.tick(); assert.equal(f.shown.at(-1), '');
});
test('changing question during inference cancels and never displays the stale choice', async () => {
  const waiting = deferred(); const f = fixture(() => waiting.promise);
  await f.monitor.tick(); f.advance(2000); await f.monitor.tick(); const job = f.monitor.job;
  f.change(obs('Which planet is red? A. Venus B. Jupiter C. Mars D. Earth'));
  await f.monitor.tick(); waiting.resolve(result('B')); await job;
  assert(!f.shown.includes('B'));
});
test('post-inference observation prevents a stale answer even before the next timer tick', async () => {
  const f = fixture(async () => { f.change(obs('A different question with different options A. One B. Two')); return result('B'); });
  await f.monitor.tick(); f.advance(2000); await f.monitor.tick(); await f.monitor.job;
  assert(!f.shown.includes('B'));
});
test('pause, disable and foreground interruption discard pending answers', async () => {
  for (const method of ['pause', 'disable', 'interrupt']) {
    const waiting = deferred(); const f = fixture(() => waiting.promise);
    await f.monitor.tick(); f.advance(2000); await f.monitor.tick(); const job = f.monitor.job;
    if (method === 'pause') { f.allow(false); await f.monitor.tick(); }
    else if (method === 'disable') f.monitor.enable(false);
    else void f.monitor.interrupt();
    waiting.resolve(result('B')); await job; assert(!f.shown.includes('B'));
  }
});
test('long-form/uncertain screens stay blank and screen changes respect the rate limit', async () => {
  const f = fixture(async () => '{"kind":"none","answer":"","confident":false}',{cooldown:15000});
  await f.monitor.tick(); f.advance(2000); await f.monitor.tick(); await f.monitor.job;
  assert.equal(f.shown.at(-1), '');
  f.change(obs('A new question: what is two plus two? A. Four B. Five')); await f.monitor.tick();
  f.advance(2000); await f.monitor.tick(); assert.equal(f.calls(), 1);
  f.advance(15000); await f.monitor.tick(); await f.monitor.job; assert.equal(f.calls(), 2);
});
test('native menu icon starts at launch, stays available when idle and closes the input on quit', () => {
  let starts = 0, failures = 0; const child: any = new EventEmitter(); child.stdin = new PassThrough(); const messages: any[] = [];
  child.stdin.on('data', (data: Buffer) => messages.push(JSON.parse(data.toString())));
  const overlay = new QuizOverlay({ onError: () => failures++, spawnProcess: (exe, args, options) => {
    starts++; assert(exe.endsWith('fairy-quiz-overlay'));
    assert.equal(args.length, 1); assert(args[0].endsWith('assets/tray/trayTemplate.png'));
    assert.deepEqual(options.stdio, ['pipe', 'pipe', 'ignore']); return child;
  } });
  overlay.start(); overlay.start(); assert.equal(starts, 1);
  overlay.show('', 1);
  overlay.show('p2', 1); overlay.show('p3', 1); overlay.hide();
  assert.equal(starts, 1); assert.deepEqual(messages.map(v => v.text), ['', 'p2', 'p3', '']);
  overlay.close(); assert(child.stdin.writableEnded);
  child.emit('close'); assert.equal(failures, 0);
  assert.throws(() => overlay.show('B', 'untrusted' as any), /Invalid/);
});
test('native bird menu routes bounded actions, replays menu state and ignores stale helpers', () => {
  const children: any[] = [], actions: string[] = []; let ready = 0, failures = 0;
  const overlay = new QuizOverlay({ onReady: () => ready++, onAction: id => actions.push(id), onError: () => failures++, spawnProcess: () => {
    const child: any = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough();
    child.messages = []; child.stdin.on('data', (data: Buffer) => child.messages.push(JSON.parse(String(data))));
    children.push(child); return child;
  } });
  const menu = [{id:'show', label:'Hide Fairy'}, {type:'separator'}, {id:'mute', label:'Mute voice', type:'checkbox', checked:true}, {id:'quit', label:'Quit Fairy'}];
  overlay.setMenu(menu as any, 'Fairy · muted'); overlay.start();
  const first = children[0]; assert.equal(first.messages.length, 1);
  assert.equal(first.messages[0].menu[2].checked, true);
  overlay.setMenu(menu as any, 'Fairy · muted'); assert.equal(first.messages.length, 1);
  first.stdout.write('{"rea'); first.stdout.write('dy":true}\n{"ready":true}\n'); assert.equal(ready, 1);
  first.stdout.write('bad-json\nnull\n{"action":"unknown"}\n{"action":"quit","padding":"'+'x'.repeat(4096)+'"}\n');
  first.stdout.write('{"action":"show"}\n{"action":"mute"}\n'); assert.deepEqual(actions, ['show', 'mute']);
  first.emit('close'); assert.equal(failures, 1); first.emit('error', new Error('late')); assert.equal(failures, 1);
  overlay.start(); assert.equal(children[1].messages[0].tooltip, 'Fairy · muted');
  first.stdout.write('{"action":"quit"}\n'); assert.deepEqual(actions, ['show', 'mute']);
  children[1].stdout.write('{"ready":true}\n{"action":"quit"}\n'); assert.equal(ready, 2); assert.equal(actions.at(-1), 'quit');
  assert.throws(() => overlay.setMenu([{id:'untrusted', label:'Run something'}] as any, 'Fairy'), /Invalid/);
  overlay.close(); children[1].emit('close'); assert.equal(failures, 1);
});
test('model failure remains visible in the toggle status and does not loop provider requests', async () => {
  const f = fixture(() => { throw new Error('Rate limited'); });
  await f.monitor.tick(); f.advance(2000); await f.monitor.tick(); await f.monitor.job;
  assert.equal(f.monitor.job, null); assert.match(f.monitor.status, /Rate limited/);
  f.advance(30000); await f.monitor.tick(); assert.equal(f.calls(), 1); assert.match(f.monitor.status, /Rate limited/);
});

test('unlabeled options use positive top-to-bottom positions, never answer excerpts',()=>{
  const position=(answer:string)=>JSON.stringify({kind:'position',question:'Which planet is red?',answer,confident:true});
  for(const [answer,expected] of [['2','2'],['1,3','1, 3'],['12','12']])assert.equal(parseQuizAnswer(position(answer)),expected);
  for(const answer of ['0','-1','2.5','02','second','Mars','2, 2','2,','A','1 / 3'])assert.throws(()=>parseQuizAnswer(position(answer)),/choice/);
});
test('position hints are shown and invalidated when unlabeled options change order',async()=>{
  const f=fixture(async()=>JSON.stringify({kind:'position',question:'Which planet is red?',answer:'2',confident:true}));
  f.change(obs('Which planet is red?\nVenus\nMars\nEarth'));
  await f.monitor.tick();f.advance(2000);await f.monitor.tick();await f.monitor.job;assert.equal(f.shown.at(-1),'2');
  f.change(obs('Which planet is red?\nMars\nVenus\nEarth'));await f.monitor.tick();f.advance(250);await f.monitor.tick();assert.equal(f.shown.at(-1),'');
});

test('quiz thinking state covers inference and ends on answer, cancellation, and failure',async()=>{
  for(const outcome of ['answer','cancel','failure']){
    const waiting=deferred();const f=fixture(async()=>{await waiting.promise;if(outcome==='failure')throw Error('fixture failure');return result('B');});
    assert.equal(f.monitor.state().thinking,false);await f.monitor.tick();assert.equal(f.monitor.state().thinking,false);
    f.advance(2000);await f.monitor.tick();assert.equal(f.monitor.state().thinking,true);
    const job=f.monitor.job;
    if(outcome==='cancel'){f.monitor.enable(false);assert.equal(f.monitor.state().thinking,false);}
    waiting.resolve();await job;assert.equal(f.monitor.state().thinking,false);
  }
});


test('symbol hints unify letters and positions without conflating binary answer families', () => {
  const reply = (kind: string, answer: string) => JSON.stringify({kind, answer, question:'Practice question', confident:true});
  for (let n = 1; n <= 26; n++) {
    assert.equal(parseQuizSymbols(reply('choice', String.fromCharCode(64+n))), `p${n}`);
    assert.equal(parseQuizSymbols(reply('choice', String.fromCharCode(96+n))), `p${n}`);
    assert.equal(parseQuizSymbols(reply('position', String(n))), `p${n}`);
  }
  for (const [kind, answer, expected] of [
    ['true_false','F','false'], ['true_false','True','true'],
    ['yes_no','Y','yes'], ['yes_no','No','no'],
    ['choice','Yes','yes'], ['position','No','no'],
    ['choice','F','p6'], ['choice','T','p20'], ['choice','Y','p25'], ['choice','N','p14'],
    ['choice','A, C, F','p1,p3,p6'], ['position','1, 3, 6','p1,p3,p6'],
    ['choice','0','p0'], ['choice','001','p001'], ['position','999','p999']
  ]) assert.equal(parseQuizSymbols(reply(kind, answer)), expected);
  assert.equal(parseQuizSymbols('```json\n'+reply('choice','B')+'\n```'),'p2');
  assert.equal(parseQuizSymbols(reply('none','')),'');
  assert.equal(parseQuizSymbols(reply('choice','B').replace('true','false')),'');
  for(const answer of ['A because', 'A,A', 'sun', 'p1', 'A,']) assert.throws(()=>parseQuizSymbols(reply('choice',answer)));
});

test('symbol output goes through verified publishing, cache reuse and question clearing', async () => {
  const f = fixture(async()=>result('F'), {parseAnswer:parseQuizSymbols});
  await f.monitor.tick(); f.advance(2000); await f.monitor.tick(); await f.monitor.job;
  assert.equal(f.shown.at(-1),'p6');
  f.advance(2000); await f.monitor.tick(); assert.equal(f.calls(),1);
  assert.equal(f.shown.at(-1),'p6');
  f.change(obs('Which planet is red? A. Venus B. Mars C. Earth'));
  await f.monitor.tick(); f.advance(250); await f.monitor.tick();
  assert.equal(f.shown.at(-1),'');
  f.monitor.enable(false);
});

const writtenResult=(answer='The gradient gives the direction of steepest increase.',confident=true)=>JSON.stringify({kind:'written',question:'Explain the gradient.',answer,confident});
const writtenParser=(text:string)=>parseQuizAnswer(text,{symbols:true,writtenAnswers:true});
test('written quiz schema is opt-in, bounded, and leaves choice symbols unchanged',()=>{
 assert.throws(()=>parseQuizSymbols(writtenResult()),/invalid/);
 assert.deepEqual(writtenParser(writtenResult()),{written:'The gradient gives the direction of steepest increase.'});
 assert.equal(writtenParser(writtenResult('uncertain',false)),'');assert.equal(writtenParser(result('B')),'p2');
 for(const answer of ['', 'a'.repeat(1201), 'hello\0world'])assert.throws(()=>writtenParser(writtenResult(answer)));
 assert.deepEqual(writtenParser(writtenResult('Step 1\n\nStep 2\t= 4')),{written:'Step 1\n\nStep 2\t= 4'});
});
test('verified written answers copy once and show star only after clipboard success',async()=>{
 const copies:string[]=[];let f!:ReturnType<typeof fixture>;
 f=fixture(async()=>writtenResult(),{parseAnswer:writtenParser,copyWritten:(text:string)=>{assert.notEqual(f.shown.at(-1),'star');copies.push(text);}});
 f.change(obs('Question 1: Explain the gradient of a differentiable function.'));
 await f.monitor.tick();f.advance(2000);await f.monitor.tick();await f.monitor.job;
 assert.equal(copies.length,1);assert.equal(f.shown.at(-1),'star');assert.match(f.monitor.status,/copied to clipboard/);
 f.advance(2000);await f.monitor.tick();assert.equal(copies.length,1);assert.equal(f.shown.at(-1),'star');
 f.monitor.reset('Paused');f.advance(2000);await f.monitor.tick();f.advance(2000);await f.monitor.tick();await f.monitor.job;assert.equal(copies.length,1);
 f.change(obs('Question 2: Explain the Hessian of a differentiable function.'));await f.monitor.tick();f.advance(250);await f.monitor.tick();await f.monitor.job;
 assert.equal(copies.length,2);assert.equal(f.shown.at(-1),'star');
 f.monitor.enable(false);assert.equal(f.shown.at(-1),'');assert.equal(copies.length,2);
});
test('clipboard failures never produce a success star',async()=>{
 const f=fixture(async()=>writtenResult(),{parseAnswer:writtenParser,copyWritten:()=>{throw Error('clipboard unavailable');}});
 await f.monitor.tick();f.advance(2000);await f.monitor.tick();await f.monitor.job;
 assert(!f.shown.includes('star'));assert.match(f.monitor.status,/clipboard unavailable/);assert.equal(f.monitor.copied.size,0);
});
test('written results cannot copy after screen changes, cancellation, or abstention',async()=>{
 for(const action of ['change','pause','disable','uncertain']){
  const waiting=deferred(),copies:string[]=[];
  const f=fixture(()=>waiting.promise,{parseAnswer:writtenParser,copyWritten:(text:string)=>copies.push(text)});
  await f.monitor.tick();f.advance(2000);await f.monitor.tick();const job=f.monitor.job;
  if(action==='change')f.change(obs('Question 5: Explain a completely different proposition now.'));
  if(action==='pause')f.allow(false);
  if(action==='disable')f.monitor.enable(false);
  waiting.resolve(writtenResult('late answer',action!=='uncertain'));await job;
  assert.equal(copies.length,0,action);assert(!f.shown.includes('star'),action);
 }
});


test('thinking replaces an answer and a ready symbol replaces thinking without repeated pipe writes',()=>{
 const child:any=new EventEmitter();child.stdin=new PassThrough();const messages:any[]=[];child.stdin.on('data',(data:Buffer)=>messages.push(JSON.parse(String(data))));
 const overlay=new QuizOverlay({spawnProcess:()=>child});
 overlay.show('p2',1);overlay.show('thinking',1);overlay.show('thinking',1);overlay.show('p3',1);overlay.hide();
 assert.deepEqual(messages.map(x=>x.text),['p2','thinking','p3','']);overlay.close();
});

test('a reply that shows its working before the JSON answer still gives the answer; anything after the object does not', () => {
  const object = '{"kind":"position","question":"Question 17","answer":"2","confident":true}';
  assert.equal(parseQuizSymbols(`4 - (2+3) = -1 → position 2.\n\n${object}`), 'p2');
  assert.equal(parseQuizSymbols(`The cut is theta >= 6 - 2x, the second option.\n\`\`\`json\n${object}\n\`\`\``), 'p2');
  assert.equal(parseQuizAnswer(`Working {with braces} here.\n{"kind":"yes_no","question":"Is it convex?","answer":"Y","confident":true}`), 'Y');
  // The written kind too, with braces inside its answer.
  assert.deepEqual(parseQuizAnswer('Reasoning.\n{"kind":"written","question":"Explain Q14","answer":"Since Q(x) = 2 max{3 - x, 0} >= 6 - 2x everywhere.","confident":true}', { writtenAnswers: true }), { written: 'Since Q(x) = 2 max{3 - x, 0} >= 6 - 2x everywhere.' });
  for (const reply of [`${object}\nAnd one more thing.`, 'Position 2.', `The answer is ${object} I think.`, 'Working.\n[1, 2]']) assert.throws(() => parseQuizAnswer(reply), /invalid answer/, reply);
  // Still the usual checks on what the object says.
  assert.throws(() => parseQuizAnswer('Working.\n{"kind":"choice","question":"Q","answer":"Mars","confident":true}'), /short choice/);
});
