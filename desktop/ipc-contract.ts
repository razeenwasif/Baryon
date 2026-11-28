// Canonical Electron preload <-> renderer IPC contract shared across desktop/ and src/.

export const RESEARCH_CALL_NAMES = [
  'state', 'seats', 'list', 'open', 'create', 'fork', 'show', 'task', 'showPaper',
  'start', 'pause', 'resume', 'stop', 'feedback', 'addHypothesis', 'setStatus', 'setSeat',
  'search', 'addPaper', 'fetchPdf', 'setLiterature', 'cited', 'paperPage', 'paperWords',
  'approve', 'reject', 'stopRun', 'showRun', 'approveUnsandboxed', 'autoRun',
  'labCheck', 'labPlan', 'labCancel', 'labRemove', 'labCreate', 'runFile', 'paperOpen',
  'fastMatches', 'attended', 'memoryOffer', 'memoryKeep', 'memoryList', 'memoryForget',
  'studyPaper', 'webPages', 'report', 'paper', 'paperPdfPage', 'paperPdfWords', 'hasPaper',
  'scheduleGet', 'home', 'scheduleSet', 'scheduleClear', 'nexusRun', 'nexusRuns', 'nexusFigure',
  'leanCheck', 'leanPlan', 'leanCancel', 'leanRemove', 'leanCreate',
  'filesList', 'filePreview', 'fileOpenExternal', 'nexusSweep',
  'artifactsList', 'artifactVersion', 'artifactExport', 'figureAnnotate', 'figureAnnotations',
  'reviewerList', 'reviewerRun', 'reviewerDismiss', 'reviewerEnabled',
  'kernelState', 'kernelStart', 'kernelStop', 'kernelRestart', 'kernelExec', 'kernelInterrupt', 'kernelCells',
  'artifactRead', 'artifactSave',
] as const;

export const NOTEBOOK_CALL_NAMES = [
  'list', 'courses', 'coursesLink', 'coursesSync', 'coursesFolder', 'courseWork',
  'open', 'create', 'close', 'view', 'details', 'archive', 'select', 'role',
  'categoryAdd', 'categoryRename', 'categoryRemove', 'categoryMove', 'categorize',
  'removeSource', 'sourceText', 'note', 'noteSave', 'noteBin', 'addFiles',
  'addFolder', 'addFolderElsewhere', 'paste', 'noteSource', 'refresh', 'download', 'check',
  'kbState', 'kbRefresh', 'kbList', 'kbFind', 'kbAddRoot', 'kbRemoveRoot', 'kbSetExclude',
  'chats', 'chat', 'ask', 'stop', 'compactChat', 'tutorSettings', 'keepAnswer',
  'make', 'cancelJob', 'made', 'binMade', 'deck', 'reviewStart', 'reviewRate',
  'reviewUndo', 'reviewEnd', 'card', 'cardDelete', 'deckExport', 'revealExport',
  'quiz', 'quizStart', 'quizAnswer', 'quizDispute', 'quizMarkAgain', 'quizFinish',
  'examSit', 'examDraft', 'examHandIn', 'paperExport', 'lesson', 'progress',
  'voiceState', 'voiceSetup', 'voiceFind', 'voiceAudio', 'audioData', 'slidesExport',
  'saveImage', 'chatBin', 'removeAllSources', 'sortSources', 'categoriesRestore',
  'sourceExtras', 'addWeb', 'transcribe', 'stopTranscribing', 'paperText',
  'codeTools', 'codePython', 'codeState', 'codeSave', 'codeRun', 'practiceSave',
  'practiceCheck', 'practiceOpen', 'speak', 'hush', 'tutorVoice', 'fileOpen',
  'fileSave', 'fileCompile', 'filePage', 'fileWords', 'fileOpenElsewhere',
  'sourcePage', 'sourceIsPdf', 'clipPreview', 'clip', 'clipRename', 'clipRemove',
  'clipOrder', 'clipPicture', 'clipText', 'questions', 'fits', 'fitsDismiss',
  'timedSet', 'timedAllow', 'clipPage',
] as const;

export const ANALYTICS_CALL_NAMES = [
  'state', 'envCheck', 'envInstall', 'datasets', 'upload', 'importWorkFile', 'removeDataset',
  'profile', 'preview', 'autodetect', 'runs', 'query', 'drift', 'runStart', 'runCancel',
  'runGet', 'runDelete', 'runPublishReport', 'renderManim', 'analystChat', 'llmConfirm',
  'cleanPlan', 'cleanApply', 'zeroShotClassify', 'zeroShotApply', 'rlDetect', 'rlRun',
  'rlAlStart', 'rlAlPairs', 'rlAlLabel', 'rlAlClose', 'nexusState', 'nexusSync', 'nexusLogs',
  'embed3d', 'topics',
] as const;

export const ACADEMY_CALL_NAMES = [
  'state', 'listCourses', 'getCourse', 'deleteCourse', 'recordAttempt', 'completeLesson',
  'resetProgress', 'generateCourse', 'generateLesson', 'generatePractice', 'tutorAsk',
] as const;

