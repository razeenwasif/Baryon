import type { AnalyticsApi, AnalyticsMode } from './analytics/store.js';

export interface AnalyticsViewOptions {
  api?: AnalyticsApi;
  root?: HTMLElement | null;
  sidebarButton?: HTMLElement | null;
  onPage?: (artifact: { id: string; seq?: number }) => void;
  onError?: (msg: string) => void;
  onShow?: () => void;
  onHide?: () => void;
}

export interface OpenDatasetOptions {
  mode?: AnalyticsMode;
}

export interface AnalyticsViewController {
  show: () => void;
  hide: () => void;
  toggle: () => void;
  openDataset: (datasetId?: string | null, options?: OpenDatasetOptions) => Promise<void>;
  readonly visible: boolean;
}

export function analyticsView(options?: AnalyticsViewOptions): AnalyticsViewController | null;
