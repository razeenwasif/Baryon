import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { BoardsApp } from './boards/BoardsApp.tsx';

export function boardsView({
  root,
  sidebarButton,
  onOpenDoc = () => {},
  onShow = () => {},
  onHide = () => {},
}) {
  let shown = false;
  let reactRoot = null;
  let requestedBoardId = null;
  let requestNonce = 0;

  const render = () => {
    if (!root) return;
    if (!reactRoot) reactRoot = createRoot(root);
    reactRoot.render(
      createElement(BoardsApp, {
        active: shown,
        requestedBoardId,
        requestNonce,
        onOpenPlanDoc: docId => onOpenDoc(docId),
      }),
    );
  };

  const show = (boardId = null) => {
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

  const open = boardId => show(boardId);

  return {
    show,
    hide,
    toggle,
    open,
    isOpen: () => shown,
  };
}
