// The token ledger (token-use plan, step 1): where a work turn's tokens go, as sizes with no content.
//
// Each part is counted in characters, which Fairy can measure exactly whatever the provider. A turn takes several
// model steps, and every step sends again everything before it: the opening (instructions, tools, earlier turns and
// your message) once per step, and each tool result once for every step after it. `sent` estimates that total,
// assuming one tool call per step (calls made together in one step make it an overestimate). The provider's own
// counts, where it reports them, turn `sent` into a tokens-per-character rate. Claude Code and Codex add a prompt and
// tools of their own that Fairy can't see, so the rate includes those. agy reports nothing, so Gemini's lines carry
// sizes only.
import { appendFile, readFile, stat, writeFile } from 'node:fs/promises';
import { PARTS } from '../src/token-split.js';

export const LEDGER_KEEP = 2000;

export type LedgerPart = (typeof PARTS)[number];
export type LedgerParts = Record<LedgerPart, number>;

export interface ToolLedgerEntry {
  calls: number;
  chars: number;
  images: number;
}

export interface ReportedUsage {
  input: number;
  output: number;
  cached: number;
}

export interface TurnLedgerOptions {
  session?: string;
  provider?: string;
  model?: string;
  role?: string;
  at?: string;
}

export interface OpeningOptions {
  instructions?: string;
  guidance?: string;
  memory?: string;
  tools?: unknown[];
  earlier?: string;
  message?: string;
}

export interface ToolResultContentItem {
  type?: unknown;
  text?: unknown;
}

export interface ToolResultPayload {
  contentItems?: ToolResultContentItem[];
}

export interface TurnLedgerLine {
  at: string;
  session: string;
  provider: string;
  model: string;
  role?: string;
  parts: LedgerParts;
  tools: number;
  steps: number;
  sent: number;
  images: number;
  byTool: Record<string, ToolLedgerEntry>;
  reported?: ReportedUsage;
  rate?: number | null;
}

const length = (text: unknown): number => (typeof text === 'string' ? text.length : 0);

export class TurnLedger {
  session: string;
  provider: string;
  model: string;
  role: string;
  at: string;
  parts: LedgerParts;
  byTool: Record<string, ToolLedgerEntry>;
  calls: number[];
  toolCount: number;
  images: number;
  reported: ReportedUsage | null;

  constructor({ session = '', provider = '', model = '', role = '', at = new Date().toISOString() }: TurnLedgerOptions = {}) {
    this.session = session;
    this.provider = provider;
    this.model = model;
    this.role = role;
    this.at = at;
    this.parts = Object.fromEntries(PARTS.map(part => [part, 0])) as LedgerParts;
    this.byTool = {};
    this.calls = [];
    this.toolCount = 0;
    this.images = 0;
    this.reported = null;
  }

  // instructions: the whole string sent, guidance and memory rules included; they're counted apart from the rest.
  opening({ instructions = '', guidance = '', memory = '', tools = [], earlier = '', message = '' }: OpeningOptions = {}): void {
    const inside = (part: string): number => (part && instructions.includes(part) ? part.length : 0);
    this.parts.guidance = inside(guidance); this.parts.memory = inside(memory);
    this.parts.instructions = Math.max(0, length(instructions) - this.parts.guidance - this.parts.memory);
    this.parts.tools = tools.reduce((sum: number, tool) => sum + JSON.stringify(tool).length, 0); this.toolCount = tools.length;
    this.parts.earlier = length(earlier); this.parts.message = length(message);
  }

  // A tool's result: its text is counted, and its pictures by number (a picture's cost isn't its size in characters).
  result(name: string, result: ToolResultPayload | null | undefined): void {
    let chars = 0, images = 0;
    for (const item of Array.isArray(result?.contentItems) ? result.contentItems : []) {
      if (item?.type === 'inputText') chars += length(item.text); else if (item?.type === 'inputImage') images++;
    }
    const tool = this.byTool[name] ||= { calls: 0, chars: 0, images: 0 };
    tool.calls++; tool.chars += chars; tool.images += images;
    this.calls.push(chars); this.parts.results += chars; this.images += images;
  }

  reply(text: unknown): void { this.parts.reply = length(text); }

  // The provider's own counts. Codex reports a running total during the turn, so the last one wins.
  usage(counts: { input?: number; output?: number; cached?: number } | null | undefined): void {
    if (counts && (counts.input || counts.output)) this.reported = { input: counts.input || 0, output: counts.output || 0, cached: counts.cached || 0 };
  }

  get steps(): number { return this.calls.length + 1; }

  get sent(): number {
    const { instructions, guidance, memory, tools, earlier, message } = this.parts, opening = instructions + guidance + memory + tools + earlier + message;
    return opening * this.steps + this.calls.reduce((sum, chars, index) => sum + chars * (this.steps - index - 1), 0);
  }

  line(): TurnLedgerLine {
    const sent = this.sent, reported = this.reported;
    return { at: this.at, session: this.session, provider: this.provider, model: this.model, ...(this.role ? { role: this.role } : {}),
      parts: { ...this.parts }, tools: this.toolCount, steps: this.steps, sent, images: this.images, byTool: structuredClone(this.byTool),
      ...(reported ? { reported, rate: sent ? Math.round(reported.input / sent * 1000) / 1000 : null } : {}) };
  }
}

// One line per turn in the data folder, keeping the last LEDGER_KEEP. Sizes only: no text from the turn.
export async function recordTurn(path: string, line: TurnLedgerLine | Record<string, unknown>, { keep = LEDGER_KEEP }: { keep?: number } = {}): Promise<void> {
  await appendFile(path, `${JSON.stringify(line)}\n`, { mode: 0o600 });
  // Trimming reads the file, so only when it has clearly grown past what's kept.
  const size = (await stat(path)).size;
  if (size < keep * 1500) return;
  const lines = String(await readFile(path, 'utf8')).split('\n').filter(Boolean);
  if (lines.length > keep) await writeFile(path, `${lines.slice(-keep).join('\n')}\n`, { mode: 0o600 });
}
