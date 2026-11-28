// Pure, DOM-free helpers and up-to-date catalog data for the Baryon full-window onboarding experience.

export const SETUP_STORAGE_KEY = 'baryon-setup-v1';

export interface SetupStep {
  id: string;
  shortTitle: string;
  title: string;
  subtitle: string;
}

export const SETUP_STEPS: SetupStep[] = [
  {
    id: 'welcome',
    shortTitle: 'Welcome',
    title: 'Welcome to Baryon',
    subtitle: 'Your desktop AI companion, multi-agent studio, research workbench, and study space.',
  },
  {
    id: 'focus',
    shortTitle: 'Focus',
    title: 'Tailor your experience',
    subtitle: 'What best describes how you will use Baryon? Pick any mix to highlight the right workspaces.',
  },
  {
    id: 'providers',
    shortTitle: 'AI Brains',
    title: 'Connect your AI brains',
    subtitle: 'Sign into Claude, Gemini (Antigravity), ChatGPT (Codex), or add API keys — and let Auto route each turn.',
  },
  {
    id: 'integrations',
    shortTitle: 'Google & Apps',
    title: 'Google Account Hub & local apps',
    subtitle: 'One Google sign-in powers Calendar, Gmail & Drive; connect MCP tools, Graviton, Flux, Tachyon & AudioPulse.',
  },
  {
    id: 'workspaces',
    shortTitle: 'Studios',
    title: 'Explore Baryon’s 10 studios',
    subtitle: 'Every mode lives in one quiet Stratus workspace with live interactive spotlights below.',
  },
  {
    id: 'senses',
    shortTitle: 'Voice',
    title: 'Voice, permissions & Floating Fairy',
    subtitle: 'Screen awareness, on-device speech, Meeting mode, Screen Ink plots, and Quick Keys across macOS.',
  },
  {
    id: 'appearance',
    shortTitle: 'Atmosphere',
    title: 'Craft your atmosphere',
    subtitle: 'Preview cool-tone home wallpapers live on the horizon shader, and configure animation & quit controls.',
  },
  {
    id: 'ecosystem',
    shortTitle: 'iPhone & CLI',
    title: 'iPhone Baryon, Two Macs & Fairy CLI',
    subtitle: 'Pure pitch-black Stratus iOS app with Face ID, Morning Brief fallback, Body/Face Macs & terminal REPL.',
  },
  {
    id: 'ready',
    shortTitle: 'Launch',
    title: 'Ready when you are',
    subtitle: 'Your live system check, essential shortcuts, and a single click into Baryon.',
  },
];

export const SETUP_STEP_IDS: string[] = SETUP_STEPS.map(step => step.id);

export interface SetupFocusOption {
  id: string;
  label: string;
  caption: string;
  workspaceId: string;
}

export const SETUP_FOCUS_OPTIONS: SetupFocusOption[] = [
  {
    id: 'engineering',
    label: 'Software Engineering',
    caption: 'Baryon runs sandboxed Work Sessions with Queue/Steer, APFS /swarm parallel agents, Neutrino PRs, and Git checkpoints.',
    workspaceId: 'chat',
  },
  {
    id: 'research',
    label: 'Science & Research',
    caption: 'Baryon runs 3-family Elo hypothesis tournaments, paper reproductions (/reproduce), Lean 4 proofs, and Nexus cluster jobs.',
    workspaceId: 'research',
  },
  {
    id: 'study',
    label: 'Study & Notebooks',
    caption: 'Baryon tutors from cited course PDFs aloud, generates FSRS-6 decks, exams, slides, audio overviews & circuit/logic practice.',
    workspaceId: 'notebooks',
  },
  {
    id: 'analytics',
    label: 'Data & Analytics',
    caption: 'Baryon profiles CSV/SQLite/Parquet data, trains AutoML models, runs Resolve entity linkage & explores 3D embeddings (⌘⇧A).',
    workspaceId: 'analytics',
  },
  {
    id: 'planning',
    label: 'Knowledge & Boards',
    caption: 'Baryon turns docs and calendar events into infinite Miro-style Boards (/plan), spreadsheets, A2UI surfaces, and autonomous Goals.',
    workspaceId: 'boards',
  },
  {
    id: 'companion',
    label: 'Everyday Companion',
    caption: 'Baryon floats above any app (⌘⇧S) with hands-free wake word, Meeting summaries, Screen Ink plots, and Morning Briefs on iPhone.',
    workspaceId: 'usage',
  },
];

