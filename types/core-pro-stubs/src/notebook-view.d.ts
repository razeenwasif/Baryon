export interface NotebookSpeechSettings {
  name?: string;
  voiceProvider?: string;
}

export interface NotebookVoiceProblem {
  code: string;
  message: string;
  again?: { chatId: string; index: number };
}

export interface NotebookSpeechSpeakResult {
  problem?: NotebookVoiceProblem | null;
  error?: string;
}

export interface NotebookSpeechController {
  settings: () => NotebookSpeechSettings | null | undefined;
  muted: () => boolean;
  speak: (chatId: string, index: number) => Promise<NotebookSpeechSpeakResult | null | undefined>;
  stop: () => void;
  unmute: () => Promise<unknown> | void;
  openSettings: (pane: string) => void;
}

export interface NotebookPageArtifact {
  id?: string;
  seq?: number;
  title?: string;
  [key: string]: unknown;
}

export interface NotebookViewOptions {
  api: unknown;
  root: HTMLElement;
  sidebarButton?: HTMLElement | null;
  sidebarSlot?: HTMLElement | null;
  onShow?: () => void;
  onHide?: () => void;
  onPaper?: (on: boolean) => void;
  speech?: NotebookSpeechController | null;
  openPage?: ((artifact: NotebookPageArtifact) => void) | null;
  onInvestigate?: ((seed: unknown) => void) | null;
}

export interface NotebookViewController {
  show: () => void;
  hide: () => void;
  toggle: () => void;
  showSource: (id: string | number) => void;
  shown: () => boolean;
  voiceChanged: () => void;
}

export function notebookView(options: NotebookViewOptions): NotebookViewController | null;
