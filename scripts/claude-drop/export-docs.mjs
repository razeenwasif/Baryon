#!/usr/bin/env node
// Exports the claude.ai Docs on Fairy's drop-folder list (_typed.json) whose version is newer than the copy in the drop
// folder, each into <drop>/<link id>/typed/ (meta.json and files/tabs/N.html), where Claude sync finds it and carries
// it to the mini. Run on the MacBook by the Claude app's daily task: Claude Code here has your claude.ai connectors, the
// Mac mini's doesn't. Each Doc is one small Claude Code turn (doc-export.mjs). Installed beside doc-export.mjs in the drop
// folder's _tools by scripts/install-fairy.py.
import { access, constants, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DROP = join(homedir(), 'Library/Application Support/lyra-companion/face/claude-sync-drop');
const KEY = /^https:\/\/claude\.ai\/(?:code\/)?artifact\/([A-Za-z0-9-]{8,64})$/;

export async function refreshDocs({ dropDir = DROP, run, limit = 30, log = () => {} }) {
  let list = null;
  try { list = JSON.parse(await readFile(join(dropDir, '_typed.json'), 'utf8')); } catch { return { exported: [], failed: [], current: 0 }; }
  const out = { exported: [], failed: [], current: 0 };
  for (const [url, item] of Object.entries(list?.items || {})) {
    const key = KEY.exec(url)?.[1];
    if (item?.kind !== 'doc' || !key || typeof item.version !== 'string') continue;
    const folder = join(dropDir, key, 'typed');
    let meta = null;
    try { meta = JSON.parse(await readFile(join(folder, 'meta.json'), 'utf8')); } catch {}
    if (meta?.version === item.version) { out.current++; continue; }
    if (out.exported.length + out.failed.length >= limit) break;
    let doc;
    // The claude.ai connectors sometimes don't come up in time; one more go before giving up on this run.
    try { doc = await run(url).catch(error => (/no Claude Docs connector/.test(error.message) ? run(url) : Promise.reject(error))); }
    catch (error) {
      out.failed.push({ url, why: error.message }); log(`${item.title || url}: ${error.message}`);
      if (/no Claude Docs connector|isn’t signed in|not logged in/i.test(error.message)) break;
      continue;
    }
    const fresh = join(dropDir, key, 'typed.new');
    await rm(fresh, { recursive: true, force: true });
    await mkdir(join(fresh, 'files', 'tabs'), { recursive: true, mode: 0o700 });
    const tabs = [];
    for (const [i, tab] of doc.tabs.entries()) { const file = `tabs/${i + 1}.html`; await writeFile(join(fresh, 'files', file), tab.html, { mode: 0o600 }); tabs.push({ name: tab.name, file }); }
    await writeFile(join(fresh, 'meta.json'), JSON.stringify({ url, kind: 'doc', title: item.title || doc.title || '', version: item.version, tabs }), { mode: 0o600 });
    await rm(folder, { recursive: true, force: true });
    await rename(fresh, folder);
    out.exported.push(url); log(`${item.title || doc.title}: ${tabs.length} ${tabs.length === 1 ? 'tab' : 'tabs'}`);
  }
  return out;
}

async function claudeExecutable() {
  for (const path of [join(homedir(), '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude']) { try { await access(path, constants.X_OK); return path; } catch {} }
  throw new Error('Claude Code isn’t installed here.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Beside this script once installed in the drop folder's _tools; in the repo, Fairy's own.
  const { exportDoc } = await import('./doc-export.mjs').catch(() => import('../../desktop/doc-export.mjs'));
  const executable = await claudeExecutable();
  const done = await refreshDocs({ run: url => exportDoc({ executable, url, cwd: DROP }), log: line => console.log(line) });
  console.log(`Exported ${done.exported.length}, failed ${done.failed.length}, ${done.current} already current.`);
}
