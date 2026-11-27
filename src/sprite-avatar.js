import { AvatarEffects } from './avatar-effects';
import spriteSheetUrl from '../assets/casual-outfit.png';
import sitEnterUrl from '../assets/animation/starting-to-sit.png';
import sitLoopUrl from '../assets/animation/sitting down.png';
import { IdleAnimation } from './idle-animation.js';
import { FrameLoop } from './frame-loop.js';
import walkUrl from '../assets/animation/walking side to side.png';
import { spriteSeams } from './sprite-sheet.js';
import { CompanionAnimation } from './companion-animation.js';
import { seatedPose, SEATED_KINDS } from './seated-sequence.js';
import { ConversationReaction, replyReaction, REACTION_KINDS } from './conversation-reaction.js';
import { CursorGaze } from './cursor-tracking.js';
import { AnimationSheets } from './animation-sheets.js';
import { FairyRenderer } from './fairy-avatar.js';

// Transparent gutters separate the five full-body poses in the upper row.
// The lower row contains face previews, not animation frames.
const OUTFIT_FRAMES = {
  idle: { left: 0, right: 381, faceX: 190 },
  dancing: { left: 381, right: 711, faceX: 552 },
  waving: { left: 711, right: 1074, faceX: 925 },
  thinking: { left: 1074, right: 1414, faceX: 1252 },
  speaking: { left: 1414, right: 1774, faceX: 1593 },
};
const FRAME_HEIGHT = 674;

/**
 * 2D pixel sprite avatar: Fairy's painted sheets, or the Fairy eye (see fairy-avatar.js).
 * Renders an exact pixel-art match of Fairy, supporting full-body in workspace mode,
 * torso-up framing in floating desktop mode, and voice reactivity.
 * Dynamically switches poses:
 * - Idle: Natural standing pose with gentle breathing bob & hair sway
 * - Speaking: Open speaking gesture with speech bobbing driven by voice RMS
 * - Music/Singing: Grooving and dancing pose with beat-synced rhythm
 * - Waving: Friendly greeting wave pose with raised arm
 * - Thinking: Thoughtful chin-on-hand pose
 */
