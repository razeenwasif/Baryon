// On-demand LRU; no polling, watcher, disk mirror or expiry timer. Callers must
// revalidate access and the current file revision before every lookup.
export class FileByteCache {
  constructor({maxBytes=8*1024*1024, maxEntries=128, maxEntryBytes=1024*1024, ttl=60000, now=()=>performance.now()}={}) {
    Object.assign(this, {maxBytes,maxEntries,maxEntryBytes,ttl,now});
    this.entries=new Map(); this.bytes=0;
  }
  delete(key) { const old=this.entries.get(key); if(old){this.bytes-=old.bytes.length;this.entries.delete(key);} }
  get(key, revision) {
    const entry=this.entries.get(key);
    if(!entry)return null;
    if(entry.revision!==revision || this.now()>=entry.expires){this.delete(key);return null;}
    this.entries.delete(key);this.entries.set(key,entry);
    return Buffer.from(entry.bytes);
  }
  set(key, revision, bytes) {
    this.delete(key);
    if(bytes.length>this.maxEntryBytes || bytes.length>this.maxBytes || this.maxEntries<1)return;
    for(const [k,entry] of this.entries)if(this.now()>=entry.expires)this.delete(k);
    while(this.entries.size>=this.maxEntries || this.bytes+bytes.length>this.maxBytes)this.delete(this.entries.keys().next().value);
    this.entries.set(key,{revision,bytes:Buffer.from(bytes),expires:this.now()+this.ttl});this.bytes+=bytes.length;
  }
  clear(){this.entries.clear();this.bytes=0;}
}
export const fileRevision = info => [info.dev,info.ino,info.size,info.mtimeNs,info.ctimeNs].join(':');
export async function readHandleBytes(handle, size, signal) {
  const buffer=Buffer.alloc(size+1);let length=0;
  while(length<buffer.length){signal?.throwIfAborted();const {bytesRead}=await handle.read(buffer,length,buffer.length-length,length);if(!bytesRead)break;length+=bytesRead;}
  // An exact-size result avoids retaining the extra read-sentinel byte.
  return buffer.subarray(0,length);
}