export const DESIGN_CALL_NAMES = [
  'state', 'listProjects', 'getProject', 'createProject', 'deleteProject', 'scanRepo',
  'updateDesignMd', 'updateTokens', 'generate', 'refineScreen', 'critiqueScreen',
  'duplicateScreen', 'deleteScreen', 'moveScreen', 'exportToRepo', 'publishPage',
] as const;

export const STUDIO_CALL_NAMES = [
  'state', 'list', 'get', 'media', 'generateImage', 'generateVideo', 'generateMusic', 'delete', 'favorite', 'exportToWork',
] as const;

export const WORLDS_CALL_NAMES = [
  'state', 'list', 'get', 'startSession', 'endSession', 'delete', 'saveSnapshotToStudio',
] as const;

export const GAME_CALL_NAMES = [
  'state', 'list', 'get', 'create', 'delete', 'saveRoom', 'saveConfig', 'savePrefab',
  'importStudioAsset', 'importWorldFrame', 'readAsset', 'generateRoomWithAI',
] as const;

export type ResearchCallName = (typeof RESEARCH_CALL_NAMES)[number];
export type NotebookCallName = (typeof NOTEBOOK_CALL_NAMES)[number];
export type AnalyticsCallName = (typeof ANALYTICS_CALL_NAMES)[number];
export type AcademyCallName = (typeof ACADEMY_CALL_NAMES)[number];
export type DesignCallName = (typeof DESIGN_CALL_NAMES)[number];
export type StudioCallName = (typeof STUDIO_CALL_NAMES)[number];
export type WorldsCallName = (typeof WORLDS_CALL_NAMES)[number];
export type GameCallName = (typeof GAME_CALL_NAMES)[number];

export type Unsubscribe = () => void;

export interface BaryonInkApi {
  onScene: (callback: (state: any) => void) => unknown;
  onVoice: (callback: (level: number) => void) => unknown;
  onRide: (callback: (state: any) => void) => unknown;
  onRideAt: (callback: (point: any) => void) => unknown;
  onQuick: (callback: (state: any) => void) => unknown;
  onAreaStart: (callback: () => void) => unknown;
  area: (rect: { x: number; y: number; w: number; h: number } | null) => void;
  onGuide: (callback: (state: any) => void) => unknown;
  guide: (action: 'stop' | 'next' | string) => void;
  interactive: (value: boolean) => void;
  close: (id: string) => void;
  clear: () => void;
  ask: (text: string) => void;
  pen: (phase: 'out' | 'in' | string) => void;
}

export interface BaryonQuickApi {
  submit: (text: string) => void;
  close: () => void;
}

