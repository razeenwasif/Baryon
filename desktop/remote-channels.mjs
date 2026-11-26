// Fairy away from the mini, Away 2: which of the window's calls a window on the face's Mac may make, and who answers.
// Every channel the window page can call (desktop/preload.cjs, its notebook calls included as notebook-<name>) is in exactly one list; test/remote-channels.test.mjs
// fails on one that isn't, so a new channel is sorted on purpose. kindOf() treats an unlisted one as mini-only.
//
// REMOTE    answered by the Mac Fairy lives on, by the handler its own window uses: chats, sending and stopping,
//           questions that need an OK, the model, pages, memory, promises, check-ins and schedules; and (Away 4) her
//           speech, transcribing a recording made on the face's Mac, and adding a file chosen there; and (Away 5) work
//           sessions, started only in a folder already worked in. Each handler here was
//           read: it touches only that Mac's data and services, never a dialog, a window or its screen.
// LOCAL     answered by the face's Mac for its own window: size, the pointer, the notch, choosing a file, and
//           its own browser pane (its sign-ins stay on that Mac; remote-browser.mjs).
// MINI_ONLY answered by nobody: the page is told "Do this on your other Mac" (sign-ins and keys, pairing, choosing
//           folders, running a preview, and anything not yet read).
// OTHER     the companion's, the face's and its chats window's own channels: not the window's to call.

