// Loudness is heard on a curve, so a slider half way along should sound about half as loud.
export const speechGain=percent=>{const value=Number(percent);return Number.isFinite(value)?Math.min(1,Math.max(0,value/100))**2:1;};

// One owner for each clip, including startup that is still awaiting resume/play.
export class ClipPlayback {
  constructor({context, allowed=()=>true, onStart=()=>{}, onLevel=()=>{}, gain=1}) {
    Object.assign(this,{context,allowed,onStart,onLevel,gain});
    this.stopped=false;this.cleanups=[];this.frame=null;this.timer=null;
    this.ended=new Promise((resolve,reject)=>{this.resolve=resolve;this.reject=reject;});
    // Errors may arrive before startup finishes installing its await.
    this.ended.catch(()=>{});
  }
  pause() {
    if(this.stopped)return;
    this.stopped=true;cancelAnimationFrame(this.frame);clearTimeout(this.timer);
    this.frame=this.timer=null;
    for(const cleanup of this.cleanups.splice(0).reverse()){try{cleanup();}catch{}}
    this.resolve();
  }
  own(node){this.cleanups.push(()=>node.disconnect());return node;}
  setGain(value){this.gain=value;this.output?.gain.setTargetAtTime(value,this.context.currentTime,.015);}
  async play({buffer,bytes,offset=0,duration=buffer?.duration,volume=1,maxSeconds=0}) {
    try {
      await Promise.race([this.context.resume(),this.ended]);
      if(this.stopped || !this.allowed())return;
      // Volume comes after the analyser, so her mouth moves the same however loud she's set.
      const output=this.output=this.own(this.context.createGain());output.gain.value=this.gain;output.connect(this.context.destination);
      const analyser=this.own(this.context.createAnalyser());analyser.fftSize=256;
      analyser.connect(output);
      const samples=new Uint8Array(analyser.fftSize);
      const animate=()=>{
        if(this.stopped)return;
        if(!this.allowed()){this.pause();return;}
        analyser.getByteTimeDomainData(samples);
        let energy=0;for(const value of samples)energy+=((value-128)/128)**2;
        this.onLevel(Math.min(1,Math.sqrt(energy/samples.length)*6));
        this.frame=requestAnimationFrame(animate);
      };
      if(buffer){
        const source=this.own(this.context.createBufferSource()),gain=this.own(this.context.createGain());
        this.cleanups.push(()=>{source.onended=null;try{source.stop();}catch{}source.buffer=null;});
        source.buffer=buffer;source.connect(gain);gain.connect(analyser);source.onended=this.resolve;
        const at=this.context.currentTime,fade=Math.min(.004,duration/4);
        gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(1,at+fade);
        gain.gain.setValueAtTime(1,at+duration-fade);gain.gain.linearRampToValueAtTime(0,at+duration);
        source.start(at,offset,duration);this.onStart();animate();
      }else{
        const url=URL.createObjectURL(new Blob([bytes],{type:'audio/mpeg'}));
        this.cleanups.push(()=>URL.revokeObjectURL(url));
        const media=new Audio(url);
        this.cleanups.push(()=>{media.onended=media.onpause=media.onerror=null;media.pause();media.removeAttribute('src');media.load();});
        media.volume=volume;this.own(this.context.createMediaElementSource(media)).connect(analyser);
        media.onended=media.onpause=this.resolve;
        media.onerror=()=>this.reject(new Error('Unable to play generated audio.'));
        void media.play().then(()=>{
          if(this.stopped)return;
          if(!this.allowed()){this.pause();return;}
          this.onStart();animate();
          if(maxSeconds)this.timer=setTimeout(()=>this.pause(),maxSeconds*1000);
        },this.reject).catch(this.reject);
      }
      await this.ended;
    } finally {this.pause();}
  }
}
