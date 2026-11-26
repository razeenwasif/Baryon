import {speechText} from './speech.mjs';
import {hasMath,loadMathSpeech} from './math-speech.mjs';

// Find boundaries outside code, math and links, including unfinished constructs.
// Re-scan a bounded reply so token splits cannot change the parser state.
export function speechBoundary(raw, minimum = 40) {
  let fence = null, inline = '', link = 0;
  for (let i = 0; i < raw.length; i++) {
    const lineStart = i === 0 || raw[i - 1] === '\n';
    if (lineStart) {
      const marker = raw.slice(i).match(/^\s{0,3}(?:>\s*)?(`{3,}|~{3,})[^\n]*(?:\n|$)/);
      if (marker) {
        if (!fence) fence = marker[1];
        else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && /^\s*$/.test(marker[0].trim().slice(marker[1].length))) fence = null;
        i += marker[0].length - 1; continue;
      }
    }
    if (fence) continue;
    if (inline) {
      if (raw.slice(i,i+inline.length).toLowerCase() === inline.toLowerCase()) {i += inline.length - 1; inline = '';}
      continue;
    }
    const htmlBlock = raw.slice(i).match(/^<(pre|code|script|style)\b[^>]*>/i);
    if (htmlBlock) {inline = `</${htmlBlock[1]}>`; i += htmlBlock[0].length - 1; continue;}
    if (raw.startsWith('\\(', i) || raw.startsWith('\\[', i)) {inline = raw[i + 1] === '(' ? '\\)' : '\\]'; i++; continue;}
    if (raw[i] === '`') {inline = raw.slice(i).match(/^`+/)[0]; i += inline.length - 1; continue;}
    if (raw.startsWith('$$', i)) {inline = '$$'; i++; continue;}
    // A dollar amount can wait until the final chunk; an incomplete equation
    // must never be mistaken for prose while tokens are still arriving.
    if (raw[i] === '$' && raw[i-1] !== '\\' && !/\s/.test(raw[i+1] || ' ')) {inline = '$'; continue;}
    if (raw[i] === '[') link++;
    if (raw[i] === ']' && link) {
      link--;
      if (raw[i+1] === '(') {
        let depth=1; i+=2;
        for (;i<raw.length && depth;i++) {if(raw[i]==='\\'){i++;continue;} if(raw[i]==='(')depth++;if(raw[i]===')')depth--;}
        i--; continue;
      }
    }
    if (link || i < minimum) continue;
    if (raw[i] === '\n' && raw[i+1] === '\n') return {end:i+2,pauseMs:260};
    if (/[.!?]/.test(raw[i]) && /\s/.test(raw[i+1] || '')) {
      const prefix = raw.slice(0,i+1);
      if (/(?:\b(?:Dr|Mr|Mrs|Ms|Prof|vs|etc)|\b[A-Z]|e\.g|i\.e)\.$/i.test(prefix)) continue;
      if (/\S+$/.exec(prefix)?.[0].includes('://')) continue;
      return {end:i+1,pauseMs:/^\s*\n\s*\n/.test(raw.slice(i+1))?260:80};
    }
  }
  return null;
}

export class ReplyVoice {
  constructor({speak,emit,signal}) {
    Object.assign(this,{speak,emit});
    this.controller = new AbortController();
    this.signal = AbortSignal.any([signal ?? new AbortController().signal,this.controller.signal]);
    this.raw='';this.offset=0;this.sequence=0;this.chain=Promise.resolve();this.error='';this.final=false;this.running=false;this.previousPause=0;this.revision=0;
  }
  update(raw, final=false) {
    if (this.signal.aborted || this.error) return;
    if (!raw.startsWith(this.raw.slice(0,this.offset))) {this.error='Voice stopped because the answer was revised.';this.controller.abort();return;}
    this.raw=raw;this.final=final;this.revision++;
    if(this.running)return;
    if(!final&&!speechBoundary(raw.slice(this.offset),this.sequence?140:40))return;
    this.running=true;
    const revision=this.revision;
    this.chain=this.pump().catch(error=>{if(!this.signal.aborted)this.error=error.message;}).finally(()=>{this.running=false;if(this.revision!==revision&&!this.signal.aborted&&!this.error)this.update(this.raw,this.final);});
  }
  async pump(){
    while(this.offset<this.raw.length && !this.signal.aborted && !this.error){
      const tail=this.raw.slice(this.offset);
      let boundary=speechBoundary(tail,this.sequence?140:40);
      // Later clips use all available complete sentences, up to a modest phrase
      // length, so a fast model doesn't create lots of disconnected tiny clips.
      if(boundary && this.sequence){
        while(boundary.end<460 && boundary.pauseMs!==260){
          const next=speechBoundary(tail.slice(boundary.end),1);
          if(!next || boundary.end+next.end>460)break;
          boundary={end:boundary.end+next.end,pauseMs:next.pauseMs};
        }
      }
      if(!boundary && this.final)boundary={end:tail.length,pauseMs:0};
      if(!boundary)return;
      const source=tail.slice(0,boundary.end);
      const pauseBeforeMs=this.sequence ? (/^\s*\n\s*\n/.test(tail)||this.previousPause===260?300:160) : 0;
      this.offset+=boundary.end;this.previousPause=boundary.pauseMs;
      if(hasMath(source))await loadMathSpeech().catch(()=>{});
      const text=speechText(source);if(!text)continue;
      const sequence=this.sequence++;
      const bytes=await this.speak(source,this.signal);
      if(!this.signal.aborted && bytes)this.emit({sequence,bytes,text,pauseMs:boundary.pauseMs,pauseBeforeMs});
    }
  }
  async finish(text){
    this.update(text,true);await this.chain;
    // A final update can arrive as a previous pump releases its running flag.
    if(!this.signal.aborted&&!this.error&&this.offset<this.raw.length){this.update(text,true);await this.chain;}
    return this.error;
  }
  cancel(){this.controller.abort();}
}
