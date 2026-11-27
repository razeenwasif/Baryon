import './setup-wizard.css';
import appIconUrl from '../assets/app-icon.png';
import { WALLPAPERS } from './wallpaper.js';
import { bgAnimOffFor } from './bg-animations.js';
import { providerLogo } from './provider-logos.js';
import { mountSetupBackdrop } from './setup-backdrop.js';
import {
  SETUP_STORAGE_KEY,
  SETUP_STEPS,
  SETUP_FOCUS_OPTIONS,
  SETUP_WORKSPACES,
  SETUP_INTEGRATIONS,
  SETUP_SHORTCUTS,
  SETUP_STEP_MOODS,
  WALLPAPER_MOODS,
  tailoredCaptionForFocus,
  computeSetupReadiness,
  formatStepProgress,
} from './setup-wizard-logic.js';

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

const pill = (tone, text) => el('span', `bo-pill ${tone}`, text);

function markCompleted() {
  try { localStorage.setItem(SETUP_STORAGE_KEY, 'done'); } catch {}
}

function spotlightVisualSvg(workspaceId) {
  const visuals = {
    chat: `<svg viewBox="0 0 360 110" fill="none" xmlns="http://www.w3.org/2000/svg">
      <line x1="60" y1="55" x2="180" y2="26" stroke="#18b8cc" stroke-opacity="0.58" stroke-width="1.5"/>
      <line x1="60" y1="55" x2="180" y2="84" stroke="#4ea8ff" stroke-opacity="0.58" stroke-width="1.5"/>
      <line x1="180" y1="26" x2="300" y2="55" stroke="#5ee6c8" stroke-opacity="0.58" stroke-width="1.5"/>
      <line x1="180" y1="84" x2="300" y2="55" stroke="#5ee6c8" stroke-opacity="0.58" stroke-width="1.5"/>
      <circle cx="60" cy="55" r="14" fill="#09232c" stroke="#4ad4e8" stroke-width="1.5"/>
      <circle cx="180" cy="26" r="13" fill="#0b2438" stroke="#4ea8ff" stroke-width="1.5"/>
      <circle cx="180" cy="84" r="13" fill="#0b2438" stroke="#4ea8ff" stroke-width="1.5"/>
      <circle cx="300" cy="55" r="15" fill="#092b24" stroke="#5ee6c8" stroke-width="1.5"/>
      <text x="60" y="59" text-anchor="middle" fill="#eaf9ff" font-size="9" font-family="Inter,sans-serif">Plan</text>
      <text x="180" y="30" text-anchor="middle" fill="#eaf9ff" font-size="8.5" font-family="Inter,sans-serif">Swarm 1</text>
      <text x="180" y="88" text-anchor="middle" fill="#eaf9ff" font-size="8.5" font-family="Inter,sans-serif">Swarm 2</text>
      <text x="300" y="59" text-anchor="middle" fill="#dcfff4" font-size="9" font-family="Inter,sans-serif">Merge</text>
    </svg>`,
    notebooks: `<svg viewBox="0 0 360 110" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="26" y="18" width="94" height="74" rx="10" fill="rgba(10,20,28,0.88)" stroke="rgba(64,208,232,0.42)"/>
      <rect x="133" y="18" width="94" height="74" rx="10" fill="rgba(10,20,28,0.88)" stroke="rgba(78,168,255,0.45)"/>
      <rect x="240" y="18" width="94" height="74" rx="10" fill="rgba(10,20,28,0.88)" stroke="rgba(94,230,200,0.42)"/>
      <rect x="38" y="32" width="54" height="6" rx="3" fill="#4ad4e8" fill-opacity="0.85"/>
      <rect x="38" y="46" width="70" height="4" rx="2" fill="#ffffff" fill-opacity="0.24"/>
      <rect x="38" y="56" width="60" height="4" rx="2" fill="#ffffff" fill-opacity="0.16"/>
      <rect x="145" y="32" width="58" height="6" rx="3" fill="#4ea8ff" fill-opacity="0.85"/>
      <rect x="145" y="46" width="68" height="4" rx="2" fill="#ffffff" fill-opacity="0.24"/>
      <rect x="252" y="32" width="52" height="6" rx="3" fill="#5ee6c8" fill-opacity="0.85"/>
      <rect x="252" y="46" width="66" height="4" rx="2" fill="#ffffff" fill-opacity="0.24"/>
    </svg>`,
    research: `<svg viewBox="0 0 360 110" fill="none" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="180" cy="55" rx="115" ry="34" stroke="rgba(64,208,232,0.34)" stroke-width="1.2"/>
      <ellipse cx="180" cy="55" rx="64" ry="20" stroke="rgba(94,230,200,0.45)" stroke-width="1.2"/>
      <circle cx="180" cy="55" r="16" fill="#0b2e3a" stroke="#5ee6f8" stroke-width="1.5"/>
      <circle cx="88" cy="36" r="8" fill="#0c2638" stroke="#4ea8ff"/>
      <circle cx="272" cy="74" r="8" fill="#0b2e38" stroke="#4ad4e8"/>
      <circle cx="242" cy="27" r="7" fill="#0b2e26" stroke="#5ee6c8"/>
      <text x="180" y="59" text-anchor="middle" fill="#fff" font-size="9" font-family="Inter,sans-serif">Elo</text>
    </svg>`,
    analytics: `<svg viewBox="0 0 360 110" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M24 88 C75 84, 110 38, 165 44 C215 50, 250 18, 336 22" stroke="#38d4e8" stroke-width="2.5" stroke-linecap="round"/>
      <path d="M24 94 C95 76, 145 72, 195 58 C255 42, 285 48, 336 30" stroke="#5ee6c8" stroke-opacity="0.65" stroke-width="1.5" stroke-dasharray="4 4"/>
      <circle cx="165" cy="44" r="4.5" fill="#5ee6f8"/>
      <circle cx="255" cy="30" r="4.5" fill="#5ee6c8"/>
      <circle cx="336" cy="22" r="5" fill="#fff"/>
    </svg>`,
    boards: `<svg viewBox="0 0 360 110" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="42" y="24" width="76" height="44" rx="8" fill="rgba(24,148,180,0.28)" stroke="#4ad4e8"/>
      <rect x="228" y="20" width="84" height="46" rx="8" fill="rgba(40,120,210,0.28)" stroke="#5ea8ff"/>
      <rect x="142" y="64" width="82" height="30" rx="8" fill="rgba(34,160,130,0.26)" stroke="#5ee6c8"/>
      <path d="M118 46 C158 46, 158 42, 228 42" stroke="#6ce2f2" stroke-width="1.4" stroke-dasharray="3 3"/>
      <path d="M270 66 L195 64" stroke="#5ee6c8" stroke-width="1.4"/>
    </svg>`,
    goals: `<svg viewBox="0 0 360 110" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M180 96 C150 66, 95 52, 54 24" stroke="#189ec0" stroke-width="2" stroke-opacity="0.68"/>
      <path d="M180 96 C165 62, 130 38, 108 18" stroke="#36c2de" stroke-width="2" stroke-opacity="0.78"/>
      <path d="M180 96 C180 62, 180 34, 180 14" stroke="#76eef8" stroke-width="2.4" stroke-opacity="0.92"/>
      <path d="M180 96 C195 62, 230 38, 252 18" stroke="#36c2de" stroke-width="2" stroke-opacity="0.78"/>
      <path d="M180 96 C210 66, 265 52, 306 24" stroke="#189ec0" stroke-width="2" stroke-opacity="0.68"/>
      <circle cx="180" cy="94" r="6" fill="#76eef8"/>
    </svg>`,
    neutrino: `<svg viewBox="0 0 360 110" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="44" y="20" width="272" height="22" rx="6" fill="rgba(94,230,200,0.12)" stroke="rgba(94,230,200,0.38)"/>
      <rect x="44" y="48" width="272" height="22" rx="6" fill="rgba(64,208,232,0.12)" stroke="rgba(64,208,232,0.38)"/>
      <rect x="44" y="76" width="272" height="18" rx="6" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.12)"/>
      <circle cx="60" cy="31" r="4" fill="#5ee6c8"/>
      <circle cx="60" cy="59" r="4" fill="#4ad4e8"/>
      <text x="74" y="34" fill="#dcfff4" font-size="10" font-family="ui-monospace,monospace">PR #142 · CI Passed · Merge Ready</text>
      <text x="74" y="62" fill="#dff8ff" font-size="10" font-family="ui-monospace,monospace">git checkpoint · refs/fairy/checkpoints/turn-19</text>
    </svg>`,
    runs: `<svg viewBox="0 0 360 110" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="34" y="24" width="120" height="14" rx="7" fill="#1898c0"/>
      <rect x="96" y="48" width="150" height="14" rx="7" fill="#38d4e8"/>
      <rect x="190" y="72" width="136" height="14" rx="7" fill="#5ee6c8"/>
    </svg>`,
    pages: `<svg viewBox="0 0 360 110" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="52" y="18" width="112" height="74" rx="10" fill="rgba(10,18,28,0.88)" stroke="rgba(78,168,255,0.38)"/>
      <rect x="180" y="18" width="128" height="74" rx="10" fill="rgba(10,24,34,0.88)" stroke="rgba(64,208,232,0.44)"/>
      <rect x="196" y="32" width="56" height="10" rx="4" fill="#4ad4e8" fill-opacity="0.55"/>
      <rect x="196" y="50" width="94" height="28" rx="6" fill="#1b74d8" fill-opacity="0.35"/>
    </svg>`,
    usage: `<svg viewBox="0 0 360 110" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="54" y="58" width="24" height="34" rx="4" fill="#1c78c8" fill-opacity="0.72"/>
      <rect x="96" y="42" width="24" height="50" rx="4" fill="#249ce0" fill-opacity="0.82"/>
      <rect x="138" y="30" width="24" height="62" rx="4" fill="#38cce6" fill-opacity="0.9"/>
      <rect x="180" y="48" width="24" height="44" rx="4" fill="#4ad4e8" fill-opacity="0.82"/>
      <rect x="222" y="22" width="24" height="70" rx="4" fill="#5ee6c8" fill-opacity="0.9"/>
      <rect x="264" y="38" width="24" height="54" rx="4" fill="#6ee0ff" fill-opacity="0.82"/>
    </svg>`,
  };
  return visuals[workspaceId] || visuals.chat;
}