export const REMOTE = Object.freeze([
  'state', 'chat', 'stop', 'session-new', 'session-open', 'session-rename', 'session-pin', 'session-search', 'session-recall',
  'session-remove', 'sessions-remove', 'session-move', 'session-compact', 'session-notes', 'session-notes-save', 'project-memory-decide', 'project-memory-list', 'project-memory-forget', 'lab-journal-list', 'lab-journal-add', 'lab-journal-update', 'lab-journal-remove', 'session-pane', 'folder-new',
  'folder-rename', 'folder-remove', 'folder-collapse', 'folder-place', 'category-new', 'category-rename',
  'category-remove', 'category-collapse', 'category-place', 'approval-answer', 'approvals-pending',
  'approvals-recent', 'set-model', 'model-lists', 'plan-usage', 'plan-usage-refresh', 'token-usage', 'artifacts-state',
  'artifact-source', 'artifacts-related', 'artifact-related-dismiss', 'artifact-comment', 'artifact-comment-remove',
  'artifact-save-data', 'artifact-save-doc', 'artifact-remove', 'artifact-target', 'artifact-grant',
  'dashboard-data', 'today-data', 'memory-state', 'memory-add', 'memory-edit', 'memory-remove', 'memory-undo',
  'memory-reflect', 'memory-clear', 'clear-memory', 'promises-state', 'promise-done', 'promise-remove',
  'promises-check', 'check-ins-state', 'check-ins-set', 'check-ins-run', 'schedule-add', 'schedule-update', 'schedule-remove', 'watcher-add', 'watcher-remove', 'watcher-set', 'watcher-look',
  'runs-projects', 'runs-list', 'runs-figure', 'runs-annotate', 'runs-remove', 'run-trace', 'benchmark-list', 'benchmark-series', 'benchmark-add', 'benchmark-set', 'benchmark-remove', 'benchmark-run', 'research-brief-data', 'research-brief-generate', 'plan-forecast', 'compute-state', 'compute-logs', 'compute-outputs', 'data-files', 'data-inspect', 'eval-draft', 'eval-save', 'evals-list', 'eval-remove', 'evals-run', 'evals-stop',
  // The strengths table (Auto by task, stage 2): read, and Refresh, which you press on either Mac; it reads benchmark pages
  // on the mini and asks its scout once per page.
  'strengths-state', 'strengths-refresh', 'strengths-stop', 'strengths-pin', 'chat-offer-decline', 'strengths-dismiss',
  // Goals (stage 1): the board, read and changed from either Mac; nothing here starts work.
  'goals-list', 'goal-get', 'goal-add', 'goal-set', 'goal-step', 'goal-state', 'goal-link',
  // Stage 2: Continue runs a goal's next step as a work turn, under its chat's own permission and cards.
  'goal-continue',
  // Stage 3: a goal waits on a Nexus job, one of your watchers, or a time; or stops waiting.
  'goal-wait',
  // Reproduce a paper (stages 1–6): fetch paper into ~/Reproductions, extract quote-checked claims, pick & budget, draft & approve REPRODUCTION.md plan, accept/close claim verdicts, compile REPORT.md + PDF.
  'repro-start', 'repro-claims', 'repro-pick', 'repro-plan', 'repro-plan-approve', 'repro-verdict', 'repro-report',
  // A notebook animation is kept by Fairy's Mac and played in the face's window from fairy-artifact://anim/<id>, which
  // the face fetches over the link (face-link.mjs): asked here, it was refused, and the animation couldn't play.
  'animation-url',
  'schedule-run', 'automation-state', 'off-peak-state', 'off-peak-add', 'off-peak-remove', 'off-peak-set', 'off-peak-run', 'skills-list', 'notes-status', 'speak', 'transcribe', 'attach-bytes',
  'attach-discard', 'prepare-local-speech', 'files-preview', 'files-list', 'files-status', 'notebook-list',
  'notebook-courses', 'notebook-coursesLink', 'notebook-coursesSync', 'notebook-courseWork', 'notebook-open',
  'notebook-create', 'notebook-close', 'notebook-view', 'notebook-details', 'notebook-archive', 'notebook-select',
  'notebook-role', 'notebook-categoryAdd', 'notebook-categoryRename', 'notebook-categoryRemove',
  'notebook-categoryMove', 'notebook-categorize', 'notebook-removeSource', 'notebook-sourceText', 'notebook-note',
  'notebook-noteSave', 'notebook-noteBin', 'notebook-addFiles', 'notebook-addFolder', 'notebook-paste',
  'notebook-noteSource', 'notebook-refresh', 'notebook-download', 'notebook-check', 'notebook-kbState',
  'notebook-kbRefresh', 'notebook-kbList', 'notebook-kbFind', 'notebook-kbRemoveRoot', 'notebook-kbSetExclude',
  'notebook-chats', 'notebook-chat', 'notebook-ask', 'notebook-stop', 'notebook-compactChat',
  'notebook-tutorSettings', 'notebook-keepAnswer', 'notebook-make', 'notebook-cancelJob', 'notebook-made',
  'notebook-binMade', 'notebook-deck', 'notebook-reviewStart', 'notebook-reviewRate', 'notebook-reviewUndo',
  'notebook-reviewEnd', 'notebook-card', 'notebook-cardDelete', 'notebook-deckExport', 'notebook-quiz',
  'notebook-quizStart', 'notebook-quizAnswer', 'notebook-quizDispute', 'notebook-quizMarkAgain',
  'notebook-quizFinish', 'notebook-examSit', 'notebook-examDraft', 'notebook-examHandIn', 'notebook-paperExport',
  'notebook-lesson', 'notebook-progress', 'notebook-voiceState', 'notebook-voiceSetup', 'notebook-voiceFind',
  'notebook-voiceAudio', 'notebook-audioData', 'notebook-slidesExport', 'notebook-saveImage', 'notebook-chatBin',
  'notebook-removeAllSources', 'notebook-sortSources', 'notebook-categoriesRestore', 'notebook-sourceExtras',
  'notebook-addWeb', 'notebook-transcribe', 'notebook-stopTranscribing', 'notebook-paperText', 'notebook-codeTools',
  'notebook-codePython', 'notebook-codeState', 'notebook-codeSave', 'notebook-codeRun', 'notebook-practiceSave',
  'notebook-practiceCheck', 'notebook-speak', 'notebook-hush', 'notebook-tutorVoice', 'notebook-fileOpen',
  'notebook-fileSave', 'notebook-fileCompile', 'notebook-filePage', 'notebook-fileWords', 'notebook-sourcePage',
  'notebook-sourceIsPdf',
  // Clippings of a PDF's pages for the shelf above the tutor (notebook/clips.mjs): drawn and kept on the mini, in the
  // notebook's own folder, and only ever of this notebook's own sources.
  'notebook-clipPreview', 'notebook-clip', 'notebook-clipRename', 'notebook-clipRemove', 'notebook-clipOrder', 'notebook-clipPicture',
  'notebook-clipText', 'notebook-questions', 'notebook-fits', 'notebook-fitsDismiss', 'notebook-timedSet', 'notebook-timedAllow', 'notebook-clipPage',
  // /fork (a copy of the chat on screen) and /btw (a side question beside it, never kept).
  'session-fork', 'btw', 'model-fanout', 'session-snooze', 'session-history-page', 'turn-item-hydrate', 'resource-monitor-state', 'failed-recordings-list', 'failed-recording-retry', 'failed-recording-delete',
  // Away 5: work sessions, started only in a folder already worked in (as from the phone).
  'session-new-work', 'session-to-work', 'scratch-state', 'scratch-trim', 'session-directory', 'session-message', 'work-answer', 'work-isolate', 'work-permission', 'work-rewind', 'work-checkpoint-list', 'work-checkpoint-diff', 'work-checkpoint-fork', 'secret-requests-list', 'secret-request-revoke', 'limit-recovery-state', 'limit-recovery-cancel', 'worktree-gc', 'chat-rewind', 'a2ui-update-data', 'a2ui-to-page', 'a2ui-action', 'boards-list', 'boards-get', 'boards-create', 'boards-save', 'boards-rename', 'boards-delete', 'boards-ask', 'work-send', 'work-stop', 'work-stop-helper', 'work-message-helper', 'side-proposal-start', 'side-proposal-dismiss',
  // Antigravity-style parallel agent swarm mode (agent-swarm.mjs): deploy, monitor, steer, and 3-way merge agents from either Mac.
  'agent-swarm-state', 'agent-swarm-plan', 'agent-swarm-deploy', 'agent-swarm-add', 'agent-swarm-message', 'agent-swarm-stop', 'agent-swarm-diff', 'agent-swarm-merge', 'agent-swarm-discard',
  // A terminal on the other Mac, opened with Touch ID; what's typed goes in order, one request at a time (face-window.mjs).
  'terminal-start', 'terminal-write', 'terminal-resize', 'terminal-stop', 'terminal-snapshot',
  // The window's background (Velvet, or back to Aurora): a setting saved there, shared by both windows.
  'set-wallpaper',
  // The Simulator on the other Mac: its picture streamed here (fewer, smaller frames), taps and keys sent there.
  'simulator-state', 'simulator-boot', 'simulator-shutdown', 'simulator-watch', 'simulator-unwatch', 'simulator-touch', 'simulator-key', 'simulator-type', 'simulator-button', 'simulator-appearance',
  // Research's board (docs/research-migration.md, stage 5): every call but opening a PDF in the Mac's own app.
  'research-state', 'research-seats', 'research-list', 'research-open', 'research-create', 'research-fork', 'research-show', 'research-task', 'research-showPaper',
  'research-start', 'research-pause', 'research-resume', 'research-stop', 'research-feedback', 'research-addHypothesis', 'research-setStatus', 'research-setSeat', 'research-search',
  'research-addPaper', 'research-fetchPdf', 'research-setLiterature', 'research-cited', 'research-paperPage', 'research-paperWords',
  // The Lab (stage 6): every call but a run with no sandbox and removing the Lab's Python.
  'research-approve', 'research-reject', 'research-stopRun', 'research-showRun', 'research-autoRun', 'research-labCheck', 'research-labPlan', 'research-labCancel',
  'research-labCreate', 'research-runFile', 'research-fastMatches', 'research-attended', 'research-memoryOffer', 'research-memoryKeep', 'research-memoryList', 'research-memoryForget', 'research-studyPaper', 'research-webPages', 'research-report', 'research-paper', 'research-paperPdfPage', 'research-paperPdfWords', 'research-hasPaper', 'research-scheduleGet', 'research-home', 'research-scheduleSet', 'research-scheduleClear', 'research-nexusRun', 'research-nexusRuns', 'research-nexusFigure', 'research-leanCheck', 'research-leanPlan', 'research-leanCancel', 'research-leanCreate', 'research-filesList', 'research-filePreview', 'research-nexusSweep', 'research-artifactsList', 'research-artifactVersion', 'research-artifactExport', 'research-figureAnnotate', 'research-figureAnnotations', 'research-reviewerList', 'research-reviewerRun', 'research-reviewerDismiss', 'research-reviewerEnabled', 'research-kernelState', 'research-kernelStart', 'research-kernelStop', 'research-kernelRestart', 'research-kernelExec', 'research-kernelInterrupt', 'research-kernelCells', 'research-artifactRead', 'research-artifactSave',
  // Sweep (sweep.mjs): the Mac Fairy lives on's own disk cleaner, asked from a window on the face's Mac, and that Mac's
  // own summary, told to this one so its window can show both.
  'sweep-mini', 'sweep-peer-report',
  // Relay (relay.mjs): the MacBook's summary of its repo syncer, told to this Mac so its window can show it.
  'relay-peer-report',
  // Neutrino (neutrino.mjs): server status, repos, PRs, CI runs/logs, mirrors, rules, Vault names, and essential actions.
  'neutrino-status', 'neutrino-inbox', 'neutrino-repos', 'neutrino-repo', 'neutrino-commits', 'neutrino-commit',
  'neutrino-commit-file-diff', 'neutrino-pr', 'neutrino-pr-diff', 'neutrino-pr-create', 'neutrino-pr-update',
  'neutrino-pr-note', 'neutrino-pr-resolve-note', 'neutrino-pr-merge', 'neutrino-run', 'neutrino-ci-log',
  'neutrino-run-start', 'neutrino-run-rerun', 'neutrino-run-cancel', 'neutrino-job-approve', 'neutrino-workflows',
  'neutrino-rules', 'neutrino-vault', 'neutrino-mirror-now', 'neutrino-create-repo', 'neutrino-backup',
  // Git & GitHub panes: reading repository status, history, branches, diffs, and GitHub inbox/repos on the other Mac;
  // writes (commit, push, open PR, merge, branch/stash switches) ask Touch ID except local staging and fetch.
  'folder-project-stats', 'git-status', 'git-diff', 'git-stage', 'git-unstage', 'git-commit', 'git-pr-status', 'git-overview', 'git-log',
  'git-commit-detail', 'git-path-of', 'git-commit-file-diff', 'git-compare', 'git-history-note', 'git-compare-file-diff',
  'git-activity', 'git-branches', 'git-act', 'git-merge-info', 'git-merge', 'git-push', 'git-open-pr', 'git-walkthrough',
  'github-repos', 'github-repo', 'github-commit', 'github-activity', 'github-inbox', 'github-pr', 'github-pr-diff', 'github-commits',
  // Read-only integration and subscription status queries synced to the Plugins gallery on the face's Mac.
  'calendar-status', 'gmail-status', 'drive-status', 'google-account-status', 'spotify-status', 'connectors-state',
  'claude-status', 'antigravity-status', 'antigravity-refresh', 'plugin-quick-connect', 'subscription-status',
  // Analytics queries & mutations.
  'analytics-state', 'analytics-envCheck', 'analytics-datasets', 'analytics-upload', 'analytics-importWorkFile',
  'analytics-removeDataset', 'analytics-profile', 'analytics-preview', 'analytics-autodetect',
  'analytics-runs', 'analytics-query', 'analytics-drift', 'analytics-runStart',
  'analytics-runCancel', 'analytics-runGet', 'analytics-runDelete', 'analytics-runPublishReport', 'analytics-renderManim',
  'analytics-analystChat', 'analytics-llmConfirm', 'analytics-cleanPlan', 'analytics-cleanApply',
  'analytics-zeroShotClassify', 'analytics-zeroShotApply',
  'analytics-rlDetect', 'analytics-rlRun', 'analytics-rlAlStart', 'analytics-rlAlPairs',
  'analytics-rlAlLabel', 'analytics-rlAlClose',
  'analytics-nexusState', 'analytics-nexusSync', 'analytics-nexusLogs',
  'analytics-embed3d', 'analytics-topics',
  // Baryon Academy: curated STEM courses, progress tracking, ~/Courses discovery, and AI course/lesson/tutor calls.
  'academy-state', 'academy-listCourses', 'academy-getCourse', 'academy-deleteCourse',
  'academy-recordAttempt', 'academy-completeLesson', 'academy-resetProgress',
  'academy-generateCourse', 'academy-generateLesson', 'academy-generatePractice', 'academy-tutorAsk']);

