import {referenceLabels} from './quiz-labels.mjs';
import {createHash} from 'node:crypto';
// Exact deduplication preserves image quality and remaps the active viewport.
export function deduplicateViews(snapshots,currentFrame=0){
 const seen=new Map(),unique=[];let active=0;
 snapshots.forEach((snapshot,i)=>{let index=seen.get(snapshot.url);if(index===undefined){index=unique.length;seen.set(snapshot.url,index);unique.push(snapshot)}if(i===currentFrame)active=index});
 return {snapshots:unique,currentFrame:active};
}
// Efficiency audit, fix 8: each check can read a rectangle inside a larger bitmap (stride: that bitmap's width in pixels;
// offsetX/offsetY: the rectangle's corner in it), so the main process needn't crop and copy the picture to check part of it.
// Without a stride, the bitmap must be exactly width×height, as before.
const fits=(bitmap,width,height,stride,offsetX,offsetY)=>stride===undefined?bitmap.length===width*height*4
 :Number.isInteger(stride)&&offsetX>=0&&offsetY>=0&&stride>=offsetX+width&&bitmap.length>=((offsetY+height-1)*stride+offsetX+width)*4;
const place=(width,stride,offsetX,offsetY)=>{const s=stride??width;return (x,y)=>((offsetY+y)*s+offsetX+x)*4;};
// Trim only completely uniform, light-coloured margins. Never rescale, threshold
// text, or guess a diagram's extent. BGRA bytes are Electron's native bitmap.
export function blankMarginBounds(bitmap,width,height,{padding=12,stride,offsetX=0,offsetY=0}={}){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||!fits(bitmap,width,height,stride,offsetX,offsetY))return null;
 const at=place(width,stride,offsetX,offsetY),first=at(0,0),bg=bitmap.subarray(first,first+4);if(bg[3]!==255||Math.min(bg[0],bg[1],bg[2])<240)return null;
 const blank=(x,y)=>{const i=at(x,y);return bitmap[i]===bg[0]&&bitmap[i+1]===bg[1]&&bitmap[i+2]===bg[2]&&bitmap[i+3]===bg[3]};
 const row=y=>{for(let x=0;x<width;x++)if(!blank(x,y))return false;return true};
 let top=0,bottom=height-1;while(top<height&&row(top))top++;if(top===height)return null;while(bottom>top&&row(bottom))bottom--;
 const column=x=>{for(let y=top;y<=bottom;y++)if(!blank(x,y))return false;return true};
 let left=0,right=width-1;while(left<right&&column(left))left++;while(right>left&&column(right))right--;
 const x=Math.max(0,left-padding),y=Math.max(0,top-padding),w=Math.min(width,right+padding+1)-x,h=Math.min(height,bottom+padding+1)-y;
 return w*h<width*height*.95?{x,y,width:w,height:h}:null;
}

// Exact row fingerprints support scroll alignment without retaining a second bitmap.
// Uniform rows supply no evidence. Browser edges/scrollbars are excluded, but the
// entire interior of each matching row (including formulas/figures) is compared.
export function scrollEvidence(bitmap,width,height,{top=0,screenHeight=height,ignore=[],stride,offsetX=0,offsetY=0}={}) {
 if(width<80 || height<1 || !fits(bitmap,width,height,stride,offsetX,offsetY))return null;
 const rows=[],at=place(width,stride,offsetX,offsetY);
 for(let y=0;y<height;y++){
  const row=bitmap.subarray(at(32,y),at(width-32,y));let uniform=true;
  for(let i=4;i<row.length;i++)if(row[i]!==row[i%4]){uniform=false;break;}
  rows.push(uniform?'':createHash('sha256').update(row).digest('hex').slice(0,32));
 }
 return {rows,width,top,screenHeight,ignored:rows.map((_,y)=>ignore.some(r=>y>=r.from&&y<r.to))};
}
export function confirmsScroll(upper,lower,anchors) {
 const a=upper.scrollEvidence,b=lower.scrollEvidence;
 if(!a||!b||a.width!==b.width||a.screenHeight!==b.screenHeight||anchors.length<2)return false;
 const offsets=anchors.map(([x,y])=>(x.y-y.y)*a.screenHeight);
 if(offsets.some(x=>!Number.isFinite(x)||x<12)||Math.max(...offsets)-Math.min(...offsets)>4)return false;
 const delta=Math.round(offsets.reduce((x,y)=>x+y,0)/offsets.length);
 const start=Math.max(0,Math.floor(anchors[0][1].y*b.screenHeight-b.top));
 const end=Math.min(b.rows.length-1,Math.ceil(anchors.at(-1)[1].y*b.screenHeight-b.top+12));
 for(let adjust=-2;adjust<=2;adjust++){
  let matched=0,bad=false;
  for(let y=start;y<=end;y++){
   const other=y+delta+b.top-a.top+adjust;
   if(other<0||other>=a.rows.length){bad=true;break;}
   if(a.ignored?.[other]||b.ignored?.[y])continue;
   if(a.rows[other]!==b.rows[y]){bad=true;break;}
   if(b.rows[y])matched++;
  }
  if(!bad&&matched>=8)return true;
 }
 return false;
}

