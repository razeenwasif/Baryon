// All durations use the existing renderer clock; hidden time never catches up.
export const COMPANION_KINDS=['headphones','hair','halo','sleep','legs','stars','yawn'];
export class CompanionAnimation {
  constructor(random=Math.random){this.random=random;this.kind=null;this.time=0;this.inactivity=0;this.nextNap=600;this.snooze=0;this.nextGesture='hair';this.output={kind:null,frame:0};this.defer();}
  defer(){this.gestureIn=55+this.random()*55;this.legsIn=360+this.random()*180;this.starsIn=150+this.random()*150;}
  play(kind,manual=false){if(!COMPANION_KINDS.includes(kind))return false;this.kind=kind;this.manual=manual;this.time=0;this.snooze=0;this.duration=kind==='yawn'?7.2:kind==='stars'?7:kind==='sleep'?57.2:kind==='legs'?30:kind==='hair'?3.8:kind==='halo'?4.2:manual?8:Infinity;return true;}
  interact(){this.inactivity=0;this.nextNap=600;if(this.kind==='sleep')this.stop();}
  stop(snooze=0){if(this.kind==='sleep')this.nextNap=this.inactivity+600;this.kind=null;this.manual=false;this.time=0;this.snooze=snooze;this.defer();}
  tick(dt,{allowed=true,napAllowed=allowed,available=true,music=false,enabled=true,reduced=false,ready=true}={}){
    dt=Math.max(0,Math.min(.1,dt));this.inactivity+=dt;this.snooze=Math.max(0,this.snooze-dt);
    // Nap eligibility follows explicit interaction, independently of hover/idle poses.
    if(!this.kind && napAllowed && available && enabled && !reduced && !music && this.snooze===0 && this.inactivity>=this.nextNap)this.play('sleep');
    if(!(this.kind==='sleep'?napAllowed:allowed) || reduced || (!enabled&&!this.manual)){if(this.kind)this.stop();return this.sample();}
    if(this.snooze>0)return this.sample();
    if(music && (!this.kind || !this.manual) && available){if(this.kind!=='headphones')this.play('headphones');}
    if(!music && this.kind==='headphones' && !this.manual)this.stop();
    if(this.kind){
      if(ready)this.time+=dt;
      if(this.time>=this.duration){const was=this.kind;this.kind=null;this.manual=false;this.time=0;
        if(was==='hair'||was==='halo'){this.nextGesture=was==='hair'?'halo':'hair';this.gestureIn=55+this.random()*55;}
        if(was==='legs')this.legsIn=360+this.random()*180;
        if(was==='sleep')this.nextNap=this.inactivity+600;
        if(was==='stars')this.starsIn=150+this.random()*150;
      }
      return this.sample();
    }
    if(music)return this.sample();
    if(!available)return this.sample();
    this.gestureIn-=dt;this.legsIn-=dt;this.starsIn-=dt;
    if(this.legsIn<=0)this.play('legs');
    else if(this.starsIn<=0)this.play('stars');
    else if(this.gestureIn<=0)this.play(this.nextGesture);
    return this.sample();
  }
  sample(){
    const t=this.time,k=this.kind;let frame=0,sheet=k,phase=null;
    if(k==='yawn')frame=Math.min(7,Math.floor(t/.9));
    else if(k==='stars')frame=t<.45?0:t<1.15?1:t<2.05?2:t<3.25?3:t<4.15?4:t<5.15?5:t<6.1?6:7;
    else if(k==='headphones')frame=Math.floor(t/.22)%8;
    else if(k==='hair')frame=Math.min(7,Math.floor(t/.45));
    else if(k==='halo')frame=Math.min(9,Math.floor(t/.4));
    else if(k==='legs')frame=t<.6||t>29.4?0:Math.floor((t-.6)/.35)%8;
    else if(k==='sleep'){
      if(t<3.2){sheet='yawn';phase='yawn';frame=Math.min(3,Math.floor(t/.8));}
      else if(t>=53.2){sheet='yawn';phase='stretch';frame=Math.min(7,4+Math.floor((t-53.2)) );}
      else {phase='sleep';const s=t-3.2;frame=s<3?Math.min(5,Math.floor(s/.5)):s<47?[5,6,7,6][Math.floor((s-3)/3)%4]:Math.max(0,5-Math.floor((s-47)/.5));}
    }
    this.output.kind=k;this.output.frame=frame;this.output.sheet=sheet;this.output.phase=phase;return this.output;
  }
}