export const LOCAL = Object.freeze([
  'minimize', 'close', 'around-notch', 'cursor-position', 'ride', 'sprite-hidden', 'window-position', 'startup-usable', 'ink-voice', 'attach-choose',
  'mini-browse-dir',
  // A web link in a reply opens in this Mac's browser; Proton opens work folders locally on this Mac.
  'open-source', 'open-in-proton', 'capture-rect',
  'browser-state', 'browser-go', 'browser-command', 'browser-place', 'browser-show', 'event-loop-stats',
  // Sweep: each Mac's window asks its own Mac's disk cleaner (sweep.mjs); Relay, its own repo syncer (relay.mjs).
  'sweep', 'relay',
  // Claude sync (claude-sync.mjs): the MacBook's window shows its sender and runs it; the mini's, what last came in.
  'claude-sync',
  // Antigravity artifacts (~/.gemini/antigravity/brain): imported locally on whichever Mac you press it on (and synced to the mini from the MacBook).
  'artifacts-import-antigravity',
  // ChatGPT (Codex) artifacts/PDFs: imports from both the mini and this MacBook.
  'artifacts-import-codex',
  // Boards local file dialogs run directly on whichever Mac triggers Export, Add image, or Open board file.
  'boards-export-file', 'boards-import-image', 'boards-open-file',
  // Vorssaint Mac Utilities runs locally on whichever Mac displays Settings.
  'vorssaint-status', 'vorssaint-action',
]);

