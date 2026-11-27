import {createHash} from 'node:crypto';
import {questionEvidenceKey} from './quiz-images.mjs';
import {questionIds,questionSource,questionReferences} from './question-buffer.mjs';

const normalize=text=>text.replace(/\s+/g,' ').trim();
const hash=text=>createHash('sha256').update(text).digest('hex');
// OCR swaps letters inside "answer" (seen live: "Explain your 2nswer to question I").
const ocrWord={answer:'[a2@4]nsw[e3]r',choice:'ch[o0]ice',reasoning:'r[e3][a2@]s[o0]ning'};
const continuation=text=>new RegExp(String.raw`\b(?:same (?:setup|scenario|example|problem|case|data|figure|conditions)|previous (?:question|answer|part)|preceding question|continuation|(?:explain|justify) (?:your|the) (?:${ocrWord.answer}|${ocrWord.choice}|${ocrWord.reasoning}))\b`,'i').test(text);
const references=questionReferences;
const number=id=>/^\d+[a-z]?$/i.test(id||'')?parseInt(id,10):null;
const subjects=text=>[...text.matchAll(/\b(feasible\s+region|graph|figure|diagram|table|dataset|data\s+set|scenario|setup)\b/gi)].map(m=>m[1].toLowerCase().replace(/\s+/g,' '));
const backReference=text=>/\b(?:feasible\s+region|graph|figure|diagram|table|dataset|data\s+set|scenario|setup)\b[^.!?\n]{0,70}\b(?:above|earlier|previously)\b|\b(?:above|previous|preceding)\s+(?:feasible\s+region|graph|figure|diagram|table|dataset|data\s+set|scenario|setup)\b/i.test(normalize(text));
function sharedRanges(text){
 const normalized=normalize(text.normalize('NFKC'));
 const ranges=[];
 // A scope declaration, not an arbitrary mention of a range of questions.
 const pattern=/\bfor\s+(?:(?:this(?:\s+question)?|the\s+current\s+question)\s*(?:,\s*)?and\s+)?(?:the\s+following\s+)?questions?\s*(\d+)\s*(?:[-–—]|to|through)\s*(\d+)\b/gi;
 for(const match of normalized.matchAll(pattern)){
  const from=Number(match[1]),to=Number(match[2]);
  if(from>=1&&to>=from&&to<=999)ranges.push({from,to});
 }
 return ranges;
}
const applies=(entry,id)=>number(id)!==null&&sharedRanges(entry.text).some(r=>number(id)>=r.from&&number(id)<=r.to);
// Old questions are separate supporting evidence, never active answer candidates.
// No disk persistence or model-generated answers. Caps apply to all retained views.
export class QuestionHistory {
  constructor({now=Date.now,ttl=20*60*1000,maxQuestions=12,maxBytes=24*1024*1024,maxText=144000}={}) {
    Object.assign(this,{now,ttl,maxQuestions,maxBytes,maxText});this.clear();
  }
  clear(){this.entries=[];this.source='';}
  prune(){this.entries=this.entries.filter(entry=>this.now()-Math.max(entry.at,entry.usedAt||0)<this.ttl);}
  dependencies(current,candidates=this.entries){
    // Native OCR observations carry a numeric IPC request `id`. It is not the
    // question number. Prefer source headings; only stored history entries have
    // a string question ID to fall back to when their heading is off-screen.
    const headings=questionIds(current.text||'');
    const ids=headings.length?headings:typeof current.id==='string'&&/^\d+[a-z]?$/i.test(current.id)?[current.id]:[];
    const id=ids.length===1?ids[0]:'';
    const text=current.text||'',refs=[...new Set(references(text).filter(ref=>!ids.includes(ref)))];
    const earlier=candidates.filter(entry=>entry!==current&&(!current.key||entry.key!==current.key)&&!ids.includes(entry.id)&&(!id||!entry.id||number(entry.id)<number(id)));
    // "Explain your answer" depends on the preceding question as well as
    // any shared graph. A shared scope must not displace that immediate source.
    // Prefer numbered order over whichever earlier page was visited most recently.
    const direct=refs.length?earlier.filter(entry=>refs.includes(entry.id)).slice(-2):
      continuation(text)?earlier.filter(entry=>!id||number(entry.id)===number(id)-1).slice(-1):[];
    const scoped=earlier.filter(entry=>applies(entry,id));
    if(direct.length||scoped.length||refs.length)return [...direct,...scoped.filter(entry=>!direct.includes(entry))];
    if(backReference(text)){
      const wanted=subjects(text);
      // Follow the original description, skipping intervening questions which
      // merely refer back to it. Expired question-set scopes are not reused.
      return earlier.filter(entry=>!backReference(entry.text)&&!continuation(entry.text)&&
        (!sharedRanges(entry.text).length||applies(entry,id))&&subjects(entry.text).some(s=>wanted.includes(s))).slice(-1);
    }
    return [];
  }
  prerequisites(roots){
    const protectedKeys=new Set();const queue=[...roots];
    for(let i=0;i<queue.length && i<this.maxQuestions;i++){
      const current=queue[i];
      for(const entry of this.dependencies(current)){
        if(protectedKeys.has(entry.key))continue;
        protectedKeys.add(entry.key);queue.push(entry);
      }
    }
    return protectedKeys;
  }
  remember(observation){
    this.prune();
    if(!observation || observation.bufferBlocked || typeof observation.text!=='string' || !observation.text.trim() || !observation.snapshot)return;
    const source=questionSource(observation);
    if(this.source && source!==this.source)this.clear();
    this.source=source;
    const text=observation.text,ids=questionIds(text);
    // Avoid storing ordinary readable pages or ambiguous multi-question views.
    if(ids.length>1 || (!ids.length && !sharedRanges(text).length && !/[?]|\b(?:true or false|true\/false|choose|select)\b|(?:^|\n)\s*[A-D][.)]\s/mi.test(text)))return;
    const snapshots=observation.snapshots ?? [observation.snapshot];
    const bytes=snapshots.reduce((sum,image)=>sum+Buffer.byteLength(image.url||'','utf8'),0);
    if(!snapshots.length || snapshots.length>6 || text.length>24000 || bytes>Math.min(this.maxBytes,12*1024*1024))return;
    const key=observation.bufferKey || hash(text);
    const index=this.entries.findIndex(entry=>ids.length ? entry.id===ids[0] : entry.key===key || normalize(entry.text).includes(normalize(text)) || normalize(text).includes(normalize(entry.text)));
    let entry={id:ids[0]||'',key,text,snapshots:snapshots.map(s=>({...s,...(snapshots.length===1&&observation.visualKey?{visualKey:observation.visualKey}:{})})),bytes,at:this.now()};
    if(index>=0){
      const previous=this.entries.splice(index,1)[0];
      // Known exact views must not replace assembled evidence with OCR drift or chrome.
      const knownViews=entry.snapshots.length && entry.snapshots.every(s=>s.visualKey && previous.snapshots.some(old=>old.visualKey===s.visualKey));
      // A literal scroll back to a smaller slice must preserve the full assembly.
      const hasPixels=entry.snapshots.some(s=>s.visualKey);
      if(knownViews || (!hasPixels && normalize(previous.text).includes(normalize(text))))entry={...previous,at:this.now()};
      // An unlabeled literal fragment matched this earlier question. Keep its ID
      // so changed pixels invalidate dependent answers, rather than looking evicted.
      else if(!entry.id)entry.id=previous.id;
    }
    this.entries.push(entry);
    for(const key of this.prerequisites([entry])){const source=this.entries.find(e=>e.key===key);source.usedAt=this.now();}
    const protectedKeys=this.prerequisites(this.entries.slice(-2));
    while(this.entries.length>this.maxQuestions || this.entries.reduce((n,e)=>n+e.bytes,0)>this.maxBytes || this.entries.reduce((n,e)=>n+e.text.length,0)>this.maxText){
      const index=this.entries.findIndex((e,i)=>i<this.entries.length-1 && !protectedKeys.has(e.key));
      this.entries.splice(index<0?0:index,1);
    }
  }
  context(observation){
    this.prune();
    if(questionSource(observation)!==this.source)return [];
    const text=observation.text||'',ids=questionIds(text),key=observation.bufferKey || hash(text);
    const candidates=this.entries.filter(entry=>entry.key!==key && !(ids.length && ids.includes(entry.id)) && !normalize(entry.text).includes(normalize(text)));
    // Explicit references take priority, followed by declared shared setup.
    const selected=this.dependencies(observation,candidates).slice(0,2);
    // Follow prerequisite chains (Q7 -> Q6 -> Q4) without expanding the two-question
    // provider budget. Direct references take priority; cycles/current/future IDs
    // never enter this traversal. Preserve source images, not old model answers.
    for(let i=0;i<selected.length && selected.length<2;i++) {
      const entry=selected[i];
      for(const prerequisite of this.dependencies(entry,candidates)) {
        if(selected.includes(prerequisite))continue;
        selected.push(prerequisite);
        if(selected.length===2)break;
      }
    }
    // A larger local history does not enlarge the provider payload budget.
    let bytes=0;
    return selected.filter(entry=>{if(bytes+entry.bytes>12*1024*1024)return false;bytes+=entry.bytes;entry.usedAt=this.now();return true;}).map(({id,text,snapshots})=>({id,text,snapshots}));
  }
  attach(observation){
    const previousQuestions=this.context(observation);
    const baseKey=observation.bufferKey || hash(observation.text||'');
    // Revisiting a previously unsolvable follow-up after seeing its prerequisite
    // must retry, rather than reuse an abstention cached without that evidence.
    const contextKey=previousQuestions.length ? hash(baseKey+'\n'+JSON.stringify(previousQuestions.map(e=>[e.id,questionEvidenceKey(e)]))):baseKey;
    return {...observation,previousQuestions,contextKey};
  }
}