export function tailoredCaptionForFocus(selectedIds: readonly string[] = []): string {
  const list = Array.isArray(selectedIds) ? selectedIds : [];
  const chosen = SETUP_FOCUS_OPTIONS.filter(opt => list.includes(opt.id));
  if (!chosen.length) {
    return 'Baryon adapts seamlessly across coding, research, study notebooks, analytics, visual boards, and daily life.';
  }
  if (chosen.length === 1) return chosen[0].caption;
  if (chosen.length === 2) {
    return `Tailored for ${chosen[0].label} + ${chosen[1].label} — Baryon highlights those studios and workflows first.`;
  }
  return `Configured across ${chosen.length} focus areas (${chosen.map(c => c.label).slice(0, 3).join(', ')}${chosen.length > 3 ? '…' : ''}).`;
}

export interface SetupMood {
  readonly a: readonly [number, number, number];
  readonly b: readonly [number, number, number];
  readonly c: readonly [number, number, number];
  readonly intensity: number;
}

// Normalized RGB tuples for WebGL setup-backdrop mood interpolation per step.
// Deep nocturnal teal, cyan, and abyssal sapphire hues confined to the lower horizon.
export const SETUP_STEP_MOODS: Readonly<Record<string, SetupMood>> = Object.freeze({
  welcome: { a: [0.02, 0.24, 0.30], b: [0.05, 0.52, 0.64], c: [0.18, 0.80, 0.90], intensity: 1.02 },
  focus: { a: [0.02, 0.22, 0.34], b: [0.06, 0.46, 0.68], c: [0.22, 0.74, 0.92], intensity: 0.98 },
  providers: { a: [0.03, 0.24, 0.32], b: [0.08, 0.48, 0.64], c: [0.24, 0.78, 0.88], intensity: 0.96 },
  integrations: { a: [0.02, 0.26, 0.28], b: [0.05, 0.54, 0.58], c: [0.18, 0.82, 0.84], intensity: 1.0 },
  workspaces: { a: [0.02, 0.22, 0.32], b: [0.07, 0.46, 0.68], c: [0.20, 0.76, 0.94], intensity: 1.02 },
  senses: { a: [0.02, 0.26, 0.32], b: [0.06, 0.52, 0.62], c: [0.22, 0.80, 0.88], intensity: 0.98 },
  appearance: { a: [0.03, 0.22, 0.32], b: [0.08, 0.48, 0.64], c: [0.24, 0.76, 0.90], intensity: 1.02 },
  ecosystem: { a: [0.02, 0.22, 0.28], b: [0.05, 0.46, 0.58], c: [0.18, 0.74, 0.86], intensity: 0.95 },
  ready: { a: [0.03, 0.28, 0.36], b: [0.08, 0.58, 0.72], c: [0.26, 0.86, 0.96], intensity: 1.1 },
});

export const WALLPAPER_MOODS: Readonly<Record<string, SetupMood>> = Object.freeze({
  aurora: { a: [0.02, 0.26, 0.32], b: [0.06, 0.54, 0.66], c: [0.20, 0.82, 0.92], intensity: 1.06 },
  opal: { a: [0.05, 0.24, 0.32], b: [0.14, 0.42, 0.62], c: [0.34, 0.70, 0.86], intensity: 1.02 },
  ember: { a: [0.04, 0.22, 0.28], b: [0.26, 0.24, 0.42], c: [0.48, 0.48, 0.64], intensity: 0.98 },
  nebula: { a: [0.08, 0.16, 0.36], b: [0.22, 0.26, 0.68], c: [0.42, 0.50, 0.88], intensity: 1.02 },
  velvet: { a: [0.02, 0.10, 0.18], b: [0.06, 0.22, 0.40], c: [0.16, 0.44, 0.66], intensity: 0.74 },
  lagoon: { a: [0.01, 0.26, 0.30], b: [0.04, 0.52, 0.58], c: [0.18, 0.82, 0.84], intensity: 1.04 },
  none: { a: [0.01, 0.03, 0.06], b: [0.03, 0.08, 0.16], c: [0.08, 0.18, 0.30], intensity: 0.38 },
});

