import type { BaryonInkApi, BaryonPreloadApi, BaryonQuickApi } from '../../desktop/ipc-contract';

declare global {
  interface Window {
    fairy?: BaryonPreloadApi;
    lyra?: BaryonPreloadApi;
    fairyInk?: BaryonInkApi;
    fairyQuick?: BaryonQuickApi;
  }
}
