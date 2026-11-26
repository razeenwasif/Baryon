// Citations in work-session answers ("Improving existing features", item 7): the same links notes and books are cited
// with, so a claim about a file opens in the Sources panel at its lines. The model cites a file it relies on as a plain
// Markdown link to its project path, [parse.js line 42](src/parse.js#L42); after the turn Fairy turns each one that
// names a real file in the project into a lyra-file link under the work folder's own root id. Web pages stay as their
// addresses. Nothing is added to what the model reads each step.
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { isAbsolute, join, normalize, relative, sep } from 'node:path';
import { canRead, excludedPath, sourceLink } from './local-files.mjs';

export const CITE_RULE = '- When your answer rests on a file, cite it as a Markdown link to its project path and line, like [parse.js line 42](src/parse.js#L42) or [the README](README.md); cite a web page by its address. Fairy turns these into links that open beside the chat.';

// A work folder's root id: stable, so a link in an old answer still opens, and shaped like Fairy's other roots.
export function workRootId(folder) {
  const hex = createHash('sha256').update(`work:${folder}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const TARGET = /^(?!(?:[a-z][a-z0-9+.-]*:|#|\/\/))([^\s#?]+?)(?:#L(\d{1,7})(?:-L?\d{1,7})?|:(\d{1,7})(?:-\d{1,7})?)?$/i;
const isFile = async path => { try { return (await stat(path)).isFile(); } catch { return false; } };

// The answer with each plain path link to a real, readable project file made into a citation. Anything else is left.
export async function linkCitations(text, { root, rootId = workRootId(root), exists = isFile } = {}) {
  if (typeof text !== 'string' || !text.includes('](')) return text;
  const links = [...text.matchAll(/\[([^\]\n]{1,300})\]\(([^)\s]{1,600})\)/g)], replaced = new Map();
  for (const [all, label, target] of links) {
    if (replaced.has(all)) continue;
    const match = TARGET.exec(target);
    if (!match) continue;
    const rel = normalize(decodeURIComponent(match[1]).replace(/^\.\//, ''));
    if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`) || excludedPath(rel) || !canRead(rel)) continue;
    const full = join(root, rel);
    if (relative(root, full).startsWith('..') || !await exists(full)) continue;
    const line = Number(match[2] || match[3] || 1);
    replaced.set(all, `[${label}](${sourceLink(rootId, rel.split(sep).join('/'), line)})`);
  }
  return replaced.size ? text.replace(/\[([^\]\n]{1,300})\]\(([^)\s]{1,600})\)/g, all => replaced.get(all) ?? all) : text;
}