export function pixelScrollOverlap(upper,lower) {
 const a=upper.scrollEvidence,b=lower.scrollEvidence;
 if(!a||!b||a.width!==b.width||a.screenHeight!==b.screenHeight)return false;
 const index=new Map();a.rows.forEach((row,y)=>{if(row&&!a.ignored?.[y]){const values=index.get(row)||[];if(values.length<4)values.push(y);index.set(row,values)}});
 const votes=new Map();b.rows.forEach((row,y)=>{const positions=index.get(row);if(b.ignored?.[y]||!positions||positions.length>3)return;for(const x of positions){const shift=x-y;if(shift>=25&&shift<a.rows.length*.9)votes.set(shift,(votes.get(shift)||0)+1)}});
 for(const [shift,vote] of [...votes].sort((x,y)=>y[1]-x[1]).slice(0,3)){
  if(vote<40)continue;let start=0,unique=new Set();
  for(let y=0;y<Math.min(b.rows.length,a.rows.length-shift);y++){
   if(a.ignored?.[y+shift]||b.ignored?.[y])continue;
   if(a.rows[y+shift]!==b.rows[y]){start=y+1;unique.clear();continue;}
   if(b.rows[y])unique.add(b.rows[y]);
   if(y-start>=Math.max(120,Math.floor(a.screenHeight*.1)) && unique.size>=40 && start<b.rows.length*.25 && y+shift>a.rows.length*.75)return true;
  }
 }
 return false;
}