export const OTHER = Object.freeze([
  'companion-action', 'companion-answer', 'companion-chat', 'companion-close', 'companion-cursor', 'companion-fit', 'companion-walk-start', 'companion-walk-step', 'companion-walk-stop',
  'companion-explain', 'companion-history', 'companion-mirror', 'companion-mirror-request', 'companion-open-window', 'companion-passthrough',
  'companion-ride', 'companion-spoken', 'companion-stop', 'companion-task', 'companion-toggle', 'face-chats-answer',
  'face-chats-list', 'face-chats-send', 'face-chats-state', 'face-chats-stop', 'face-chats-watch', 'face-pair',
  'face-state', 'role-set-face',
]);

export const MINI_ONLY = Object.freeze([
  'agy-check-run', 'agy-check-state', 'ambient-cancel', 'ambient-prepare', 'ambient-transcribe',
  'apply-profile', 'artifact-export', 'artifact-import-csv', 'artifact-import-link', 'artifact-open-online',
  'artifacts-import', 'automatic-vocal', 'avatar-import', 'avatar-load', 'awareness-display', 'awareness-pause',
  'books-folder',
  // Fairy Scratch in Finder: on the Mac it's on, not from the other one's window.
  'scratch-reveal',
  'calendar-check', 'calendar-connect', 'calendar-disconnect', 'calendar-help', 'calendar-import',
  'claude-import', 'connector-add', 'connector-remove', 'connector-test',
  'delete-profile', 'drive-check', 'drive-connect', 'drive-disconnect', 'drive-help', 'drive-import',
  'drive-use-google-client', 'files-add', 'files-open', 'files-remove', 'files-reveal',
  'github-clone', 'neutrino-clone', 'gmail-check',
  'gmail-connect', 'gmail-disconnect', 'gmail-help', 'gmail-import', 'gmail-use-calendar-client',
  'google-account-import', 'google-account-help', 'google-account-connect', 'google-account-switch', 'google-account-sync', 'google-account-disconnect',
  'antigravity-logout', 'antigravity-switch-account',
  'hands-free-enable', 'hook-add', 'hook-choose-folder', 'hook-remove', 'meeting-lines', 'meeting-start',
  'meeting-state', 'meeting-stop', 'meeting-summary-dismiss', 'notes-folder', 'notes-refresh', 'phone-forget',
  'phone-link-forget', 'phone-link-google', 'phone-link-keep-awake', 'phone-link-pair', 'phone-link-pair-mac',
  'phone-link-set', 'phone-link-state', 'phone-pair', 'phone-set', 'phone-state', 'pin', 'preview-detect',
  'preview-playback-ok', 'preview-start', 'preview-state', 'preview-stop', 'work-folder-choose', 'work-folder-clear',
  'push-key-choose', 'push-key-remove', 'push-state', 'push-test', 'quick-heard', 'quiz-auto', 'quiz-enable',
  'quiz-target-clear', 'quiz-ui-blocked', 'rebrand-profiles', 'save-profile', 'save-settings', 'screen-settings',
  'set-muted', 'singing-status', 'skill-remove', 'skill-save', 'spotify-connect', 'spotify-disconnect',
  'spotify-library', 'spotify-now', 'stall-report', 'start-conversation', 'subscription-login',
  'vocal-playback-ok',
  'vocal-preview', 'voice-profile', 'voice-profile-clear', 'voice-profile-save', 'voice-setup-transcribe',
  'notebook-addFolderElsewhere', 'notebook-coursesFolder', 'notebook-kbAddRoot', 'notebook-revealExport',
  'notebook-fileOpenElsewhere', 'notebook-practiceOpen',
  // Opens a paper's PDF, investigation file, or reproduction report in the Mac's own app: there, not on the face's Mac.
  'research-paperOpen', 'research-fileOpenExternal', 'repro-report-open',
  // A Lab run with your access and no sandbox, and taking away the Lab's Python or Lean: only on the Mac Fairy lives on.
  'research-approveUnsandboxed', 'research-labRemove', 'research-leanRemove',
  'analytics-envInstall',
  'secret-request-resolve'
]);

