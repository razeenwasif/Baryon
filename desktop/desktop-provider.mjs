// Claude downsamples larger images, which would shift screenshot-pixel coordinates.
export const CLAUDE_SCREENSHOT = { edge: 1568, area: 1150000 };

// Desktop delegation is independent of the conversation connection and model.
// Authentication is checked before capture so a disconnected worker sees no screen.
export async function prepareDesktopTask({ settings, antigravity, codex, claude, apiProvider, runCodex, runAPI, signal }) {
  signal?.throwIfAborted();
  const backend = settings.desktopBackend;
  const desktopSettings = { ...settings, backend, model: settings.desktopModel, reasoning: settings.desktopReasoning };
  if (backend === 'antigravity') {
    if (!antigravity || typeof antigravity.turn !== 'function') throw new Error('The Antigravity desktop connection is unavailable. Restart Fairy.');
    const account = await antigravity.account();
    signal?.throwIfAborted();
    if (!account.connected) throw new Error(`${account.error || 'Sign in to Antigravity in Settings → Gemini connection.'} Then refresh the connection to enable desktop tasks.`);
    const model = settings.desktopAntigravityModel || 'gemini-4-neon-medium';
    return { provider: antigravity, settings: { ...desktopSettings, antigravityModel: model }, run: runCodex, label: 'Antigravity', vendor: 'Google' };
  }
  if (backend === 'codex') {
    if (!codex || typeof codex.turn !== 'function') throw new Error('The Codex desktop connection is unavailable. Restart Fairy.');
    const account = await codex.account({ cached: true });
    signal?.throwIfAborted();
    if (!account.connected) throw new Error('Sign in with ChatGPT in Settings → Codex connection to enable desktop tasks. DeepSeek can remain your conversation provider.');
    return { provider: codex, settings: desktopSettings, run: runCodex, label: 'Codex', vendor: 'OpenAI' };
  }
  if (backend === 'claude') {
    if (!claude || typeof claude.turn !== 'function') throw new Error('The Claude Code desktop connection is unavailable. Restart Fairy.');
    const account = await claude.account();
    signal?.throwIfAborted();
    if (!account.connected) throw new Error(`${account.error || 'Sign in to Claude Code with claude auth login.'} Then refresh the Claude connection in Settings to enable desktop tasks.`);
    // Claude Code shares the Codex desktop loop; its tool reaches Claude through a loopback MCP bridge.
    const model = settings.desktopClaudeModel;
    return { provider: claude, settings: { ...desktopSettings, model, claudeModel: model }, run: runCodex, label: 'Claude Code', vendor: 'Anthropic', fit: CLAUDE_SCREENSHOT };
  }
  if (backend === 'openai') {
    apiProvider.openaiKey();
    signal?.throwIfAborted();
    return { provider: apiProvider, settings: desktopSettings, run: runAPI, label: 'OpenAI API', vendor: 'OpenAI' };
  }
  throw new Error('Choose a desktop provider in Settings.');
}
