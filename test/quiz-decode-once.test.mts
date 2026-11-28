// Efficiency audit, fix 8: the quiz checks one bitmap in place and crops once, and gets exactly what the old way got.
// The old functions below are copied from before the change, so the comparison doesn't depend on the new code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { referenceLabels } from '../desktop/quiz-labels.mjs';
import { excludeBlanks, questionChecks, questionContentRect, questionCrop } from '../desktop/quiz-images.mjs';
import { QuizOCRWorker } from '../desktop/quiz-recognition.mjs';
import { quizObserver } from '../desktop/quiz-setup.mjs';
import { QuizTarget } from '../desktop/quiz-target.mjs';

function old_blankMarginBounds(bitmap: Buffer, width: number, height: number, { padding = 12 }: { padding?: number } = {}) {
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||bitmap.length!==width*height*4)return null;
 const bg=bitmap.subarray(0,4);if(bg[3]!==255||Math.min(bg[0],bg[1],bg[2])<240)return null;
 const blank=(x:number,y:number)=>{const i=(y*width+x)*4;return bitmap[i]===bg[0]&&bitmap[i+1]===bg[1]&&bitmap[i+2]===bg[2]&&bitmap[i+3]===bg[3]};
 const row=(y:number)=>{for(let x=0;x<width;x++)if(!blank(x,y))return false;return true};
 let top=0,bottom=height-1;while(top<height&&row(top))top++;if(top===height)return null;while(bottom>top&&row(bottom))bottom--;
 const column=(x:number)=>{for(let y=top;y<=bottom;y++)if(!blank(x,y))return false;return true};
 let left=0,right=width-1;while(left<right&&column(left))left++;while(right>left&&column(right))right--;
 const x=Math.max(0,left-padding),y=Math.max(0,top-padding),w=Math.min(width,right+padding+1)-x,h=Math.min(height,bottom+padding+1)-y;
 return w*h<width*height*.95?{x,y,width:w,height:h}:null;
}
function old_scrollEvidence(bitmap: Buffer, width: number, height: number, { top = 0, screenHeight = height, ignore = [] }: { top?: number; screenHeight?: number; ignore?: Array<{ from: number; to: number }> } = {}) {
 if(width<80 || height<1 || bitmap.length!==width*height*4)return null;
 const rows:string[]=[];
 for(let y=0;y<height;y++){
  const row=bitmap.subarray((y*width+32)*4,((y+1)*width-32)*4);let uniform=true;
  for(let i=4;i<row.length;i++)if(row[i]!==row[i%4]){uniform=false;break;}
  rows.push(uniform?'':createHash('sha256').update(row).digest('hex').slice(0,32));
 }
 return {rows,width,top,screenHeight,ignored:rows.map((_,y)=>ignore.some(r=>y>=r.from&&y<r.to))};
}
function old_questionPixels(bitmap: Buffer, width: number, height: number, { left = 0, top = 0, screenWidth = width, screenHeight = height, lines = [], exclude = [], browser = false, targeted = false, pixelScale = 1 }: { left?: number; top?: number; screenWidth?: number; screenHeight?: number; lines?: any[]; exclude?: any[]; browser?: boolean; targeted?: boolean; pixelScale?: number } = {}) {
 const heading=lines.find(l=>/^\s*(?:question|problem|exercise|q\.?)\s*[:#]?\s*\d+[a-z]?\b/i.test(referenceLabels(l.text)));
 const editor=lines.find(l=>/^your answer$/i.test(l.text.trim()));
 // A manually targeted crop already starts at its heading, even when OCR split
 // the label and number. Do not trim it as though it still contained browser chrome.
 const y=Math.floor(Math.max(0,heading?Math.floor(heading.y*screenHeight-top)-4*pixelScale:browser&&!targeted?Math.min(90*pixelScale,height*.15):0));
 const bottom=Math.floor(Math.min(height,editor?Math.floor(editor.y*screenHeight-top)-4*pixelScale:height));
 const edge=browser?Math.floor(Math.min(16*pixelScale,Math.floor(width*.02))):0;
 const rect={x:edge,y,width:width-2*edge,height:bottom-y};
 if(rect.width<=0||rect.height<20||bitmap.length!==width*height*4)return null;
 const copy=Buffer.from(bitmap);
 for(const m of exclude){const x0=Math.max(0,Math.floor(m.x*screenWidth-left)),x1=Math.min(width,Math.ceil((m.x+m.width)*screenWidth-left)),y0=Math.max(0,Math.floor(m.y*screenHeight-top)),y1=Math.min(height,Math.ceil((m.y+m.height)*screenHeight-top));for(let row=y0;row<y1;row++)if(x1>x0)copy.fill(0,(row*width+x0)*4,(row*width+x1)*4);}
 const digest=createHash('sha256');digest.update(JSON.stringify(rect));
 for(let row=y;row<bottom;row++)digest.update(copy.subarray((row*width+edge)*4,((row+1)*width-edge)*4));
 return {rect,key:digest.digest('hex')};
}

// A rectangle of a BGRA bitmap as its own bitmap: what a nativeImage crop followed by toBitmap() gives.
function copyRect(bitmap: Buffer, stride: number, { x, y, width, height }: { x: number; y: number; width: number; height: number }) {
  const out = Buffer.alloc(width * height * 4);
  for (let row = 0; row < height; row++) bitmap.copy(out, row * width * 4, ((y + row) * stride + x) * 4, ((y + row) * stride + x + width) * 4);
  return out;
}
// The old crop step: crop the area, copy it, check it, crop the question, copy that, trim its margins.
function oldWay(screen: Buffer, W: number, H: number, region: { x: number; y: number; width: number; height: number }, options: any) {
  const area = copyRect(screen, W, region);
  const scroll = old_scrollEvidence(area, region.width, region.height, { top: region.y, screenHeight: H, ignore: options.scrollIgnore });
  const content = old_questionPixels(area, region.width, region.height, { left: region.x, top: region.y, screenWidth: W, screenHeight: H, lines: options.lines, exclude: options.exclude, browser: options.browser, targeted: options.targeted, pixelScale: options.pixelScale });
  const inner = content ? content.rect : { x: 0, y: 0, width: region.width, height: region.height };
  const question = content ? copyRect(area, region.width, inner) : area;
  const margins = old_blankMarginBounds(question, inner.width, inner.height);
  const final = margins ? copyRect(question, inner.width, margins) : question;
  const crop = margins ? { x: region.x + inner.x + margins.x, y: region.y + inner.y + margins.y, width: margins.width, height: margins.height } : { x: region.x + inner.x, y: region.y + inner.y, width: inner.width, height: inner.height };
  return { scroll, content, crop, bytes: final };
}
// A screen: light page, dark text blocks, a heading, an answer box with a caret, noise, and a dark frame around it.
function screen(W: number, H: number, seed: number) {
  let state = seed;
  const random = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
  const bitmap = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) bitmap.set([30, 30, 30, 255], i * 4);
  const page = { x: 20, y: 30, width: W - 60, height: H - 50 };
  for (let y = page.y; y < page.y + page.height; y++) for (let x = page.x; x < page.x + page.width; x++) bitmap.set([250, 250, 250, 255], (y * W + x) * 4);
  for (let block = 0; block < 25; block++) {
    const bx = page.x + 40 + Math.floor(random() * (page.width - 140)), by = page.y + 40 + Math.floor(random() * (page.height - 90));
    const bw = 10 + Math.floor(random() * 80), bh = 3 + Math.floor(random() * 12), shade = Math.floor(random() * 120);
    for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) bitmap.set([shade, shade + 10, shade + 20, 255], (y * W + x) * 4);
  }
  return bitmap;
}

