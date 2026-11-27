import {noteTokens} from './notes.mjs';
// Dense numeric document IDs and packed postings avoid a Map entry per term/document.
// Search reuses scratch buffers; this worker handles requests serially.
//
// Every term's postings share two arrays (efficiency audit, after fix 12): a term's documents and weights are the
// slice from start[term] to start[term+1]. A typed array of its own per term cost more than the postings in it
// (95,808 terms over 28,952 book passages). They're built from (term, document, count) triples in a plain list, so
// only the final arrays are allocated outside the JavaScript heap, each once at its size: the build runs in a
// thread that ends (book-index-worker.mjs), and its heap goes with it. Scores and ranking are the same as before.
export class BookKeywords {
  constructor(items){
    this.ids=[];this.terms=new Map();const lengths=[],triples=[];let total=0;
    for(const item of items){const id=this.ids.length;this.ids.push(item.id);const body=noteTokens(item.answer),title=noteTokens(item.question),length=body.length+title.length;
      lengths.push(length);total+=length;
      const counts=new Map();for(const term of [...body,...title,...title])counts.set(term,(counts.get(term)||0)+1);
      for(const [term,tf] of counts){let t=this.terms.get(term);if(t===undefined)this.terms.set(term,t=this.terms.size);triples.push(t,id,tf);}
    }
    const used=triples.length,documents=this.ids.length,average=total/Math.max(1,documents),termCount=this.terms.size;
    // A counting sort by term keeps each term's documents in the order they were added, as the lists did.
    const start=new Uint32Array(termCount+1);for(let i=0;i<used;i+=3)start[triples[i]+1]++;
    for(let t=0;t<termCount;t++)start[t+1]+=start[t];
    const docs=new Uint32Array(used/3),weights=new Float32Array(used/3),next=start.slice(0,termCount);
    for(let i=0;i<used;i+=3){const t=triples[i],id=triples[i+1],tf=triples[i+2],n=start[t+1]-start[t],idf=Math.log(1+(documents-n+.5)/(n+.5)),at=next[t]++;
      docs[at]=id;weights[at]=idf*tf*2.2/(tf+1.2*(.25+.75*lengths[id]/Math.max(1,average)));}
    Object.assign(this,{start,docs,weights});
    this.scores=new Float64Array(documents);this.matched=new Uint16Array(documents);
  }
  toData(){return {ids:this.ids,terms:[...this.terms.keys()],start:this.start,docs:this.docs,weights:this.weights};}
  static transfers(data){return [data.start.buffer,data.docs.buffer,data.weights.buffer];}
  static fromData(data){const keywords=Object.create(BookKeywords.prototype);
    Object.assign(keywords,{ids:data.ids,terms:new Map(data.terms.map((term,t)=>[term,t])),start:data.start,docs:data.docs,weights:data.weights,scores:new Float64Array(data.ids.length),matched:new Uint16Array(data.ids.length)});
    return keywords;}
  // A term's postings as {docs, weights} views, for tests and inspection.
  postingsOf(term){const t=this.terms.get(term);return t===undefined?null:{docs:this.docs.subarray(this.start[t],this.start[t+1]),weights:this.weights.subarray(this.start[t],this.start[t+1])};}
  search(query,{limit=12,weights,minScore=1}={}){const terms=[...new Set(noteTokens(query))].slice(0,80);this.scores.fill(0);this.matched.fill(0);
    for(const term of terms){const t=this.terms.get(term);if(t===undefined)continue;for(let i=this.start[t],end=this.start[t+1];i<end;i++){this.scores[this.docs[i]]+=this.weights[i];this.matched[this.docs[i]]++;}}
    const best=[];for(let id=0;id<this.ids.length;id++){const score=this.scores[id]*(weights?.[id]??1);if(score<minScore||this.matched[id]<Math.min(2,terms.length))continue;let at=best.findIndex(h=>h.score<score);if(at<0)at=best.length;if(at>=limit)continue;best.splice(at,0,{id,score});if(best.length>limit)best.pop();}
    return best.map(h=>({id:this.ids[h.id],score:Math.min(.99,h.score/(h.score+4)),keyword:this.matched[h.id]/Math.max(1,terms.length),semantic:0}));
  }
}
