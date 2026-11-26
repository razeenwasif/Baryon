// Native notifications for power and heat, with no battery polling or disk writes. Whether you're at the Mac has no
// notification, so idle time is read on a timer that's slow while you're here and quick once you're away.
const levels = {unknown:0, nominal:0, fair:1, serious:2, critical:3};
// Efficiency audit, fix 3: with no input for two minutes Fairy behaves as on battery saver, and after ten, or with the
// screen locked, as when the battery is low. A window nobody can see draws nothing at all.
export const IDLE_SECONDS = 120, AWAY_SECONDS = 600;
export function powerPolicy({onBattery=false,thermal='unknown',speedLimit=100,lowPower=false,batteryPercent=null,nativeAvailable=false,idleSeconds=0,locked=false,visible=true}={}) {
  const heat=Math.max(levels[thermal]??0,speedLimit<50?3:speedLimit<80?2:0);
  const lowBattery=onBattery && Number.isFinite(batteryPercent) && batteryPercent<=20;
  // What power and heat allow, and what your being away calls for. Background upkeep (reflection, the notes index) is
  // best done while you're away, so only power and heat pause it.
  const powerLevel=Math.max(lowBattery?2:onBattery||lowPower?1:0,heat);
  const idle=Number.isFinite(idleSeconds)&&idleSeconds>0?idleSeconds:0;
  const away=locked||idle>=AWAY_SECONDS?2:idle>=IDLE_SECONDS?1:0;
  const level=Math.max(powerLevel,away);
  const label=powerLevel>=away
    ?(level===3?'Cooling · background paused':level===2?(heat>=2?'Warm · background paused':'Low battery · background paused'):level===1?(lowPower?'Low Power Mode':onBattery?'Battery saver':'Warm · reduced activity'):'Normal power')
    :(away===2?'Away · background paused':'Idle · reduced activity');
  return Object.freeze({onBattery:Boolean(onBattery),thermal,speedLimit,level,powerLevel,away,visible:visible!==false,lowPower,batteryPercent,nativeAvailable,label,
    // Nothing is drawn where nobody can see it: a hidden or minimized window, or with you away ten minutes.
    fps:visible===false||away===2?0:[30,20,10,0][level],screenMs:[5000,15000,0,0][level],quizMs:[500,1000,0,0][level],playbackMs:[15000,30000,0,0][level],
    optional:level<2,handsFree:level<3,warmProvider:level===0,ideaMultiplier:level?2:1,maintenance:powerLevel<2});
}
export class PowerAwareness {
  // watch: the idle reader's own timer, apart from the recovery deadline's.
  constructor({monitor,changed=()=>{},schedule=setTimeout,clear=clearTimeout,recoveryMs=30000,watch={schedule:setTimeout,clear:clearTimeout},activeEveryMs=30000,awayEveryMs=5000}) {
    Object.assign(this,{monitor,changed,schedule,clear,recoveryMs,watch,activeEveryMs,awayEveryMs});this.listeners=[];this.timer=null;this.idleTimer=null;this.disposed=false;
    this.raw={onBattery:false,thermal:'unknown',speedLimit:100,idleSeconds:0,locked:false,visible:true};this.refresh();this.readIdle();this.current=powerPolicy(this.raw);
    const on=(name,fn)=>{monitor.on(name,fn);this.listeners.push([name,fn]);};
    on('on-battery',()=>this.update({onBattery:true}));on('on-ac',()=>this.update({onBattery:false}));
    on('thermal-state-change',details=>{if(Object.hasOwn(levels,details?.state))this.update({thermal:details.state});});
    on('speed-limit-change',details=>{if(Number.isFinite(details?.limit)&&details.limit>=0&&details.limit<=100)this.update({speedLimit:details.limit});});
    on('lock-screen',()=>this.update({locked:true}));on('unlock-screen',()=>{this.readIdle();this.update({locked:false});});
    on('suspend',()=>{this.sleeping=true;this.cancelRecovery();this.cancelIdle();});
    on('resume',()=>{this.sleeping=false;this.refresh();this.readIdle();this.reconcile();this.watchIdle();});
    this.watchIdle();
  }
  refresh(){try{this.raw.onBattery=Boolean(this.monitor.isOnBatteryPower());}catch{}try{const value=this.monitor.getCurrentThermalState();if(Object.hasOwn(levels,value))this.raw.thermal=value;}catch{}}
  readIdle(){try{const value=Number(this.monitor.getSystemIdleTime());this.raw.idleSeconds=Number.isFinite(value)&&value>=0?value:0;}catch{this.raw.idleSeconds=0;}}
  // Slow while you're here (the next look lands when the two minutes would be up), quick once you're away, so coming
  // back restores everything within a few seconds.
  idleDelay(){const idle=this.raw.idleSeconds;return idle>=IDLE_SECONDS?this.awayEveryMs:Math.max(1000,Math.min(this.activeEveryMs,(IDLE_SECONDS-idle)*1000));}
  watchIdle(){
    this.cancelIdle();if(this.disposed||this.sleeping)return;
    this.idleTimer=this.watch.schedule(()=>{this.idleTimer=null;if(this.disposed||this.sleeping)return;this.readIdle();this.reconcile();this.watchIdle();},this.idleDelay());
    this.idleTimer?.unref?.();
  }
  cancelIdle(){if(this.idleTimer!==null)this.watch.clear(this.idleTimer);this.idleTimer=null;}
  // Whether anyone can see the window: hidden, minimized or on another Space it isn't drawn.
  setVisible(visible){this.update({visible:Boolean(visible)});}
  state(){return this.current;}
  update(value){if(this.disposed)return;Object.assign(this.raw,value);if(!this.sleeping)this.reconcile();}
  cancelRecovery(){if(this.timer!==null)this.clear(this.timer);this.timer=null;}
  publish(next){if(this.disposed)return;if(JSON.stringify(next)!==JSON.stringify(this.current)){this.current=next;this.changed(next);}}
  reconcile(){
    const next=powerPolicy(this.raw);
    // Cooling down or charging up waits out a recovery period, so a flapping sensor can't churn. Coming back to the Mac
    // or bringing the window forward takes effect at once.
    if(next.powerLevel<this.current.powerLevel){
      // One recovery deadline: repeated notifications cannot create timer churn.
      if(this.timer===null)this.timer=this.schedule(()=>{this.timer=null;this.publish(powerPolicy(this.raw));},this.recoveryMs);
      this.timer?.unref?.();return;
    }
    this.cancelRecovery();this.publish(next);
  }
  dispose(){this.disposed=true;this.cancelRecovery();this.cancelIdle();for(const [name,fn] of this.listeners)this.monitor.removeListener(name,fn);this.listeners=[];}
}

// Whether a work turn holds the Mac awake ("Improving existing features", item 2): while one runs and either the
// iPhone link asks for it or the Mac is on mains power. On battery without the link, it may sleep, and the turn picks up
// on waking. A closed lid on battery always sleeps it; this holds off only idle sleep.
export function workAwakeWanted({ running = 0, phoneHolds = false, onBattery = true } = {}) {
  return running > 0 && (phoneHolds || !onBattery);
}