export interface SetupWorkspaceItem {
  id: string;
  badge: string;
  name: string;
  shortcut: string;
  desc: string;
}

export const SETUP_WORKSPACES: SetupWorkspaceItem[] = [
  { id: 'chat', badge: 'Core', name: 'Chat & Work Sessions', shortcut: '/work · /swarm', desc: 'Queue follow-ups, steer mid-turn (⌥Enter), stash drafts (⌥⇧S), disposable Side Chat (/side), /fanout, Git checkpoints, and APFS CoW /swarm parallel agents.' },
  { id: 'notebooks', badge: 'Study', name: 'Study Notebooks', shortcut: '3-col · FSRS-6', desc: '29+ course notebooks with citation-backed tutor, spoken replies, Studio guides/slides/audio overviews, quizzes, and Coding/Circuit/Logic practice.' },
  { id: 'research', badge: 'R&D', name: 'Research Workbench', shortcut: '/reproduce · Lean', desc: 'Three-family hypothesis tournaments with Elo ratings, arXiv/Semantic Scholar library, Nexus atlas/forge jobs, Lean 4 proof checks & reproduction reports.' },
  { id: 'analytics', badge: 'ML · ⌘⇧A', name: 'Analytics (Stages 1–8)', shortcut: '⌘⇧A', desc: 'Stratus-overhauled data profiling, Learn AutoML, Fairy AI Analyst, Resolve entity linkage + active learning, Nexus Forge GPU bridge, 3D embeddings & Drift compare.' },
  { id: 'boards', badge: 'Canvas', name: 'Boards & /plan', shortcut: 'Miro-compatible', desc: 'Infinite visual whiteboards with sticky notes, connectors, .miro import, PNG/SVG export, and an inline Fairy Board assistant.' },
  { id: 'goals', badge: 'Auto', name: 'Goals Board', shortcut: 'Done-when checks', desc: 'Autonomous multi-session goals with sandboxed done-when checks, paper-claim tolerances, and the dimmed nine-tails video backdrop.' },
  { id: 'neutrino', badge: 'Code', name: 'Neutrino & Git', shortcut: '31+ Git tools', desc: 'Self-hosted Neutrino repos, PR inbox with adaptive diffs, CI logs & Face ID approvals alongside full local Git commit graphs and walkthrough tours.' },
  { id: 'runs', badge: 'Cluster', name: 'Experiments & Compute', shortcut: '/compute · /trace', desc: 'Track atlas & forge runs, per-commit benchmark watches, live logs/metrics, Run trace waterfalls, and the Lab journal (/journal).' },
  { id: 'pages', badge: 'Canvas', name: 'Pages & A2UI v0.9.1', shortcut: '/ui', desc: 'Sandbox-isolated documents, slide decks, spreadsheets with Excel formulas, dashboards, claude.ai Docs/Designs & live interactive A2UI surfaces.' },
  { id: 'usage', badge: 'Telemetry · ⌘⇧U', name: 'Usage & Plan Limits', shortcut: '⌘⇧U', desc: 'Multi-provider token volume, prompt-cache efficiency, estimated cost, and live 5-hour/weekly plan quota gauges across Claude, agy & Codex.' },
];

export interface SetupIntegrationItem {
  title: string;
  body: string;
}

