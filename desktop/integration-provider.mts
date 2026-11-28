import { DEFAULTS } from '../src/defaults.js';

export interface IntegrationSettings {
  backend?: string;
  integrationProvider?: string;
  integrationClaudeModel?: string;
  desktopModel?: string;
  desktopReasoning?: string;
  claudeModel?: string;
  model?: string;
  reasoning?: string;
  [key: string]: unknown;
}

export type IntegrationProviderKey = 'antigravity' | 'claude' | 'codex' | 'openai';

export interface GoogleTaskProviderOptions<TProvider = unknown> {
  settings: IntegrationSettings;
  provider?: TProvider;
  codex?: TProvider;
  claude?: TProvider;
  antigravity?: TProvider;
  connected?: Partial<Record<IntegrationProviderKey | string, boolean>> | null;
}

export interface PickedIntegrationProvider<TProvider = unknown> {
  provider: TProvider | undefined;
  settings: IntegrationSettings;
  fallbackFrom?: IntegrationProviderKey;
}

function pickFor<TProvider>(
  name: IntegrationProviderKey,
  {
    settings,
    provider,
    codex,
    claude,
    antigravity,
  }: Pick<GoogleTaskProviderOptions<TProvider>, 'settings' | 'provider' | 'codex' | 'claude' | 'antigravity'>,
): PickedIntegrationProvider<TProvider> | null {
  if (name === 'antigravity') return { provider: antigravity, settings: { ...settings, backend: 'antigravity', reasoning: settings.desktopReasoning || DEFAULTS.desktopReasoning } };
  if (name === 'claude') return { provider: claude, settings: { ...settings, backend: 'claude', claudeModel: settings.integrationClaudeModel || DEFAULTS.integrationClaudeModel, reasoning: settings.desktopReasoning || DEFAULTS.desktopReasoning } };
  if (name === 'codex') return { provider: codex, settings: { ...settings, backend: 'codex', model: settings.desktopModel || DEFAULTS.desktopModel, reasoning: settings.desktopReasoning || DEFAULTS.desktopReasoning } };
  if (name === 'openai' && provider && ['openai', 'codex'].includes(settings.backend ?? '')) return { provider, settings };
  return null;
}

// Google tool loops need an MCP bridge (Claude Code, Antigravity), the Codex dynamic-tool bridge or the OpenAI API.
// When `connected` is provided, fall back to a connected subscription if the preferred integration provider is offline.
export function googleTaskProvider<TProvider = unknown>({
  settings,
  provider,
  codex,
  claude,
  antigravity,
  connected = null,
}: GoogleTaskProviderOptions<TProvider>): PickedIntegrationProvider<TProvider> | null {
  const preferred: 'antigravity' | 'claude' | 'codex' =
    settings.integrationProvider === 'antigravity'
      ? 'antigravity'
      : settings.integrationProvider === 'claude'
        ? 'claude'
        : 'codex';
  if (!connected || typeof connected !== 'object') {
    if (preferred === 'antigravity' || preferred === 'claude') return pickFor(preferred, { settings, provider, codex, claude, antigravity });
    if (['openai', 'codex'].includes(settings.backend ?? '')) return { provider, settings };
    return pickFor('codex', { settings, provider, codex, claude, antigravity });
  }
  const order: IntegrationProviderKey[] = [preferred, 'antigravity', 'codex', 'claude', 'openai'];
  const seen = new Set<IntegrationProviderKey>();
  for (const candidate of order) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    if (connected[candidate] !== true) continue;
    const picked = pickFor(candidate, { settings, provider, codex, claude, antigravity });
    if (picked) return candidate === preferred ? picked : { ...picked, fallbackFrom: preferred };
  }
  if (preferred === 'antigravity' || preferred === 'claude') return pickFor(preferred, { settings, provider, codex, claude, antigravity });
  if (['openai', 'codex'].includes(settings.backend ?? '')) return { provider, settings };
  return pickFor('codex', { settings, provider, codex, claude, antigravity });
}