// The Remote channels that only read: after any other call from the face's Mac, this Mac's own window shows the chat
// again, so both windows show the same state.
export const READS = Object.freeze(['btw', 'state', 'speak', 'transcribe', 'prepare-local-speech', 'attach-bytes', 'attach-discard',
  'files-preview', 'files-list', 'files-status', 'session-search', 'session-recall', 'lab-journal-list', 'approvals-pending', 'approvals-recent', 'model-lists', 'plan-usage', 'token-usage',
  'artifacts-state', 'artifact-source', 'artifacts-related', 'dashboard-data', 'today-data', 'memory-state', 'promises-state',
  'check-ins-state', 'automation-state', 'skills-list', 'notes-status', 'session-directory', 'session-history-page', 'turn-item-hydrate', 'resource-monitor-state', 'failed-recordings-list', 'work-checkpoint-list', 'work-checkpoint-diff', 'secret-requests-list', 'limit-recovery-state', 'runs-projects', 'runs-list', 'runs-figure', 'benchmark-list', 'benchmark-series', 'research-brief-data', 'plan-forecast', 'compute-state', 'compute-logs', 'eval-draft', 'evals-list', 'animation-url', 'strengths-state', 'goals-list', 'goal-get', 'agent-swarm-state', 'agent-swarm-diff', 'boards-list', 'boards-get',
  // A terminal's typing changes no chat, so this Mac's window isn't asked to redraw for it.
  'terminal-start', 'terminal-write', 'terminal-resize', 'terminal-stop', 'terminal-snapshot',
  // Nor does the Simulator.
  'simulator-state', 'simulator-boot', 'simulator-shutdown', 'simulator-watch', 'simulator-unwatch', 'simulator-touch', 'simulator-key', 'simulator-type', 'simulator-button', 'simulator-appearance',
  // Nor do Sweep and Relay.
  'sweep-mini', 'sweep-peer-report', 'relay-peer-report',
  // Neutrino read queries don't touch chat state.
  'neutrino-status', 'neutrino-inbox', 'neutrino-repos', 'neutrino-repo', 'neutrino-commits', 'neutrino-commit',
  'neutrino-commit-file-diff', 'neutrino-pr', 'neutrino-pr-diff', 'neutrino-run', 'neutrino-ci-log', 'neutrino-workflows',
  'neutrino-rules', 'neutrino-vault',
  // Git & GitHub read queries don't touch chat state.
  'folder-project-stats', 'git-status', 'git-diff', 'git-pr-status', 'git-overview', 'git-log', 'git-commit-detail', 'git-path-of',
  'git-commit-file-diff', 'git-compare', 'git-history-note', 'git-compare-file-diff', 'git-activity',
  'git-branches', 'git-merge-info',
  'github-repos', 'github-repo', 'github-commit', 'github-activity', 'github-inbox', 'github-pr', 'github-pr-diff', 'github-commits',
  'calendar-status', 'gmail-status', 'drive-status', 'google-account-status', 'spotify-status', 'connectors-state',
  'claude-status', 'antigravity-status', 'subscription-status',
  // Analytics Stage 1-4: read-only dataset, profile, query, drift, AI analysis & run inspection.
  'analytics-state', 'analytics-envCheck', 'analytics-datasets', 'analytics-profile',
  'analytics-preview', 'analytics-autodetect', 'analytics-runs',
  'analytics-query', 'analytics-drift', 'analytics-runGet',
  'analytics-analystChat', 'analytics-llmConfirm', 'analytics-cleanPlan', 'analytics-zeroShotClassify',
  'analytics-rlDetect', 'analytics-rlAlPairs',
  'analytics-nexusState', 'analytics-nexusLogs',
  'analytics-embed3d', 'analytics-topics',
  // Baryon Academy read & tutor queries don't touch chat state.
  'academy-state', 'academy-listCourses', 'academy-getCourse', 'academy-tutorAsk']);