export interface BaryonPreloadApi {
  companionChat: (text: string) => Promise<any>;
  faceState: () => Promise<any>;
  onFaceState: (callback: (value: any) => void) => Unsubscribe;
  facePair: (link: any) => Promise<any>;
  onFaceVoice: (callback: (value: any) => void) => Unsubscribe;
  onFaceHush: (callback: () => void) => Unsubscribe;
  roleSetFace: () => Promise<any>;
  phoneLinkPairMac: () => Promise<any>;
  faceChatsState: () => Promise<any>;
  faceChatsWatch: (chat: any) => Promise<any>;
  faceChatsList: () => Promise<any>;
  faceChatsSend: (message: any) => Promise<any>;
  faceChatsStop: (chat: any) => Promise<any>;
  faceChatsAnswer: (id: string, decision: any) => Promise<any>;
  onFaceChats: (callback: (value: any) => void) => Unsubscribe;
  onFaceChatsState: (callback: (value: any) => void) => Unsubscribe;
  onCompanionMorph: (callback: (value: any) => void) => Unsubscribe;
  onQuickTalk: (callback: (value: any) => void) => Unsubscribe;
  onQuickAsk: (callback: (value: any) => void) => Unsubscribe;
  quickHeard: (text: string) => void;
  onInkAsk: (callback: (value: any) => void) => Unsubscribe;
  onCompanionAsk: (callback: (value: any) => void) => Unsubscribe;
  inkVoice: (level: number) => void;
  onInkMorph: (callback: (value: any) => void) => Unsubscribe;
  companionExplain: (text: string) => Promise<any>;
  companionTask: (text: string) => Promise<any>;
  companionStop: () => Promise<any>;
  companionCursor: () => Promise<any>;
  companionMirrorRequest: () => Promise<any>;
  onCompanionMirror: (callback: (value: any) => void) => Unsubscribe;
  companionFit: (height: number) => Promise<any>;
  companionWalkStart: () => Promise<any>;
  companionWalkStep: (token: any) => Promise<any>;
  companionWalkStop: (token: any) => Promise<any>;
  onCompanionTextOut: (callback: (value: any) => void) => Unsubscribe;
  onCompanionSay: (callback: (value: any) => void) => Unsubscribe;
  companionMirror: (list: any) => Promise<any>;
  onCompanionMirrorRequest: (callback: () => void) => Unsubscribe;
  companionRide: (on: boolean) => Promise<any>;
  companionAnswer: (id: string, decision: any) => Promise<any>;
  onCompanionApproval: (callback: (value: any) => void) => Unsubscribe;
  onCompanionSpeak: (callback: (value: any) => void) => Unsubscribe;
  onCompanionHush: (callback: () => void) => Unsubscribe;
  companionSpoken: (spoken: any) => Promise<any>;
  companionHistory: () => Promise<any>;
  companionOpenWindow: () => Promise<any>;
  companionClose: () => Promise<any>;
  companionPassthrough: (value: boolean) => Promise<any>;
  companionToggle: () => Promise<any>;
  companionAction: (name: string) => Promise<any>;
  onCompanionAction: (callback: (value: any) => void) => Unsubscribe;
  onCompanionProgress: (callback: (value: string) => void) => Unsubscribe;
  onCompanionBloom: (callback: () => void) => Unsubscribe;
  onCompanionDockHover: (callback: (value: any) => void) => Unsubscribe;
  onCompanionText: (callback: (value: any) => void) => Unsubscribe;
  onCompanionOpen: (callback: (value: any) => void) => Unsubscribe;
  cursorPosition: () => Promise<any>;
  captureRect: (rect: any) => Promise<any>;
  notesStatus: () => Promise<any>;
  notesRefresh: () => Promise<any>;
  booksFolder: () => Promise<any>;
  notesFolder: () => Promise<any>;
  onNotes: (callback: (value: any) => void) => Unsubscribe;
  filesStatus: () => Promise<any>;
  filesAdd: () => Promise<any>;
  filesRemove: (id: string) => Promise<any>;
  filesPreview: (link: any, options?: any) => Promise<any>;
  filesReveal: (link: any) => Promise<any>;
  filesOpen: (link: any) => Promise<any>;
  calendarStatus: () => Promise<any>;
  calendarImport: () => Promise<any>;
  calendarHelp: () => Promise<any>;
  calendarConnect: (writeAccess?: boolean) => Promise<any>;
  calendarDisconnect: () => Promise<any>;
  calendarCheck: () => Promise<any>;
  gmailStatus: () => Promise<any>;
  gmailImport: () => Promise<any>;
  gmailHelp: () => Promise<any>;
  gmailConnect: (writeAccess?: boolean) => Promise<any>;
  gmailDisconnect: () => Promise<any>;
  gmailCheck: () => Promise<any>;
  gmailUseCalendarClient: () => Promise<any>;
  driveStatus: () => Promise<any>;
  driveImport: () => Promise<any>;
  driveHelp: () => Promise<any>;
  driveConnect: (writeAccess?: boolean) => Promise<any>;
  driveDisconnect: () => Promise<any>;
  driveCheck: () => Promise<any>;
  driveUseGoogleClient: () => Promise<any>;
  googleAccountStatus: () => Promise<any>;
  googleAccountImport: () => Promise<any>;
  googleAccountHelp: () => Promise<any>;
  googleAccountConnect: (options?: any) => Promise<any>;
  googleAccountSwitch: (options?: any) => Promise<any>;
  googleAccountSync: () => Promise<any>;
  googleAccountDisconnect: (options?: any) => Promise<any>;
  pluginQuickConnect: (options?: any) => Promise<any>;
  spotifyStatus: () => Promise<any>;
  spotifyConnect: (id?: string) => Promise<any>;
  spotifyDisconnect: () => Promise<any>;
  spotifyNow: () => Promise<any>;
  spotifyLibrary: (kind: string, offset?: number, id?: string) => Promise<any>;
  state: () => Promise<any>;
  enableQuiz: (value: any) => Promise<any>;
  quizUIBlocked: (value: any) => Promise<any>;
  onQuiz: (callback: (value: any) => void) => Unsubscribe;
  pauseAwareness: (value: any) => Promise<any>;
  awarenessDisplay: (id: any) => Promise<any>;
  enableHandsFree: (value: any) => Promise<any>;
  ambientPrepare: () => Promise<any>;
  ambientTranscribe: (bytes: any) => Promise<any>;
  voiceSetupTranscribe: (bytes: any) => Promise<any>;
  memoryState: () => Promise<any>;
  memoryAdd: (kind: string, text: string) => Promise<any>;
  memoryEdit: (id: string, text: string) => Promise<any>;
  memoryRemove: (id: string) => Promise<any>;
  memoryClear: () => Promise<any>;
  memoryUndo: () => Promise<any>;
  memoryReflect: () => Promise<any>;
  voiceProfile: () => Promise<any>;
  voiceProfileSave: (profile: any) => Promise<any>;
  voiceProfileClear: () => Promise<any>;
  ambientCancel: () => Promise<any>;
  onAwareness: (callback: (value: any) => void) => Unsubscribe;
  subscriptionStatus: (fresh?: boolean) => Promise<any>;
  workFolderChoose: () => Promise<any>;
  workFolderClear: () => Promise<any>;
  claudeStatus: () => Promise<any>;
  antigravityStatus: () => Promise<any>;
  antigravityRefresh: () => Promise<any>;
  antigravityLogout: () => Promise<any>;
  antigravitySwitchAccount: () => Promise<any>;
  agyCheckState: () => Promise<any>;
  agyCheckRun: () => Promise<any>;
  onAgyCheck: (callback: (value: any) => void) => Unsubscribe;
  onSettingsAt: (callback: (value: any) => void) => Unsubscribe;
  subscriptionLogin: () => Promise<any>;
  setMuted: (value: any) => Promise<any>;
  meetingStart: () => Promise<any>;
  meetingStop: () => Promise<any>;
  meetingState: () => Promise<any>;
  onApprovals: (callback: (value: any) => void) => Unsubscribe;
  approvalsPending: () => Promise<any>;
  approvalAnswer: (id: string, decision: any) => Promise<any>;
  approvalsRecent: (limit?: number) => Promise<any>;
  onGpuRestarted: (callback: () => void) => Unsubscribe;
  onMeeting: (callback: (value: any) => void) => Unsubscribe;
  saveSettings: (settings: any) => Promise<any>;
  saveProfile: (profile: any) => Promise<any>;
  applyProfile: (id: string) => Promise<any>;
  deleteProfile: (id: string) => Promise<any>;
  rebrandProfiles: (current: any) => Promise<any>;
  chat: (text: string, mode?: any, displayId?: any, requestId?: string, attached?: any[], options?: { spoken?: boolean }) => Promise<any>;
  attachChoose: () => Promise<any>;
  attachBytes: (name: string, bytes: any) => Promise<any>;
  attachDiscard: (id: string) => Promise<any>;
  onReply: (callback: (value: any) => void) => Unsubscribe;
  onThought: (callback: (value: any) => void) => Unsubscribe;
  onHandoff: (callback: (value: any) => void) => Unsubscribe;
  onReplyAudio: (callback: (value: any) => void) => Unsubscribe;
  startConversation: () => Promise<any>;
  openSource: (url: string) => Promise<any>;
  screenSettings: () => Promise<any>;
  automaticVocal: (kind: any) => Promise<any>;
  vocalPlaybackOK: () => Promise<any>;
  previewVocal: (kind: any) => Promise<any>;
  singingStatus: () => Promise<any>;
  previewPlaybackOK: () => Promise<any>;
  speak: (text: string) => Promise<any>;
  transcribe: (bytes: any, mime?: string) => Promise<any>;
  prepareLocalSpeech: (locale?: string) => Promise<any>;
  stop: () => Promise<any>;
  pin: (value: any) => Promise<any>;
  ride: (on: boolean) => Promise<any>;
  setWallpaper: (choice: any) => Promise<any>;
  startupUsable: (marks: any) => void;
  setWindowPosition: (x: number, y: number) => void;
  minimize: () => Promise<any>;
  aroundNotch: (value?: boolean) => Promise<any>;
  onAroundNotch: (callback: (value: any) => void) => Unsubscribe;
  setSpriteHidden: (value: any) => Promise<any>;
  clearQuizTarget: () => Promise<any>;
  setQuizAuto: (value: any) => Promise<any>;
  onSpriteHidden: (callback: (value: any) => void) => Unsubscribe;
  onCompanionHidden: (callback: (value: any) => void) => Unsubscribe;
  close: () => Promise<any>;
  importAvatar: () => Promise<any>;
  loadAvatar: () => Promise<any>;
  clearMemory: () => Promise<any>;
  artifactsState: () => Promise<any>;
  artifactsImport: () => Promise<any>;
  artifactsImportAntigravity: () => Promise<any>;
  artifactsImportCodex: () => Promise<any>;
  artifactImportLink: (link: any) => Promise<any>;
  artifactRemove: (id: string) => Promise<any>;
  artifactsRelated: (session: any) => Promise<any>;
  artifactRelatedDismiss: (session: any, id: string) => Promise<any>;
  onArtifactsRelated: (callback: (session: any, value: any) => void) => Unsubscribe;
  artifactSource: (id: string, seq?: number) => Promise<any>;
  artifactSaveDoc: (id: string, text: string) => Promise<any>;
  artifactExport: (id: string, seq: number, format: string, options?: any) => Promise<any>;
  artifactSaveData: (id: string, data: any) => Promise<any>;
  artifactImportCSV: (id: string | null) => Promise<any>;
  artifactGrant: (id: string, sources: any) => Promise<any>;
  artifactComment: (id: string, comment: any) => Promise<any>;
  artifactCommentRemove: (id: string, commentId: string) => Promise<any>;
  artifactTarget: (id: string) => Promise<any>;
  dashboardData: (id: string) => Promise<any>;
  artifactOpenOnline: (id: string) => Promise<any>;
  onArtifacts: (callback: (value: any) => void) => Unsubscribe;
  filesList: (rootId: string, path?: string) => Promise<any>;
  folderProjectStats: (paths: any) => Promise<any>;
  gitStatus: () => Promise<any>;
  gitDiff: (path: string, options?: any) => Promise<any>;
  gitStage: (path: string) => Promise<any>;
  gitUnstage: (path: string) => Promise<any>;
  gitCommit: (message: string) => Promise<any>;
  gitPrStatus: () => Promise<any>;
  gitOverview: () => Promise<any>;
  gitLog: (options?: any) => Promise<any>;
  gitCommitDetail: (sha: string) => Promise<any>;
  gitCommitFileDiff: (sha: string, path: string) => Promise<any>;
  gitPathOf: (link: any) => Promise<any>;
  openInProton: (folder: string, fallbackName?: string) => Promise<any>;
  openInPhoton: (gamePath: string) => Promise<any>;
  gitBranches: () => Promise<any>;
  gitAct: (action: string, value?: any) => Promise<any>;
  gitCompare: (options: any) => Promise<any>;
  gitHistoryNote: (options: any) => Promise<any>;
  gitCompareFileDiff: (from: string, to: string, path: string) => Promise<any>;
  githubCommit: (repo: string, sha: string) => Promise<any>;
  githubClone: (repo: string) => Promise<any>;
  githubInbox: () => Promise<any>;
  githubPr: (repo: string, number: number) => Promise<any>;
  githubPrDiff: (repo: string, number: number, path: string) => Promise<any>;
  githubActivity: () => Promise<any>;
  gitActivity: () => Promise<any>;
  githubRepos: (options?: any) => Promise<any>;
  githubRepo: (repo: string) => Promise<any>;
  githubCommits: (repo: string, options?: any) => Promise<any>;
  neutrinoStatus: () => Promise<any>;
  neutrinoInbox: () => Promise<any>;
  neutrinoRepos: (options?: any) => Promise<any>;
  neutrinoRepo: (repo: string) => Promise<any>;
  neutrinoCommits: (repo: string, options?: any) => Promise<any>;
  neutrinoCommit: (repo: string, sha: string) => Promise<any>;
  neutrinoCommitFileDiff: (repo: string, sha: string, path: string) => Promise<any>;
  neutrinoClone: (repo: string) => Promise<any>;
  neutrinoPr: (repo: string, number: number) => Promise<any>;
  neutrinoPrDiff: (repo: string, number: number, path: string) => Promise<any>;
  neutrinoPrCreate: (args: any) => Promise<any>;
  neutrinoPrUpdate: (args: any) => Promise<any>;
  neutrinoPrNote: (args: any) => Promise<any>;
  neutrinoPrResolveNote: (args: any) => Promise<any>;
  neutrinoPrMerge: (args: any) => Promise<any>;
  neutrinoRun: (repo: string, id: any) => Promise<any>;
  neutrinoCiLog: (repo: string, run: any, job: any) => Promise<any>;
  neutrinoRunStart: (args: any) => Promise<any>;
  neutrinoRunRerun: (args: any) => Promise<any>;
  neutrinoRunCancel: (args: any) => Promise<any>;
  neutrinoJobApprove: (args: any) => Promise<any>;
  neutrinoWorkflows: (repo: string, branch?: string) => Promise<any>;
  neutrinoRules: (repo: string) => Promise<any>;
  neutrinoVault: (repo: string, environment?: string) => Promise<any>;
  neutrinoMirrorNow: (repo: string) => Promise<any>;
  neutrinoCreateRepo: (args: any) => Promise<any>;
  neutrinoBackup: () => Promise<any>;
  gitPush: () => Promise<any>;
  gitOpenPr: () => Promise<any>;
  gitWalkthrough: () => Promise<any>;
  gitMergeInfo: () => Promise<any>;
  gitMerge: () => Promise<any>;
  terminalStart: (options?: any) => Promise<any>;
  terminalWrite: (id: string, data: string) => Promise<any>;
  terminalResize: (id: string, cols: number, rows: number) => Promise<any>;
  terminalStop: (id: string) => Promise<any>;
  onTerminalData: (callback: (value: any) => void) => Unsubscribe;
  onTerminalExit: (callback: (value: any) => void) => Unsubscribe;
  simulatorState: () => Promise<any>;
  simulatorBoot: (udid: string) => Promise<any>;
  simulatorShutdown: (udid: string) => Promise<any>;
  simulatorWatch: (udid: string) => Promise<any>;
  simulatorUnwatch: (udid: string) => Promise<any>;
  simulatorTouch: (udid: string, phase: string, x: number, y: number) => Promise<any>;
  simulatorKey: (udid: string, name: string, modifiers?: any) => Promise<any>;
  simulatorType: (udid: string, text: string) => Promise<any>;
  simulatorButton: (udid: string, name: string) => Promise<any>;
  simulatorAppearance: (udid: string, mode?: string) => Promise<any>;
  onSimulator: (callback: (value: any) => void) => Unsubscribe;
  onSimulatorFrame: (callback: (value: any) => void) => Unsubscribe;
  browserState: () => Promise<any>;
  browserGo: (input: string) => Promise<any>;
  browserCommand: (name: string) => Promise<any>;
  browserPlace: (bounds: any) => Promise<any>;
  browserShow: (value: any) => Promise<any>;
  onBrowser: (callback: (value: any) => void) => Unsubscribe;
  previewState: () => Promise<any>;
  previewDetect: () => Promise<any>;
  previewStart: (command: any) => Promise<any>;
  previewStop: () => Promise<any>;
  onPreview: (callback: (value: any) => void) => Unsubscribe;
  stallReport: (report: any) => Promise<any>;
  sessionNew: () => Promise<any>;
  sessionNewWork: (folder: string) => Promise<any>;
  sessionToWork: (id: string, folder?: string | null) => Promise<any>;
  miniBrowseDir: (options?: any) => Promise<any>;
  scratchState: () => Promise<any>;
  scratchTrim: () => Promise<any>;
  scratchReveal: () => Promise<any>;
  sessionFork: () => Promise<any>;
  btw: (question: string) => Promise<any>;
  workPermission: (permission: any) => Promise<any>;
  workSend: (text: string, attached?: any[]) => Promise<any>;
  workStop: (id: string) => Promise<any>;
  sideProposalStart: (parent: any, proposal: any) => Promise<any>;
  sideProposalDismiss: (parent: any, proposal: any) => Promise<any>;
  sessionDirectory: (query?: any) => Promise<any>;
  sessionMessage: (to: string, text: string) => Promise<any>;
  workStopHelper: (id: string, helperId: string) => Promise<any>;
  workMessageHelper: (id: string, helperId: string, text: string) => Promise<any>;
  agentSwarmState: (chat: string) => Promise<any>;
  agentSwarmPlan: (chat: string, options?: any) => Promise<any>;
  agentSwarmDeploy: (chat: string, options?: any) => Promise<any>;
  agentSwarmAdd: (chat: string, spec: any) => Promise<any>;
  agentSwarmMessage: (chat: string, agentId: string, text: string) => Promise<any>;
  agentSwarmStop: (chat: string, agentId: string) => Promise<any>;
  agentSwarmDiff: (chat: string, agentId: string) => Promise<any>;
  agentSwarmMerge: (chat: string, agentId: string) => Promise<any>;
  agentSwarmDiscard: (chat: string, agentId: string) => Promise<any>;
  onAgentSwarm: (callback: (value: any) => void) => Unsubscribe;
  workIsolate: (value: any) => Promise<any>;
  workRewind: (at: any) => Promise<any>;
  workCheckpointList: () => Promise<any>;
  workCheckpointDiff: (options?: any) => Promise<any>;
  workCheckpointFork: (options?: any) => Promise<any>;
  secretRequestsList: (session: any) => Promise<any>;
  secretRequestResolve: (id: string, payload: any) => Promise<any>;
  secretRequestRevoke: (session: any, envVar: string) => Promise<any>;
  limitRecoveryState: () => Promise<any>;
  limitRecoveryCancel: (sessionId: string) => Promise<any>;
  worktreeGc: () => Promise<any>;
  onSecretRequests: (callback: (value: any) => void) => Unsubscribe;
  chatRewind: (target: any) => Promise<any>;
  a2uiUpdateData: (payload: any) => Promise<any>;
  a2uiToPage: (payload: any) => Promise<any>;
  a2uiAction: (payload: any) => Promise<any>;
  onA2uiUpdate: (callback: (value: any) => void) => Unsubscribe;
  boardsList: () => Promise<any>;
  boardsGet: (id: string) => Promise<any>;
  boardsCreate: (payload: any) => Promise<any>;
  boardsSave: (id: string, document: any, metaPatch?: any) => Promise<any>;
  boardsRename: (id: string, name: string) => Promise<any>;
  boardsDelete: (id: string) => Promise<any>;
  boardsAsk: (payload: any) => Promise<any>;
  boardsExportFile: (payload: any) => Promise<any>;
  boardsImportImage: () => Promise<any>;
  boardsOpenFile: () => Promise<any>;
  onBoardsChanged: (callback: (value: any) => void) => Unsubscribe;
  skillsList: () => Promise<any>;
  skillSave: (value: any) => Promise<any>;
  skillRemove: (name: string) => Promise<any>;
  automationState: () => Promise<any>;
  todayData: (force?: boolean) => Promise<any>;
  animationUrl: (code: string) => Promise<any>;
  notebook: (name: NotebookCallName, ...args: any[]) => Promise<any>;
  research: (name: ResearchCallName, ...args: any[]) => Promise<any>;
  onResearchDraft: (callback: (value: any) => void) => Unsubscribe;
  onResearch: (callback: (value: any) => void) => Unsubscribe;
  analytics: (name: AnalyticsCallName, ...args: any[]) => Promise<any>;
  onAnalytics: (callback: (value: any) => void) => Unsubscribe;
  onAnalyticsOpen: (callback: (value: any) => void) => Unsubscribe;
  academy: (name: AcademyCallName, ...args: any[]) => Promise<any>;
  onAcademy: (callback: (value: any) => void) => Unsubscribe;
  design: (name: DesignCallName, ...args: any[]) => Promise<any>;
  onDesign: (callback: (value: any) => void) => Unsubscribe;
  studio: (name: StudioCallName, ...args: any[]) => Promise<any>;
  onStudio: (callback: (value: any) => void) => Unsubscribe;
  worlds: (name: WorldsCallName, ...args: any[]) => Promise<any>;
  onWorlds: (callback: (value: any) => void) => Unsubscribe;
  game: (name: GameCallName, ...args: any[]) => Promise<any>;
  onGame: (callback: (value: any) => void) => Unsubscribe;
  onNotebookTutor: (callback: (value: any) => void) => Unsubscribe;
  onNotebookVoice: (callback: (value: any) => void) => Unsubscribe;
  onNotebookChanged: (callback: (value: any) => void) => Unsubscribe;
  meetingLines: () => Promise<any>;
  meetingSummaryDismiss: () => Promise<any>;
  hookChooseFolder: () => Promise<any>;
  hookAdd: (value: any) => Promise<any>;
  hookRemove: (id: string) => Promise<any>;
  scheduleAdd: (value: any) => Promise<any>;
  scheduleUpdate: (id: string, value: any) => Promise<any>;
  scheduleRemove: (id: string) => Promise<any>;
  scheduleRun: (id: string) => Promise<any>;
  watcherAdd: (value: any) => Promise<any>;
  watcherRemove: (id: string) => Promise<any>;
  watcherSet: (id: string, value: any) => Promise<any>;
  watcherLook: (id: string) => Promise<any>;
  runsProjects: () => Promise<any>;
  evalDraft: (at: any) => Promise<any>;
  evalSave: (at: any, choices: any) => Promise<any>;
  evalsList: () => Promise<any>;
  evalRemove: (id: string) => Promise<any>;
  evalsRun: (ids: any) => Promise<any>;
  evalsStop: () => Promise<any>;
  strengthsState: () => Promise<any>;
  strengthsRefresh: () => Promise<any>;
  strengthsStop: () => Promise<any>;
  strengthsPin: (kind: string, model: string) => Promise<any>;
  chatOfferDecline: (kind: string) => Promise<any>;
  strengthsDismiss: (id: string) => Promise<any>;
  goalsList: () => Promise<any>;
  goalGet: (id: string) => Promise<any>;
  goalAdd: (value: any) => Promise<any>;
  goalSet: (id: string, patch: any) => Promise<any>;
  goalStep: (id: string, op: any) => Promise<any>;
  goalState: (id: string, move: any, reason?: any) => Promise<any>;
  goalLink: (id: string, link: any) => Promise<any>;
  goalContinue: (id: string) => Promise<any>;
  goalWait: (id: string, wait: any) => Promise<any>;
  reproStart: (value: any) => Promise<any>;
  reproClaims: (id: string) => Promise<any>;
  reproPick: (id: string, patch: any) => Promise<any>;
  reproPlan: (id: string, options?: any) => Promise<any>;
  reproPlanApprove: (id: string, options?: any) => Promise<any>;
  reproVerdict: (id: string, patch: any) => Promise<any>;
  reproReport: (id: string) => Promise<any>;
  reproReportOpen: (id: string, which?: any) => Promise<any>;
  onEvalOffer: (callback: (value: any) => void) => Unsubscribe;
  onEvalsProgress: (callback: (value: any) => void) => Unsubscribe;
  runsList: (folder: string) => Promise<any>;
  runsFigure: (folder: string, id: string, path: string) => Promise<any>;
  runsAnnotate: (folder: string, id: string, value: any) => Promise<any>;
  runsRemove: (folder: string, id: string) => Promise<any>;
  runTrace: (chat: string) => Promise<any>;
  dataFiles: () => Promise<any>;
  dataInspect: (path: string, options?: any) => Promise<any>;
  offPeakState: () => Promise<any>;
  offPeakAdd: (item: any) => Promise<any>;
  offPeakRemove: (id: string) => Promise<any>;
  offPeakSet: (patch: any) => Promise<any>;
  offPeakRun: (id: string) => Promise<any>;
  claudeImport: () => Promise<any>;
  connectorsState: () => Promise<any>;
  connectorAdd: (value: any) => Promise<any>;
  connectorRemove: (id: string) => Promise<any>;
  connectorTest: (id: string) => Promise<any>;
  onPalette: (callback: () => void) => Unsubscribe;
  onRemoteLink: (callback: (value: any) => void) => Unsubscribe;
  onSessionShow: (callback: (value: any) => void) => Unsubscribe;
  workAnswer: (id: string, decision: any) => Promise<any>;
  setModel: (choice: any) => Promise<any>;
  modelLists: () => Promise<any>;
  planUsage: () => Promise<any>;
  planUsageRefresh: () => Promise<any>;
  tokenUsage: (options?: any) => Promise<any>;
  sweep: (action: string, ...args: any[]) => Promise<any>;
  sweepMini: (action: string, ...args: any[]) => Promise<any>;
  sweepPeerReport: (summary: any) => Promise<any>;
  relay: (action: string, ...args: any[]) => Promise<any>;
  relayPeerReport: (summary: any) => Promise<any>;
  claudeSync: (action: string) => Promise<any>;
  onClaudeSync: (callback: (value: any) => void) => Unsubscribe;
  onRelay: (callback: (value: any) => void) => Unsubscribe;
  onSweep: (callback: (value: any) => void) => Unsubscribe;
  onPlanUsage: (callback: (value: any) => void) => Unsubscribe;
  phoneState: () => Promise<any>;
  phoneSet: (on: any) => Promise<any>;
  phonePair: () => Promise<any>;
  phoneForget: (id: string) => Promise<any>;
  phoneLinkState: () => Promise<any>;
  phoneLinkSet: (on: any) => Promise<any>;
  phoneLinkPair: () => Promise<any>;
  phoneLinkForget: (id: string) => Promise<any>;
  phoneLinkKeepAwake: (on: any) => Promise<any>;
  phoneLinkGoogle: (on: any) => Promise<any>;
  pushState: () => Promise<any>;
  pushKeyChoose: (teamId?: string) => Promise<any>;
  pushKeyRemove: () => Promise<any>;
  pushTest: () => Promise<any>;
  checkInsState: () => Promise<any>;
  promises: () => Promise<any>;
  promiseDone: (id: string, done?: boolean) => Promise<any>;
  promiseRemove: (id: string) => Promise<any>;
  promisesCheck: () => Promise<any>;
  onAutoModel: (callback: (value: any) => void) => Unsubscribe;
  onPromises: (callback: (value: any) => void) => Unsubscribe;
  onPromisesAdded: (callback: (value: any) => void) => Unsubscribe;
  checkInsSet: (value: any) => Promise<any>;
  checkInsRun: (kind: string) => Promise<any>;
  onChatChanged: (callback: (value: any) => void) => Unsubscribe;
  onPhoneLink: (callback: (value: any) => void) => Unsubscribe;
  onPhone: (callback: (value: any) => void) => Unsubscribe;
  onWork: (callback: (value: any) => void) => Unsubscribe;
  sessionOpen: (id: string) => Promise<any>;
  sessionRemove: (id: string) => Promise<any>;
  sessionsRemove: (ids: string[]) => Promise<any>;
  sessionRename: (id: string, title: string) => Promise<any>;
  sessionPin: (id: string, pinned: boolean) => Promise<any>;
  sessionMove: (id: string, folder: string | null) => Promise<any>;
  sessionCompact: () => Promise<any>;
  sessionNotes: () => Promise<any>;
  sessionNotesSave: (text: string) => Promise<any>;
  projectMemoryDecide: (replyAt: any, keep: boolean) => Promise<any>;
  projectMemoryList: () => Promise<any>;
  projectMemoryForget: (id: string) => Promise<any>;
  labJournalList: () => Promise<any>;
  labJournalAdd: (entry: any) => Promise<any>;
  labJournalUpdate: (id: string, patch: any) => Promise<any>;
  labJournalRemove: (id: string) => Promise<any>;
  sessionPane: (pane: any) => Promise<any>;
  sessionSearch: (query: string) => Promise<any>;
  sessionRecall: (query: string, options?: any) => Promise<any>;
  benchmarkList: (folder?: string) => Promise<any>;
  benchmarkSeries: (watchId: string) => Promise<any>;
  benchmarkAdd: (input: any) => Promise<any>;
  benchmarkSet: (id: string, patch: any) => Promise<any>;
  benchmarkRemove: (id: string) => Promise<any>;
  benchmarkRun: (id: string) => Promise<any>;
  onBenchmarkChanged: (callback: (value: any) => void) => Unsubscribe;
  researchBriefData: () => Promise<any>;
  researchBriefGenerate: (options?: any) => Promise<any>;
  planForecast: (plan: any) => Promise<any>;
  computeState: () => Promise<any>;
  computeLogs: (job: any, seconds?: number) => Promise<any>;
  computeOutputs: (job: any) => Promise<any>;
  folderNew: () => Promise<any>;
  folderRename: (id: string, name: string) => Promise<any>;
  folderCollapse: (id: string, collapsed: boolean) => Promise<any>;
  folderRemove: (id: string) => Promise<any>;
  folderPlace: (id: string, where: any) => Promise<any>;
  categoryNew: () => Promise<any>;
  categoryRename: (id: string, name: string) => Promise<any>;
  categoryCollapse: (id: string, collapsed: boolean) => Promise<any>;
  categoryRemove: (id: string) => Promise<any>;
  categoryPlace: (id: string, before: any) => Promise<any>;
  modelFanout: (prompt: string, seats: any) => Promise<any>;
  sessionSnooze: (id: string, until: any) => Promise<any>;
  sessionHistoryPage: (id: string, options?: any) => Promise<any>;
  turnItemHydrate: (key: string) => Promise<any>;
  eventLoopStats: () => Promise<any>;
  resourceMonitorState: () => Promise<any>;
  terminalSnapshot: (id: string) => Promise<any>;
  failedRecordingsList: () => Promise<any>;
  failedRecordingRetry: (id: string) => Promise<any>;
  failedRecordingDelete: (id: string) => Promise<any>;
  vorssaintStatus: () => Promise<any>;
  vorssaintAction: (payload: any) => Promise<any>;
  onVorssaintFeatures: (callback: (value: any) => void) => Unsubscribe;
  onSessions: (callback: (value: any) => void) => Unsubscribe;
  onDesktopActive: (callback: (value: any) => void) => Unsubscribe;
  onFileStep: (callback: (step: any) => void) => Unsubscribe;
  onProgress: (callback: (text: string) => void) => Unsubscribe;
  onStop: (callback: () => void) => Unsubscribe;
  onSettings: (callback: (value: any) => void) => Unsubscribe;
  onSizeToggle: (callback: () => void) => Unsubscribe;
  onMicToggle: (callback: () => void) => Unsubscribe;
  onMeetingToggle: (callback: () => void) => Unsubscribe;
  onQuiet: (callback: () => void) => Unsubscribe;
  onMemoryIdle: (callback: (value: any) => void) => Unsubscribe;
  onQuitShortcut: (callback: (value: any) => void) => Unsubscribe;
}
