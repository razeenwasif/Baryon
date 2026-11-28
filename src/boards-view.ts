import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BoardsApp } from './boards/BoardsApp';

export interface BoardsViewOptions {
  api?: unknown;
  root?: HTMLElement | null;
  sidebarButton?: HTMLElement | null;
  onOpenDoc?: (docId: string) => void;
  onShow?: () => void;
  onHide?: () => void;
}

export interface BoardsViewController {
  show: (boardId?: string | null) => void;
  hide: () => void;
  toggle: () => void;
  open: (boardId?: string | null) => void;
  isOpen: () => boolean;
}

export function boardsView({
  root,
  sidebarButton,
  onOpenDoc = () => {},
  onShow = () => {},
  onHide = () => {},
}: BoardsViewOptions): BoardsViewController {
  let shown = false;
  let reactRoot: Root | null = null;
  let requestedBoardId: string | null = null;
  let requestNonce = 0;

  const render = () => {
    if (!root) return;
    if (!reactRoot) reactRoot = createRoot(root);
    reactRoot.render(
      createElement(BoardsApp, {
        active: shown,
        requestedBoardId,
        requestNonce,
        onOpenPlanDoc: (docId: string) => onOpenDoc(docId),
      }),
    );
  };

  const show = (boardId: string | null = null) => {
    if (boardId) {
      requestedBoardId = boardId;
      requestNonce += 1;
    }
    shown = true;
    document.documentElement.classList.toggle('boards-open', true);
    if (root) root.hidden = false;
    if (sidebarButton) {
      sidebarButton.classList.add('current');
      sidebarButton.setAttribute('aria-pressed', 'true');
    }
    render();
    onShow();
  };

  const hide = () => {
    if (!shown && root?.hidden) return;
    shown = false;
    document.documentElement.classList.toggle('boards-open', false);
    if (root) root.hidden = true;
    if (sidebarButton) {
      sidebarButton.classList.remove('current');
      sidebarButton.setAttribute('aria-pressed', 'false');
    }
    if (reactRoot) render();
    onHide();
  };

  const toggle = () => (shown ? hide() : show());

  const open = (boardId?: string | null) => show(boardId);

  return {
    show,
    hide,
    toggle,
    open,
    isOpen: () => shown,
  };
}
