import {questionSource,referenceLabels} from './question-buffer.mjs';
const label=/^(?:question|problem|exercise|q\.?)\s*[:#]?$/i;
// Allow common heading metadata, never arbitrary question prose or references.
const heading=/^(?:question|problem|exercise|q\.?)\s*[:#]?\s*(\d+[a-z]?)\s*[.):]?\s*(?:(?:of|\/)\s*\d+\s*)?(?:\(?\s*\d+(?:\.\d+)?\s*(?:points?|pts?\.?|marks?)\s*\)?\s*)?$/i;
const norm=s=>String(s).normalize('NFKC').replace(/\s+/g,' ').trim();
const validBox=l=>Number.isFinite(l.x)&&Number.isFinite(l.y)&&Number.isFinite(l.width)&&Number.isFinite(l.height)&&l.width>0&&l.height>0;
export function questionHeadings(lines){
 const boxes=lines.filter(l=>Number.isFinite(l.x)&&Number.isFinite(l.y)).map(l=>({...l,width:l.width??.15,height:l.height??.025})).filter(validBox);
 const heads=[];
 for(const line of boxes){
  let id=heading.exec(referenceLabels(norm(line.text)))?.[1]?.toLowerCase(),box=line;
  if(!id&&label.test(norm(line.text))){
   // Vision can split "Question" and "3" into neighbouring observations.
   const nearby=boxes.filter(other=>other!==line&&/^\d+[a-z]?\s*[.):]?$/i.test(norm(other.text))&&(
    Math.abs(other.y-line.y)<=Math.max(line.height,other.height)*.5&&other.x>=line.x+line.width-.004&&other.x-(line.x+line.width)<=.03||
    other.y>=line.y+line.height-.004&&other.y-(line.y+line.height)<=Math.max(line.height,other.height)&&Math.abs(other.x-line.x)<=.02
   ));
   if(nearby.length===1){
    const number=nearby[0];id=/\d+[a-z]?/i.exec(norm(number.text))[0].toLowerCase();
    box={...line,width:Math.max(line.x+line.width,number.x+number.width)-line.x,height:Math.max(line.y+line.height,number.y+number.height)-line.y};
   }
  }
  if(id)heads.push({id,line:box});
 }
 return heads;
}
// Cursor positions and OCR boxes use normalized, top-down display coordinates.
// Lock only on a standalone heading; passing over body references never selects.
export class QuizTarget {
 constructor({now=Date.now,dwellMs=450,headingMaxAge=2500}={}){Object.assign(this,{now,dwellMs,headingMaxAge});this.automatic=true;this.clear();}
 clear(){this.selected=null;this.source='';this.hover=null;this.pendingHover=null;this.waiting=false;this.lastLines=[];this.lastSeen=0;this.heads=[];this.headingAt=-Infinity;this.bounds=null;}
 setAutomatic(value){if(typeof value!=='boolean')throw Error('Invalid quiz targeting mode');this.clear();this.automatic=value;}
 samePosition(a,b){
  return Math.abs(a.x-b.x)<=Math.max(.004,this.bounds?.width>0?6/this.bounds.width:0)&&Math.abs(a.y-b.y)<=Math.max(.004,this.bounds?.height>0?4/this.bounds.height:0);
 }
 updateHover(cursor){
  const px=this.bounds?.width>0?12/this.bounds.width:.008,py=this.bounds?.height>0?8/this.bounds.height:.008;
  const hits=this.heads.filter(({line:l})=>cursor&&cursor.x>=l.x-px&&cursor.x<=l.x+l.width+px&&cursor.y>=l.y-py&&cursor.y<=l.y+l.height+py);
  const hovered=hits.length===1?hits[0]:null;
  if(!hovered||this.now()-this.headingAt>this.headingMaxAge){this.hover=null;return false;}
  // Scrolling/moving the heading restarts dwell; small OCR jitter is harmless.
  if(this.hover?.id!==hovered.id||!this.samePosition(this.hover,hovered.line)){
   this.hover={id:hovered.id,x:hovered.line.x,y:hovered.line.y,at:this.now(),requested:false};
  }
  return this.now()-this.hover.at>=this.dwellMs;
 }
 sampleHover(cursor){
  // Fast cursor samples only request verification. A fresh OCR observation must
  // confirm the heading/source before changing the selected question.
  if(this.pendingHover){
   if(this.now()-this.pendingHover.at>2000)this.pendingHover=null;
   else if(this.now()-this.pendingHover.requestedAt>=200){this.pendingHover.requestedAt=this.now();return true;}
  }
  if(!this.updateHover(cursor)||this.hover.id===this.selected||this.hover.requested)return false;
  this.hover.requested=true;this.pendingHover={...this.hover,at:this.now(),requestedAt:this.now()};return true;
 }
 // Efficiency audit, fix 6: the pointer is worth sampling quickly only while there's a heading to hover (seen within
 // headingMaxAge) or a hover waiting to be confirmed. Otherwise a look a second is enough, and onHeadings wakes the
 // sampler as soon as a heading is seen.
 hoverable(){return Boolean(this.pendingHover)||(Boolean(this.bounds)&&this.heads.length>0&&this.now()-this.headingAt<=this.headingMaxAge);}
 hoverEveryMs(){return this.hoverable()?100:1000;}
 sampleScreenPoint(point){
  if(!this.bounds){this.hover=null;return false;}
  return this.sampleHover({x:(point.x-this.bounds.x)/this.bounds.width,y:(point.y-this.bounds.y)/this.bounds.height});
 }
 select(raw,cursor,{bounds=null,capturedAt=this.now()}={}){
  const source=questionSource(raw);
  if(this.source&&this.source!==source)this.clear();this.source=source;
  if(this.selected&&this.now()-this.lastSeen>120000)this.clear();this.source=source;
  const lines=raw.lines||[],heads=questionHeadings(lines);
  this.heads=heads;this.headingAt=capturedAt;this.bounds=bounds;
  if(heads.length&&bounds)this.onHeadings?.();
  // Preserve a completed gesture if the pointer moves away while OCR finishes.
  // Never commit it on an older capture, a moved label, or a different source.
  if(this.pendingHover&&capturedAt>=this.pendingHover.at){
   const pending=this.pendingHover,matching=heads.filter(h=>h.id===pending.id);
   if(this.now()-pending.at<=2000&&matching.length===1&&this.samePosition(matching[0].line,pending)){
    this.selected=pending.id;this.automatic=false;this.lastSeen=this.now();
   }
   this.pendingHover=null;
  }
  if(this.updateHover(cursor)){this.selected=this.hover.id;this.automatic=false;this.lastSeen=this.now();}
  this.waiting=false;
  if(!this.selected){
   if(this.automatic&&heads.length<=1)return raw;
   this.waiting=true;return {...raw,text:'',lines:[],targetPending:true};
  }
  const active=heads.filter(h=>h.id===this.selected);
  if(active.length>1)return this.block(raw);
  const region=raw.region||{x:0,y:0,width:1,height:1};
  let top=region.y,bottom=region.y+region.height;
  if(active.length){
   const h=active[0];top=Math.max(top,h.line.y-.004);
   const below=heads.filter(other=>other.line.y>h.line.y+.015).sort((a,b)=>a.line.y-b.line.y)[0];
   if(below)bottom=Math.min(bottom,below.line.y-.006);
   // Multiple columns with headings at the same height require a different layout selector.
   if(heads.some(other=>other!==h&&Math.abs(other.line.y-h.line.y)<=.015))return this.block(raw);
  }else{
   // The selected heading may scroll above the viewport. Require actual overlap
   // with its previous capture before treating this top fragment as a continuation.
   const first=heads[0];
   if(first){
    if(!/^\d+$/.test(this.selected)||Number(first.id)!==Number(this.selected)+1)return this.block(raw);
    bottom=Math.min(bottom,first.line.y-.006);
   }
   const current=lines.filter(l=>l.y<bottom).map(l=>norm(l.text));
   const shared=current.filter(t=>t.length>=14&&this.lastLines.includes(t));
   if(shared.length<2||shared.reduce((n,t)=>n+t.length,0)<50)return this.block(raw);
  }
  const selectedLines=lines.filter(l=>l.y>=top&&l.y<bottom);
  if(bottom-top<.035||!selectedLines.length)return this.block(raw);
  this.lastLines=selectedLines.map(l=>norm(l.text));this.lastSeen=this.now();
  // Keep a known identifier when its heading scrolls away. No source text is rewritten.
  const text=(active.length?'':`Question ${this.selected}\n`)+selectedLines.map(l=>l.text).join('\n');
  return {...raw,text,lines:active.length?selectedLines:[{text:`Question ${this.selected}`,x:region.x,y:top},...selectedLines],region:{...region,y:top,height:bottom-top},targetQuestion:this.selected};
 }
 block(raw){this.waiting=true;return {...raw,text:'',lines:[],targetPending:true};}
}
