// Tolerate small OCR damage only in the reference label, never in mathematical
// values or question numbers. Original OCR and screenshot evidence stay unchanged.
export function referenceLabels(text){
 return text.replace(/\b(ques[a-z0-9()|]{2,8})(?=\s*[:#]?\s*\d)/gi,word=>{
  const target='question',source=word.toLowerCase();let row=Array.from({length:9},(_,i)=>i);
  for(let i=0;i<source.length;i++){const next=[i+1];for(let j=0;j<8;j++)next.push(Math.min(next[j]+1,row[j+1]+1,row[j]+Number(source[i]!==target[j])));row=next;}
  return row[8]<=2?'question':word;
 }).replace(/^(\s*(?:question|problem|exercise|q\.?)\s*[:#]?\s+)[Il|](?=\s*[.):]?\s*$)/gim,(_,prefix)=>prefix+'1');
}
