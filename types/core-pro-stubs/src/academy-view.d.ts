import type { AcademyApi } from './academy/types.js';

export interface AcademyViewOptions {
  api?: AcademyApi;
  root?: HTMLElement | null;
  sidebarButton?: HTMLElement | null;
  onError?: (msg: string) => void;
  onShow?: () => void;
  onHide?: () => void;
}

export interface AcademyViewController {
  show: () => void;
  hide: () => void;
  toggle: () => void;
  readonly visible: boolean;
}

export function academyView(options?: AcademyViewOptions): AcademyViewController | null;
