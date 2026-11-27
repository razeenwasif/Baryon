import { AvatarEffects } from './avatar-effects';
import { SpriteAvatar } from './sprite-avatar';

// Sprite-only startup never imports Three.js or creates a WebGL context.
export class Avatar {
  constructor(container) {
    this.container=container;this.visible=true;this.mode='sprite';this.modeEpoch=0;this.disposed=false;
    this.effects=new AvatarEffects(container);this.effectsEnabled=true;this.musicPlaying=false;
    this._vocalMusic=false;this._mouth=0;this.activity='idle';this.pose='crossed';this.floating=false;this.awake=true;
    this.spriteAvatar=new SpriteAvatar(container,this.effects);
  }
  get vrm(){return this.vrmAvatar?.vrm;}
  get mouth(){return this._mouth;}
  set mouth(value){this._mouth=value;this.spriteAvatar.mouth=value;if(this.vrmAvatar)this.vrmAvatar.mouth=value;}
  get vocalMusic(){return this._vocalMusic;}
  set vocalMusic(value){this._vocalMusic=value;this.spriteAvatar.vocalMusic=value;if(this.vrmAvatar)this.vrmAvatar.vocalMusic=value;}
  async ensureVRM() {
    if(this.disposed)throw new Error('Avatar has been disposed.');
    if(this.vrmAvatar)return this.vrmAvatar;
    if(!this.vrmPending)this.vrmPending=import('./vrm-avatar.js').then(({VrmAvatar})=>{
      if(this.disposed)throw new Error('Avatar has been disposed.');
      const vrm=this.vrmAvatar=new VrmAvatar(this.container,this.effects);
      vrm.setFloating(this.floating);vrm.setActivity(this.activity);vrm.setPose(this.pose);vrm.setEffectsEnabled(this.effectsEnabled);
      vrm.setPower(this.power);vrm.setMusicPlaying(this.musicPlaying);vrm.mouth=this._mouth;vrm.vocalMusic=this._vocalMusic;vrm.setAwake(this.awake);return vrm;
    }).finally(()=>{this.vrmPending=null;});
    return this.vrmPending;
  }
  async setMode(mode) {
    if(this.disposed)return;
    const epoch=++this.modeEpoch;this.mode=mode;
    if(mode==='sprite'){this.vrmAvatar?.setActive(false);this.spriteAvatar.setActive(this.visible);return;}
    const vrm=await this.ensureVRM();
    if(this.disposed || epoch!==this.modeEpoch)return;
    this.spriteAvatar.setActive(false);vrm.setActive(this.visible);
  }
  setVisible(value){this.visible=Boolean(value);this.container.style.visibility=this.visible?'':'hidden';this.spriteAvatar.setActive(this.visible&&this.mode==='sprite');this.vrmAvatar?.setActive(this.visible&&this.mode!=='sprite');}
  setBackground(value){this.spriteAvatar.setBackground(value);}
  setPower(value){this.power=value;this.spriteAvatar.setPower(value);this.vrmAvatar?.setPower(value);}
  setAwake(value){this.awake=Boolean(value);this.spriteAvatar.setAwake(this.awake);this.vrmAvatar?.setAwake(this.awake);}
  setEffectsEnabled(value){this.effectsEnabled=Boolean(value);this.spriteAvatar.setEffectsEnabled(value);this.vrmAvatar?.setEffectsEnabled(value);}
  setMusicPlaying(value){this.musicPlaying=Boolean(value);this.spriteAvatar.setMusicPlaying(value);this.vrmAvatar?.setMusicPlaying(value);}
  setCharacter(value){this.spriteAvatar.setCharacter(value);}
  setPose(value){this.pose=value;this.spriteAvatar.setPose(value);this.vrmAvatar?.setPose(value);}
  setActivity(value){this.activity=value;this.spriteAvatar.setActivity(value);this.vrmAvatar?.setActivity(value);}
  wave(){(this.mode==='sprite'?this.spriteAvatar:this.vrmAvatar)?.wave();}
  look(x,y){if(this.mode==='sprite'){const r=this.container.getBoundingClientRect();if(r.width&&r.height)this.spriteAvatar.look((x-r.left)/r.width*2-1,(y-r.top)/r.height*2-1);}else this.vrmAvatar?.look(x,y);}
  hitTest(x,y){return this.visible && (this.mode==='sprite'?this.spriteAvatar:this.vrmAvatar)?.hitTest(x,y)||false;}
  setFloating(value){this.floating=value;this.spriteAvatar.setFloating(value);this.vrmAvatar?.setFloating(value);}
  frameTorso(){(this.mode==='sprite'?this.spriteAvatar:this.vrmAvatar)?.frameTorso();}
  async load(bytes,autoSwitch=true){const epoch=this.modeEpoch;const vrm=await this.ensureVRM();await vrm.load(bytes,false);if(!this.disposed&&autoSwitch&&epoch===this.modeEpoch)await this.setMode('vrm');}
  dispose(){if(this.disposed)return;this.disposed=true;this.modeEpoch++;this.spriteAvatar.dispose();this.vrmAvatar?.dispose();this.effects.dispose();}
}
