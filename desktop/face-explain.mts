// Two Macs, step 7 (docs/fairy-on-two-macs-plan.md): Explain anything asked from a face is drawn on the face's screen.
// The picture and the text read from it come from the face, the model call is made here, and the drawing goes back to
// the face. This Mac's own screen, ink window and drawing are never touched, so the scene here is the face's alone.
import {
  explainOnScreen,
  type DisplayFocus,
  type ExplainOnScreenOptions,
  type ExplainOnScreenResult,
  type ExplainProvider,
  type ExplainShotInput,
} from './screen-ink.mjs';
import type { InkScene, InkSceneState, OcrInput } from './ink-sketch.mjs';
import { wantsInkClear } from '../src/chat-routing.js';

export interface FaceExplainShot extends ExplainShotInput {
  url: string;
  read?: OcrInput | null;
}

export interface FaceExplainLink {
  picture(purpose: string, options?: { signal?: AbortSignal }): Promise<FaceExplainShot>;
  ink(value: { clear?: boolean; state?: InkSceneState }): unknown;
}

export interface FaceExplainChatRunContext {
  settings: Record<string, unknown>;
  history: unknown[];
  text: string;
  signal: AbortSignal;
  onText?: (value: string) => void;
}

export interface FaceExplainChat {
  send(
    text: string,
    options: {
      onText?: (value: string) => void;
      run: (context: FaceExplainChatRunContext) => Promise<string>;
    },
  ): Promise<{ text: string }>;
}

export type FaceExplainDrawFn = (options: ExplainOnScreenOptions<FaceExplainShot>) => Promise<ExplainOnScreenResult>;

export interface ExplainOnFaceOptions {
  text?: unknown;
  drawn?: unknown;
  focus?: DisplayFocus | null;
  scene: InkScene;
  link: FaceExplainLink;
  chat: FaceExplainChat;
  provider: () => ExplainProvider;
  onText?: (value: string) => void;
  draw?: FaceExplainDrawFn;
}

// Parts the face closed since the last answer are dropped here too, so a follow-up doesn't draw them again.
export function keepDrawn(scene: InkScene, drawn: unknown): void {
  if (!Array.isArray(drawn)) return;
  const kept = new Set(drawn);
  for (const id of [...scene.parts.keys()]) if (!kept.has(id)) scene.remove(id);
}

// link: the FaceLink; chat: Quick chat, which keeps the turn; provider(): the conversation model.
// focus: an area selected on the face with ⌃⌥A, in the points of the display its picture is of.
export async function explainOnFace({
  text,
  drawn,
  focus = null,
  scene,
  link,
  chat,
  provider,
  onText = () => {},
  draw = explainOnScreen,
}: ExplainOnFaceOptions): Promise<{ text: string }> {
  const asked = typeof text === 'string' && text.trim() ? text.trim() : 'Explain what I’m looking at.';
  keepDrawn(scene, drawn);
  if (scene.showing && wantsInkClear(asked)) { scene.clear(); link.ink({ clear: true }); return { text: 'Cleared.' }; }
  return chat.send(asked, { onText,
    run: async ({ settings, history, text: question, signal, onText: chatText }) => (await draw({ provider: provider(), settings, history, text: question, signal, scene, focus, onText: chatText,
      capture: () => link.picture('explain', { signal }),
      // The face read the screen itself before sending the picture.
      read: async shot => shot.read ?? null,
      show: async state => link.ink({ state }) })).text });
}