// Shared geometry for both JS pixel checks and the native OCR/crop helper (efficiency audit, fix 8B).
export function questionContentRect(width, height, { top = 0, screenHeight = height, lines = [], browser = false, targeted = false, pixelScale = 1 } = {}) {
 const heading = lines.find(l => /^\s*(?:question|problem|exercise|q\.?)\s*[:#]?\s*\d+[a-z]?\b/i.test(referenceLabels(l.text)));
 const editor = lines.find(l => /^your answer$/i.test(l.text.trim()));
 // A manually targeted crop already starts at its heading, even when OCR split
 // the label and number. Do not trim it as though it still contained browser chrome.
 const y = Math.floor(Math.max(0, heading ? Math.floor(heading.y * screenHeight - top) - 4 * pixelScale : browser && !targeted ? Math.min(90 * pixelScale, height * .15) : 0));
 const bottom = Math.floor(Math.min(height, editor ? Math.floor(editor.y * screenHeight - top) - 4 * pixelScale : height));
 const edge = browser ? Math.floor(Math.min(16 * pixelScale, Math.floor(width * .02))) : 0;
 const rect = { x: edge, y, width: width - 2 * edge, height: bottom - y };
 return rect.width <= 0 || rect.height < 20 ? null : rect;
}
export function excludeBlanks(exclude = [], width, height, { left = 0, top = 0, screenWidth = width, screenHeight = height } = {}) {
 return exclude.map(m => ({
  x0: Math.max(0, Math.floor(m.x * screenWidth - left)),
  x1: Math.min(width, Math.ceil((m.x + m.width) * screenWidth - left)),
  y0: Math.max(0, Math.floor(m.y * screenHeight - top)),
  y1: Math.min(height, Math.ceil((m.y + m.height) * screenHeight - top)),
 })).filter(b => b.x1 > b.x0);
}

// Question-only pixels exclude browser chrome and the user's answer editor. The
// original full-window key remains dedicated to deciding whether OCR is needed.
export function questionPixels(bitmap,width,height,{left=0,top=0,screenWidth=width,screenHeight=height,lines=[],exclude=[],browser=false,targeted=false,pixelScale=1,stride,offsetX=0,offsetY=0}={}) {
 const rect=questionContentRect(width,height,{top,screenHeight,lines,browser,targeted,pixelScale});
 if(!rect||!fits(bitmap,width,height,stride,offsetX,offsetY))return null;
 const {x:edge,y,height:rectH}=rect,bottom=y+rectH;
 // Excluded areas (Fairy's own window) count as black. Only the rows they cross are copied, one row at a time, so the
 // key is the same as blanking a copy of the whole picture would give, without that copy (efficiency audit, fix 8).
 const at=place(width,stride,offsetX,offsetY),blanks=excludeBlanks(exclude,width,height,{left,top,screenWidth,screenHeight});
 const digest=createHash('sha256');digest.update(JSON.stringify(rect));
 for(let row=y;row<bottom;row++){
  const pixels=bitmap.subarray(at(edge,row),at(width-edge,row)),crossing=blanks.filter(b=>row>=b.y0&&row<b.y1);
  if(!crossing.length){digest.update(pixels);continue;}
  const line=Buffer.from(pixels);
  for(const b of crossing){const from=Math.max(b.x0,edge)-edge,to=Math.min(b.x1,width-edge)-edge;if(to>from)line.fill(0,from*4,to*4);}
  digest.update(line);
 }
 return {rect,key:digest.digest('hex')};
}

// Efficiency audit, fix 8: the quiz's three checks on one decoded picture. region is the question's area in the picture's
// pixels; the bitmap is either the whole picture (at = region's corner, stride = the picture's width) or that area alone
// (at = 0,0, stride = its width). The checks read it in place, and crop is the one rectangle of the picture to cut out for
// the question: the same pixels the old crop of a crop of a crop gave, so the same PNG and the same keys.
export function questionChecks(bitmap,stride,at,region,{screenWidth,screenHeight,lines=[],exclude=[],browser=false,targeted=false,pixelScale=1,scrollIgnore=[]}={}){
 const view={stride,offsetX:at.x,offsetY:at.y};
 const scroll=scrollEvidence(bitmap,region.width,region.height,{top:region.y,screenHeight,ignore:scrollIgnore,...view});
 const content=questionPixels(bitmap,region.width,region.height,{left:region.x,top:region.y,screenWidth,screenHeight,lines,exclude,browser,targeted,pixelScale,...view});
 return {scroll,content};
}
// Then the margins: done apart from the checks so the main process can let input through between them.
export function questionTrim(bitmap,stride,at,region,content){
 const inner=content?.rect||{x:0,y:0,width:region.width,height:region.height};
 const margins=blankMarginBounds(bitmap,inner.width,inner.height,{stride,offsetX:at.x+inner.x,offsetY:at.y+inner.y});
 const trim=margins||{x:0,y:0,width:inner.width,height:inner.height};
 return {x:region.x+inner.x+trim.x,y:region.y+inner.y+trim.y,width:trim.width,height:trim.height};
}
export function questionCrop(bitmap,stride,at,region,options={}){
 const checked=questionChecks(bitmap,stride,at,region,options);
 return {...checked,crop:questionTrim(bitmap,stride,at,region,checked.content)};
}
// Exact source pixels are stronger evidence than a fresh OCR transcription.
// Fall back to text plus image bytes when a caller lacks visual fingerprints.
export function questionEvidenceKey(entry) {
 const snapshots=entry.snapshots||[],keys=snapshots.map(s=>s.visualKey);
 const evidence=keys.length&&keys.every(Boolean)?['pixels',keys]:['text',String(entry.text||'').normalize('NFKC').replace(/\s+/g,' ').trim(),snapshots.map(s=>s.url)];
 return createHash('sha256').update(JSON.stringify(evidence)).digest('hex');
}
