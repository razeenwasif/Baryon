import {createHash} from 'node:crypto';
import {confirmsScroll,pixelScrollOverlap} from './quiz-images.mjs';

const normalize=text=>String(text||'').normalize('NFKC').replace(/\s+/g,' ').trim();
const chrome=/^(?:time (?:left|remaining)|elapsed time|timer)\s*:?\s*(?:\d{1,2}:\d{2}(?::\d{2})?)?\s*$|^(?:next(?: page| question)?|previous(?: page| question)?|back|submit(?: answer)?|save(?: answer)?|flag question|not yet answered|mark(?:ed)? out of\s+[\d.]+)$/i;
import {referenceLabels} from './quiz-labels.mjs';
export {referenceLabels} from './quiz-labels.mjs';
export const questionReferences=text=>[...referenceLabels(text).matchAll(/\b(?:question|problem|exercise|q\.?)\s*[:#]?\s*(\d+[a-z]?)\b/gi)].map(m=>m[1].toLowerCase());
export const questionIds=text=>[...new Set(referenceLabels(text).replace(/^(\s*(?:question|problem|exercise|q\.?))[^\S\n]*\n[^\S\n]*(\d+[a-z]?)(?=\s|[.:)]|$)/gim,'$1 $2').split('\n').map(line=>line.match(/^\s*(?:question|problem|exercise|q\.?)\s*[:#]?\s*(\d+[a-z]?)(?=\s|[.:)]|$)/i)?.[1]?.toLowerCase()).filter(Boolean))];
export const questionSource=raw=>JSON.stringify([raw.app||'',raw.pid||0,raw.windowId||0,String(raw.windowTitle||'').slice(0,300),raw.displayId??null]);
export function quizLines(raw){
 let lines=Array.isArray(raw.lines)&&raw.lines.length?raw.lines:raw.text.split('\n').map(text=>({text}));
 const heading=lines.findIndex(l=>/^\s*(?:question|problem|exercise|q\.?)\s*[:#]?\s*\d+[a-z]?\b/i.test(referenceLabels(l.text)));
 if(heading>=0)lines=lines.slice(heading);
 const editor=lines.findIndex(l=>/^your answer$/i.test(String(l.text).trim()));if(editor>=0)lines=lines.slice(0,editor);
 return lines.slice(0,400).map(line=>({text:String(line.text||'').slice(0,1200).trim(),y:Number.isFinite(line.y)?line.y:null})).filter((line,i,all)=>line.text&&!chrome.test(line.text)&&!(/^\d{1,2}:\d{2}(?::\d{2})?$/.test(line.text)&&i>0&&/^(?:time (?:left|remaining)|elapsed time|timer)\s*:?\s*$/i.test(all[i-1].text))&&!(/^(?:show hint|hide hint|next question|back to previous question|ask anything|text view|skip question|ai mode response is ready)$/i.test(line.text))).map((line,index)=>({...line,key:normalize(line.text),index}));
}
function joinFrames(upper,lower,knownQuestion=false){
 // Ignore repeated fixed chrome only for alignment, never assume it proves a scroll.
 const fixed=(line,other)=>line.y!==null&&other.some(item=>item.key===line.key&&item.y!==null&&Math.abs(item.y-line.y)<.008);
 const a=upper.lines.filter(line=>!fixed(line,lower.lines)),b=lower.lines.filter(line=>!fixed(line,upper.lines));
 let best=null;
 for(let cutA=0;cutA<=1;cutA++)for(let cutB=0;cutB<=1;cutB++){
  const end=a.length-cutA;
  for(let size=Math.min(end,b.length-cutB);size>=1;size--){
   const left=a.slice(end-size,end),right=b.slice(cutB,cutB+size);
   if(!left.every((line,i)=>line.key===right[i].key))continue;
   const chars=left.reduce((sum,line)=>sum+line.key.length,0);
   if(chars<80 || (size===1&&chars<140))continue;
   const deltas=left.map((line,i)=>line.y!==null&&right[i].y!==null?line.y-right[i].y:null).filter(v=>v!==null);
   if(deltas.length && (deltas.some(v=>v<.025)||Math.max(...deltas)-Math.min(...deltas)>.035))continue;
   if(!best||chars>best.chars)best={chars,skip:right.at(-1).index+1};
   break;
  }
 }
 if(best)return best;
 // Two exact prose anchors with consistent movement can bridge noisy formula OCR,
 // but only if the intervening image rows match exactly. Never fuzzy-match maths.
 const pairs=[];let last=-1;
 for(const left of a){const j=b.findIndex((right,i)=>i>last&&right.key===left.key&&left.key.length>=35);
  if(j>=0){pairs.push([left,b[j]]);last=j;}}
 if(pairs.length>=2 && pairs.reduce((n,[line])=>n+line.key.length,0)>=100 &&
    pairs[0][1].index<=2 && a.at(-1).index-pairs.at(-1)[0].index<=2 && confirmsScroll(upper,lower,pairs)){
   return {chars:pairs.reduce((n,[line])=>n+line.key.length,0),skip:pairs.at(-1)[1].index+1};
 }
 // Diagram-heavy pages may have no stable prose anchors. A long, distinctive
 // exact pixel run across the viewport boundary can still prove the overlap.
 // Keep all OCR in this case; the provider resolves overlap from source images.
 if(pixelScrollOverlap(upper,lower))return {chars:0,skip:0};
 if(knownQuestion){
  const anchors=[];let last=-1;
  for(const left of a){const j=b.findIndex((right,i)=>i>last&&right.key===left.key&&left.key.length>=14);if(j>=0){anchors.push([left,b[j]]);last=j;}}
  const deltas=anchors.map(([x,y])=>x.y!==null&&y.y!==null?x.y-y.y:NaN);
  if(anchors.length>=2 && anchors.reduce((n,[l])=>n+l.key.length,0)>=50 && deltas.every(d=>d>.025) && Math.max(...deltas)-Math.min(...deltas)<.01){
   // A known numbered question and coherent prose movement are candidate
   // overlap, not proof that differing formula OCR is equivalent. Keep BOTH
   // source views and all OCR; the provider must resolve or abstain on conflict.
   return {chars:0,skip:0,provisional:true};
  }
 }
 return null;
}

// A bounded, RAM-only chain of overlapping views. Unrelated frames start afresh.
export class QuestionBuffer {
 constructor({now=Date.now,maxFrames=6,maxBytes=12*1024*1024,maxText=24000,ttl=120000}={}){Object.assign(this,{now,maxFrames,maxBytes,maxText,ttl});this.clear();}
 clear(){this.frames=[];this.source='';this.ids=[];this.bytes=0;this.changedAt=0;this.reason='';}
 ingest(raw){
  if(!raw||typeof raw.text!=='string'||raw.text.trim().length<25||!raw.snapshot||['dev.razeen.stella','dev.razeen.lyra'].includes(raw.app)){this.clear();return raw;}
  const lines=quizLines(raw),id=questionIds(raw.text),origin=questionSource(raw),key=lines.map(line=>line.key).join('\n');
  const frame={lines,key,scrollEvidence:raw.scrollEvidence,snapshot:{...raw.snapshot,...(raw.visualKey?{visualKey:raw.visualKey}:{})},visualKey:raw.visualKey||raw.snapshot.visualKey||'',bytes:Buffer.byteLength(raw.snapshot.url||'','utf8'),skip:0};
  let reset=!this.frames.length||origin!==this.source||this.now()-this.changedAt>=this.ttl||id.length>1||this.ids.length>1||(id.length&&this.ids.length&&id[0]!==this.ids[0]);
  if(reset)this.clear();
  if(frame.lines.reduce((sum,line)=>sum+line.text.length+1,0)>this.maxText||frame.bytes>this.maxBytes){this.clear();return {...raw,bufferBlocked:true,bufferReason:'limit',snapshots:[],bufferFrames:0};}
  const existing=this.frames.findIndex(item=>frame.visualKey && item.visualKey===frame.visualKey || item.key===key);
  if(existing>=0 && frame.visualKey && frame.visualKey!==this.frames[existing].visualKey){
   // Same OCR with changed pixels (e.g. graph) replaces that captured viewport.
   frame.skip=this.frames[existing].skip;this.frames[existing]=frame;this.changedAt=this.now();
  }
  if(existing<0){
   if(this.frames.length){
    const knownQuestion=this.ids.length===1 || id.length===1;
    const down=joinFrames(this.frames.at(-1),frame,knownQuestion),up=joinFrames(frame,this.frames[0],knownQuestion);
    if(down&&!up){if(down.provisional)this.reason='provisional overlap';frame.skip=down.skip;this.frames.push(frame);}
    else if(up&&!down){if(up.provisional)this.reason='provisional overlap';this.frames[0].skip=up.skip;this.frames.unshift(frame);}
    else {this.clear();this.reason='overlap';this.frames=[frame];}
   }else this.frames=[frame];
   this.bytes=this.frames.reduce((sum,item)=>sum+item.bytes,0);
   if(this.frames.length>this.maxFrames||this.bytes>this.maxBytes||this.text().length>this.maxText){this.clear();this.reason='limit';if(frame.bytes<=this.maxBytes){frame.skip=0;this.frames=[frame];this.bytes=frame.bytes;}}
   this.changedAt=this.now();
  }
  this.source=origin;if(id.length)this.ids=id;
  if(!this.frames.length)return {...raw,bufferBlocked:true,bufferReason:this.reason,snapshots:[]};
  const text=this.text().slice(0,this.maxText),currentIndex=existing>=0?existing:this.frames.findIndex(item=>item.key===key);
  return {...raw,text,snapshots:this.frames.map(item=>item.snapshot),bufferKey:createHash('sha256').update(origin+'\n'+text+'\n'+this.frames.map(f=>f.visualKey).join('|')).digest('hex'),bufferFrames:this.frames.length,currentFrame:Math.max(0,currentIndex),bufferReason:this.reason};
 }
 text(){return this.frames.flatMap(frame=>frame.lines.slice(frame.skip).map(line=>line.text)).join('\n');}
}
