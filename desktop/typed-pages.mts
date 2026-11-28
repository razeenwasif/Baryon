// claude.ai's typed artifacts as pages Fairy can show. A Design is a canvas of artboards (project/*.dc.html, laid out by
// project/canvas.json), each run by the Design type's own runtime, which the artboards load as ./support.js; a Doc is
// one HTML fragment per tab, as the Docs connector exports it. Fairy makes the page that holds them: for a Design a
// canvas you pan and zoom, where clicking a board opens it full size and live; for a Doc the tabs one after another,
// set like a document. The files come from the Claude desktop app (which alone can download them), through the
// MacBook's drop folder and Claude sync (claude-sync.mjs).
export const TYPED_KINDS = ['design', 'doc'] as const;
export type TypedKind = (typeof TYPED_KINDS)[number];
// What doc-export.mjs says when Claude Code has no Claude Docs connector; here so the sync needn't load it.
export const NO_CONNECTOR = 'Claude Code here has no Claude Docs connector, so the Doc can’t be exported.';

export interface CanvasBoardInput {
  title?: string;
  x?: number | string;
  y?: number | string;
  w?: number | string;
  h?: number | string;
  radius?: number | string;
}

export interface CanvasNoteInput {
  text?: string;
  x?: number | string;
  y?: number | string;
  kind?: string;
}

export interface CanvasInput {
  boards?: Record<string, CanvasBoardInput | null | undefined>;
  order?: string[];
  notes?: Record<string, CanvasNoteInput | null | undefined>;
}

export interface CanvasBoard {
  file: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number;
}

export interface CanvasNote {
  text: string;
  x: number;
  y: number;
  big: boolean;
}

export interface DesignViewerOptions {
  title?: string;
  canvas?: CanvasInput | null;
  files?: string[];
}

export interface DocTabInput {
  name?: string;
  html?: string;
}

export interface DocPageOptions {
  title?: string;
  tabs?: Array<DocTabInput | null | undefined>;
}

const ESCAPE_MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, ch => ESCAPE_MAP[ch] ?? ch);
const number = (value: unknown, fallback = 0): number => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const BOARD_FILE = /^[A-Za-z0-9 ._()-]{1,120}\.dc\.html$/;

// The boards and notes of a canvas.json, checked: a board must be one of the design's own .dc.html files.
export function canvasLayout(canvas: CanvasInput | null | undefined, files: string[] = []): { boards: CanvasBoard[]; notes: CanvasNote[] } {
  const have = new Set(files), boards: CanvasBoard[] = [], notes: CanvasNote[] = [];
  const listed = canvas && typeof canvas.boards === 'object' && canvas.boards ? canvas.boards : {};
  const order = Array.isArray(canvas?.order) ? canvas.order.filter(name => listed[name]) : [];
  for (const name of [...new Set([...order, ...Object.keys(listed)])].slice(0, 200)) {
    const board = listed[name];
    if (!BOARD_FILE.test(name) || !have.has(`project/${name}`) || !board || typeof board !== 'object') continue;
    boards.push({ file: `project/${name}`, title: String(board.title || name.replace(/\.dc\.html$/, '')).slice(0, 200), x: number(board.x), y: number(board.y),
      w: Math.max(40, Math.min(8000, number(board.w, 800))), h: Math.max(40, Math.min(8000, number(board.h, 600))), radius: Math.max(0, Math.min(80, number(board.radius))) });
  }
  // A design with no canvas.json, or boards it doesn't place: one row of its artboards at 1280 × 800.
  let x = boards.reduce((right, board) => Math.max(right, board.x + board.w + 80), 0);
  for (const file of files.filter(path => /^project\/[^/]+\.dc\.html$/.test(path) && !boards.some(board => board.file === path)).slice(0, 200)) {
    boards.push({ file, title: file.slice(8, -8), x, y: 0, w: 1280, h: 800, radius: 0 }); x += 1360;
  }
  for (const note of Object.values(canvas?.notes && typeof canvas.notes === 'object' ? canvas.notes : {}).slice(0, 100)) {
    if (typeof note?.text === 'string' && note.text.trim()) notes.push({ text: note.text.slice(0, 500), x: number(note.x), y: number(note.y), big: /^title/.test(note.kind || '') });
  }
  return { boards, notes };
}

