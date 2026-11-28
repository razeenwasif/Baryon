// Animations the notebook's tutor draws to explain an idea: a small self-contained piece of HTML (an SVG or a canvas and
// its script), written in its answer as a ````animation block. Each is kept here by its hash and played in the chat in a
// sandboxed frame served from fairy-artifact://anim/<hash>: scripts run, but the page has no network, no storage, no
// way to reach Fairy or the window, and can't navigate anywhere. Kept on disk so a chat reopened later still plays.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const MAX_ANIMATION = 300_000;
const ID = /^[0-9a-f]{32}$/;
export const animationId = (code: unknown): string => createHash('sha256').update(String(code)).digest('hex').slice(0, 32);

// What the frame may do: run its own inline script and style, draw data: and blob: images. Nothing else, nowhere else.
export const ANIMATION_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; form-action 'none'; base-uri 'none'";

export interface AnimationServeResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

// The page an animation plays in: a clear stage in dark mode, so the window's own background shows through it, in
// Fairy's type, its content centred and fitted.
export function animationPage(code: unknown): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${ANIMATION_CSP}">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><style>
:root{color-scheme:dark}
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;color:#e6e9f4;font:14px Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
body{display:flex;align-items:center;justify-content:center}
body>svg,body>canvas{display:block;max-width:100%;max-height:100%}
</style></head><body>
${String(code)}
</body></html>`;
}

export class AnimationStore {
  dir: string;
  made: boolean;

  constructor({ dir }: { dir: string }) {
    this.dir = dir;
    this.made = false;
  }

  // Keeps an animation; resolves its URL. The same animation is the same URL.
  async put(code: unknown): Promise<string> {
    const text = String(code ?? '');
    if (!text.trim()) throw new Error('The animation is empty.');
    if (text.length > MAX_ANIMATION) throw new Error('The animation is too large to play.');
    const id = animationId(text);
    if (!this.made) { await mkdir(this.dir, { recursive: true }); this.made = true; }
    await writeFile(join(this.dir, `${id}.html`), text, { mode: 0o600 });
    return `fairy-artifact://anim/${id}`;
  }

  // The response for fairy-artifact://anim/<id>.
  async serve(pathname: unknown): Promise<AnimationServeResponse> {
    const id = String(pathname || '').replace(/^\/+/, '');
    if (!ID.test(id)) return { status: 404, headers: { 'content-type': 'text/plain' }, body: 'Not found' };
    let code: string;
    try { code = await readFile(join(this.dir, `${id}.html`), 'utf8'); } catch { return { status: 404, headers: { 'content-type': 'text/plain' }, body: 'Not found' }; }
    return {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': ANIMATION_CSP,
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store',
      },
      body: animationPage(code),
    };
  }
}
