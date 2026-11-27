// Hand-drawn pixel sprites stay sharp at every display scale; no image assets or API calls.
const BULB = [
 '.....kkkk.....', '...kkYYYYkk...', '..kYYYYYYYYk..', '.kYYWWYYYYYYk.', '.kYYWYYYYYYYk.', '.kYYYYYYYYYYk.', '.kYYYkkkkYYYk.', '..kYYkYYkYYk..', '...kYkYYkYk...', '....kYYYYk....', '....kGGGGk....', '....kSSSSk....', '.....kkkk.....',
];
const BUBBLE = [
 '..kkkkkkkkkkkk..', '.kWWWWWWWWWWWWk.', 'kWWWWWWWWWWWWWWk', 'kWWWWWWWWWWWWWWk', 'kWWWWWWWWWWWWWWk', 'kWWWWWWWWWWWWWWk', 'kWWWWWWWWWWWWWWk', '.kWWWWWWWWWWWWk.', '..kkkkkWWkkkkk..', '......kWk.......', '......kk........',
];
const NOTE = [
 '....kkkk..', '....kCCkk.', '....kCCCk.', '....kCCkk.', '....kCk...', '....kCk...', '..kkkCk...', '.kCCCCk...', '.kCCCkk...', '..kkk.....',
];
const DOUBLE_NOTE = [
 '...kkkkkkkk...', '...kPPPPPPk...', '...kPkkkkPk...', '...kPk..kPk...', '...kPk..kPk...', '...kPk..kPk...', '.kkkPk.kkPk...', 'kPPPPkkPPPk...', 'kPPPkkkPPkk...', '.kkk...kkk....',
];
const PALETTE = {k:'#231d35',Y:'#ffd35b',W:'#fff7dc',G:'#acbac8',S:'#758499',C:'#86edf0',P:'#ee99d0'};
function sprite(ctx, pixels, x, y, size, colors = PALETTE) {
  for (let row=0;row<pixels.length;row++) for(let col=0;col<pixels[row].length;col++) {
    const color=colors[pixels[row][col]]; if(!color)continue;
    ctx.fillStyle=color;ctx.fillRect(Math.round(x+col*size),Math.round(y+row*size),size,size);
  }
}
export class AvatarEffects {
  constructor(container) {
    this.canvas=document.createElement('canvas');this.canvas.className='avatar-pixel-effects';
    this.canvas.setAttribute('aria-hidden','true');
    Object.assign(this.canvas.style,{position:'absolute',inset:'0',width:'100%',height:'100%',pointerEvents:'none',imageRendering:'pixelated'});
    container.append(this.canvas);this.ctx=this.canvas.getContext('2d');this.reduced=matchMedia('(prefers-reduced-motion: reduce)');
  }
  hideQuiz(){if(this.quizVisible){this.canvas.hidden=true;this.quizVisible=false;}}
  dispose(){this.canvas.width=this.canvas.height=0;this.canvas.remove();}
  draw({width,height,head,time,activity,music,quizThinking=false,enabled=true}) {
    const quiz=Boolean(enabled&&head&&quizThinking&&activity==='idle');this.quizVisible=quiz;
    const active=quiz || enabled&&head&&['thinking','speaking','singing'].includes(activity), notes=enabled&&head&&(music||activity==='singing');
    this.canvas.hidden=!(active||notes);
    if(this.canvas.hidden)return;
    const dpr=Math.min(devicePixelRatio||1,2),w=Math.round(width*dpr),h=Math.round(height*dpr);
    if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}
    const ctx=this.ctx;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);ctx.imageSmoothingEnabled=false;
    const t=this.reduced.matches?0:Math.floor(time*8)/8;
    const clamp=(v,max)=>Math.max(3,Math.min(max-3,v));
    if(activity==='thinking' || quiz) {
      const x=clamp(head.x-(quiz?112:72),width-42),y=clamp(head.y-52+Math.sin(t*2)*3,height-(quiz?52:42));
      const warm=Math.floor(t*2)%3!==0;
      sprite(ctx,BULB,x+6,y+7,2,{...PALETTE,Y:warm?'#ffd35b':'#f0b943'});
      if(quiz){
        const lit=this.reduced.matches?3:Math.floor(t*3)%4;
        for(let n=0;n<3;n++){ctx.fillStyle=n<lit?'#ffe999':'#796b51';ctx.fillRect(Math.round(x+11+n*7),Math.round(y+40),3,3);}
      }
      if(warm){ctx.fillStyle='#ffe999';for(const [dx,dy,dw,dh]of[[19,0,2,4],[0,14,4,2],[36,14,4,2],[3,3,3,3],[33,3,3,3]])ctx.fillRect(Math.round(x+dx),Math.round(y+dy),dw,dh);}
    }
    if(activity==='speaking') {
      const x=clamp(head.x-84,width-36),y=clamp(head.y-6+Math.sin(t*2)*2,height-28);
      sprite(ctx,BUBBLE,x,y,2);
      const lit=this.reduced.matches?3:Math.floor(t*3)%4;
      for(let n=0;n<3;n++){ctx.fillStyle=n<lit?'#564475':'#ccbcd4';ctx.fillRect(Math.round(x+8+n*6),Math.round(y+9),3,3);}
    }
    if(notes) {
      for(let n=0;n<3;n++) {
        const phase=this.reduced.matches?n*.28:(t/2.7+n/3)%1;
        const x=clamp(head.x+38+n*10+Math.sin(phase*4+n)*9,width-30),y=clamp(head.y-4-phase*72,height-26);
        ctx.globalAlpha=this.reduced.matches?0.9:Math.min(1,phase*7,(1-phase)*4);
        sprite(ctx,n%2?DOUBLE_NOTE:NOTE,x,y,2);ctx.globalAlpha=1;
      }
    }
  }
}
