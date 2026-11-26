// A disabled task owns no timer. Async work is serial and the next deadline is
// scheduled after completion, so a slow request never builds a polling backlog.
export class ConditionalTask {
  constructor({enabled, delay, run, onError=()=>{}, now=Date.now, schedule=(fn,ms)=>setTimeout(fn,ms), clear=id=>clearTimeout(id)}) {
    Object.assign(this,{enabled,delay,run,onError,now,schedule,clear});
    this.timer=null;this.at=null;this.running=false;this.disposed=false;
  }
  sync(restart=false) {
    if(this.disposed)return;
    if(!this.enabled()){this.cancelTimer();return;}
    if(this.running)return;
    if(this.timer!==null && !restart)return;
    const delay=typeof this.delay==='function'?this.delay():this.delay;
    if(!Number.isFinite(delay)){this.cancelTimer();return;}
    const at=this.now()+Math.max(0,delay);
    if(this.timer!==null && Math.abs(this.at-at)<2)return;
    this.cancelTimer();this.at=at;
    this.timer=this.schedule(()=>{this.timer=null;this.at=null;void this.fire();},Math.max(0,delay));
    this.timer?.unref?.();
  }
  async fire() {
    if(this.disposed || this.running || !this.enabled())return;
    this.running=true;
    try {await this.run();} catch(error){this.onError(error);}
    finally {this.running=false;this.sync();}
  }
  cancelTimer(){if(this.timer!==null)this.clear(this.timer);this.timer=null;this.at=null;}
  dispose(){this.disposed=true;this.cancelTimer();}
}
