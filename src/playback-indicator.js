// Poll only playback state through the existing connection; nothing goes to the AI.
export class PlaybackIndicator {
  constructor({api,allowed,onChange,now=Date.now,interval=()=>15000}) {Object.assign(this,{api,allowed,onChange,now,interval});this.next=0;this.pending=false;this.epoch=0;}
  reset(){this.epoch++;this.next=0;this.onChange(false);}
  async tick(){
    if(!this.api||!this.allowed()){this.reset();return;}
    if(this.pending||this.now()<this.next)return;
    this.pending=true;const token=this.epoch;this.next=this.now()+this.interval();
    try{
      const status=await this.api.spotifyStatus();
      if(!status.connected)this.next=this.now()+60000;
      const current=status.connected?await this.api.spotifyNow():null;
      if(token===this.epoch&&this.allowed())this.onChange(Boolean(current?.playing&&current?.track));
    }catch{if(token===this.epoch){this.onChange(false);this.next=this.now()+60000;}}
    finally{this.pending=false;if(token===this.epoch)this.next=Math.max(this.next,this.now()+this.interval());}
  }
}
