import {readHandleBytes,FileByteCache} from '../desktop/file-cache.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink,readFile,readdir,stat,utimes,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LocalFiles,notebookText,sourceLink,parseSourceLink} from '../desktop/local-files.mjs';
import {runFiles} from '../desktop/files-agent.mjs';
import {DEFAULTS} from '../src/defaults.js';
import {wantsFiles,requestMode} from '../src/chat-routing.js';
import {ConversationMemory} from '../desktop/memory.mjs';
import {replyHTML} from '../src/reply-renderer.js';
async function fixture(t, options={}) {
  const dir=await mkdtemp(join(tmpdir(),'lyra-files-test-')),root=join(dir,'approved');await mkdir(root);t.after(()=>rm(dir,{recursive:true,force:true}));let saved=[];
  const files=new LocalFiles({read:async()=>saved,write:async v=>{saved=v;},...options});await files.load();await files.add(root);return {dir,root,files,id:files.status()[0].id,saved:()=>saved};
}
const signal=()=>new AbortController().signal;
const pdfBytes=()=>{
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 400] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];const stream='BT /F1 18 Tf 30 320 Td (MIP capacity: x + y <= 7) Tj ET';objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);let out='%PDF-1.4\n',offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(out));out+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}const xref=Buffer.byteLength(out);out+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;return Buffer.from(out);
};
test('folder grants persist, deduplicate and can be revoked',async t=>{const {files,root,id,saved}=await fixture(t);await files.add(root);assert.equal(files.status().length,1);assert.equal(saved()[0].id,id);await files.remove(id);await assert.rejects(files.list({rootId:id}),/removed/);assert.equal(saved().length,0);});
test('file access rejects traversal, absolute paths, hidden credentials and escaping symlinks',async t=>{
  const {files,root,dir,id}=await fixture(t);await writeFile(join(dir,'outside.txt'),'PRIVATE');await writeFile(join(root,'.env'),'PRIVATE');await writeFile(join(root,'keys.json'),'PRIVATE');await symlink(join(dir,'outside.txt'),join(root,'escape.txt'));await mkdir(join(root,'node_modules'));await writeFile(join(root,'node_modules','a.txt'),'dependency');await writeFile(join(root,'ok.txt'),'OK');await symlink(join(root,'ok.txt'),join(root,'inside.txt'));
  for(const path of ['../outside.txt',join(dir,'outside.txt'),'.env','keys.json','escape.txt','node_modules/a.txt'])await assert.rejects(files.read({rootId:id,path}),undefined,path);
  assert.match((await files.read({rootId:id,path:'inside.txt'})).text,/OK/);const list=await files.list({rootId:id});assert.deepEqual(list.items.map(x=>x.path),['ok.txt']);
});
test('reading follows current content and returns bounded line citations',async t=>{
  const {files,root,id}=await fixture(t);await writeFile(join(root,'model.py'),'x = 2\ny = 3\ncapacity = x + y\n');let r=await files.read({rootId:id,path:'model.py',start:2,count:1});assert.equal(r.text,'2: y = 3');assert(r.truncated);assert.equal(r.nextStart,3);assert.equal(parseSourceLink(r.source).path,'model.py');await writeFile(join(root,'model.py'),'x = 9');r=await files.read({rootId:id,path:'model.py'});assert.match(r.text,/9/);await assert.rejects(files.read({rootId:id,path:'model.py',start:-1}));
});
test('notebooks are read without execution, with cell labels and saved output only',async t=>{const {files,root,id}=await fixture(t);const nb={cells:[{cell_type:'markdown',source:['# Lab']},{cell_type:'code',source:['raise RuntimeError("do not execute")'],outputs:[{data:{'text/plain':['saved output'],'text/html':['<script>bad</script>']}}]}]};await writeFile(join(root,'lab.ipynb'),JSON.stringify(nb));const r=await files.read({rootId:id,path:'lab.ipynb'});assert.match(r.text,/Cell 2: code/);assert.match(r.text,/do not execute/);assert.match(r.text,/saved output/);assert(!r.text.includes('<script>'));assert.throws(()=>notebookText('{}'));});
test('search finds source contents, excludes secrets, and reports PDF filename-only scope',async t=>{const {files,root,id}=await fixture(t);await writeFile(join(root,'general_constraints.py'),'capacity = sum(x) <= 7');await writeFile(join(root,'.secret.py'),'capacity secret');await writeFile(join(root,'capacity.pdf'),pdfBytes());const r=await files.search({rootId:id,query:'capacity'});assert(r.results.some(x=>x.path==='general_constraints.py'));assert(r.results.some(x=>x.path==='capacity.pdf'));assert(!JSON.stringify(r).includes('secret'));assert.match(r.note,/PDF\/image contents are not searched/);});
test('large, binary and unsupported files are rejected; long lines are explicitly truncated',async t=>{const {files,root,id}=await fixture(t);await writeFile(join(root,'large.txt'),Buffer.alloc(20*1024*1024+1));await writeFile(join(root,'binary.txt'),Buffer.from([0,1,2]));await writeFile(join(root,'app.command'),'echo run');await writeFile(join(root,'long.csv'),'a'.repeat(30000));for(const path of ['large.txt','binary.txt','app.command'])await assert.rejects(files.read({rootId:id,path}));assert.match((await files.read({rootId:id,path:'long.csv'})).text,/line truncated/);});
test('aborted reads and revocation during document processing fail closed',async t=>{let release;const gate=new Promise(r=>release=r);const {files,root,id}=await fixture(t,{documentReader:async()=>{await gate;return{pages:[]};}});await writeFile(join(root,'lab.pdf'),pdfBytes());const abort=new AbortController();abort.abort();await assert.rejects(files.read({rootId:id,path:'lab.pdf'},abort.signal),{name:'AbortError'});const pending=files.read({rootId:id,path:'lab.pdf'},signal());await new Promise(r=>setTimeout(r,20));await files.remove(id);release();await assert.rejects(pending,/access changed|removed/);});
test('PDF text and rendered pages use only memory and honor page boundaries',{skip:process.platform!=='darwin'},async t=>{const {files,root,id}=await fixture(t);await writeFile(join(root,'lab.pdf'),pdfBytes());const before=await readdir(root);const r=await files.read({rootId:id,path:'lab.pdf'});assert.equal(r.totalPages,1);assert.match(r.pages[0].text,/MIP capacity/);const image=await files.image({rootId:id,path:'lab.pdf',page:1});assert.match(image.url,/^data:image\/jpeg;base64,/);assert(image.width<=1600&&image.height<=1600);await assert.rejects(files.image({rootId:id,path:'lab.pdf',page:2}),/outside/);assert.deepEqual(await readdir(root),before);const preview=await files.preview(image.source);assert(preview.url);});
test('source links are narrowly recognized and revalidated after revocation',async t=>{const {files,root,id}=await fixture(t);await writeFile(join(root,'m.py'),'x=1');const link=sourceLink(id,'m.py',1);assert.match(replyHTML(`[model](${link})`),/href="lyra-file:/);assert(!replyHTML('[bad](file:///etc/passwd)').includes('href'));assert(!replyHTML('[bad](lyra-file://bad/path)').includes('href'));assert.match((await files.preview(link)).text,/x=1/);await files.remove(id);await assert.rejects(files.preview(link),/removed/);});
test('local file routing handles coursework, paths and follow-ups without stealing screen questions',()=>{
 for(const q of ['Read my MIP lab files','Why is my optimization lab infeasible?','Read ~/Courses/Optimization/material/lab','Explain general_constraints.py','Find the MIP lab handout'])assert(wantsFiles(q),q);
 for(const q of ['What is a MIP?','Do not read my files','Translate "read my lab"','How do I read a PDF in Python?','Hello'])assert(!wantsFiles(q),q);
 assert.equal(requestMode('Explain my lab on my screen','chat',DEFAULTS),'screen');assert.equal(requestMode('Why is this infeasible?','chat',DEFAULTS,[{mode:'files'}]),'files');assert.equal(requestMode('What is on my calendar?','chat',DEFAULTS,[{mode:'files'}]),'calendar');
});
test('file exchanges are excluded from automatic memory replay',async()=>{const memory=new ConversationMemory({read:async()=>null,write:async()=>{}});await memory.init([{role:'user',mode:'files',content:'Read my notebook'},{role:'assistant',mode:'files',content:'Private notebook excerpt'}]);assert.equal(memory.episodes.length,0);});
const call=(name,args,id='c')=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
test('DeepSeek tool loop searches and reads before answering, keeps only observed source links',async t=>{
 const {files,root,id}=await fixture(t);await writeFile(join(root,'m.py'),'capacity = 7');let n=0,spoken;const observed=sourceLink(id,'m.py',1),fake=sourceLink(id,'fake.py',1);
 const provider={deepseekKey:()=> 'mock',request:async(url,opts)=>{assert.equal(url,'https://api.deepseek.com/chat/completions');const b=JSON.parse(opts.body);assert(b.tools.every(t=>t.function.name.startsWith('files_')));assert(!JSON.stringify(b).includes('unrelated secret'));n++;let m;if(n===1)m={role:'assistant',content:null,tool_calls:[call('files_read',{rootId:id,path:'m.py'})]};else{assert.match(b.messages.at(-1).content,/capacity = 7/);m={content:`Capacity is seven. [source](${observed}) [invented](${fake})`};}return Response.json({choices:[{message:m}]});}};
 const reply=await runFiles({provider,settings:DEFAULTS,history:[{role:'user',content:'unrelated secret',mode:'chat'}],text:'Read my lab',files,signal:signal(),onText:s=>spoken=s});assert(reply.includes(observed));assert(!reply.includes(fake));assert.equal(spoken,reply);assert.equal(n,2);
});
test('file image loop places images only in user messages and cleans request images on errors',async t=>{
 const img={url:'data:image/jpeg;base64,dGVzdA==',path:'lab.pdf',page:1,source:sourceLink('00000000-0000-0000-0000-000000000000','lab.pdf',1,true)};let n=0;
 const files={epoch:0,status:()=>[{id:'test'}],image:async()=>img};const provider={deepseekKey:()=> 'mock',request:async(_url,opts)=>{const b=JSON.parse(opts.body);if(++n===1)return Response.json({choices:[{message:{tool_calls:[call('files_image',{rootId:'test',path:'lab.pdf'})]}}]});assert(b.messages.some(m=>m.role==='user'&&Array.isArray(m.content)&&m.content.some(c=>c.type==='image_url')));assert(b.messages.filter(m=>m.role==='tool').every(m=>!m.content.includes('data:image')));throw Error('Network unavailable');}};
 await assert.rejects(runFiles({provider,settings:DEFAULTS,text:'Read my lab',files,signal:signal()}),/Network/);assert.equal(img.url,'');
});
test('file agent exposes no execution tool, blocks revoked access, and needs an approved root',async()=>{const files={epoch:0,status:()=>[]};const provider={request:()=>assert.fail('No request expected')};await assert.rejects(runFiles({provider,settings:DEFAULTS,text:'Read my lab',files,signal:signal()}),/Add a folder/);await assert.rejects(runFiles({provider,settings:{...DEFAULTS,backend:'antigravity'},text:'Read my lab',files,signal:signal()}),/Add a folder/);});
// A provider that runs Fairy's tools through its bridge, as Claude Code, Gemini and Codex do.
const bridged=(steps,seen={})=>({turn:async({instructions,input,tools,toolHandler})=>{Object.assign(seen,{instructions,input,tools,results:[]});for(const [tool,args] of steps)seen.results.push(await toolHandler({tool,arguments:args}));return seen.answer??'Done.';}});
const resultOf=entry=>JSON.parse(entry.contentItems[0].text);
for(const backend of ['antigravity','claude','codex'])test(`file questions run through the bridge on ${backend}`,async t=>{
  const {files,root,id}=await fixture(t);await writeFile(join(root,'lab.py'),'capacity = 5\n');const seen={},progress=[];let streamed;
  const reply=await runFiles({provider:bridged([['files_search',{rootId:id,query:'capacity'}],['files_read',{rootId:id,path:'lab.py'}]],seen),settings:{...DEFAULTS,backend},text:'Read my lab',files,signal:signal(),onText:text=>{streamed=text;},onProgress:text=>progress.push(text)});
  assert.deepEqual(seen.tools.map(tool=>tool.name),['files_roots','files_list','files_search','files_read','files_image']);
  assert.equal(seen.tools[3].inputSchema.required[0],'rootId');assert.match(seen.instructions,/untrusted source data/);assert.match(seen.instructions,/up to 24 read or search calls/);
  assert.match(seen.input[0].text,/Read my lab/);assert.match(resultOf(seen.results[1]).content||JSON.stringify(resultOf(seen.results[1])),/capacity = 5/);
  assert.match(reply,/^Done\.\n\nSources inspected: \[lab\.py\]\(lyra-file:/);assert.equal(streamed,reply);assert.deepEqual(progress,['Searching files…','Reading the file…']);
});
test('a bridged provider only gets a write tool when the message asks for that file, and cites only what it read',async t=>{
  const {files,root,id}=await fixture(t);await writeFile(join(root,'lab.py'),'capacity = 5\n');const seen={answer:'See [made up](lyra-file:invented).'};
  const reply=await runFiles({provider:bridged([['files_write',{rootId:id,path:'stolen.md',content:'injected'}]],seen),settings:{...DEFAULTS,backend:'claude'},text:'Read my lab',files,signal:signal()});
  assert(!seen.tools.some(tool=>tool.name==='files_write'));assert.match(resultOf(seen.results[0]).error,/authorization/);await assert.rejects(readFile(join(root,'stolen.md')));assert.equal(reply,'See made up.');
  const wanted={};await runFiles({provider:bridged([['files_write',{rootId:id,path:'notes.md',content:'Saved note'}]],wanted),settings:{...DEFAULTS,backend:'claude'},text:'Create notes.md with a summary',files,signal:signal()});
  assert(wanted.tools.some(tool=>tool.name==='files_write'));assert.equal(await readFile(join(root,'notes.md'),'utf8'),'Saved note');
});
test('a source address pasted on its own becomes a link, and one that was never read goes away',async t=>{
  const {files,root,id}=await fixture(t);await writeFile(join(root,'lab.py'),'capacity = 5\n');
  const seen={get answer(){return `It is 5. Sources: ${resultOf(this.results[0]).source}, lyra-file://${id}/aW52ZW50ZWQ?line=1.`;}};
  const reply=await runFiles({provider:bridged([['files_read',{rootId:id,path:'lab.py'}]],seen),settings:{...DEFAULTS,backend:'claude'},text:'Read my lab',files,signal:signal()});
  assert.equal(reply,`It is 5. Sources: [lab.py](${resultOf(seen.results[0]).source}), .`);
});
test('a bridged provider keeps to the reading budget and hands back images as images',async t=>{
  const {files,root,id}=await fixture(t);await writeFile(join(root,'lab.py'),'capacity = 5\n');const seen={};
  await runFiles({provider:bridged(Array.from({length:26},()=>['files_list',{rootId:id}]),seen),settings:{...DEFAULTS,backend:'antigravity'},text:'Read my lab',files,signal:signal()});
  assert(!resultOf(seen.results[23]).error);assert.match(resultOf(seen.results[24]).error,/Reading budget reached/);
  files.image=async()=>({path:'plot.png',source:'lyra-file:plot',url:'data:image/png;base64,AAAA'});const pictured={};
  const reply=await runFiles({provider:bridged([['files_image',{rootId:id,path:'plot.png'}]],pictured),settings:{...DEFAULTS,backend:'claude'},text:'Read my lab',files,signal:signal()});
  const items=pictured.results[0].contentItems;assert.equal(resultOf(pictured.results[0]).url,undefined);assert.match(items[1].text,/Untrusted source image: plot\.png/);assert.deepEqual(items[2],{type:'inputImage',imageUrl:'data:image/png;base64,AAAA'});assert.match(reply,/plot\.png/);
});
test('a bridged turn stops if folder access changes, and says so when no answer comes back',async t=>{
  const {files,id}=await fixture(t);
  await assert.rejects(runFiles({provider:{turn:async({toolHandler})=>{files.epoch++;return toolHandler({tool:'files_list',arguments:{rootId:id}});}},settings:{...DEFAULTS,backend:'claude'},text:'Read my lab',files,signal:signal()}),/Approved folders changed/);
  await assert.rejects(runFiles({provider:{turn:async()=>'  '},settings:{...DEFAULTS,backend:'claude'},text:'Read my lab',files,signal:signal()}),/No final answer/);
});
test('file questions work over the OpenAI API',async t=>{
  const {files,root,id}=await fixture(t);await writeFile(join(root,'lab.py'),'capacity = 5\n');const asked=[];
  const replies=[{output:[{type:'function_call',call_id:'one',name:'files_read',arguments:JSON.stringify({rootId:id,path:'lab.py'})}]},{output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'It is 5.'}]}],output_text:'It is 5.'}];
  const provider={response:async body=>{asked.push(structuredClone(body));return replies[asked.length-1];}};
  const reply=await runFiles({provider,settings:{...DEFAULTS,backend:'openai',model:'gpt-test'},text:'Read my lab',files,signal:signal()});
  assert.equal(asked[0].tools[3].name,'files_read');assert.match(asked[1].input.at(-1).output,/capacity = 5/);assert.match(reply,/^It is 5\.\n\nSources inspected:/);
});