const BACKGROUND_FPS = 6;
export class SpriteAvatar {
  constructor(container, effects = null) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'fairy-sprite-avatar fairy-sprite-avatar';
    this.canvas.setAttribute('aria-label', 'Fairy pixel sprite avatar');
    Object.assign(this.canvas.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      display: 'block',
      imageRendering: 'pixelated',
      touchAction: 'none',
      userSelect: 'none',
      pointerEvents: 'none',
    });
    container.append(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    this.effects = effects || new AvatarEffects(container);
    this.ownsEffects = !effects;
    this.effectsEnabled = true;this.quizThinking=false;
    this.musicPlaying = false;
    this.vocalMusic = false;

    this._mouth = 0;
    this.activity = 'idle';
    this.pose = 'crossed';
    this.floating = false;
    this.waveUntil = 0;
    this.elapsed = 0;
    this.headPoint = { x: 0, y: 0 };
    this.lookOffset = { x: 0, y: 0 };
    this.seatedSample={kind:null,frame:0};this.reaction=new ConversationReaction();this.reactionsEnabled=true;this.cursorGaze=new CursorGaze();this.cursorTrackingEnabled=true;

    this.character='robin';this.fairy=null;
    this.disposed=false;this.active=true;this.awake=true;this.pendingImages=new Set();this.hitCache=new WeakMap();
    this.idleAnimation = new IdleAnimation();
    this.companion=new CompanionAnimation();this.animationSheets=new AnimationSheets();this.animationsEnabled=true;this.optionalMotion=true;
    this.reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
    this.onReduced=()=>{if(this.reducedMotion.matches)this.stopAnimations();};this.reducedMotion.addEventListener('change',this.onReduced);
    this.sprites = this.loadSprites();
    this.loadSittingSprites();
    this.loadWalkingSprites();
    this.blendedSprite = document.createElement('canvas');
    this.blendedSprite.width = 420; this.blendedSprite.naturalWidth = 840;
    this.blendedSprite.height = 760; this.blendedSprite.naturalHeight = 1520;
    this.blendedSprite.loaded = true;
    this.companionBlend=document.createElement('canvas');this.companionBlend.width=210;this.companionBlend.height=380;this.companionBlend.naturalWidth=840;this.companionBlend.naturalHeight=1520;this.companionBlend.loaded=true;this.companionBlend.blendedCompanion=true;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);

    this.frameLoop = new FrameLoop((now,dt)=>this.loop(now,dt));
    this.onVisibility=()=>{if(document.hidden)this.stopAnimations();this.syncLoop();};document.addEventListener('visibilitychange',this.onVisibility);this.syncLoop();
  }

  syncLoop(){const running=!this.disposed && this.active && this.awake && !this.powerPaused && !document.hidden;if(!running)this.effects?.hideQuiz();this.frameLoop?.setRunning(running);if(!running)this.renderStill();}
  // Pausing sensing/animation must not leave a newly loaded or resized canvas blank.
  // Paint once on these events; no animation timer or sensing is restarted.
  renderStill(){if((this.loaded || this.character==='fairy') && this.active && !this.disposed && !document.hidden)this.render();}
  setActive(value){this.active=Boolean(value);if(!this.active)this.stopAnimations();this.canvas.style.display=value?'block':'none';this.syncLoop();}
  setPower(value={}){this.optionalMotion=value.optional!==false;if(!this.optionalMotion)this.stopAnimations();this.powerPaused=value.fps===0;this.powerFPS=value.fps||30;this.applyFPS();this.syncLoop();}
  // In the window while another app is in front, an idle eye only needs to drift, so it draws far fewer frames.
  setBackground(value){this.background=Boolean(value);this.applyFPS();}
  applyFPS(){const fps=this.powerFPS||30;this.frameLoop?.setFPS(this.background&&this.activity==='idle'?Math.min(fps,BACKGROUND_FPS):fps);}
  setAwake(value){this.awake=Boolean(value);if(!this.awake)this.stopAnimations();this.syncLoop();}

  get mouth() {
    return this._mouth;
  }

  set mouth(value) {
    this._mouth = Math.max(0, Math.min(1, value));
  }

  // Fairy shares every state machine below and replaces only drawing and hit tests.
  setCharacter(name){
    const next=name==='fairy'?'fairy':'robin';if(this.character===next)return;
    this.character=next;if(next==='fairy')this.fairy??=new FairyRenderer();
    this.stopAnimations();this.canvas.setAttribute('aria-label',next==='fairy'?'Fairy pixel eye avatar':'Fairy pixel sprite avatar');this.renderStill();
  }
  // Where the floating radial menu centres, in client coordinates: Fairy's eye, or Fairy's head.
  menuAnchor(){
    const rect=this.canvas.getBoundingClientRect();
    if(this.character==='fairy' && this.fairy?.anchor){const a=this.fairy.anchor;return {x:rect.left+a.x,y:rect.top+a.y,r:a.r};}
    return {x:rect.left+this.headPoint.x,y:rect.top+this.headPoint.y+30,r:Math.min(rect.width*.3,110)};
  }
  sheetReady(kind){return this.character==='fairy' || Boolean(this.animationSheets.get(kind));}
  ensureSheet(kind){if(this.character!=='fairy')this.animationSheets.ensure(kind);}

  setQuizThinking(value){this.quizThinking=Boolean(value);if(!this.quizThinking)this.effects?.hideQuiz();}

  setEffectsEnabled(value) {
    this.effectsEnabled = Boolean(value);
    this.effects?.draw({ enabled: this.effectsEnabled, width: 0, height: 0, head: null, time: 0, activity: 'idle', music: false });
  }

  setMusicPlaying(value) {
    this.musicPlaying = Boolean(value);
  }

  setPose(pose) {
    this.pose = pose;
  }

  setActivity(activity) {
    this.activity = activity;this.applyFPS();if(activity!=='idle'){this.reaction.stop();this.companion.stop();this.cursorSampler?.cancel();this.cursorGaze.reset();}
  }

  wave() {
    this.reaction.stop();this.cursorSampler?.cancel();this.cursorGaze.reset();this.companion.stop();this.waveUntil = this.elapsed + 2.8;
  }

  look(x, y) { /* Sprite gaze uses client coordinates through trackCursor. */ }
  cursorEligible(){return Boolean(this.cursorTrackingEnabled && this.loaded && this.active && this.awake && !this.disposed && !document.hidden && this.optionalMotion && !this.powerPaused && !this.reducedMotion.matches && this.activity==='idle' && this._mouth<=.05 && this.elapsed>=this.waveUntil && !this.walking && !this.reaction.kind && !this.companion.kind && this.idleAnimation.phase==='idle' && !document.documentElement.classList.contains('desktop-working') && this.cursorAllowed?.()!==false);}
  trackCursor(point){
    if(!point||!this.cursorEligible()){this.cursorGaze.reset();return;}
    const rect=this.container.getBoundingClientRect();
    this.cursorGaze.point(point.x,point.y,{x:rect.left+this.headPoint.x,y:rect.top+this.headPoint.y});
  }

  setFloating(value) {
    if (this.floating === Boolean(value)) return;
    this.floating = Boolean(value);
    if(!this.floating)this.effects?.hideQuiz();
    this.resize();
  }

  frameTorso() {
    // In floating mode, torso-up framing is the default
    this.floating = true;
    this.resize();
  }

  resize() {
    const rect = this.container.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    if(!this.frameLoop?.running)this.renderStill();
  }

  loadSprites() {
    // Keep the supplied PNG intact. Extract its atlas frames on canvas, using
    // the existing 840×1520 coordinate system for framing, effects and hit tests.
    const sprites = Object.fromEntries(Object.keys(OUTFIT_FRAMES).map(name => {
      const canvas = document.createElement('canvas');
      canvas.width = 420; canvas.naturalWidth = 840;
      canvas.height = 760; canvas.naturalHeight = 1520;
      canvas.loaded = false;
      return [name, canvas];
    }));
    const sheet = new Image();
    this.pendingImages.add(sheet);
    sheet.onload = () => {
      this.pendingImages.delete(sheet);sheet.onload=null;if(this.disposed)return;
      for (const [name, frame] of Object.entries(OUTFIT_FRAMES)) {
        const canvas = sprites[name], ctx = canvas.getContext('2d');ctx.setTransform(.5,0,0,.5,0,0);
        ctx.imageSmoothingEnabled = false;
        // Align faces and feet between poses so switching does not jump around.
        const x = 210 - (frame.faceX - frame.left);
        ctx.drawImage(sheet, frame.left, 0, frame.right - frame.left, FRAME_HEIGHT,
          x * 2, (700 - FRAME_HEIGHT) * 2, (frame.right - frame.left) * 2, FRAME_HEIGHT * 2);
        canvas.loaded = true;
        this.measureTrim(canvas);
      }
      this.loaded = true;
      this.buildHitMap(sprites.idle);
      this.resize();
    };
    sheet.onerror=()=>{this.pendingImages.delete(sheet);sheet.onload=sheet.onerror=null;};
    sheet.src = spriteSheetUrl;
    return sprites;
  }

  loadWalkingSprites() {
    const sheet=new Image();this.pendingImages.add(sheet);
    sheet.onload=()=>{
      this.pendingImages.delete(sheet);sheet.onload=sheet.onerror=null;if(this.disposed)return;
      for(let row=0;row<2;row++){
        const y=row===0?0:455,bottom=row===0?455:sheet.height,height=bottom-y;
        const source=document.createElement('canvas');source.width=sheet.width;source.height=height;
        const sourceCtx=source.getContext('2d',{willReadFrequently:true});sourceCtx.drawImage(sheet,0,y,sheet.width,height,0,0,sheet.width,height);
        const pixels=sourceCtx.getImageData(0,0,source.width,height);
        const centers=row===0?[180,420,635,850,1070,1285,1500,1710]:[85,320,555,780,998,1220,1440,1655];
        const seams=spriteSeams(pixels.data,source.width,height,centers);
        for(let i=0;i<8;i++){
          let left=source.width,right=0;
          for(let sy=0;sy<height;sy++){
            const a=seams[i][sy],b=seams[i+1][sy];
            for(let x=a;x<b;x++)if(pixels.data[(sy*source.width+x)*4+3]>24){left=Math.min(left,x);right=Math.max(right,x);}
          }
          const canvas=document.createElement('canvas');canvas.width=210;canvas.height=380;canvas.naturalWidth=840;canvas.naturalHeight=1520;
          const ctx=canvas.getContext('2d');ctx.scale(.5,.5);ctx.imageSmoothingEnabled=false;
          const scale=Math.min(650/height,400/Math.max(1,right-left+1));
          ctx.translate((420-(right-left+1)*scale)/2-left*scale,700-height*scale);ctx.scale(scale,scale);
          ctx.beginPath();ctx.moveTo(seams[i][0],0);
          for(let sy=0;sy<height;sy++)ctx.lineTo(seams[i][sy],sy);
          for(let sy=height-1;sy>=0;sy--)ctx.lineTo(seams[i+1][sy],sy);
          ctx.closePath();ctx.clip();ctx.drawImage(source,0,0);
          canvas.loaded=true;canvas.walking=true;this.sprites[`walk-${row===0?'right':'left'}-${i}`]=canvas;
        }
        source.width=source.height=0;
      }
      this.walkingReady=true;
    };
    sheet.onerror=()=>{this.pendingImages.delete(sheet);sheet.onload=sheet.onerror=null;};sheet.src=walkUrl;
  }

  setWalking(value){this.walking=value;}
  stopAnimations(snooze=0){this.reaction.stop();this.cursorSampler?.cancel();this.cursorGaze.reset();this.companion.stop(snooze);this.idleAnimation.reset();}
  previewAnimation(kind){
    if(this.reducedMotion.matches || !this.optionalMotion || !this.awake || this.activity!=='idle' || this._mouth>.05 || this.animationAllowed?.(true)===false)return false;
    this.reaction.stop();this.idleAnimation.reset();this.companion.stop();this.waveUntil=0;
    if(SEATED_KINDS.includes(kind)){this.idleAnimation.start();this.idleAnimation.phase='seated';this.idleAnimation.time=kind==='finger'?0:kind==='chin'?8:33;return true;}
    if(REACTION_KINDS.includes(kind))return this.reaction.play(kind,true);
    return this.companion.play(kind,true);
  }
  reactToReply(reply,user=''){
    if(!this.reactionsEnabled || !this.reactionEligible())return false;
    const kind=replyReaction(reply,user);if(!kind)return false;
    this.companion.stop();this.cursorGaze.reset();return this.reaction.play(kind);
  }
  reactionEligible(){return this.active && this.awake && !this.disposed && !document.hidden && this.optionalMotion && !this.reducedMotion.matches && this.activity==='idle' && this._mouth<=.05 && !this.walking && this.elapsed>=this.waveUntil && !document.documentElement.classList.contains('desktop-working') && this.reactionAllowed?.()!==false;}
  companionSprite(){
    const sample=this.companion.sample();return this.blendCompanionFrame(sample.sheet,sample.frame);
  }
  blendCompanionFrame(kind,frame){
    if(!kind)return null;
    const target=this.animationSheets.get(kind)?.[frame];if(!target)return null;
    if(this.companionTarget!==target){
      this.companionFrom=this.companionTarget?.width && (this.companionTarget.companion===kind || (target.desk && this.companionTarget.desk))?this.companionTarget:target;
      this.companionTarget=target;this.companionBlendAt=this.elapsed;
    }
    const mix=Math.min(1,(this.elapsed-this.companionBlendAt)/.12);this.companionMix=mix;
    if(mix>=1 || this.companionFrom===target || !this.companionFrom?.width)return target;
    const canvas=this.companionBlend,ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);ctx.imageSmoothingEnabled=false;
    ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1-mix;ctx.drawImage(this.companionFrom,0,0);
    ctx.globalCompositeOperation='lighter';ctx.globalAlpha=mix;ctx.drawImage(target,0,0);ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1;
    canvas.companion=kind;canvas.desk=target.desk;return canvas;
  }

  canSit() {
    return this.activity === 'idle' && this._mouth <= .05 && !this.musicPlaying
      && this.elapsed >= this.waveUntil && !document.documentElement.classList.contains('desktop-working');
  }

  toggleSitting() {
    if (this.walking || !(this.sittingReady || this.character==='fairy') || !this.canSit()) return false;
    this.reaction.stop();this.companion.stop();
    if (this.idleAnimation.phase === 'idle') return this.idleAnimation.start();
    if (this.idleAnimation.phase === 'seated') this.idleAnimation.stop();
    else this.idleAnimation.reset();
    return true;
  }

  loadSittingSprites() {
    // Atlas cells are eight equal-width poses. Keep source PNGs unchanged.
    const load = url => new Promise((resolve,reject) => {
      const image = new Image();this.pendingImages.add(image);image.onload=()=>{this.pendingImages.delete(image);image.onload=image.onerror=null;resolve(image);};image.onerror=()=>{this.pendingImages.delete(image);image.onload=image.onerror=null;reject(new Error("Sprite sheet unavailable"));};image.src=url;
    });
    Promise.all([load(sitEnterUrl),load(sitLoopUrl)]).then(([enter,loop])=>{
      if(this.disposed)return;
      const faceX=[120,116,100,116,134,148,158,158];
      for(let i=0;i<8;i++) {
        const canvas=document.createElement('canvas');
        canvas.width=420;canvas.naturalWidth=840;canvas.height=760;canvas.naturalHeight=1520;
        const ctx=canvas.getContext('2d');ctx.setTransform(.5,0,0,.5,0,0);ctx.imageSmoothingEnabled=false;
        const left=Math.round(i*enter.width/8),right=Math.round((i+1)*enter.width/8);
        const cell=document.createElement('canvas');cell.width=right-left;cell.height=enter.height;
        const cellCtx=cell.getContext('2d');cellCtx.drawImage(enter,left,0,right-left,enter.height,0,0,cell.width,cell.height);
        if(i>0) { cellCtx.clearRect(0,0,22,420);cellCtx.clearRect(0,450,38,274); }
        ctx.drawImage(cell,420-faceX[i]*2,10,cell.width*2,cell.height*2);
        canvas.loaded=true;this.sprites[`sit-enter-${i}`]=canvas;
      }
      for(let i=0;i<8;i++) {
        const canvas=document.createElement('canvas');
        canvas.width=420;canvas.naturalWidth=840;canvas.height=760;canvas.naturalHeight=1520;
        const ctx=canvas.getContext('2d');ctx.setTransform(.5,0,0,.5,0,0);ctx.imageSmoothingEnabled=false;
        // This sheet supplies a seated bust, not legs. Preserve its proportions
        // instead of grafting it onto a mismatched lower body. Align the face
        // with the end of the entrance, then ease the camera to the tabletop.
        const left=Math.round(i*loop.width/8),right=Math.round((i+1)*loop.width/8);
        ctx.drawImage(loop,left,0,right-left,loop.height,420-140*2,10,(right-left)*2,loop.height*2);
        canvas.loaded=true;this.sprites[`sit-loop-${i}`]=canvas;
      }
      this.sittingReady=true;
    }).catch(()=>{ this.sittingReady=false; }); // Ordinary poses still work if an optional asset fails.
  }

  animationSprite() {
    const sample=this.idleAnimation.sample();
    if (!sample.active || !this.sittingReady || !this.canSit()) return null;
    if(this.idleAnimation.phase==='seated'){
      const pose=seatedPose(this.idleAnimation.time,this.seatedSample);const image=this.blendCompanionFrame(pose.kind,pose.frame);
      if(image){this.seatedLast=image===this.companionBlend?this.companionTarget:image;return image;}
    }
    const from=this.idleAnimation.phase==='exit' && this.idleAnimation.time<.28 && this.seatedLast?.width?this.seatedLast:this.sprites[sample.from],to=this.sprites[sample.to];
    if(!from?.loaded || !to?.loaded)return null;
    const canvas=this.blendedSprite;
    if(this.blendFrom===from && this.blendTo===to && this.blendMix===sample.mix)return canvas;
    this.blendFrom=from;this.blendTo=to;this.blendMix=sample.mix;
    const ctx=canvas.getContext('2d');
    ctx.clearRect(0,0,canvas.width,canvas.height);ctx.imageSmoothingEnabled=false;
    // Additive premultiplied blending avoids a dark/transparent dip at the join.
    ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1-sample.mix;ctx.drawImage(from,0,0,canvas.width,canvas.height);
    ctx.globalCompositeOperation='lighter';ctx.globalAlpha=sample.mix;ctx.drawImage(to,0,0);
    ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
    canvas.sitting=true;
    return canvas;
  }

  getActiveSprite() {
    if(this.idleAnimation.phase==='seated' && !this.companion.kind && (this.activity!=='idle' || this._mouth>.05)){
      const seated=this.blendCompanionFrame('finger',this.activity==='speaking'||this._mouth>.05?1:0);
      return seated || (this.seatedLast?.width?this.seatedLast:this.sprites['sit-loop-0']) || this.sprites.idle;
    }
    if (this.elapsed < this.waveUntil && this.sprites.waving.loaded) {
      return this.sprites.waving;
    }
    if ((this.activity === 'speaking' || this._mouth > 0.05) && this.sprites.speaking.loaded) {
      return this.sprites.speaking;
    }
    if (this.activity === 'thinking' && this.sprites.thinking.loaded) {
      return this.sprites.thinking;
    }
    if(this.reaction.kind && this.reactionEligible()){const reaction=this.reaction.sample(),sprite=this.blendCompanionFrame(reaction.kind,reaction.frame);if(sprite)return sprite;}
    const companion=this.companionSprite();if(companion)return companion;
    if(this.activity==='singing' && this.sprites.dancing.loaded)return this.sprites.dancing;
    if(this.walking && this.walkingReady && this.canSit())return this.sprites[`walk-${this.walking.direction>0?'right':'left'}-${Math.floor(this.walking.travel/5)%8}`];
    const sitting=this.animationSprite();if(sitting)return sitting;
    if(this.cursorEligible() && this.cursorGaze.frame!==null){const gaze=this.blendCompanionFrame('cursor',this.cursorGaze.frame);if(gaze)return gaze;}
    return this.sprites.idle;
  }

  // Sprites can carry wide transparent margins. Measuring the artwork lets the
  // framing fit her, not the empty space around her.
  measureTrim(img) {
    if (!img.naturalWidth) return;
    const step = 4, sw = Math.ceil(img.naturalWidth / step), sh = Math.ceil(img.naturalHeight / step);
    const off = document.createElement('canvas');
    off.width = sw; off.height = sh;
    const offCtx = off.getContext('2d', { willReadFrequently: true });
    offCtx.drawImage(img, 0, 0, sw, sh);
    const { data } = offCtx.getImageData(0, 0, sw, sh);
    let top = sh, bottom = 0, left = sw, right = 0;
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      if (data[(y * sw + x) * 4 + 3] < 24) continue;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
    if (bottom < top) return;
    img.trim = {
      top: Math.max(0, top * step - step),
      bottom: Math.min(img.naturalHeight, (bottom + 1) * step + step),
      left: Math.max(0, left * step - step),
      right: Math.min(img.naturalWidth, (right + 1) * step + step),
    };
  }

  maskFor(targetImg) {
    if(this.hitCache.has(targetImg))return this.hitCache.get(targetImg);
    const sw=105,sh=190,off=document.createElement('canvas');off.width=sw;off.height=sh;
    const ctx=off.getContext('2d',{willReadFrequently:true});ctx.drawImage(targetImg,0,0,sw,sh);
    const rgba=ctx.getImageData(0,0,sw,sh).data,alpha=new Uint8Array(sw*sh);
    for(let i=0;i<alpha.length;i++)alpha[i]=rgba[i*4+3];off.width=off.height=0;
    const mask={width:sw,height:sh,data:alpha,naturalWidth:840,naturalHeight:1520};this.hitCache.set(targetImg,mask);return mask;
  }
  buildHitMap(img = this.sprites.idle) {
    this.hitData=this.maskFor(img===this.blendedSprite?this.blendFrom:img===this.companionBlend?this.companionFrom:img);
  }

  hitTest(clientX, clientY) {
    if (this.character==='fairy') return Boolean(this.fairy?.hitTest(this.canvas, clientX, clientY));
    if (!this.loaded || !this.hitData || !this.layout) return false;
    const rect = this.canvas.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;

    const { destX, destY, destW, destH, srcX, srcY, srcW, srcH } = this.layout;
    const px = x * rect.width;
    const py = y * rect.height;

    if (px < destX || px > destX + destW || py < destY || py > destY + destH) return false;

    // Map to sprite source coordinates
    const normX = (px - destX) / destW;
    const normY = (py - destY) / destH;
    const sx = srcX + normX * srcW;
    const sy = srcY + normY * srcH;

    const natW = this.hitData.naturalWidth || 888;
    const natH = this.hitData.naturalHeight || 1195;
    const hitX = Math.floor((sx / natW) * this.hitData.width);
    const hitY = Math.floor((sy / natH) * this.hitData.height);

    if (hitX < 0 || hitX >= this.hitData.width || hitY < 0 || hitY >= this.hitData.height) return false;
    const index=hitY*this.hitData.width+hitX;
    let alpha=this.hitData.data[index];
    if(this.lastHitSprite===this.blendedSprite)alpha=alpha*(1-this.blendMix)+this.maskFor(this.blendTo).data[index]*this.blendMix;
    if(this.lastHitSprite===this.companionBlend)alpha=alpha*(1-this.companionMix)+this.maskFor(this.companionTarget).data[index]*this.companionMix;
    return alpha > 30;
  }

  loop(now, dt) {
    this.elapsed += dt;
    this.onFrame?.(dt);
    const motionAllowed=this.optionalMotion && this.awake && this.activity==='idle' && this._mouth<=.05 && this.elapsed>=this.waveUntil && !document.documentElement.classList.contains('desktop-working');
    const allowed=motionAllowed && !this.reaction.kind && this.animationAllowed?.(this.companion.manual)!==false;
    const napAllowed=motionAllowed && !this.reaction.kind && this.animationAllowed?.(true)!==false;
    const available=!this.walking && !this.reaction.kind && (this.idleAnimation.phase==='idle' || this.musicPlaying);
    this.reaction.tick(dt,{allowed:this.reactionEligible(),ready:!this.reaction.kind || this.sheetReady(this.reaction.kind)});
    const kind=this.companion.sample().sheet;
    this.companion.tick(dt,{allowed,napAllowed,available,music:this.musicPlaying,enabled:this.animationsEnabled,reduced:this.reducedMotion.matches,ready:!kind || this.sheetReady(kind)});
    if(this.companion.kind){
      const sheet=this.companion.sample().sheet;this.ensureSheet(sheet);
      if(this.animationSheets.failed.has(sheet))this.companion.stop(60);
    }
    if(!this.walking && !this.companion.kind){
      const seated=this.idleAnimation.phase==='seated',pose=seated?seatedPose(this.idleAnimation.time,this.seatedSample):null;
      const ready=this.character==='fairy' || this.sittingReady && this.loaded && (!pose || Boolean(this.animationSheets.get(pose.kind)) || this.animationSheets.failed.has(pose.kind));
      this.idleAnimation.tick(dt,{eligible:this.canSit() && (this.idleAnimation.phase==='idle'?allowed && this.animationsEnabled:napAllowed) && !this.reducedMotion.matches,ready});
      if(this.idleAnimation.phase!=='idle'){const next=this.idleAnimation.phase==='seated'?seatedPose(this.idleAnimation.time,this.seatedSample).kind:'finger';this.ensureSheet(next);}
    }
    if(this.idleAnimation.phase==='seated' && (this.activity!=='idle' || this._mouth>.05))this.ensureSheet('finger');
    if(this.reaction.kind){this.ensureSheet(this.reaction.kind);if(this.animationSheets.failed.has(this.reaction.kind))this.reaction.stop();}
    if(this.container.dataset.companionAnimation!==(this.companion.kind||'idle'))this.container.dataset.companionAnimation=this.companion.kind||'idle';
    this.walkingFraming=(this.walkingFraming||0)+(Number(Boolean(this.walking) || this.companion.kind==='legs')-(this.walkingFraming||0))*Math.min(1,dt*7);
    const seated=(this.idleAnimation.phase !== 'idle' && this.canSit()) || this.companion.sample().phase==='sleep' || Boolean(this.reaction.kind);
    this.sittingFraming=(this.sittingFraming || 0)+(Number(seated)-(this.sittingFraming || 0))*Math.min(1,dt*5);
    if(this.container.dataset.idleAnimation!==this.idleAnimation.phase)this.container.dataset.idleAnimation=this.idleAnimation.phase;
    this.cursorGaze.tick(dt,this.cursorEligible());
    if(this.cursorGaze.frame!==null)this.ensureSheet('cursor');
    this.render();
  }

  render() {
    if(this.disposed)return;
    if(this.character==='fairy'){this.renderFairy();return;}
    const activeImg = this.getActiveSprite();
    if (!activeImg.loaded || !this.canvas.width || !this.canvas.height) return;
    const ctx = this.ctx;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = this.canvas.width / dpr;
    const cssH = this.canvas.height / dpr;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.imageSmoothingEnabled = false;

    const imgW = activeImg.naturalWidth || 840;
    const imgH = activeImg.naturalHeight || 1520;

    // Determine viewport framing
    let srcX = 0, srcY = 0, srcW = imgW, srcH = imgH;
    let headSourceY = Math.round(imgH * 0.20); // landmark center of face
    let headSourceX = Math.round(imgW * 0.50);

    // Frame on the artwork itself: sprites with tall empty margins would
    // otherwise be scaled down to fit space that contains nothing.
    const trim = this.sprites.idle.trim || activeImg.trim || { top: 0, bottom: imgH, left: 0, right: imgW };
    const artTop = trim.top, artHeight = Math.max(1, trim.bottom - trim.top);
    srcX = 0;
    srcW = imgW;
    if (this.floating) {
      // Torso-up: from the top of her hair down past the crossed arms.
      srcY = artTop;
      srcH = Math.round(artHeight * (0.58 + .24*(this.sittingFraming || 0) + .42*(this.walkingFraming || 0)));
      if(activeImg.walking || activeImg.companion==='legs'){srcY=0;srcH=imgH;}
    } else {
      srcY = artTop;
      srcH = artHeight;
    }

    // New sheets include higher halos than the default outfit; keep their top edge.
    if(activeImg.companion){srcY=0;if(!this.floating)srcH=imgH;}
    if(activeImg.desk){srcY=0;srcH=1120;}

    // Integer-friendly scaling to preserve pixel sharpness.
    // Slightly over-fill so she reads as present rather than floating in space;
    // the extra goes past the frame edges, which the canvas clips.
    const fill = this.floating ? 0.98 : 1.04;
    const fitScaleX = (cssW * fill) / srcW;
    const fitScaleY = (cssH * fill) / srcH;
    const scale = Math.min(fitScaleX, fitScaleY);

    const destW = Math.round(srcW * scale);
    const destH = Math.round(srcH * scale);
    let destX = Math.round((cssW - destW) / 2);
    let destY = Math.round((cssH - destH) / 2);

    if (this.floating) {
      // In floating mode, anchor closer to bottom (above controls pill bar)
      destY = Math.round(cssH - destH - 10);
    }

    // Animation physics / bobbing / dancing
    let bobY = 0;
    let rot = 0;
    let danceX = 0;
    let squashX = 1;
    let squashY = 1;
    const isWaving = this.elapsed < this.waveUntil;
    const isDancing = activeImg===this.sprites.dancing;

    if (activeImg.walking || activeImg.companion) {
      // The supplied gait already includes step and hair movement.
    } else if (isWaving) {
      // Waving bounce
      bobY = Math.sin(this.elapsed * 10) * 4;
      rot = Math.sin(this.elapsed * 8) * 0.02;
    } else if (isDancing) {
      // Vibing and subtle dancing to music (~108 BPM)
      const beatFreq = 3.6;
      const beat = Math.sin(this.elapsed * beatFreq * Math.PI);
      const bounce = Math.abs(beat);
      bobY = -bounce * 5.0; // upbeat bounce
      rot = Math.sin(this.elapsed * (beatFreq / 2) * Math.PI) * 0.028; // groove tilt
      danceX = Math.cos(this.elapsed * (beatFreq / 2) * Math.PI) * 3.0; // lateral dance step
      squashY = 1 - (1 - bounce) * 0.02;
      squashX = 1 + (1 - bounce) * 0.015;
    } else if (this.activity === 'speaking' || this._mouth > 0.05) {
      // Speech bobbing driven by audio RMS input
      const speechPower = Math.max(this._mouth, 0.25);
      bobY = Math.sin(this.elapsed * 12) * (2.6 * speechPower);
    } else if (this.activity === 'thinking') {
      // Subtle ponder
      bobY = Math.sin(this.elapsed * 2) * 1.5;
      rot = 0.01;
    } else {
      // Natural idle breathing bob
      bobY = Math.sin(this.elapsed * 2.2) * 2;
    }

    destY += Math.round(bobY);
    destX += Math.round(this.lookOffset.x + danceX);

    if (this.lastHitSprite !== activeImg || activeImg.sitting || activeImg.blendedCompanion) {
      this.buildHitMap(activeImg);this.lastHitSprite=activeImg;this.lastHitTime=this.elapsed;
    }
    // Save layout for hitTest
    this.layout = { destX, destY, destW, destH, srcX, srcY, srcW, srcH };

    // Hair animation parameters
    const hairSpeed = isDancing ? 4.8 : 2.2;
    const hairAmp = isDancing ? 3.2 : 1.8;

    // Draw sprite with animated hair
    ctx.save();
    ctx.translate(destX + destW / 2, destY + destH * 0.4);
    if (rot !== 0) ctx.rotate(rot);
    if (squashX !== 1 || squashY !== 1) ctx.scale(squashX, squashY);
    ctx.translate(-(destX + destW / 2), -(destY + destH * 0.4));

    if (activeImg.sitting || activeImg.walking || activeImg.companion) {
      // Keep the chair/table rigid; the supplied frames already animate her hair.
      this.drawSprite(ctx,activeImg,srcX,srcY,srcW,srcH,destX,destY,destW,destH);
    } else {
    // Body and head stay still; only the hair either side of them sways.
    const centerSx1 = Math.round(imgW * 0.32);
    const centerSx2 = Math.round(imgW * 0.68);
    const centerSw = centerSx2 - centerSx1;
    this.drawSprite(ctx,
      activeImg,
      centerSx1, srcY, centerSw, srcH,
      destX + Math.round(centerSx1 * scale), destY,
      Math.round(centerSw * scale), destH
    );

    // Left hair locks - wavy flame flow
    const sliceW = 8;
    for (let sx = 0; sx < centerSx1; sx += sliceW) {
      const sw = Math.min(sliceW, centerSx1 - sx);
      const t = Math.max(0, Math.min(1, (centerSx1 - (sx + sw / 2)) / Math.max(1, centerSx1 - imgW * 0.12)));
      const waveY = Math.sin(this.elapsed * hairSpeed + sx * 0.035) * (t * hairAmp * scale);
      const waveX = Math.sin(this.elapsed * hairSpeed * 0.8 + sx * 0.025) * (t * (hairAmp * 0.65) * scale);
      this.drawSprite(ctx,
        activeImg,
        sx, srcY, sw, srcH,
        destX + Math.round(sx * scale + waveX), destY + Math.round(waveY),
        Math.ceil(sw * scale) + 1, destH
      );
    }

    // Right hair locks - wavy flame flow
    for (let sx = centerSx2; sx < imgW; sx += sliceW) {
      const sw = Math.min(sliceW, imgW - sx);
      const t = Math.max(0, Math.min(1, ((sx + sw / 2) - centerSx2) / Math.max(1, imgW * 0.88 - centerSx2)));
      const waveY = Math.sin(this.elapsed * hairSpeed + sx * 0.035 + 1.8) * (t * hairAmp * scale);
      const waveX = Math.sin(this.elapsed * hairSpeed * 0.8 + sx * 0.025 + 1.4) * (t * (hairAmp * 0.65) * scale);
      this.drawSprite(ctx,
        activeImg,
        sx, srcY, sw, srcH,
        destX + Math.round(sx * scale + waveX), destY + Math.round(waveY),
        Math.ceil(sw * scale) + 1, destH
      );
    }
    }
    ctx.restore();



    // Calculate on-screen head position for AvatarEffects (speech bubbles, thinking bulbs, music notes)
    const headNormY = (headSourceY - srcY) / srcH;
    const headNormX = (headSourceX - srcX) / srcW;
    const headScreenX = destX + destW * headNormX;
    const headScreenY = destY + destH * headNormY;
    this.headPoint = { x: headScreenX, y: headScreenY };

    // Trigger external pixel effects
    this.effects?.draw({
      width: cssW,
      height: cssH,
      head: this.headPoint,
      time: this.elapsed,
      activity: this.vocalMusic ? 'singing' : this.activity,
      music: this.musicPlaying,
      quizThinking: this.quizThinking && this.floating && this.active && this.awake && this.optionalMotion && !document.hidden && this._mouth<=.05 && !document.documentElement.classList.contains('desktop-working'),
      enabled: this.effectsEnabled,
    });
  }

  renderFairy(){
    if(!this.canvas.width || !this.canvas.height)return;
    const dpr=Math.min(window.devicePixelRatio || 1, 2),cssW=this.canvas.width/dpr,cssH=this.canvas.height/dpr,ctx=this.ctx;
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,cssW,cssH);
    this.headPoint=this.fairy.render(this,ctx,cssW,cssH,dpr);
    this.effects?.draw({width:cssW,height:cssH,head:this.headPoint,time:this.elapsed,activity:this.vocalMusic?'singing':this.activity,music:this.musicPlaying,
      quizThinking:this.quizThinking && this.floating && this.active && this.awake && this.optionalMotion && !document.hidden && this._mouth<=.05 && !document.documentElement.classList.contains('desktop-working'),enabled:this.effectsEnabled});
  }

  drawSprite(ctx,img,sx,sy,sw,sh,dx,dy,dw,dh){const ratio=img.width/img.naturalWidth;ctx.drawImage(img,sx*ratio,sy*ratio,sw*ratio,sh*ratio,dx,dy,dw,dh);}

  dispose() {
    if(this.disposed)return;this.disposed=true;
    this.animationSheets.dispose();this.reducedMotion.removeEventListener('change',this.onReduced);this.animationAllowed=null;this.cursorAllowed=null;this.reactionAllowed=null;this.reaction.stop();this.seatedLast=null;this.cursorSampler?.dispose();this.cursorGaze.reset();this.onFrame=null;this.frameLoop.dispose();this.resizeObserver?.disconnect();document.removeEventListener('visibilitychange',this.onVisibility);
    for(const image of this.pendingImages){image.onload=image.onerror=null;image.src='';}this.pendingImages.clear();
    for(const image of [...Object.values(this.sprites),this.blendedSprite,this.companionBlend])image.width=image.height=0;
    this.sprites={};this.hitCache=new WeakMap();this.hitData=null;this.blendFrom=this.blendTo=this.companionFrom=this.companionTarget=null;
    this.canvas.width=this.canvas.height=0;this.canvas.remove();if(this.ownsEffects)this.effects.dispose();
  }
}
