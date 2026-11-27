const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/**
 * Renders the out-of-band Secret Request banner above the composer so API keys,
 * 1Password references (`op://...`), and manual secrets never enter chat transcripts.
 */
export function setupSecretRequestsBanner({ host, api, activeSession, onError = () => {}, isRemote = () => false }) {
  if (!host) return { refresh: async () => {}, render: () => {} };
  let requests = [];
  let busyId = '';

  function render() {
    const sid = activeSession?.() || '';
    const active = requests.filter(r => r && r.session === sid && (r.status === 'pending' || r.status === 'approved'));
    if (!active.length) {
      host.hidden = true;
      host.replaceChildren();
      return;
    }

    const nodes = [];
    for (const req of active) {
      const card = el('div', `secret-req-row is-${req.status}`);
      const head = el('div', 'secret-req-head');
      const title = el('div', 'secret-req-title');
      title.append(
        el('code', 'secret-req-var', req.envVar),
        el('span', 'secret-req-badge', req.status === 'approved' ? `Approved (${req.source || 'secret'})` : 'Needs secret'),
      );
      head.append(title);
      if (req.status === 'approved') {
        const revokeBtn = el('button', 'composer-queue-btn remove', 'Revoke');
        revokeBtn.type = 'button';
        revokeBtn.disabled = busyId === req.id;
        revokeBtn.onclick = async () => {
          busyId = req.id;
          render();
          try {
            await api?.secretRequestRevoke?.(sid, req.envVar);
            await refresh();
          } catch (err) {
            onError(err.message);
          } finally {
            busyId = '';
            render();
          }
        };
        head.append(revokeBtn);
      }
      card.append(head);
      if (req.reason) card.append(el('p', 'secret-req-reason', req.reason));

      if (req.status === 'pending') {
        if (isRemote()) {
          card.append(el('p', 'secret-req-note', 'Approve secret requests on your MacBook/host window to keep credentials local.'));
        } else {
          const form = el('div', 'secret-req-controls');
          const input = el('input', 'secret-req-input');
          input.type = 'password';
          input.autocomplete = 'off';
          input.spellcheck = false;
          input.placeholder = req.suggestedRef || 'op://Vault/Item/field or secret value…';
          input.setAttribute('aria-label', `Secret for ${req.envVar}`);
          if (req.suggestedRef && (req.suggestedRef.startsWith('op://') || req.suggestedRef.startsWith('secret-ref:'))) {
            input.type = 'text';
            input.value = req.suggestedRef;
          }

          const approveBtn = el('button', 'composer-queue-btn steer', 'Provide secret');
          approveBtn.type = 'button';
          approveBtn.disabled = busyId === req.id;
          approveBtn.onclick = async () => {
            const val = input.value.trim();
            if (!val) {
              input.focus();
              return;
            }
            const isRef = val.startsWith('op://') || val.startsWith('secret-ref:');
            busyId = req.id;
            render();
            try {
              await api?.secretRequestResolve?.(req.id, isRef ? { action: 'approve', secretRef: val } : { action: 'approve', literalValue: val });
              input.value = '';
              await refresh();
            } catch (err) {
              onError(err.message);
            } finally {
              busyId = '';
              render();
            }
          };

          const denyBtn = el('button', 'composer-queue-btn', 'Deny');
          denyBtn.type = 'button';
          denyBtn.disabled = busyId === req.id;
          denyBtn.onclick = async () => {
            busyId = req.id;
            render();
            try {
              await api?.secretRequestResolve?.(req.id, { action: 'deny' });
              await refresh();
            } catch (err) {
              onError(err.message);
            } finally {
              busyId = '';
              render();
            }
          };

          form.append(input, approveBtn, denyBtn);
          card.append(form);
        }
      }
      nodes.push(card);
    }

    host.hidden = false;
    host.replaceChildren(...nodes);
  }

  async function refresh() {
    const sid = activeSession?.() || '';
    if (!sid || !api?.secretRequestsList) {
      requests = [];
      render();
      return;
    }
    try {
      const list = await api.secretRequestsList(sid);
      requests = Array.isArray(list) ? list : [];
    } catch {
      requests = [];
    }
    render();
  }

  api?.onSecretRequests?.(payload => {
    const sid = activeSession?.() || '';
    if (!payload || !sid || payload.session !== sid) return;
    if (Array.isArray(payload.requests)) {
      requests = payload.requests;
      render();
    } else {
      void refresh();
    }
  });

  return { refresh, render };
}
