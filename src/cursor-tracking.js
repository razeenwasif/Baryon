// Directional artwork, with a dead zone and dwell to prevent boundary jitter.
export function cursorFrame(x,y){
  if(!Number.isFinite(x)||!Number.isFinite(y)||Math.hypot(x,y)<32)return null;
  const a=Math.atan2(y,x)*180/Math.PI;
  if(a>=35&&a<=145)return 5;
  if(a>145||a<=-157.5)return 0;
  if(a<-112.5)return 1;
  if(a<-67.5)return 2;
  if(a<-22.5)return 3;
  return 4;
}
export class CursorGaze {
  constructor(){this.reset();}
  reset(){this.frame=null;this.candidate=null;this.dwell=0;this.age=Infinity;this.x=this.y=null;}
  point(x,y,head){
    if(!head||!Number.isFinite(x)||!Number.isFinite(y)){this.reset();return;}
    if(this.x===null||Math.hypot(x-this.x,y-this.y)>2){this.age=0;this.x=x;this.y=y;}
    const next=cursorFrame(x-head.x,y-head.y);
    if(next!==this.candidate){this.candidate=next;this.dwell=0;}
  }
  tick(dt,allowed=true){
    if(!allowed){this.reset();return null;}
    dt=Math.max(0,Math.min(.1,dt));this.age+=dt;this.dwell+=dt;
    if(this.age>3){this.frame=null;return null;}
    if(this.dwell>=.12)this.frame=this.candidate;
    return this.frame;
  }
}
// Piggybacks on the renderer clock. One request in flight, no standalone timer.
export class CursorSampler {
  constructor({read,eligible,update,interval=()=>.1}){Object.assign(this,{read,eligible,update,interval});this.wait=0;this.epoch=0;this.running=false;this.pending=false;this.disposed=false;this.stationary=0;}
  tick(dt){
    if(this.disposed)return;
    if(!this.eligible()){if(this.running)this.cancel();return;}
    if(!this.running){this.running=true;this.wait=0;}
    this.wait-=Math.max(0,Math.min(.1,dt));if(this.wait>0||this.pending)return;
    this.wait=this.stationary>=1?.5:Math.max(.1,this.interval());this.pending=true;const epoch=this.epoch;
    Promise.resolve().then(()=>this.read()).then(point=>{
      if(this.disposed||epoch!==this.epoch||!this.eligible())return;
      if(point&&this.previous&&point.x===this.previous.x&&point.y===this.previous.y)this.stationary+=this.wait>0?this.wait:.1;else this.stationary=0;
      this.previous=point;this.update(point);
    }).catch(()=>{if(!this.disposed&&epoch===this.epoch){this.update(null);this.wait=2;}}).finally(()=>{this.pending=false;});
  }
  cancel(){this.running=false;this.epoch++;this.previous=null;this.stationary=0;this.wait=0;this.update(null);}
  dispose(){this.disposed=true;this.cancel();}
}