test('one bitmap checked in place gives the same scroll rows, question key, crop and pixels as the old crops', () => {
  const W = 640, H = 420;
  const cases: Array<{ region: { x: number; y: number; width: number; height: number }; browser: boolean; targeted?: boolean; tooShort?: boolean }> = [
    { region: { x: 0, y: 0, width: W, height: H }, browser: false },
    { region: { x: 12, y: 18, width: 600, height: 380 }, browser: true },
    { region: { x: 100, y: 60, width: 300, height: 200 }, browser: false },
    { region: { x: 40, y: 40, width: 520, height: 350 }, browser: true, targeted: true },
    { region: { x: 200, y: 100, width: 200, height: 18 }, browser: false, tooShort: true },
  ];
  let checked = 0;
  for (const [n, c] of cases.entries()) for (const seed of [1, 7, 42]) for (const withExclude of [false, true]) for (const withLines of [false, true]) {
    const bitmap = screen(W, H, seed + n * 100);
    const lines = withLines ? [{ text: 'Question 3', y: (c.region.y + 50) / H, x: 0.1, width: 0.2, height: 0.02 }, { text: 'Your answer', y: (c.region.y + c.region.height - 40) / H }] : [];
    const exclude = withExclude ? [{ x: 0.55, y: 0.3, width: 0.2, height: 0.25 }] : [];
    const options = { screenWidth: W, screenHeight: H, lines, exclude, browser: c.browser, targeted: Boolean(c.targeted), pixelScale: 2,
      scrollIgnore: exclude.map(m => ({ from: Math.floor(m.y * H) - c.region.y, to: Math.ceil((m.y + m.height) * H) - c.region.y })) };
    const old = oldWay(bitmap, W, H, c.region, options);
    // The whole picture's pixels, read in place, and the area's own pixels: both give the old answer.
    const fromWhole = questionCrop(bitmap, W, { x: c.region.x, y: c.region.y }, c.region, options);
    const fromArea = questionCrop(copyRect(bitmap, W, c.region), c.region.width, { x: 0, y: 0 }, c.region, options);
    for (const now of [fromWhole, fromArea]) {
      assert.deepEqual(now.scroll, old.scroll, 'scroll rows');
      assert.deepEqual(now.content, old.content, 'question rectangle and key');
      assert.deepEqual(now.crop, old.crop, 'the crop');
      assert.ok(copyRect(bitmap, W, now.crop).equals(old.bytes), 'the same pixels, so the same PNG');
    }
    if (c.tooShort) assert.equal(old.content, null, 'too short to hold a question: no question pixels, the area as it is');
    checked++;
  }
  assert.equal(checked, 60);
});

