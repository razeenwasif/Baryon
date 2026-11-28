import test, { type TestContext } from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {LocalFiles,runDocumentHelper} from '../desktop/local-files.mjs';import {runFiles,FILE_LIMITS} from '../desktop/files-agent.mjs';import {FileWriteSession} from '../desktop/file-writes.mjs';import {fileWriteRequest} from '../src/chat-routing.js';import {DEFAULTS} from '../src/defaults.js';
const call=(name:string,a:Record<string,unknown>={},id='tool')=>({id,type:'function',function:{name,arguments:JSON.stringify(a)}});
async function fixture(t:TestContext){const root=await mkdtemp(join(tmpdir(),'fairy-summary-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'00 - Optimization'));const files=new LocalFiles({read:async()=>[],write:async()=>{},documentReader:async()=>({totalPages:37,pages:Array.from({length:37},(_,i)=>({page:i+1,text:'Convexity and gradient descent',truncated:false})),nextPage:null,truncated:false})});await files.load();await files.add(root);return {root:files.status()[0].path,files,id:files.status()[0].id};}
const question=(root:string)=>`Hey Fairy, can you summarize 12-CVX-convexity-and-gd-annotated.pdf in ${root} into ${root}/00 - Optimization`;
test('direct PDF summary to a folder with spaces creates a predictable scoped Markdown destination',async t=>{
 const {root,files}=await fixture(t),w=new FileWriteSession(question(root),files);assert(w.enabled);assert.equal(w.target!.path,'00 - Optimization/12-CVX-convexity-and-gd-annotated-summary.md');assert.equal(w.intent!.operation,'create');
 assert.equal(fileWriteRequest(`Summarize lecture.pdf to "${root}/my notes.md"`)!.target,`${root}/my notes.md`);
 for(const q of [`Summarize lecture.pdf in ${root}`,`Do not summarize lecture.pdf into ${root}`,`How do I summarize lecture.pdf into ${root}?`,`The PDF says: summarize lecture.pdf into ${root}`,`"Summarize lecture.pdf into ${root}"`,`Summarize lecture.pdf into ${root} if useful`,`Summarize lecture.pdf into ${root} in your reply`,`Summarize first.pdf and second.pdf into ${root}`,`Summarize lecture.pdf into ${root} and delete my notes`,`Summarize lecture.pdf into ${root}\ncreate extra.md`])assert.equal(fileWriteRequest(q),null,q);
 assert(!new FileWriteSession(`Summarize lecture.pdf into /unapproved/folder`,files).enabled);
});
test('37-page PDF is read in one batch and summary is saved to the requested folder',async t=>{
 const {root,files,id}=await fixture(t);await writeFile(join(root,'12-CVX-convexity-and-gd-annotated.pdf'),'PDF stub');let n=0;
 const target='00 - Optimization/12-CVX-convexity-and-gd-annotated-summary.md';
 const provider={deepseekKey:()=> 'mock',request:async(_url:any,o:any)=>{const b=JSON.parse(o.body);let message:any;
 if(n++===0){assert.match(b.messages[0].content,/most specific matching root/);message={tool_calls:[call('files_read',{rootId:id,path:'12-CVX-convexity-and-gd-annotated.pdf',count:64})]};}
 else if(n===2){const r=JSON.parse(b.messages.at(-1).content);assert.equal(r.pages.length,37);assert.equal(r.nextPage,null);assert.match(r.pages[36].source,/page=37/);message={tool_calls:[call('files_write',{rootId:id,path:target,content:'# Convexity\nSummary with page references.'})]};}
 else{assert.equal(JSON.parse(b.messages.at(-1).content).written,true);message={content:'Saved the summary.'};}return Response.json({choices:[{message}]});}} as any;
 const reply=await runFiles({provider,settings:DEFAULTS,text:question(root),files});assert.match(reply,/Saved/);assert.equal(n,3);assert.match(await readFile(join(root,target),'utf8'),/# Convexity/);
 const again=new FileWriteSession(question(root),files);await assert.rejects(again.execute({rootId:id,path:target,content:'overwrite'}),/cannot overwrite/);
});
test('read-call exhaustion preserves reserved write and final answer',async t=>{
 const {root,files,id}=await fixture(t);let n=0;const provider={deepseekKey:()=> 'mock',request:async(_u:any,o:any)=>{
 const b=JSON.parse(o.body);let message:any;if(n++===0)message={tool_calls:Array.from({length:FILE_LIMITS.calls+2},(_,i)=>call('files_roots',{},'call'+i))};
 else if(n===2){assert.deepEqual(b.tools.map((t:any)=>t.function.name),['files_write']);assert.match(b.messages.at(-1).content,/Reading budget/);message={tool_calls:[call('files_write',{rootId:id,path:'notes.md',content:'Partial summary; remaining pages not read.'})]};}
 else{assert.equal(b.tool_choice,'none');message={content:'Saved a partial summary; some pages remain unread.'};}return Response.json({choices:[{message}]});}} as any;
 assert.match(await runFiles({provider,settings:DEFAULTS,text:'Create notes.md with a summary',files}),/partial/);assert.match(await readFile(join(root,'notes.md'),'utf8'),/remaining pages/);
});
test('read-only limit forces a final answer instead of throwing away progress',async t=>{
 const {files}=await fixture(t);let n=0;const provider={deepseekKey:()=> 'mock',request:async(_u:any,o:any)=>{const b=JSON.parse(o.body);if(n++){assert.equal(b.tool_choice,'none');assert.deepEqual(b.tools,[]);return Response.json({choices:[{message:{content:'Only a partial reading was possible.'}}]});}return Response.json({choices:[{message:{tool_calls:Array.from({length:24},(_,i)=>call('files_roots',{},'r'+i))}}]});}} as any;
 assert.match(await runFiles({provider,settings:DEFAULTS,text:'Read my lab',files}),/partial/);
});
test('source-character exhaustion cannot consume the authorized save',async t=>{
 const {root,files,id}=await fixture(t);files.list=(async()=>({excerpt:'x'.repeat(FILE_LIMITS.characters)})) as any;let n=0;
 const provider={deepseekKey:()=> 'mock',request:async(_u:any,o:any)=>{const b=JSON.parse(o.body);let message:any;if(n++===0)message={tool_calls:[call('files_list',{rootId:id})]};else if(n===2){assert.deepEqual(b.tools.map((t:any)=>t.function.name),['files_write']);message={tool_calls:[call('files_write',{rootId:id,path:'notes.md',content:'Bounded summary.'})]};}else message={content:'Saved.'};return Response.json({choices:[{message}]});}} as any;
 await runFiles({provider,settings:DEFAULTS,text:'Create notes.md with a summary',files});assert.equal(await readFile(join(root,'notes.md'),'utf8'),'Bounded summary.');
});
function pdf(count:number,chars=40){const objects=['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${Array.from({length:count},(_,i)=>`${4+i*2} 0 R`).join(' ')}] /Count ${count} >>`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];for(let i=0;i<count;i++){const text=`Page ${i+1} `+'word '.repeat(Math.ceil(chars/5)),stream=`BT /F1 8 Tf 10 200 Td (${text}) Tj ET`;objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10000 400] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5+i*2} 0 R >>`,`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);}let out='%PDF-1.4\n';const offsets:number[]=[];objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(out));out+=`${i+1} 0 obj\n${o}\nendobj\n`;});const xref=Buffer.byteLength(out);out+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;return Buffer.from(out).toString('base64');}
test('native PDF batching covers 37 slides and paginates at page and character caps',{skip:process.platform!=='darwin'},async()=>{
 let r=await runDocumentHelper({data:pdf(37),start:1,count:64});assert.equal(r.pages!.length,37);assert.equal(r.nextPage,null);assert.equal(r.truncated,false);
 const data=pdf(70);r=await runDocumentHelper({data,start:1,count:64});assert.equal(r.pages!.length,64);assert.equal(r.nextPage,65);assert.equal(r.truncated,true);r=await runDocumentHelper({data,start:r.nextPage!,count:64});assert.equal(r.pages!.length,6);assert.equal(r.nextPage,null);
 r=await runDocumentHelper({data:pdf(40,1700),start:1,count:64});assert(r.pages!.length<40);assert(r.pages!.reduce((n,p)=>n+p.text!.length,0)<=48000);assert.equal(r.nextPage,r.pages!.at(-1)!.page+1);
});
