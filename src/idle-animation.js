// Idle-only clock: background time and busy activities never queue up animations.
export const SITTING = {
  interval: [180, 300], hold: [600, 900], enterFrame: .28, blend: .16,
  expressions: [[0, 3.6], [1, .15], [2, 4.5], [5, 1.2], [6, 4], [1, .15], [0, 5]],
};
const ENTER=['idle',...Array.from({length:8},(_,i)=>`sit-enter-${i}`),'sit-loop-0'];
const EXIT=['sit-loop-0',...Array.from({length:8},(_,i)=>`sit-enter-${7-i}`),'idle'];
const EXPRESSION_TOTAL=SITTING.expressions.reduce((n,[,duration])=>n+duration,0);
const smooth = x => { x = Math.max(0, Math.min(1, x)); return x*x*(3-2*x); };
export class IdleAnimation {
  constructor(random = Math.random) { this.random = random; this.output={from:"idle",to:"idle",mix:0,active:false};this.reset(); }
  range([a,b]) { return a + (b-a)*this.random(); }
  reset() { this.phase = 'idle'; this.time = 0; this.remaining = this.range(SITTING.interval); this.hold = this.range(SITTING.hold); }
  start() { if (this.phase !== 'idle') return false; this.phase = 'enter'; this.time = 0; return true; }
  stop() { if (this.phase === 'seated') { this.exitFrom = this.sample().to; this.phase = 'exit'; this.time = 0; } }
  tick(dt, {eligible = true, visible = true, ready = true} = {}) {
    if (!visible) return this.sample();
    // Brief conversations pause a seated session; explicit Stop, hide and sleep reset it.
    if (!eligible || !ready) return this.sample();
    dt = Math.max(0, Math.min(dt, .1));
    if (this.phase === 'idle') { this.remaining -= dt; if (this.remaining <= 0) this.start(); }
    else {
      this.time += dt;
      if (this.phase === 'enter' && this.time >= 9*SITTING.enterFrame) { this.phase='seated'; this.time=0; }
      else if (this.phase === 'seated' && this.time >= this.hold) this.stop();
      else if (this.phase === 'exit' && this.time >= 9*SITTING.enterFrame) this.reset();
    }
    return this.sample();
  }
  sample() {
    const pair = (from,to,mix) => Object.assign(this.output,{from,to,mix:smooth(mix),active:this.phase!=='idle'});
    if (this.phase==='idle') return pair('idle','idle',0);
    if (this.phase==='enter' || this.phase==='exit') {
      const frames=this.phase==='enter'?ENTER:EXIT;
      const i=Math.min(8,Math.floor(this.time/SITTING.enterFrame));
      return pair(this.phase==='exit'&&i===0?(this.exitFrom||frames[0]):frames[i],frames[i+1],(this.time-i*SITTING.enterFrame)/SITTING.blend);
    }
    const total=EXPRESSION_TOTAL;
    let t=this.time%total, previous=0;
    for(const [frame,duration] of SITTING.expressions) {
      if(t<duration)return pair(`sit-loop-${previous}`,`sit-loop-${frame}`,t/Math.min(.12,duration*.5));
      t-=duration;previous=frame;
    }
    return pair('sit-loop-0','sit-loop-0',0);
  }
}
