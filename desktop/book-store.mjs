import { openSync, readSync, closeSync } from 'node:fs';
import { writeFile, rename } from 'node:fs/promises';

// The book worker's passages, kept compactly (efficiency audit, after fix 12). The build thread collects them as
// strings; what it hands to the search thread is their text as UTF-8 in one disk-backed file (or buffer in memory),
// avoiding holding tens of MB of passage strings in V8/heap memory while idle. A passage's title and link are made
// only when it's returned as a hit.
export class BookStore {
  // While building, texts are kept as the strings they arrived as: that memory is the build thread's, and goes with it.
  constructor(){this.strings=[];this.text=null;this.textPath=null;this.ends=null;this.ids=[];this.pages=[];this.files=[];this.fileList=[];this.index=new Map();}
  get size(){return this.ids.length;}
  // A book's path and revision once, for all its passages; returns the number add() takes.
  file(path,revision){this.fileList.push({path,revision});return this.fileList.length-1;}
  add(id,answer,page,file){
    if(this.index.has(id))return;
    this.index.set(id,this.ids.length);this.strings.push(String(answer));this.ids.push(id);this.pages.push(page);this.files.push(file);
  }
  answer(at){
    if(this.text)return this.text.toString('utf8',at?this.ends[at-1]:0,this.ends[at]);
    if(this.textPath){
      const start=at?this.ends[at-1]:0,len=this.ends[at]-start;
      if(len<=0)return '';
      try{
        const fd=openSync(this.textPath,'r');
        try{
          const buf=Buffer.alloc(len);
          const read=readSync(fd,buf,0,len,start);
          return buf.toString('utf8',0,read);
        }finally{closeSync(fd);}
      }catch{return '';}
    }
    return this.strings[at];
  }
  // What BookPassages indexes: each passage's id, page and book, with its text read when asked for.
  *items(){const store=this;for(let at=0;at<this.ids.length;at++)yield {id:this.ids[at],page:this.pages[at],path:this.fileList[this.files[at]].path,get answer(){return store.answer(at);}};}
  // A passage as search returns it, with its title and link made by describe(path, page).
  get(id,describe){const at=this.index.get(id);if(at===undefined)return undefined;const {path,revision}=this.fileList[this.files[at]],page=this.pages[at];
    const {question,source}=describe(path,page);return {id,answer:this.answer(at),page,question,path,revision,source};}
  // Packs passage strings into UTF-8 bytes and an end-offset table shared by in-memory and disk-backed transfers.
  #pack(){let bytes=0;const ends=new Uint32Array(this.ids.length);for(let at=0;at<this.strings.length;at++)ends[at]=bytes+=Buffer.byteLength(this.strings[at]);
    const text=new Uint8Array(bytes),view=Buffer.from(text.buffer);for(let at=0,from=0;at<this.strings.length;at++)from+=view.write(this.strings[at],from);
    return {text,ends};}
  // Plain data to hand to another thread, its arrays exactly sized so they can be transferred; fromData takes it back.
  toData(){const {text,ends}=this.#pack();
    return {text,ends,ids:this.ids,pages:this.pages,files:this.files,fileList:this.fileList};}
  // Writes packed UTF-8 passages atomically to disk so the main thread does not retain them in RAM while idle.
  async toDiskData(textPath){const {text,ends}=this.#pack(),temp=`${textPath}.tmp`;
    await writeFile(temp,text,{mode:0o600});await rename(temp,textPath);
    return {text:null,textPath,ends,ids:this.ids,pages:this.pages,files:this.files,fileList:this.fileList};}
  static transfers(data){return data.text?[data.text.buffer,data.ends.buffer]:[data.ends.buffer];}
  static fromData(data){const store=Object.create(BookStore.prototype);
    Object.assign(store,{strings:null,text:data.text?Buffer.from(data.text.buffer,data.text.byteOffset,data.text.byteLength):null,textPath:data.textPath||null,ends:data.ends,ids:data.ids,pages:data.pages,files:data.files,fileList:data.fileList});
    store.index=new Map(data.ids.map((id,at)=>[id,at]));return store;}
  clear(){this.strings=[];this.text=null;this.textPath=null;this.ends=null;this.ids=[];this.pages=[];this.files=[];this.fileList=[];this.index.clear();}
}
