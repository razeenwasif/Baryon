export interface StudioWorldSeed {
  studioItemId: string;
  title: string;
  prompt: string;
  dataUrl: string;
}

export interface StudioGameAsset {
  studioItemId: string;
  kind: 'image' | 'music';
  title: string;
}

export interface StudioViewOptions {
  api?: unknown;
  root?: HTMLElement | null;
  sidebarButton?: HTMLElement | null;
  onError?: (msg: string) => void;
  onOpenSettings?: (pane: string) => void;
  onLaunchWorld?: (seed: StudioWorldSeed) => void;
  onSendToGame?: (asset: StudioGameAsset) => void;
  onShow?: () => void;
  onHide?: () => void;
}

export interface StudioViewController {
  show: () => void;
  hide: () => void;
  toggle: () => void;
  readonly visible: boolean;
}

export function studioView(options?: StudioViewOptions): StudioViewController | null;