test('file follow-ups keep how-to context while explicit integration switches take priority',()=>{
  const history=[{mode:'files'}];
  assert.equal(requestMode('How can I improve these constraints?','chat',DEFAULTS,history),'files');
  assert.equal(requestMode('Can you check my calendar tomorrow?','chat',DEFAULTS,history),'calendar');
  assert.equal(requestMode('Can you summarize my unread emails?','chat',DEFAULTS,history),'gmail');
  assert.equal(requestMode('Can you search my Google Drive?','chat',DEFAULTS,history),'drive');
});


test('repeated search/read reuses validated bytes, but edits with restored mtime and replacements invalidate',async t=>{
 let reads=0;const {files,root,id}=await fixture(t,{readBytes:async(...args)=>{reads++;return readHandleBytes(...args);}});
 const path=join(root,'lab.txt');await writeFile(path,'capacity = 7');
 await files.search({rootId:id,query:'capacity'});await files.read({rootId:id,path:'lab.txt'});assert.equal(reads,1);
 const info=await stat(path);await writeFile(path,'capacity = 9');await utimes(path,info.atime,info.mtime);
 assert.match((await files.read({rootId:id,path:'lab.txt'})).text,/9/);assert.equal(reads,2);
 await writeFile(join(root,'next.txt'),'capacity = 8');await rename(join(root,'next.txt'),path);
 assert.match((await files.read({rootId:id,path:'lab.txt'})).text,/8/);assert.equal(reads,3);
 await rm(path);await assert.rejects(files.read({rootId:id,path:'lab.txt'}));
 await files.remove(id);assert.equal(files.cache.bytes,0);await assert.rejects(files.read({rootId:id,path:'lab.txt'}),/removed/);
});
test('cached file still rechecks symlink escape, abort and in-read edits; failed reads never cache',async t=>{
 let edit=false;const {files,root,dir,id}=await fixture(t,{readBytes:async(...args)=>{const bytes=await readHandleBytes(...args);if(edit)await writeFile(join(root,'lab.txt'),'new');return bytes;}});
 const path=join(root,'lab.txt');await writeFile(path,'old');await files.read({rootId:id,path:'lab.txt'});
 const abort=new AbortController();abort.abort();await assert.rejects(files.read({rootId:id,path:'lab.txt'},abort.signal),{name:'AbortError'});
 await rm(path);await writeFile(join(dir,'outside.txt'),'private');await symlink(join(dir,'outside.txt'),path);
 await assert.rejects(files.read({rootId:id,path:'lab.txt'}),/outside/);
 await rm(path);await writeFile(path,'old');edit=true;
 await assert.rejects(files.read({rootId:id,path:'lab.txt'}),/changed during reading/);assert.equal(files.cache.bytes,0);
});
test('cache TTL and clear force content reload; images and large text never enter cache',async t=>{
 let now=0,reads=0;const cache=new FileByteCache({ttl:10,now:()=>now});
 const {files,root,id}=await fixture(t,{cache,readBytes:async(...args)=>{reads++;return readHandleBytes(...args);}});
 await writeFile(join(root,'lab.txt'),'hello');await files.read({rootId:id,path:'lab.txt'});now=10;await files.read({rootId:id,path:'lab.txt'});assert.equal(reads,2);
 files.clearCache();await files.read({rootId:id,path:'lab.txt'});assert.equal(reads,3);
 await writeFile(join(root,'big.txt'),'x'.repeat(1024*1024+1));await files.bytes(id,'big.txt');await files.bytes(id,'big.txt');assert.equal(reads,5);
 await writeFile(join(root,'image.png'),'image bytes');await files.bytes(id,'image.png');await files.bytes(id,'image.png');assert.equal(reads,7);assert.equal(cache.entries.size,1);
});


