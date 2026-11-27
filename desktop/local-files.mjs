import { FileByteCache, fileRevision, readHandleBytes } from './file-cache.mjs';
import { realpath, readdir, open, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, relative, isAbsolute, extname, basename, sep } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { nativeBin } from './bundle-path.cjs';
import {LOCAL_TEXT_EXTENSIONS,LOCAL_MORE_TEXT_EXTENSIONS,LOCAL_IMAGE_EXTENSIONS} from '../src/local-file-types.js';
const TEXT = new Set([...LOCAL_TEXT_EXTENSIONS,...LOCAL_MORE_TEXT_EXTENSIONS]);
const IMAGE = new Set(LOCAL_IMAGE_EXTENSIONS);
const EXCLUDED = new Set(['node_modules','vendor','dist','build','release','__pycache__','venv','env','private','credentials']);
const hidden = path => path.split(/[\\/]/).some(p => p.startsWith('.') || EXCLUDED.has(p.toLowerCase()) || /^(?:id_rsa|id_ed25519|credentials|secrets?|tokens?|keys)(?:\.|$)/i.test(p));
const supported = path => TEXT.has(extname(path).toLowerCase()) || IMAGE.has(extname(path).toLowerCase()) || extname(path).toLowerCase() === '.pdf';
export const canRead = supported, excludedPath = hidden;
const inside = (root, path) => { const r = relative(root, path); return r === '' || (!isAbsolute(r) && r !== '..' && !r.startsWith('..' + sep)); };
const boundedInt = (v, fallback, max) => { if(v === undefined) return fallback; if(!Number.isInteger(v) || v < 1 || v > max) throw Error('Invalid page or line range.'); return v; };
export function sourceLink(rootId, path, start = 1, page = false) {
  return `lyra-file://${rootId}/${Buffer.from(path).toString('base64url')}?${page ? 'page' : 'line'}=${start}`;
}
export function parseSourceLink(value) {
  if(typeof value !== 'string' || value.length > 4000) throw Error('Invalid file source.');
  const u = new URL(value);
  if(u.protocol !== 'lyra-file:' || u.username || u.password || u.port || !/^[a-f0-9-]{36}$/.test(u.hostname) || !/^\/[A-Za-z0-9_-]+$/.test(u.pathname)) throw Error('Invalid file source.');
  const path = Buffer.from(u.pathname.slice(1),'base64url').toString('utf8');
  return {rootId:u.hostname, path, start: boundedInt(Number(u.searchParams.get('page') || u.searchParams.get('line') || 1),1,1000000), page:u.searchParams.has('page')};
}
export function notebookText(text) {
  const data = JSON.parse(text); if(!Array.isArray(data.cells)) throw Error('This is not a supported notebook.');
  return data.cells.slice(0,1000).map((c,i)=> {
    const source = Array.isArray(c.source) ? c.source.join('') : String(c.source || '');
    const outputs = (c.outputs || []).slice(0,20).map(o=>o.text || o.data?.['text/plain'] || (o.ename ? `${o.ename}: ${o.evalue || ''}` : '')).map(o=>Array.isArray(o)?o.join(''):String(o)).join('\n').slice(0,16000);
    return `[Cell ${i+1}: ${c.cell_type}]\n${source.slice(0,32000)}${outputs ? '\n[Saved output; not rerun]\n'+outputs : ''}`;
  }).join('\n\n');
}
export function runDocumentHelper(payload, signal, descriptor) {
  signal?.throwIfAborted();
  return new Promise((res, rej) => {
    const child=spawn(nativeBin('fairy-document'), [], {stdio:descriptor===undefined?['pipe','pipe','pipe']:['pipe','pipe','pipe',descriptor], signal});
    let out='', settled=false;
    const timer=setTimeout(()=>{child.kill();finish(Error('Document reading timed out. Try fewer pages.'));},15000);
    const finish=(e,v)=>{if(settled)return;settled=true;clearTimeout(timer);e?rej(e):res(v);};
    child.stdout.on('data',chunk=>{out+=chunk; if(out.length>12*1024*1024){child.kill();finish(Error('Document output is too large.'));}});
    child.stderr.resume(); child.stdin.on('error',()=>{});
    child.on('error',()=>finish(Error('Document reader unavailable or stopped.')));
    child.on('close',code=>{try{signal?.throwIfAborted();const v=JSON.parse(out);if(code!==0 || v.error)throw Error(v.error || 'Document could not be read.');finish(null,v);}catch(e){finish(e);}});
    child.stdin.end(JSON.stringify(payload));
  });
}
export class LocalFiles {
  constructor({read,write,documentReader=runDocumentHelper,readBytes=readHandleBytes,cache=new FileByteCache()}) { Object.assign(this,{readSaved:read,writeSaved:write,documentReader,readBytes,cache}); this.roots=[];this.epoch=0;this.cacheEpoch=0; }
  clearCache(){this.cacheEpoch++;this.cache.clear();}
  async load(){this.epoch++;this.clearCache();const saved=await this.readSaved();this.roots=Array.isArray(saved)?saved.filter(r=>/^[a-f0-9-]{36}$/.test(r.id)&&typeof r.path==='string'&&isAbsolute(r.path)).slice(0,12):[];return this.status();}
  status(){return this.roots.map(r=>({...r,name:r.name||basename(r.path)}));}
  // The same reader, also seeing attached files. They stay out of the saved list and Settings.
  including(roots){const view=Object.create(this);view.roots=[...this.roots,...roots];return view;}
  only(roots){const view=Object.create(this);view.roots=roots;return view;}
  async add(path){const canonical=await realpath(path);if(!(await stat(canonical)).isDirectory())throw Error('Choose a folder.');if(this.roots.some(r=>r.path===canonical))return this.status();if(this.roots.length>=12)throw Error('Remove a folder before adding another.');const next=[...this.roots,{id:randomUUID(),path:canonical}];await this.writeSaved(next);this.roots=next;this.epoch++;this.clearCache();return this.status();}
  async remove(id){const next=this.roots.filter(r=>r.id!==id);await this.writeSaved(next);this.roots=next;this.epoch++;this.clearCache();return this.status();}
  async checked(rootId,path='') {
    const root=this.roots.find(r=>r.id===rootId);if(!root)throw Error('Folder access was removed or has not been approved.');
    if(typeof path!=='string'||path.length>2048||path.includes('\0')||isAbsolute(path)||path.split(/[\\/]/).includes('..')||hidden(path))throw Error('This path is outside the allowed file selection.');
    if(await realpath(root.path)!==root.path)throw Error('Approved folder moved or changed. Add it again.');
    const full=await realpath(resolve(root.path,path));if(!inside(root.path,full)||hidden(relative(root.path,full)))throw Error('File points outside the approved folder or into an excluded directory.');
    return {root,full,path:relative(root.path,full)};
  }
  async bytes(rootId,path,signal) {
    signal?.throwIfAborted();const epoch=this.epoch,cacheEpoch=this.cacheEpoch;const found=await this.checked(rootId,path);
    if(!supported(found.path))throw Error('Unsupported file type. Use text, code, notebooks, PDFs, CSV/JSON, or PNG/JPEG/WebP.');
    const handle=await open(found.full,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    try {
      const before=await handle.stat({bigint:true});if(!before.isFile()||before.size>20n*1024n*1024n)throw Error('Choose a regular file under 20 MB.');
      const revision=fileRevision(before),key=`${rootId}:${found.full}`;
      const cacheable=TEXT.has(extname(found.path).toLowerCase()) && before.size<=1024n*1024n;
      const cached=cacheable?this.cache.get(key,revision):null;
      const bytes=cached ?? await this.readBytes(handle,Number(before.size),signal);
      const after=await handle.stat({bigint:true}),again=await this.checked(rootId,path),current=await stat(again.full,{bigint:true});
      if(epoch!==this.epoch||BigInt(bytes.length)!==before.size||revision!==fileRevision(after)||revision!==fileRevision(current)||again.full!==found.full){this.cache.delete(key);throw Error('File or folder access changed during reading. Try again.');}
      signal?.throwIfAborted();
      if(cacheable&&!cached&&cacheEpoch===this.cacheEpoch)this.cache.set(key,revision,bytes);
      return {...found,bytes,modifiedAt:new Date(Number(after.mtimeNs/1000000n)).toISOString()};
    } finally {await handle.close();}
  }
  // Only an already-open, authorized PDF descriptor crosses into the parser.
  async withPDF(rootId,path,signal,consume) {
    signal?.throwIfAborted();const epoch=this.epoch,found=await this.checked(rootId,path);
    if(extname(found.path).toLowerCase()!=='.pdf')throw Error('Choose a PDF.');
    const handle=await open(found.full,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    try {
      const before=await handle.stat({bigint:true});
      if(!before.isFile()||before.size<=0n||before.size>256n*1024n*1024n)throw Error('Choose a regular PDF under 256 MB.');
      const result=await consume(handle.fd);signal?.throwIfAborted();
      const after=await handle.stat({bigint:true}),again=await this.checked(rootId,path),current=await stat(again.full,{bigint:true});
      if(epoch!==this.epoch||fileRevision(before)!==fileRevision(after)||fileRevision(before)!==fileRevision(current)||again.full!==found.full)throw Error('PDF or folder access changed during reading.');
      return {...result,rootId,path:found.path,modifiedAt:new Date(Number(after.mtimeNs/1000000n)).toISOString()};
    }finally{await handle.close();}
  }
  async list({rootId,path=''}={},signal) {
    const found=await this.checked(rootId,path);const entries=await readdir(found.full,{withFileTypes:true});const items=[];
    for(const e of entries.sort((a,b)=>a.name.localeCompare(b.name))){signal?.throwIfAborted();if(hidden(e.name)||e.isSymbolicLink()||(!e.isDirectory()&&!e.isFile())||e.isFile()&&!supported(e.name))continue;items.push({path:relative(found.root.path,resolve(found.full,e.name)),kind:e.isDirectory()?'folder':'file'});if(items.length>=200)break;}
    return {rootId,path:found.path,items,truncated:entries.length>200,note:'Hidden, credential, dependency, unsupported, and symbolic-link entries are excluded. Use a returned folder path to inspect deeper.'};
  }
  async search({rootId,path='',query,offset=0}={},signal) {
    if(typeof query!=='string'||!query.trim()||query.length>200||!Number.isInteger(offset)||offset<0||offset>5000)throw Error('Use a search query of 1–200 characters and a valid offset.');
    const base=await this.checked(rootId,path), terms=query.toLowerCase().split(/\s+/).filter(Boolean).slice(0,8);const queue=[base.path], paths=[];let visited=0,truncated=false;
    while(queue.length&&visited<6000&&paths.length<5000){signal?.throwIfAborted();const dir=await this.checked(rootId,queue.shift());const entries=await readdir(dir.full,{withFileTypes:true});for(const e of entries.sort((a,b)=>a.name.localeCompare(b.name))){if(++visited>6000){truncated=true;break;}if(hidden(e.name)||e.isSymbolicLink())continue;const p=relative(base.root.path,resolve(dir.full,e.name));if(e.isDirectory())queue.push(p);else if(e.isFile()&&supported(p))paths.push(p);if(paths.length>=5000){truncated=true;break;}}}
    truncated ||= queue.length>0;const results=[];let skipped=0;
    for(const p of paths.slice(offset,offset+160)) {
      signal?.throwIfAborted();let snippet='',line=1;const nameScore=terms.filter(t=>p.toLowerCase().includes(t)).length;
      if(TEXT.has(extname(p).toLowerCase()))try {
        const checked=await this.checked(rootId,p);if((await stat(checked.full)).size<=1024*1024){const f=await this.bytes(rootId,p,signal);let text=f.bytes.toString('utf8');if(extname(p).toLowerCase()==='.ipynb')text=notebookText(text);if(!text.includes('\0')){const lines=text.split(/\r?\n/);const i=lines.findIndex(l=>terms.some(t=>l.toLowerCase().includes(t)));if(i>=0){line=i+1;snippet=lines.slice(Math.max(0,i-1),i+2).join('\n').slice(0,600);}}}else skipped++;
      }catch(e){signal?.throwIfAborted();skipped++;}
      if(nameScore||snippet)results.push({rootId,path:p,line,snippet,score:nameScore*3+(snippet?1:0),source:sourceLink(rootId,p,line)});
    }
    results.sort((a,b)=>b.score-a.score||a.path.localeCompare(b.path));
    return {results:results.slice(0,30),nextOffset:offset+160<paths.length?offset+160:null,truncated:truncated||results.length>30,skipped,note:'Searches filenames plus text/code/notebook contents up to 1 MB. PDF/image contents are not searched; read matching PDFs and inspect images separately. Narrow the folder/query if results are partial.'};
  }
  async read({rootId,path,start=1,count=120}={},signal) {
    start=boundedInt(start,1,1000000);count=boundedInt(count,120,250);
    if(extname(path||'').toLowerCase()==='.pdf') {
      const data=await this.withPDF(rootId,path,signal,fd=>this.documentReader({descriptor:true,start,count:Math.min(count,64)},signal,fd));
      return {...data,pages:data.pages?.map(p=>({...p,source:sourceLink(rootId,data.path,p.page,true)})),source:sourceLink(rootId,data.path,start,true),note:'PDF page numbers are one-based. Extraction may lose equation layout. Use files_image for diagrams and scans.'};
    }
    const f=await this.bytes(rootId,path,signal),ext=extname(f.path).toLowerCase();
    if(IMAGE.has(ext))throw Error('Use files_image to inspect this image.');
    let text=f.bytes.toString('utf8');if(text.includes('\0'))throw Error('This file contains binary data.');if(ext==='.ipynb')text=notebookText(text);
    const lines=text.split(/\r?\n/);if(start>lines.length)throw Error(`File has ${lines.length} lines.`);
    let used=0;const selected=[];for(let i=start-1;i<Math.min(lines.length,start-1+count);i++){let l=`${i+1}: ${lines[i]}`;if(used+l.length>16000){if(!selected.length)selected.push(l.slice(0,16000)+' [line truncated]');break;}selected.push(l);used+=l.length+1;}
    return {rootId,path:f.path,modifiedAt:f.modifiedAt,revision:createHash('sha256').update(f.bytes).digest('hex'),start,totalLines:lines.length,text:selected.join('\n'),truncated:start-1+selected.length<lines.length,nextStart:start+selected.length,source:sourceLink(rootId,f.path,start),note:ext==='.ipynb'?'Line numbers refer to this extracted cell listing; cell numbers are included. Cells were not executed.':'Re-read on follow-ups to check changes. Large CSV/JSON is shown as bounded source excerpts.'};
  }
  // size is the picture's longest side: 1600 by default, which is what a model gets, and up to 3200 for reading in the window.
  // ink draws a PDF page in Fairy's look: see-through paper and light words (see native/Document.swift).
  async image({rootId,path,page=1,size=1600,ink=false}={},signal) {
    page=boundedInt(page,1,10000);size=Math.min(3200,Math.max(800,Math.round(Number(size))||1600));
    if(extname(path||'').toLowerCase()==='.pdf') {
      const data=await this.withPDF(rootId,path,signal,fd=>this.documentReader({descriptor:true,image:true,pdf:true,start:page,size,...(ink?{ink:true}:{})},signal,fd));
      return {...data,source:sourceLink(rootId,data.path,page,true)};
    }
    const f=await this.bytes(rootId,path,signal),ext=extname(f.path).toLowerCase();if(ext!=='.pdf'&&!IMAGE.has(ext))throw Error('Only supported images or PDF pages can be viewed.');
    const epoch=this.epoch;const data=await this.documentReader({data:f.bytes.toString('base64'),image:true,pdf:ext==='.pdf',start:page,size},signal);signal?.throwIfAborted();if(epoch!==this.epoch)throw Error('Folder access changed.');
    return {rootId,path:f.path,modifiedAt:f.modifiedAt,...data,source:sourceLink(rootId,f.path,page,ext==='.pdf')};
  }
  async preview(link,signal,{size,ink}={}){const a=parseSourceLink(link);return IMAGE.has(extname(a.path).toLowerCase())||a.page?this.image({rootId:a.rootId,path:a.path,page:a.start,size,ink:Boolean(ink)},signal):this.read({rootId:a.rootId,path:a.path,start:a.start},signal);}
}
