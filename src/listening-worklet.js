class FairyMicrophone extends AudioWorkletProcessor {
  constructor(){
    super();this.buffer=new Float32Array(1024);this.at=0;this.token=0;this.stopped=false;
    this.port.onmessage=({data})=>{if(data?.stop)this.stopped=true;if(Number.isInteger(data?.token)){this.token=data.token;this.at=0;this.buffer.fill(0);}};
  }
  process(inputs){
    if(this.stopped)return false;
    const channel=inputs[0]?.[0];
    if(this.token&&channel)for(const value of channel){
      this.buffer[this.at++]=value;
      if(this.at===this.buffer.length){this.port.postMessage({token:this.token,samples:this.buffer},[this.buffer.buffer]);this.buffer=new Float32Array(1024);this.at=0;}
    }
    return true;
  }
}
registerProcessor('fairy-microphone',FairyMicrophone);