test('the excluded window still counts as black in the key, and moving it changes the key', () => {
  const W = 400, H = 300, bitmap = screen(W, H, 5), region = { x: 0, y: 0, width: W, height: H };
  const base = { screenWidth: W, screenHeight: H, lines: [{ text: 'Question 1', y: 0.2 }], browser: false, pixelScale: 1 };
  const a = questionCrop(bitmap, W, { x: 0, y: 0 }, region, { ...base, exclude: [{ x: 0.5, y: 0.4, width: 0.2, height: 0.2 }] });
  const painted = Buffer.from(bitmap);
  for (let y = 120; y < 180; y++) painted.fill(77, (y * W + 200) * 4, (y * W + 280) * 4);
  const b = questionCrop(painted, W, { x: 0, y: 0 }, region, { ...base, exclude: [{ x: 0.5, y: 0.4, width: 0.2, height: 0.2 }] });
  assert.equal(b.content!.key, a.content!.key, 'whatever is under the excluded window doesn’t count');
  const moved = questionCrop(bitmap, W, { x: 0, y: 0 }, region, { ...base, exclude: [{ x: 0.1, y: 0.4, width: 0.2, height: 0.2 }] });
  assert.notEqual(moved.content!.key, a.content!.key);
});

test('the quiz decodes once, copies the pixels once and crops once', () => {
  // Built in quiz-setup.mjs since two Macs, step 8, so the full Fairy and a face crop alike.
  const main = readFileSync(new URL('../desktop/quiz-setup.mts', import.meta.url), 'utf8');
  const step = main.slice(main.indexOf('const breathe = async'), main.indexOf('return { ...observation, snapshot };'));
  assert.equal((step.match(/createFromDataURL\(/g) || []).length, 1);
  assert.equal((step.match(/toBitmap\(\)/g) || []).length, 2, 'one of the two, whichever the area needs');
  assert.match(step, /const bitmap = whole \? image\.toBitmap\(\) : image\.crop\(\{ x, y, width, height \}\)\.toBitmap\(\);/);
  assert.match(step, /const cropped = image\.crop\(questionTrim\(bitmap, stride, origin, region, content\)\);/);
  assert.doesNotMatch(step, /cropped\.toBitmap|cropped=cropped\.crop/, 'no crop of a crop, no second copy');
  const images = readFileSync(new URL('../desktop/quiz-images.mts', import.meta.url), 'utf8');
  assert.doesNotMatch(images, /const copy=Buffer\.from\(bitmap\)/, 'no whole copy to blank the excluded window');
});

function crc32(buf: Buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodeBgrazPng(bgra: Buffer, width: number, height: number) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const outRow = y * (1 + width * 4);
    raw[outRow] = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4, o = outRow + 1 + x * 4;
      raw[o] = bgra[i + 2]; raw[o + 1] = bgra[i + 1]; raw[o + 2] = bgra[i]; raw[o + 3] = bgra[i + 3];
    }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

test('Efficiency Fix 8B: native OCR helper runs scroll, question key and margin crop identically without JS bitmaps', { skip: process.platform !== 'darwin' }, async () => {
  const W = 400, H = 300;
  const bitmap = screen(W, H, 19);
  const png = encodeBgrazPng(bitmap, W, H);
  const region = { x: 16, y: 24, width: 360, height: 240 };
  const lines = [{ text: 'Question 2', y: (region.y + 40) / H, x: 0.1, width: 0.2, height: 0.02 }, { text: 'Your answer', y: (region.y + region.height - 30) / H }];
  const exclude = [{ x: 0.52, y: 0.28, width: 0.22, height: 0.24 }];
  const pixelScale = 1;
  const scrollIgnore = exclude.map(m => ({ from: Math.floor(m.y * H) - region.y, to: Math.ceil((m.y + m.height) * H) - region.y }));
  const js = questionCrop(bitmap, W, { x: region.x, y: region.y }, region, { screenWidth: W, screenHeight: H, lines, exclude, browser: true, targeted: false, pixelScale, scrollIgnore });
  const contentRect = questionContentRect(region.width, region.height, { top: region.y, screenHeight: H, lines, browser: true, targeted: false, pixelScale });
  const blanks = excludeBlanks(exclude, region.width, region.height, { left: region.x, top: region.y, screenWidth: W, screenHeight: H });

  const worker = new QuizOCRWorker({ idleMs: 5000 });
  try {
    const snapshot = { url: `data:image/png;base64,${png.toString('base64')}`, png, width: W, height: H, bounds: { x: 0, y: 0, width: W, height: H } };
    const ocr = await worker.request(snapshot, exclude, undefined, { fast: true });
    assert.ok(ocr.frameToken, 'helper returns a frameToken to avoid re-sending the image');
    // Drop snapshot PNG so only frameToken can satisfy the crop without miss!
    const tokenOnly = { url: 'data:image/png;base64,', width: W, height: H };
    const native = await worker.crop(tokenOnly, { frameToken: ocr.frameToken, region, contentRect, exclude: blanks, scrollIgnore, screenHeight: H });
    assert.deepEqual(native.crop, js.crop);
    assert.equal(native.width, js.crop.width);
    assert.equal(native.height, js.crop.height);
    assert.equal(native.visualKey, js.content!.key);
    assert.deepEqual(native.scrollEvidence, js.scroll);
    assert.match(native.url!, /^data:image\/png;base64,[A-Za-z0-9+/=]+$/);

    // Clear cache and verify miss falls back to raw PNG binary send seamlessly.
    await worker.clearCache();
    const recovered = await worker.crop(snapshot, { frameToken: ocr.frameToken, region, contentRect, exclude: blanks, scrollIgnore, screenHeight: H });
    assert.equal(recovered.visualKey, js.content!.key);
    assert.deepEqual(recovered.crop, js.crop);
  } finally {
    worker.stop();
  }
});

test('Efficiency Fix 8B: quizObserver uses native crop and skips main-process image decoding', async () => {
  let decodeCalls = 0;
  const cropCalls: any[] = [];
  const W = 200, H = 160;
  const target = new QuizTarget(); target.setAutomatic(true);
  const observe = quizObserver({
    picture: () => ({ cache: { fresh: async () => ({ url: 'data:image/png;base64,AAAA', width: W, height: H, bounds: { x: 0, y: 0, width: W, height: H } }), image: { at: 10 } }, shareMs: 0 }),
    pollMs: () => 500,
    quiz: () => ({ status: 'Waiting', state: () => ({ counts: {} }), buffer: { frames: [] } }) as any,
    target,
    pointer: () => ({ x: 50, y: 50 }),
    displayId: () => 1,
    exclude: () => [{ x: 0.7, y: 0.7, width: 0.2, height: 0.2 }],
    nativeImage: { createFromDataURL() { decodeCalls++; throw new Error('Main process must not decode when helper crops'); } },
    recognize: async () => ({ text: 'Question 1', lines: [{ text: 'Question 1', x: 0.1, y: 0.1, width: 0.3, height: 0.05 }], region: { x: 0, y: 0, width: 1, height: 1 }, frameToken: 'f1', visualKey: 'vk-full' }),
    crop: async (_snap: any, params: any) => {
      cropCalls.push(params);
      return { visualKey: 'vk-crop', scrollEvidence: { rows: [], width: W, top: 0, screenHeight: H, ignored: [] }, crop: { x: 0, y: 0, width: W, height: H }, width: W, height: H, url: 'data:image/png;base64,CROPPED' };
    },
  });
  const obs = await (observe as any)();
  assert.equal(decodeCalls, 0);
  assert.equal(cropCalls.length, 1);
  assert.equal(cropCalls[0].frameToken, 'f1');
  assert.equal(obs.visualKey, 'vk-crop');
  assert.equal(obs.snapshot!.url, 'data:image/png;base64,CROPPED');
  // Second call on same frame & region hits quizCrop cache without even calling crop again.
  await (observe as any)();
  assert.equal(cropCalls.length, 1);
  assert.equal(decodeCalls, 0);
});
