import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {wantsFiles,requestMode} from '../src/chat-routing.js';import {LOCAL_READ_EXTENSIONS} from '../src/local-file-types.js';import {DEFAULTS} from '../src/defaults.js';import {LocalFiles} from '../desktop/local-files.mjs';import {runFiles} from '../desktop/files-agent.mjs';import {writeJSON} from '../desktop/json-store.mjs';
test('all reader-supported file extensions route direct reading requests to file tools',()=>{
 for(const ext of LOCAL_READ_EXTENSIONS)for(const name of ['fixture'+ext,'FIXTURE'+ext.toUpperCase()])assert.equal(requestMode('Can you read '+name+'?','chat',DEFAULTS),'files',name);
 for(const q of ['Can you read the snooze.c file in lab 4?','Can you go to courses, systems programming, comp, 2310, 2026 LabPack 2, lab 4, and then read dusnews.c file over there?','Now the now can you access the news.c file?','List the folders in lab 4','Inspect the directory','Can you locate snooze.c?'])assert.equal(requestMode(q,'chat',DEFAULTS),'files',q);
});
test('quoted filenames work while quoted instructions, negations, and programming explanations remain chat',()=>{
 for(const q of ['Read "snooze.c"','Read `snooze.c`','Read “snooze.c”',"Read 'snooze.c'",'Check "my lab folder/snooze.c"'])assert(wantsFiles(q),q);
 for(const q of ['"Read snooze.c"','`Read snooze.c`','Explain "read snooze.c"','Translate "Read snooze.c"','```c\nread snooze.c\n```','Do not read snooze.c','Can you not access snooze.c?','How do I read files in C?','What is a C header file?','Explain C programming'])assert(!wantsFiles(q),q);
 assert.equal(requestMode('Explain snooze.c on my screen','chat',DEFAULTS),'screen');assert.equal(requestMode('Click the file on my screen','chat',DEFAULTS),'desktop');
});
test('persisted folder grants survive fresh reader initialization and routed C requests receive real read tools',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'fairy-file-restart-'));t.after(()=>rm(dir,{recursive:true,force:true}));const root=join(dir,'approved'),saved=join(dir,'folders.json');await mkdir(join(root,'lab4','src'),{recursive:true});await writeFile(join(root,'lab4','src','snooze.c'),'unsigned int snooze(unsigned int secs) { return secs; }\n');
 const options={read:async()=>{try{return JSON.parse(await readFile(saved,'utf8'));}catch{return[];}},write:v=>writeJSON(saved,v)};
 const first=new LocalFiles(options);await first.load();await first.add(root);const id=first.status()[0].id;
 const restarted=new LocalFiles(options);await restarted.load();assert.equal(restarted.status()[0].id,id);assert.equal(requestMode('Can you read the snooze.c file in lab 4?','chat',DEFAULTS),'files');
 let calls=0;const provider={deepseekKey:()=> 'fixture',request:async(_url,options)=>{const body=JSON.parse(options.body);assert(body.tools.some(t=>t.function.name==='files_read'));assert(!body.tools.some(t=>t.function.name==='files_write'));assert(!body.messages.some(m=>m.content?.includes('Earlier unsupported denial')));let message;
 if(calls++===0)message={content:'',tool_calls:[{id:'read',type:'function',function:{name:'files_read',arguments:JSON.stringify({rootId:id,path:'lab4/src/snooze.c'})}}]};else {assert(body.messages.some(m=>m.role==='tool'&&m.content.includes('unsigned int snooze')));message={content:'The file defines snooze with an unsigned integer parameter.'};}return Response.json({choices:[{message}]});}};
 const result=await runFiles({provider,settings:DEFAULTS,files:restarted,text:'Can you read the snooze.c file in lab 4?',history:[{role:'assistant',mode:'chat',content:'Earlier unsupported denial: I have no file access.'}]});assert.equal(calls,2);assert.match(result,/Sources inspected:/);await restarted.remove(id);await assert.rejects(restarted.read({rootId:id,path:'lab4/src/snooze.c'}),/removed/);
});
