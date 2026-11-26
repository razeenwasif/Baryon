import {questionEvidenceKey} from './quiz-images.mjs';
import {questionIds,questionSource,quizLines,questionReferences} from './question-buffer.mjs';
const normalized=text=>String(text||'').normalize('NFKC').replace(/\s+/g,' ').trim();
const lines=raw=>quizLines(raw).map(l=>normalized(l.text));
const visual=raw=>raw.visualKey || raw.snapshot?.visualKey || '';
const dependencyHash=questionEvidenceKey;
const refs=questionReferences;
// Successful answers only. No screenshots, disk persistence, or fuzzy matching.
export class QuizAnswerCache {
 constructor({now=Date.now,ttl=20*60*1000,maxEntries=30}={}){Object.assign(this,{now,ttl,maxEntries});this.clear();}
 clear(){this.entries=[];}
 prune(){this.entries=this.entries.filter(e=>this.now()-e.at<this.ttl);}
 remember(key,answer,observation,frames=[]){
  if(!answer)return;
  this.prune();
  const ids=questionIds(observation.text);if(ids.length>1)return;
  const views=[lines({...observation,lines:[]}),...frames.map(f=>f.lines.map(l=>normalized(l.text)))].filter(v=>v.length);
  const text=views[0].join(' ');if(text.length>24000)return;
  const entry={key,answer,source:questionSource(observation),id:ids[0]||'',views:views.slice(0,7),text,
   visualKeys:[...new Set([visual(observation),...frames.map(f=>f.visualKey||f.snapshot?.visualKey||'')].filter(Boolean))],
   dependencies:(observation.previousQuestions||[]).map(e=>({id:e.id,hash:dependencyHash(e)})),at:this.now()};
  this.entries=this.entries.filter(e=>e.key!==key);this.entries.push(entry);
  if(this.entries.length>this.maxEntries)this.entries.shift();
 }
 find(raw,history){
  this.prune();const current=lines(raw),text=current.join(' '),ids=questionIds(raw.text);
  if(text.length<25||ids.length>1)return null;
  const source=questionSource(raw),references=refs(raw.text).filter(id=>!ids.includes(id));
  const available=history.context?.(raw)||[];
  const matches=this.entries.filter(e=>{
   if(e.source!==source || (ids.length&&e.id&&ids[0]!==e.id))return false;
   // Only reuse a captured visual view. Text alone cannot detect a changed graph.
   if((visual(raw) || e.visualKeys.length) && !e.visualKeys.includes(visual(raw)))return false;
   // Earlier diagrams are dependencies as well as their recognized text.
   for(const dep of e.dependencies){const latest=history.entries.find(h=>h.id===dep.id);if(latest&&dependencyHash(latest)!==dep.hash)return false;}
   if(references.some(id=>history.entries.some(h=>h.id===id)&&!e.dependencies.some(d=>d.id===id)))return false;
   if(available.some(prior=>!e.dependencies.some(dep=>dep.id===prior.id&&dep.hash===dependencyHash(prior))))return false;
   // Matching question-area pixels already prove an unchanged captured view.
   if(visual(raw))return true;
   if(e.views.some(v=>v.join(' ')===text))return true;
   // A partial viewport must contain substantial known content in the same order.
   // All visible lines must match; changed numbers, negations and options miss.
   if(text.length<100)return false;
   let offset=0;const evidence=e.views[0];
   for(const line of current){const index=evidence.indexOf(line,offset);if(index<0)return false;offset=index+1;}
   return true;
  });
  // Ambiguous fragments shared by several questions never select an old answer.
  if(matches.length===1)return matches[0];
  // OCR refreshes can create multiple records for identical visual evidence.
  // Only consolidate when every match is the same numbered question and answer.
  if(visual(raw)&&matches.length>1&&matches[0].id&&matches.every(e=>e.id===matches[0].id&&JSON.stringify(e.answer)===JSON.stringify(matches[0].answer)))return matches.at(-1);
  return null;
 }
}
