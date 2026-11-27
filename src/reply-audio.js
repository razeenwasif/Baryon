import {joinDelay} from './speech-audio.js';

// Keep at most the playing clip and one decoded clip ahead. The remaining
// compressed audio has explicit limits; a runaway stream fails visibly.
export class ReplyAudio {
  constructor({play, allowed, prepare=async part=>part, now=()=>performance.now(), maxBytes=32*1024*1024, maxParts=128}) {
    Object.assign(this, {play, allowed, prepare, now, maxBytes, maxParts});
    this.queue=[]; this.bytes=0; this.last=-1; this.cancelled=false; this.error=null;
    this.preparedCount=0; this.chain=Promise.resolve(); this.running=false;
    this.waiters=new Set();
  }
  push(part) {
    if(this.cancelled || this.error || part.sequence<=this.last)return;
    if(!this.allowed()){this.cancel();return;}
    const bytes=part.bytes?.byteLength ?? part.bytes?.length ?? 0;
    if(this.queue.length>=this.maxParts || this.bytes+bytes>this.maxBytes){
      this.error=new Error('Voice queue reached its memory limit. The full reply is still available as text.');
      this.cancel();return;
    }
    this.last=part.sequence;this.bytes+=bytes;
    this.queue.push({part,bytes,prepared:null});
    this.prefetch();
    this.startPump();
  }
  startPump(){
    if(this.running || this.cancelled)return;
    this.running=true;
    this.chain=this.pump().catch(error=>{this.error=error;this.cancel();}).finally(()=>{
      this.running=false;if(this.queue.length&&!this.cancelled)this.startPump();
    });
  }
  prefetch() {
    for(const entry of this.queue){
      if(this.preparedCount>=2 || this.cancelled)return;
      if(entry.prepared)continue;
      this.preparedCount++;
      entry.prepared=Promise.resolve().then(async()=>{
        if(this.cancelled || !this.allowed())return null;
        const part=entry.part;entry.part=null;
        const ready=await this.prepare(part);
        return this.cancelled || !this.allowed()?null:ready;
      }).catch(error=>{this.error=error;this.cancel();return null;});
    }
  }
  async waitFor(promise) {
    if(this.cancelled)return null;
    let wake;
    const stopped=new Promise(resolve=>{wake=resolve;this.waiters.add(wake);});
    try{return await Promise.race([promise,stopped]);}
    finally{this.waiters.delete(wake);}
  }
  async pump() {
    while(this.queue.length && !this.cancelled){
      if(!this.allowed()){this.cancel();break;}
      const entry=this.queue[0];
      let ready=await this.waitFor(entry.prepared);
      if(!ready || this.cancelled || !this.allowed()){this.cancel();break;}
      const delay=joinDelay(ready,this.previous,this.now());
      if(delay)await this.waitFor(new Promise(resolve=>{this.timer=setTimeout(resolve,delay);}));
      clearTimeout(this.timer);this.timer=null;
      if(this.cancelled || !this.allowed()){ready=null;this.cancel();break;}
      await this.waitFor(this.play(ready));
      if(this.cancelled)break;
      this.previous={endedAt:this.now(),trailingMs:ready.trailingMs||0};
      ready=null;entry.prepared=null;this.queue.shift();this.bytes-=entry.bytes;this.preparedCount--;
      this.prefetch();
    }
  }
  async finish(){while(this.running)await this.chain;if(this.error)throw this.error;}
  cancel(){
    if(this.cancelled)return;
    this.cancelled=true;clearTimeout(this.timer);this.timer=null;for(const wake of this.waiters)wake(null);this.waiters.clear();
    for(const entry of this.queue){entry.part=null;entry.prepared=null;}
    this.queue.length=0;this.bytes=0;this.preparedCount=0;this.previous=null;
  }
}
