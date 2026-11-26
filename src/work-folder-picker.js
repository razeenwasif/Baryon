// Obsidian Work Folder Picker modal: searches all recent work folders & discovered Git repositories on the
// mini, and includes an interactive SSH directory browser (`Browse mini (SSH)`) for picking any project folder.

export function filterWorkFolders(folders = [], query = '') {
  const list = Array.isArray(folders) ? folders.filter(item => typeof item?.path === 'string' && item.path) : [];
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return [...list];

  const scored = [];
  for (const item of list) {
    const name = String(item.name || item.path.split('/').filter(Boolean).at(-1) || item.path).toLowerCase();
    const group = String(item.group || '').toLowerCase();
    const full = item.path.toLowerCase();
    let score = -1;
    if (name === q) score = 0;
    else if (name.startsWith(q)) score = 1;
    else if (name.includes(q)) score = 2;
    else if (group.includes(q) || full.includes(q)) score = 3;
    if (score >= 0) scored.push({ item, score, name });
  }

  scored.sort((a, b) =>
    a.score - b.score
    || (b.item.default === true ? 1 : 0) - (a.item.default === true ? 1 : 0)
    || ((b.item.recent || b.item.source === 'recent') ? 1 : 0) - ((a.item.recent || a.item.source === 'recent') ? 1 : 0)
    || a.name.localeCompare(b.name));
  return scored.map(entry => entry.item);
}

export function groupWorkFolders(folders = []) {
  const recent = [], repos = [];
  for (const item of Array.isArray(folders) ? folders : []) {
    if (!item?.path) continue;
    if (item.default || item.recent || item.source === 'recent') recent.push(item);
    else repos.push(item);
  }
  return { recent, repos };
}

export function buildPathBreadcrumbs(currentPath = '', home = '') {
  const clean = String(currentPath ?? '').replace(/\/+$/, '') || (String(currentPath).startsWith('/') ? '/' : '');
  const cleanHome = String(home ?? '').replace(/\/+$/, '');
  if (!clean) return [];

  const crumbs = [];
  if (cleanHome && (clean === cleanHome || clean.startsWith(`${cleanHome}/`))) {
    crumbs.push({ label: '~', path: cleanHome });
    const tail = clean.slice(cleanHome.length).split('/').filter(Boolean);
    let acc = cleanHome;
    for (const seg of tail) {
      acc = `${acc}/${seg}`;
      crumbs.push({ label: seg, path: acc });
    }
    return crumbs;
  }

  if (clean.startsWith('/')) {
    crumbs.push({ label: '/', path: '/' });
    let acc = '';
    for (const seg of clean.split('/').filter(Boolean)) {
      acc = `${acc}/${seg}`;
      crumbs.push({ label: seg, path: acc });
    }
    return crumbs;
  }

  return [{ label: clean, path: clean }];
}

const el = (tag, className = '', text = '') => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== '') node.textContent = text;
  return node;
};

const FOLDER_SVG = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M1.5 3.5A1.5 1.5 0 0 1 3 2h3l1.4 1.5H13A1.5 1.5 0 0 1 14.5 5v7A1.5 1.5 0 0 1 13 13.5H3A1.5 1.5 0 0 1 1.5 12V3.5Z" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/></svg>';
const REPO_SVG = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="5" cy="4" r="1.5" stroke="currentColor" stroke-width="1.3"/><circle cx="11" cy="6" r="1.5" stroke="currentColor" stroke-width="1.3"/><circle cx="5" cy="12" r="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M5 5.5v5M5 9.2c0-1.5 6-.9 6-1.7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';