test('a read finishing after cache clear cannot repopulate cleared data',async t=>{
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 const {files,root,id}=await fixture(t,{readBytes:async(...args)=>{const bytes=await readHandleBytes(...args);entered();await gate;return bytes;}});
 await writeFile(join(root,'lab.txt'),'capacity = 7');const read=files.read({rootId:id,path:'lab.txt'});
 await started;files.clearCache();release();assert.match((await read).text,/7/);assert.equal(files.cache.bytes,0);
});

test('a PDF page is drawn at 1600 for a model, and bigger only when the window asks, within bounds', async t => {
  const asked = [];
  const { files, root, id } = await fixture(t, { documentReader: async payload => { asked.push(payload); return { url: 'data:image/jpeg;base64,AA==', width: 10, height: 13, totalPages: 9, page: payload.start }; } });
  await writeFile(join(root, 'book.pdf'), '%PDF-1.4 fake');
  await files.image({ rootId: id, path: 'book.pdf', page: 3 });
  await files.preview(sourceLink(id, 'book.pdf', 4, true), undefined, { size: 2400 });
  await files.preview(sourceLink(id, 'book.pdf', 5, true), undefined, { size: 99999 });
  await files.preview(sourceLink(id, 'book.pdf', 6, true), undefined, { size: 10 });
  const page = await files.preview(sourceLink(id, 'book.pdf', 7, true), undefined, { size: 'big' });
  assert.deepEqual(asked.map(p => [p.start, p.size]), [[3, 1600], [4, 2400], [5, 3200], [6, 800], [7, 1600]]);
  assert.ok(asked.every(p => !('ink' in p)), 'a model’s page is never inked');
  await files.preview(sourceLink(id, 'book.pdf', 8, true), undefined, { size: 2400, ink: true });
  assert.equal(asked.at(-1).ink, true);
  assert.equal(page.totalPages, 9);
});
