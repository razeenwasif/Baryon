import { readFileSync } from 'node:fs';
import MarkdownIt from 'markdown-it';

const markdown = new MarkdownIt({ html: false, linkify: true, typographer: false });
const escapeHTML = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Raw HTML stays off, so a document's text can't become markup or script.
export function docPage(source, title = 'Document') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHTML(title)}</title><style>
:root{color-scheme:light dark;--ink:#1c1d21;--soft:#4a4c55;--ground:#fff;--line:#d9dae0;--code:#f2f3f6;--link:#2f49c9}
@media (prefers-color-scheme:dark){:root{--ink:#e8e9ee;--soft:#b9bbc4;--ground:#17181b;--line:#32343b;--code:#23252b;--link:#9fb2ff}}
*{box-sizing:border-box}body{margin:0;background:var(--ground);color:var(--ink);font:16px/1.65 ui-serif,Georgia,'Times New Roman',serif}
main{max-width:72ch;margin:0 auto;padding:clamp(20px,6vw,56px) clamp(18px,5vw,40px)}
h1,h2,h3,h4{font-family:ui-sans-serif,system-ui,sans-serif;line-height:1.25;margin:1.6em 0 .5em}h1{font-size:1.9em;margin-top:0}h2{font-size:1.4em}h3{font-size:1.15em}
p,ul,ol,blockquote,pre,table{margin:0 0 1em}a{color:var(--link)}blockquote{margin-left:0;padding-left:1em;border-left:3px solid var(--line);color:var(--soft)}
code{padding:.1em .3em;border-radius:4px;background:var(--code);font:.88em ui-monospace,SFMono-Regular,Menlo,monospace}pre{padding:14px;overflow:auto;border-radius:8px;background:var(--code)}pre code{padding:0;background:none}
table{width:100%;border-collapse:collapse}th,td{padding:6px 10px;border:1px solid var(--line);text-align:left}hr{border:0;border-top:1px solid var(--line);margin:2em 0}img{max-width:100%}
@media print{body{background:#fff;color:#000}main{max-width:none;padding:0}pre,blockquote,table{break-inside:avoid}h1,h2,h3{break-after:avoid}}
@page{margin:22mm}
</style></head><body><main>${markdown.render(String(source))}</main></body></html>`;
}
// Fairy's frame around a model's slides: fitted to the window, stepped by keys or buttons, one per page in print.
export function deckPage(sections, styles = '', title = 'Slides') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHTML(title)}</title><style>
*{box-sizing:border-box}html,body{margin:0;height:100%;background:#0d0e11;overflow:hidden;font-family:ui-sans-serif,system-ui,sans-serif}
#stage{position:absolute;inset:0 0 44px 0;display:flex;align-items:center;justify-content:center;overflow:hidden}
#deck{position:relative;width:1280px;height:720px;flex:none;transform-origin:center}
#deck>section{position:absolute;inset:0;width:1280px;height:720px;overflow:hidden}
#deck>section:not(.on){visibility:hidden}
/* Only defaults: a deck's own colours, spacing and layout come first. */
:where(#deck>section){background:#fff;color:#111;padding:64px}
#bar{position:absolute;inset:auto 0 0 0;height:44px;display:flex;align-items:center;justify-content:center;gap:10px;color:#c9cbd3;font-size:13px}
#bar button{width:32px;height:30px;border:0;border-radius:8px;background:#ffffff1a;color:inherit;font-size:16px;cursor:pointer}#bar button:hover{background:#ffffff30}#bar button:disabled{opacity:.35;cursor:default}
@media print{html,body{height:auto;overflow:visible;background:#fff}#stage{position:static;display:block;overflow:visible}#deck{width:auto;height:auto;transform:none!important}#deck>section{position:relative;inset:auto;visibility:visible;break-after:page;page-break-after:always}#bar{display:none}}
@page{size:1280px 720px;margin:0}
</style>${styles}</head><body><div id="stage"><div id="deck">${sections.join('')}</div></div><div id="bar"><button id="prev" type="button" aria-label="Previous slide">‹</button><span id="count" aria-live="polite"></span><button id="next" type="button" aria-label="Next slide">›</button></div>
<script>(function(){var d=document.getElementById('deck'),s=[].slice.call(d.children),i=0,p=document.getElementById('prev'),n=document.getElementById('next'),c=document.getElementById('count'),g=document.getElementById('stage');
function fit(){var w=g.clientWidth,h=g.clientHeight;d.style.transform='scale('+Math.min(w/1280,h/720)+')';}
function show(k){i=Math.max(0,Math.min(s.length-1,k));s.forEach(function(e,x){e.classList.toggle('on',x===i);});c.textContent=(i+1)+' / '+s.length;p.disabled=i===0;n.disabled=i===s.length-1;}
p.onclick=function(){show(i-1);};n.onclick=function(){show(i+1);};addEventListener('resize',fit);addEventListener('keydown',function(e){if(['ArrowRight','ArrowDown','PageDown',' '].indexOf(e.key)>=0){e.preventDefault();show(i+1);}if(['ArrowLeft','ArrowUp','PageUp'].indexOf(e.key)>=0){e.preventDefault();show(i-1);}if(e.key==='Home')show(0);if(e.key==='End')show(s.length-1);});
fit();show(0);})();</script></body></html>`;
}
// Whiteboards and sheets are Fairy's own pages: its editor, with the data the model gave beside it. The model never writes
// their code, only the data, and the page shows it with text set as text, so nothing in the data can become markup or script.
const kindFiles = new Map();
const kindFile = name => { if (!kindFiles.has(name)) kindFiles.set(name, readFileSync(new URL(`./page-kinds/${name}`, import.meta.url), 'utf8')); return kindFiles.get(name); };
// The core modules are written to run in Node too; inside the page they're plain functions in one scope.
const inline = source => source.replace(/^export\s+(?=(?:async\s+)?function|const|let|class)/gm, '');
const safeJSON = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
function editorPage(kind, data, title, core) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHTML(title)}</title><style>${kindFile('kinds.css')}</style></head><body class="${kind}"><div id="app"></div><script type="application/json" id="fairy-data">${safeJSON(data)}</script>
<script>(function(){'use strict';
${inline(kindFile(core))}
${kindFile('page-bridge.js')}
${kindFile(`${kind}-editor.js`)}
})();</script></body></html>`;
}
export const whiteboardPage = (scene, title = 'Whiteboard') => editorPage('whiteboard', scene, title, 'whiteboard-core.mjs');
export const sheetPage = (book, title = 'Sheet') => editorPage('sheet', book, title, 'sheet-core.mjs');
export const a2uiPage = (surface, title = 'Interactive UI') => editorPage('a2ui', surface, title, 'a2ui-core.mjs');
// A board's SVG drawn in a window of its own, with no bridge to the app, and kept as a PNG at the screen's sharpness
// (twice the size on a Retina display), shrunk if it would be huge.
export async function pngFromSVG({ BrowserWindow, svg, width, height, signal }) {
  const scale = Math.max(0.1, Math.min(1, 4000 / Math.max(width, height, 1))), w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
  const window = new BrowserWindow({ show: false, useContentSize: true, width: w, height: h, enableLargerThanScreen: true, paintWhenInitiallyHidden: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true, javascript: false } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  try {
    const page = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden;background:transparent}svg{display:block;width:${w}px;height:${h}px}</style></head><body>${svg}</body></html>`;
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
    await new Promise(resolve => setTimeout(resolve, 400));
    signal?.throwIfAborted();
    return (await window.webContents.capturePage({ x: 0, y: 0, width: w, height: h })).toPNG();
  } finally { window.destroy(); }
}
// Renders a page to PDF in a window of its own, with no bridge to the app.
export async function pdfFromPage({ BrowserWindow, url, landscape = false, signal }) {
  const window = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  try {
    await window.loadURL(url);
    await new Promise(resolve => setTimeout(resolve, 600));
    signal?.throwIfAborted();
    return await window.webContents.printToPDF({ printBackground: true, landscape, preferCSSPageSize: true });
  } finally { window.destroy(); }
}
