import {spawn} from 'node:child_process';
import { nativeBin } from './bundle-path.cjs';
export class NativePower {
  constructor({changed,spawnProcess=spawn,schedule=setTimeout,clear=clearTimeout}) {Object.assign(this,{changed,spawnProcess,schedule,clear});this.child=null;this.timer=null;this.stopped=false;this.failures=0;}
  start(){
    if(this.stopped||this.child)return;
    const child=this.child=this.spawnProcess(nativeBin('fairy-power'),[],{stdio:['pipe','pipe','pipe']});
    let buffer='',failed=false;
    const fail=()=>{if(failed||this.stopped)return;failed=true;this.changed({nativeAvailable:false});child.kill();};
    child.stdin.on('error',()=>{});child.stderr.resume();
    child.stdout.on('data',chunk=>{
      if(failed||this.stopped)return;buffer+=chunk;
      if(buffer.length>4096){fail();return;}
      let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
        try {const x=JSON.parse(line);if(typeof x.onBattery!=='boolean'||typeof x.lowPower!=='boolean'||!(x.batteryPercent===null||Number.isInteger(x.batteryPercent)&&x.batteryPercent>=0&&x.batteryPercent<=100))throw Error('bad power state');
          this.changed({onBattery:x.onBattery,lowPower:x.lowPower,batteryPercent:x.batteryPercent,nativeAvailable:true});
        }catch{fail();return;}
      }
    });
    child.on('error',fail);
    child.on('close',()=>{if(this.child===child)this.child=null;if(this.stopped)return;this.changed({nativeAvailable:false});if(this.failures++<3){this.timer=this.schedule(()=>{this.timer=null;this.start();},Math.min(30000,1000*2**this.failures));this.timer?.unref?.();}});
  }
  refresh(){if(!this.stopped&&this.child)this.child.stdin.write('refresh\n');}
  stop(){this.stopped=true;if(this.timer!==null)this.clear(this.timer);this.timer=null;const child=this.child;this.child=null;child?.stdin.end();child?.kill();}
}