/**
 * Create the full-window Baryon Setup & Feature Guide experience.
 * Probing live status lazily when opened and cleanly destroying its WebGL loop on close.
 */
export function createSetupWizard({
  api = null,
  parent = document.body,
  getState = () => ({}),
  onStateChange = () => {},
  openSettings = () => {},
  jumpTo = () => {},
  toggleCompanion = () => {},
  toggleAnimations = () => {},
  startChat = () => {},
  startWork = () => {},
  onError = () => {},
} = {}) {
  let dialog = null;
  let backdrop = null;
  let stepIndex = 0;
  let activeSpotId = 'chat';
  const selectedFocus = new Set(['engineering']);
  const visited = new Set(['welcome']);
  let statusMessage = '';
  let probe = { loading: false };
  const draft = { dirty: false, userName: '', name: '', startAtLogin: 'off', homeToday: 'on' };

  function syncDraftFromState() {
    const settings = getState()?.settings || {};
    draft.userName = String(settings.userName ?? '');
    draft.name = String(settings.name ?? 'Fairy');
    draft.startAtLogin = settings.startAtLogin === 'on' ? 'on' : 'off';
    draft.homeToday = settings.homeToday === 'off' ? 'off' : 'on';
    draft.dirty = false;
  }

  async function saveDraftIfDirty({ silent = false } = {}) {
    if (!draft.dirty || !api?.saveSettings) return true;
    const state = getState();
    const current = state?.settings || {};
    const patch = {
      ...current,
      userName: draft.userName.trim(),
      name: draft.name.trim() || 'Fairy',
      startAtLogin: state?.remote ? current.startAtLogin : draft.startAtLogin,
      homeToday: draft.homeToday,
    };
    try {
      const next = await api.saveSettings(patch);
      onStateChange(next);
      draft.dirty = false;
      if (!silent) statusMessage = 'Saved companion preferences.';
      return true;
    } catch (err) {
      statusMessage = `Couldn’t save preferences: ${err.message}`;
      return false;
    }
  }

  async function refreshStatuses() {
    const state = getState();
    probe = {
      ...probe,
      loading: true,
      claude: state.claude || null,
      antigravity: state.antigravity || null,
      codex: state.subscription || null,
      hasOpenAIKey: Boolean(state.hasOpenAIKey),
      hasDeepSeekKey: Boolean(state.hasDeepSeekKey),
      hasFishKey: Boolean(state.hasFishKey),
      hasGeminiKey: Boolean(state.hasGeminiKey),
      settings: state.settings || {},
      remote: Boolean(state.remote),
    };
    render();
    if (!api) {
      probe.loading = false;
      render();
      return;
    }
    const calls = {
      claude: api.claudeStatus?.(),
      antigravity: api.antigravityStatus?.(),
      codex: api.subscriptionStatus?.(false),
      googleAccount: api.googleAccountStatus?.(),
      calendar: api.calendarStatus?.(),
      gmail: api.gmailStatus?.(),
      drive: api.driveStatus?.(),
      phoneLink: api.phoneLinkState?.(),
      push: api.pushState?.(),
      checkIns: api.checkInsState?.(),
      neutrino: api.neutrinoStatus?.(),
    };
    const entries = await Promise.all(
      Object.entries(calls).map(async ([key, promise]) => {
        if (!promise) return [key, null];
        try { return [key, await promise]; }
        catch { return [key, null]; }
      }),
    );
    const fresh = getState();
    probe = {
      ...Object.fromEntries(entries),
      loading: false,
      hasOpenAIKey: Boolean(fresh.hasOpenAIKey),
      hasDeepSeekKey: Boolean(fresh.hasDeepSeekKey),
      hasFishKey: Boolean(fresh.hasFishKey),
      hasGeminiKey: Boolean(fresh.hasGeminiKey),
      settings: fresh.settings || {},
      remote: Boolean(fresh.remote),
    };
    render();
  }

  function makeBtn(label, handler, cls = 'bo-btn') {
    const btn = el('button', cls, label);
    btn.type = 'button';
    btn.onclick = handler;
    return btn;
  }

  function attachTileSheen(tile) {
    tile.addEventListener('pointermove', e => {
      const rect = tile.getBoundingClientRect();
      tile.style.setProperty('--mx', `${e.clientX - rect.left}px`);
      tile.style.setProperty('--my', `${e.clientY - rect.top}px`);
    });
    return tile;
  }

  function goToStep(idx) {
    stepIndex = Math.min(SETUP_STEPS.length - 1, Math.max(0, idx));
    visited.add(SETUP_STEPS[stepIndex].id);
    statusMessage = '';
    render();
  }

  function stepById(id) {
    const idx = SETUP_STEPS.findIndex(s => s.id === id);
    if (idx >= 0) goToStep(idx);
  }

  async function runAction(fn) {
    try {
      await fn();
      await refreshStatuses();
    } catch (err) {
      statusMessage = err?.message || 'Action failed.';
      onError(statusMessage);
      render();
    }
  }

  async function leaveWithDissolve(afterClose) {
    markCompleted();
    await saveDraftIfDirty({ silent: true });
    backdrop?.triggerBurst();
    if (dialog) dialog.classList.add('is-leaving');
    setTimeout(() => {
      closeImmediate();
      afterClose?.();
    }, 340);
  }

  function renderWelcomeStep() {
    const frag = document.createDocumentFragment();
    const state = getState();
    const card = el('div', 'bo-welcome-card bo-rise bo-d3');

    const group = el('div', 'bo-field-group');
    const lbl = el('label', 'bo-field-label', 'Your name');
    lbl.htmlFor = 'bo-user-name-input';
    const nameInput = document.createElement('input');
    nameInput.id = 'bo-user-name-input';
    nameInput.className = 'bo-field-input';
    nameInput.maxLength = 60;
    nameInput.placeholder = 'What should Fairy call you?';
    nameInput.value = draft.userName;
    nameInput.autocomplete = 'off';
    nameInput.oninput = () => { draft.userName = nameInput.value; draft.dirty = true; };
    nameInput.onkeydown = e => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        void saveDraftIfDirty({ silent: true }).then(() => goToStep(1));
      }
    };
    group.append(lbl, nameInput);

    const divider = el('div', 'bo-field-divider');
    const footerRow = el('div', 'bo-field-footer');

    const compWrap = el('div', 'bo-inline-field');
    const compLabel = el('label', 'bo-inline-label', 'Companion');
    compLabel.htmlFor = 'bo-companion-name-input';
    const compInput = document.createElement('input');
    compInput.id = 'bo-companion-name-input';
    compInput.className = 'bo-inline-input';
    compInput.maxLength = 40;
    compInput.value = draft.name;
    compInput.placeholder = 'Fairy';
    compInput.autocomplete = 'off';
    compInput.oninput = () => { draft.name = compInput.value; draft.dirty = true; };
    compWrap.append(compLabel, compInput);
    footerRow.append(compWrap);

    if (!state.remote) {
      const switchBtn = document.createElement('button');
      switchBtn.type = 'button';
      switchBtn.className = 'bo-switch';
      switchBtn.setAttribute('role', 'switch');
      const syncSwitch = () => {
        const isOn = draft.startAtLogin === 'on';
        switchBtn.setAttribute('aria-checked', String(isOn));
      };
      syncSwitch();
      const swText = el('span', 'bo-switch-label', 'Launch at login');
      const swTrack = el('span', 'bo-switch-track');
      swTrack.append(el('span', 'bo-switch-thumb'));
      switchBtn.append(swText, swTrack);
      switchBtn.onclick = () => {
        draft.startAtLogin = draft.startAtLogin === 'on' ? 'off' : 'on';
        draft.dirty = true;
        syncSwitch();
      };
      footerRow.append(switchBtn);
    }

    card.append(group, divider, footerRow);
    frag.append(
      card,
      el('p', 'bo-caption bo-rise bo-d4', 'Baryon preserves your existing dev.razeen.lyra Keychain, chats, and notebooks across desktop, CLI, and iPhone.'),
    );
    return frag;
  }

  function renderFocusStep() {
    const frag = document.createDocumentFragment();
    const grid = el('div', 'bo-grid-3x2 bo-rise bo-d3');
    for (const opt of SETUP_FOCUS_OPTIONS) {
      const on = selectedFocus.has(opt.id);
      const tile = attachTileSheen(el('button', `bo-tile${on ? ' is-selected' : ''}`));
      tile.type = 'button';
      tile.setAttribute('aria-pressed', String(on));
      const checkWrap = el('span', 'bo-tile-check');
      checkWrap.setAttribute('aria-hidden', 'true');
      checkWrap.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M3.2 8.4L6.5 11.6L12.8 4.8"/></svg>';
      tile.append(el('span', 'bo-tile-label', opt.label), checkWrap);
      tile.onclick = () => {
        if (selectedFocus.has(opt.id)) selectedFocus.delete(opt.id);
        else selectedFocus.add(opt.id);
        activeSpotId = opt.workspaceId;
        render();
      };
      grid.append(tile);
    }
    frag.append(grid, el('p', 'bo-caption bo-rise bo-d4', tailoredCaptionForFocus([...selectedFocus])));
    return frag;
  }

  function providerBadge(family) {
    const wrap = el('span', 'bo-row-logo');
    const svg = providerLogo(family);
    if (svg) wrap.append(svg);
    else wrap.textContent = family.slice(0, 1).toUpperCase();
    return wrap;
  }

  function renderProvidersStep() {
    const frag = document.createDocumentFragment();
    const state = getState();
    const card = el('section', 'bo-card bo-rise bo-d3');

    const claudeOk = Boolean(probe.claude?.connected);
    const agyOk = Boolean(probe.antigravity?.connected);
    const codexOk = Boolean(probe.codex?.connected || probe.codex?.signedIn || probe.codex?.ready);
    const keysOk = Boolean(probe.hasDeepSeekKey || probe.hasOpenAIKey || probe.hasGeminiKey);

    const rows = [
      { family: 'claude', title: 'Claude Code', sub: claudeOk ? `Connected (${probe.claude?.plan || 'subscription'}) · Fable/Opus/Sonnet & Orchestrator` : (probe.claude?.error || 'Sign in via `claude auth login` or Settings'), tone: claudeOk ? 'ok' : 'warn', badge: claudeOk ? 'Connected' : 'Not signed in' },
      { family: 'antigravity', title: 'Gemini · Antigravity (agy)', sub: agyOk ? `Connected · ${probe.antigravity?.models?.length || 0} models · in-app account switcher` : (probe.antigravity?.error || 'Sign into Antigravity CLI to unlock Gemini models'), tone: agyOk ? 'ok' : 'warn', badge: agyOk ? 'Connected' : 'Needs sign-in' },
      { family: 'codex', title: 'ChatGPT · Codex', sub: codexOk ? 'Connected · Powers Codex work turns, quizzes & usage gauges' : (probe.codex?.error || 'Sign in with ChatGPT from Accounts & keys'), tone: codexOk ? 'ok' : 'warn', badge: codexOk ? 'Connected' : 'Optional' },
      { family: 'deepseek', title: 'API Keys (DeepSeek / OpenAI / Gemini Decisions)', sub: `DeepSeek: ${probe.hasDeepSeekKey ? 'saved' : 'not set'} · OpenAI: ${probe.hasOpenAIKey ? 'saved' : 'not set'} · Gemini Decisions: ${probe.hasGeminiKey ? 'saved' : 'not set'}`, tone: keysOk ? 'ok' : 'muted', badge: keysOk ? 'Configured' : 'Optional' },
    ];

    for (const item of rows) {
      const row = el('div', 'bo-row');
      const left = el('div', 'bo-row-left');
      const txt = el('div', 'bo-row-text');
      txt.append(el('strong', '', item.title), el('span', '', item.sub));
      left.append(providerBadge(item.family), txt);
      row.append(left, pill(item.tone, item.badge));
      card.append(row);
    }

    const actions = el('div', 'bo-actions bo-rise bo-d4');
    actions.append(makeBtn(probe.loading ? 'Refreshing…' : 'Refresh status', () => void refreshStatuses()));
    if (api?.antigravitySwitchAccount && !state.remote) {
      actions.append(makeBtn('Switch Antigravity account', () => void runAction(async () => {
        statusMessage = 'Launching Antigravity switcher in Terminal…';
        render();
        await api.antigravitySwitchAccount();
        statusMessage = 'Antigravity account refreshed.';
      })));
    }
    if (api?.subscriptionLogin && !state.remote) {
      actions.append(makeBtn('Sign into Codex', () => void runAction(async () => {
        await api.subscriptionLogin();
        statusMessage = 'Finish signing in via browser, then click Refresh status.';
      })));
    }
    actions.append(
      makeBtn('Accounts & keys ↗', () => { closeImmediate(); openSettings('accounts'); }),
      makeBtn('Usage (⌘⇧U) ↗', () => { closeImmediate(); jumpTo('usage'); }),
    );
    frag.append(card, actions);
    return frag;
  }

  function renderIntegrationsStep() {
    const frag = document.createDocumentFragment();
    const card = el('section', 'bo-card bo-rise bo-d3');
    const gOk = Boolean(probe.googleAccount?.connected);
    const ntrOk = Boolean(probe.neutrino?.connected || probe.neutrino?.reachable);

    const gRow = el('div', 'bo-row');
    const gTxt = el('div', 'bo-row-text');
    gTxt.append(
      el('strong', '', 'Unified Google Account Hub'),
      el('span', '', gOk
        ? `Connected${probe.googleAccount?.email ? ` as ${probe.googleAccount.email}` : ''} · Calendar, Gmail & Drive synced together`
        : 'Sign in once for Calendar, Gmail, and Google Drive/Docs/Sheets/Slides.'),
    );
    gRow.append(el('div', 'bo-row-left'), pill(gOk ? 'ok' : 'warn', gOk ? 'Connected' : 'Not signed in'));
    gRow.firstChild.append(providerBadge('google'), gTxt);

    const nRow = el('div', 'bo-row');
    const nTxt = el('div', 'bo-row-text');
    nTxt.append(
      el('strong', '', 'Google-SSO MCP Quick-Connect & Neutrino'),
      el('span', '', '1-click attach for Notion, Linear, Slack, Figma, Firebase, Vercel & Sentry + 25 Neutrino repo/PR/CI tools.'),
    );
    nRow.append(el('div', 'bo-row-left'), pill(ntrOk ? 'ok' : 'info', ntrOk ? 'Neutrino Ready' : 'Plugins Gallery'));
    nRow.firstChild.append(providerBadge('acp'), nTxt);
    card.append(gRow, nRow);

    const grid = el('div', 'bo-grid-2 bo-rise bo-d4');
    for (const item of SETUP_INTEGRATIONS) {
      const box = attachTileSheen(el('div', 'bo-tile'));
      box.style.flexDirection = 'column';
      box.style.alignItems = 'flex-start';
      box.style.gap = '4px';
      box.append(el('strong', '', item.title), el('span', 'bo-muted', item.body));
      grid.append(box);
    }

    const actions = el('div', 'bo-actions bo-rise bo-d4');
    if (api?.googleAccountConnect && !getState().remote) {
      actions.append(makeBtn(gOk ? 'Switch Google Account' : 'Connect Google Account', () => void runAction(async () => {
        statusMessage = 'Opening Google OAuth sign-in in your browser…';
        render();
        await api.googleAccountConnect({ writeAccess: true });
        statusMessage = 'Google Account connected across Calendar, Gmail & Drive.';
      })));
    }
    actions.append(
      makeBtn('Open Plugins Gallery ↗', () => { closeImmediate(); jumpTo('plugins'); }),
      makeBtn('Settings → Integrations ↗', () => { closeImmediate(); openSettings('integrations'); }),
    );
    frag.append(card, grid, actions);
    return frag;
  }

  function renderWorkspacesStep() {
    const frag = document.createDocumentFragment();
    const spot = SETUP_WORKSPACES.find(w => w.id === activeSpotId) || SETUP_WORKSPACES[0];
    const layout = el('div', 'bo-spotlight bo-rise bo-d3');

    const list = el('div', 'bo-spot-list');
    for (const ws of SETUP_WORKSPACES) {
      const tab = el('button', `bo-spot-tab${ws.id === spot.id ? ' is-active' : ''}`);
      tab.type = 'button';
      tab.append(el('span', '', ws.name), el('span', '', ws.badge));
      tab.onclick = () => { activeSpotId = ws.id; render(); };
      list.append(tab);
    }

    const stage = el('div', 'bo-spot-stage');
    const visual = el('div', 'bo-spot-visual');
    visual.innerHTML = spotlightVisualSvg(spot.id);
    const meta = el('div', 'bo-spot-meta');
    meta.append(el('h3', '', spot.name), el('span', 'bo-pill info', spot.shortcut));
    const foot = el('div', 'bo-actions');
    foot.style.justifyContent = 'space-between';
    foot.append(
      el('span', 'bo-muted', 'Side panes also stack via ⌘-click on right rail.'),
      makeBtn(`Open ${spot.name} ↗`, () => void leaveWithDissolve(() => {
        if (spot.id === 'chat') startWork();
        else jumpTo(spot.id);
      })),
    );
    stage.append(visual, meta, el('p', 'bo-spot-desc', spot.desc), foot);
    layout.append(list, stage);
    frag.append(layout);
    return frag;
  }

  function renderSensesStep() {
    const frag = document.createDocumentFragment();
    const settings = getState().settings || {};
    const card = el('section', 'bo-card bo-rise bo-d3');
    const items = [
      { title: 'Screen & System Audio Recording', sub: 'Enables Quiz Hints (⌘⇧H), Screen Questions, Meeting transcription & Explain-anything Screen Ink.', btn: 'Screen Access ↗', fn: () => api?.screenSettings?.() },
      { title: 'Microphone & Speech Engine', sub: `Hands-free "Hey Fairy" (⌘⇧M) with Apple on-device Speech, Fish Audio, or OpenAI · Locale: ${settings.localLanguage || 'en-AU'}.`, btn: 'Voice Settings ↗', fn: () => { closeImmediate(); openSettings('voice'); } },
      { title: 'Floating Companion, Screen Ink & Quick Keys', sub: 'Float above all apps (⌘⇧S), draw live math plots beside reading, or hold ⌃⌥ / tap ⌥⌘ / drag ⌃⌥A anywhere.', btn: 'Toggle Companion', fn: () => { closeImmediate(); toggleCompanion(); } },
    ];
    for (const item of items) {
      const row = el('div', 'bo-row');
      const txt = el('div', 'bo-row-text');
      txt.append(el('strong', '', item.title), el('span', '', item.sub));
      row.append(txt, makeBtn(item.btn, () => void item.fn()));
      card.append(row);
    }
    frag.append(card);
    return frag;
  }

  function renderAppearanceStep() {
    const frag = document.createDocumentFragment();
    const settings = getState().settings || {};
    const selected = settings.windowWallpaper || 'aurora';

    const grid = el('div', 'bo-wp-grid bo-rise bo-d3');
    for (const [id, wp] of Object.entries(WALLPAPERS)) {
      const card = el('button', `bo-wp-card${selected === id ? ' is-selected' : ''}`);
      card.type = 'button';
      const sw = el('div', 'bo-wp-swatch');
      sw.style.backgroundImage = `url('${wp.thumb || wp.src}')`;
      card.append(sw, el('strong', '', wp.name));
      card.onclick = () => void runAction(async () => {
        backdrop?.setMood(WALLPAPER_MOODS[id] || SETUP_STEP_MOODS.appearance);
        if (!api?.setWallpaper) return;
        const next = await api.setWallpaper(id);
        onStateChange(next);
        statusMessage = `Wallpaper preview applied: ${wp.name}.`;
      });
      grid.append(card);
    }
    const plain = el('button', `bo-wp-card${selected === 'none' ? ' is-selected' : ''}`);
    plain.type = 'button';
    const plainSw = el('div', 'bo-wp-swatch');
    plainSw.style.background = '#050507';
    plain.append(plainSw, el('strong', '', 'Plain Black'));
    plain.onclick = () => void runAction(async () => {
      backdrop?.setMood(WALLPAPER_MOODS.none);
      if (!api?.setWallpaper) return;
      const next = await api.setWallpaper('none');
      onStateChange(next);
      statusMessage = 'Wallpaper preview applied: Plain Black.';
    });
    grid.append(plain);

    const animOff = bgAnimOffFor('home');
    const bar = el('div', 'bo-actions bo-rise bo-d4');
    bar.append(
      makeBtn(animOff ? 'Background Animations: Off' : 'Background Animations: On', () => {
        toggleAnimations();
        statusMessage = bgAnimOffFor('home') ? 'Background animations turned off.' : 'Background animations turned on.';
        render();
      }),
      makeBtn(draft.homeToday === 'on' ? 'Home Today Pill: On' : 'Home Today Pill: Off', () => {
        draft.homeToday = draft.homeToday === 'on' ? 'off' : 'on';
        draft.dirty = true;
        void saveDraftIfDirty().then(render);
      }),
      makeBtn('Open Appearance Settings ↗', () => { closeImmediate(); openSettings('appearance'); }),
    );
    frag.append(grid, bar, el('p', 'bo-caption bo-rise bo-d4', 'Notice the live horizon glow shift as you switch wallpapers. Hold ⌘Q (1.2s) protects open windows from accidental quits.'));
    return frag;
  }

  function renderEcosystemStep() {
    const frag = document.createDocumentFragment();
    const state = getState();
    const phoneCount = probe.phoneLink?.phones?.length || 0;
    const briefOn = Boolean(probe.checkIns?.morningBrief);

    const card = el('section', 'bo-card bo-rise bo-d3');
    const pRow = el('div', 'bo-row');
    const pTxt = el('div', 'bo-row-text');
    pTxt.append(
      el('strong', '', 'Baryon on iPhone · Pure #050507 Stratus'),
      el('span', '', phoneCount
        ? `${phoneCount} paired iPhone(s) · Usage, Chat model/effort + thoughts, Goals, Neutrino PRs, Research, Analytics & Boards`
        : 'Pair over Tailscale with pinned TLS & Face ID approvals, encrypted APNs pushes & Morning Brief fallback.'),
    );
    pRow.append(pTxt, pill(phoneCount || briefOn ? 'ok' : 'muted', phoneCount ? `${phoneCount} paired` : briefOn ? 'Briefs on' : 'Ready to pair'));
    card.append(pRow);

    const cliGrid = el('div', 'bo-cli-grid bo-rise bo-d4');
    for (const [cmd, hint] of [
      ['fairy', 'Interactive REPL + Sprite'],
      ['fairy run "Check git status"', 'One-shot work session'],
      ['fairy --headless "Run tests"', 'Standalone headless CLI'],
      ['fairy-mcp', 'Read-only MCP stdio server'],
    ]) {
      const chip = el('button', 'bo-cli-chip');
      chip.type = 'button';
      chip.append(el('code', '', cmd), el('span', '', hint));
      chip.onclick = async () => {
        try { await navigator.clipboard?.writeText(cmd); statusMessage = `Copied \`${cmd}\``; }
        catch { statusMessage = `Run \`${cmd}\` in Terminal.`; }
        render();
      };
      cliGrid.append(chip);
    }

    const actions = el('div', 'bo-actions bo-rise bo-d4');
    if (!state.remote) actions.append(makeBtn('Phone & Push Settings ↗', () => { closeImmediate(); openSettings('phone'); }));
    actions.append(makeBtn('Two-Mac Settings ↗', () => { closeImmediate(); openSettings('app'); }));
    frag.append(card, cliGrid, actions);
    return frag;
  }

  function renderReadyStep() {
    const frag = document.createDocumentFragment();
    const { items, readyCount, totalCount } = computeSetupReadiness(probe);

    const card = el('section', 'bo-card bo-rise bo-d3');
    const top = el('div', 'bo-spot-meta');
    top.append(el('h3', '', 'Live Readiness'), pill(readyCount >= 3 ? 'ok' : 'warn', `${readyCount} / ${totalCount} ready`));
    card.append(top);
    for (const item of items) {
      const row = el('div', 'bo-row');
      const txt = el('div', 'bo-row-text');
      txt.append(el('strong', '', item.label), el('span', '', item.detail));
      const right = el('div', 'bo-actions');
      right.append(pill(item.ready ? 'ok' : 'muted', item.ready ? 'Ready' : 'Optional'));
      if (!item.ready) right.append(makeBtn('Fix →', () => stepById(item.stepId)));
      row.append(txt, right);
      card.append(row);
    }

    const kbdGrid = el('div', 'bo-kbd-grid bo-rise bo-d4');
    for (const s of SETUP_SHORTCUTS) {
      const cell = el('div', 'bo-kbd-item');
      cell.append(el('span', '', s.action), el('kbd', '', s.keys));
      kbdGrid.append(cell);
    }

    const quick = el('div', 'bo-actions bo-rise bo-d4');
    quick.append(
      makeBtn('Open Work Session', () => void leaveWithDissolve(() => startWork())),
      makeBtn('Open Analytics', () => void leaveWithDissolve(() => jumpTo('analytics'))),
      makeBtn('Open Notebooks', () => void leaveWithDissolve(() => jumpTo('notebooks'))),
      makeBtn('Open Settings', () => { closeImmediate(); openSettings(); }),
    );
    frag.append(card, kbdGrid, quick);
    return frag;
  }

  const RENDERERS = {
    welcome: renderWelcomeStep,
    focus: renderFocusStep,
    providers: renderProvidersStep,
    integrations: renderIntegrationsStep,
    workspaces: renderWorkspacesStep,
    senses: renderSensesStep,
    appearance: renderAppearanceStep,
    ecosystem: renderEcosystemStep,
    ready: renderReadyStep,
  };

  function render() {
    if (!dialog) return;
    const progress = formatStepProgress(stepIndex, SETUP_STEPS.length);
    const step = SETUP_STEPS[progress.index];

    if (step.id === 'appearance') {
      const wpId = getState().settings?.windowWallpaper || 'aurora';
      backdrop?.setMood(WALLPAPER_MOODS[wpId] || SETUP_STEP_MOODS.appearance);
    } else {
      backdrop?.setMood(SETUP_STEP_MOODS[step.id] || SETUP_STEP_MOODS.welcome);
    }

    dialog.querySelector('.bo-step-label').textContent = `${progress.stepNumber} / ${progress.total} · ${step.shortTitle}`;
    const dots = dialog.querySelector('.bo-dots');
    dots.replaceChildren();
    SETUP_STEPS.forEach((item, idx) => {
      const dot = el('button', `bo-dot${visited.has(item.id) ? ' is-visited' : ''}`);
      dot.type = 'button';
      dot.title = item.shortTitle;
      dot.setAttribute('aria-label', `Step ${idx + 1}: ${item.shortTitle}`);
      if (idx === progress.index) dot.setAttribute('aria-current', 'step');
      dot.onclick = () => { void saveDraftIfDirty({ silent: true }); goToStep(idx); };
      dots.append(dot);
    });

    const stage = dialog.querySelector('.bo-stage');
    stage.replaceChildren();

    const emblemWrap = el('div', `bo-emblem-wrap bo-rise${step.id === 'welcome' || step.id === 'ready' ? ' is-hero' : ''}`);
    const orbitOuter = el('span', 'bo-orbit');
    const orbitInner = el('span', 'bo-orbit is-inner');
    const emblem = document.createElement('img');
    emblem.className = 'bo-emblem';
    emblem.src = appIconUrl;
    emblem.alt = 'Baryon';
    emblemWrap.append(orbitOuter, orbitInner, emblem);

    const displayName = draft.userName.trim();
    const headingText = step.id === 'ready' && displayName
      ? `You’re all set, ${displayName}`
      : step.id === 'focus' && displayName
        ? `Hey ${displayName}!`
        : step.title;

    stage.append(
      emblemWrap,
      el('h1', 'bo-title bo-rise bo-d1', headingText),
      el('p', 'bo-subtitle bo-rise bo-d2', step.subtitle),
    );
    if (statusMessage) {
      stage.append(el('div', 'bo-notice bo-rise bo-d2', statusMessage));
    }
    stage.append((RENDERERS[step.id] || renderWelcomeStep)());
    stage.scrollTop = 0;

    const backBtn = dialog.querySelector('#bo-back');
    const ctaBtn = dialog.querySelector('#bo-cta');
    backBtn.hidden = progress.isFirst;
    ctaBtn.textContent = progress.isLast ? 'Enter Baryon' : 'Continue';
  }

  function ensureDialog() {
    if (dialog) return dialog;
    dialog = el('dialog');
    dialog.id = 'baryon-onboarding';
    dialog.setAttribute('aria-labelledby', 'bo-heading');

    dialog.innerHTML = `
      <canvas class="bo-bg-canvas" aria-hidden="true"></canvas>
      <div class="bo-shell">
        <div class="bo-topbar">
          <span class="bo-step-label"></span>
          <div class="bo-dots" role="navigation" aria-label="Onboarding steps"></div>
          <div class="bo-top-actions">
            <button type="button" class="bo-skip-top" id="bo-skip">Skip</button>
          </div>
        </div>
        <div class="bo-stage" id="bo-heading"></div>
        <div class="bo-bottom">
          <button type="button" class="bo-back" id="bo-back" hidden>Back</button>
          <button type="button" class="bo-cta" id="bo-cta">Continue</button>
        </div>
      </div>
    `;

    dialog.addEventListener('pointermove', event => {
      if (!backdrop) return;
      backdrop.setMouse(event.clientX / Math.max(1, window.innerWidth), event.clientY / Math.max(1, window.innerHeight));
    });
    dialog.querySelector('#bo-skip').onclick = () => void leaveWithDissolve();
    dialog.querySelector('#bo-back').onclick = () => {
      if (stepIndex > 0) goToStep(stepIndex - 1);
    };
    dialog.querySelector('#bo-cta').onclick = async () => {
      await saveDraftIfDirty({ silent: true });
      if (stepIndex < SETUP_STEPS.length - 1) {
        goToStep(stepIndex + 1);
      } else {
        await leaveWithDissolve(() => startChat());
      }
    };
    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      close();
    });
    dialog.addEventListener('keydown', event => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (event.key === 'ArrowRight' && stepIndex < SETUP_STEPS.length - 1) {
        event.preventDefault();
        goToStep(stepIndex + 1);
      } else if (event.key === 'ArrowLeft' && stepIndex > 0) {
        event.preventDefault();
        goToStep(stepIndex - 1);
      }
    });

    parent.append(dialog);
    return dialog;
  }

  function replaceCanvas() {
    if (!dialog) return null;
    const oldCanvas = dialog.querySelector('.bo-bg-canvas');
    oldCanvas?.remove();
    const fresh = document.createElement('canvas');
    fresh.className = 'bo-bg-canvas';
    fresh.setAttribute('aria-hidden', 'true');
    dialog.prepend(fresh);
    return fresh;
  }

  function closeImmediate() {
    dialog?.querySelector('.bo-bg-canvas')?.remove();
    backdrop?.destroy();
    backdrop = null;
    if (dialog) {
      dialog.classList.remove('is-entering', 'is-leaving');
      if (dialog.open) dialog.close();
    }
  }

  function open(initialStepId = 'welcome') {
    ensureDialog();
    syncDraftFromState();
    statusMessage = '';
    const idx = SETUP_STEPS.findIndex(s => s.id === initialStepId);
    stepIndex = idx >= 0 ? idx : 0;
    visited.add(SETUP_STEPS[stepIndex].id);

    backdrop?.destroy();
    const freshCanvas = replaceCanvas();
    backdrop = mountSetupBackdrop(freshCanvas);

    if (!dialog.open) {
      dialog.classList.add('is-entering');
      dialog.showModal();
      requestAnimationFrame(() => dialog?.classList.remove('is-entering'));
    }
    backdrop.resize();
    render();
    void refreshStatuses();
  }

  function close() {
    if (dialog?.open) void leaveWithDissolve();
  }

  return {
    open,
    close,
    isOpen: () => Boolean(dialog?.open),
  };
}