// Away 4: the channels that carry a recording or a file, which may be up to 60 MB; any other call is at most 1 MB.
export const BYTE_CHANNELS = Object.freeze(['transcribe', 'attach-bytes', 'notebook-paste', 'notebook-saveImage', 'analytics-upload']);

// Allowing a step from the face's Mac needs its approve key (Touch ID there), as from the companion; denying doesn't.
// A step marked Mac-only may be allowed from the face's Mac too, each with its own Touch ID (Away 5).
// Opening a terminal there is a shell with your access, so it needs Touch ID too.
// So does letting a work session run without asking (the phone is held to "ask"), and deleting what can't be got back:
// everything she remembers, a chat's memory, and chats.
export const NEEDS_APPROVAL = Object.freeze({ 'approval-answer': args => args[1] !== 'deny', 'work-answer': args => args[1] !== 'deny', 'terminal-start': () => true,
  'work-permission': args => args[0] === 'auto',
  // Running a Lab experiment, multi-arm Nexus sweep, figure edit, or notebook cell (when autoRun is off) from the MacBook asks Touch ID there.
  'research-approve': () => true, 'research-nexusSweep': () => true, 'research-figureAnnotate': args => args?.[3]?.autoRun !== true, 'research-kernelExec': args => args?.[1]?.autoRun !== true,
  // Sweeping the other Mac's caches, or stopping its watcher, from the MacBook's window asks Touch ID there.
  'sweep-mini': args => args[0] === 'clean' || (args[0] === 'service' && args[1] === 'uninstall'),
  'neutrino-pr-create': () => true, 'neutrino-pr-update': () => true, 'neutrino-pr-note': () => true,
  'neutrino-pr-resolve-note': () => true, 'neutrino-pr-merge': () => true, 'neutrino-run-start': () => true,
  'neutrino-run-rerun': () => true, 'neutrino-run-cancel': () => true, 'neutrino-job-approve': () => true,
  'neutrino-mirror-now': () => true, 'neutrino-create-repo': () => true, 'neutrino-backup': () => true,
  'git-commit': () => true, 'git-push': () => true, 'git-open-pr': () => true, 'git-merge': () => true,
  'git-act': args => args?.[0] !== 'fetch',
  'analytics-removeDataset': () => true,
  'analytics-runDelete': () => true,
  'analytics-runStart': args => args?.[1]?.computeTarget === 'forge',
  'analytics-cleanApply': () => true,
  'analytics-zeroShotApply': () => true,
  'analytics-rlRun': args => args?.[2]?.computeTarget === 'forge',
  'analytics-renderManim': () => true,
  'memory-clear': () => true, 'clear-memory': () => true, 'session-remove': () => true, 'sessions-remove': () => true });

