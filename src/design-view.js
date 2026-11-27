import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { DesignApp } from './design/DesignApp.tsx';
import './design-view.css';

export function designView({ api, root, sidebarButton, onError, onShow, onHide } = {}) {
  if (!root) throw new Error('designView needs a root element');
  let visible = false;
  let reactRoot = null;
  let mounted = false;

  const setOpen = open => {
    visible = Boolean(open);
    root.hidden = !visible;
    document.documentElement.classList.toggle('design-open', visible);
    sidebarButton?.classList.toggle('current', visible);
    sidebarButton?.setAttribute('aria-pressed', String(visible));
  };

  const mount = () => {
    if (mounted) return;
    mounted = true;
    reactRoot = createRoot(root);
    reactRoot.render(createElement(DesignApp, { api, onError }));
  };

  const show = () => {
    const wasVisible = visible;
    setOpen(true);
    if (!mounted) mount();
    if (!wasVisible) onShow?.();
  };

  const hide = () => {
    const wasVisible = visible;
    setOpen(false);
    if (wasVisible) onHide?.();
  };

  const toggle = () => {
    if (visible) hide();
    else show();
  };

  return {
    show,
    hide,
    toggle,
    get visible() { return visible; },
  };
}
