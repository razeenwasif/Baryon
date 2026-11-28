export const DEFAULTS = {
  // The folder a new work session offers first, and that the MacBook and phone can start work in (Project mode's folder before).
  claudeModel: 'claude-fable-5-2', workFolder: '',
  name: 'Fairy', userName: '', backend: 'deepseek', model: 'deepseek-chat', antigravityModel: 'gemini-3.8-flash', reasoning: 'low',
  transcriptionProvider: 'fish',
  localLanguage: 'en-AU',
  screenAwareness: 'off', handsFree: 'off', voiceFollowups: 'on', voiceBargeIn: 'off', awarenessPaused: 'off',
  desktopBackend: 'antigravity', desktopModel: 'gpt-6.1-sol', desktopClaudeModel: 'claude-opus-5-5', desktopAntigravityModel: 'gemini-4-neon-medium', desktopReasoning: 'high',
  quizProvider: 'codex', quizClaudeModel: 'claude-opus-5-5',
  integrationProvider: 'codex', integrationClaudeModel: 'claude-opus-5-5', workProvider: 'claude', workClaudeModel: 'claude-opus-5-5', workGeminiModel: '', workCodexModel: '', workEffort: 'high',
  desktopApproval: 'smart', autoDesktop: 'on', pixelEffects: 'on',
  windowWallpaper: 'aurora', wallpaperLast: 'aurora', wallpaperMotion: 'flowing', wallpaperReactive: 'on', wallpaperDim: '60', homeToday: 'on',
  transcriptionModel: 'gpt-4o-mini-transcribe', speechModel: 'gpt-4o-mini-tts',
  voiceProvider: 'fish', voiceVolume: '100', voice: 'coral', fishModel: 's2.1-pro-free', fishVoiceId: '',
  personality: "You are Fairy, a small glowing pixel-eye companion on the user's desktop: perceptive, warm, direct, and lightly playful. Talk like a thoughtful friend who respects their time — natural rhythm, plain contractions, brief by default, going deeper only when asked. Be honest about being AI and what you can or cannot do, and never claim an action without a tool result. No stage directions, filler pleasantries, or emoji in spoken replies.",
  notesMode: 'on', quizNotes: 'on', quizClipboard: 'on', notesRoot: '', booksRoot: '',
  memory: '', rememberedFacts: '', longTermMemory: 'off', reflectionMode: 'off',
  proactiveMode: 'on', proactiveMinutes: '5', conversationInterests: '',
  idleDialogueMode: 'mixed', idleDialogueLines: '',
  vocalMode: 'off', vocalMinutes: '20',
  newsMode: 'on', newsHours: '6', autoScreen: 'on',
  // workAutoModel: the work Orchestrator. Fairy picks each request's model and effort, and a request that needs a plan is
  // led by a strong model and built by faster ones. claudeEffort: a Claude chat's effort when you chose the model ('' is
  // Claude Code's default).
  // workStandIns: a work job may go to your other subscription when yours is signed out or nearly full (with Auto on).
  // claudeViaAntigravity: Claude through Antigravity as a second Claude allowance for builders.
  // swarmBuilder: which provider builds a swarm's design: your work provider, or whichever has the most room ('room').
  // Auto by task (docs/auto-by-task-plan.md, stage 5): autoByTask lets Auto pick another provider's model where the
  // strengths table favours it, for the kinds in autoKinds only (none to start), among the providers in autoProviders.
  // strengthsRefresh: when the web numbers are a month old or a new model appears, ask first ('ask') or read them again
  // on their own ('auto', a light scout turn per page).
  autoByTask: 'off', autoKinds: '', autoProviders: 'claude,gemini,codex', strengthsRefresh: 'ask',
  autoModel: 'on', workAutoModel: 'on', claudeEffort: '', workStandIns: 'off', workCarryOn: 'on', workProjectMemory: 'on', claudeViaAntigravity: 'off', swarmBuilder: 'work',
  idleCompaction: 'on', autoResumeLimitedThreads: 'off', snoozeLimitedThreads: 'on',
  // Models you chose for the orchestrator's roles and Swarm's designers, per provider (Settings → Work sessions →
  // Models); empty is Automatic. desktop/orchestrator.mjs, SEAT_SETTINGS.
  orchLeadClaude: '', orchLeadGemini: '', orchLeadCodex: '', orchBuilderClaude: '', orchBuilderGemini: '', orchBuilderCodex: '',
  orchScoutClaude: '', orchScoutGemini: '', orchScoutCodex: '', swarmClaude: '', swarmGemini: '', swarmCodex: '',
  promisesMode: 'on', quickHold: 'control+option', quickTap: 'option+command', quickArea: 'on',
  muted: 'off', meetingMinutes: '30', meetingMicrophone: 'on', meetingSummary: 'on', startAtLogin: 'off',
};

export type DefaultSettings = typeof DEFAULTS;

// Backgrounds behind the window, by name. 'none' keeps the plain dark window.
export const WINDOW_WALLPAPERS: readonly string[] = ['aurora', 'opal', 'ember', 'nebula', 'lagoon', 'velvet', 'none'];