// The window's events the face's window receives, in order. Others are the Mac Fairy lives on's own (its notch, its
// floating eye, its microphone, its companion) and stay there.
export const WINDOW_EVENTS = Object.freeze([
  'reply', 'progress', 'stop', 'sessions', 'session-show', 'settings', 'settings-at', 'approvals', 'artifacts', 'artifacts-related',
  'auto-model', 'plan-usage', 'file-step', 'notes', 'notebook-changed', 'quiz', 'awareness', 'quiet',
  // Away 4: her voice for a reply, and a chat changed by something else (a timer ringing, say).
  'reply-audio', 'chat-changed', 'a2ui-update', 'thought', 'handoff',
  // The notebook tutor's reply and voice.
  'notebook-tutor', 'notebook-voice',
  // Away 5: a work session's steps, and what you said you'd do.
  'work', 'promises', 'agent-swarm', 'secret-requests',
  // A terminal's output, and its shell ending.
  'terminal-data', 'terminal-exit',
  // The Simulator's devices, and its screen's frames.
  'simulator', 'simulator-frame',
  // Research's helper: its events, as they come.
  'research',
  // Analytics worker progress, env install, active run events, and UI open hand-offs.
  'analytics', 'analytics-open',
  // Benchmark watch updates (new run settled or regression alert).
  'benchmark-changed',
  // Sweep on the Mac Fairy lives on: a sweep starting, going target by target, and done.
  'sweep',
  // Miro Boards list changes when boards are created, updated, renamed or deleted.
  'boards-changed',
  // Baryon Academy course/progress updates and AI course build progress events.
  'academy',
]);