export const SETUP_INTEGRATIONS: SetupIntegrationItem[] = [
  { title: 'Unified Google Account Hub', body: 'One OAuth sign-in auto-connects Google Calendar, Gmail, and Google Drive/Docs/Sheets/Slides with 1-click account switching.' },
  { title: 'Google-SSO MCP Quick-Connect', body: 'Attach Notion, Linear, Slack, Figma, Firebase, Vercel, or Sentry MCP templates from either Mac and launch their SSO sign-in flow.' },
  { title: 'Graviton Container Engine (31 Tools)', body: 'Inspect containers, images, volumes, compose logs, multi-arch builds, and commits through Approval-gated Fairy tools.' },
  { title: 'Flux, Tachyon, AudioPulse & Electron', body: 'Chat in Tachyon (⌥⌘I), ask Flux about open tabs with browser tools, generate playlists in AudioPulse, and automate notes in Electron.' },
];

export interface SetupShortcutItem {
  keys: string;
  action: string;
}

export const SETUP_SHORTCUTS: SetupShortcutItem[] = [
  { keys: '⌘K', action: 'Command palette (chats, commands, panels, pages, BM25 recall)' },
  { keys: '⌘⇧U / ⌘⇧A', action: 'Usage dashboard / Analytics studio' },
  { keys: '⌘⇧S / ⌘⇧R', action: 'Float Fairy companion / Hide or show Baryon' },
  { keys: '⌘B / ⌃⌘F', action: 'Fold left sidebar / Notch-safe full screen' },
  { keys: '⌘⇧M / ⌘⇧H', action: 'Hands-free mic / Toggle Quiz Hints' },
  { keys: '⌃⌥ / ⌥⌘ / ⌃⌥A', action: 'Hold to talk, cursor box, or capture region' },
  { keys: '⌥Enter / ⌥⇧S', action: 'Steer queued turn / Stash composer draft' },
  { keys: 'Hold ⌘Q', action: 'Hold-to-Quit guard (1.2s hold or double-press)' },
];

export interface StepProgress {
  index: number;
  stepNumber: number;
  total: number;
  percent: number;
  isFirst: boolean;
  isLast: boolean;
}

export function formatStepProgress(index: number, total = SETUP_STEPS.length): StepProgress {
  const safeTotal = Math.max(1, Number(total) || SETUP_STEPS.length);
  const clamped = Math.min(safeTotal - 1, Math.max(0, Number(index) || 0));
  return {
    index: clamped,
    stepNumber: clamped + 1,
    total: safeTotal,
    percent: Math.round(((clamped + 1) / safeTotal) * 100),
    isFirst: clamped === 0,
    isLast: clamped === safeTotal - 1,
  };
}

export interface AutoOpenSetupOptions {
  completed?: boolean;
  hasSessions?: boolean;
  conversationReady?: boolean;
  floating?: boolean;
}

export function shouldAutoOpenSetup({
  completed = false,
  hasSessions = false,
  conversationReady = false,
  floating = false,
}: AutoOpenSetupOptions = {}): boolean {
  if (completed || floating) return false;
  return !hasSessions || !conversationReady;
}

export interface SetupReadinessInput {
  claude?: { connected?: boolean } | null;
  antigravity?: { connected?: boolean; models?: readonly unknown[] } | null;
  codex?: { connected?: boolean; signedIn?: boolean; ready?: boolean } | null;
  hasOpenAIKey?: boolean;
  hasDeepSeekKey?: boolean;
  googleAccount?: { connected?: boolean; email?: string } | null;
  hasFishKey?: boolean;
  phoneLink?: { enabled?: boolean; phones?: readonly unknown[] } | null;
  push?: { configured?: boolean; ready?: boolean } | null;
  checkIns?: { morningBrief?: boolean } | null;
  settings?: {
    voiceProvider?: string;
    voiceVolume?: string | number;
    workFolder?: string;
  };
  remote?: boolean;
}

export interface SetupReadinessItem {
  id: string;
  label: string;
  ready: boolean;
  detail: string;
  stepId: string;
}

