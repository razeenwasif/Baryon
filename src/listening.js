import { isListeningCancellation } from './listening-start.js';
import workletURL from './listening-worklet.js?url&no-inline';
import { UtteranceDetector } from './voice-gate.js';
import { encodeWav } from './recording.js';

// Tracks belong to a listening session. The suspended, input-free audio graph can
// be reused briefly across restarts; shutdown/lock/cooling dispose it immediately.
export class HandsFreeMicrophone {
  constructor({ blocked, transcribe, onText, onStatus, onFailure, onActivity=()=>{}, matchWake=()=>null, idleMs=30000, schedule=(fn,ms)=>setTimeout(fn,ms), clear=id=>clearTimeout(id) }) {
    Object.assign(this,{blocked,transcribe,onText,onStatus,onFailure,onActivity,matchWake,idleMs,schedule,clear});
    this.epoch=0;this.running=false;this.starting=false;this.processing=false;this.session=null;this.engine=null;this.idleTimer=null;this.cleanup=Promise.resolve();
  }
  get node(){return this.session?.node;}
  get detector(){return this.session?.detector;}
  cancelIdle(){if(this.idleTimer!==null)this.clear(this.idleTimer);this.idleTimer=null;}
  armIdle(){
    this.cancelIdle();if(!this.engine||this.engine.owner||this.running||this.starting)return;
    this.idleTimer=this.schedule(()=>{this.idleTimer=null;if(!this.running&&!this.starting)void this.closeEngine();},this.idleMs);
    this.idleTimer?.unref?.();
  }
  transition(engine,work){const result=engine.transition.catch(()=>{}).then(work);engine.transition=result;return result;}
  async getEngine(){
    if(this.engine?.sessions>=32)await this.closeEngine();
    if(this.engine&&!this.engine.retired)return this.engine.ready;
    const engine={context:new AudioContext({sampleRate:48000}),transition:Promise.resolve(),owner:null,retired:false,sessions:0};this.engine=engine;
    engine.ready=(async()=>{
      try {
        await engine.context.audioWorklet.addModule(workletURL);
        if(engine.retired)throw Error('Microphone stopped.');
        engine.node=new AudioWorkletNode(engine.context,'fairy-microphone');engine.mute=engine.context.createGain();engine.mute.gain.value=0;
        engine.node.connect(engine.mute);engine.mute.connect(engine.context.destination);
        await engine.context.suspend();return engine;
      } catch(error){if(this.engine===engine)this.engine=null;engine.node?.port.close();engine.node?.disconnect();engine.mute?.disconnect();if(engine.context.state!=='closed')await engine.context.close();throw error;}
    })();
    return engine.ready;
  }
  async closeEngine(){
    this.cancelIdle();const engine=this.engine;if(!engine)return;this.engine=null;engine.retired=true;
    await engine.ready.catch(()=>{});await engine.transition.catch(()=>{});
    if(engine.node){engine.node.port.onmessage=null;engine.node.port.postMessage({stop:true});engine.node.port.close();engine.node.disconnect();}
    engine.mute?.disconnect();if(engine.context.state!=='closed')await engine.context.close();
  }
  release(session){
    if(!session)return Promise.resolve();if(session.release)return session.release;
    session.released=true;session.stream?.getTracks().forEach(track=>{track.onended=null;track.stop();});session.source?.disconnect();session.detector?.reset();
    const engine=session.engine;
    if(engine?.owner===session){engine.owner=null;engine.node.port.onmessage=null;engine.node.port.postMessage({token:0});}
    session.stream=session.source=session.detector=session.node=session.context=null;
    session.release=(async()=>{
      if(engine&&!engine.retired)await this.transition(engine,()=>engine.context.state==='closed'?undefined:engine.context.suspend());
      this.armIdle();
    })();
    this.cleanup=session.release.catch(()=>{});return session.release;
  }
  async start(){
    if(this.running||this.starting)return;this.cancelIdle();this.starting=true;const token=++this.epoch;let session;
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
      if(token!==this.epoch){stream.getTracks().forEach(track=>track.stop());return;}
      session={stream,token};this.session=session;await this.cleanup;
      if(token!==this.epoch)return;
      const engine=await this.getEngine();if(token!==this.epoch||engine.retired)return;
      Object.assign(session,{engine,context:engine.context,node:engine.node,detector:new UtteranceDetector(engine.context.sampleRate)});engine.owner=session;engine.sessions++;
      session.source=engine.context.createMediaStreamSource(stream);session.source.connect(engine.node);
      stream.getAudioTracks()[0].onended=()=>{if(token===this.epoch){void this.stop({releaseEngine:true});this.onFailure('Microphone disconnected. Reconnect it and resume listening.');}};
      engine.node.port.onmessage=async({data})=>{
        if(token!==this.epoch||data?.token!==token||!(data.samples instanceof Float32Array))return;
        const detector=session.detector,wasStarted=detector.started;
        const segment=detector.push(data.samples,this.processing||this.blocked());
        if(wasStarted!==detector.started)this.onActivity();if(!wasStarted&&detector.started)this.utteranceStarted=Date.now()-100;
        if(!segment)return;this.processing=true;this.onStatus('Recognizing locally…');
        try{const text=await this.transcribe(encodeWav([segment],engine.context.sampleRate));if(token===this.epoch)this.onStatus('');const wake=text?this.matchWake(segment,engine.context.sampleRate):null;if(token===this.epoch&&!this.blocked()&&text)await this.onText(text,this.utteranceStarted,wake);}
        catch(error){if(token===this.epoch&&!isListeningCancellation(error)){void this.stop({releaseEngine:true});this.onFailure(error.message);}}
        finally{if(token===this.epoch){this.processing=false;detector.reset();this.onStatus('');}}
      };
      engine.node.port.postMessage({token});
      await this.transition(engine,()=>token===this.epoch&&!engine.retired?engine.context.resume():undefined);
      if(token!==this.epoch)return;this.running=true;this.onStatus('');
    }catch(error){if(token===this.epoch){await this.release(session);await this.closeEngine();throw error;}}
    finally{if(token!==this.epoch||!this.running){if(this.session===session)this.session=null;await this.release(session);}if(token===this.epoch)this.starting=false;this.armIdle();}
  }
  async stop({releaseEngine=false}={}){
    const token=++this.epoch;this.starting=false;this.running=false;this.processing=false;
    const session=this.session;this.session=null;await this.release(session);
    if(releaseEngine)await this.closeEngine();else this.armIdle();
    if(token===this.epoch)this.onStatus('');
  }
  async dispose(){await this.stop({releaseEngine:true});}
}
