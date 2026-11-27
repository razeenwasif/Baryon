// KaTeX's stylesheet for the iPhone app, its fonts inside it, so tutor answers the Mac draws (desktop/notebook/phone-html.mjs)
// show their maths on the phone with nothing fetched. Run again after updating katex: node scripts/ios-katex.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const dist = join(dirname(createRequire(import.meta.url).resolve('katex/package.json')), 'dist');
let css = await readFile(join(dist, 'katex.min.css'), 'utf8');
const fonts = new Map();
css = await (async () => {
  let out = '';
  let last = 0;
  for (const m of css.matchAll(/src:([^;}]+)/g)) {
    const woff2 = /url\((fonts\/[^)]+\.woff2)\)/.exec(m[1]);
    out += css.slice(last, m.index);
    if (woff2) {
      if (!fonts.has(woff2[1])) fonts.set(woff2[1], (await readFile(join(dist, woff2[1]))).toString('base64'));
      out += `src:url(data:font/woff2;base64,${fonts.get(woff2[1])}) format("woff2")`;
    } else out += m[0];
    last = m.index + m[0].length;
  }
  return out + css.slice(last);
})();
const { version } = JSON.parse(await readFile(join(dist, '..', 'package.json'), 'utf8'));
await writeFile(new URL('../ios/Fairy/katex-inline.css', import.meta.url), `/* KaTeX ${version}, MIT licence, with its fonts inlined (scripts/ios-katex.mjs). */\n${css}\n`);
console.log(`Wrote ios/Fairy/katex-inline.css with ${fonts.size} fonts.`);
