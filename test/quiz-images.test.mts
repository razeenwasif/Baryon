import {test} from 'node:test';import assert from 'node:assert/strict';
import {blankMarginBounds,deduplicateViews} from '../desktop/quiz-images.mjs';

test('Retina crops exclude scaled browser chrome and recognize OCR Question I',async()=>{
 const {questionPixels}=await import('../desktop/quiz-images.mjs');
 const width=800,height=2000,bitmap=Buffer.alloc(width*height*4,255);
 const options={browser:true,pixelScale:2};
 const base=questionPixels(bitmap,width,height,options)!;
 assert.equal(base.rect.y,180);
 const chrome=Buffer.from(bitmap);chrome[(100*width+300)*4]=0;
 assert.equal(questionPixels(chrome,width,height,options)!.key,base.key);
 const heading=questionPixels(bitmap,width,height,{...options,lines:[{text:'Question I',y:.2}]})!;
 assert.equal(heading.rect.y,392);
 assert.equal(heading.key,questionPixels(bitmap,width,height,{...options,lines:[{text:'Question 1',y:.2}]})!.key);
});

test('targeted split headings retain the top of the question instead of trimming browser chrome',async()=>{
 const {questionPixels}=await import('../desktop/quiz-images.mjs');
 const width=200,height=300,bitmap=Buffer.alloc(width*height*4,255);
 const options={browser:true,targeted:true,lines:[{text:'Question',y:.2},{text:'3',y:.23}],top:60,screenHeight:300};
 const content=questionPixels(bitmap,width,height,options)!;
 assert.equal(content.rect.y,0);
 const changed=Buffer.from(bitmap);changed[(10*width+50)*4]=0;
 assert.notEqual(questionPixels(changed,width,height,options)!.key,content.key,'the first lines remain part of the answer evidence');
 assert(questionPixels(bitmap,width,height,{...options,targeted:false})!.rect.y>0);
});
test('duplicate images are removed without losing current viewport mapping or order',()=>{
 const a={url:'a'},b={url:'b'};const result=deduplicateViews([a,b,a,b],3);assert.deepEqual(result.snapshots,[a,b]);assert.equal(result.currentFrame,1);
});
test('only exact light margins are removed, preserving tiny mathematical marks',()=>{
 const pixels=Buffer.alloc(100*100*4,255);const put=(x:number,y:number,v:number)=>{for(let c=0;c<3;c++)pixels[(y*100+x)*4+c]=v};
 put(50,50,0);put(10,20,254);const box=blankMarginBounds(pixels,100,100,{padding:2});
 assert.deepEqual(box,{x:8,y:18,width:45,height:35});assert.equal(blankMarginBounds(Buffer.alloc(100*100*4,255),100,100),null);
 assert.equal(blankMarginBounds(Buffer.alloc(100*100*4,0),100,100),null);assert.equal(blankMarginBounds(pixels,99,100),null);
});

test('question pixel identity ignores a blinking answer editor but detects a diagram edit',async()=>{
 const {questionPixels}=await import('../desktop/quiz-images.mjs');const w=200,h=300,base=Buffer.alloc(w*h*4,255),options={lines:[{text:'Question 1',y:.2},{text:'Your answer',y:.6}],browser:true};
 const key=questionPixels(base,w,h,options)!.key,typing=Buffer.from(base);typing[(250*w+60)*4]=0;
 assert.equal(questionPixels(typing,w,h,options)!.key,key);
 const graph=Buffer.from(base);graph[(100*w+60)*4]=0;assert.notEqual(questionPixels(graph,w,h,options)!.key,key);
 const toolbar=Buffer.from(base);toolbar[(10*w+60)*4]=0;assert.equal(questionPixels(toolbar,w,h,options)!.key,key);
});

test('capped capture scales keep crop coordinates and bitmap offsets integral',async()=>{
 const {questionPixels}=await import('../desktop/quiz-images.mjs');
 const width=800,height=1000,bitmap=Buffer.alloc(width*height*4,255);
 for(const lines of [[],[{text:'Question 2',y:.2},{text:'Your answer',y:.8}]]){
  const {rect,key}=questionPixels(bitmap,width,height,{browser:true,pixelScale:.8,lines})!;
  assert(Object.values(rect).every(Number.isInteger));assert.equal(key.length,64);
  assert(rect.width>0&&rect.height>0&&rect.x>=0&&rect.y>=0);
 }
});
