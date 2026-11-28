export interface ResearchPageArtifact {
  id: string;
  seq?: number;
}

export interface ResearchStudyTarget {
  notebook?: unknown;
  source?: unknown;
}

export interface ResearchDraftInput {
  title?: string;
  goal?: string;
  discipline?: string;
  literature?: boolean;
  seed?: { from?: unknown; feedback?: unknown; papers?: unknown } | null;
}

export interface ResearchViewOptions {
  api: unknown;
  root: HTMLElement;
  sidebarButton?: HTMLElement | null;
  onShow?: () => void;
  onHide?: () => void;
  openLink?: ((url: string) => void) | null;
  onStudy?: ((target: ResearchStudyTarget) => void) | null;
  onPage?: ((artifact: ResearchPageArtifact) => void) | null;
  onReproduce?: ((arxiv: string) => void) | null;
}

export interface ResearchViewController {
  show(): void;
  hide(): void;
  draft(opts?: ResearchDraftInput): void;
  toggle(): void;
  shown(): boolean;
  handle(event: Record<string, unknown>): void;
  destroy(): void;
}

export function researchView(options: ResearchViewOptions): ResearchViewController | null;
