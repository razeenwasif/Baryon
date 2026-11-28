import { clipboardRequest } from '../src/clipboard-request.js';

export interface ClipboardHistoryEntry {
  role?: string;
  content?: string;
  mode?: string;
}

export interface CopyRequestedTextOptions {
  text: unknown;
  history?: ClipboardHistoryEntry[];
  generate: (prompt: string, signal?: AbortSignal | null) => Promise<string>;
  writeText: (content: string) => Promise<unknown> | unknown;
  signal?: AbortSignal | null;
}

export interface CopyRequestedTextResult {
  text: string;
  copied: boolean;
  characters?: number;
}

const PREFIX = 'Copied to your clipboard:\n\n';
const MAX_TEXT = 24000;
function validated(text: unknown): string {
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT || text.includes('\0')) throw Error('Clipboard text must contain 1–24,000 characters, without null characters. Nothing was copied.');
  return text;
}
function codeOnly(text: string): string {
  const blocks = [...text.matchAll(/^```[^\n]*\n([\s\S]*?)\n```[ \t]*$/gm)];
  if (blocks.length !== 1) throw Error(blocks.length ? 'There are several code blocks. Tell me which one to copy.' : 'I could not find one code block to copy. Ask me to show the code first.');
  return blocks[0][1];
}
export async function copyRequestedText({ text, history = [], generate, writeText, signal }: CopyRequestedTextOptions): Promise<CopyRequestedTextResult> {
  const request = clipboardRequest(text);
  if (!request) throw Error('A direct clipboard request is required.');
  signal?.throwIfAborted();
  if (request.kind === 'clarify') return { text: 'Tell me the text to copy, or say “copy your last answer” or “copy the code to my clipboard.”', copied: false };
  let content: string;
  if (request.kind === 'literal') content = request.text;
  else if (request.kind === 'previous') {
    const previous = history.findLast(item => item.role === 'assistant' && typeof item.content === 'string' && item.content.trim());
    if (!previous || typeof previous.content !== 'string') throw Error('There is no previous answer to copy yet.');
    content = previous.mode === 'clipboard' && previous.content.startsWith(PREFIX) ? previous.content.slice(PREFIX.length) : previous.content;
    if (request.code) content = codeOnly(content);
  } else {
    content = await generate('Prepare the text requested below. The app will copy your finished response to the system clipboard after you finish. Return only the requested text, with no introduction, copying claims, instructions to the user, or Markdown code fences. Do not perform any other actions.\n\nRequest: ' + request.prompt, signal);
  }
  content = validated(content); signal?.throwIfAborted();
  await writeText(content); // Exactly once, only after a complete validated result.
  return { text: PREFIX + content, copied: true, characters: content.length };
}
