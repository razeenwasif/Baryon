export interface WorldsViewOptions {
  api?: unknown;
  root?: HTMLElement | null;
  sidebarButton?: HTMLElement | null;
  onError?: (msg: string) => void;
  onOpenSettings?: (pane: string) => void;
  onShow?: () => void;
  onHide?: () => void;
}

export interface WorldsViewController {
  show(): void;
  hide(): void;
  toggle(): void;
  openWithSeed(seed?: unknown): void;
  readonly visible: boolean;
}

export function worldsView(options?: WorldsViewOptions): WorldsViewController | null;