// The notebook's calls change only the notebook, whose own events keep this Mac's window up to date; so do Research's and Academy's.
export const isRead = channel => READS.includes(channel) || String(channel).startsWith('notebook-') || String(channel).startsWith('research-') || String(channel).startsWith('academy-');

const kinds = new Map([...REMOTE.map(name => [name, 'remote']), ...LOCAL.map(name => [name, 'local']), ...OTHER.map(name => [name, 'other']), ...MINI_ONLY.map(name => [name, 'mini-only'])]);
export const kindOf = channel => kinds.get(String(channel)) ?? 'mini-only';

// Away 5: calls whose answer waits on a model or a turn, however good the link: no "Waiting for your other Mac…" line
// and no 20-second limit; a dropped link still ends them (the work carries on at the other Mac).
const LONG = new Set(['btw', 'chat', 'speak', 'eval-save', 'evals-run', 'benchmark-run', 'research-brief-generate', 'compute-logs', 'compute-outputs', 'prepare-local-speech', 'failed-recording-retry', 'session-compact', 'memory-reflect', 'check-ins-run', 'schedule-run', 'watcher-look',
  'promises-check', 'model-lists', 'plan-usage-refresh', 'work-send', 'session-message', 'session-new-work', 'session-to-work', 'work-rewind', 'repro-start', 'repro-claims', 'repro-plan', 'repro-report', 'agent-swarm-plan',
  'simulator-boot', 'simulator-shutdown', 'simulator-watch',
  // A sweep, or its dry run, takes as long as the disk does.
  'sweep-mini',
  // Neutrino server calls may go over SSH to the server Mac.
  'neutrino-status', 'neutrino-inbox', 'neutrino-repos', 'neutrino-repo', 'neutrino-commits', 'neutrino-commit',
  'neutrino-commit-file-diff', 'neutrino-pr', 'neutrino-pr-diff', 'neutrino-pr-create', 'neutrino-pr-update',
  'neutrino-pr-note', 'neutrino-pr-resolve-note', 'neutrino-pr-merge', 'neutrino-run', 'neutrino-ci-log',
  'neutrino-run-start', 'neutrino-run-rerun', 'neutrino-run-cancel', 'neutrino-job-approve', 'neutrino-workflows',
  'neutrino-rules', 'neutrino-vault', 'neutrino-mirror-now', 'neutrino-create-repo', 'neutrino-backup',
  // Git network/long calls and GitHub CLI queries.
  'git-commit', 'git-push', 'git-open-pr', 'git-act', 'git-merge', 'git-walkthrough', 'git-pr-status', 'git-overview', 'model-fanout',
  'github-repos', 'github-repo', 'github-commit', 'github-activity', 'github-inbox', 'github-pr', 'github-pr-diff', 'github-commits',
  'calendar-status', 'gmail-status', 'drive-status', 'google-account-status', 'spotify-status', 'connectors-state',
  'claude-status', 'antigravity-status', 'antigravity-refresh', 'plugin-quick-connect', 'subscription-status',
  // Analytics Stage 1-8: upload, import, query, drift, profiling, AutoML, Manim & AI turns can exceed 20s.
  'analytics-upload', 'analytics-importWorkFile', 'analytics-profile', 'analytics-autodetect',
  'analytics-query', 'analytics-drift', 'analytics-runStart', 'analytics-renderManim',
  'analytics-analystChat', 'analytics-llmConfirm', 'analytics-cleanPlan',
  'analytics-cleanApply', 'analytics-zeroShotClassify',
  'analytics-rlDetect', 'analytics-rlRun', 'analytics-rlAlClose',
  'analytics-nexusSync', 'analytics-embed3d', 'analytics-topics', 'boards-ask',
  // Baryon Academy AI course/lesson/practice/tutor calls can exceed 20s.
  'academy-generateCourse', 'academy-generateLesson', 'academy-generatePractice', 'academy-tutorAsk']);
// Research's calls may wait on its helper reading PDFs or asking the connections which seats can sit.
export const isLong = channel => LONG.has(String(channel)) || String(channel).startsWith('notebook-') || String(channel).startsWith('research-');