// The canvas page: boards at their places on a plane you drag and zoom (⌘ or pinch with the wheel, or the buttons), Fit
// to see them all, and a click on a board opens it on its own, full size and live, scaled to the window.
export function designViewer({ title = 'Design', canvas = null, files = [] }: DesignViewerOptions = {}): string {
  const { boards, notes } = canvasLayout(canvas, files);
  const placed = boards.map((board, i) => `<figure class="board" style="left:${board.x}px;top:${board.y}px;width:${board.w}px" data-i="${i}"><figcaption>${escape(board.title)}</figcaption><div class="frame" style="width:${board.w}px;height:${board.h}px;border-radius:${board.radius}px"><iframe src="${escape(board.file)}" width="${board.w}" height="${board.h}" loading="lazy" title="${escape(board.title)}"></iframe></div></figure>`).join('');
  const written = notes.map(note => `<div class="note${note.big ? ' big' : ''}" style="left:${note.x}px;top:${note.y}px">${escape(note.text)}</div>`).join('');
  const data = JSON.stringify(boards.map(({ file, title: name, w, h }) => ({ file, title: name, w, h }))).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title>
<style>
:root{--ground:#0d0d10;--ink:#ecebf0;--dim:#8d8b96;--line:#26252c;--chip:#18171c}
@media (prefers-color-scheme:light){:root{--ground:#f1f0ee;--ink:#1b1a1f;--dim:#6b6970;--line:#dddbd6;--chip:#fff}}
*{box-sizing:border-box}html,body{margin:0;height:100%;overflow:hidden;background:var(--ground);color:var(--ink);font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
#bar{position:fixed;top:10px;left:10px;right:10px;z-index:3;display:flex;gap:8px;align-items:center;pointer-events:none}
#bar>*{pointer-events:auto}#name{font-weight:600;padding:6px 10px;border-radius:9px;background:var(--chip);border:1px solid var(--line);max-width:50vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#bar .spacer{flex:1;pointer-events:none}button{font:inherit;color:inherit;background:var(--chip);border:1px solid var(--line);border-radius:9px;padding:6px 10px;cursor:pointer}button:hover{border-color:var(--dim)}
#zoom{min-width:52px;text-align:center;color:var(--dim)}
#stage{position:absolute;inset:0;cursor:grab;touch-action:none}#stage.dragging{cursor:grabbing}
#world{position:absolute;left:0;top:0;transform-origin:0 0}
.board{position:absolute;margin:0}.board figcaption{position:absolute;bottom:100%;left:0;padding:0 0 8px;font-size:15px;color:var(--dim);white-space:nowrap;cursor:pointer}
.board figcaption:hover{color:var(--ink)}.frame{overflow:hidden;background:#fff;box-shadow:0 1px 0 var(--line),0 12px 40px rgba(0,0,0,.25);cursor:zoom-in}
.frame iframe{display:block;border:0;pointer-events:none}
.note{position:absolute;color:var(--dim);font-size:22px;white-space:nowrap}.note.big{font-size:44px;font-weight:650;color:var(--ink)}
#open{position:fixed;inset:0;z-index:5;background:var(--ground);display:flex;flex-direction:column}#open[hidden]{display:none}
#open header{display:flex;gap:8px;align-items:center;padding:10px}#open header b{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#open .room{flex:1;position:relative;overflow:hidden}#open .room iframe{position:absolute;left:0;top:0;border:0;transform-origin:0 0;background:#fff}
#empty{position:absolute;inset:0;display:grid;place-items:center;color:var(--dim)}
</style></head><body>
<div id="bar"><span id="name">${escape(title)}</span><span class="spacer"></span><button id="out" aria-label="Zoom out">−</button><span id="zoom">100%</span><button id="in" aria-label="Zoom in">+</button><button id="fit">Fit</button></div>
<div id="stage">${boards.length ? `<div id="world">${written}${placed}</div>` : '<div id="empty">This design has no artboards.</div>'}</div>
<div id="open" hidden role="dialog" aria-label="Artboard"><header><b></b><button id="close">Close</button></header><div class="room"></div></div>
<script>
(function(){
var boards=${data},stage=document.getElementById('stage'),world=document.getElementById('world'),zoomLabel=document.getElementById('zoom');
var view={x:0,y:0,s:1};if(!world)return;
function apply(){world.style.transform='translate('+view.x+'px,'+view.y+'px) scale('+view.s+')';zoomLabel.textContent=Math.round(view.s*100)+'%';}
function bounds(){var r=world.getBoundingClientRect(),s=view.s,x0=1/0,y0=1/0,x1=-1/0,y1=-1/0;world.querySelectorAll('.board,.note').forEach(function(el){var b=el.getBoundingClientRect();x0=Math.min(x0,(b.left-r.left)/s);y0=Math.min(y0,(b.top-r.top)/s-30);x1=Math.max(x1,(b.right-r.left)/s);y1=Math.max(y1,(b.bottom-r.top)/s);});return{x0:x0,y0:y0,x1:x1,y1:y1};}
function fit(){view={x:0,y:0,s:1};apply();var b=bounds(),w=innerWidth-60,h=innerHeight-90,s=Math.min(2,w/(b.x1-b.x0),h/(b.y1-b.y0));view.s=s;view.x=30-b.x0*s+(w-(b.x1-b.x0)*s)/2;view.y=70-b.y0*s+(h-(b.y1-b.y0)*s)/2;apply();}
function zoomAt(px,py,f){var s=Math.max(0.03,Math.min(4,view.s*f));view.x=px-(px-view.x)*(s/view.s);view.y=py-(py-view.y)*(s/view.s);view.s=s;apply();}
stage.addEventListener('wheel',function(e){e.preventDefault();if(e.ctrlKey||e.metaKey)zoomAt(e.clientX,e.clientY,Math.exp(-e.deltaY*0.01));else{view.x-=e.deltaX;view.y-=e.deltaY;apply();}},{passive:false});
var drag=null,moved=0;
stage.addEventListener('pointerdown',function(e){drag={x:e.clientX,y:e.clientY,vx:view.x,vy:view.y};moved=0;stage.setPointerCapture(e.pointerId);stage.classList.add('dragging');});
stage.addEventListener('pointermove',function(e){if(!drag)return;moved=Math.max(moved,Math.abs(e.clientX-drag.x)+Math.abs(e.clientY-drag.y));view.x=drag.vx+e.clientX-drag.x;view.y=drag.vy+e.clientY-drag.y;apply();});
stage.addEventListener('pointerup',function(e){var was=drag;drag=null;stage.classList.remove('dragging');if(!was||moved>4)return;var hit=document.elementsFromPoint(e.clientX,e.clientY).find(function(el){return el.closest&&el.closest('.board');});if(hit)open(Number(hit.closest('.board').dataset.i));});
document.getElementById('in').onclick=function(){zoomAt(innerWidth/2,innerHeight/2,1.25);};
document.getElementById('out').onclick=function(){zoomAt(innerWidth/2,innerHeight/2,0.8);};
document.getElementById('fit').onclick=fit;
var sheet=document.getElementById('open'),room=sheet.querySelector('.room'),shown=null;
function place(){if(!shown)return;var b=boards[shown.i],r=room.getBoundingClientRect(),s=Math.min(1,(r.width-20)/b.w,(r.height-20)/b.h);shown.frame.style.transform='scale('+s+')';shown.frame.style.left=Math.max(10,(r.width-b.w*s)/2)+'px';shown.frame.style.top=Math.max(10,(r.height-b.h*s)/2)+'px';}
function open(i){var b=boards[i];if(!b)return;var f=document.createElement('iframe');f.src=b.file;f.width=b.w;f.height=b.h;f.title=b.title;room.replaceChildren(f);sheet.querySelector('b').textContent=b.title;shown={i:i,frame:f};sheet.hidden=false;place();}
function close(){sheet.hidden=true;room.replaceChildren();shown=null;}
document.getElementById('close').onclick=close;addEventListener('keydown',function(e){if(e.key==='Escape'&&shown)close();});
addEventListener('resize',place);
requestAnimationFrame(fit);
})();
</script></body></html>`;
}

// A Doc's tabs, set as one document: each tab's exported HTML under its name (the name only when there's more than one).
export function docPage({ title = 'Doc', tabs = [] }: DocPageOptions = {}): string {
  const parts = tabs.filter((tab): tab is DocTabInput & { html: string } => typeof tab?.html === 'string');
  const many = parts.length > 1;
  const nav = many ? `<nav>${parts.map((tab, i) => `<a href="#tab-${i + 1}">${escape(tab.name || `Tab ${i + 1}`)}</a>`).join('')}</nav>` : '';
  const body = parts.map((tab, i) => `<section id="tab-${i + 1}">${many ? `<p class="tab">${escape(tab.name || `Tab ${i + 1}`)}</p>` : ''}${tab.html}</section>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title>
<style>
:root{--paper:#fbfaf7;--ink:#1d1c20;--dim:#6c6a70;--line:#e3e0da;--code:#f0eee9;--link:#9a3c1e}
@media (prefers-color-scheme:dark){:root{--paper:#16151a;--ink:#e9e7ee;--dim:#9a98a1;--line:#2c2a31;--code:#201f25;--link:#f0a37f}}
*{box-sizing:border-box}html{background:var(--paper)}body{margin:0 auto;max-width:760px;padding:48px 28px 96px;color:var(--ink);font:17px/1.65 ui-serif,Georgia,"Iowan Old Style",serif}
h1,h2,h3,h4{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.25;margin:1.6em 0 .5em}h1{font-size:2em;margin-top:0}h2{font-size:1.35em}h3{font-size:1.1em}
a{color:var(--link)}code{font:.86em ui-monospace,"SF Mono",Menlo,monospace;background:var(--code);padding:.1em .35em;border-radius:5px}pre{background:var(--code);padding:14px 16px;border-radius:10px;overflow:auto}pre code{background:none;padding:0}
table{border-collapse:collapse;width:100%;margin:1.2em 0;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:block;overflow-x:auto}th,td{border-bottom:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}th{color:var(--dim);font-weight:600}
blockquote{margin:1em 0;padding-left:16px;border-left:3px solid var(--line);color:var(--dim)}img{max-width:100%;height:auto}hr{border:0;border-top:1px solid var(--line);margin:2em 0}
li>p{margin:.25em 0}figure[data-embed]{margin:1em 0;padding:12px 14px;border:1px dashed var(--line);border-radius:10px;color:var(--dim);font:14px -apple-system,sans-serif}figure[data-embed]::before{content:"A chart or embed, shown on claude.ai. "}
nav{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 28px;font:13px -apple-system,sans-serif}nav a{padding:4px 10px;border:1px solid var(--line);border-radius:99px;text-decoration:none;color:var(--dim)}
section+section{margin-top:56px;padding-top:40px;border-top:1px solid var(--line)}.tab{font:600 12px -apple-system,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--dim)}
</style></head><body>${nav}${body || '<p>This doc is empty.</p>'}</body></html>`;
}
