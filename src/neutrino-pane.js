import { renderDiff } from './changes-pane.js';

// Neutrino tab inside the Git pane: live server/Graviton scheduler view, waiting deploy approvals,
// pull requests (inspect, diff, review notes, create, close/reopen, merge), CI runs & logs (dispatch, rerun, cancel),
// hosted repositories (clone & work, mirror now, create hosted), branch rules, Vault metadata (names only), and backups.
export function neutrinoSection({ api, el, button, card, grid, fileList, guard, relativeTime, openWork, draft, expandButton = null, openNeutrinoPage = null }) {
  let status = null, inbox = null, repos = null, view = null;
  let repoData = null, prData = null, prDiff = null, runData = null, ciLog = null, workflowsData = null, rulesData = null, vaultData = null;
  let note = '', showNewRepo = false, showNewPr = false, showDispatch = false, showDiff = false, showPrDiff = false, showMeta = false;
  let selectedJob = null;

  const resetSub = () => {
    repoData = null; prData = null; prDiff = null; runData = null; ciLog = null;
    workflowsData = null; rulesData = null; vaultData = null;
    showNewPr = false; showDispatch = false; showPrDiff = false; showMeta = false; selectedJob = null;
  };
  const openHome = () => { view = null; resetSub(); };
  const openRepo = repo => { view = { kind: 'repo', repo }; resetSub(); };
  const openPr = (repo, number) => { view = { kind: 'pr', repo, number }; prData = null; prDiff = null; showPrDiff = false; };
  const openRun = (repo, id) => { view = { kind: 'run', repo, id }; runData = null; ciLog = null; selectedJob = null; };
  const invalidate = () => { status = null; inbox = null; repos = null; resetSub(); };

  const stateChip = (state = '', label = '') => {
    const s = String(state || '').toLowerCase();
    const cls = s === 'success' || s === 'ok' || s === 'clean' || s === 'open' ? 'passing'
      : s === 'failure' || s === 'failing' || s === 'conflicts' || s === 'closed' ? 'failing'
      : s === 'waiting' || s === 'running' || s === 'queued' || s === 'pending' || s === 'merged' ? 'running' : '';
    return el('span', `git-chip ${cls}`.trim(), label || s || '—');
  };

  async function renderHome(root, context) {
    if (!status && api.neutrinoStatus) status = await guard(() => api.neutrinoStatus());
    if (!inbox && api.neutrinoInbox) inbox = await guard(() => api.neutrinoInbox());
    if (!repos && api.neutrinoRepos) repos = await guard(() => api.neutrinoRepos({ kind: 'server', limit: 120 }));
    const head = el('div', 'git-head');
    head.append(el('h2', '', 'Neutrino'));
    if (api.neutrinoCreateRepo) head.append(button('panel-button quiet git-tool', showNewRepo ? 'Cancel' : 'New repo', () => { showNewRepo = !showNewRepo; context.redraw(); }, 'Create a bare repository on the Neutrino server'));
    if (api.neutrinoBackup) head.append(button('panel-button quiet git-tool', 'Back up DB', async () => {
      if (!confirm('Take a snapshot backup of the Neutrino database now?')) return;
      const done = await guard(() => api.neutrinoBackup());
      if (done) { note = done.path ? `Snapshot saved: ${done.path}` : 'Database backup finished.'; context.redraw(); }
    }, 'Create an immediate Neutrino database backup on the server'));
    head.append(button('panel-button quiet git-tool', 'Refresh', () => { invalidate(); context.redraw(); }));
    if (openNeutrinoPage && expandButton) head.append(expandButton(() => openNeutrinoPage({ kind: 'home' }), 'Open full Neutrino page'));
    root.append(head);
    if (note) { root.append(el('p', 'page-note git-done', note)); note = ''; }

    if (showNewRepo) {
      const form = el('div', 'git-inline-form');
      const nameIn = el('input', 'git-filter'); nameIn.placeholder = 'Repository name (e.g. my-project)'; nameIn.spellcheck = false;
      const descIn = el('input', 'git-filter'); descIn.placeholder = 'Description (optional)';
      const createBtn = button('panel-button git-tool', 'Create', async () => {
        const clean = nameIn.value.trim();
        if (!clean) return;
        createBtn.disabled = true;
        const done = await guard(() => api.neutrinoCreateRepo({ name: clean, description: descIn.value.trim() }));
        createBtn.disabled = false;
        if (!done) return;
        showNewRepo = false; repos = null; status = null;
        note = `Created hosted repo ${done.id || clean}${done.cloneUrl ? ` · clone: ${done.cloneUrl}` : ''}`;
        context.redraw();
      });
      form.append(nameIn, descIn, createBtn);
      root.append(form);
    }

    if (!status && !repos) {
      root.append(el('p', 'pane-empty', 'Neutrino isn’t reachable right now. Check `neutrinod` or SSH access to your Neutrino server.'));
      return;
    }

    const cards = el('div', 'git-cards');
    const ci = status?.ci;
    cards.append(card('Server', status?.role === 'server' ? 'Local server' : inbox?.host || 'mini', status?.version ? `v${status.version} · proto ${status.protocol ?? '—'}` : 'connected'));
    cards.append(card('Graviton CI', ci?.graviton ? 'Online' : 'Offline', ci ? `${ci.used_cpus ?? 0}/${ci.budget_cpus ?? 0} CPUs · ${ci.running ?? 0} running · ${ci.queued ?? 0} queued` : 'scheduler unavailable'));
    cards.append(card('Needs you', `${(inbox?.waiting?.length || 0) + (inbox?.ready?.length || 0) + (inbox?.open?.length || 0)} items`, `${inbox?.waiting?.length || 0} deploys · ${inbox?.ready?.length || 0} ready · ${inbox?.open?.length || 0} open`));
    cards.append(card('Hosted repos', `${repos?.total ?? repos?.repos?.length ?? status?.repos ?? 0}`, status?.failingMirrors?.length ? `${status.failingMirrors.length} failing mirror${status.failingMirrors.length === 1 ? '' : 's'}` : 'all mirrors healthy'));
    root.append(cards);

    if (inbox?.waiting?.length) {
      root.append(el('h3', 'git-section', `Deploy approvals waiting (${inbox.waiting.length})`));
      const table = el('table', 'git-grid git-neutrino-wait');
      const hr = el('tr');
      for (const h of ['Repo · Job', 'Environment', 'Branch', 'Actions']) hr.append(el('th', '', h));
      const thead = el('thead'); thead.append(hr);
      const tbody = el('tbody');
      for (const w of inbox.waiting) {
        const tr = el('tr', 'git-row opens');
        const what = el('td', 'git-message');
        what.append(el('span', 'git-pr-ref', `${w.repo} · run #${w.number}`), el('span', 'git-subject', ` ${w.job_name || w.run_name}`));
        const envTd = el('td'); if (w.environment) envTd.append(stateChip('waiting', w.environment));
        const brTd = el('td', 'git-vis', w.branch || '—');
        const act = el('td', 'git-row-actions');
        act.append(button('panel-button git-tool', 'Approve', async event => {
          event.stopPropagation();
          if (!confirm(`Approve deploy job “${w.job_name}” in ${w.repo}${w.environment ? ` (${w.environment})` : ''}?`)) return;
          const res = await guard(() => api.neutrinoJobApprove({ repo: w.repo, job: w.job, approve: true }));
          if (res) { note = `Approved ${w.job_name} in ${w.repo}.`; invalidate(); context.redraw(); }
        }));
        act.append(button('panel-button quiet git-tool', 'Reject', async event => {
          event.stopPropagation();
          if (!confirm(`Reject deploy job “${w.job_name}” in ${w.repo}?`)) return;
          const res = await guard(() => api.neutrinoJobApprove({ repo: w.repo, job: w.job, approve: false }));
          if (res) { note = `Rejected ${w.job_name} in ${w.repo}.`; invalidate(); context.redraw(); }
        }));
        tr.append(what, envTd, brTd, act);
        tr.onclick = () => { openRun(w.repo, w.run); context.redraw(); };
        tbody.append(tr);
      }
      table.append(thead, tbody);
      root.append(table);
    }

    const prs = [...(inbox?.ready || []).map(p => ({ ...p, bucket: 'ready' })), ...(inbox?.open || []).map(p => ({ ...p, bucket: 'open' }))];
    if (prs.length) {
      root.append(el('h3', 'git-section', `Pull requests (${prs.length})`));
      const table = el('table', 'git-grid git-prs');
      const hr = el('tr');
      for (const h of ['', 'Pull request', 'CI', 'Status', 'Updated', '']) hr.append(el('th', '', h));
      const thead = el('thead'); thead.append(hr);
      const tbody = el('tbody');
      for (const pr of prs) {
        const tr = el('tr', 'git-row opens'); tr.tabIndex = 0;
        const dot = el('td', 'git-dot');
        if (pr.bucket === 'ready') { dot.append(el('span', 'git-new')); dot.title = 'Ready to merge'; }
        const what = el('td', 'git-message');
        what.append(el('span', 'git-pr-ref', `${pr.repo}#${pr.number}`), el('span', 'git-subject', ` ${pr.title}`), el('span', 'git-pr-by', ` · ${pr.source} → ${pr.target}`));
        const checksTd = el('td'); if (pr.checks) checksTd.append(stateChip(pr.checks, pr.checks));
        const stTd = el('td'); stTd.append(stateChip(pr.bucket === 'ready' ? 'passing' : 'open', pr.bucket === 'ready' ? 'ready' : `${pr.openNotes || 0} notes`));
        const when = el('td', 'git-when', relativeTime(pr.updatedAt || pr.updated));
        const askTd = el('td', 'git-pr-ask');
        if (draft) askTd.append(button('panel-button quiet git-tool git-ask', 'Ask Fairy', event => {
          event.stopPropagation();
          draft(`Look at Neutrino pull request ${pr.repo}#${pr.number} (“${pr.title}”): inspect its diff, notes, and CI status and tell me if it’s ready to merge.`);
        }));
        tr.append(dot, what, checksTd, stTd, when, askTd);
        const open = () => { openPr(pr.repo, pr.number); context.redraw(); };
        tr.onclick = open; tr.onkeydown = event => { if (event.key === 'Enter') open(); };
        tbody.append(tr);
      }
      table.append(thead, tbody);
      root.append(table);
    }

    if (inbox?.runs?.length) {
      root.append(el('h3', 'git-section', `Recent CI runs (${inbox.runs.length})`));
      const table = el('table', 'git-grid git-neutrino-runs');
      const hr = el('tr');
      for (const h of ['Run', 'Branch', 'State', 'When', '']) hr.append(el('th', '', h));
      const thead = el('thead'); thead.append(hr);
      const tbody = el('tbody');
      for (const r of inbox.runs.slice(0, 12)) {
        const tr = el('tr', 'git-row opens'); tr.tabIndex = 0;
        const what = el('td', 'git-message');
        what.append(el('span', 'git-pr-ref', `${r.repo} #${r.number}`), el('span', 'git-subject', ` ${r.name || r.workflow}`));
        const br = el('td', 'git-vis', r.branch || String(r.sha || '').slice(0, 7));
        const st = el('td'); st.append(stateChip(r.state, r.state));
        const when = el('td', 'git-when', relativeTime(r.finishedAt || r.startedAt || r.createdAt));
        const act = el('td', 'git-row-actions');
        if (r.state === 'failure' && draft) {
          act.append(button('panel-button quiet git-tool git-ask', 'Debug', event => {
            event.stopPropagation();
            draft(`Read the Neutrino CI log for ${r.repo} run id ${r.id} (${r.name || r.workflow} #${r.number}) and tell me why it failed.`);
          }));
        }
        tr.append(what, br, st, when, act);
        const open = () => { openRun(r.repo, r.id); context.redraw(); };
        tr.onclick = open; tr.onkeydown = event => { if (event.key === 'Enter') open(); };
        tbody.append(tr);
      }
      table.append(thead, tbody);
      root.append(table);
    }

    if (repos?.repos?.length) {
      root.append(el('h3', 'git-section', `Hosted repositories (${repos.repos.length})`));
      const table = el('table', 'git-grid git-neutrino-repos');
      const hr = el('tr');
      for (const h of ['Repository', 'Branch', 'GitHub mirror', 'Synced', '']) hr.append(el('th', '', h));
      const thead = el('thead'); thead.append(hr);
      const tbody = el('tbody');
      for (const r of repos.repos) {
        const tr = el('tr', 'git-row opens'); tr.tabIndex = 0;
        const nameTd = el('td', 'git-repo-name', r.name || r.id);
        const brTd = el('td', 'git-vis', r.branch || '—');
        const mTd = el('td');
        if (r.mirror) { mTd.append(stateChip(r.mirror.state, r.mirror.state)); if (r.mirror.lastError) mTd.title = r.mirror.lastError; }
        else mTd.textContent = '—';
        const syncTd = el('td', 'git-when', r.mirror?.lastOk ? relativeTime(r.mirror.lastOk) : '—');
        const actTd = el('td', 'git-row-actions');
        if (r.mirror && api.neutrinoMirrorNow) {
          actTd.append(button('panel-button quiet git-tool', 'Mirror now', async event => {
            event.stopPropagation();
            const res = await guard(() => api.neutrinoMirrorNow(r.id));
            if (res) { note = `Synced mirror for ${r.id}.`; repos = null; context.redraw(); }
          }));
        }
        tr.append(nameTd, brTd, mTd, syncTd, actTd);
        const open = () => { openRepo(r.id); context.redraw(); };
        tr.onclick = open; tr.onkeydown = event => { if (event.key === 'Enter') open(); };
        tbody.append(tr);
      }
      table.append(thead, tbody);
      root.append(table);
    }
  }

  async function renderRepo(root, context) {
    const repo = view.repo;
    if (!repoData) {
      const [ov, commits] = await Promise.all([
        guard(() => api.neutrinoRepo(repo)),
        guard(() => api.neutrinoCommits(repo, { limit: 40 })),
      ]);
      if (!ov) { root.append(button('page-back', '‹', () => { openHome(); context.redraw(); }, 'All Neutrino repos'), el('p', 'pane-empty', `Couldn’t load ${repo}.`)); return; }
      repoData = { ...ov, commits: commits?.commits || [], moreCommits: Boolean(commits?.more) };
    }
    const o = repoData;
    const head = el('div', 'git-head');
    head.append(button('page-back', '‹', () => { openHome(); context.redraw(); }, 'All Neutrino repos'), el('h2', '', o.name || o.id));
    if (o.mirror) head.append(stateChip(o.mirror.state, `mirror ${o.mirror.state}`));
    head.append(button('panel-button quiet git-tool', 'Refresh', () => { repoData = null; context.redraw(); }));
    if (openNeutrinoPage && expandButton) head.append(expandButton(() => openNeutrinoPage({ kind: 'repo', repo: o.id || repo }), `Open ${o.name || repo} in full Neutrino page`));
    root.append(head);
    if (note) { root.append(el('p', 'page-note git-done', note)); note = ''; }

    const acts = el('div', 'git-actions');
    if (openWork && api.neutrinoClone) {
      const cloneBtn = button('panel-button git-tool', 'Clone and work on it', async () => {
        cloneBtn.disabled = true; cloneBtn.textContent = 'Cloning…';
        const next = await guard(() => api.neutrinoClone(o.id));
        if (!cloneBtn.isConnected) return;
        cloneBtn.disabled = false; cloneBtn.textContent = 'Clone and work on it';
        if (!next) return;
        const where = next.clone?.folder;
        openHome();
        openWork(next, where ? `${next.clone.cloned ? 'Cloned into' : 'Opened your clone in'} ${where}` : '');
      });
      acts.append(cloneBtn);
    }
    if (o.mirror && api.neutrinoMirrorNow) {
      acts.append(button('panel-button quiet git-tool', 'Sync mirror now', async () => {
        const res = await guard(() => api.neutrinoMirrorNow(o.id));
        if (res) { note = `Synced ${o.id} to GitHub mirror.`; repoData = null; context.redraw(); }
      }));
    }
    if (api.neutrinoPrCreate) acts.append(button('panel-button quiet git-tool', showNewPr ? 'Cancel PR' : 'New pull request', () => { showNewPr = !showNewPr; showDispatch = false; context.redraw(); }));
    if (api.neutrinoRunStart) {
      acts.append(button('panel-button quiet git-tool', showDispatch ? 'Cancel run' : 'Run workflow', async () => {
        showDispatch = !showDispatch; showNewPr = false;
        if (showDispatch && !workflowsData) workflowsData = await guard(() => api.neutrinoWorkflows(o.id, o.branch || 'main'));
        context.redraw();
      }));
    }
    acts.append(button('panel-button quiet git-tool', showMeta ? 'Hide rules & Vault' : 'Rules & Vault', async () => {
      showMeta = !showMeta;
      if (showMeta && !rulesData) rulesData = await guard(() => api.neutrinoRules(o.id));
      if (showMeta && !vaultData) vaultData = await guard(() => api.neutrinoVault(o.id, ''));
      context.redraw();
    }));
    root.append(acts);

    if (showNewPr) {
      const form = el('div', 'git-inline-form');
      const titleIn = el('input', 'git-filter'); titleIn.placeholder = 'PR title';
      const srcIn = el('input', 'git-filter'); srcIn.placeholder = 'Source branch'; srcIn.spellcheck = false;
      const dstIn = el('input', 'git-filter'); dstIn.placeholder = 'Target branch'; dstIn.value = o.branch || 'main'; dstIn.spellcheck = false;
      const submit = button('panel-button git-tool', 'Create PR', async () => {
        const t = titleIn.value.trim(), s = srcIn.value.trim(), d = dstIn.value.trim();
        if (!t || !s || !d) return;
        if (!confirm(`Open Neutrino PR "${t}" (${s} → ${d}) in ${o.id}?`)) return;
        const created = await guard(() => api.neutrinoPrCreate({ repo: o.id, title: t, source: s, target: d }));
        if (created) { showNewPr = false; note = `Opened PR #${created.number}.`; invalidate(); openPr(o.id, created.number); context.redraw(); }
      });
      form.append(titleIn, srcIn, dstIn, submit);
      root.append(form);
    }

    if (showDispatch) {
      const form = el('div', 'git-inline-form');
      const wfSelect = el('select', 'git-filter');
      const dispatchable = (workflowsData?.workflows || []).filter(w => !w.error && w.triggers?.includes('workflow_dispatch'));
      for (const wf of dispatchable.length ? dispatchable : (workflowsData?.workflows || [])) {
        const opt = el('option', '', wf.name || wf.file); opt.value = wf.file; wfSelect.append(opt);
      }
      const wfIn = el('input', 'git-filter'); wfIn.placeholder = 'Workflow file (e.g. ci.yml)';
      if (wfSelect.options.length) wfIn.value = wfSelect.value;
      wfSelect.onchange = () => { wfIn.value = wfSelect.value; };
      const brIn = el('input', 'git-filter'); brIn.placeholder = 'Branch'; brIn.value = o.branch || 'main';
      const go = button('panel-button git-tool', 'Dispatch', async () => {
        const wf = (wfIn.value || wfSelect.value).trim(), br = brIn.value.trim();
        if (!wf || !br) return;
        if (!confirm(`Dispatch workflow ${wf} on ${br} in ${o.id}?`)) return;
        const res = await guard(() => api.neutrinoRunStart({ repo: o.id, workflow: wf, branch: br }));
        if (res) { showDispatch = false; note = `Started run #${res.number}.`; invalidate(); openRun(o.id, res.id); context.redraw(); }
      });
      form.append(...(wfSelect.options.length ? [wfSelect] : [wfIn]), brIn, go);
      root.append(form);
    }

    const cards = el('div', 'git-cards');
    cards.append(card('Default branch', o.branch || '—', `${(o.branches || []).length} branches`));
    cards.append(card('Commits', String(o.commitsCapped ? `${o.commits}+` : o.commits ?? '—'), `${o.contributors ?? 0} contributors · ${o.files ?? 0} files`));
    cards.append(card('Open PRs', `${o.openPrs?.length || 0} open`, `${o.rules?.length || 0} branch rule${o.rules?.length === 1 ? '' : 's'}`));
    cards.append(card('Mirror', o.mirror?.state || 'none', o.mirror?.url || 'not mirrored to GitHub'));
    root.append(cards);

    if (showMeta) {
      const box = el('div', 'git-meta-box');
      box.append(el('h3', 'git-section', 'Branch rules & Vault names'));
      if (rulesData?.rules?.length) {
        for (const r of rulesData.rules) {
          const flags = [r.require_pull ? 'PR required' : '', r.block_force ? 'no force push' : '', r.block_delete ? 'no delete' : '', ...(r.required_checks || []).map(c => `check:${c}`)].filter(Boolean);
          box.append(el('p', 'panel-note', `Rule ${r.pattern}: ${flags.join(' · ') || 'default'}`));
        }
      } else box.append(el('p', 'panel-note', 'No branch protection rules configured.'));
      if (vaultData?.environments?.length) box.append(el('p', 'panel-note', `Deploy environments: ${vaultData.environments.map(e => `${e.name}${e.require_approval ? ' (approval gate)' : ''}`).join(', ')}`));
      if (vaultData?.secrets?.length) box.append(el('p', 'panel-note', `Vault secrets (names only): ${vaultData.secrets.map(s => s.name).join(', ')}`));
      if (vaultData?.variables?.length) box.append(el('p', 'panel-note', `Vault variables: ${vaultData.variables.map(v => `${v.name}=${v.value}`).join(', ')}`));
      root.append(box);
    }

    if (o.allPrs?.length) {
      root.append(el('h3', 'git-section', `Pull requests (${o.allPrs.length})`));
      const table = el('table', 'git-grid git-prs');
      const hr = el('tr'); for (const h of ['', 'Pull request', 'Branch', 'State', 'Updated', '']) hr.append(el('th', '', h));
      const thead = el('thead'); thead.append(hr);
      const tbody = el('tbody');
      for (const pr of o.allPrs) {
        const tr = el('tr', 'git-row opens'); tr.tabIndex = 0;
        const what = el('td', 'git-message'); what.append(el('span', 'git-pr-ref', `#${pr.number}`), el('span', 'git-subject', ` ${pr.title}`));
        tr.append(el('td', 'git-dot'), what, el('td', 'git-vis', `${pr.source} → ${pr.target}`), el('td', '', stateChip(pr.state, pr.state)), el('td', 'git-when', relativeTime(pr.updatedAt)), el('td'));
        tr.onclick = () => { openPr(o.id, pr.number); context.redraw(); };
        tbody.append(tr);
      }
      table.append(thead, tbody);
      root.append(table);
    }

    if (o.runs?.length) {
      root.append(el('h3', 'git-section', `Recent CI runs (${o.runs.length})`));
      const table = el('table', 'git-grid git-neutrino-runs');
      const hr = el('tr'); for (const h of ['Run', 'Branch', 'State', 'When', '']) hr.append(el('th', '', h));
      const thead = el('thead'); thead.append(hr);
      const tbody = el('tbody');
      for (const r of o.runs) {
        const tr = el('tr', 'git-row opens'); tr.tabIndex = 0;
        const what = el('td', 'git-message'); what.append(el('span', 'git-pr-ref', `#${r.number}`), el('span', 'git-subject', ` ${r.name || r.workflow}`));
        const st = el('td'); st.append(stateChip(r.state, r.state));
        const act = el('td', 'git-row-actions');
        if (r.state === 'running' || r.state === 'queued' || r.state === 'waiting') {
          act.append(button('panel-button quiet git-tool', 'Cancel', async event => {
            event.stopPropagation();
            if (!confirm(`Cancel run #${r.number}?`)) return;
            const res = await guard(() => api.neutrinoRunCancel({ repo: o.id, id: r.id }));
            if (res) { note = `Cancelling run #${r.number}.`; repoData = null; context.redraw(); }
          }));
        } else {
          act.append(button('panel-button quiet git-tool', 'Rerun', async event => {
            event.stopPropagation();
            if (!confirm(`Rerun ${r.name || r.workflow} #${r.number}?`)) return;
            const res = await guard(() => api.neutrinoRunRerun({ repo: o.id, id: r.id }));
            if (res) { note = `Started rerun #${res.number}.`; repoData = null; context.redraw(); }
          }));
        }
        tr.append(what, el('td', 'git-vis', r.branch || '—'), st, el('td', 'git-when', relativeTime(r.finishedAt || r.createdAt)), act);
        tr.onclick = () => { openRun(o.id, r.id); context.redraw(); };
        tbody.append(tr);
      }
      table.append(thead, tbody);
      root.append(table);
    }

    root.append(el('h3', 'git-section', `History on ${o.branch || 'default branch'}`));
    root.append(o.commits?.length
      ? grid(o.commits, { detail: sha => api.neutrinoCommit(o.id, sha), fileDiff: (sha, file) => api.neutrinoCommitFileDiff(o.id, sha, file.path) })
      : el('p', 'panel-note', 'No commits yet.'));
  }

  async function renderPr(root, context) {
    const { repo, number } = view;
    if (!prData) prData = await guard(() => api.neutrinoPr(repo, number));
    if (!prData) { root.append(button('page-back', '‹', () => { openRepo(repo); context.redraw(); }, repo), el('p', 'pane-empty', `Couldn’t load ${repo}#${number}.`)); return; }
    const p = prData;
    const head = el('div', 'git-head');
    head.append(button('page-back', '‹', () => { openRepo(repo); context.redraw(); }, `Back to ${repo}`), el('h2', '', `${p.repo}#${p.number} · ${p.title}`));
    head.append(stateChip(p.state, p.state));
    if (openNeutrinoPage && expandButton) head.append(expandButton(() => openNeutrinoPage({ kind: 'pr', repo: p.repo, number: p.number }), `Open PR #${p.number} in full Neutrino page`));
    root.append(head);
    if (note) { root.append(el('p', 'page-note git-done', note)); note = ''; }

    root.append(el('p', 'panel-note', `${p.source} → ${p.target}${p.mergeability ? (p.mergeability.clean ? ' · merges cleanly' : ` · conflicts in ${p.mergeability.conflicts.join(', ')}`) : ''}${p.mergeability?.behind ? ` · ${p.mergeability.behind} behind ${p.target}` : ''}`));
    if (p.body) root.append(el('pre', 'git-body', p.body));

    const acts = el('div', 'git-actions');
    if (p.state === 'open') {
      const strat = el('select', 'git-filter');
      for (const s of ['merge', 'squash', 'rebase', 'fast_forward']) { const opt = el('option', '', s); opt.value = s; strat.append(opt); }
      const mergeBtn = button('panel-button git-tool', 'Merge PR', async () => {
        if (!confirm(`Merge ${p.repo}#${p.number} (${p.source} → ${p.target}) via ${strat.value}?`)) return;
        mergeBtn.disabled = true;
        const res = await guard(() => api.neutrinoPrMerge({ repo: p.repo, number: p.number, strategy: strat.value }));
        mergeBtn.disabled = false;
        if (res) { note = `Merged PR #${p.number} (${res.sha?.slice(0, 7) || strat.value}).`; invalidate(); prData = null; context.redraw(); }
      });
      acts.append(strat, mergeBtn);
      acts.append(button('panel-button quiet git-tool', 'Close PR', async () => {
        if (!confirm(`Close ${p.repo}#${p.number} without merging?`)) return;
        const res = await guard(() => api.neutrinoPrUpdate({ repo: p.repo, number: p.number, state: 'closed' }));
        if (res) { note = `Closed PR #${p.number}.`; invalidate(); prData = null; context.redraw(); }
      }));
    } else if (p.state === 'closed') {
      acts.append(button('panel-button quiet git-tool', 'Reopen PR', async () => {
        const res = await guard(() => api.neutrinoPrUpdate({ repo: p.repo, number: p.number, state: 'open' }));
        if (res) { note = `Reopened PR #${p.number}.`; invalidate(); prData = null; context.redraw(); }
      }));
    }
    acts.append(button('panel-button quiet git-tool', showPrDiff ? 'Hide diff' : 'View diff', async () => {
      showPrDiff = !showPrDiff;
      if (showPrDiff && !prDiff) prDiff = await guard(() => api.neutrinoPrDiff(p.repo, p.number, ''));
      context.redraw();
    }));
    if (draft) acts.append(button('panel-button quiet git-tool git-ask', 'Ask Fairy', () => draft(`Inspect Neutrino PR ${p.repo}#${p.number} (“${p.title}”): review its diff and notes and suggest what should be changed or whether to merge.`)));
    root.append(acts);

    if (showPrDiff && prDiff) {
      root.append(prDiff.text ? renderDiff(prDiff.text) : el('p', 'panel-note', 'No textual changes in this pull request.'));
    }
    if (p.checks?.length) {
      root.append(el('h3', 'git-section', `Checks (${p.checks.length})`));
      const row = el('div', 'git-actions');
      for (const c of p.checks) {
        const b = button('panel-button quiet git-tool', `${c.name || c.workflow}: ${c.state}`, () => { openRun(p.repo, c.id); context.redraw(); });
        row.append(b);
      }
      root.append(row);
    }
    if (p.files?.length) {
      root.append(el('h3', 'git-section', `Changed files (${p.files.length})`));
      root.append(fileList(p.files.map(f => ({ path: f.path, added: f.binary ? null : f.additions, removed: f.binary ? null : f.deletions })), async f => (await api.neutrinoPrDiff(p.repo, p.number, f.path))?.text));
    }

    root.append(el('h3', 'git-section', `Review notes (${p.notes?.length || 0})`));
    if (p.notes?.length) {
      for (const n of p.notes) {
        const box = el('div', 'git-note-row');
        const headRow = el('div', 'git-note-head');
        headRow.append(el('code', '', `${n.path}:${n.currentLine ?? n.line}`), stateChip(n.resolved ? 'success' : 'open', n.resolved ? 'resolved' : 'open'));
        headRow.append(button('panel-button quiet git-tool', n.resolved ? 'Reopen' : 'Resolve', async () => {
          const res = await guard(() => api.neutrinoPrResolveNote({ repo: p.repo, number: p.number, note: n.id, resolved: !n.resolved }));
          if (res) { prData = null; context.redraw(); }
        }));
        box.append(headRow, el('p', 'panel-note', n.text));
        root.append(box);
      }
    } else root.append(el('p', 'panel-note', 'No review notes yet.'));

    if (p.files?.length && api.neutrinoPrNote) {
      const form = el('div', 'git-inline-form');
      const fileSel = el('select', 'git-filter');
      for (const f of p.files) { const opt = el('option', '', f.path); opt.value = f.path; fileSel.append(opt); }
      const lineIn = el('input', 'git-filter git-line-num'); lineIn.type = 'number'; lineIn.min = '1'; lineIn.value = '1'; lineIn.placeholder = 'Line';
      const textIn = el('input', 'git-filter'); textIn.placeholder = 'Write a review note on this line…';
      const post = button('panel-button git-tool', 'Add note', async () => {
        const txt = textIn.value.trim(), ln = Number(lineIn.value);
        if (!txt || !ln) return;
        const res = await guard(() => api.neutrinoPrNote({ repo: p.repo, number: p.number, path: fileSel.value, side: 'new', line: ln, text: txt }));
        if (res) { textIn.value = ''; prData = null; note = 'Review note added.'; context.redraw(); }
      });
      form.append(fileSel, lineIn, textIn, post);
      root.append(form);
    }
  }

  async function renderRun(root, context) {
    const { repo, id } = view;
    if (!runData) runData = await guard(() => api.neutrinoRun(repo, id));
    if (!runData) { root.append(button('page-back', '‹', () => { openRepo(repo); context.redraw(); }, repo), el('p', 'pane-empty', `Couldn’t load CI run #${id}.`)); return; }
    const { run, jobs, warnings } = runData;
    const head = el('div', 'git-head');
    head.append(button('page-back', '‹', () => { openRepo(repo); context.redraw(); }, `Back to ${repo}`), el('h2', '', `${repo} · ${run.name || run.workflow} #${run.number}`));
    head.append(stateChip(run.state, run.state));
    if (openNeutrinoPage && expandButton) head.append(expandButton(() => openNeutrinoPage({ kind: 'run', repo, id: run.id }), `Open run #${run.number} in full Neutrino page`));
    root.append(head);
    if (note) { root.append(el('p', 'page-note git-done', note)); note = ''; }

    root.append(el('p', 'panel-note', `${run.event}${run.branch ? ` on ${run.branch}` : ''} · ${String(run.sha || '').slice(0, 7)}${run.pull ? ` · PR #${run.pull}` : ''}`));
    if (run.error) root.append(el('p', 'panel-note', `Error: ${run.error}`));
    if (warnings?.length) root.append(el('p', 'panel-note', `Warnings: ${warnings.join(' · ')}`));

    const acts = el('div', 'git-actions');
    if (['running', 'queued', 'waiting'].includes(run.state)) {
      acts.append(button('panel-button quiet git-tool', 'Cancel run', async () => {
        if (!confirm(`Cancel run #${run.number}?`)) return;
        const res = await guard(() => api.neutrinoRunCancel({ repo, id: run.id }));
        if (res) { runData = null; note = 'Cancellation requested.'; context.redraw(); }
      }));
    } else {
      acts.append(button('panel-button git-tool', 'Rerun workflow', async () => {
        if (!confirm(`Rerun ${run.name || run.workflow} #${run.number}?`)) return;
        const res = await guard(() => api.neutrinoRunRerun({ repo, id: run.id }));
        if (res) { invalidate(); openRun(repo, res.id); note = `Started rerun #${res.number}.`; context.redraw(); }
      }));
    }
    if (draft) acts.append(button('panel-button quiet git-tool git-ask', 'Ask Fairy to debug', () => draft(`Read the Neutrino CI log for ${repo} run id ${run.id} (#${run.number} ${run.name || run.workflow}) and explain what failed and how to fix it.`)));
    root.append(acts);

    if (jobs?.length) {
      root.append(el('h3', 'git-section', `Jobs (${jobs.length})`));
      for (const j of jobs) {
        const row = el('div', 'git-note-row');
        const top = el('div', 'git-note-head');
        top.append(el('strong', '', `${j.name} (${j.executor})`), stateChip(j.state, j.state));
        if (j.environment) top.append(el('span', 'git-ref', j.environment));
        top.append(button('panel-button quiet git-tool', 'View log', async () => {
          selectedJob = j.id;
          ciLog = await guard(() => api.neutrinoCiLog(repo, run.id, j.id));
          context.redraw();
        }));
        if (j.state === 'waiting') {
          top.append(button('panel-button git-tool', 'Approve deploy', async () => {
            if (!confirm(`Approve deploy job “${j.name}”${j.environment ? ` for ${j.environment}` : ''}?`)) return;
            const res = await guard(() => api.neutrinoJobApprove({ repo, job: j.id, approve: true }));
            if (res) { runData = null; invalidate(); note = `Approved ${j.name}.`; context.redraw(); }
          }));
        }
        row.append(top);
        if (j.steps?.length) row.append(el('p', 'panel-note', j.steps.map(s => `${s.name}: ${s.state}${s.exit_code != null ? ` (${s.exit_code})` : ''}`).join(' · ')));
        root.append(row);
      }
      if (!ciLog && jobs.length) {
        selectedJob = (jobs.find(j => j.state === 'failure') || jobs[0]).id;
        ciLog = await guard(() => api.neutrinoCiLog(repo, run.id, selectedJob));
      }
    }

    if (ciLog) {
      root.append(el('h3', 'git-section', `Log${ciLog.jobName ? ` — ${ciLog.jobName}` : ''}`));
      root.append(el('pre', 'git-body git-ci-log', ciLog.log || ciLog.note || '(No log output yet.)'));
    }
  }

  return {
    openRepo(repo) { openRepo(repo); },
    openPr(repo, number) { openPr(repo, number); },
    openRun(repo, id) { openRun(repo, id); },
    reset() { openHome(); },
    async render(root, context) {
      if (view?.kind === 'pr') return renderPr(root, context);
      if (view?.kind === 'run') return renderRun(root, context);
      if (view?.kind === 'repo') return renderRepo(root, context);
      return renderHome(root, context);
    },
  };
}
