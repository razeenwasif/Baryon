export function mountVorssaintSettings(container, api) {
  if (!container) return { refresh: () => {} };

  let current = {
    connected: false,
    helperBundled: false,
    unifiedTray: false,
    iCloudNotesSync: false,
    aiLauncherFolder: '~/Github',
    hadronTodosPath: '~/Library/Application Support/dev.flux.browser/todos.json',
    hadronNotesPath: '~/Library/Application Support/dev.flux.browser/md-notes',
    keptFeatures: [],
    permissions: { accessibility: false, screenRecording: false, calendar: 'notDetermined' },
  };

  container.innerHTML = `
    <div class="vorssaint-hub">
      <div class="settings-card" style="padding:14px 16px;gap:10px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
          <div>
            <div style="font-size:13.5px;font-weight:600;color:#f4f5f8;">Vorssaint Helper Bridge</div>
            <div id="vs-hub-sub" style="font-size:12px;color:#7e8494;margin-top:2px;">Checking socket connection…</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <span id="vs-hub-bundle" class="quiet" style="font-size:11px;padding:3px 8px;border-radius:999px;background:rgba(255,255,255,.05);color:#9aa2b4;">—</span>
            <span id="vs-hub-pill" style="font-size:11px;font-weight:600;padding:4px 10px;border-radius:999px;background:rgba(255,255,255,.06);color:#9aa2b4;">Standby</span>
          </div>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;">
          <button type="button" class="quiet vs-open-mod" data-action="openSettings">Open Vorssaint Settings</button>
          <button type="button" class="quiet vs-open-mod" data-action="openModule" data-module="shortcuts">Shortcuts (⌥⌘K)</button>
          <button type="button" class="quiet vs-open-mod" data-action="openModule" data-module="tasks">Hadron Tasks (⌥⌘E)</button>
          <button type="button" class="quiet vs-open-mod" data-action="openModule" data-module="relaySweep">Relay &amp; Sweep (⌥⌘Y)</button>
          <button type="button" class="quiet vs-open-mod" data-action="openModule" data-module="aiLauncher">AI Launcher (⌥⌘U)</button>
          <button type="button" class="quiet vs-open-mod" data-action="openModule" data-module="teleprompter">Teleprompter (⌥⌘L)</button>
        </div>
      </div>

      <h4>Unified Menu Bar</h4>
      <div class="settings-card" style="padding:12px 16px;">
        <label style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0;cursor:pointer;">
          <span>
            <strong style="display:block;font-size:13px;color:#f4f5f8;font-weight:500;">Hide Vorssaint menu bar icon</strong>
            <span style="display:block;font-size:11.5px;color:#7e8494;margin-top:2px;">Use Baryon’s paired Fairy menu bar icon as your single home (Quiz ring animations stay intact).</span>
          </span>
          <input type="checkbox" id="vs-unified-tray" style="width:16px;height:16px;accent-color:#3e5aec;">
        </label>
      </div>

      <h4>Mode Presets</h4>
      <div class="settings-card" style="padding:12px 16px;">
        <div style="font-size:12px;color:#7e8494;margin-bottom:10px;">Configure Keep Awake &amp; system focus across Vorssaint in one click.</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;">
          <button type="button" class="quiet vs-preset" data-preset="meeting">Meeting (Keep Awake 90m)</button>
          <button type="button" class="quiet vs-preset" data-preset="study">Study (Keep Awake 120m)</button>
          <button type="button" class="quiet vs-preset" data-preset="work">Work (Indefinite)</button>
          <button type="button" class="quiet vs-preset" data-preset="off">Clear Preset</button>
        </div>
      </div>

      <h4>Hadron &amp; iCloud Notes Sync</h4>
      <div class="settings-card" style="padding:12px 16px;gap:10px;">
        <label style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0;cursor:pointer;">
          <span>
            <strong style="display:block;font-size:13px;color:#f4f5f8;font-weight:500;">Mirror Scratchpad &amp; Hadron Notes to iCloud Drive</strong>
            <span style="display:block;font-size:11.5px;color:#7e8494;margin-top:2px;">Two-way coordinated sync with <code>~/Library/Mobile Documents/com~apple~CloudDocs/BaryonNotes/</code>.</span>
          </span>
          <input type="checkbox" id="vs-icloud-notes" style="width:16px;height:16px;accent-color:#3e5aec;">
        </label>
        <div id="vs-paths-summary" style="font-size:11.5px;color:#7e8494;line-height:1.55;border-top:1px solid rgba(255,255,255,.06);padding-top:8px;"></div>
      </div>

      <h4>Kept FeatureCatalog &amp; Permissions</h4>
      <div class="settings-card" style="padding:12px 16px;gap:10px;">
        <div id="vs-perms-row" style="display:flex;flex-wrap:wrap;gap:6px;"></div>
        <div id="vs-features-list" style="display:flex;flex-wrap:wrap;gap:5px;"></div>
      </div>
    </div>
  `;

  const subEl = container.querySelector('#vs-hub-sub');
  const pillEl = container.querySelector('#vs-hub-pill');
  const bundleEl = container.querySelector('#vs-hub-bundle');
  const trayBox = container.querySelector('#vs-unified-tray');
  const iCloudBox = container.querySelector('#vs-icloud-notes');
  const pathsEl = container.querySelector('#vs-paths-summary');
  const permsEl = container.querySelector('#vs-perms-row');
  const featuresEl = container.querySelector('#vs-features-list');

  function render(state) {
    if (!state || typeof state !== 'object') return;
    current = { ...current, ...state };

    const connected = Boolean(current.connected);
    pillEl.textContent = connected ? 'Connected' : 'Standby';
    pillEl.style.background = connected ? 'rgba(62,90,236,0.22)' : 'rgba(255,255,255,0.06)';
    pillEl.style.color = connected ? '#8aa4ff' : '#9aa2b4';
    subEl.textContent = connected
      ? 'vorssaint.sock active · live NDJSON bridge running'
      : 'Waiting for Vorssaint sidecar (launch Vorssaint or bundled helper)';

    bundleEl.textContent = current.helperBundled ? 'Helper Bundled' : 'External App';
    bundleEl.style.color = current.helperBundled ? '#6dd5b1' : '#9aa2b4';

    trayBox.checked = Boolean(current.unifiedTray);
    iCloudBox.checked = Boolean(current.iCloudNotesSync);

    pathsEl.innerHTML = '';
    const lines = [
      ['AI Launcher CLI folder', current.aiLauncherFolder || '~/Github'],
      ['Hadron Todos', current.hadronTodosPath || '~/Library/Application Support/dev.flux.browser/todos.json'],
      ['Hadron Notes', current.hadronNotesPath || '~/Library/Application Support/dev.flux.browser/md-notes'],
    ];
    for (const [label, val] of lines) {
      const row = document.createElement('div');
      const strong = document.createElement('strong');
      strong.style.color = '#c7ccda';
      strong.textContent = `${label}: `;
      const code = document.createElement('code');
      code.textContent = String(val);
      row.append(strong, code);
      pathsEl.append(row);
    }

    const perms = current.permissions || {};
    const permItems = [
      ['Accessibility', Boolean(perms.accessibility)],
      ['Screen Recording', Boolean(perms.screenRecording)],
      [`Apple Calendar (${perms.calendar || 'optional'})`, perms.calendar === 'full'],
    ];
    permsEl.innerHTML = '';
    for (const [label, granted] of permItems) {
      const badge = document.createElement('span');
      badge.textContent = `${granted ? '✓' : '·'} ${label}`;
      badge.style.cssText = `font-size:11px;padding:3px 9px;border-radius:999px;background:${granted ? 'rgba(75,195,247,0.14)' : 'rgba(255,255,255,0.05)'};color:${granted ? '#7cd8fb' : '#8d94a6'};`;
      permsEl.append(badge);
    }

    const kept = Array.isArray(current.keptFeatures) ? current.keptFeatures : [];
    featuresEl.innerHTML = '';
    if (!kept.length) {
      const empty = document.createElement('span');
      empty.textContent = connected ? 'All Core Vorssaint features active' : 'Connect Vorssaint to inspect kept FeatureCatalog modules';
      empty.style.cssText = 'font-size:11.5px;color:#6e7382;';
      featuresEl.append(empty);
    } else {
      for (const feat of kept) {
        const chip = document.createElement('span');
        chip.textContent = String(feat);
        chip.style.cssText = 'font-size:10.5px;padding:2px 7px;border-radius:6px;background:rgba(255,255,255,0.045);border:1px solid rgba(255,255,255,0.06);color:#b7bece;';
        featuresEl.append(chip);
      }
    }
  }

  async function refresh() {
    if (!api?.vorssaintStatus) return;
    try {
      const status = await api.vorssaintStatus();
      render(status);
      if (status?.connected && api?.vorssaintAction) {
        const fresh = await api.vorssaintAction({ action: 'status' });
        render(fresh);
      }
    } catch {}
  }

  trayBox.addEventListener('change', async () => {
    if (!api?.vorssaintAction) return;
    const next = await api.vorssaintAction({ action: 'setUnifiedTray', enabled: trayBox.checked });
    render(next);
  });

  iCloudBox.addEventListener('change', async () => {
    if (!api?.vorssaintAction) return;
    const next = await api.vorssaintAction({ action: 'setICloudNotes', enabled: iCloudBox.checked });
    render(next);
  });

  for (const btn of container.querySelectorAll('.vs-open-mod')) {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      const mod = btn.dataset.module;
      void api?.vorssaintAction?.(mod ? { action, module: mod } : { action });
    });
  }

  for (const btn of container.querySelectorAll('.vs-preset')) {
    btn.addEventListener('click', () => {
      void api?.vorssaintAction?.({ action: 'applyPreset', preset: btn.dataset.preset });
    });
  }

  api?.onVorssaintFeatures?.(state => render(state));
  void refresh();

  return { refresh };
}