export interface SetupReadinessResult {
  items: SetupReadinessItem[];
  readyCount: number;
  totalCount: number;
}

export function computeSetupReadiness({
  claude = null,
  antigravity = null,
  codex = null,
  hasOpenAIKey = false,
  hasDeepSeekKey = false,
  googleAccount = null,
  hasFishKey = false,
  phoneLink = null,
  push = null,
  checkIns = null,
  settings = {},
  remote = false,
}: SetupReadinessInput = {}): SetupReadinessResult {
  const claudeReady = Boolean(claude?.connected);
  const agyReady = Boolean(antigravity?.connected);
  const codexReady = Boolean(codex?.connected || codex?.signedIn || codex?.ready);
  const apiReady = Boolean(hasOpenAIKey || hasDeepSeekKey);
  const anyProvider = claudeReady || agyReady || codexReady || apiReady;

  const connectedNames = [
    claudeReady ? 'Claude' : '',
    agyReady ? `Gemini (${antigravity?.models?.length || 0} models)` : '',
    codexReady ? 'Codex' : '',
    hasDeepSeekKey ? 'DeepSeek Key' : '',
    hasOpenAIKey ? 'OpenAI Key' : '',
  ].filter(Boolean);

  const googleConnected = Boolean(googleAccount?.connected);
  const voiceReady = settings.voiceProvider === 'off'
    ? false
    : settings.voiceProvider === 'fish'
      ? Boolean(hasFishKey)
      : Boolean(hasOpenAIKey || settings.voiceProvider === 'openai');
  const phoneReady = Boolean(phoneLink?.enabled && (phoneLink?.phones?.length || 0) > 0);
  const pushReady = Boolean(push?.configured || push?.ready);
  const briefEnabled = Boolean(checkIns?.morningBrief);
  const folderReady = Boolean(settings.workFolder || remote);

  const items: SetupReadinessItem[] = [
    {
      id: 'provider',
      label: 'AI provider connected',
      ready: anyProvider,
      detail: anyProvider ? connectedNames.join(' · ') : 'Sign into Claude, Antigravity (agy), Codex, or add an API key.',
      stepId: 'providers',
    },
    {
      id: 'google',
      label: 'Google Account Hub',
      ready: googleConnected,
      detail: googleConnected
        ? `Connected${googleAccount?.email ? ` as ${googleAccount.email}` : ''} across Calendar, Gmail & Drive.`
        : 'Optional: sign in once for Today, Check-ins & Docs/Sheets/Slides.',
      stepId: 'integrations',
    },
    {
      id: 'workFolder',
      label: 'Default Work Folder',
      ready: folderReady,
      detail: remote
        ? 'Managed by your host Mac (mini) with SSH browsing.'
        : (settings.workFolder || 'Optional: pick a default repo in Settings → Work sessions.'),
      stepId: 'workspaces',
    },
    {
      id: 'voice',
      label: 'Voice & Speech output',
      ready: voiceReady,
      detail: settings.voiceProvider === 'off'
        ? 'Spoken replies are off.'
        : voiceReady
          ? `Using ${settings.voiceProvider === 'fish' ? 'Fish Audio' : 'OpenAI TTS'} (${settings.voiceVolume || '100'}%).`
          : `Selected ${settings.voiceProvider || 'fish'}, waiting for API key.`,
      stepId: 'senses',
    },
    {
      id: 'phone',
      label: 'iPhone Baryon, Push & Briefs',
      ready: phoneReady || briefEnabled,
      detail: phoneReady
        ? `${phoneLink?.phones?.length ?? 0} paired iPhone(s)${pushReady ? ' · APNs push ready' : ''}${briefEnabled ? ' · Morning Brief on' : ''}`
        : briefEnabled
          ? 'Morning Brief active (automatic provider fallback enabled).'
          : 'Optional: pair Baryon iOS over Tailscale with Face ID approvals.',
      stepId: 'ecosystem',
    },
  ];

  const readyCount = items.filter(item => item.ready).length;
  return { items, readyCount, totalCount: items.length };
}