export function createWorkFolderPicker({ api, onError = () => {} } = {}) {
  let dialog = null;
  let activeResolve = null;

  const ensureDialog = () => {
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.className = 'wfp-dialog';
    dialog.setAttribute('aria-label', 'Choose a project folder');
    document.body.append(dialog);
    return dialog;
  };

  function finish(value) {
    const resolve = activeResolve;
    activeResolve = null;
    if (dialog?.open) dialog.close();
    if (resolve) resolve(value ?? null);
  }

  async function pick({
    title = 'Choose a folder on mini',
    confirmLabel = 'Work here',
    initialFolders = [],
    allowScratch = true,
    initialTab = 'repos',
  } = {}) {
    if (activeResolve) finish(null);

    const dlg = ensureDialog();
    let folders = Array.isArray(initialFolders) ? [...initialFolders] : [];
    let tab = initialTab === 'ssh' ? 'ssh' : 'repos';
    let repoQuery = '';
    let activeIdx = 0;

    // SSH browser state
    let sshHost = 'mini';
    let sshShowHidden = false;
    let sshLoading = false;
    let sshError = '';
    let sshListing = null; // { ok, host, via, home, path, parent, canWorkHere, isRepo, entries }
    let sshFilter = '';
    let browseSeq = 0;

    return new Promise(resolve => {
      activeResolve = resolve;
      let closed = false;

      dlg.replaceChildren();
      const shell = el('div', 'wfp-shell');

      // Header
      const header = el('div', 'wfp-header');
      const headLeft = el('div', 'wfp-head-left');
      headLeft.append(el('span', 'wfp-eyebrow', 'Work session folder'), el('h2', 'wfp-title', title));
      const closeBtn = el('button', 'wfp-icon-btn', '×');
      closeBtn.type = 'button';
      closeBtn.setAttribute('aria-label', 'Close folder picker');
      closeBtn.onclick = () => finish(null);
      header.append(headLeft, closeBtn);

      // Tabs
      const tabs = el('div', 'wfp-tabs');
      tabs.setAttribute('role', 'tablist');
      const reposTabBtn = el('button', 'wfp-tab', 'Repos & Recent');
      reposTabBtn.type = 'button';
      reposTabBtn.setAttribute('role', 'tab');
      const reposCount = el('span', 'wfp-tab-count', String(folders.length));
      reposTabBtn.append(reposCount);

      const sshTabBtn = el('button', 'wfp-tab', 'Browse mini (SSH)');
      sshTabBtn.type = 'button';
      sshTabBtn.setAttribute('role', 'tab');
      tabs.append(reposTabBtn, sshTabBtn);

      // Tab 1: Repos & Recent
      const reposPanel = el('div', 'wfp-panel');
      const searchWrap = el('div', 'wfp-search-wrap');
      const searchInput = el('input', 'wfp-input');
      searchInput.type = 'search';
      searchInput.placeholder = 'Search repos or folders on mini (e.g. flux, Lyra, Proton)…';
      searchInput.autocomplete = 'off';
      searchInput.spellcheck = false;
      searchWrap.append(searchInput);

      const reposList = el('div', 'wfp-list');
      reposPanel.append(searchWrap, reposList);

      // Tab 2: Browse mini (SSH)
      const sshPanel = el('div', 'wfp-panel');
      sshPanel.hidden = true;

      const sshTopBar = el('div', 'wfp-ssh-bar');
      const sshStatusPill = el('span', 'wfp-status-pill', 'ssh · mini');
      const sshHostInput = el('input', 'wfp-host-input');
      sshHostInput.type = 'text';
      sshHostInput.value = sshHost;
      sshHostInput.placeholder = 'mini';
      sshHostInput.title = 'SSH host or alias (e.g. mini)';
      const sshConnectBtn = el('button', 'wfp-quiet-btn', 'Refresh');
      sshConnectBtn.type = 'button';
      const hiddenToggle = el('label', 'wfp-check');
      const hiddenBox = document.createElement('input');
      hiddenBox.type = 'checkbox';
      hiddenToggle.append(hiddenBox, document.createTextNode('Hidden'));
      sshTopBar.append(sshStatusPill, sshHostInput, sshConnectBtn, hiddenToggle);

      const quickRow = el('div', 'wfp-quick-row');
      for (const [label, target] of [
        ['~', '~'],
        ['Github', '~/Github'],
        ['Applications', '~/Github/Applications'],
        ['Desktop', '~/Desktop'],
        ['Documents', '~/Documents'],
      ]) {
        const chip = el('button', 'wfp-chip', label);
        chip.type = 'button';
        chip.onclick = () => void loadBrowse(target);
        quickRow.append(chip);
      }

      const crumbsRow = el('div', 'wfp-crumbs');
      const sshFilterRow = el('div', 'wfp-search-wrap');
      const sshFilterInput = el('input', 'wfp-input');
      sshFilterInput.type = 'text';
      sshFilterInput.placeholder = 'Filter folder names or type ~/path and press Enter…';
      sshFilterInput.autocomplete = 'off';
      sshFilterInput.spellcheck = false;
      sshFilterRow.append(sshFilterInput);

      const sshNotice = el('p', 'wfp-error');
      sshNotice.hidden = true;

      const sshList = el('div', 'wfp-list');
      sshPanel.append(sshTopBar, quickRow, crumbsRow, sshFilterRow, sshNotice, sshList);

      // Footer
      const footer = el('div', 'wfp-footer');
      const footerPath = el('div', 'wfp-footer-path', 'Select a folder to start');
      const footerActions = el('div', 'wfp-footer-actions');
      const scratchBtn = allowScratch ? el('button', 'wfp-quiet-btn', 'Fairy Scratch') : null;
      if (scratchBtn) {
        scratchBtn.type = 'button';
        scratchBtn.onclick = () => finish('scratch');
      }
      const cancelBtn = el('button', 'wfp-quiet-btn', 'Cancel');
      cancelBtn.type = 'button';
      cancelBtn.onclick = () => finish(null);
      const confirmBtn = el('button', 'wfp-primary-btn', confirmLabel);
      confirmBtn.type = 'button';
      confirmBtn.hidden = true;
      confirmBtn.onclick = () => {
        if (sshListing?.canWorkHere && sshListing.path) finish(sshListing.path);
      };
      if (scratchBtn) footerActions.append(scratchBtn);
      footerActions.append(cancelBtn, confirmBtn);
      footer.append(footerPath, footerActions);

      shell.append(header, tabs, reposPanel, sshPanel, footer);
      dlg.append(shell);

      function renderedFlatItems() {
        const filtered = filterWorkFolders(folders, repoQuery);
        if (repoQuery.trim()) return { unified: filtered, recent: [], repos: [] };
        const { recent, repos } = groupWorkFolders(filtered);
        return { unified: null, recent, repos };
      }

      function renderRepos() {
        reposCount.textContent = String(folders.length);
        const { unified, recent, repos } = renderedFlatItems();
        const flat = unified ? unified : [...recent, ...repos];
        if (!flat.length) activeIdx = 0;
        else activeIdx = Math.max(0, Math.min(activeIdx, flat.length - 1));

        const makeRow = (item, idx) => {
          const row = el('button', `wfp-row${idx === activeIdx ? ' is-active' : ''}`);
          row.type = 'button';
          row.title = item.path;

          const icon = el('span', 'wfp-row-icon');
          icon.innerHTML = item.repo ? REPO_SVG : FOLDER_SVG;

          const main = el('span', 'wfp-row-main');
          const titleLine = el('span', 'wfp-row-title');
          titleLine.append(el('span', 'wfp-row-name', item.name || item.path));
          if (item.group) titleLine.append(el('span', 'wfp-row-group', item.group));
          main.append(titleLine, el('span', 'wfp-row-path', item.path));

          const badges = el('span', 'wfp-row-badges');
          if (item.default) badges.append(el('span', 'wfp-pill is-accent', 'default'));
          else if (item.recent || item.source === 'recent') badges.append(el('span', 'wfp-pill', 'recent'));
          if (item.repo) badges.append(el('span', 'wfp-pill is-repo', 'git'));

          row.append(icon, main, badges);
          row.onclick = () => finish(item.path);
          return row;
        };

        const frag = document.createDocumentFragment();
        if (!flat.length) {
          const empty = el('div', 'wfp-empty');
          empty.append(el('p', '', repoQuery.trim()
            ? `No matching repositories found for “${repoQuery.trim()}”.`
            : 'No repositories found automatically in ~/Github.'));
          if (api?.miniBrowseDir) {
            const jumpSsh = el('button', 'wfp-primary-btn', 'Browse mini via SSH →');
            jumpSsh.type = 'button';
            jumpSsh.onclick = () => switchTab('ssh');
            empty.append(jumpSsh);
          }
          frag.append(empty);
        } else if (unified) {
          unified.forEach((item, idx) => frag.append(makeRow(item, idx)));
        } else {
          let cursor = 0;
          if (recent.length) {
            frag.append(el('div', 'wfp-section-label', `Default & recent (${recent.length})`));
            for (const item of recent) frag.append(makeRow(item, cursor++));
          }
          if (repos.length) {
            frag.append(el('div', 'wfp-section-label', `Repositories on mini (${repos.length})`));
            for (const item of repos) frag.append(makeRow(item, cursor++));
          }
        }

        reposList.replaceChildren(frag);
        reposList.querySelector('.wfp-row.is-active')?.scrollIntoView({ block: 'nearest' });
      }

      function renderSsh() {
        sshHostInput.disabled = sshLoading;
        sshConnectBtn.disabled = sshLoading;
        sshConnectBtn.textContent = sshLoading ? 'Loading…' : 'Refresh';

        if (sshLoading) {
          sshStatusPill.className = 'wfp-status-pill is-loading';
          sshStatusPill.textContent = `connecting · ${sshHost || 'mini'}`;
        } else if (sshError) {
          sshStatusPill.className = 'wfp-status-pill is-error';
          sshStatusPill.textContent = `error · ${sshHost || 'mini'}`;
        } else if (sshListing) {
          sshStatusPill.className = 'wfp-status-pill is-ok';
          const viaLabel = sshListing.via === 'ssh-tailscale' ? 'tailscale ssh' : sshListing.via === 'local' ? 'local' : 'ssh';
          sshStatusPill.textContent = `${viaLabel} · ${sshListing.host || sshHost || 'mini'}`;
        }

        if (sshError) {
          sshNotice.textContent = sshError;
          sshNotice.hidden = false;
        } else {
          sshNotice.hidden = true;
        }

        // Breadcrumbs
        crumbsRow.replaceChildren();
        if (sshListing?.path) {
          if (sshListing.parent) {
            const up = el('button', 'wfp-crumb is-up', '↑');
            up.type = 'button';
            up.title = 'Parent folder';
            up.onclick = () => void loadBrowse(sshListing.parent);
            crumbsRow.append(up);
          }
          const crumbs = buildPathBreadcrumbs(sshListing.path, sshListing.home);
          crumbs.forEach((c, idx) => {
            if (idx > 0) crumbsRow.append(el('span', 'wfp-crumb-sep', '/'));
            const b = el('button', `wfp-crumb${idx === crumbs.length - 1 ? ' is-current' : ''}`, c.label);
            b.type = 'button';
            b.onclick = () => void loadBrowse(c.path);
            crumbsRow.append(b);
          });
        }

        // Entries
        const entries = Array.isArray(sshListing?.entries) ? sshListing.entries : [];
        const q = sshFilter.trim().toLowerCase();
        const visible = q && !q.startsWith('/') && !q.startsWith('~')
          ? entries.filter(e => e.name.toLowerCase().includes(q))
          : entries;

        const frag = document.createDocumentFragment();
        if (!sshListing && sshLoading) {
          frag.append(el('div', 'wfp-empty', `Connecting to ${sshHost || 'mini'} via SSH…`));
        } else if (!sshListing && !sshError) {
          frag.append(el('div', 'wfp-empty', 'Enter an SSH host above and click Refresh.'));
        } else if (sshListing && !visible.length) {
          frag.append(el('div', 'wfp-empty', q
            ? `No subfolders matching “${sshFilter.trim()}” inside ${sshListing.path}.`
            : 'No subfolders inside this directory.'));
        } else {
          for (const entry of visible) {
            const row = el('div', 'wfp-dir-row');
            const openBtn = el('button', 'wfp-dir-open');
            openBtn.type = 'button';
            openBtn.title = `Open ${entry.path}`;
            const icon = el('span', 'wfp-row-icon');
            icon.innerHTML = entry.isRepo ? REPO_SVG : FOLDER_SVG;
            openBtn.append(icon, el('span', 'wfp-row-name', entry.name));
            if (entry.isRepo) openBtn.append(el('span', 'wfp-pill is-repo', 'git'));
            openBtn.onclick = () => {
              sshFilter = '';
              sshFilterInput.value = '';
              void loadBrowse(entry.path);
            };

            const selectBtn = el('button', 'wfp-pick-btn', 'Select');
            selectBtn.type = 'button';
            selectBtn.onclick = () => finish(entry.path);

            row.append(openBtn, selectBtn);
            frag.append(row);
          }
        }
        sshList.replaceChildren(frag);

        // Footer button state on SSH tab
        if (tab === 'ssh') {
          confirmBtn.hidden = false;
          if (sshListing?.path) {
            const leaf = sshListing.path.split('/').filter(Boolean).at(-1) || sshListing.path;
            footerPath.textContent = sshListing.canWorkHere
              ? sshListing.path
              : `${sshListing.path} · open a project folder inside ~`;
            confirmBtn.disabled = !sshListing.canWorkHere || sshLoading;
            confirmBtn.textContent = sshListing.canWorkHere ? `${confirmLabel} (${leaf})` : confirmLabel;
          } else {
            footerPath.textContent = 'Browse your home folders on mini over SSH';
            confirmBtn.disabled = true;
            confirmBtn.textContent = confirmLabel;
          }
        } else {
          confirmBtn.hidden = true;
          footerPath.textContent = `${folders.length} known repos & recent folders`;
        }
      }

      async function loadBrowse(pathOverride) {
        if (!api?.miniBrowseDir) {
          sshError = 'Folder browsing requires the desktop app.';
          renderSsh();
          return;
        }
        const seq = ++browseSeq;
        const targetPath = pathOverride !== undefined ? pathOverride : (sshListing?.path || '');
        sshHost = sshHostInput.value.trim() || 'mini';
        sshLoading = true;
        sshError = '';
        renderSsh();
        try {
          const res = await api.miniBrowseDir({ path: targetPath, host: sshHost, showHidden: sshShowHidden });
          if (closed || seq !== browseSeq) return;
          sshListing = res;
          if (res?.host && !sshHostInput.value.trim()) sshHostInput.value = res.host;
          sshError = '';
        } catch (err) {
          if (closed || seq !== browseSeq) return;
          sshError = String(err?.message || err).replace(/Error invoking remote method '[^']+': Error: /, '');
        } finally {
          if (!closed && seq === browseSeq) {
            sshLoading = false;
            renderSsh();
          }
        }
      }

      function switchTab(next) {
        tab = next;
        const isRepos = tab === 'repos';
        reposTabBtn.setAttribute('aria-selected', String(isRepos));
        sshTabBtn.setAttribute('aria-selected', String(!isRepos));
        reposPanel.hidden = !isRepos;
        sshPanel.hidden = isRepos;
        if (isRepos) {
          confirmBtn.hidden = true;
          renderRepos();
          searchInput.focus();
        } else {
          renderSsh();
          if (!sshListing && !sshLoading) void loadBrowse('');
          else sshFilterInput.focus();
        }
      }

      reposTabBtn.onclick = () => switchTab('repos');
      sshTabBtn.onclick = () => switchTab('ssh');

      searchInput.oninput = () => {
        repoQuery = searchInput.value;
        activeIdx = 0;
        renderRepos();
      };
      searchInput.onkeydown = event => {
        const { unified, recent, repos } = renderedFlatItems();
        const flat = unified ? unified : [...recent, ...repos];
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          if (flat.length) { activeIdx = (activeIdx + 1) % flat.length; renderRepos(); }
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          if (flat.length) { activeIdx = (activeIdx - 1 + flat.length) % flat.length; renderRepos(); }
        } else if (event.key === 'Enter' && flat.length) {
          event.preventDefault();
          finish(flat[activeIdx].path);
        }
      };

      sshConnectBtn.onclick = () => void loadBrowse(sshListing?.path || '');
      sshHostInput.onkeydown = event => {
        if (event.key === 'Enter') { event.preventDefault(); void loadBrowse(sshListing?.path || ''); }
      };
      hiddenBox.onchange = () => {
        sshShowHidden = hiddenBox.checked;
        void loadBrowse(sshListing?.path || '');
      };
      sshFilterInput.oninput = () => {
        sshFilter = sshFilterInput.value;
        renderSsh();
      };
      sshFilterInput.onkeydown = event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        const raw = sshFilterInput.value.trim();
        if (raw.startsWith('/') || raw.startsWith('~')) {
          sshFilter = '';
          sshFilterInput.value = '';
          void loadBrowse(raw);
          return;
        }
        const entries = Array.isArray(sshListing?.entries) ? sshListing.entries : [];
        const q = raw.toLowerCase();
        const match = q ? entries.find(e => e.name.toLowerCase().includes(q)) : entries[0];
        if (match) {
          sshFilter = '';
          sshFilterInput.value = '';
          void loadBrowse(match.path);
        } else if (sshListing?.canWorkHere) {
          finish(sshListing.path);
        }
      };

      dlg.onclose = () => {
        closed = true;
        if (activeResolve) {
          const r = activeResolve;
          activeResolve = null;
          r(null);
        }
      };
      dlg.onclick = event => {
        if (event.target === dlg) finish(null);
      };

      switchTab(tab);
      dlg.showModal();

      // Background refresh of discovered repos from state() in case new repos were cloned recently.
      if (api?.state) {
        void api.state().then(fresh => {
          if (closed || !Array.isArray(fresh?.workFolders)) return;
          folders = fresh.workFolders;
          renderRepos();
        }).catch(err => {
          if (!closed && !folders.length) onError(err?.message || String(err));
        });
      }
    });
  }

  return { pick };
}
