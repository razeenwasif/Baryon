// Flux's browser tools. When Flux asks Fairy something from its agent panel, the ask carries the path of a socket
// Flux listens on and a key that works for that one question only. These tools call Flux through it, and Flux runs
// each step through its own checks: it refuses banking, password and other sensitive sites, controls that order,
// pay or delete, and password, card and one-time-code fields; a step that sends, posts, buys or saves asks the user
// in Flux's panel first; private and Tor tabs are never shown. One line of JSON each way:
//   → {id, token, tool, args}   ← {id, result} or {id, error}
import net from 'node:net';
import { defineTool, type ToolDefinition, type ToolScope } from './tool-registry.mjs';

const LINE_LIMIT = 4 << 20;

export interface FluxConnection {
  setEncoding(encoding: BufferEncoding): unknown;
  on(event: 'connect' | 'close', listener: () => void): unknown;
  on(event: 'data', listener: (chunk: string) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  write(data: string): unknown;
  destroy(): unknown;
}

export interface FluxBrowserOptions {
  socket: string;
  token: string;
  timeout?: number;
  connect?: (path: string) => FluxConnection;
}

/** Flux, as one question's tools reach it. `socket` and `token` come from Flux's ask. */
export class FluxBrowser {
  socket: string;
  token: string;
  timeout: number;
  connect: (path: string) => FluxConnection;
  seq: number;

  constructor({ socket, token, timeout = 10 * 60 * 1000, connect = path => net.createConnection(path) }: FluxBrowserOptions) {
    if (typeof socket !== 'string' || !socket.startsWith('/') || !socket.endsWith('.sock') || socket.length > 200) throw new Error('Flux sent no usable tool socket.');
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(token)) throw new Error('Flux sent no usable tool key.');
    this.socket = socket;
    this.token = token;
    this.timeout = timeout;
    this.connect = connect;
    this.seq = 0;
  }

  /** Ask Flux to run `tool` with `args`; resolves with its result, or rejects with its refusal. A commit waits for
   * the user's answer in Flux, so the timeout is long. */
  call(tool: string, args: Record<string, unknown> = {}, signal?: AbortSignal | null): Promise<unknown> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const conn = this.connect(this.socket);
      let buffer = '', settled = false;
      const finish = (error: Error | null, value?: unknown): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener?.('abort', onAbort);
        conn.destroy();
        error ? reject(error) : resolve(value);
      };
      const onAbort = (): void => finish(Object.assign(new Error('Stopped.'), { name: 'AbortError' }));
      const timer = setTimeout(() => finish(new Error('Flux took too long to answer.')), this.timeout);
      signal?.addEventListener?.('abort', onAbort, { once: true });
      conn.setEncoding('utf8');
      conn.on('connect', () => conn.write(`${JSON.stringify({ id, token: this.token, tool, args })}\n`));
      conn.on('data', chunk => {
        buffer += chunk;
        if (buffer.length > LINE_LIMIT) return finish(new Error("Flux's answer was too long."));
        const at = buffer.indexOf('\n');
        if (at < 0) return;
        let message: { error?: unknown; result?: unknown } | null;
        try { message = JSON.parse(buffer.slice(0, at)) as { error?: unknown; result?: unknown } | null; } catch { return finish(new Error('Flux sent something that was not JSON.')); }
        if (message?.error) finish(new Error(String(message.error)));
        else finish(null, message?.result ?? null);
      });
      conn.on('error', error => finish(new Error(`Flux isn't reachable: ${error.message}`)));
      conn.on('close', () => finish(new Error('Flux closed the connection.')));
    });
  }
}

const tab = { type: 'integer', description: "A tab id from flux_tabs. Leave it out for the tab the user is looking at." };
const ref = { type: 'string', description: 'An element reference from the latest flux_read, like 3:e12.' };
const call = (tool: string) => (args: Record<string, unknown>, { browser, signal }: ToolScope): Promise<unknown> =>
  (browser as FluxBrowser).call(tool, args, signal);

export const FLUX_TOOLS: ToolDefinition[] = [
  defineTool({
    name: 'flux_tabs',
    description: "List the tabs open in the user's current Flux workspace: each tab's id, title and address, and which one they're looking at. Private and Tor tabs are never listed.",
    run: call('tabs'),
  }),
  defineTool({
    name: 'flux_read',
    description: "Read a tab's page as Flux sees it: an accessibility tree with each element's role, name and state and a reference (like 3:e12) to click or type into, or the page's text where there's no tree. Read again after anything changes the page: a reference from an older read is refused.",
    properties: { tab },
    run: call('read'),
  }),
  defineTool({
    name: 'flux_open',
    description: 'Open a web address (http or https) in a new tab, which the user then sees. Returns the new tab id; read it before acting on it.',
    properties: { url: { type: 'string', description: 'The full address, starting with https:// or http://.' } },
    required: ['url'],
    run: call('open'),
  }),
  defineTool({
    name: 'flux_click',
    risk: 'write',
    description: 'Click an element by its reference from the latest flux_read. Flux checks the step first. It refuses sensitive sites (banking, passwords, health, tax) and controls that order, pay or delete, and a click that sends, posts, buys, books or saves asks the user in Flux and runs only if they say yes. Returns what kind of step it was and whether the page showed it.',
    properties: { tab, ref, reason: { type: 'string', description: 'Why, in a few words, shown to the user.' } },
    required: ['ref', 'reason'],
    run: call('click'),
  }),
  defineTool({
    name: 'flux_type',
    risk: 'write',
    description: 'Type text into a field by its reference from the latest flux_read, replacing what is there. Flux refuses password, card-number and one-time-code fields. Returns whether the field shows the text.',
    properties: { tab, ref, text: { type: 'string', description: 'Exactly what to type.' } },
    required: ['ref', 'text'],
    run: call('type'),
  }),
  defineTool({
    name: 'flux_annotate',
    description: 'Outline and number specific passages or items on the current web page (1, 2, 3...) and show matching numbered cards in Flux. Set clear: true to remove marks.',
    properties: {
      tab,
      clear: { type: 'boolean', description: 'Set true to clear existing page callout marks.' },
      items: {
        type: 'array',
        description: 'Numbered items on the page to highlight and outline (up to 8).',
        minItems: 1,
        maxItems: 8,
        items: {
          type: 'object',
          properties: {
            n: { type: 'integer', minimum: 1, description: 'Badge number starting at 1.' },
            text: { type: 'string', description: 'Exact visible text snippet on the page to match.' },
            title: { type: 'string', description: 'Short heading for the numbered card in chat.' },
            detail: { type: 'string', description: 'Brief metadata line under the card title.' },
            selector: { type: 'string', description: 'Optional CSS selector if a container is clearer than text matching.' },
          },
          required: ['n', 'text'],
          additionalProperties: false,
        },
      },
    },
    run: call('annotate'),
  }),
  defineTool({
    name: 'flux_restyle',
    description: 'Preview safe, inert CSS changes on the current web page (no @import or external url()). Flux checks the CSS, previews it live, and offers the user Keep on this site or Undo. Set clear: true to undo.',
    properties: {
      tab,
      name: { type: 'string', description: 'Short label for this restyle (e.g. "Story cards").' },
      css: { type: 'string', description: 'CSS rules only; never use @import or external url().' },
      summary: { type: 'string', description: 'One concise sentence explaining what changed on the page.' },
      clear: { type: 'boolean', description: 'Set true to clear the current restyle preview.' },
    },
    run: call('restyle'),
  }),
];
