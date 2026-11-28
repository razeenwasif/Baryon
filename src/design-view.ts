import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DesignApp } from './design/DesignApp.js';
import './design-view.css';

export interface DesignViewOptions {
  api?: unknown;
  root?: HTMLElement | null;
  sidebarButton?: HTMLElement | null;
  onError?: (msg: string) => void;
  onShow?: () => void;
  onHide?: () => void;
}

export interface DesignViewController {
  show: () => void;
  hide: () => void;
  toggle: () => void;
  readonly visible: boolean;
}

export function designView({ api, root, sidebarButton, onError, onShow, onHide }: DesignViewOptions = {}): DesignViewController {
  if (!root) throw new Error('designView needs a root element');
  let visible = false;
  let reactRoot: Root | null = null;
  let mounted = false;

  const setOpen = (open: boolean): void => {
    visible = Boolean(open);
    root.hidden = !visible;
    document.documentElement.classList.toggle('design-open', visible);
    sidebarButton?.classList.toggle('current', visible);
    sidebarButton?.setAttribute('aria-pressed', String(visible));
  };

  const mount = (): void => {
    if (mounted) return;
    mounted = true;
    reactRoot = createRoot(root);
    reactRoot.render(createElement(DesignApp, { api, onError }));
  };

  const show = (): void => {
    const wasVisible = visible;
    setOpen(true);
    if (!mounted) mount();
    if (!wasVisible) onShow?.();
  };

  const hide = (): void => {
    const wasVisible = visible;
    setOpen(false);
    if (wasVisible) onHide?.();
  };

  const toggle = (): void => {
    if (visible) hide();
    else show();
  };

  return {
    show,
    hide,
    toggle,
    get visible(): boolean {
      return visible;
    },
  };
}
