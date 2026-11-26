// One cancellable deadline + display-synchronized callback per active renderer.
export class FrameLoop {
  constructor(draw, {fps=30, now=()=>performance.now(), request=cb=>requestAnimationFrame(cb), cancel=id=>cancelAnimationFrame(id), schedule=(cb,ms)=>setTimeout(cb,ms), clear=id=>clearTimeout(id)}={}) {
    Object.assign(this,{draw,fps,now,request,cancel,schedule,clear});this.running=false;this.raf=null;this.timer=null;
    this.tick=time=>{this.raf=null;if(!this.running)return;const dt=Math.min(.1,Math.max(0,(time-this.last)/1000));this.last=time;
      this.draw(time,dt);if(this.running)this.timer=this.schedule(()=>{this.timer=null;if(this.running)this.raf=this.request(this.tick);},Math.max(0,1000/this.fps-(this.now()-time)-2));};
  }
  setRunning(value) {
    if(this.running===value)return;this.running=value;
    if(value){this.last=this.now();this.raf=this.request(this.tick);}
    else {if(this.raf!==null)this.cancel(this.raf);if(this.timer!==null)this.clear(this.timer);this.raf=this.timer=null;}
  }
  setFPS(value){if(Number.isFinite(value)&&value>0)this.fps=Math.max(1,Math.min(60,value));}
  dispose(){this.setRunning(false);this.draw=()=>{};}
}
