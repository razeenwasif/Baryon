export interface GameViewOptions {
  api?: unknown;
  root?: HTMLElement | null;
  sidebarButton?: HTMLElement | null;
  onError?: (msg: string) => void;
  onShow?: () => void;
  onHide?: () => void;
}

export interface GameViewController {
  show: () => void;
  hide: () => void;
  toggle: () => void;
  openWithAsset: (asset?: unknown) => void;
  readonly visible: boolean;
}

export function gameView(options?: GameViewOptions): GameViewController | null;
