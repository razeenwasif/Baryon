import { startListeningSession } from './listening-start.js';
import { applyRemote, watchLink } from './remote-window.js';
import { ConditionalTask } from './conditional-task.js';
import { PlaybackIndicator } from './playback-indicator';
import { ReplyAudio } from './reply-audio';
import { ClipPlayback, speechGain } from './audio-playback.js';
import { speechRange } from './speech-audio';
import { renderReply as renderRichReply } from './reply-renderer.js';
import 'katex/dist/katex.min.css';
import './style.css';
import './settings.css';
import './remote-window.css';
import './replies.css';
import { mountA2UISurfaces } from './a2ui-renderer.js';
import './a2ui.css';
import { setupMusic } from './music';
import { Avatar } from './avatar';
import { DEFAULTS } from './defaults';
import { VocalTimer } from './vocal-timer';
import { ConversationTimer } from './conversation-timer';
import { requestMode as resolveRequestMode } from './chat-routing';
import { attachmentRow, fileActivity, setupAttachments } from './attachments.js';
import { applyNotebookSky, applyWallpaper, notebookSkyLayers, restartWallpaperVideo, wallpaperChoices, wallpaperLayers } from './wallpaper.js';
import { notebookSkyState, wallpaperState } from './wallpaper-state.js';
import { loadBgAnimOff, saveBgAnimOff, toggleBgAnimOff } from './bg-animations.js';
import { SETUP_STORAGE_KEY, shouldAutoOpenSetup } from './setup-wizard-logic.js';
import { todayPane } from './today-pane.js';
import { homeSummary } from './today.js';
import { meetingPane } from './meeting-pane.js';
import { sourcesPane } from './sources-pane.js';
import { approvalTray, drawApprovalLog } from './approval-tray.js';
import { gitPane } from './git-pane.js';
import { simulatorPane } from './simulator-pane.js';
import { sweepView } from './sweep.js';
import { relayView } from './relay.js';
import { wantsSinging } from './singing-command';
import { localRecording } from './recording';
import { VoiceGate, WAKE_REPLIES, isPlaybackEcho } from './voice-gate';
import { paintFairy, FAIRY_GRID } from './fairy-pixels.js';
import { matchWake, restoreName, dropOpeningWords, soundAgrees } from './wake-profile.js';
import { setupVoiceTraining } from './voice-setup.js';
import { setupMemorySettings } from './memory-settings.js';
import { setupPromiseSettings, promiseWhen } from './promise-settings.js';
import { mountVorssaintSettings } from './vorssaint-settings.js';
import { paintStatus, toolOfStep } from './tool-glyphs.js';
import { autoCaption, autoWhy, modelName } from './auto-caption.js';
import './tool-glyphs.css';
import { setupSessionList } from './session-list.js';
import { setupSidePane, outlinePane } from './side-pane.js';
import { artifactsPane } from './artifacts-pane.js';
import { computePane } from './compute-pane.js';
import { tracePane } from './trace-pane.js';
import { dataPane } from './data-pane.js';
import { journalPane } from './journal-pane.js';
import { filesPane } from './files-pane.js';
import { setupAutomationSettings } from './automation-settings.js';
import { setupEvalsSettings } from './evals-settings.js';
import { setupAutoChoices, setupStrengthsSettings } from './strengths-settings.js';
import { setupPhoneSettings } from './phone-settings.js';
import { setupPhoneLinkSettings } from './phone-link-settings.js';
import { setupPlanUsage } from './plan-usage.js';
import { setupModelMenu } from './model-menu.js';
import { renderSeatSettings } from './seat-settings.js';
import { setupMessageRail } from './message-rail.js';
import { setupVoiceGlow } from './voice-glow.js';
import { foldCompacted } from './compacted.js';
import { formatReplyTime } from './reply-time.js';
import { openChatNotes } from './chat-notes.js';
import { memoryCard, openProjectMemory } from './project-memory-view.js';
import { setupPalette, setupSlashMenu } from './command-palette.js';
import { workMeter } from './work-context.js';
import { parseReproduceCommand } from './goals-logic.js';
import { setupWorkView, PERMISSIONS } from './work-view.js';
import { latestTasks, setupTodoBox } from './todo-box.js';
import { linkedStrip, noteView } from './side-sessions.js';
import { createHandoffDivider, createPendingThinkingRow, createThoughtNode, updateThoughtNode } from './thought-view.js';
import { changesPane } from './changes-pane.js';
import { swarmPane } from './swarm-pane.js';
import { parseTeamworkCommand, swarmWorkBarBadge } from './swarm-logic.js';
import { setupSidebarResize } from './sidebar-resize.js';
import { setupPaneResize } from './pane-resize.js';
import { terminalPane } from './terminal-pane.js';
import { browserPane } from './browser-pane-view.js';
import { HandsFreeMicrophone } from './listening';
import './awareness.css';
import './floating-panel.css';
import './radial-menu.css';
import './bubble-glass.css';
import './workspace.css';
import './wallpaper.css';
import './dialogs.css';
import './work-folder-picker.css';
import { createWorkFolderPicker } from './work-folder-picker.js';
import { setupRadialMenu } from './radial-menu.js';
import { CursorSampler } from './cursor-tracking.js';
import { WalkingAnimation } from './walking-animation.js';
import { createComposerQueue, setupComposerQueue } from './composer-queue.js';
import { createComposerStash, setupComposerStash } from './composer-stash.js';
import { sideChatPane } from './side-chat-pane.js';
import { formatQuotedPrompt, setupQuoteSelection } from './quote-selection.js';
import { setupQuitHoldOverlay } from './quit-hold-overlay.js';
import { setupSecretRequestsBanner } from './secret-requests-ui.js';
import { createDiffAnnotationStore, formatReviewCommentsPrompt, setupDiffAnnotationChips } from './diff-annotations.js';
import './meeting.css';
import { setupMeetingPanel, meetingActive } from './meeting-panel.js';
import { icons } from './icons.js';
import { setupCalendarSettings } from './calendar-settings.js';
import { setupFilesSettings } from './files-settings.js';
import { setupGmailSettings } from './gmail-settings.js';
import { setupDriveSettings } from './drive-settings.js';
import { setupGoogleAccountSettings } from './google-account-settings.js';
import { sidebarFold } from './paper-view.js';
import { createThreadsPopover } from './threads-popover.js';
import { createActivityPopover } from './activity-popover.js';
import { createRoutinesPopover } from './routines-popover.js';
import { setupMultiTriggerMenu, serializeComposerFileLink } from './composer-triggers.js';
import { renderFanoutCard } from './model-fanout.js';
// Efficiency audit, fix 12: when the page's code had loaded, for the launch timeline.
const startupScript = Math.round(performance.now());

// Browser previews show the interface only; privileged features require Electron.
const api = window.fairy;
const $ = selector => document.querySelector(selector);
let state = { settings: DEFAULTS, history: [], hasOpenAIKey: false, hasFishKey: false };
// Tells the study notebooks Fairy's voice settings changed, once they're set up.
let notebookVoiceChanged = () => {};
// The notebook tutor's answer being read aloud: its clips, and its turn, so a newer one or Stop silences an older one.
let notebookVoiceQueue = null, notebookVoiceTurn = 0;
let workPartial = null, workText = '', workTextTimer = null, workSending = false;
let drawnHistory = '', sessionList, sidePane, busy = false, generation = 0, recorder, stream, recordingTimeout, audio, audioContext, activeVoiceQueue, avatar, pinned = false, floating = false, passthrough = false;
let activeRequestMode = null;
let radialMenu = null, modelMenu = null;
const conversationTimer = new ConversationTimer();
const vocalTimer = new VocalTimer();
try { vocalTimer.lastAttempt = Number(localStorage.getItem('stella-last-vocal')) || 0; } catch {}
let vocalRun = false, vocalFinished = Promise.resolve(), finishVocal;
let proactiveRun = false, ideasPaused = false, initialized = false;
let proactiveFinished = Promise.resolve(), finishProactive;
const voiceGate = new VoiceGate();
let ambient = { awake: true, paused: false }, listenSetup = false, listenEpoch = 0, listenFault = '', listenStatus = '', echoUntil = 0;
let micChanging=false, micFeedbackTimer, micFeedbackEpoch=0, unsubscribeMicToggle, unsubscribeSizeToggle;
let backgroundSync=()=>{}, backgroundQueued=false, rendererDisposed=false, awarenessDeadline;
function requestBackgroundSync(){if(backgroundQueued||rendererDisposed)return;backgroundQueued=true;queueMicrotask(()=>{backgroundQueued=false;if(!rendererDisposed)backgroundSync();});}
let quizInfo = { enabled: false, status: 'Off' }, lastQuizBlocked;
const BUILD_FEATURES = typeof __BARYON_FEATURES__ !== 'undefined'
  ? __BARYON_FEATURES__
  : { research: true, reproduce: true, analytics: true, academy: true, notebooks: true, studio: true, worlds: true, game: true };
const featureOn = name => Boolean(BUILD_FEATURES[name]) && (state.features ? state.features[name] !== false : true);

$('#app').innerHTML = `
  ${wallpaperLayers}
  ${notebookSkyLayers}
  <header class="titlebar"><div class="app-buttons"><button id="close-window" aria-label="Close Baryon">×</button><button id="minimize-window" aria-label="Minimize Baryon">−</button><button id="notch-window" aria-label="Full screen around the notch" title="Full screen around the notch (⌃⌘F)" hidden>⤢</button></div><div class="brand">Baryon</div></header>
  <main>
    <aside class="sidebar" aria-label="Fairy">
      <div class="sidebar-top"><button id="sidebar-search" class="side-icon" aria-label="Search chats" aria-expanded="false" title="Search chats"></button><button id="sidebar-toggle" class="side-icon" aria-label="Collapse sidebar" title="Collapse sidebar"></button></div>
      <div class="sidebar-brand"><canvas class="fairy-mini" width="80" height="80" aria-hidden="true"></canvas><span>Baryon</span></div>
      <input type="search" id="sidebar-search-input" placeholder="Search chats" aria-label="Search chats" hidden>
      <div class="side-group side-tools" role="group" aria-label="Places"><button id="sidebar-study" class="side-item" aria-pressed="false" title="Notebooks: your courses' sources, notes and exam dates">Notebooks</button><button id="sidebar-academy" class="side-item" aria-pressed="false" title="Academy: Brilliant-style interactive STEM courses &amp; AI university course builder (⌘⇧E)">Academy</button><button id="sidebar-research" class="side-item" aria-pressed="false" title="Research: investigations your three model families work on together, round by round">Research</button><button id="sidebar-runs" class="side-item" aria-pressed="false" title="Experiments: what Fairy ran for you, here and on atlas and forge, with their parameters, metrics and files">Experiments</button><button id="sidebar-goals" class="side-item" aria-pressed="false" title="Goals: what Fairy is working towards for you, step by step, until its check says done">Goals</button><button id="sidebar-boards" class="side-item" aria-pressed="false" title="Boards: infinite Miro-style visual boards and project plans">Boards</button><button id="sidebar-design" class="side-item" aria-pressed="false" title="Design: Stitch-style agentic UI studio with DESIGN.md token locking &amp; vision critique (⌘⇧D)">Design</button><button id="sidebar-analytics" class="side-item" aria-pressed="false" title="Analytics: data profiling, AutoML training &amp; record linkage (⌘⇧A)">Analytics</button><button id="sidebar-diffusion" class="side-item" aria-pressed="false" title="Studio: Image, Video &amp; Music generation with Nano Banana, Omni 1.2 Flash &amp; Lyria 3.5 (⌘⇧G)">Studio</button><button id="sidebar-worlds" class="side-item" aria-pressed="false" title="Worlds: Real-time interactive world simulation powered by Genie 4 (⌘⇧L)">Worlds</button><button id="sidebar-game" class="side-item" aria-pressed="false" title="Games: 2D/2.5D Indie Game Dev Studio backed by Photon Metal Engine (⌘⇧J)">Games</button><button id="sidebar-new-note" class="side-item" title="New note">New note</button></div>
      <div id="notebook-list"></div>
      <div class="side-chats-head"><span class="side-modes" role="group" aria-label="Show"><button id="side-mode-chat" class="side-mode" aria-pressed="true" title="Chats">Chats</button><button id="side-mode-work" class="side-mode" aria-pressed="false" title="Work: sections, folders and work sessions">Work</button></span><h2 class="side-label side-recent-label">Chats</h2><span class="side-chats-tools"><button id="select-chats" class="side-icon" aria-label="Select chats" aria-pressed="false" title="Select chats"></button><button id="threads-menu" class="side-icon" aria-label="Open threads" aria-haspopup="dialog" aria-expanded="false" title="Open threads: group &amp; jump to waiting, active, and open threads"></button><button id="new-section" class="side-icon" aria-label="New section" title="New section, to group folders (Research, Development…)"></button><button id="new-folder" class="side-icon" aria-label="New folder" title="New folder"></button></span></div>
      <div id="recent-list" class="side-recent"></div>
      <div id="selection-bar" hidden></div>
      <div id="notebook-sources" hidden></div>
      <div id="sidebar-resize" role="separator" aria-orientation="vertical" aria-label="Resize sidebar" tabindex="0" title="Drag to resize. Double-click to reset."></div>
      <div id="plan-usage" class="plan-usage" hidden></div>
      <div class="side-profile"><span id="profile-initial" aria-hidden="true"></span><span class="profile-text"><span id="profile-name"></span><span id="connection">Setup needed</span></span><button id="sidebar-pricing" class="side-plan-pill" type="button" title="Plans, Admin &amp; Pricing">Pro</button><button id="settings-button" class="side-icon" title="Settings">Settings</button></div>
    </aside>
    <nav id="action-rail" aria-label="Actions"><button id="sidebar-new-chat" class="side-item" title="New chat">New chat</button><button id="sidebar-new-work" class="side-item" title="New work session in a folder">New work session</button><button id="sidebar-new-scratch" class="side-item" title="New scratch session: work in its own folder in Fairy Scratch, with no project">New scratch session</button><button id="new-topic" class="side-item" title="Surprise me">Surprise me</button><button id="latest-news" class="side-item" title="Latest tech &amp; science">Latest news</button><button id="music-button" class="side-item" title="Music">Music</button><button id="meeting-toggle" class="side-item" aria-pressed="false" title="Meeting mode">Meeting mode</button><button id="change-avatar" class="side-item" title="Change avatar">Change avatar</button><button id="activity-bell" class="side-item" aria-haspopup="dialog" aria-expanded="false" title="Activity &amp; notifications">Activity</button><button id="routines" class="side-item" aria-haspopup="dialog" aria-expanded="false" title="Routines">Routines</button><button id="sidebar-usage" class="side-item" aria-pressed="false" title="Usage: token volume, cache efficiency, estimated cost, and plan limits (⌘⇧U)">Usage</button><button id="sidebar-plugins" class="side-item" aria-pressed="false" title="Plugins: Google Workspace, built-in integrations, and MCP connectors">Plugins</button><button id="wallpaper-toggle" class="side-item" title="Turn off background animation (pure black)" aria-pressed="false">Animations on</button></nav>
    <div class="window-tools"><div class="tool-pill"><button id="companion-toggle" aria-pressed="false" title="Keep a companion beside the window, to chat while it works">Companion</button><button id="pin" title="Keep Fairy above other windows">Pin window</button><button id="mute-voice" aria-pressed="false">Mute voice</button></div></div>
    <section class="stage"><div class="constellation"></div><div id="avatar"></div>
      <div class="avatar-hint" id="avatar-hint"><span>YOUR COMPANION, YOUR CHARACTER</span><button id="import-avatar">Load a VRM avatar <span>＋</span></button><p>Bring your own character to life.</p></div>
      <div class="stage-bottom"><div><span class="eyebrow">MEET YOUR COMPANION</span><h1 id="character-name">Fairy<span>✧</span></h1><p>A familiar voice. An extra pair of hands.</p></div></div>
      <footer><span id="status">Ready when you are</span><span>AI voice · <span id="voice-label">OpenAI</span></span></footer>
    </section>
    <header id="chat-header" class="chat-header" aria-label="Current conversation">
      <div class="chat-header-left">
        <h1 id="chat-header-title">Chat</h1>
        <span id="chat-header-repo" class="chat-head-pill" hidden></span>
      </div>
      <div class="chat-header-right">
        <span id="chat-header-input" class="chat-head-input" hidden title="Fairy needs your input or approval"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><line x1="12" y1="7.5" x2="12" y2="13"/><circle cx="12" cy="16.5" r="0.9" fill="currentColor" stroke="none"/></svg><span>Input required</span></span>
        <span id="chat-header-state" class="chat-head-status"><i id="chat-header-dot" aria-hidden="true"></i><span id="chat-header-status">Ready</span></span>
        <button id="chat-header-to-work" class="chat-head-tool" type="button" title="Convert this chat into a work session in a folder" hidden><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/></svg><span>Work</span></button>
        <button id="chat-header-proton" class="chat-head-tool" type="button" title="Open this work session’s folder in Proton" hidden><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 18 5-6-5-6"/><path d="m8 6-5 6 5 6"/><path d="m13.5 5-3 14"/></svg><span>Open in Proton</span></button>
        <button id="chat-header-pane" class="chat-head-tool" type="button" title="Toggle side panel" aria-pressed="false"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M15 4v16"/></svg><span>Pane</span></button>
        <button id="chat-header-companion" class="chat-head-tool chat-head-tool--icon" type="button" title="Show or put away companion window" aria-label="Companion window" aria-pressed="false"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="4" width="12" height="10" rx="2"/><circle cx="17.5" cy="16.5" r="3.5"/></svg></button>
      </div>
    </header>
    <section class="conversation">
      <h1 id="home-greeting">What’s on your mind?</h1>
      <p id="mode-hint">Chat naturally. Ask about something on screen to share a snapshot, or ask for the latest news.</p>
      <div id="messages" role="log" aria-live="polite"></div>
      <div id="error" role="alert" hidden></div>
      <div id="todo-box" hidden></div>
      <div id="btw" role="status" aria-live="polite" hidden></div>
      <div class="dock-shell">
        <div id="work-notch" class="work-notch" hidden>
          <div class="work-notch-left">
            <button id="notch-worktree-btn" class="work-notch-btn" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="notch-worktree-menu" title="Choose local checkout or worktree">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18"/></svg>
              <span id="notch-worktree-label">Local</span>
              <span class="work-notch-chev" aria-hidden="true">▾</span>
            </button>
            <button id="notch-new-worktree-btn" class="work-notch-btn" type="button" title="Work in an isolated git worktree branch">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 9v6M9 12h6"/></svg>
              <span id="notch-new-worktree-label">New worktree</span>
            </button>
          </div>
          <div class="work-notch-right">
            <button id="notch-branch-btn" class="work-notch-btn" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="notch-branch-menu" title="Switch, checkout, or create git branch">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M6 8.5v7M18 8.5c0 4-3 5.5-12 5.5"/></svg>
              <span id="notch-branch-label">main</span>
              <span class="work-notch-chev" aria-hidden="true">▾</span>
            </button>
            <button id="notch-proton-btn" class="work-notch-btn work-notch-proton" type="button" title="Open this work session’s folder in Proton">Open in Proton</button>
          </div>
        </div>
        <div id="notch-worktree-menu" class="work-notch-menu" role="menu" hidden></div>
        <div id="notch-branch-menu" class="work-notch-menu is-right" role="menu" hidden></div>
        <div class="dock">
          <div id="extras" class="extras-menu" hidden><button id="attach-files" class="quiet" type="button">Add files…</button><button id="compact-chat" class="quiet" type="button" title="Fold this chat’s older messages into notes Fairy keeps reading, and fold them away here (or type /compact)">Compact this chat</button><button id="convert-to-work" class="quiet" type="button" title="Attach a project folder and continue this conversation as a work session" hidden>Convert to work session…</button><button id="project-memory" class="quiet" type="button" title="What you’ve kept about this work folder, to read or forget" hidden>Project memory</button><button id="lab-journal" class="quiet" type="button" title="Dated log of what was tried, outcomes, and decisions for this folder" hidden>Lab journal</button><div class="idea-controls"><button id="pause-ideas" class="quiet">Pause ideas</button><span id="ideas-status"></span></div><div id="screen-options"><label for="screen-display">Screen to share when asked</label><select id="screen-display" aria-label="Display to share"><option value="">Main display</option></select><button id="screen-settings" class="quiet">Screen access ↗</button></div></div>
          <div id="permission-menu" class="permission-menu" role="menu" hidden></div>
          <div id="secret-requests-banner" class="secret-requests-banner" hidden></div>
          <div id="composer-queue" class="composer-queue" hidden></div>
          <div class="composer"><div id="composer-review-chips" hidden></div><div id="composer-quotes" hidden></div><div id="attachments" hidden></div><textarea id="message" rows="1" maxlength="12000" placeholder="Ask Fairy anything" aria-label="Message Fairy"></textarea></div>
          <div class="composer-row"><button id="extras-toggle" aria-label="More options" aria-expanded="false" aria-controls="extras" title="More options"></button><div id="work-bar" hidden><span id="work-folder"></span><select id="work-where" aria-label="Where this chat works" title="Its own branch means a separate checkout, so your folder stays as it is"><option value="here">In this folder</option><option value="own">On its own branch</option></select><span id="work-branch" hidden></span><button id="work-permission" type="button" data-permission="ask" aria-label="Ask first — what Fairy may do without asking" aria-haspopup="menu" aria-expanded="false" aria-controls="permission-menu" title="Ask first — what Fairy may do without asking">Ask first</button><button id="work-swarm-btn" class="work-swarm-btn" type="button" aria-label="Swarm" title="Deploy parallel agents (/swarm)">Swarm</button><span id="work-meter" hidden></span></div><button id="share-screen" title="Ask about what's on your screen" aria-label="Share screen"></button><button id="stash-draft" type="button" aria-label="Stash draft" aria-expanded="false" title="Stash current draft for later (⌥⇧S)"></button><div id="suggestions"><button data-prompt="What’s on my calendar this week?" class="suggest-calendar" aria-label="What’s on my calendar this week?"></button><button data-prompt="Check my unread email" class="suggest-mail" aria-label="Check my unread email"></button><button data-screen="Explain what’s on my screen." class="suggest-screen" aria-label="Explain what’s on my screen"></button></div><div class="mode-switch" role="group" aria-label="Conversation mode"><button class="selected" data-mode="chat">Chat</button><button data-mode="desktop">Desktop</button></div><span class="composer-gap"></span><button id="provider-button" aria-label="Provider"></button><button id="provider-label"></button><button id="effort-label" aria-label="Effort"></button><div class="composer-actions"><button id="record" class="mic" title="Start recording"><span>Talk to Fairy</span><i class="record-wave" aria-hidden="true"><b></b><b></b><b></b><b></b><b></b></i></button><button id="stop" class="quiet" hidden>Stop ■</button><button id="send" aria-label="Send message">↑</button></div></div>
        </div>
      </div>
      <div id="home-today" class="home-today" aria-label="Today at a glance" hidden></div>
      <div id="meeting-panel" hidden></div>
    </section>
    <section id="notebook-view" aria-label="Notebooks" hidden></section>
    <section id="academy-view" aria-label="Academy" hidden></section>
    <section id="research-view" aria-label="Research" hidden></section>
    <section id="diffusion-view" aria-label="Studio" hidden></section>
    <section id="worlds-view" aria-label="Worlds" hidden></section>
    <section id="game-view" aria-label="Games" hidden></section>
    <section id="runs-view" aria-label="Experiments" hidden></section>
    <section id="goals-view" aria-label="Goals" hidden></section>
    <section id="boards-view" aria-label="Boards" hidden></section>
    <section id="design-view" aria-label="Design" hidden></section>
    <section id="analytics-view" aria-label="Analytics" hidden></section>
    <section id="plugins-view" aria-label="Plugins" hidden></section>
    <section id="usage-view" aria-label="Usage" hidden></section>
    <section id="pricing-view" aria-label="Plans &amp; Pricing" hidden></section>
    <section id="neutrino-view" aria-label="Neutrino" hidden></section>
    <aside id="side-pane" aria-label="Side panel" hidden></aside>
    <nav id="pane-rail" role="tablist" aria-orientation="vertical" aria-label="Side panel"></nav>
  </main>
  <div id="floating-ui" hidden><div id="floating-bubble" hidden><div id="floating-bubble-text" tabindex="0" role="region" aria-label="Fairy response"></div><button id="close-floating-bubble" aria-label="Close reply" title="Close reply">×</button></div><div id="floating-composer"><textarea id="floating-message" rows="2" maxlength="12000" placeholder="Message Fairy…" aria-label="Message Fairy" title="Enter to send · Shift+Enter for a new line"></textarea><button id="floating-send" aria-label="Send message" title="Send message (Enter)">↑</button></div><div id="floating-controls"><span class="floating-handle" title="Drag to move · Hide/show: ⌘⇧R · Tiny/full: ⌘⇧F" aria-label="Drag to move">⠿</span><button id="floating-listening" class="icon-button" aria-label="Turn microphone on" aria-pressed="false" title="Turn microphone on (⌘⇧M)">${icons.microphoneOff}</button><span id="mic-feedback" role="status" hidden></span><span id="floating-extra-controls"><button id="floating-mic" title="Record a single message" aria-label="Record a single message">◉</button><button id="floating-mode" title="Switch mode: Chat, Screen questions, Desktop task">Chat</button><button id="floating-explain" class="icon-button" aria-pressed="false" title="Explain what you’re looking at, drawn beside it" aria-label="Explain what you’re looking at">${icons.explain}</button><button id="floating-wave" class="icon-button" title="Wave hello" aria-label="Wave hello">${icons.wave}</button><button id="floating-mute" class="icon-button" title="Mute voice" aria-label="Mute voice" aria-pressed="false">${icons.speaker}</button><button id="floating-meeting" class="icon-button" title="Meeting mode" aria-label="Meeting mode" aria-pressed="false">${icons.transcribe}</button><button id="open-workspace" title="Open workspace (Command+Shift+S)">↗</button></span><button id="floating-stop" title="Stop" aria-label="Stop">■</button><button id="floating-collapse" aria-expanded="true" aria-controls="floating-panel floating-extra-controls floating-status" aria-label="Collapse floating controls" title="Collapse floating controls">⌄</button></div><div id="floating-status">Ready when you are</div></div>
  <dialog id="settings" aria-label="Settings"><form id="settings-form" novalidate>
    <button type="button" id="close-settings" aria-label="Close settings" title="Close settings (Esc)">Close</button>
    <div class="settings-body">
    <aside class="settings-side"><div class="settings-window-buttons"><button type="button" id="settings-close-window" aria-label="Close Baryon">×</button><button type="button" id="settings-minimize-window" aria-label="Minimize Baryon">−</button></div><div class="settings-side-head"><span>Settings</span></div><input type="search" id="settings-search" placeholder="Search settings" aria-label="Search settings" autocomplete="off" autofocus><nav class="settings-nav" role="tablist" aria-label="Settings sections"><div class="settings-nav-group" role="presentation"><span class="settings-group-label">You</span><button type="button" role="tab" id="tab-companion" data-pane="companion" aria-controls="pane-companion"><span aria-hidden="true">✦</span>Companion</button><button type="button" role="tab" id="tab-appearance" data-pane="appearance" aria-controls="pane-appearance"><span aria-hidden="true">◐</span>Appearance</button><button type="button" role="tab" id="tab-voice" data-pane="voice" aria-controls="pane-voice"><span aria-hidden="true">♪</span>Voice &amp; listening</button><button type="button" role="tab" id="tab-animations" data-pane="animations" aria-controls="pane-animations"><span aria-hidden="true">☺</span>Animations</button></div><div class="settings-nav-group" role="presentation"><span class="settings-group-label">Thinking</span><button type="button" role="tab" id="tab-conversation" data-pane="conversation" aria-controls="pane-conversation"><span aria-hidden="true">❝</span>Conversation</button><button type="button" role="tab" id="tab-ideas" data-pane="ideas" aria-controls="pane-ideas"><span aria-hidden="true">✧</span>Ideas &amp; news</button><button type="button" role="tab" id="tab-notes" data-pane="notes" aria-controls="pane-notes"><span aria-hidden="true">❏</span>Notes &amp; books</button></div><div class="settings-nav-group" role="presentation"><span class="settings-group-label">Abilities</span><button type="button" role="tab" id="tab-screen" data-pane="screen" aria-controls="pane-screen"><span aria-hidden="true">▣</span>Screen &amp; quiz</button><button type="button" role="tab" id="tab-desktop" data-pane="desktop" aria-controls="pane-desktop"><span aria-hidden="true">⌘</span>Desktop tasks</button><button type="button" role="tab" id="tab-integrations" data-pane="integrations" aria-controls="pane-integrations"><span aria-hidden="true">◫</span>Integrations</button><button type="button" role="tab" id="tab-projects" data-pane="projects" aria-controls="pane-projects"><span aria-hidden="true">⌥</span>Work sessions</button><button type="button" role="tab" id="tab-automation" data-pane="automation" aria-controls="pane-automation"><span aria-hidden="true">⟳</span>Skills &amp; automation</button></div><div class="settings-nav-group" role="presentation"><span class="settings-group-label">System</span><button type="button" role="tab" id="tab-app" data-pane="app" aria-controls="pane-app"><span aria-hidden="true">⚙</span>App &amp; power</button><button type="button" role="tab" id="tab-phone" data-pane="phone" aria-controls="pane-phone"><span aria-hidden="true">▯</span>Phone</button><button type="button" role="tab" id="tab-mac-utilities" data-pane="mac-utilities" aria-controls="pane-mac-utilities"><span aria-hidden="true">⌘</span>Mac Utilities</button><button type="button" role="tab" id="tab-accounts" data-pane="accounts" aria-controls="pane-accounts"><span aria-hidden="true">⚿</span>Accounts &amp; keys</button></div><p id="settings-search-empty" class="field-note" hidden>No matching settings.</p></nav><div class="settings-side-foot" style="padding:8px 6px 2px;border-top:1px solid rgba(255,255,255,.06);display:flex;flex-direction:column;gap:4px"><button type="button" id="open-pricing-from-settings" class="quiet" style="width:100%;text-align:left">Plans &amp; Pricing…</button><button type="button" id="open-setup-wizard" class="quiet" style="width:100%;text-align:left">Setup &amp; Guide…</button></div></aside>
    <div class="settings-panes">
    <section class="settings-pane" id="pane-companion" data-pane="companion" role="tabpanel" aria-labelledby="tab-companion" hidden><h3>Companion</h3><p class="settings-intro">Who your companion is and what it remembers about you.</p>
    <section id="profiles-settings"><h4>Profiles</h4><p class="field-note">A profile keeps a companion’s name, personality, voice, conversation ideas, avatar and animation switches. Providers, keys and folders stay shared. Switching applies a profile immediately.</p>
    <div class="field-grid"><label>Profile<select id="profile-select"></select></label><div class="profile-actions"><button type="button" id="profile-apply" class="quiet">Switch to this profile</button><button type="button" id="profile-delete" class="quiet">Delete</button></div></div>
    <div class="field-grid"><label>Save current setup as<input id="profile-name" maxlength="40" placeholder="Profile name" autocomplete="off"></label><div class="profile-actions"><button type="button" id="profile-save" class="quiet">Save profile</button></div></div>
    <p id="profile-status" class="field-note" role="status">Save settings first to include unsaved changes in a new profile.</p></section>
    <label>Companion name<input name="name" required maxlength="160"></label><label>Your name<input name="userName" maxlength="60" placeholder="Shown in the greeting"></label><p class="field-note">Your name is only used for the greeting and sidebar in this window.</p>
    <label>Personality<textarea name="personality" rows="4" maxlength="12000" required></textarea></label>
    <label>Things to remember<textarea name="memory" rows="3" maxlength="12000" placeholder="Your name, preferences, and things you'd like Fairy to know…"></textarea></label>
    <p class="field-note">Saved on this Mac and included with conversations. Recent chat history is also remembered; older turns fall outside the context window.</p>
    <label>Conversation recall<select name="longTermMemory"><option value="on">On · recall relevant older conversations</option><option value="off">Off · recent chat and saved notes only</option></select></label>
    <label>Remembered facts<textarea name="rememberedFacts" rows="3" maxlength="12000" placeholder="One fact per line. You can also say: Remember that…"></textarea></label>
    <p class="field-note">Say “Remember that…” to save a fact or “Forget that…” with its exact wording to remove it. You can edit these notes here. Older conversations are searched locally by topic; up to three relevant excerpts accompany your current request. No screenshots or audio are stored in recall.</p>
    <button id="clear-memory" type="button" class="quiet">Clear older conversation recall</button>
    <p class="field-note" id="memory-status"></p>
    </section>
    <section class="settings-pane" id="pane-conversation" data-pane="conversation" role="tabpanel" aria-labelledby="tab-conversation" hidden><h3>Conversation</h3><p class="settings-intro">The provider and model Fairy uses to chat. Screen and news features may route through Codex.</p>
    <label>Conversation provider<select name="backend"><option value="deepseek">DeepSeek API · platform.deepseek.com</option><option value="codex">ChatGPT subscription · Codex</option><option value="claude">Claude subscription · Claude Code</option><option value="antigravity">Gemini subscription · Antigravity CLI</option><option value="openai">OpenAI API · separate billing</option></select></label>
    <div id="deepseek-settings"><p class="field-note">Screen questions use DeepSeek Flash vision with your DeepSeek key. Ask “Explain the diagram on my screen.” Fairy briefly hides, captures your selected display in memory, and releases that snapshot after the request. No screenshot files are saved. Regular chat uses the conversation model below. Desktop actions use the separate desktop provider and model.</p></div>
    <div id="claude-settings" hidden><label>Claude model<input name="claudeModel" required></label><p class="field-note">Used for Fable text chat. Screen questions and live news use Codex. Google tools use the provider chosen under Integrations. Sign in under Accounts &amp; keys.</p></div>
    <div id="antigravity-settings" hidden><label>Gemini model<select name="antigravityModel" required></select></label><p id="antigravity-status" class="field-note">Checking the Antigravity CLI…</p><p class="field-note">Chat, screen questions and live news searches use Gemini through agy. Screen questions give a minimal agent one private screenshot file to view, and live searches use a separate agent limited to web search and page reading; both stop if Gemini reaches for any other tool. With ongoing screen awareness on, chat replies also see your current screen through the vision agent. Desktop tasks use the desktop provider.</p></div>
    <label>Conversation model<input name="model" required placeholder="deepseek-chat"></label>
    <label>Thinking effort<select name="reasoning"><option value="low">Low · quicker conversation</option><option value="medium">Medium</option><option value="high">High</option></select></label>
    <details class="field-note"><summary>Last reply timing</summary><p id="reply-timing">Send a message to measure response and voice timing on this Mac.</p></details>
    <div id="auto-by-task" class="automation-section"><h4>Auto by task</h4>
    <label>Pick the model by the kind of task<select name="autoByTask"><option value="off">Off · Auto picks only the size, on your provider</option><option value="on">On · for the kinds ticked below, the model the table below favours</option></select></label>
    <p class="field-note">With it on, a new chat or a new work session of a kind you tick may start on another provider’s model when the table shows it clearly ahead on your own evals, and helper jobs inside a work turn may too. Once a chat or session has started it stays where it is. The line under the reply says so, and Choose another there answers again on a different one. Turn a kind on only after <code>node scripts/strengths.mjs compare</code> shows it ahead.</p>
    <fieldset class="auto-checks"><legend>Kinds it picks for</legend><label class="auto-check"><input type="checkbox" data-auto-kind="code">Code</label><label class="auto-check"><input type="checkbox" data-auto-kind="maths">Maths</label><label class="auto-check"><input type="checkbox" data-auto-kind="circuits">Circuits</label><label class="auto-check"><input type="checkbox" data-auto-kind="research">Research</label><label class="auto-check"><input type="checkbox" data-auto-kind="data">Data</label><label class="auto-check"><input type="checkbox" data-auto-kind="business">Business</label><label class="auto-check"><input type="checkbox" data-auto-kind="writing">Writing</label><label class="auto-check"><input type="checkbox" data-auto-kind="vision">Vision</label><label class="auto-check"><input type="checkbox" data-auto-kind="teaching">Teaching</label></fieldset>
    <label>When the web numbers are a month old, or a new model appears<select name="strengthsRefresh"><option value="ask">Ask me first</option><option value="auto">Read them again on their own · a light scout turn per page</option></select></label>
    <fieldset class="auto-checks"><legend>Providers Auto may use</legend><label class="auto-check"><input type="checkbox" data-auto-provider="claude">Claude</label><label class="auto-check"><input type="checkbox" data-auto-provider="gemini">Gemini</label><label class="auto-check"><input type="checkbox" data-auto-provider="codex">Codex</label></fieldset>
    <input type="hidden" name="autoKinds"><input type="hidden" name="autoProviders"></div>
    <div id="strengths-pane" class="automation-section"></div>
    </section>
    <section class="settings-pane" id="pane-appearance" data-pane="appearance" role="tabpanel" aria-labelledby="tab-appearance" hidden><h3>Appearance</h3><p class="settings-intro">The picture behind Fairy’s window. It moves slowly, and the window takes its colour from it.</p>
    <fieldset class="wallpaper-choices"><legend>Window background</legend>${wallpaperChoices()}</fieldset>
    <label>Motion<select name="wallpaperMotion"><option value="flowing">Flowing</option><option value="gentle">Gentle</option><option value="still">Still</option></select></label>
    <label>Move with Fairy<select name="wallpaperReactive"><option value="on">On · livelier while she works</option><option value="off">Off</option></select></label>
    <label>Dim behind messages<output id="wallpaper-dim-value"></output><input type="range" name="wallpaperDim" min="0" max="100" step="5"></label>
    <label>Today summary on Home<select name="homeToday"><option value="on">On · show next event, unread mail &amp; active chats</option><option value="off">Off · keep Home clear</option></select></label>
    <p class="field-note">The background stops moving while Fairy’s window is hidden or in the background, while Settings is open, in Low Power Mode and with Reduce Motion on.</p>
    </section>
    <section class="settings-pane" id="pane-voice" data-pane="voice" role="tabpanel" aria-labelledby="tab-voice" hidden><h3>Voice &amp; listening</h3><p class="settings-intro">How Fairy hears you and how she sounds.</p>
    <label>Speech recognition provider<select name="transcriptionProvider"><option value="apple">Local · Apple · no API charges</option><option value="fish">Fish Audio</option><option value="openai">OpenAI API · requires an API key</option></select></label>
    <div id="local-speech-settings" hidden><label>Local recognition language<input name="localLanguage" maxlength="35" placeholder="en-AU" required></label><p class="field-note">For example: en-AU, en-US, en-GB, fr-FR, de-DE, es-ES, ja-JP. Requires macOS 26 and a supported language. Initial setup may download an Apple speech model. Your audio stays on this Mac; the transcript goes to your conversation provider.</p><button type="button" id="prepare-local-speech" class="quiet">Set up local speech</button><button type="button" id="cancel-local-speech" class="quiet" hidden>Cancel setup</button><p id="local-speech-status" class="field-note" role="status"></p></div>
    <label>OpenAI recognition model<input name="transcriptionModel" required></label>
    <div class="field-grid"><label>Voice provider<select name="voiceProvider"><option value="fish">Fish Audio · custom character voice</option><option value="openai">OpenAI</option><option value="off">Text only</option></select></label><label>OpenAI voice<input name="voice" placeholder="coral"></label></div>
    <label>Voice volume<output id="voice-volume-value"></output><input type="range" name="voiceVolume" min="5" max="100"></label>
    <p class="field-note">Only her voice on this Mac. Other apps and your Mac’s volume stay as they are.</p>
    <button type="button" id="test-voice-volume" class="quiet">Test volume</button><p id="voice-volume-status" class="field-note" role="status"></p>
    <label>OpenAI speech model<input name="speechModel" required></label>
    <div class="field-grid"><label>Fish voice model ID<input name="fishVoiceId" placeholder="Your saved voice ID"></label><label>Fish speech model<input name="fishModel" placeholder="s2.1-pro-free"></label></div>
    <h4>Quick keys</h4>
    <div class="field-grid"><label>Hold to talk<select name="quickHold"><option value="control+option">⌃⌥ Control–Option</option><option value="control+shift">⌃⇧ Control–Shift</option><option value="option+shift">⌥⇧ Option–Shift</option><option value="off">Off</option></select></label><label>Tap for a text box<select name="quickTap"><option value="option+command">⌥⌘ Option–Command</option><option value="control+command">⌃⌘ Control–Command</option><option value="shift+command">⇧⌘ Shift–Command</option><option value="off">Off</option></select></label></div>
    <label>Ask about an area<select name="quickArea"><option value="on">On · the hold keys and A</option><option value="off">Off</option></select></label>
    <p class="field-note">From any app. Hold the keys and speak, and let go to send; go round something with the pointer while holding and Fairy answers about it. Tap the other keys on their own for a box at the pointer. The hold keys with A (⌃⌥A at first) let you drag over part of the screen to ask about it. Pressing any other key turns them back into an ordinary shortcut. Needs Accessibility for Fairy.</p>
    </section>
    <section class="settings-pane" id="pane-screen" data-pane="screen" role="tabpanel" aria-labelledby="tab-screen" hidden><h3>Screen &amp; quiz</h3><p class="settings-intro">When Fairy looks at your screen, and practice-quiz hints.</p>
    <label>Screen requests in chat<select name="autoScreen"><option value="on">Share a snapshot when I ask about my screen</option><option value="off">Never automatically share my screen</option></select></label>
    </section>
    <section class="settings-pane" id="pane-desktop" data-pane="desktop" role="tabpanel" aria-labelledby="tab-desktop" hidden><h3>Desktop tasks</h3><p class="settings-intro">Let Fairy click, type and open apps on your primary display.</p>
    <label>Desktop provider<select name="desktopBackend"><option value="antigravity">Google · Antigravity (Gemini)</option><option value="codex">ChatGPT subscription · Codex</option><option value="claude">Claude subscription · Claude Code</option><option value="openai">OpenAI API · separate billing</option></select></label>
    <div class="field-grid"><label id="desktop-antigravity-model" hidden>Antigravity desktop model<input name="desktopAntigravityModel" required placeholder="gemini-4-neon-medium"></label><label id="desktop-openai-model">Desktop model<input name="desktopModel" required placeholder="gpt-6.1-sol"></label><label id="desktop-claude-model" hidden>Claude desktop model<input name="desktopClaudeModel" required placeholder="claude-opus-5-5"></label><label>Desktop thinking effort<select name="desktopReasoning"><option value="low">Low · quicker actions</option><option value="medium">Medium</option><option value="high">High</option></select></label></div>
    <p class="field-note">Desktop tasks use this provider and model for one request, then conversation continues with your main model. Antigravity uses your Gemini connection (defaulting to Neon Medium); Codex uses your ChatGPT sign-in; Claude Code uses your Claude subscription login from <code>claude auth login</code>; the API option requires an OpenAI API key. Local file creation and edits use the approved-folder file tools and still require an explicit request naming the file.</p>
    <label>Automatic desktop requests<select name="autoDesktop"><option value="on">On · Chat does it when I ask for something on the computer</option><option value="off">Off · show the Desktop switch, and I choose it</option></select></label>
    <p class="field-note">Direct requests such as “scroll through this document” or “open Calculator” use desktop tools for that request, then return to chat. Questions about how to do something stay in chat. Desktop requests share primary-display screenshots and follow the approval setting below.</p>
    <label>Desktop action approvals<select name="desktopApproval"><option value="smart">Smart · review risky or uncertain actions</option><option value="always">Always · review every action batch</option></select></label>
    <p class="field-note">Starting a desktop task shares primary-display screenshots with the desktop provider (OpenAI or Anthropic). Smart mode runs recognized app launches, Spotlight app searches, Safari web searches and ordinary HTTPS pages in new tabs, tab switching, scrolling, and Calculator input automatically. Safari page text is shared with the same provider during desktop tasks. Other actions pause for review. Press Command+Shift+Escape to stop.</p>
    </section>
    <section class="settings-pane" id="pane-ideas" data-pane="ideas" role="tabpanel" aria-labelledby="tab-ideas" hidden><h3>Ideas &amp; news</h3><p class="settings-intro">When Fairy starts conversations, hums, or brings up news.</p>
    <div class="field-grid"><label>Fairy starts conversations<select name="proactiveMode"><option value="on">On · bring up interesting topics</option><option value="off">Off · only respond to me</option></select></label><label>After quiet moments of about<select name="proactiveMinutes"><option value="2">2 minutes</option><option value="5">5 minutes</option><option value="10">10 minutes</option><option value="20">20 minutes</option></select></label></div>
    <p class="field-note">Occasional short thoughts and questions, using your conversation and voice providers. Pauses after two unanswered openings, during tasks, and when your Mac is locked or idle for 15 minutes. Pause ideas whenever you want.</p>
    <label>Topics to talk about<textarea name="conversationInterests" rows="2" maxlength="12000" placeholder="Anything—or add interests, topics to avoid, and how deep to go…"></textarea></label>
    <div class="field-grid"><label>Technology & science updates<select name="newsMode"><option value="on">Include live news in quiet-time topics</option><option value="off">Only fetch news when I ask</option></select></label><label>News updates at most every<select name="newsHours"><option value="3">3 hours</option><option value="6">6 hours</option><option value="12">12 hours</option><option value="24">24 hours</option></select></label></div>
    <p class="field-note">Live news uses web search through your selected conversation provider and includes source links.</p>
    <label>Saved idle dialogue<select name="idleDialogueMode"><option value="mixed">Occasionally mix in saved lines</option><option value="off">Off · keep saved lines for later</option></select></label>
    <label>Original game lines<textarea name="idleDialogueLines" rows="5" maxlength="12000" placeholder="Paste the lines you want her to say, one per line…"></textarea></label>
    <p class="field-note">Up to 30 lines, 500 characters each. Starts empty. Uses your configured voice; these are spoken text, not game recordings. Saved lines rotate between regular topics and news, respect Pause ideas and Stop, and are never rewritten by the conversation model. Save settings to use them automatically.</p>
    <button type="button" id="preview-idle-dialogue" class="quiet">Preview first line</button><p id="idle-preview-status" class="field-note" role="status">Preview uses your saved voice settings.</p>
    <div class="field-grid"><label>Quiet-time humming<select name="vocalMode"><option value="off">Off</option><option value="hum">Soft humming only</option><option value="mixed">Soft humming + occasional la-la melodies</option></select></label><label>After quiet moments of about<select name="vocalMinutes"><option value="10">10 minutes</option><option value="20">20 minutes</option><option value="40">40 minutes</option></select></label></div>
    <p class="field-note">Original phrases in your Fish voice at low volume, up to 6 seconds. Uses your Fish API plan. Requires a Spotify connection to check that music is paused; skips when playback cannot be checked. Pauses during conversations, while typing here, and when your Mac is locked or idle. Pause ideas also pauses vocals. Stop or start talking to interrupt.</p>
    </section>
    <section class="settings-pane" id="pane-animations" data-pane="animations" role="tabpanel" aria-labelledby="tab-animations" hidden><h3>Animations</h3><p class="settings-intro">Movement, gestures and reactions on screen.</p>
    <label>Pixel animations<select name="pixelEffects"><option value="on">On · thinking, quiz, speech and music</option><option value="off">Off</option></select></label>
    <p class="field-note">A working lightbulb for thinking, a lightbulb with cycling dots while quiz mode checks an answer beside the companion, a dotted bubble while speaking, and floating notes during Spotify playback or Fairy’s tunes. Spotify state refreshes about every 15 seconds on AC or 30 seconds on battery while awake; reduced-motion mode keeps the icons still.</p>
    <label class="check"><input type="checkbox" id="roaming-enabled"> Occasional walks for the companion</label><label class="check"><input type="checkbox" id="ride-along"> Ride along · when she’s idle, the companion shrinks onto your pointer</label>
    <p class="field-note">Short left/right walks after 4–7 idle minutes, within the current display. Pauses while talking, using controls, showing a reply, or conserving power. Reduced-motion preference disables walking.</p>
    <label class="check"><input type="checkbox" id="cursor-tracking-enabled"> Follow the cursor with her gaze</label><p class="field-note">Looks toward the pointer on her display, then relaxes after it stops. Pauses for conversations, other poses, reduced motion and power saving. No screenshots or cursor history are saved.</p>
    <label class="check"><input type="checkbox" id="companion-animations-enabled"> Idle gestures and Spotify headphone dancing</label>
    <p class="field-note">Hair twirls and halo adjustments every 1–2 idle minutes, star catching every 2½–5 available idle minutes, and occasional leg swinging. A short nap follows 10 awake, visible minutes without interacting with Fairy. Cursor movement and her own animations do not reset that timer. Voice and tasks take priority. Seated sessions last 10–15 minutes and cycle finger heart, chin rest and peek-a-boo; conversations pause the session. Naps begin with a yawn and finish with a stretch. Sleeping is only an animation: wake-name listening stays available. Respects reduced motion and power saving. Changes apply immediately.</p>
    <label class="check"><input type="checkbox" id="conversation-reactions-enabled"> Conversation reactions</label><p class="field-note">Brief laughter, surprise or playful pouting after replies with clear matching cues. Uses clear opening cues without an extra AI request.</p>
    <label>Preview an animation<select id="animation-preview"><option value="headphones">Headphone dancing</option><option value="stars">Star catching</option><option value="hair">Hair twirl</option><option value="halo">Halo adjustment</option><option value="sleep">Sleeping</option><option value="legs">Swinging legs</option><option value="finger">Seated · Finger heart</option><option value="chin">Seated · Chin rest</option><option value="peek">Seated · Peek-a-boo</option><option value="yawn">Yawn and stretch</option><option value="laugh">Laughing</option><option value="surprise">Surprised</option><option value="pout">Pout</option></select></label><button type="button" id="preview-animation" class="quiet">Preview on Fairy</button><p class="field-note">Closes Settings to show the animation. Stop ends the preview.</p>
    </section>
    <section class="settings-pane" id="pane-notes" data-pane="notes" role="tabpanel" aria-labelledby="tab-notes" hidden><h3>Notes &amp; books</h3><p class="settings-intro">Your second brain: Markdown notes and a PDF library.</p>
    <label>Use my notes and books in conversations<select name="notesMode"><option value="on">On · retrieve relevant excerpts locally</option><option value="off">Off</option></select></label>
    <p class="field-note">Searches your Markdown notes and PDF book library, including subfolders. Notes use semantic and keyword search; books use cached local text search. Only relevant excerpts go to your answering provider; the full index stays on this Mac. Quiz lookup has a 180 ms deadline and falls back to the screenshot. Notes are supporting evidence, not guaranteed truth. Click cited sources to inspect them.</p>
    <p id="notes-status" class="field-note" role="status"></p>
    <button type="button" id="notes-refresh" class="quiet">Refresh knowledge index</button>
    <button type="button" id="notes-folder" class="quiet">Choose notes folder…</button>
    <button type="button" id="books-folder" class="quiet">Choose books folder…</button>
    <p id="books-status" class="field-note" role="status"></p>
    <button type="button" id="notes-develop" class="quiet">Develop a new note together</button>
    <p class="field-note">Ask “What do my notes say about gradient descent?” or “Help me develop a note about this idea.” Fairy asks one focused question at a time. Drafts stay in chat until you explicitly request saving a named Markdown file. This first version indexes Markdown; Apple Notes and TextEdit imports are not connected. Hidden/private/dependency folders, Daily and Entertainment are excluded. Save settings to apply the switches.</p>
    </section>
    <section class="settings-pane" id="pane-integrations" data-pane="integrations" role="tabpanel" aria-labelledby="tab-integrations" hidden><h3>Integrations</h3><p class="settings-intro">Google Calendar, Gmail, Drive and approved local folders.</p>
    <p><button type="button" id="open-plugins-from-settings" class="quiet">Browse Plugins &amp; MCP gallery ↗</button></p>
    <div class="field-grid"><label>Google integrations provider<select name="integrationProvider"><option value="codex">ChatGPT subscription · Codex</option><option value="claude">Claude subscription · Claude Code</option><option value="antigravity">Gemini · Antigravity</option></select></label><label id="integration-claude-model" hidden>Claude integrations model<input name="integrationClaudeModel" required placeholder="claude-opus-5-5"></label></div>
    <p class="field-note">Runs Calendar, Gmail and Drive requests. Your messages and the results from these services go to the selected provider. Antigravity uses your Gemini model from Conversation and can only reach Fairy's Google tools.</p>
    <div id="integrations-pane"></div>
    <h4>Approvals</h4>
    <p class="field-note">Everything that asks for your OK, from a chat or a work session, answered here, in the companion or on your phone, goes in a log on this Mac: what was asked, for which chat and model, and the answer. It keeps no file contents, and hides anything that looks like a key.</p>
    <button type="button" class="quiet" id="approvals-show">Show recent approvals</button><div id="approvals-log"></div>
    </section>
    <section class="settings-pane" id="pane-projects" data-pane="projects" role="tabpanel" aria-labelledby="tab-projects" hidden><h3>Work sessions</h3><p class="settings-intro">Fairy working inside a folder you choose: reading and changing its files and running its commands, each step shown as it goes. Start one with New work session or <code>/work</code>.</p>
    <div class="work-folder-setting"><p class="field-note">Default work folder: what New work session offers first, and the first of the folders your MacBook and phone can start work in.</p><p id="work-folder-path" class="field-note">No default folder.</p><button type="button" id="work-folder-choose" class="quiet">Choose folder…</button> <button type="button" id="work-folder-clear" class="quiet" hidden>Clear</button></div>
    <div class="field-grid"><label>Work sessions provider<select name="workProvider"><option value="claude">Claude subscription · Claude Code</option><option value="antigravity">Gemini · Antigravity</option><option value="codex">ChatGPT subscription · Codex</option></select></label><label>Claude model for work sessions<input name="workClaudeModel" required maxlength="80"></label></div>
    <label>Effort for work sessions and pages<select name="workEffort"><option value="low">Low · quickest</option><option value="medium">Medium</option><option value="high">High</option><option value="xhigh">Extra · for big jobs</option><option value="max">Max · slowest</option></select></label>
    <label>Project memory<select name="workProjectMemory"><option value="on">On · after work, Fairy proposes findings to keep for the folder</option><option value="off">Off · nothing proposed or read</option></select></label>
    <label>After your Mac sleeps<select name="workCarryOn"><option value="on">Carry on · a turn sleep stopped picks up when it wakes</option><option value="off">Wait · the turn stays stopped until you press Carry on</option></select></label>
    <label>Move work between subscriptions<select name="workStandIns"><option value="off">Off · each job stays with your work provider</option><option value="on">On · when one is signed out, nearly full or slow to start</option></select></label>
    <label>Claude through Antigravity<select name="claudeViaAntigravity"><option value="off">Off</option><option value="on">On · a second Claude allowance for builders</option></select></label>
    <label>Who builds a swarm’s design<select name="swarmBuilder"><option value="work">Your work sessions provider</option><option value="room">Whichever has the most room on its plan</option></select></label>
    <section class="seat-models-section"><h4>Models for each role</h4><p class="field-note">Which model does each job in a work session, and designs in a /council debate, on each provider. Automatic lets Fairy choose, as before. A model you choose is used whenever its provider offers it, and the effort is still Auto’s. The lead’s choice applies with work Auto on, to a turn that needs a plan or that Auto rates heavy or harder.</p><div id="seat-models"></div></section>
    <p class="field-note">With work Auto on, Move work between subscriptions lets a job go to your other subscription (Claude Code or Antigravity) when yours is signed out, at a limit or nearly full, and quick jobs skip Antigravity’s 30-second start. A whole turn moves only when yours can’t take it. A job that moves sends its brief, the files it reads and its output to that provider, and its row in the chat says “stand-in” and why. Each job and turn is a line in routing.jsonl in Fairy’s data folder: the role, the model, why, how long and how it ended, never what was asked or said.</p>
    <p class="field-note">Pages use this provider and effort too, and can read your approved Local files folders, so what they read goes to this provider. Extra and Max use more of your plan, and only apply to Claude. The others stop at High.</p>
    <p class="field-note">Work sessions use Fairy’s own file and command tools, on your subscription. Your request, the files it reads and command output go to this provider. Commands run in a sandbox that can write only in the session’s folder, with no network unless you allow it.</p>
    <div id="evals-pane" class="automation-section"></div>
    </section>
    <section class="settings-pane" id="pane-automation" data-pane="automation" role="tabpanel" aria-labelledby="tab-automation" hidden><h3>Skills &amp; automation</h3><p class="settings-intro">Things you set up once: skills you run by name, commands that run after Fairy’s work, routines on a schedule, and connectors.</p><div id="automation-pane"></div></section>
    <section class="settings-pane" id="pane-app" data-pane="app" role="tabpanel" aria-labelledby="tab-app" hidden><h3>App &amp; power</h3><p class="settings-intro">Startup, the menu bar, and how Fairy saves battery.</p>
    </section>
    <section class="settings-pane" id="pane-phone" data-pane="phone" role="tabpanel" aria-labelledby="tab-phone" hidden><h3>Phone</h3><p class="settings-intro">Keep an eye on long work from your phone, and answer when Fairy needs your OK.</p><div id="phone-link-pane" class="automation-section"></div><div id="phone-pane" class="automation-section"></div></section>
    <section class="settings-pane" id="pane-accounts" data-pane="accounts" role="tabpanel" aria-labelledby="tab-accounts" hidden><h3>Accounts &amp; keys</h3><p class="settings-intro">Subscription sign-ins and API keys. Saved keys are encrypted on this Mac.</p>
    <div id="google-account-settings"></div>
    <section id="codex-settings"><h4>ChatGPT · Codex</h4><p class="field-note">Used for Codex chat and desktop tasks, screen questions and live news, and for Google tools when selected under Integrations.</p><p id="subscription-status" class="field-note">Checking your Codex connection…</p>
    <div class="field-grid"><button type="button" id="subscription-login" class="quiet">Sign in with ChatGPT ↗</button><button type="button" id="subscription-refresh" class="quiet">Refresh connection</button></div></section>
    <section><h4>Claude Code</h4><p id="claude-status" class="field-note">Checking Claude Code…</p><button type="button" id="claude-refresh" class="quiet">Refresh Claude connection</button><p class="field-note">Uses your Claude Code subscription login for Claude chat, Claude desktop tasks and the Fable project agent. Sign in once in Terminal with <code>claude auth login</code>, then refresh.</p></section>
    <section><h4>Gemini · Antigravity</h4><p id="accounts-antigravity-status" class="field-note">Checking the Antigravity CLI…</p><div id="agy-check-status" class="field-note" aria-live="polite"></div>
    <div class="field-grid"><button type="button" id="accounts-antigravity-switch" class="quiet">Switch Google account</button><button type="button" id="accounts-antigravity-logout" class="quiet">Sign out</button><button type="button" id="accounts-antigravity-refresh" class="quiet">Refresh</button><button type="button" id="agy-check-run" class="quiet">Check Gemini</button></div></section>
    <section><h4>API keys</h4>
    <label>OpenAI API key <span id="openai-key-status"></span><input type="password" name="openaiKey" autocomplete="off" placeholder="Paste a key to save or replace it"></label>
    <label class="check"><input type="checkbox" name="clearopenaiKey"> Remove saved OpenAI key</label>
    <label>DeepSeek API key <span id="deepseek-key-status"></span><input type="password" name="deepseekKey" autocomplete="off" placeholder="Paste your DeepSeek API key (sk-...) to save or replace it"></label>
    <label class="check"><input type="checkbox" name="cleardeepseekKey"> Remove saved DeepSeek key</label>
    <label>Gemini API key <span id="gemini-key-status"></span><input type="password" name="geminiKey" autocomplete="off" placeholder="From Google AI Studio, on a paid-tier project, for Auto"></label>
    <label class="check"><input type="checkbox" name="cleargeminiKey"> Remove saved Gemini key</label>
    <p class="field-note">Lets Auto in the model menu pick a model for each request with Google’s Gemini Decisions API (Gemini Decision 1). Each request’s words, and a little of the chat before it, go to Google to choose a size; use a key from a project with billing on, so they aren’t used to improve Google’s products. It costs about $0.0001 a request. Gemini chats still use your Antigravity sign-in, not this key.</p>
    <label>Fish Audio API key <span id="fish-key-status"></span><input type="password" name="fishKey" autocomplete="off" placeholder="Optional · needed for Fish Audio"></label>
    <label class="check"><input type="checkbox" name="clearfishKey"> Remove saved Fish key</label>
    </section>
    </section>
    </div></div>
    <div id="settings-save-bar" hidden><p id="settings-error" role="alert" hidden></p><span id="settings-bar-text" role="status">Unsaved changes</span><button type="button" id="settings-discard">Discard</button><button class="primary" type="submit" id="settings-save">Save</button></div>
  </form></dialog>
  <dialog id="avatar-dialog" aria-labelledby="avatar-dialog-title"><div class="dialog-header"><div><span class="eyebrow">Your companion</span><h2 id="avatar-dialog-title">Choose Avatar</h2></div><button type="button" id="close-avatar-dialog" class="quiet" aria-label="Close avatar selection">✕</button></div>
    <p class="field-note">Select your companion avatar style or import a custom 3D model.</p>
    <div class="avatar-list">
      <div class="avatar-card" id="avatar-choice-fairy" role="button" tabindex="0" aria-label="Select Fairy avatar">
        <div class="avatar-card-meta">
          <span class="avatar-card-title">Fairy <span class="badge">Pixel Sprite</span></span>
          <span class="avatar-card-desc">A glowing pixel-art eye. Blinks, follows your cursor, scans while thinking, glows while speaking, bounces to music and naps.</span>
        </div>
        <span class="avatar-card-status" id="status-choice-fairy">Select</span>
      </div>
      <div class="avatar-card" id="avatar-choice-lyra" role="button" tabindex="0" aria-label="Select the classic Fairy avatar">
        <div class="avatar-card-meta">
          <span class="avatar-card-title">Fairy (classic) <span class="badge">Pixel Sprite</span></span>
          <span class="avatar-card-desc">High-fidelity pixel art avatar with fluid multi-pose animations and audio reactivity.</span>
        </div>
        <span class="avatar-card-status" id="status-choice-classic">Active</span>
      </div>
      <div class="avatar-card" id="avatar-choice-stella" role="button" tabindex="0" aria-label="Select 3D avatar">
        <div class="avatar-card-meta">
          <span class="avatar-card-title">3D avatar <span class="badge">3D Model</span></span>
          <span class="avatar-card-desc">Original 3D anime companion with physics-based hair and clothing, customizable arm poses, and OrbitControls.</span>
        </div>
        <span class="avatar-card-status" id="status-choice-3d">Select</span>
      </div>
      <div class="avatar-card" id="avatar-choice-custom" role="button" tabindex="0" aria-label="Import custom VRM avatar">
        <div class="avatar-card-meta">
          <span class="avatar-card-title">Custom avatar <span class="badge">VRM</span></span>
          <span class="avatar-card-desc">Load your own .vrm 3D model file from your Mac.</span>
        </div>
        <span class="avatar-card-status" id="status-choice-custom">Import ↗</span>
      </div>
    </div>
  </dialog>`;
// The glow along the bottom of the chat page while you talk to her (voice-glow.js).
const voiceGlow = setupVoiceGlow({ host: $('.conversation').parentElement });

$('#floating-composer').insertAdjacentHTML('afterend', '<div id="floating-ideas-bar"><button id="floating-new-topic">Surprise me</button><button id="floating-news">News</button><button id="floating-pause-ideas">Pause ideas</button></div>');
try{const saved=localStorage.getItem('stella-last-reply-timing');if(saved)$('#reply-timing').textContent=saved;}catch{}
const awarenessControls = prefix => `<div class="awareness-controls" id="${prefix}awareness"><div><button id="${prefix}hands-free" class="quiet" title="Toggle local wake-name listening · ⌘⇧M">Hands-free off</button><button id="${prefix}pause-awareness" class="quiet" title="Pause/resume screen awareness and microphone · ⌘⇧P">Pause senses</button></div><span id="${prefix}awareness-status" role="status"></span></div>`;
$('#screen-options').insertAdjacentHTML('afterend', awarenessControls(''));
$('#floating-ideas-bar').insertAdjacentHTML('afterend', awarenessControls('floating-'));
for (const prefix of ['', 'floating-']) $(`#${prefix}awareness>div`).insertAdjacentHTML('beforeend', `<button id="${prefix}quiz-hints" class="quiet" title="Silent practice-quiz answer choices · ⌘⇧H">Quiz hints off</button><button id="${prefix}quiz-auto" class="quiet" title="Manual targeting; switch to automatic targeting · ⌘⇧T" aria-label="Manual targeting; switch to automatic targeting · ⌘⇧T" aria-pressed="false">⏸</button>`);
const floatingPanel = document.createElement('div');
floatingPanel.id = 'floating-panel';
$('#floating-composer').before(floatingPanel);
for (const id of ['#floating-composer', '#floating-ideas-bar', '#floating-awareness']) floatingPanel.append($(id));
let floatingCollapsed = false;
try { floatingCollapsed = localStorage.getItem('stella-floating-collapsed') === 'true'; } catch {}
function updateFloatingPanel() {
  $('#floating-ui').classList.toggle('is-collapsed', floatingCollapsed);
  for (const id of ['#floating-panel', '#floating-extra-controls', '#floating-status']) $(id).hidden = floatingCollapsed;
  const toggle = $('#floating-collapse');
  toggle.setAttribute('aria-expanded', String(!floatingCollapsed));
  toggle.title = floatingCollapsed ? 'Expand floating controls' : 'Collapse floating controls';
  toggle.setAttribute('aria-label', toggle.title);
  toggle.textContent = floatingCollapsed ? '⌃' : '⌄';
}
$('#floating-collapse').onclick = () => {
  floatingCollapsed = !floatingCollapsed;
  updateFloatingPanel();
  try { localStorage.setItem('stella-floating-collapsed', String(floatingCollapsed)); } catch {}
};
updateFloatingPanel();

let floatingTiny = false;
// The pen in floating Fairy's menu: when armed, the next question is drawn on the screen (see armExplain).
let explainArmed = false;
try { floatingTiny = localStorage.getItem('robin-floating-tiny') === 'true'; } catch {}
function updateFloatingSize() {
  document.documentElement.classList.toggle('floating-tiny', floatingTiny);
}
function toggleFloatingSize() {
  walkController?.cancel();
  setSpriteHovered(false);
  floatingTiny = !floatingTiny;
  updateFloatingSize();
  try { localStorage.setItem('robin-floating-tiny', String(floatingTiny)); } catch {}
  replaceStatus();
}
// The eye moves on its next frame after a layout change; place the status line once it has.
function replaceStatus() { if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(() => radialMenu?.place())); }
updateFloatingSize();

// Settings defined outside the main template, grouped into their panes.
$('#pane-screen').insertAdjacentHTML('beforeend', `
    <label>Ongoing screen awareness<select name="screenAwareness"><option value="off">Off · snapshots only when requested</option><option value="on">On · current screen with each conversation</option></select></label>
    <p class="field-note">Screen awareness keeps one snapshot in memory, refreshed about every 5 seconds on AC or 15 seconds on battery while Fairy is running and your Mac is awake and unlocked. Your selected display is sent to the conversation provider with chat replies and ordinary conversation starters. Screenshots are not saved by Fairy; no video stream is uploaded. Fairy may appear in these snapshots. News and saved idle lines do not use them.</p>
    <h4>Quiz hints</h4>
    <div class="field-grid"><label>Quiz hints provider<select name="quizProvider"><option value="codex">ChatGPT subscription · Codex GPT-6 Astra</option><option value="claude">Claude subscription · Claude Code</option></select></label><label id="quiz-claude-model" hidden>Claude quiz model<input name="quizClaudeModel" required placeholder="claude-opus-5-5"></label></div>
    <p class="field-note">Quiz screenshots go to the selected provider. Claude Code starts a fresh, tool-free session for each question, so answers usually take a little longer than with Codex.</p>
    <label>Ground quiz answers in my notes and books<select name="quizNotes"><option value="on">On · quick lookup when ready</option><option value="off">Off · screenshot only</option></select></label>
    <label>Written quiz answers to clipboard<select name="quizClipboard"><option value="on">On · copy answer and show a star</option><option value="off">Off · choices only</option></select></label>
    <details class="field-note"><summary>How quiz hints work</summary><p>Practice quiz hints start enabled with manual targeting. Toggle them in either layout or press ⌘⇧H. Quiz hints take their own temporary screen snapshots while enabled; ongoing screen awareness can stay off. Quiz hints use the quiz provider selected above (Codex with GPT-6 Astra, or Claude Code with your Claude sign-in), independently of the conversation model. Fairy automatically remembers up to twelve settled quiz questions in memory for 20 minutes after they were last visible or needed by a follow-up, including screenshots for figures and diagrams. Recently needed setup is kept preferentially when the buffer fills. A setup declared for a range such as questions 2–7 supplies its original graph and text throughout that set. References such as “the feasible region described above” retrieve that source setup. Show the setup and graph first; after restarting Fairy, revisit that setup once. There is no 30-second wait. Up to two earlier questions can accompany a follow-up to Codex; only the current question is answered. Hover over Quiz hints to see the saved-question count. Switching apps or opening Fairy’s controls keeps the setup for a return to the same quiz window and title. Up to three separate sources share the total memory limits. Turning quiz hints off, pausing, or starting a conversation clears this context. Nothing is saved to disk by the question buffer. Hold the pointer over a “Question 1” heading for about half a second to select it. Hover checks run between screen scans and verify the selection on a fresh capture. Split labels and headings such as “Question 1 of 10” are supported; ▶ means automatic targeting is on; click it for ⏸ manual targeting, which waits for you to hover a question heading. Selecting a heading also switches to manual targeting. Click ⏸ to resume automatic targeting and clear the lock. Six concentric rings in a Liquid Glass capsule stay beside Fairy’s bird in one item in the macOS menu bar while Fairy is open. Click to show or hide Fairy; right-click for Fairy’s menu. Hold ⌘ and drag the combined item toward the right to reposition both together. The rings and dots stay dim and still when hints clear, pause or turn off; quitting Fairy removes the icon. A highlight travels outward and back inward while Fairy thinks, then fills outward through the answer number. Count from the centre outward: C or position 3 lights rings 1 through 3; position 5 lights rings 1 through 5. Six small dots beside the rings are stacked from option 1 at the top to option 6 at the bottom. The dots follow the thinking highlight, then mark only the exact selected options. For multiple selections, the rings fill through the highest selected position from 1–6 and the dots identify each choice. Choices above six appear in a small number badge. Yes/No use a glass sun/crescent. True highlights rings 1 and 6; False highlights rings 2 and 5, counted from the centre outward. Reduced Motion keeps the thinking rings still. With written quiz answers enabled, a complete long-answer question copies a concise suggested answer of one or two sentences to your clipboard once per question in the current session; a subtle, snake-like arc slowly rotates around the outer ring in the menu bar to confirm the copy; Reduced Motion keeps that ring highlighted without rotation. The option dots stay dim during clipboard confirmation. This replaces the clipboard text, so paste elsewhere with ⌘V to compare. Choice questions still show only symbols, and nothing is spoken. Fairy waits briefly for scrolling to settle before requesting an answer. Unclear questions leave the rings and dots dim until new evidence is visible. AI choices can be wrong. The menu-bar hint stays available while Fairy is hidden; its monochrome symbols adapt to light and dark mode. Stop or ⌘⇧Esc turns the mode off; each app launch starts with quiz hints on and manual targeting. Use ⌘⇧R to hide/show Fairy, ⌘⇧F to toggle tiny/full size, ⌘⇧H to toggle quiz hints, ⌘⇧T to toggle automatic/manual targeting, ⌘⇧M for hands-free, and ⌘⇧P to pause/resume senses. Ideas and automatic vocals pause during a quiz session.</p></details>`);
$('#pane-voice').insertAdjacentHTML('beforeend', `
    <h4>Hands-free</h4>
    <label>Hands-free voice<select name="handsFree"><option value="off">Off · press the microphone to talk</option><option value="on">On · listen locally for my companion's name</option></select></label>
    <label>After a hands-free reply<select name="voiceFollowups"><option value="on">Accept follow-ups for 12 seconds</option><option value="off">Require the wake name every time</option></select></label>
    <p class="field-note">Say “Fairy,” or your companion's name at the start. Wake recognition always uses Apple local speech, independently of the manual recording provider. It does not identify who is speaking. Nearby people or media saying her name can also activate it. Say “Fairy, stop listening” to turn it off, or “that's all” to end follow-ups.</p>
    <label>Interrupt by speaking<select name="voiceBargeIn"><option value="on">On · say her name to interrupt</option><option value="off">Off · use the Stop button</option></select></label>
    <p class="field-note">When enabled, local listening continues during replies. Say “Fairy, stop” or “Fairy,” followed by your new question. Recognition waits for a short pause. Wake names are required during playback; echo cancellation helps, and headphones work best. This does not identify individual speakers.</p>
    <p class="field-note">Use ⌘⇧M from any app or the microphone in the companion’s ring to toggle hands-free listening. The crossed-out mic means off; a dot means listening. The single-message recorder remains in expanded controls. Pause senses stops both features and stays paused across restarts. Listening pauses during desktop tasks and settings, and during replies unless Interrupt by speaking is enabled. Stop or ⌘⇧Esc always interrupts. Audio snippets are processed locally and deleted; only addressed messages enter chat. Both features stop on lock or sleep and resume when unlocked. Quit Fairy to stop them completely.</p>
    <h4>Meeting mode</h4>
    <div class="field-grid"><label>Meeting transcript length<select name="meetingMinutes"><option value="10">Last 10 minutes</option><option value="30">Last 30 minutes</option><option value="60">Last 60 minutes</option></select></label><label>Meeting microphone<select name="meetingMicrophone"><option value="on">Include my microphone</option><option value="off">Meeting audio only</option></select></label><label>When a meeting ends<select name="meetingSummary"><option value="on">Write a summary</option><option value="off">Just clear the transcript</option></select></label></div>
    <p class="field-note">Meeting mode transcribes audio playing on your Mac (other participants) and optionally your microphone, using Apple speech recognition on this device and your local recognition language. It needs Screen &amp; System Audio Recording permission. The transcript stays in memory, is sent to your conversation provider only with messages you send, and is cleared when meeting mode ends, after 20 quiet minutes, or when your Mac locks. When it ends, it goes to your provider once more for a summary in the Meeting panel, unless you choose to just clear it; the summary isn’t saved either. Fairy's own voice is excluded from meeting audio; with speakers and the microphone on, others may also appear as You, so headphones work best. Ideas and automatic vocals pause during a meeting. Tell participants the meeting is being transcribed.</p>`);
$('#pane-app').insertAdjacentHTML('beforeend', `
    <label>Open at login<select name="startAtLogin"><option value="off">Off · start Fairy yourself</option><option value="on">On · Fairy starts with macOS</option></select></label>
    <p class="field-note">With the menu bar bird, closing the window leaves Fairy running in the background; choose Quit Fairy there or in the menu bar to stop her. The companion (⌘⇧S) stays visible across Spaces and full-screen apps.</p>
    <p class="field-note" id="power-status" role="status">Power awareness is automatic.</p><p class="field-note">On battery or in macOS Low Power Mode, Fairy reduces animation to 20 FPS and checks the screen and music less often. At 20% battery or below while unplugged, or when macOS reports serious heat, background sensing, quiz checks, and spontaneous activity pause. Critical heat also pauses wake listening and animation. Explicit requests remain available. Normal activity returns after 30 seconds of recovery.</p>
    <h4>Onboarding &amp; Feature Guide</h4>
    <p class="field-note">Walk through providers, Google Account Hub, workspace modes, permissions, wallpapers, iPhone pairing, and CLI tools anytime.</p>
    <button type="button" id="open-setup-wizard-app" class="quiet">Open Baryon Setup &amp; Feature Guide…</button>`);

setupMusic({ api, openWorkspace: () => {}, previewVocal });

let mode = 'chat', spokenReply = '', replyFinished = Promise.resolve();
$('#integrations-pane').insertAdjacentHTML('beforeend', '<div id="calendar-settings"></div>');
$('#pane-phone').insertAdjacentHTML('afterend', '<section class="settings-pane" id="pane-mac-utilities" data-pane="mac-utilities" role="tabpanel" aria-labelledby="tab-mac-utilities" hidden><h3>Mac Utilities</h3><p class="settings-intro">Dynamic Island, Teleprompter, AI Launcher, Hadron sync, unified tray, and macOS controls powered by Vorssaint.</p><div id="vorssaint-settings-root"></div></section>');
const vorssaintSettings = mountVorssaintSettings($('#vorssaint-settings-root'), api);
const memorySettings = setupMemorySettings({ api, root: $('#pane-companion') });
const promiseSettings = setupPromiseSettings({ api, root: $('#pane-ideas') });
// A promise just picked up: a quiet line in the status, so you know she caught it.
api?.onPromisesAdded?.(added => { const first = added?.[0]; if (first && !busy) status(`Noted: ${first.what} · ${promiseWhen({ due: first.due ? (first.dayOnly ? first.due : `${first.due}:00`) : null, allDay: first.dayOnly })}${added.length > 1 ? ` (+${added.length - 1})` : ''}`); });
// The sidebar's mode (Chat or Work), remembered in this window only; the list itself is the same on every Mac.
const SIDEBAR_MODE_KEY = 'fairy-sidebar-mode';
const savedSidebarMode = () => { try { return localStorage.getItem(SIDEBAR_MODE_KEY) || 'chat'; } catch { return 'chat'; } };
const showSidebarMode = mode => {
  document.documentElement.dataset.sidebarMode = mode;
  for (const [id, value] of [['#side-mode-chat', 'chat'], ['#side-mode-work', 'work']]) $(id).setAttribute('aria-pressed', String(mode === value));
  try { localStorage.setItem(SIDEBAR_MODE_KEY, mode); } catch {}
};
showSidebarMode(savedSidebarMode());
const workFolderPicker = createWorkFolderPicker({ api, onError: text => error(text) });
async function pickWorkFolderIfRemote(folder, { title = 'Choose a folder on mini', confirmLabel = 'Work here' } = {}) {
  if (typeof folder === 'string' && folder) return { cancelled: false, folder };
  if (state.remote) {
    const picked = await workFolderPicker.pick({ title, confirmLabel, initialFolders: state.workFolders || [] });
    return picked ? { cancelled: false, folder: picked } : { cancelled: true, folder: undefined };
  }
  return { cancelled: false, folder: undefined };
}
sessionList = setupSessionList({ api, root: $('#recent-list'), notebooks: $('#notebook-list'), selectButton: $('#select-chats'), selectionBar: $('#selection-bar'), label: $('.side-recent-label'), mode: savedSidebarMode(), onMode: showSidebarMode, isBusy: () => busy, isRemote: () => Boolean(state.remote), defaultProvider: () => state.settings?.workProvider || 'claude', onOpen: showSession, onError: text => error(text),
  onConvertToWork: async (id, folder) => {
    const picked = await pickWorkFolderIfRemote(folder, { title: 'Convert chat to work session', confirmLabel: 'Convert here' });
    if (picked.cancelled) return null;
    return api.sessionToWork(id, picked.folder);
  } });
const openLinked = id => api?.sessionOpen(id).then(showSession).catch(e => error(e.message));
const threadsPopover = createThreadsPopover({
  anchor: $('#threads-menu'),
  getState: () => state,
  onOpenSession: openLinked,
  onSnooze: (id, until) => api?.sessionSnooze?.(id, until).then(next => { if (next) { state.sessions = next; sessionList.update(next); } }).catch(e => error(e.message)),
});
const activityPopover = createActivityPopover({ api, anchor: $('#activity-bell'), getState: () => state, onOpenSession: openLinked });
const routinesPopover = createRoutinesPopover({
  api,
  anchor: $('#routines'),
  onError: text => error(text),
  onOpenSkillsSettings: async () => { settingsAt('automation'); await automationSettings.render(); },
});
$('#threads-menu').disabled = !api;
$('#threads-menu').onclick = () => threadsPopover.toggle();
$('#activity-bell').disabled = !api;
$('#activity-bell').onclick = () => activityPopover.toggle();
const sideStrip = linkedStrip({ api, holder: $('#error'), onOpen: openLinked, onError: text => error(text) });
const openReplyLink = url => url.startsWith('fairy-run:') ? openRunCitation(url.slice('fairy-run:'.length)) : url.startsWith('lyra-file:') ? (floating ? filesSettings.open(url) : sidePane.show('sources', url)) : api?.openSource(url).catch(e => error(e.message));
// The to-do box above the composer: Fairy's task list in a work session, checked off as she goes (src/todo-box.js).
const todoBox = setupTodoBox({ root: $('#todo-box') });
const a2uiDataTimers = new Map();
async function dispatchA2UIAction({ surface = null, surfaceId = '', actionName = 'submit', sourceComponentId = '', context = {} } = {}) {
  if (!api?.a2uiAction) return;
  if (busy || workRunOnScreen() || workSending) { error('Fairy is still working on another reply. Try again in a moment.'); return; }
  try {
    const res = await api.a2uiAction({ surface, surfaceId, actionName, sourceComponentId, context });
    if (res?.prompt) void send(res.prompt);
  } catch (e) { error(e.message); }
}
const a2uiHandlers = (messageAt = '') => ({
  onAction: (payload, surf) => void dispatchA2UIAction({ surface: surf, surfaceId: payload.surfaceId, actionName: payload.actionName, sourceComponentId: payload.sourceComponentId, context: payload.context }),
  onDataChange: ({ surfaceId, path, value }) => {
    if (!api?.a2uiUpdateData || !messageAt) return;
    const key = `${messageAt}:${surfaceId}`;
    clearTimeout(a2uiDataTimers.get(key));
    a2uiDataTimers.set(key, setTimeout(() => {
      a2uiDataTimers.delete(key);
      void api.a2uiUpdateData({ messageAt, surfaceId, path, value }).catch(() => {});
    }, 180));
  },
  onPromote: async surf => {
    if (!api?.a2uiToPage) return;
    try {
      const res = await api.a2uiToPage({ surface: surf });
      if (res?.artifacts) state.artifacts = res.artifacts;
      if (res?.artifact) sidePane.show('artifacts', { artifact: res.artifact.id, seq: res.artifact.seq });
      status(`Saved “${res.artifact?.title || 'Interactive UI'}” as a Page`);
    } catch (e) { error(e.message); }
  },
});
const workView = setupWorkView({ api, openLink: openReplyLink, onStep: row => { if (row?.status !== 'running') return; const words = String(row.summary || row.tool || 'Working…').slice(0, 80), kind = toolOfStep(row.tool); paintStatus($('#status'), words, kind); paintStatus($('#floating-status'), words, kind); headerStatusText = words.slice(0, 60); syncChatHeader(headerStatusText); }, messages: $('#messages'), onError: text => error(text), onText: showWorkText, onDone: workFinished, onStarted: workStarted, onBrowser: () => sidePane.show('browser'), onSimulator: () => { if (!sidePane.isOpen('simulator')) sidePane.show('simulator'); }, onPage: artifact => sidePane.show('artifacts', { artifact: artifact.id, seq: artifact.seq }),
  onA2UI: surfaces => { if (!surfaces?.length) return; workPartial ||= message('assistant', ''); mountA2UISurfaces(workPartial.item, surfaces, a2uiHandlers('')); },
  // Fairy's task list goes in the to-do box above the composer; the side panel's Tasks tab still has it too.
  onTasks: (tasks, live) => { sidePane.refresh(); todoBox.set(tasks, { live }); },
  onWaiting: title => { status('Fairy needs your OK'); if (floating) bubble(`I need your OK: ${title}. Open the window to answer.`, { reset: true }); } });
// A file's commits, from Files or Changes, in the Git panel.
let gitView;
const fileHistory = path => { gitView.showHistory(path); sidePane.show('git'); };
const openNeutrinoPr = (repo, number) => { gitView.showNeutrino(repo, number); sidePane.show('git'); };
const activeSessionKey = () => state.sessions?.active || '__home__';
const diffAnnotations = createDiffAnnotationStore();
const changes = changesPane({
  api,
  work: () => state.sessions?.work,
  onHistory: fileHistory,
  onOpenNeutrino: openNeutrinoPr,
  onReview: () => secondOpinion(),
  onAnnotate: comment => { diffAnnotations.add(activeSessionKey(), comment); status('Added review comment to composer'); },
  onAskStop: stop => { setDraft(`Explain ${stop.path}:${stop.line} — ${stop.title}: `); $('#message').focus(); },
  onError: text => error(text),
  openLink: url => api?.openSource(url).catch(e => error(e.message)),
});
const updateSwarmWorkBar = swarm => {
  const button = $('#work-swarm-btn');
  if (!button) return;
  const label = swarmWorkBarBadge(swarm);
  const count = swarm?.counts?.active || swarm?.counts?.unmerged || 0;
  button.textContent = label;
  button.setAttribute('aria-label', label);
  button.title = count ? `${label} (/swarm)` : 'Deploy parallel agents (/swarm)';
  button.dataset.count = count ? String(count) : '';
  button.classList.toggle('is-running', Boolean(swarm?.counts?.active > 0));
  button.classList.toggle('has-merge', Boolean(!swarm?.counts?.active && swarm?.counts?.unmerged > 0));
};
const agentSwarmView = swarmPane({ api, work: () => state.sessions?.work, currentSession: () => state.sessions?.active, onError: text => error(text), onChange: updateSwarmWorkBar });
$('#work-swarm-btn').onclick = () => sidePane.show('swarm');
api?.onAgentSwarm?.(payload => agentSwarmView.setSwarm(payload));
// The browser's page sits above the window's own content, so it steps aside for anything that opens over it.
// In Fairy's window on the other Mac, the pane is that Mac's own browser, so a preview (run here) isn't offered there.
const browserView = browserPane({ api, work: () => (document.documentElement.classList.contains('remote-window') ? null : state.sessions?.work), onError: text => error(text), blocked: () => floating || $('#settings').open || Boolean(document.querySelector('dialog[open]')) });
const pagesPane = artifactsPane({ api, currentSession: () => state.sessions?.active, sessionTitle: id => state.sessions?.sessions?.find(session => session.id === id)?.title || '', onError: text => error(text), onSaved: text => status(text),
  onCompose: words => { setDraft(words); $('#message').focus(); },
  onA2UIAction: ({ item, action }) => { void dispatchA2UIAction({ surfaceId: action?.surfaceId || item?.id, actionName: action?.actionName || 'submit', sourceComponentId: action?.sourceComponentId || '', context: action?.context || {} }); },
  onApply: item => { if (busy) { error('Fairy is working on something. Try again when it finishes.'); return; } api.artifactTarget(item.id).then(() => send(`Change “${item.title}” using my comments.`, { mode: 'page' })).catch(e => error(e.message)); } });
const terminalView = terminalPane({ api, sessionKey: () => state.sessions?.active || 'new', folder: () => state.sessions?.work?.path || '', onError: text => error(text) });
// Sweep, the disk cleaner (sweep.js): its broom on the action rail under Routines, its card and notifications, its panel.
const sweep = api?.sweep ? sweepView({ api, rail: $('#action-rail'), after: $('#routines'), sidePane: () => sidePane, terminal: terminalView, onError: text => error(text) }) : null;
// Relay, the repo syncer (relay.js): its icon just under the broom, its card and notifications, its panel.
const relay = api?.relay ? relayView({ api, rail: $('#action-rail'), after: sweep?.button || $('#routines'), sidePane: () => sidePane, onError: text => error(text) }) : null;
const todayController = todayPane({
  api,
  sessions: () => state.sessions || {},
  openSession: id => api.sessionOpen(id).then(showSession).catch(e => error(e.message)),
  ask: text => askInChat(text),
  openSettings: pane => settingsAt(pane),
  onReproduce: paper => void startReproduction(paper),
  openPage: art => sidePane.show('artifacts', { artifact: art.id, seq: art.seq || art.versions?.at(-1)?.seq }),
  onBrief: res => { if (res?.artifacts) state.artifacts = res.artifacts; },
  onChange: () => renderHomeToday(),
  backgroundAllowed: () => initialized && !document.hidden && ambient.awake && ambient.power?.optional !== false && !state.companionHidden,
});
function renderHomeToday() {
  const host = $('#home-today'); if (!host) return;
  if (state.settings?.homeToday === 'off' || !document.documentElement.classList.contains('home')) {
    host.hidden = true; host.replaceChildren(); return;
  }
  const snap = todayController.snapshot();
  const items = homeSummary({ data: snap.data, sessions: state.sessions || {}, routines: snap.routines });
  if (!items.length) { host.hidden = true; host.replaceChildren(); return; }
  const makeChip = (kind, badge, text, onclick, title = '') => {
    const btn = document.createElement('button'); btn.type = 'button';
    btn.className = `home-today-chip is-${kind}`;
    if (title) btn.title = title;
    const dot = document.createElement('span'); dot.className = 'home-today-dot'; dot.setAttribute('aria-hidden', 'true');
    const b = document.createElement('span'); b.className = 'home-today-badge'; b.textContent = badge;
    btn.append(dot, b);
    if (text) { const t = document.createElement('span'); t.className = 'home-today-text'; t.textContent = text; btn.append(t); }
    btn.onclick = onclick;
    return btn;
  };
  const chips = items.map(item => makeChip(
    item.kind,
    item.badge,
    item.text,
    item.sessionId ? () => api?.sessionOpen(item.sessionId).then(showSession).catch(e => error(e.message)) : () => sidePane?.show('today'),
    item.sessionId ? 'Open chat' : 'Open Today panel'
  ));
  if (items.every(item => item.kind !== 'clear')) {
    const more = document.createElement('button'); more.type = 'button';
    more.className = 'home-today-chip home-today-chip--open';
    more.textContent = 'Today'; more.title = 'Open Today panel';
    more.onclick = () => sidePane?.show('today');
    chips.push(more);
  }
  host.replaceChildren(...chips);
  host.hidden = false;
}
let quoteSelection = null, composerQueueView = null, composerStashView = null, steeringPending = null;
const composerQueue = createComposerQueue();
const composerStash = createComposerStash();
const isTurnActiveNow = () => (state.sessions?.work ? (workRunOnScreen() || workSending) : (busy && !vocalRun && !proactiveRun));
const sideChatView = sideChatPane({
  api,
  activeSession: activeSessionKey,
  renderText: (element, text) => renderReply(element, text),
  onAddToChat: quote => {
    quoteSelection?.add(quote);
    $('#message').focus();
    status('Added side answer to composer');
  },
  onError: text => error(text),
});
sidePane = setupSidePane({ root: $('#side-pane'), rail: $('#pane-rail'), panes: [todayController,
  meetingPane({ api, meeting: () => meetingPanel.state, toggle: () => $('#meeting-toggle').click(), render: (element, text) => renderReply(element, text), onError: text => error(text) }),
  outlinePane(), sideChatView, sourcesPane({ api, onError: text => error(text), history: () => state.history }), pagesPane, filesPane({ api, onError: text => error(text), openData: link => api.gitPathOf(link).then(path => path ? sidePane.show('data', path) : error('Open a work session containing this data file to inspect it in the Data pane.')).catch(e => error(e.message)), history: { available: () => Boolean(state.sessions?.work), open: link => api.gitPathOf(link).then(path => path ? fileHistory(path) : error('That file isn’t in this work session’s folder, so it has no history here.')).catch(e => error(e.message)) } }), dataPane({ api, work: () => state.sessions?.work, onError: text => error(text), openAnalytics: api?.analytics ? async relPath => { const res = await api.analytics('importWorkFile', relPath); hideOtherBoards(); hidePlugins(); hideUsage(); const view = await openAnalytics(); if (res?.dataset?.id) await view?.openDataset(res.dataset.id, { mode: 'learn' }); else view?.show(); } : null }), workView.pane, agentSwarmView, tracePane({ api, currentSession: () => state.sessions?.active, onError: text => error(text) }), journalPane({ api, work: () => state.sessions?.work, openChat: id => void openChat(id).catch(e => error(e.message)), onError: text => error(text) }), changes, gitView = gitPane({ api, work: () => state.sessions?.work, draft: text => { setDraft(text); $('#message').focus(); status('Ready to send: change the question if you like, then press Return'); }, openWork: (next, said) => { showSession(next); sidePane.show('git'); $('#message').focus(); if (said) status(said); }, ask: (record, text) => { attachmentDraft.restore([record]); setDraft(text); $('#message').focus(); status('Ready to send: change the question if you like, then press Return'); }, openNeutrinoPage: target => { hideOtherBoards(); hidePlugins(); hideUsage(); void openNeutrino().then(view => view?.open(target)); }, onError: text => error(text), openLink: url => api?.openSource(url).catch(e => error(e.message)) }),
  terminalView, browserView, computePane({ api, onOpenRun: (folder, id) => void openRuns().then(view => view?.open(folder, id)), onError: text => error(text) }), simulatorPane({ api, onError: text => error(text) }), ...(sweep ? [sweep.pane] : []), ...(relay ? [relay.pane] : [])], currentSession: () => activeSessionKey(), onChange: pane => { api?.sessionPane(pane).catch(e => error(e.message)); syncChatHeader(); } });
$('#chat-header-pane').onclick = () => sidePane.toggle(state.sessions?.work ? 'changes' : 'outline');
const calendarSettings = setupCalendarSettings({ api, root: $('#calendar-settings') });
$('#calendar-settings').insertAdjacentHTML('afterend', '<div id="gmail-settings"></div>');
const gmailSettings = setupGmailSettings({ api, root: $('#gmail-settings') });
$('#gmail-settings').insertAdjacentHTML('afterend', '<div id="drive-settings"></div>');
const driveSettings = setupDriveSettings({ api, root: $('#drive-settings') });
$('#drive-settings').insertAdjacentHTML('afterend', '<div id="files-settings"></div>');
const googleAccountSettings = setupGoogleAccountSettings({
  api,
  root: $('#google-account-settings'),
  onChanged: res => {
    void calendarSettings.refresh();
    void gmailSettings.refresh();
    void driveSettings.refresh();
    void pluginsBoard?.then?.(b => b?.refresh?.());
    if (res?.antigravitySwitched) void refreshAntigravity({ force: true });
  },
});
const filesSettings = setupFilesSettings({ api, root: $('#files-settings'), onError: error });
const attachmentDraft = setupAttachments({ api, row: $('#attachments'), input: $('#message'), dock: $('.dock'), enabled: () => !floating, onError: text => error(text), onOpen: source => filesSettings.open(source) });
quoteSelection = setupQuoteSelection({
  messagesEl: $('#messages'),
  composerQuotesEl: $('#composer-quotes'),
  dock: $('.dock'),
  input: $('#message'),
  onSideChat: quote => {
    sideChatView.setQuote(quote);
    sidePane?.show('side-chat');
  },
});
function syncSendQueueButton() {
  const sendBtn = $('#send');
  if (!sendBtn) return;
  const queueing = isTurnActiveNow();
  sendBtn.disabled = false;
  sendBtn.classList.toggle('is-queue', queueing);
  sendBtn.title = queueing ? 'Queue follow-up (Enter) · Steer immediately (⌥Enter)' : 'Send message';
  sendBtn.setAttribute('aria-label', queueing ? 'Queue follow-up' : 'Send message');
}
async function drainComposerQueue(expectedSid = activeSessionKey()) {
  const sid = activeSessionKey();
  if (expectedSid && expectedSid !== sid) return;
  if (composerQueue.isPaused(sid) || isTurnActiveNow()) { composerQueueView?.render(); return; }
  const next = composerQueue.shift(sid);
  steeringPending = null;
  composerQueueView?.render();
  if (!next) return;
  await send(next.text, { fromQueue: true, mode: next.mode, attachments: next.attachments, quotes: next.quotes });
}
function steerQueuedEntry(entry, sid = activeSessionKey()) {
  if (!entry) return;
  composerQueue.promoteToFront(sid, entry.id);
  steeringPending = { sessionId: sid, id: entry.id };
  composerQueueView?.render();
  if (state.sessions?.work && (workRunOnScreen() || workSending)) {
    status('Steering…');
    void api.workStop(state.sessions.active).catch(e => { steeringPending = null; error(e.message); });
  } else if (busy) {
    status('Steering…');
    void stop();
  } else {
    void drainComposerQueue(sid);
  }
}
composerStashView = setupComposerStash({
  button: $('#stash-draft'),
  dock: $('.dock'),
  stash: composerStash,
  activeSession: activeSessionKey,
  getDraft: () => ({ text: $('#message').value, attachments: attachmentDraft.list(), quotes: quoteSelection.list() }),
  clearDraft: () => { setDraft(''); attachmentDraft.take(); quoteSelection.clear(); },
  onRestore: entry => {
    setDraft(entry.text || '');
    if (entry.attachments?.length) attachmentDraft.restore(entry.attachments);
    if (entry.quotes?.length) quoteSelection.restore(entry.quotes);
    if (entry.comments?.length) diffAnnotations.restore(activeSessionKey(), entry.comments);
    $('#message').focus();
    status('Restored stashed draft');
  },
});
composerQueueView = setupComposerQueue({
  host: $('#composer-queue'),
  queue: composerQueue,
  activeSession: activeSessionKey,
  onSteer: (entry, sid) => steerQueuedEntry(entry, sid),
  onEdit: entry => {
    setDraft(entry.text || '');
    if (entry.attachments?.length) attachmentDraft.restore(entry.attachments);
    if (entry.quotes?.length) quoteSelection.restore(entry.quotes);
    if (entry.comments?.length) diffAnnotations.restore(activeSessionKey(), entry.comments);
    $('#message').focus();
  },
  onRunNext: sid => { void drainComposerQueue(sid); },
});
composerStashView.syncBadge();
const secretRequestsBanner = setupSecretRequestsBanner({
  host: $('#secret-requests-banner'),
  api,
  activeSession: activeSessionKey,
  onError: text => error(text),
  isRemote: () => Boolean(state.remote),
});
const diffAnnotationChips = setupDiffAnnotationChips({
  container: $('#composer-review-chips'),
  store: diffAnnotations,
  activeSession: activeSessionKey,
  onJump: item => { if (state.sessions?.work) sidePane?.show('changes'); },
});
setupQuitHoldOverlay({ api, host: document.body });
function renderNotesStatus(value){const b=value?.books;$('#books-status').textContent=b?`Books: ${b.status} · ${b.files} PDFs · ${b.pages||0} pages · ${b.chunks} passages${b.emptyPages?' · '+b.emptyPages+' pages without extractable text':''}${b.skipped?' · '+b.skipped+' files skipped':''}${b.truncated?' · some text exceeds indexing limits':''}`:'';$('#notes-status').textContent=value?`${value.status} · ${value.files} files · ${value.chunks} passages${value.ready&&!value.semanticAvailable?' · keyword search only':''}${value.skipped?' · '+value.skipped+' unreadable/oversized files skipped':''}${value.truncated?' · index limit reached':''}`:'Open Fairy to use personal notes.';}
api?.onNotes(renderNotesStatus);
api?.onMemoryIdle?.(idle => {
  const inactive = Boolean(idle);
  document.documentElement.classList.toggle('memory-idle', inactive);
  for (const video of document.querySelectorAll('video')) {
    if (inactive) video.pause();
    else if (video.autoplay) video.play().catch(() => {});
  }
});
$('#notes-refresh').onclick=()=>api?.notesRefresh().then(renderNotesStatus).catch(e=>error(e.message));
$('#notes-folder').onclick=async()=>{try{const result=await api?.notesFolder();if(result){state=result;$('#settings-form').elements.notesMode.value=result.settings.notesMode;renderNotesStatus(result.notes);void filesSettings.refresh();}}catch(e){error(e.message);}};
$('#books-folder').onclick=async()=>{try{const result=await api?.booksFolder();if(result){state=result;$('#settings-form').elements.notesMode.value=result.settings.notesMode;renderNotesStatus(result.notes);void filesSettings.refresh();}}catch(e){error(e.message);}};
$('#notes-develop').onclick=()=>{$('#settings').close();document.querySelector('[data-mode="chat"]').click();void send('Help me develop a new note through conversation. Start by asking which idea or experience I want to capture; ask one focused question at a time. Keep the draft here until I explicitly ask to save a named file.');};

const recognitionBlocked = () => ((busy || Boolean(audio)) && state.settings.voiceBargeIn !== 'on') || Boolean(recorder) || Date.now() < echoUntil || mode === 'desktop' || ['desktop', 'calendar', 'gmail', 'drive', 'files', 'project'].includes(activeRequestMode) || $('#settings').open || document.querySelector('.file-preview')?.open || $('#music')?.open || Boolean($('#message').value.trim());
// Each line is synthesized once, so later wakes answer without waiting on the voice provider.
const spokenClips = new Map();
async function savedSpeech(line) {
  const key = `${state.settings.voiceProvider}:${state.settings.fishVoiceId}:${state.settings.voice}:${line}`;
  if (!spokenClips.has(key)) spokenClips.set(key, await api.speak(line));
  return spokenClips.get(key);
}
let wakeAcknowledged = Promise.resolve();
async function acknowledgeWake() {
  const line = WAKE_REPLIES[Math.floor(Math.random() * WAKE_REPLIES.length)], followups = state.settings.voiceFollowups === 'on';
  const ready = () => status(followups ? 'Go ahead…' : 'Say my name and your question together');
  bubble(line); ready();
  if (muted() || state.settings.voiceProvider === 'off') return;
  const token = ++generation;
  try {
    spokenReply = line;
    await play(await savedSpeech(line), token);
  } catch { /* The written reply already answered; a voice failure must not interrupt listening. */ }
  if (token !== generation) return;
  echoUntil = Date.now() + 1200; ready();
  if (followups && wantsListening()) voiceGate.engage(13.2);
  updateAwareness();
}
const meetingPanel = setupMeetingPanel({ api, $, onError: error, onChange: () => { if (initialized) updateIdeas(); } });
let wakeProfile = null;
const handsFree = new HandsFreeMicrophone({
  blocked: recognitionBlocked,
  transcribe: bytes => api.ambientTranscribe(bytes),
  matchWake: (samples, rate) => wakeProfile ? matchWake(wakeProfile, samples, rate) : null,
  onText: async (heard, startedAt, wake) => {
    const text = restoreName(heard, wakeProfile);
    const interrupting = busy || Boolean(audio);
    if (interrupting && isPlaybackEcho(text, spokenReply)) return;
    const gate = { name: state.settings.name, followups: !interrupting && state.settings.voiceFollowups === 'on', startedAt };
    // The recognizer may misspell the name while its sound still matches the voice setup. A reply
    // playing is only interrupted by the name alone, so its own speech can't cut itself off.
    const sound = soundAgrees(wake, text, state.settings.name) ? wake : null;
    const result = voiceGate.accept(text, gate) || (sound === 'whole' ? voiceGate.accept(state.settings.name, gate) : sound === 'prefix' && !interrupting ? voiceGate.accept(`${state.settings.name}, ${dropOpeningWords(text)}`, gate) : null);
    if (!result) return;
    noteInteraction();
    if (interrupting) {
      const previousReply = replyFinished;
      await stop(); await previousReply; await proactiveFinished; await vocalFinished;
      if (result.kind === 'wake' && state.settings.voiceFollowups === 'on') voiceGate.engage(13.2);
      if (result.kind === 'message' && /^(?:stop|wait|pause|hold on)[.!?]*$/i.test(result.text)) {
        voiceGate.engage(13.2); bubble(''); status('Stopped · I’m listening'); updateAwareness(); return;
      }
    }
    conversationTimer.defer(); vocalTimer.defer();
    if (result.kind === 'pause') { await toggleHandsFree(false); status('Hands-free listening off'); }
    else if (result.kind === 'dismiss') status('Listening for my name');
    else if (result.kind === 'wake') wakeAcknowledged = acknowledgeWake();
    else {
      // Only wake-name / follow-up messages accepted by VoiceGate reach routing.
      generation++; stopAudio(); await wakeAcknowledged;
      void send(result.text, { handsFree: true });
    }
    updateAwareness();
  },
  onActivity: requestBackgroundSync,
  onStatus: text => { listenStatus = text; updateAwareness(); },
  onFailure: text => { listenFault = text; voiceGate.close(); updateAwareness(); error(`Hands-free listening paused: ${text}`); },
});
// While Fairy listens on your iPhone, the Mac leaves the wake word to it.
function wantsListening() { return initialized && api && state.settings.handsFree === 'on' && ambient.awake && !ambient.paused && ambient.power?.handsFree !== false && !ambient.phoneListening && !listenFault; }
async function syncListening() {
  if (!wantsListening()) {
    const releaseEngine = !ambient.awake || ambient.paused || ambient.power?.handsFree === false;
    if (listenSetup || handsFree.running || handsFree.starting || (releaseEngine && handsFree.engine)) {
      listenEpoch++; voiceGate.close(); void api?.ambientCancel(); await handsFree.stop({releaseEngine});
    }
    updateAwareness(); return;
  }
  if (listenSetup || handsFree.running || handsFree.starting) return;
  listenSetup = true; const token = ++listenEpoch; listenStatus = 'Preparing local listening…'; updateAwareness();
  try {
    await startListeningSession({cancel:()=>api.ambientCancel(),prepare:()=>api.ambientPrepare(),start:()=>handsFree.start(),current:()=>token===listenEpoch&&wantsListening()&&!rendererDisposed});
  } catch (e) { if (token === listenEpoch && wantsListening()) { listenFault = e.message; error(`Hands-free listening paused: ${e.message}`); } }
  finally { listenSetup = false; listenStatus = ''; updateAwareness(); if (token !== listenEpoch && wantsListening()) void syncListening(); }
}
function updateAwareness(schedule=true) {
  if(schedule)requestBackgroundSync();
  clearTimeout(awarenessDeadline);
  if(initialized && api && !document.hidden && ambient.awake && !ambient.paused && handsFree.running){
    const now=Date.now(), next=Math.min(...[voiceGate.until,echoUntil].filter(at=>at>now));
    if(Number.isFinite(next))awarenessDeadline=setTimeout(updateAwareness,next-now+1);
  }
  const quizBlocked = busy || Boolean(audio) || Boolean(recorder) || $('#settings').open || document.querySelector('.file-preview')?.open || $('#music')?.open || mode === 'desktop' || Boolean($('#message').value.trim());
  avatar?.spriteAvatar.setQuizThinking(Boolean(quizInfo.enabled && quizInfo.thinking && !quizBlocked && ambient.awake && !ambient.paused));
  if (api && initialized && lastQuizBlocked !== Boolean(quizBlocked)) { lastQuizBlocked = Boolean(quizBlocked); void api.quizUIBlocked(lastQuizBlocked).catch(() => {}); }
  const enabled = state.settings.handsFree === 'on';
  const paused = ambient.paused || !ambient.awake;
  const power = ambient.power;
  const powerStatus = $('#power-status'); if(powerStatus)powerStatus.textContent = `Power awareness · ${power?.label || 'Normal power'}${power?.nativeAvailable && Number.isFinite(power.batteryPercent) ? ' · '+power.batteryPercent+'%' : ''}${power?.nativeAvailable === false ? ' · battery details unavailable' : ''}`;
  const mic = !enabled ? 'Mic off' : paused || power?.handsFree === false ? 'Mic paused' : listenFault ? 'Mic needs attention' : listenStatus ||
    (handsFree.running ? recognitionBlocked() ? 'Mic waiting' : voiceGate.engaged ? 'Listening · follow-up' : 'Listening · say my name' : 'Starting microphone…');
  const listeningButton = $('#floating-listening');
  const micActive = enabled && !paused && power?.handsFree !== false && !listenFault && handsFree.running && !recognitionBlocked();
  const micState = !enabled ? 'off' : listenFault ? 'error' : micActive ? 'listening' : 'paused';
  if (listeningButton.dataset.micState !== micState) {
    listeningButton.dataset.micState = micState;
    listeningButton.innerHTML = !enabled || listenFault ? icons.microphoneOff : icons.microphone;
  }
  const action = listenFault ? 'Retry microphone' : enabled ? 'Turn microphone off' : 'Turn microphone on';
  listeningButton.setAttribute('aria-label', `${action} · ${mic}`);
  listeningButton.setAttribute('aria-pressed', String(enabled));
  listeningButton.disabled = !initialized || !api || micChanging;
  listeningButton.title = `${action} · ${mic} · ${state.micShortcutRegistered === false ? '⌘⇧M unavailable (in use by another app)' : '⌘⇧M'}`;
  for (const prefix of ['', 'floating-']) { const button=$(`#${prefix}hands-free`); if(button)button.disabled=micChanging; }
  const screenLabel = state.settings.screenAwareness !== 'on' ? 'Screen on request' : paused || power?.screenMs === 0 ? 'Screen paused' : ambient.screenError ? 'Screen needs permission' : ambient.screenReady ? 'Screen aware' : 'Screen starting…';
  for (const prefix of ['', 'floating-']) {
    const toggle = $(`#${prefix}hands-free`), pause = $(`#${prefix}pause-awareness`), label = $(`#${prefix}awareness-status`);
    if (!toggle) continue;
    toggle.textContent = listenFault && enabled ? 'Retry listening' : enabled ? 'Hands-free on' : 'Hands-free off';
    toggle.setAttribute('aria-pressed', String(enabled));
    pause.textContent = ambient.paused ? 'Resume senses' : 'Pause senses';
    pause.setAttribute('aria-pressed', String(Boolean(ambient.paused)));pause.title=`Pause/resume screen awareness and microphone · ${state.shortcutStatus?.senses===false?'⌘⇧P unavailable':'⌘⇧P'}`;
    label.textContent = `${screenLabel} · ${mic}${power?.level ? ' · '+power.label : ''}${quizInfo.enabled ? ' · '+quizInfo.status : ''}`;
    label.title = listenFault || ambient.screenError || 'Say Fairy to start. Follow-ups last 12 seconds.';
    label.classList.toggle('senses-active', Boolean(!paused && (handsFree.running || ambient.screenReady)));
    const hints = $(`#${prefix}quiz-hints`);
    hints.textContent = quizInfo.enabled ? 'Quiz hints on' : 'Quiz hints off';
    hints.setAttribute('aria-pressed', String(quizInfo.enabled));
    const target=$(`#${prefix}quiz-auto`),automatic=quizInfo.autoTarget!==false;target.textContent=automatic?'▶':'⏸';target.setAttribute('aria-pressed',String(automatic));target.title=automatic?'Automatic targeting on; switch to manual targeting':`Manual targeting${quizInfo.target?` · Question ${quizInfo.target}`:''}; switch to automatic targeting`;target.title+=state.shortcutStatus?.targeting===false?' · ⌘⇧T unavailable':' · ⌘⇧T';target.setAttribute('aria-label',target.title);target.disabled=!quizInfo.enabled;
    hints.title = `${quizInfo.status}${quizInfo.thinking ? ` · ${((quizInfo.elapsedMs ?? 0)/1000).toFixed(1)}s elapsed` : ''}${quizInfo.timings?.modelMs !== undefined ? ` · Last check: model ${(quizInfo.timings.modelMs/1000).toFixed(1)}s, local OCR ${((quizInfo.timings.ocrMs ?? quizInfo.timings.observeMs ?? 0)/1000).toFixed(1)}s` : ''}${quizInfo.bufferFrames > 1 ? ` · ${quizInfo.bufferFrames} overlapping views held temporarily` : ''}${quizInfo.rememberedQuestions ? ` · ${quizInfo.rememberedQuestions} quiz question${quizInfo.rememberedQuestions === 1 ? '' : 's'} remembered temporarily` : ''} · Codex GPT-6 Astra · Silent answer choices · ${state.shortcutStatus?.quiz===false?'⌘⇧H unavailable':'⌘⇧H to toggle'}. AI choices can be wrong.`;
  }
}
function showMicFeedback(text) {
  const label=$('#mic-feedback'); clearTimeout(micFeedbackTimer);
  label.textContent=text; label.hidden=false;
  micFeedbackTimer=setTimeout(()=>{label.hidden=true;},3500);
}
function micFeedback() {
  if(state.settings.handsFree!=='on')return 'Mic off';
  if(ambient.paused)return 'Mic paused · Resume senses first';
  if(!ambient.awake)return 'Mic paused · Mac asleep or locked';
  if(ambient.power?.handsFree===false)return 'Mic paused · Power saving';
  if(listenFault)return 'Mic needs attention · Retry';
  if(!handsFree.running)return 'Starting microphone…';
  return recognitionBlocked() ? 'Mic ready · Waiting for this activity' : 'Listening · say Fairy';
}
async function toggleHandsFree(value = undefined, feedback = false) {
  if (!api || micChanging) return;
  const next = value ?? (listenFault ? true : state.settings.handsFree !== 'on');
  if(next && recorder){if(feedback)showMicFeedback('Finish your recording first');return;}
  const feedbackToken=++micFeedbackEpoch;
  micChanging=true; updateAwareness();
  try {
    const result = await api.enableHandsFree(next);
    if(rendererDisposed)return;
    state = result; ambient = state.awareness;
    listenFault = ''; voiceGate.close();
    if(next)noteInteraction();
  } catch (e) {
    error(e.message); if(feedback)showMicFeedback('Could not change microphone'); return;
  } finally { micChanging=false; if(!rendererDisposed)updateAwareness(); }
  if(rendererDisposed)return;
  if(feedback)showMicFeedback(next ? 'Starting microphone…' : 'Mic off');
  await syncListening(); updateAwareness();
  if(feedback && feedbackToken===micFeedbackEpoch && !rendererDisposed)showMicFeedback(micFeedback());
}
for (const prefix of ['', 'floating-']) {
  $(`#${prefix}quiz-hints`).onclick = async () => {
    if (!api) return;
    try {
      if (proactiveRun || vocalRun) { await stop(); await proactiveFinished; await vocalFinished; }
      quizInfo = await api.enableQuiz(!quizInfo.enabled); updateAwareness(); updateIdeas();
    } catch (e) { error(e.message); }
  };
  $(`#${prefix}hands-free`).onclick = () => toggleHandsFree();
  $(`#${prefix}pause-awareness`).onclick = async () => {
    if (!api) return;
    try {
      ambient = await api.pauseAwareness(!ambient.paused); voiceGate.close();
      listenFault = ''; await syncListening(); updateAwareness();
      if (ambient.paused && (busy || audio)) await stop({keepQuiz:true});
    } catch (e) { error(e.message); }
  };
}
$('#screen-display').onchange = async () => {
  if (!api) return;
  try { ambient = await api.awarenessDisplay($('#screen-display').value === '' ? null : Number($('#screen-display').value)); updateAwareness(); }
  catch (e) { error(e.message); }
};

const conversationReady = () => ({ deepseek: state.hasDeepSeekKey, codex: state.subscription?.connected, antigravity: state.antigravity?.connected, claude: state.claude?.connected, openai: state.hasOpenAIKey })[state.settings.backend];
let headerStatusText = '';
function syncChatHeader(liveText = null) {
  const titleEl = $('#chat-header-title'), repoEl = $('#chat-header-repo'), stateEl = $('#chat-header-state'), statusEl = $('#chat-header-status'), paneBtn = $('#chat-header-pane');
  if (!titleEl) return;
  const active = (state.sessions?.sessions || []).find(s => s.id === state.sessions?.active);
  const work = state.sessions?.work;
  titleEl.textContent = active?.title || (work ? work.name : 'Chat');
  if (work) {
    repoEl.hidden = false;
    repoEl.textContent = work.branch ? `${work.name} · ${work.branch}` : work.name;
    repoEl.title = work.path || work.folder || '';
  } else {
    repoEl.hidden = true;
    repoEl.textContent = '';
    repoEl.title = '';
  }
  const runState = state.sessions?.running?.[state.sessions?.active];
  const waiting = runState === 'waiting' || headerStatusText === 'Fairy needs your OK';
  const working = Boolean(!waiting && (busy || workSending || workRunOnScreen() || (runState && runState !== 'waiting')));
  stateEl.classList.toggle('is-waiting', waiting);
  stateEl.classList.toggle('is-working', working);
  const inputBadge = $('#chat-header-input');
  if (inputBadge) inputBadge.hidden = !waiting;
  if (waiting) statusEl.textContent = 'Needs your OK';
  else if (working) statusEl.textContent = String(liveText || headerStatusText || 'Working…').slice(0, 60);
  else statusEl.textContent = 'Ready';
  const paneOpen = Boolean(sidePane?.current());
  paneBtn.setAttribute('aria-pressed', String(paneOpen));
  paneBtn.classList.toggle('is-on', paneOpen);
  const toWorkBtn = $('#chat-header-to-work');
  if (toWorkBtn) {
    toWorkBtn.hidden = Boolean(work || !api?.sessionToWork);
    toWorkBtn.disabled = Boolean(busy);
  }
  const protonBtn = $('#chat-header-proton');
  if (protonBtn) {
    protonBtn.hidden = !work;
    protonBtn.disabled = !api?.openInProton;
  }
}
// With a little pixel animation in front for what she's doing (searching, reading, thinking…).
function status(text) {
  requestBackgroundSync(); paintStatus($('#status'), text); paintStatus($('#floating-status'), text);
  if ($('#prepare-local-speech').disabled) $('#local-speech-status').textContent = text;
  headerStatusText = (!text || /^(?:Ready|Stopped)/i.test(text)) ? '' : String(text).slice(0, 60);
  syncChatHeader();
}
function error(message) { const text = message?.replace(/Error invoking remote method '[^']+': Error: /g, '') || ''; if (text) bubble(text); $('#error').hidden = !text; $('#error').textContent = text; }
function setBusy(value) { if (value) radialMenu?.retract(); if(value)walkController?.cancel(); requestBackgroundSync(); busy = value; sessionList?.render(); if (value) vocalTimer.defer(); avatar?.setActivity(value ? 'thinking' : 'idle'); $('#screen-display').disabled = value; $('#floating-mic').disabled = value && !recorder && !proactiveRun && !vocalRun; $('#floating-mode').disabled = value; $('#floating-send').disabled = value && !proactiveRun && !vocalRun; $('#record').disabled = value && !recorder && !proactiveRun && !vocalRun; $('#stop').hidden = !value; $('#settings-button').disabled = value; $('#provider-label').disabled = value; updateIdeas(); syncWorkControls(); syncSendQueueButton(); syncChatHeader(); }
function message(role, text, messageMode = mode, { drawingAll = false, attachments = [] } = {}) {
  const item = document.createElement('article'); item.className = `message ${role}`;
  const label = document.createElement('span'); label.className = 'message-label'; label.textContent = role === 'user' ? ({ 'claude-code': 'YOU · CLAUDE CODE', work: 'YOU · WORK', page: 'YOU · PAGE', files: 'YOU · LOCAL FILES', screen: 'YOU · SCREEN SNAPSHOT', explain: 'YOU · ON SCREEN', guide: 'YOU · SHOW ME HOW', calendar: 'YOU · GOOGLE CALENDAR', gmail: 'YOU · GMAIL', drive: 'YOU · GOOGLE DRIVE', desktop: 'YOU · DESKTOP TASK' }[messageMode] || 'YOU') : messageMode === 'claude-code' ? 'CLAUDE CODE' : state.settings.name.toUpperCase();
  const content = document.createElement('div'); renderReply(content, text); if (attachments.length) content.append(attachmentRow(attachments, source => filesSettings.open(source))); item.append(label, content); $('#messages').append(item); if (!drawingAll) { item.scrollIntoView({ block: 'end' }); updateConversationChrome(); } return { item, content, label };
}
function renderReply(element, text) {
  // A citation opens beside the chat in the window, and in a preview over it when floating.
  // A run it names (fairy-run:R12, stage 5 of the tracker) opens that run's page in Runs, in this work session's folder.
  renderRichReply(element, text, openReplyLink);
}
function renderSavedThoughts(thoughts) {
  const visible = (thoughts || []).filter(entry => String(entry?.text || '').trim());
  if (!visible.length) return;
  const wrap = document.createElement('div');
  wrap.className = 'chat-thoughts';
  for (const thought of visible) wrap.append(createThoughtNode({ ...thought, status: 'done' }, { openLink: openReplyLink, defaultOpen: false }));
  $('#messages').append(wrap);
}
// Home only shows on an empty chat: the history stays with Fairy, so a blank screen would misread as a fresh start.
function updateConversationChrome() {
  document.documentElement.classList.toggle('home', !$('#messages .message'));
  requestBackgroundSync();
  sidePane?.refresh();
  syncChatHeader();
  renderHomeToday();
}
function attachBoardCard(item, board) {
  if (!item || !board?.id) return;
  item.querySelector('.board-plan-card')?.remove();
  const card = document.createElement('div');
  card.className = 'board-plan-card';
  const info = document.createElement('div');
  info.className = 'board-plan-info';
  const badge = document.createElement('span');
  badge.className = 'board-plan-badge';
  badge.textContent = 'Miro Board';
  const title = document.createElement('span');
  title.className = 'board-plan-title';
  title.textContent = board.name || 'Project Plan';
  info.append(badge, title);
  const actions = document.createElement('div');
  actions.className = 'board-plan-actions';
  const openBoardBtn = document.createElement('button');
  openBoardBtn.type = 'button';
  openBoardBtn.className = 'board-plan-btn is-primary';
  openBoardBtn.textContent = 'Open Board';
  openBoardBtn.onclick = () => {
    hideOtherBoards(); hidePlugins(); hideUsage();
    void openBoards().then(view => view?.open(board.id));
  };
  actions.append(openBoardBtn);
  if (board.docId) {
    const openDocBtn = document.createElement('button');
    openDocBtn.type = 'button';
    openDocBtn.className = 'board-plan-btn';
    openDocBtn.textContent = 'Open Plan Doc';
    openDocBtn.onclick = () => {
      const art = state.artifacts?.items?.find(a => a.id === board.docId);
      const seq = art?.versions?.at(-1)?.seq;
      sidePane.show('artifacts', seq ? { artifact: board.docId, seq } : { artifact: board.docId });
    };
    actions.append(openDocBtn);
  }
  card.append(info, actions);
  item.append(card);
}
let pluginsBoard = null;
function hidePlugins() { void pluginsBoard?.then(view => view?.hide()); }
let boardsBoard = null;
function hideBoards() { void boardsBoard?.then(view => view?.hide()); }
let designBoard = null;
function hideDesign() { void designBoard?.then(view => view?.hide()); }
let usageBoard = null;
function hideUsage() { void usageBoard?.then(view => view?.hide()); }
let pricingBoard = null;
function hidePricing() { void pricingBoard?.then(view => view?.hide()); }
let notchMenu = '';
let notchBranchData = null;
let notchBranchFolder = '';
let notchBranchLoading = false;
let notchBranchQuery = '';
let analyticsBoard = null;
function hideAnalytics() { void analyticsBoard?.then(view => view?.hide()); }
let academyBoard = null;
function hideAcademy() { void academyBoard?.then(view => view?.hide()); }
let neutrinoBoard = null;
function hideNeutrino() { void neutrinoBoard?.then(view => view?.hide()); }
// Puts a chat on screen, from the state the main process returns after moving to it.
function showSession(next) {
  closeBtw();
  hidePlugins();
  hideBoards();
  hideDesign();
  hideUsage();
  hidePricing();
  hideAnalytics();
  hideAcademy();
  hideNeutrino();
  state = next; sessionList.update(state.sessions);
  activityPopover?.refresh(); threadsPopover?.refresh();
  workView.end(); clearWorkText();
  conversationTimer.engage(); updateIdeas(); renderHistory();
  if (next.workRun) { workView.begin(state.sessions.active, next.workRun); if (next.workRun.text) showWorkText(next.workRun.text); $('#messages').lastElementChild?.scrollIntoView({ block: 'end' }); }
  syncWorkSession(); agentSwarmView.syncSession(); browserView.resetCommand(); sidePane.restore(state.sessions.pane); composerQueueView?.render(); composerStashView?.syncBadge(); diffAnnotationChips?.render(); void secretRequestsBanner?.refresh(); quoteSelection?.clear(); sideChatView?.refresh(); syncChatHeader(); error('');
}
function workRunOnScreen() { return Boolean(state.sessions?.work && state.sessions.running?.[state.sessions.active]); }
// A chat that's working offers Stop, whatever else is going on elsewhere.
function syncWorkControls() {
  const running = workRunOnScreen();
  if (running) { $('#stop').hidden = false; $('#record').disabled = true; }
  else if (!busy) { $('#stop').hidden = true; $('#record').disabled = false; }
  syncSendQueueButton();
}
function tokens(count) { return count >= 1000 ? `${(count / 1000).toFixed(count >= 100000 ? 0 : 1)}k` : String(count); }
// The token ledger's split, under the meter's own explanation: where the last turn's input went, and the chat's.
function splitTitle(split) {
  if (!split?.last) return '';
  const cached = share => share == null ? '' : `; ${share}% of it was read from the cache`;
  const tools = text => text ? ` (tool results by tool: ${text})` : '';
  return `\n\nWhere the input went (estimated from sizes), last turn: ${split.last}${tools(split.lastTools)}${cached(split.lastCached)}.${split.turns > 1 ? `\nThis chat, ${split.turns} turns: ${split.chat}${tools(split.chatTools)}${cached(split.chatCached)}.` : ''}`;
}
function syncWorkMeter() {
  const meter = workMeter(state.history, state.sessions?.work?.summarized), node = $('#work-meter');
  node.hidden = !state.history.length;
  const measured = Object.assign(document.createElement('span'), { className: 'meter-tokens', textContent: meter.measured ? ` · ${tokens(meter.input + meter.output)} tokens` : '' });
  node.replaceChildren(`Context ${meter.context}%`, measured);
  node.title = `Each turn starts with notes and a digest of this chat. ${meter.summarized ? `The first ${meter.summarized} messages are in the notes${meter.notesChars ? ` (${meter.notesChars.toLocaleString('en-AU')} characters, ${meter.notesShare}% of what’s sent)` : ''}, and notes plus digest are` : 'The digest is'} ${meter.context}% full. As the digest fills, Fairy writes older messages into the notes, which uses a little of your plan.${meter.measured ? ` So far this chat has sent ${tokens(meter.input)} tokens (${tokens(meter.cached)} from cache) and received ${tokens(meter.output)}, across the turns your provider reported.` : ''}` + splitTitle(meter.split);
}
// A work session swaps the mode switch and screen sharing for its folder and permission mode.
function syncWorkSession() {
  const work = state.sessions?.work;
  sideStrip.update(state.sessions);
  document.documentElement.classList.toggle('work-session', Boolean(work));
  $('#work-bar').hidden = !work;
  if (!workRunOnScreen()) { workView.setTasks(state.history.findLast(entry => entry.tasks)?.tasks || []); todoBox.set(work ? latestTasks(state.history) : []); }
  syncWorkControls();
  if (work) {
    $('#work-folder').textContent = work.name; $('#work-folder').title = work.folder;
    const perm = PERMISSIONS[work.permission] ? work.permission : 'ask';
    const permLabel = PERMISSIONS[perm];
    const permBtn = $('#work-permission');
    permBtn.dataset.permission = perm;
    permBtn.textContent = permLabel;
    permBtn.setAttribute('aria-label', `${permLabel} — what Fairy may do without asking`);
    permBtn.title = `${permLabel} — what Fairy may do without asking`;
    permBtn.disabled = workRunOnScreen();
    if (permBtn.disabled) setPermissionMenu(false);
    $('#work-where').hidden = Boolean(state.sessions.active); $('#work-where').value = work.isolate ? 'own' : 'here';
    $('#work-branch').hidden = !work.branch; $('#work-branch').textContent = work.branch || ''; $('#work-branch').title = work.branch ? `Working in ${work.path}` : '';
    syncWorkMeter();
    $('#home-greeting').textContent = `What should we work on in ${work.name}?`;
    $('#message').placeholder = 'Describe what you’d like done in this folder';
  } else {
    setPermissionMenu(false);
    updateSwarmWorkBar(null);
    if ($('#message').placeholder === 'Describe what you’d like done in this folder') document.querySelector(`[data-mode="${mode}"]`)?.click();
  }
  syncWorkNotch?.();
  modelMenu?.update();
  syncChatHeader();
  renderHomeToday();
}
// A turn that stopped, or that Fairy closed during, can pick up where it left off.
function drawCarryOn() {
  const last = state.history.at(-1);
  if (!state.sessions?.work || !last || workSending || workRunOnScreen() || !(last.unfinished || (last.role === 'user' && last.mode === 'work'))) return;
  // A note from a session this chat started waits for your next message; a task waiting for a free slot starts by itself.
  // A message you sent, and a quiet reply to one, start nothing (docs/session-messages.md).
  if (last.from && (last.quiet || ['child', 'reply', 'peer-reply'].includes(last.from.kind) || state.sessions.queued?.includes(state.sessions.active))) return;
  const row = document.createElement('div'), carry = document.createElement('button');
  row.className = 'work-carry-on'; carry.type = 'button'; carry.className = 'quiet'; carry.textContent = 'Carry on';
  carry.onclick = () => sendWork('Carry on from where that stopped.');
  const why = { sleep: 'Your Mac went to sleep, so this turn didn’t finish.', lock: 'Your Mac locked, so this turn didn’t finish.', quit: 'Fairy quit before this turn finished.', closed: 'Fairy closed before this turn finished. What it had done is recorded.', timeout: 'This turn ran past its time limit.' }[last.ended];
  const note = document.createElement('span'); note.textContent = last.unfinished ? why || 'This turn didn’t finish.' : last.from ? 'This hasn’t started yet.' : 'Fairy closed before this turn finished, so what it did isn’t recorded.';
  row.append(note, carry); $('#messages').append(row);
}
let tagging = null;
function tagDrawn() {
  if (!tagging) return;
  for (let node = tagging.after ? tagging.after.nextElementSibling : $('#messages').firstElementChild; node; node = node.nextElementSibling) node.dataset.entry ??= String(tagging.index);
}
// Compact: tell Fairy to fold this chat's older messages into notes now. They stay readable, folded away above.
async function compactChat() {
  if (!api) return;
  error(''); status('Compacting this chat…');
  try {
    const next = await api.sessionCompact();
    state.history = next.history; state.sessions = next.sessions; sessionList.update(state.sessions);
    renderHistory(); status('Compacted. Fairy keeps notes on the earlier messages.');
  } catch (e) { error(e.message); status('Ready'); }
}
function renderHistory() {
  $('#messages').replaceChildren();
  if (!state.history.length && !conversationReady()) {
    const welcome = document.createElement('div'); welcome.className = 'welcome';
    const symbol = document.createElement('span'); symbol.className = 'welcome-symbol'; symbol.textContent = '✧';
    const title = document.createElement('h3'); title.textContent = 'A new constellation starts here.';
    const description = document.createElement('p'); description.textContent = conversationReady() ? 'Say hello, share an idea, or give me something to help with.' : 'Add your DeepSeek API key or connect ChatGPT in Settings, then say hello. Your conversations will stay here between visits.';
    const button = document.createElement('button'); button.className = 'quiet'; button.textContent = conversationReady() ? 'Say hello ↗' : 'Set up Baryon ↗';
    button.onclick = () => conversationReady() ? send(`Hello, ${state.settings.name || 'Fairy'}!`) : void openSetupWizard();
    welcome.append(symbol, title, description, button); $('#messages').append(welcome);
  } else for (const [offset, entry] of state.history.slice(-80).entries()) {
    // Which message each drawn element belongs to, so compacted ones can be folded away afterwards.
    tagDrawn(); tagging = { index: Math.max(0, state.history.length - 80) + offset, after: $('#messages').lastElementChild };
    if (entry.handoff?.from && entry.handoff?.to) $('#messages').append(createHandoffDivider(entry.handoff));
    if (entry.activity?.length) workView.renderSaved(entry.activity);
    // What a linked chat sent: a task, a message, or a note on how a turn there went.
    if (entry.from) { $('#messages').append(noteView(entry, { onOpen: openLinked, renderText: renderReply })); continue; }
    if (entry.thoughts?.length) renderSavedThoughts(entry.thoughts);
    const drawn = message(entry.role, entry.content, entry.mode, { drawingAll: true, attachments: entry.attachments });
    // Reliability plan, Part C: Fairy's own check verdict under every work reply that changed files.
    if (entry.role === 'assistant' && entry.verdict?.line) addVerdictLine(drawn.item, entry.verdict);
    // Doc 7, #6: Run trace shortcut under work replies so any turn's timeline & handoffs open in one click.
    if (entry.role === 'assistant' && entry.mode === 'work' && api?.runTrace && (entry.activity?.length || entry.ledger || entry.durationMs)) {
      const traceBtn = document.createElement('button');
      traceBtn.type = 'button';
      traceBtn.className = 'message-trace-btn';
      traceBtn.textContent = 'Trace';
      traceBtn.title = 'Open this turn’s run trace (steps, models, timings, tokens and handoffs)';
      traceBtn.onclick = () => sidePane.show('trace', entry.replyTo || entry.at || '');
      messageFooter(drawn.item).append(traceBtn);
    }
    // What Auto chose for this reply: the model, and how hard it thought.
    if (entry.role === 'assistant' && entry.auto) addAutoLine(drawn.item, entry.auto, offset === state.history.slice(-80).length - 1 ? state.history.slice(-80).slice(0, offset).findLast(item => item.role === 'user')?.content || '' : '');
    // A swarm's build: who designed it and who built it. A hard request: Auto's suggestion of a swarm, never started for you.
    if (entry.role === 'assistant' && entry.swarmLine?.text) addSwarmLine(drawn.item, entry.swarmLine);
    if (entry.role === 'assistant' && entry.trySwarm && entry === state.history.at(-1)) addTrySwarm(drawn.item, entry.trySwarm);
    if (entry.role === 'assistant' && entry.at) addReplyTime(drawn.item, entry.at);
    if (entry.role === 'assistant' && entry.a2ui?.length) mountA2UISurfaces(drawn.item, entry.a2ui, a2uiHandlers(entry.at || ''));
    if (entry.role === 'assistant' && entry.board?.id) attachBoardCard(drawn.item, entry.board);
    // Findings from this turn that could be kept for the project (desktop/project-memory.mjs).
    if (entry.role === 'assistant' && entry.memoryProposal?.findings?.length && state.sessions?.work) drawn.item.append(memoryCard(entry.memoryProposal, async keep => { const next = await api.projectMemoryDecide(entry.at, keep); state.history = next.history; renderHistory(); }));
    if (entry.role === 'user') attachUserActions(drawn.item, entry, Math.max(0, state.history.length - 80) + offset);
  }
  tagDrawn(); tagging = null;
  foldCompacted($('#messages'), state.history, state.sessions?.summarized?.through ?? 0, { onNotes: () => openChatNotes({ api, onError: error }) });
  workView.restore(); if (workPartial) $('#messages').append(workPartial.item);
  drawCarryOn();
  // Scrolling and refreshing the panel once, rather than per message, avoids a layout for each and up to 80 `git status` runs.
  $('#messages').lastElementChild?.scrollIntoView({ block: 'end' });
  updateConversationChrome();
  drawnHistory = historySignature();
}
const historySignature = () => [state.sessions?.active, state.history.length, state.history.at(-1)?.at, state.settings.name, Boolean(conversationReady())].join('|');
function updateState() {
  requestBackgroundSync(); syncBgAnimButton();
  // Chat and Desktop task in one: with Automatic desktop requests on, Chat starts a task itself, so the switch shows
  // only when they're off (and you choose Desktop yourself).
  const manualDesktop = state.settings.autoDesktop === 'off';
  for (const node of document.querySelectorAll('.mode-switch, #floating-mode')) node.hidden = !manualDesktop;
  if (!manualDesktop && mode === 'desktop') document.querySelector('[data-mode="chat"]')?.click();
  notebookVoiceChanged();
  avatar?.setEffectsEnabled(state.settings.pixelEffects !== 'off');
  const displayName = state.settings.name || 'Fairy';
  $('#character-name').replaceChildren(document.createTextNode(displayName), Object.assign(document.createElement('span'), { textContent: '✧' }));
  $('#connection').textContent = conversationReady() ? ({ deepseek: 'DeepSeek ready', codex: 'ChatGPT connected', antigravity: 'Gemini connected', claude: 'Claude connected', openai: 'API ready' })[state.settings.backend] : 'Setup needed';
  const yourName = state.settings.userName?.trim();
  $('#home-greeting').textContent = yourName ? `Hi ${yourName}, what’s on your mind?` : 'What’s on your mind?';
  $('#profile-name').textContent = yourName || 'You';
  $('#profile-initial').textContent = (yourName || 'You')[0].toUpperCase();
  modelMenu?.update();
  $('#suggestions').hidden = !conversationReady();
  if (!$('#messages .message')) renderHistory();
  $('#connection').classList.toggle('configured', Boolean(conversationReady()));
  $('#voice-label').textContent = muted() ? 'muted' : { fish: 'Fish Audio', openai: 'OpenAI', off: 'off' }[state.settings.voiceProvider];
  $('#mute-voice').textContent = muted() ? 'Unmute voice' : 'Mute voice';
  for (const id of ['#mute-voice', '#floating-mute']) { $(id).setAttribute('aria-pressed', String(muted())); $(id).title = muted() ? `Unmute ${state.settings.name}` : `Mute ${state.settings.name} so replies are text only`; }
  $('#floating-mute').setAttribute('aria-label', muted() ? 'Unmute voice' : 'Mute voice');
  $('#floating-mute').innerHTML = muted() ? icons.muted : icons.speaker;
  conversationTimer.configure(Number(state.settings.proactiveMinutes) * (ambient.power?.ideaMultiplier || 1));
  vocalTimer.configure(Number(state.settings.vocalMinutes));
  updateIdeas();
  // A status update mid-reply mustn't redraw from a history that doesn't have this turn yet,
  // and one that changes nothing in the chat needn't redraw it at all.
  if (!busy && !workSending && drawnHistory !== historySignature()) renderHistory();
  syncWorkSession();
  $('#sidebar-study').hidden = !featureOn('notebooks');
  $('#sidebar-academy').hidden = !featureOn('academy');
  $('#sidebar-research').hidden = !featureOn('research');
  $('#sidebar-analytics').hidden = !featureOn('analytics');
  const planPill = $('#sidebar-pricing');
  if (planPill) {
    const isAdmin = Boolean(state.access?.isAdmin);
    planPill.textContent = isAdmin ? 'Admin' : state.access?.plan === 'pro' ? 'Pro' : 'Upgrade';
    planPill.classList.toggle('is-admin', isAdmin);
    planPill.title = isAdmin ? `Admin privileges (${state.access.email}) · View Plans & Checkout` : 'View Baryon Plans & Pricing';
  }
  void pricingBoard?.then(v => v?.refresh?.());
  todayController.syncBackground();
}

function updateIdeas() {
  requestBackgroundSync();
  const enabled = state.settings.proactiveMode === 'on';
  const waiting = conversationTimer.unanswered >= 2;
  $('#ideas-status').textContent = !enabled ? 'Ideas off' : ideasPaused ? 'Ideas paused' : waiting ? 'Waiting for your reply' : ambient.power?.optional === false ? 'Ideas paused to conserve power' : `A new thought after about ${Number(state.settings.proactiveMinutes) * (ambient.power?.ideaMultiplier || 1)} quiet minutes`;
  for (const id of ['#pause-ideas', '#floating-pause-ideas']) {
    $(id).textContent = ideasPaused ? 'Resume ideas' : 'Pause ideas';
    $(id).disabled = !enabled;
    $(id).setAttribute('aria-pressed', String(ideasPaused));
  }
  for (const id of ['#new-topic', '#floating-new-topic']) $(id).disabled = !enabled || busy;
}

const ideasBlocked = () => Boolean(state.sessions?.work) || state.companionHidden || ambient.power?.optional === false || !ambient.awake || ambient.paused || quizInfo.enabled || meetingActive(meetingPanel?.state) || handsFree.detector?.started || handsFree.processing || voiceGate.engaged || !initialized || !api || !conversationReady() || state.settings.proactiveMode !== 'on' || ideasPaused || busy || recorder || $('#settings').open || document.querySelector('.file-preview')?.open || $('#music')?.open || Boolean($('#message').value.trim()) || Boolean($('#floating-message').value.trim()) || document.hidden || mode === 'desktop';

async function startTopic(manual = false) {
  if (ideasBlocked()) return;
  if (!manual && !conversationTimer.due(false)) return;
  const token = ++generation;
  proactiveFinished = new Promise(resolve => { finishProactive = resolve; });
  proactiveRun = true; setBusy(true); updateIdeas();
  conversationTimer.defer();
  try {
    const result = await api.startConversation();
    if (!result || token !== generation) return;
    state.history = result.history; $('.welcome')?.remove();
    const drawn = message('assistant', result.text, 'proactive');
    addReplyTime(drawn.item, result.history?.findLast?.(entry => entry.role === 'assistant')?.at || new Date().toISOString());
    bubble(result.text);
    conversationTimer.delivered(); updateIdeas();
    spokenReply = result.speechText ?? result.text;
    const bytes = await api.speak(result.speechText ?? result.text);
    if (token === generation) { await play(bytes, token); if (token === generation) {
      status('Ready when you are');
      if (wantsListening() && state.settings.voiceFollowups === 'on') voiceGate.engage(13.2);
    } }
  } catch (e) {
    if (token === generation) { status(`Conversation idea paused: ${e.message}`); conversationTimer.snooze(); }
  } finally {
    proactiveRun = false; setBusy(false); updateIdeas();
    finishProactive();
  }
}

async function pauseIdeas() {
  ideasPaused = !ideasPaused;
  try { localStorage.setItem('stella-ideas-paused', String(ideasPaused)); } catch {}
  if (ideasPaused && (proactiveRun || vocalRun)) await stop();
  if (!ideasPaused) { conversationTimer.engage(); vocalTimer.defer(); }
  updateIdeas();
}
try { ideasPaused = localStorage.getItem('stella-ideas-paused') === 'true'; } catch {}
for (const id of ['#pause-ideas', '#floating-pause-ideas']) $(id).onclick = pauseIdeas;
for (const id of ['#new-topic', '#floating-new-topic']) $(id).onclick = () => startTopic(true);
for (const id of ['#latest-news', '#floating-news']) $(id).onclick = () => { if (mode !== 'chat') document.querySelector('[data-mode="chat"]').click(); void send('Give me a brief update on the latest technology and science news, with dates and sources.'); };
function noteInteraction(){avatar?.spriteAvatar.companion.interact();avatar?.spriteAvatar.reaction.stop();}
for(const event of ['keydown','pointerdown','wheel'])document.addEventListener(event,e=>{if(e.isTrusted)noteInteraction();},{passive:true,capture:true});
for (const event of ['keydown', 'pointerdown']) document.addEventListener(event, () => { conversationTimer.defer(); vocalTimer.defer(); requestBackgroundSync(); }, { passive: true });
document.addEventListener('visibilitychange', () => { requestBackgroundSync();conversationTimer.defer(); if (document.hidden && (proactiveRun || vocalRun)) void stop(); });

// Settings rows are authored flat; consecutive rows are grouped into cards the first time settings opens.
function groupSettingsRows(container) {
  let card = null;
  for (const node of [...container.children]) {
    if (node.matches('h3,h4,.settings-intro')) { card = null; continue; }
    if (node.matches('section') || (node.matches('div') && node.querySelector(':scope > section, :scope > h4, :scope > div[id]'))) { card = null; groupSettingsRows(node); continue; }
    if (!card) { card = document.createElement('div'); card.className = 'settings-card'; node.before(card); }
    card.append(node);
  }
}
let settingsGrouped = false, seatLists = {};
function openSettings() {
  if (!settingsGrouped) { settingsGrouped = true; for (const pane of document.querySelectorAll('.settings-pane')) groupSettingsRows(pane); }
  void api?.notesStatus().then(renderNotesStatus);
  void memorySettings.refresh(); void promiseSettings.refresh(); void googleAccountSettings.refresh(); void calendarSettings.refresh(); void gmailSettings.refresh(); void filesSettings.refresh(); void driveSettings.refresh();
  vocalTimer.defer();
  const form = $('#settings-form');
  fillModelOptions(state.antigravity?.models || [], state.settings.antigravityModel);
  // Models for each role: drawn now from what's known, again once the providers' lists arrive.
  renderSeatSettings({ root: $('#seat-models'), settings: state.settings, lists: { gemini: state.antigravity?.models || [], ...seatLists } });
  void api?.modelLists?.().then(lists => { if (!lists) return; seatLists = { gemini: lists.gemini || [], codex: lists.codex || [] }; renderSeatSettings({ root: $('#seat-models'), settings: state.settings, lists: seatLists }); }).catch(() => {});
  for (const [key, value] of Object.entries(state.settings)) if (form.elements[key]) form.elements[key].value = value;
  autoChoices?.sync();
  for (const name of ['openaiKey', 'fishKey', 'deepseekKey', 'geminiKey']) form.elements[name].value = '';
  for (const name of ['clearopenaiKey', 'clearfishKey', 'cleardeepseekKey', 'cleargeminiKey']) form.elements[name].checked = false;
  $('#gemini-key-status').textContent = state.hasGeminiKey ? '· saved' : '· for Auto';
  $('#openai-key-status').textContent = state.hasOpenAIKey ? '· saved' : '· only for OpenAI API options';
  $('#fish-key-status').textContent = state.hasFishKey ? '· saved' : '· optional';
  $('#deepseek-key-status').textContent = state.hasDeepSeekKey ? '· saved' : '· needed for DeepSeek API';
  $('#settings-error').hidden = true; $('#settings-search').value = ''; filterSettings(''); renderProfiles(); $('#settings').showModal();
  showSettingsPane(savedSettingsPane());
  updateBackendSettings();
  updateLocalSpeechSettings();
  $('#memory-status').textContent = `${state.memoryCount || 0} conversations available for recall. Saved facts and Things to remember remain when recall is cleared.`;
  updateIdleCount();
  showVoiceVolume(); showWallpaperDim();
  markSettingsClean();
  void refreshClaude(); void refreshWorkFolder(); void refreshSubscription();
}
// The save bar appears only when the form differs from what was opened.
let settingsBaseline = '';
const settingsValues = () => JSON.stringify([...new FormData($('#settings-form'))].filter(([, value]) => typeof value === 'string'));
const settingsDirty = () => settingsValues() !== settingsBaseline;
function updateSettingsBar(saved = false) {
  const dirty = settingsDirty(), failed = !$('#settings-error').hidden;
  $('#settings-bar-text').textContent = saved ? 'Saved' : 'Unsaved changes';
  $('#settings-bar-text').hidden = failed && !dirty;
  $('#settings-discard').hidden = $('#settings-save').hidden = saved || !dirty;
  $('#settings-save-bar').hidden = !saved && !dirty && !failed;
}
function markSettingsClean() { settingsBaseline = settingsValues(); updateSettingsBar(); }
function reopenSettings() {
  const panes = $('.settings-panes'), top = panes.scrollTop;
  $('#settings').close(); openSettings(); panes.scrollTop = top;
}
const leaveSettings = () => !settingsDirty() || confirm('Discard your unsaved settings?');
async function refreshSubscription(fresh = false) {
  if (!api) return;
  $('#subscription-status').textContent = 'Checking your Codex connection…';
  try {
    state.subscription = await api.subscriptionStatus(fresh === true);
    $('#subscription-status').textContent = state.subscription.connected ? `Connected with ChatGPT${state.subscription.plan ? ` · ${state.subscription.plan}` : ''}. Uses your Codex subscription allowance.` : (state.subscription.error || 'Sign in with ChatGPT, then refresh the connection.');
    updateState();
  } catch (e) { $('#subscription-status').textContent = e.message; }
  await refreshAntigravity();
}
// Only models agy reports can be selected; an unavailable saved model stays visible until changed.
function fillModelOptions(models, current) {
  const select = $('#settings-form').elements.antigravityModel;
  const names = models.includes(current) || !current ? models : [...models, current];
  select.replaceChildren(...names.map(name => {
    const option = document.createElement('option');
    option.value = name;
    // Only flag a missing model once agy has actually reported its list.
    option.textContent = models.length && !models.includes(name) ? `${name} · not available` : name;
    return option;
  }));
  if (current) select.value = current;
}
// Settings are one form split into panes; hidden panes still submit their fields.
const settingsTabs = [...document.querySelectorAll('.settings-nav [role="tab"]')];
function savedSettingsPane() { try { return localStorage.getItem('settings-pane') || 'companion'; } catch { return 'companion'; } }
function showSettingsPane(key, focusTab = false) {
  const tab = settingsTabs.find(t => t.dataset.pane === key) || settingsTabs[0];
  for (const t of settingsTabs) { const selected = t === tab; t.setAttribute('aria-selected', selected); t.tabIndex = selected ? 0 : -1; $(`#pane-${t.dataset.pane}`).hidden = !selected; }
  $('.settings-panes').scrollTop = 0;
  for (const note of $(`#pane-${tab.dataset.pane}`).querySelectorAll('p.field-note:not([id])')) {
    const expands = note.classList.contains('is-open') || note.scrollHeight > note.clientHeight + 1;
    note.classList.toggle('can-expand', expands);
    if (expands) { note.tabIndex = 0; note.setAttribute('role', 'button'); note.setAttribute('aria-expanded', String(note.classList.contains('is-open'))); } else { note.removeAttribute('tabindex'); note.removeAttribute('role'); }
  }
  if (focusTab) tab.focus();
  if (tab.dataset.pane === 'mac-utilities') vorssaintSettings?.refresh?.();
  try { localStorage.setItem('settings-pane', tab.dataset.pane); } catch {}
}
function filterSettings(query) {
  const q = query.trim().toLowerCase();
  for (const hit of document.querySelectorAll('#settings .search-hit')) hit.classList.remove('search-hit');
  const matches = new Map();
  for (const tab of settingsTabs) {
    const items = q ? [...$(`#pane-${tab.dataset.pane}`).querySelectorAll('label, h3, h4, .field-note, button.quiet, summary')].filter(el => el.textContent.toLowerCase().includes(q) && !el.closest('[hidden]:not(.settings-pane)')) : [];
    const found = !q || items.length || tab.textContent.toLowerCase().includes(q);
    tab.hidden = !found; if (found) matches.set(tab.dataset.pane, items);
    for (const el of items) el.classList.add('search-hit');
  }
  $('#settings-search-empty').hidden = matches.size > 0;
  if (!q || !matches.size) return;
  const current = settingsTabs.find(t => t.getAttribute('aria-selected') === 'true')?.dataset.pane;
  if (!matches.has(current)) showSettingsPane(matches.keys().next().value);
  const active = settingsTabs.find(t => t.getAttribute('aria-selected') === 'true').dataset.pane;
  matches.get(active)?.[0]?.scrollIntoView({ block: 'center' });
}
for (const tab of settingsTabs) {
  tab.onclick = () => showSettingsPane(tab.dataset.pane);
  tab.onkeydown = event => {
    const visible = settingsTabs.filter(t => !t.hidden), index = visible.indexOf(tab);
    const next = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: visible.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault(); showSettingsPane(visible[(next + visible.length) % visible.length].dataset.pane, true);
  };
}
$('#settings-search').addEventListener('input', event => filterSettings(event.target.value));
$('#settings-search').addEventListener('keydown', event => { if (event.key === 'Escape' && event.target.value) { event.preventDefault(); event.stopPropagation(); event.target.value = ''; filterSettings(''); } });
function updateBackendSettings() {
  const backend = $('#settings-form').elements.backend.value;
  $('#deepseek-settings').hidden = backend !== 'deepseek';
  $('#antigravity-settings').hidden = backend !== 'antigravity';
  const desktopBackend = $('#settings-form').elements.desktopBackend.value;
  $('#claude-settings').hidden = backend !== 'claude';
  // Disabled fields are not submitted, so the hidden provider's saved model is kept.
  $('#desktop-antigravity-model').hidden = $('#settings-form').elements.desktopAntigravityModel.disabled = desktopBackend !== 'antigravity';
  $('#desktop-openai-model').hidden = $('#settings-form').elements.desktopModel.disabled = desktopBackend === 'claude' || desktopBackend === 'antigravity';
  $('#desktop-claude-model').hidden = $('#settings-form').elements.desktopClaudeModel.disabled = desktopBackend !== 'claude';
  $('#quiz-claude-model').hidden = $('#settings-form').elements.quizClaudeModel.disabled = $('#settings-form').elements.quizProvider.value !== 'claude';
  $('#integration-claude-model').hidden = $('#settings-form').elements.integrationClaudeModel.disabled = $('#settings-form').elements.integrationProvider.value !== 'claude';
}
// The default work folder (Settings → Work sessions), chosen with this Mac's folder dialog.
function refreshWorkFolder() {
  const folder = state.settings?.workFolder || '';
  $('#work-folder-path').textContent = folder || 'No default folder.';
  $('#work-folder-clear').hidden = !folder;
}
$('#work-folder-choose').onclick = async () => { try { state = await api.workFolderChoose(); refreshWorkFolder(); } catch (e) { $('#work-folder-path').textContent = e.message; } };
$('#work-folder-clear').onclick = async () => { try { state = await api.workFolderClear(); refreshWorkFolder(); } catch (e) { $('#work-folder-path').textContent = e.message; } };
async function refreshClaude() {
  if(!api?.claudeStatus)return;
  try {state.claude=await api.claudeStatus();$('#claude-status').textContent=state.claude.connected?`Connected through Claude Code · ${state.claude.plan || 'subscription'}`:state.claude.error;updateState();}catch(e){$('#claude-status').textContent=e.message;}
}
$('#claude-refresh').onclick=refreshClaude;
async function refreshAntigravity({ force = false } = {}) {
  updateBackendSettings();
  if (!api?.antigravityStatus) return;
  const antigravityStatus = text => { $('#antigravity-status').textContent = $('#accounts-antigravity-status').textContent = text; };
  antigravityStatus(force ? 'Reloading Antigravity account & usage…' : 'Checking the Antigravity CLI…');
  try {
    state.antigravity = force && api.antigravityRefresh ? await api.antigravityRefresh() : await api.antigravityStatus();
    fillModelOptions(state.antigravity.models || [], state.settings.antigravityModel);
    antigravityStatus(state.antigravity.connected ? `Connected through agy · ${state.antigravity.models.length} models available. Uses your Antigravity subscription allowance.` : state.antigravity.error);
    updateState();
  } catch (e) { antigravityStatus(e.message); }
  api.agyCheckState?.().then(renderAgyCheck).catch(() => {});
}
// agy updates itself and has broken Gemini turns before, so Fairy checks each new version with real turns.
function renderAgyCheck(value) {
  const box = $('#agy-check-status'), { running, last, signIn } = value || {};
  $('#agy-check-run').disabled = Boolean(running);
  box.replaceChildren();
  // Checked every few hours, as Fairy's tool turns run agy: it can lose its sign-in there without updating.
  if (signIn && !signIn.ok && signIn.signIn) {
    const lost = document.createElement('p'); lost.className = 'field-note warn';
    lost.textContent = `Gemini can’t sign in for Fairy’s tools (checked ${new Date(signIn.at).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}): ${signIn.detail || 'not signed in'}. Calendar, Gmail, Drive and work sessions on Gemini won’t work until it can.`;
    box.append(lost);
  }
  if (running) { box.append(`Checking Gemini on agy ${running.version}: ${running.label.toLowerCase()}, ${running.index + 1} of ${running.total}…`); return; }
  if (!last) { box.append('Whenever agy updates itself, Fairy asks Gemini a screen question, a web search, a tool call and a plain chat message, and tells you if one stops working. Every few hours it also checks Gemini can still sign in for Fairy’s tools.'); return; }
  const when = new Date(last.at).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  if (last.status === 'ok') { box.append(`agy ${last.version}, checked ${when}: screen questions, web search, tools and tool-free chat all worked.`); return; }
  if (last.status === 'unreachable') { box.append(`Couldn’t reach Gemini to check agy ${last.version} (${when}): ${last.steps[0]?.detail || 'no reply'} Fairy will try again later.`); return; }
  box.append(`agy ${last.version}, checked ${when}. Not working:`);
  const list = document.createElement('ul');
  for (const step of last.steps.filter(step => !step.ok)) { const item = document.createElement('li'); item.textContent = `${step.label}: ${step.detail || 'failed'}`; list.append(item); }
  box.append(list, 'Fairy checks again when agy updates, or press Check Gemini after updating Fairy.');
}
$('#settings-form').elements.backend.addEventListener('change', updateBackendSettings);
$('#settings-form').elements.desktopBackend.addEventListener('change', updateBackendSettings);
$('#settings-form').elements.quizProvider.addEventListener('change', updateBackendSettings);
$('#settings-form').elements.integrationProvider.addEventListener('change', updateBackendSettings);
function updateIdleCount() {
  const lines = new Set($('#settings-form').elements.idleDialogueLines.value.split(/\r?\n/).map(x => x.trim()).filter(Boolean));
  $('#idle-line-count').textContent = `${lines.size} lines · one line per dialogue`;
}
$('#settings-form').elements.idleDialogueLines.insertAdjacentHTML('afterend', '<span id="idle-line-count" class="field-note"></span>');
$('#settings-form').elements.idleDialogueLines.addEventListener('input', updateIdleCount);
$('#clear-memory').onclick = async () => {
  if (!api) return;
  if (!confirm('Clear older conversation recall? Chat history and your saved notes will stay.')) return;
  try { state = await api.clearMemory(); $('#memory-status').textContent = 'Older conversation recall cleared.'; }
  catch (e) { error(e.message); }
};
$('#subscription-refresh').onclick = () => refreshSubscription(true);
$('#subscription-login').onclick = async () => {
  try { await api?.subscriptionLogin(); $('#subscription-status').textContent = 'Finish signing in in your browser, then click Refresh connection.'; }
  catch (e) { $('#subscription-status').textContent = e.message; }
};
function stopAudio() {
  requestBackgroundSync();
  if (audio) echoUntil = Date.now() + 1200;
  if (audio) { audio.pause(); audio = null; inkVoice(0); } if (avatar) { avatar.mouth = 0; avatar.vocalMusic = false; avatar.setActivity('idle'); }
}
function closePlaybackContext() {
  if(audio || activeVoiceQueue || notebookVoiceQueue || !audioContext)return;
  const context=audioContext;audioContext=null;
  void context.close().catch(()=>{});
}
async function prepareSpeech(part) {
  audioContext ||= new AudioContext();
  const buffer=await audioContext.decodeAudioData(new Uint8Array(part.bytes).buffer);
  const {bytes: _bytes, ...metadata}=part;
  return {...metadata,buffer,...speechRange(buffer)};
}
const muted = () => state.settings.muted === 'on';
// While Settings is open she follows the slider, so it can be heard before it's saved.
const voiceGain = () => speechGain($('#settings').open ? $('#settings-form').elements.voiceVolume.value : state.settings.voiceVolume);
function showVoiceVolume() { $('#voice-volume-value').textContent = `${$('#settings-form').elements.voiceVolume.value}%`; }
$('#settings-form').elements.voiceVolume.addEventListener('input', () => { showVoiceVolume(); audio?.setGain(voiceGain()); });
function showWallpaperDim() { $('#wallpaper-dim-value').textContent = `${$('#settings-form').elements.wallpaperDim.value}%`; }
$('#settings-form').elements.wallpaperDim.addEventListener('input', showWallpaperDim);
// While Settings is open the background previews the choices there, and goes back to the saved ones if they're discarded.
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)'), reducedTransparency = matchMedia('(prefers-reduced-transparency: reduce)');
// The rail's velvet button: from the wallpaper to Velvet (near-black, its aurora grid) and back, poured in from Fairy's eye with a
// ring running out, as on the phone. It remembers the picture to go back to (wallpaperLast).
let bgAnimOff = loadBgAnimOff();
function syncBgAnimButton() {
  document.documentElement.classList.toggle('bg-anim-off', bgAnimOff);
  const button = $('#wallpaper-toggle');
  if (!button) return;
  button.setAttribute('aria-pressed', String(bgAnimOff));
  button.title = bgAnimOff
    ? 'Turn on background animations across all modes'
    : 'Turn off background animations across all modes (pure black)';
  button.textContent = bgAnimOff ? 'Animations off' : 'Animations on';
}
$('#wallpaper-toggle').onclick = () => {
  if (floating || $('#settings').open) return;
  bgAnimOff = toggleBgAnimOff(bgAnimOff);
  saveBgAnimOff(bgAnimOff);
  syncWallpaper();
  window.dispatchEvent(new CustomEvent('fairy:bg-anim-change', { detail: { off: bgAnimOff } }));
};
// Efficiency audit, fix 4: the main process says when nobody can see the window (covered, on another Space, minimized,
// hidden or closed). The avatar stops on the policy's fps of 0; this stops everything else that moves: CSS animations
// (style.css), the wallpaper and Velvet's dots, and the music check that only feeds an animation.
function unseen() { return ambient.power?.visible === false; }
function syncUnseen() {
  if (document.documentElement.classList.contains('unseen') === unseen()) return;
  document.documentElement.classList.toggle('unseen', unseen());
  requestBackgroundSync();
}
function syncWallpaper() {
  syncBgAnimButton();
  const form = $('#settings-form'), settingsOpen = $('#settings').open;
  const settings = settingsOpen ? { ...state.settings, ...Object.fromEntries(['windowWallpaper', 'wallpaperMotion', 'wallpaperReactive', 'wallpaperDim'].map(key => [key, form.elements[key].value])) } : state.settings;
  const seen = { settingsOpen, dialogOpen: Boolean(document.querySelector('dialog[open]')), hidden: document.hidden || unseen(), focused: document.hasFocus(), lowPower: ambient.power?.optional === false, reducedMotion: reducedMotion.matches, animOff: bgAnimOff };
  const classes = document.documentElement.classList;
  const notebook = classes.contains('notebook-open') && !classes.contains('floating');
  const research = ['research-open', 'diffusion-open', 'runs-open', 'goals-open', 'boards-open', 'analytics-open', 'academy-open'].some(name => classes.contains(name));
  const pluginsOpen = classes.contains('plugins-open');
  const usageOpen = classes.contains('usage-open');
  const neutrinoOpen = classes.contains('neutrino-open');
  const chatOpen = !notebook && !research && !pluginsOpen && !usageOpen && !neutrinoOpen && !classes.contains('home');
  const notebookChatOpen = notebook && classes.contains('notebook-book');
  applyWallpaper(document.documentElement, wallpaperState({ settings, ...seen,
    reducedTransparency: reducedTransparency.matches, research: research || pluginsOpen || usageOpen || neutrinoOpen, notebook, chatOpen,
    animOff: bgAnimOff,
    busy: busy || classes.contains('desktop-working'), listening: Boolean(recorder) || voiceGate.engaged || Boolean(handsFree.processing) }));
  // Notebook's own sky, over whatever the wallpaper is (active only on Notebooks Home, fades smoothly in notebook chat).
  applyNotebookSky(document.documentElement, notebookSkyState({ notebook, chatOpen: notebookChatOpen, ...seen }));
}
for (const query of [reducedMotion, reducedTransparency]) query.addEventListener('change', () => requestBackgroundSync());
for (const event of ['focus', 'blur']) window.addEventListener(event, () => requestBackgroundSync());
$('#settings').addEventListener('close', () => audio?.setGain(voiceGain()));
async function setMuted(value) {
  if (!api) return;
  try { state.settings = await api.setMuted(value); } catch (e) { error(e.message); return; }
  if (value) { activeVoiceQueue?.cancel(); activeVoiceQueue=null; stopNotebookVoice(); stopAudio(); closePlaybackContext(); } // Silence a reply mid-sentence; its text keeps streaming.
  updateState();
}
for (const id of ['#mute-voice', '#floating-mute']) $(id).onclick = () => setMuted(!muted());
// options.live: whether the clip is still wanted, for speech that keeps its own turn (the notebook's); else the chat's.
// Her voice level, about 15 times a second, for the pixel waveform on screen-ink cards.
var inkVoiceAt=0;
function inkVoice(level){const now=performance.now();if(now-inkVoiceAt<66&&level>0)return;inkVoiceAt=now;api?.inkVoice?.(level);}
async function playClip(part,token,options={}) {
  const live=options.live||(()=>token===generation);
  if(!live()||muted())return;
  audioContext ||= new AudioContext();
  stopAudio();
  const current=new ClipPlayback({context:audioContext,gain:voiceGain(),allowed:()=>live()&&!muted(),
    onLevel:level=>{if(avatar)avatar.mouth=Math.min(options.humming ? .06 : 1,level);inkVoice(options.humming?0:level);},
    onStart:()=>{status(options.label||'Speaking…');if(avatar)avatar.vocalMusic=Boolean(vocalRun||options.humming);avatar?.setActivity('speaking');options.onStart?.();}});
  audio=current;current.notebook=Boolean(options.notebook);
  try {await current.play({...part,volume:options.volume,maxSeconds:options.maxSeconds});}
  finally {if(audio===current)stopAudio();closePlaybackContext();}
}
async function playSpeech(part,token,onStart){await playClip(part,token,{onStart});}
// The notebook tutor's answers, read aloud in Fairy's voice at her voice volume. They keep their own turn, so a chat
// reply still arriving isn't dropped, and stop when she's muted, Stop is pressed, or the notebook is left.
function stopNotebookVoice(){
  notebookVoiceTurn++;
  const queue=notebookVoiceQueue;notebookVoiceQueue=null;
  if(!queue)return;
  queue.cancel();api?.notebook('hush').catch(()=>{});
  if(audio?.notebook)stopAudio();
  closePlaybackContext();
}
async function speakNotebook(chatId,index){
  stopNotebookVoice();
  if(!api||muted())return {spoken:false};
  const turn=++notebookVoiceTurn,live=()=>turn===notebookVoiceTurn,requestId=crypto.randomUUID();
  const queue=new ReplyAudio({allowed:()=>live()&&!muted(),prepare:prepareSpeech,play:part=>playClip(part,0,{live,notebook:true})});
  notebookVoiceQueue=queue;
  const unsubscribe=api.onNotebookVoice(value=>{if(value.requestId===requestId&&live())queue.push(value);});
  try{
    const result=await api.notebook('speak',chatId,index,requestId);
    if(live())await queue.finish();
    return {...result,stopped:result.stopped||!live()};
  } finally {unsubscribe();if(notebookVoiceQueue===queue)notebookVoiceQueue=null;closePlaybackContext();if(live()&&!busy)status('Ready when you are');}
}
async function play(bytes,token,options={}){if(bytes)await playClip({bytes},token,options);}
const vocalsBlocked = () => state.companionHidden || ambient.power?.optional === false || !ambient.awake || ambient.paused || handsFree.detector?.started || handsFree.processing || voiceGate.engaged || quizInfo.enabled || muted() || meetingActive(meetingPanel?.state) || !initialized || !api || state.settings.vocalMode === 'off' || state.settings.voiceProvider !== 'fish' || !state.hasFishKey || !state.settings.fishVoiceId || ideasPaused || busy || recorder || audio || document.hidden || mode === 'desktop' || $('#settings').open || $('#music').open || Boolean($('#message').value.trim()) || Boolean($('#floating-message').value.trim());
async function automaticVocal() {
  if (!vocalTimer.due(vocalsBlocked())) return;
  try { localStorage.setItem('stella-last-vocal', String(vocalTimer.attempted())); } catch { vocalTimer.attempted(); }
  const kind = vocalTimer.choose(state.settings.vocalMode), token = ++generation;
  vocalFinished = new Promise(resolve => { finishVocal = resolve; }); vocalRun = true; setBusy(true);
  let playbackWatch, checking = false;
  try {
    const bytes = await api.automaticVocal(kind);
    if (!bytes || token !== generation) return;
    playbackWatch = setInterval(async () => {
      if (checking || token !== generation) return; checking = true;
      try { if (!await api.vocalPlaybackOK() && token === generation) await stop(); }
      catch { if (token === generation) await stop(); }
      finally { checking = false; }
    }, 2500);
    await play(bytes, token, { volume: .18, maxSeconds: 6, humming: kind === 'hum', label: kind === 'hum' ? 'Humming softly…' : 'A little melody…' });
  } catch { /* Background vocals quietly skip network, provider and playback errors. */ }
  finally {
    clearInterval(playbackWatch); vocalRun = false; setBusy(false); vocalTimer.defer(); conversationTimer.defer();
    if (token === generation) status('Ready when you are');
    finishVocal();
  }
}


async function previewVocal(kind) {
  if (!api) throw new Error('Open the desktop app to preview vocals.');
  if (vocalRun) { await stop(); await vocalFinished; }
  if (proactiveRun) { await stop(); await proactiveFinished; }
  if (busy || recorder || audio) throw new Error('Finish speaking or stop the current task before previewing vocals.');
  const song = kind === 'original-song';
  const token = ++generation;
  vocalFinished = new Promise(resolve => { finishVocal = resolve; }); vocalRun = true;
  setBusy(true); error(''); conversationTimer.defer();
  let playbackWatch, checking = false;
  try {
    const bytes = await api.previewVocal(kind);
    if (token !== generation) return;
    $('#music').close();
    if (song) bubble('♪ Singing your song…');
    playbackWatch = setInterval(async () => {
      if (checking || token !== generation) return; checking = true;
      try { if (!await api.previewPlaybackOK() && token === generation) await stop(); }
      catch { if (token === generation) await stop(); }
      finally { checking = false; }
    }, 2500);
    await play(bytes, token, { volume: song ? 0.65 : 0.22, maxSeconds: song ? 30 : 8, humming: kind === 'hum', label: song ? 'Singing your song…' : kind === 'hum' ? 'Soft humming preview…' : 'Wordless melody preview…' });
    if (token === generation) status(song ? 'Song finished' : 'Vocal preview finished');
    return token === generation;
  } catch (e) { if (token === generation) { status('Playback unavailable'); error(e.message); throw e; } return false; }
  finally {
    clearInterval(playbackWatch); if (song) bubble('');
    vocalRun = false; setBusy(false); conversationTimer.defer(); vocalTimer.defer(); finishVocal();
  }
}
function setDraft(text) { requestBackgroundSync(); $('#message').value = text; $('#floating-message').value = text; }
// Work sessions run by themselves: sending starts the turn and returns, and what happens next arrives as events.
function showWorkText(text) {
  workText = text;
  if (!workText) {
    clearTimeout(workTextTimer); workTextTimer = null;
    if (workPartial) { workPartial.item.remove(); workPartial = null; }
    return;
  }
  workTextTimer ||= setTimeout(() => {
    workTextTimer = null;
    if (!workText) return;
    workPartial ||= message('assistant', '');
    renderReply(workPartial.content, workText);
    workPartial.label.textContent = `${state.settings.name.toUpperCase()} · WRITING`;
  }, 60);
}
function clearWorkText() { clearTimeout(workTextTimer); workTextTimer = null; workText = ''; if (workPartial) { workPartial.item.remove(); workPartial = null; } }
let pendingWorkOptions = {};
async function sendWork(text, options = pendingWorkOptions) {
  pendingWorkOptions = {};
  const quotes = options.fromQueue ? (options.quotes || []) : (options.quotes ?? (quoteSelection?.take?.() || []));
  const comments = options.fromQueue ? (options.comments || []) : (options.comments ?? (diffAnnotations.take(activeSessionKey()) || []));
  const fullText = formatReviewCommentsPrompt(comments, formatQuotedPrompt(quotes, text));
  if (!fullText || !api || workSending) return;
  if (workRunOnScreen()) { error('Fairy is still working in this chat. Stop it first, or wait for it to finish.'); return; }
  noteInteraction(); voiceGate.close(); conversationTimer.engage();
  generation++; stopAudio();
  const files = options.fromQueue ? (options.attachments || []) : attachmentDraft.take();
  workSending = true; error(''); setDraft(''); composerStashView?.syncBadge(); $('.welcome')?.remove(); const drawnUser = message('user', fullText, 'work', { attachments: files });
  clearWorkText(); workView.begin(); status('Working…');
  try {
    const started = await api.workSend(fullText, files.map(file => file.id));
    state.history = started.history; state.sessions = started.sessions; drawnHistory = historySignature();
    const savedIdx = started.history?.findLastIndex?.(entry => entry.role === 'user') ?? -1;
    if (savedIdx >= 0 && drawnUser?.item) attachUserActions(drawnUser.item, started.history[savedIdx], savedIdx);
    workView.attach(started.session);
    sessionList.update(state.sessions); syncWorkSession();
  } catch (e) {
    workView.end(); renderHistory(); error(e.message); if (!$('#message').value) setDraft(text); attachmentDraft.restore(files); quoteSelection?.restore?.(quotes); diffAnnotations.restore(activeSessionKey(), comments); status('Ready when you are');
  } finally { workSending = false; syncSendQueueButton(); }
}
// A turn that started without you sending anything, such as a note arriving from a session this chat started.
function workStarted(event) {
  if (event.session !== state.sessions?.active || workSending) return;
  if (event.history) state.history = event.history;
  workView.end(); clearWorkText(); renderHistory();
  workView.begin(event.session); status('Working…'); syncWorkSession();
}
async function workFinished(event) {
  if (event.session !== state.sessions?.active) return;
  const wasSteered = steeringPending?.sessionId === event.session;
  if (event.history) state.history = event.history;
  workView.end(); clearWorkText(); renderHistory(); syncWorkSession();
  status(event.failed ? (wasSteered ? 'Steering…' : 'Stopped') : 'Ready when you are');
  bubble(event.text, { reset: true });
  if (!event.failed || wasSteered) void drainComposerQueue(event.session);
  if (busy || muted()) return;
  // Read out only if nothing else has started since.
  const token = ++generation;
  setBusy(true);
  try { const bytes = await api.speak(event.text); if (token === generation) await play(bytes, token); }
  catch { /* The reply is on screen; missing speech isn't worth interrupting for. */ }
  finally { setBusy(false); }
}
const USER_ACTION_ICONS = {
  copy: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
  edit: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  rewind: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
};

async function copyMessageText(text) {
  const value = String(text ?? '');
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(value); return true; } catch {}
  }
  const box = document.createElement('textarea');
  box.value = value; box.setAttribute('readonly', '');
  box.style.position = 'fixed'; box.style.opacity = '0';
  document.body.append(box); box.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch {}
  box.remove();
  return ok;
}

function attachUserActions(item, entry, entryIndex) {
  if (!item || !entry) return;
  item.querySelector('.message-actions')?.remove();
  const actions = document.createElement('span');
  actions.className = 'message-actions';

  if (entry.mode === 'work' && entry.at && state.sessions?.work && api?.evalDraft) {
    // Save as eval (docs/evals-from-sessions.md): this request, where it started and a check, kept to measure Fairy by.
    const saveEval = document.createElement('button');
    saveEval.type = 'button'; saveEval.className = 'message-rewind';
    saveEval.textContent = 'Save as eval'; saveEval.title = 'Save as eval';
    saveEval.onclick = () => { void import('./save-eval.js').then(({ openSaveEval }) => openSaveEval({ api, at: entry.at, onError: error, onSaved: saved => status(`Saved “${saved.title}” as an eval`) })); };
    actions.append(saveEval);
  }

  const makeBtn = (action, label, iconMarkup, onClick) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'message-action-btn';
    btn.dataset.action = action;
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.innerHTML = iconMarkup;
    btn.onclick = () => onClick(btn);
    return btn;
  };

  let copyTimer = null;
  const copyBtn = makeBtn('copy', 'Copy message', USER_ACTION_ICONS.copy, async btn => {
    await copyMessageText(entry.content);
    btn.innerHTML = USER_ACTION_ICONS.check;
    btn.classList.add('copied');
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => { btn.innerHTML = USER_ACTION_ICONS.copy; btn.classList.remove('copied'); }, 1400);
  });
  const editBtn = makeBtn('edit', 'Edit message', USER_ACTION_ICONS.edit, () => startInlineEdit(item, entry, entryIndex));
  const rewindBtn = makeBtn('rewind', 'Undo to this point', USER_ACTION_ICONS.rewind, () => void rewindTo(entry, entryIndex));

  actions.append(copyBtn, editBtn, rewindBtn);
  item.append(actions);
}

async function performRewind(entry, entryIndex, { workConfirm, chatConfirm = '' }) {
  if (busy || workRunOnScreen() || workSending) { error('Stop this chat’s current reply first.'); return null; }
  if (!api) return null;
  const isWork = Boolean(state.sessions?.work && entry?.mode === 'work' && entry?.at);
  if (isWork && workConfirm && !confirm(workConfirm)) return null;
  if (!isWork && chatConfirm && !confirm(chatConfirm)) return null;
  const next = isWork ? await api.workRewind(entry.at) : await api.chatRewind({ at: entry?.at || '', index: entryIndex });
  return { next, isWork };
}

async function rewindTo(entry, entryIndex = -1) {
  try {
    const result = await performRewind(entry, entryIndex, {
      workConfirm: 'Go back to before this message?\n\nFiles Fairy changed with its file tools since then go back to how they were, and later messages are removed. Anything its commands did, such as installs or commits, isn’t undone.',
      chatConfirm: 'Undo to this message?\n\nLater messages in this chat will be removed, and this message will move back to the input box.',
    });
    if (!result) return;
    const { next, isWork } = result, { text, restored = [], conflicts = [], attachments = [] } = next.rewind;
    showSession(next); setDraft(text); attachmentDraft.restore(attachments); $('#message').focus();
    if (isWork) {
      status(restored.length ? `Put back ${restored.length} ${restored.length === 1 ? 'file' : 'files'}` : 'No files needed putting back');
      if (conflicts.length) error(`Left alone, because they changed since: ${conflicts.join(', ')}`);
    } else {
      status('Undid back to this message');
    }
  } catch (e) { error(e.message); }
}

function startInlineEdit(item, entry, entryIndex) {
  if (busy || workRunOnScreen() || workSending) { error('Stop this chat’s current reply first.'); return; }
  const existing = item.querySelector('.message-inline-edit');
  if (existing) { existing.querySelector('textarea')?.focus(); return; }

  const editor = document.createElement('div');
  editor.className = 'message-inline-edit';
  const input = document.createElement('textarea');
  input.className = 'message-edit-input';
  input.value = String(entry?.content || '');
  input.rows = Math.min(8, Math.max(2, input.value.split('\n').length));
  input.setAttribute('aria-label', 'Edit message');

  const bar = document.createElement('div');
  bar.className = 'message-edit-bar';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button'; cancelBtn.className = 'message-edit-cancel'; cancelBtn.textContent = 'Cancel';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button'; saveBtn.className = 'message-edit-save'; saveBtn.textContent = 'Save & Resend';

  const closeEditor = () => { editor.remove(); item.classList.remove('is-editing'); };
  cancelBtn.onclick = closeEditor;

  const submitEdit = async () => {
    const edited = input.value.trim();
    if (!edited) { error('Enter a message before resending.'); input.focus(); return; }
    saveBtn.disabled = true; cancelBtn.disabled = true; input.disabled = true;
    try {
      const result = await performRewind(entry, entryIndex, {
        workConfirm: 'Edit and resend from this message?\n\nFiles Fairy changed with its file tools since then go back to how they were, and later messages are replaced.',
      });
      if (!result) { saveBtn.disabled = false; cancelBtn.disabled = false; input.disabled = false; input.focus(); return; }
      const { next } = result;
      showSession(next);
      attachmentDraft.restore(next.rewind.attachments || []);
      void send(edited);
    } catch (e) {
      error(e.message);
      saveBtn.disabled = false; cancelBtn.disabled = false; input.disabled = false; input.focus();
    }
  };
  saveBtn.onclick = () => void submitEdit();
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeEditor(); }
    else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void submitEdit(); }
  });

  bar.append(cancelBtn, saveBtn);
  editor.append(input, bar);
  item.classList.add('is-editing');
  item.append(editor);
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}
async function runFanoutComparison(prompt) {
  if (!api?.modelFanout) { error('Fan-out requires the desktop app.'); return; }
  message('user', `/fanout ${prompt}`, mode);
  const drawn = message('assistant', 'Asking connected models in parallel…', mode);
  try {
    const res = await api.modelFanout(prompt);
    drawn.content.replaceChildren(renderFanoutCard({
      prompt: res?.prompt || prompt,
      results: res?.results || [],
      onCopy: item => {
        navigator.clipboard?.writeText(item.text).catch(() => {});
        status(`Copied ${item.label || item.provider} reply`);
      },
      onPick: item => {
        setDraft(`Continue using this approach from ${item.label || item.provider}:\n\n${item.text.slice(0, 2000)}\n\n`);
        $('#message').focus();
        status(`Loaded ${item.label || item.provider} reply into composer`);
      },
    }));
  } catch (e) {
    renderReply(drawn.content, `Fan-out failed: ${e.message}`);
    error(e.message);
  }
}
function send(text = $('#message').value.trim(), options = {}) {
  if (/^\/compact\s*$/i.test(text)) { $('#message').value = ''; void compactChat(); return; }
  if (/^\/stash\s*$/i.test(text)) { setDraft(''); composerStashView?.openMenu?.(); return Promise.resolve(); }
  const sideCmd = text.match(/^\/side(?:\s+([\s\S]+))?$/i);
  if (sideCmd) { setDraft(''); if (sideCmd[1]?.trim()) sideChatView.setQuote(''); sidePane?.show('side-chat'); return Promise.resolve(); }
  // /btw and /fork work in any chat, work sessions too, and /btw even while Fairy is busy.
  const btw = text.match(/^\/btw\s+([\s\S]+)$/i);
  if (btw) { setDraft(''); showBtw(btw[1].trim()); return Promise.resolve(); }
  if (/^\/btw\s*$/i.test(text)) { error('Ask a question after /btw, such as “/btw what does this error mean?”'); return Promise.resolve(); }
  const fanout = text.match(/^\/fanout(?:\s+([\s\S]+))?$/i);
  if (fanout) {
    if (!fanout[1]?.trim()) { error('Ask a prompt after /fanout, such as “/fanout compare caching designs”.'); return Promise.resolve(); }
    setDraft('');
    return runFanoutComparison(fanout[1].trim());
  }
  if (/^\/fork\s*$/i.test(text)) { setDraft(''); void forkChat(); return Promise.resolve(); }
  const toWork = /^\/to-work(?:\s+(scratch))?\s*$/i.exec(text);
  if (toWork) { setDraft(''); void convertChatToWork(toWork[1]?.toLowerCase()); return Promise.resolve(); }
  if (/^\s*\/brief\s*$/i.test(text)) { setDraft(''); return generateMorningBrief(); }
  if (/^\s*\/investigate\s*$/i.test(text)) { error('Ask a question after /investigate, such as “/investigate how does attention scale cleanly?”.'); return Promise.resolve(); }
  if (/^\s*\/ui\s*$/i.test(text)) { error('Describe the interactive UI you want after /ui, such as “/ui loan calculator”.'); return Promise.resolve(); }
  // /reproduce <arXiv id or link> (reproduce-plan, stage 1): fetch paper politely, unpack in sandbox, add a goal; no model call.
  const repro = parseReproduceCommand(text);
  if (repro.matched) {
    if (!repro.paper) { error('Give an arXiv id or link after /reproduce, such as “/reproduce 2401.01234”.'); return Promise.resolve(); }
    setDraft('');
    return startReproduction(repro.paper);
  }
  // /swarm <brief>, /teamwork <brief>, or /agents <brief>: open Antigravity-style parallel agent swarm side panel.
  const teamwork = parseTeamworkCommand(text);
  if (teamwork.matched) {
    if (!state.sessions?.work) { error('Open a work session first to deploy a parallel agent swarm.'); return Promise.resolve(); }
    setDraft('');
    if (teamwork.brief) agentSwarmView.seedBrief(teamwork.brief);
    sidePane.show('swarm');
    return Promise.resolve();
  }
  if (!text && attachmentDraft.list().length) text = attachmentDraft.defaultText();
  if (!text && !options.fromQueue && quoteSelection?.list?.().length) text = 'Thoughts on this?';
  if (!text && !options.fromQueue && diffAnnotations.list(activeSessionKey()).length) text = 'Please address these review comments.';
  if (explainArmed && floating && text && !options.mode) { armExplain(false); options = { ...options, mode: 'explain' }; }
  if (!options.fromQueue && isTurnActiveNow()) {
    if (!api) return Promise.resolve();
    const sid = activeSessionKey();
    const files = attachmentDraft.take();
    const quotes = quoteSelection?.take?.() || [];
    const comments = diffAnnotations.take(sid) || [];
    const entry = composerQueue.enqueue(sid, { text, attachments: files, quotes, comments, mode: options.mode || mode });
    if (!entry) { attachmentDraft.restore(files); quoteSelection?.restore?.(quotes); diffAnnotations.restore(sid, comments); return Promise.resolve(); }
    setDraft('');
    composerStashView?.syncBadge();
    composerQueueView?.render();
    if (options.steer) steerQueuedEntry(entry, sid);
    else status('Queued follow-up');
    return Promise.resolve();
  }
  pendingWorkOptions = options;
  if (state.sessions?.work) return sendWork(text);
  if (busy && !vocalRun && !proactiveRun) return Promise.resolve();
  const pending = sendMessage(text, options);
  replyFinished = pending; return pending;
}
async function sendMessage(text, options = {}) {
  if (vocalRun) { await stop(); await vocalFinished; }
  if (proactiveRun) { await stop(); await proactiveFinished; }
  const quotes = options.fromQueue ? (options.quotes || []) : (options.quotes ?? (quoteSelection?.take?.() || []));
  const comments = options.fromQueue ? (options.comments || []) : (options.comments ?? (diffAnnotations.take(activeSessionKey()) || []));
  const fullText = formatReviewCommentsPrompt(comments, formatQuotedPrompt(quotes, text));
  if (busy || !fullText) { if (quotes.length && !options.fromQueue) quoteSelection?.restore?.(quotes); if (comments.length && !options.fromQueue) diffAnnotations.restore(activeSessionKey(), comments); return; }
  if (options.handsFree && mode !== 'chat') return;
  noteInteraction();
  voiceGate.close();
  if (!api) { error('This is a browser preview. Run npm start to use Fairy on your desktop.'); return; }
  conversationTimer.engage();
  const existingFiles = options.fromQueue ? (options.attachments || []) : attachmentDraft.list();
  if (mode === 'chat' && !existingFiles.length && !quotes.length && wantsSinging(fullText)) {
    setDraft('');
    try { await previewVocal('original-song'); }
    catch { if (!$('#message').value) setDraft(text); }
    return;
  }
  const sendMode = options.mode || mode;
  if (existingFiles.length && sendMode !== 'chat' && !options.handsFree) { error('Files can only go with a message in Chat mode or a work session.'); return; }
  const files = options.handsFree ? [] : (options.fromQueue ? existingFiles : attachmentDraft.take());
  const dispatchSid = activeSessionKey();
  const requestMode = resolveRequestMode(fullText, sendMode, state.settings, state.history, files.length > 0);
  activeRequestMode = requestMode;
  const token = ++generation; let replied = false, reactionReply=''; setBusy(true); error(''); setDraft(''); composerStashView?.syncBadge(); $('.welcome')?.remove(); const drawnUser = message('user', fullText, requestMode, { attachments: files });
  const requestId = crypto.randomUUID();
  const requestStarted=performance.now();let firstAudioMs=null,clipCount=0;
  const voiceQueue = new ReplyAudio({allowed: () => token === generation && !muted(), prepare:prepareSpeech, play: async part => {
    spokenReply = part.text;
    await playSpeech(part, token,()=>{firstAudioMs??=Math.round(performance.now()-requestStarted+part.leadingMs);clipCount++;});
    if (token === generation && busy) avatar?.setActivity('thinking');
  }});
  activeVoiceQueue=voiceQueue;
  const unsubscribeAudio = api.onReplyAudio(value => {if (value.requestId === requestId && token === generation) voiceQueue.push(value);});
  let partial, pendingText = '', renderTimer, thoughtWrap = null, handoffEl = null;
  let pendingThinkEl = createPendingThinkingRow('Thinking');
  $('#messages').append(pendingThinkEl);
  pendingThinkEl.scrollIntoView({ block: 'nearest' });
  const clearPendingThink = () => { if (pendingThinkEl) { pendingThinkEl.remove(); pendingThinkEl = null; } };
  const thoughtNodes = new Map();
  const ensureThoughtWrap = () => {
    if (thoughtWrap) return thoughtWrap;
    thoughtWrap = document.createElement('div');
    thoughtWrap.className = 'chat-thoughts';
    if (partial?.item?.parentNode === $('#messages')) $('#messages').insertBefore(thoughtWrap, partial.item);
    else $('#messages').append(thoughtWrap);
    updateConversationChrome();
    return thoughtWrap;
  };
  const showPartial = () => {
    renderTimer = null;
    if (token !== generation || !pendingText) return;
    clearPendingThink();
    const firstUpdate = !partial;
    partial ||= message('assistant', '');
    // Auto's pick is known before the reply starts, so its line goes under the reply from the first words.
    // (Only a fresh pick: one made for the companion or the phone a while ago isn't this reply's.)
    if (firstUpdate && pendingAuto && Date.now() - pendingAuto.receivedAt < 30_000) { addAutoLine(partial.item, pendingAuto); pendingAuto = null; }
    renderReply(partial.content, pendingText); bubble(pendingText, { reset: firstUpdate });
    partial.label.textContent = `${state.settings.name.toUpperCase()} · WRITING`;
  };
  const activity = requestMode === 'files' ? fileActivity($('#messages')) : null;
  const unsubscribeSteps = api.onFileStep?.(value => {
    if (value.requestId === requestId && token === generation) activity?.step(value);
  });
  const unsubscribeHandoff = api.onHandoff?.(value => {
    if (value.requestId !== requestId || token !== generation || !value.handoff) return;
    const next = createHandoffDivider(value.handoff);
    if (handoffEl) handoffEl.replaceWith(next);
    else {
      const anchor = thoughtWrap || pendingThinkEl || (partial?.item?.parentNode === $('#messages') ? partial.item : null);
      if (anchor) $('#messages').insertBefore(next, anchor);
      else $('#messages').append(next);
    }
    handoffEl = next;
    next.scrollIntoView({ block: 'nearest' });
  });
  const unsubscribeThoughts = api.onThought?.(value => {
    if (value.requestId !== requestId || token !== generation) return;
    clearPendingThink();
    const id = String(value.id || 'thought');
    let node = thoughtNodes.get(id);
    if (value.status !== 'running' && !String(value.text || '').trim()) {
      if (node) { node.remove(); thoughtNodes.delete(id); }
      if (thoughtWrap && !thoughtWrap.children.length) { thoughtWrap.remove(); thoughtWrap = null; }
      return;
    }
    if (!node) {
      node = createThoughtNode(value, { openLink: openReplyLink, defaultOpen: false });
      thoughtNodes.set(id, node);
      ensureThoughtWrap().append(node);
    } else {
      updateThoughtNode(node, value, { openLink: openReplyLink });
    }
    node.scrollIntoView({ block: 'nearest' });
  });
  const finishThoughts = () => {
    clearPendingThink();
    for (const [id, node] of thoughtNodes) {
      if (!node._lastText) { node.remove(); thoughtNodes.delete(id); }
      else if (node.classList.contains('running')) {
        updateThoughtNode(node, { id, kind: node._isCommentary ? 'commentary' : 'thinking', status: 'done', text: node._lastText || '' }, { openLink: openReplyLink });
      }
    }
    if (thoughtWrap && !thoughtWrap.children.length) { thoughtWrap.remove(); thoughtWrap = null; }
  };
  const unsubscribe = api.onReply(value => {
    if (value.requestId !== requestId || token !== generation) return;
    pendingText = value.text;
    if (!renderTimer) renderTimer = setTimeout(showPartial, 60);
  });
  try {
    const displayId = $('#screen-display').value === '' ? null : Number($('#screen-display').value);
    const result = await api.chat(text, sendMode, displayId, requestId, files.map(file => file.id), { spoken: Boolean(options.spoken || options.handsFree), ...(options.autoProvider ? { autoProvider: options.autoProvider } : {}) });
    activity?.finish(); finishThoughts(); if (token !== generation) return;
    clearTimeout(renderTimer);
    state.history = result.history; drawnHistory = historySignature();
    const savedUserIdx = result.history?.findLastIndex?.(entry => entry.role === 'user') ?? -1;
    if (savedUserIdx >= 0 && drawnUser?.item) attachUserActions(drawnUser.item, result.history[savedUserIdx], savedUserIdx);
    if (result.artifact) sidePane.show('artifacts', { artifact: result.artifact.id, seq: result.artifact.seq });
    if (result.settings) state.settings = result.settings;
    if (result.memoryCount !== undefined) state.memoryCount = result.memoryCount;
    if (result.memoryWarning) error(result.memoryWarning);
    const drawnReply = partial ? (renderReply(partial.content, result.text), partial.label.textContent = state.settings.name.toUpperCase(), partial) : message('assistant', result.text);
    // What Auto chose, under the reply straight away (it's saved with the reply, so it's there when the chat is drawn again).
    const savedReply = result.history?.findLast?.(entry => entry.role === 'assistant');
    if (result.a2ui?.length && drawnReply?.item) mountA2UISurfaces(drawnReply.item, result.a2ui, a2uiHandlers(savedReply?.at || ''));
    if (result.board?.id && drawnReply?.item) attachBoardCard(drawnReply.item, result.board);
    if (savedReply?.auto && drawnReply?.item) addAutoLine(drawnReply.item, savedReply.auto, sendMode === 'chat' ? text : '');
    if (drawnReply?.item) addReplyTime(drawnReply.item, savedReply?.at || new Date().toISOString());
    pendingAuto = null;
    bubble(result.text, { reset: !partial });
    replied = true;reactionReply=result.text;
    spokenReply = result.speechText ?? result.text;
    try {
      if (result.voiceStreamed) { await voiceQueue.finish(); if (result.voiceWarning) error(`Reply saved, but voice stopped: ${result.voiceWarning}`); }
      else { const bytes = await api.speak(result.speechText ?? result.text); if (token === generation) await play(bytes, token); }
    }
    catch (e) { if (token === generation) { stopAudio(); error(`Reply saved, but voice failed: ${e.message}`); } }
    if(result.timings && token===generation){
      const t={...result.timings,firstAudioMs,clipCount};
      const seconds=ms=>ms==null?'not measured':`${(ms/1000).toFixed(2)} s`;
      $('#reply-timing').textContent=`Before model request: ${seconds(t.preparationMs)}. First text: ${seconds(t.firstTextMs)}. First speech: ${seconds(t.firstAudioMs)}. First voice synthesis: ${seconds(t.firstSynthesisMs)}. Model finished: ${seconds(t.modelFinishedMs)}. Voice clips: ${clipCount}. Times start when you send; synthesis is its own duration.`;
      try{localStorage.setItem('stella-last-reply-timing',$('#reply-timing').textContent);}catch{}
    }
  } catch (e) { voiceQueue.cancel(); stopAudio(); activity?.finish('stopped'); finishThoughts(); if (token === generation) { error(e.message); if (!$('#message').value) setDraft(text); } attachmentDraft.restore(files); quoteSelection?.restore?.(quotes); if (files.length && !$('#message').value) setDraft(text); }
  finally {
    voiceQueue.cancel(); if(activeVoiceQueue===voiceQueue)activeVoiceQueue=null; closePlaybackContext(); unsubscribeAudio(); unsubscribe(); unsubscribeSteps?.(); unsubscribeHandoff?.(); unsubscribeThoughts?.(); clearTimeout(renderTimer);
    if (partial && !replied) partial.label.textContent = `${state.settings.name.toUpperCase()} · INCOMPLETE`;
    activeRequestMode = null;
    setBusy(false); status(token === generation ? 'Ready when you are' : 'Stopped');
    if(replied && token===generation && requestMode==='chat')avatar?.spriteAvatar.reactToReply(reactionReply,text);
    echoUntil = Date.now() + 1200;
    if (options.handsFree && replied && token === generation && wantsListening() && state.settings.voiceFollowups === 'on') voiceGate.engage(13.2);
    updateAwareness();
    if (replied || steeringPending?.sessionId === dispatchSid) queueMicrotask(() => void drainComposerQueue(dispatchSid));
  }
}
async function stop({keepQuiz=false}={}) {
  avatar?.spriteAvatar.stopAnimations(30);walkController?.cancel();
  voiceGate.close(); echoUntil = Date.now() + 1200;
  vocalTimer.snooze();
  if (proactiveRun) conversationTimer.snooze();
  const wasRecording = Boolean(recorder);
  generation++; activeVoiceQueue?.cancel(); activeVoiceQueue=null; stopNotebookVoice(); stopAudio(); closePlaybackContext();
  if (recorder) { recorder.onstop = null; recorder.stop(); recorder = null; }
  stream?.getTracks().forEach(track => track.stop()); stream = null; clearTimeout(recordingTimeout);
  $('#record').classList.remove('recording'); $('#record span').textContent = 'Talk to Fairy'; voiceGlow.off();
  if(!keepQuiz)await api?.stop(); status(busy ? 'Stopping…' : 'Ready when you are');
  // In-flight requests release busy in their own finally block.
  if (wasRecording) { setBusy(false); status('Stopped'); }
}
async function toggleRecording() {
  if (vocalRun) { await stop(); await vocalFinished; }
  if (proactiveRun) { await stop(); await proactiveFinished; }
  if (recorder) { recorder.stop(); return; }
  if (busy || !api) { if (!api) error('Microphone recording is available in the desktop app.'); return; }
  if (state.settings.handsFree === 'on') await toggleHandsFree(false);
  const token = ++generation; error(''); setBusy(true);
  try {
    if (state.settings.transcriptionProvider === 'apple') {
      status('Checking Apple speech model…');
      await api.prepareLocalSpeech(state.settings.localLanguage);
      if (token !== generation) { setBusy(false); return; }
    }
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
    if (token !== generation) { stream.getTracks().forEach(t => t.stop()); stream = null; setBusy(false); return; }
    const mime = ['audio/webm', 'audio/mp4'].find(t => MediaRecorder.isTypeSupported(t));
    if (!mime) throw new Error('No supported microphone recording format.');
    recorder = new MediaRecorder(stream, { mimeType: mime });
    const chunks = []; const recordingStarted = Date.now();
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = async () => {
      stream?.getTracks().forEach(track => track.stop()); stream = null; recorder = null; clearTimeout(recordingTimeout); voiceGlow.work();
      $('#record').classList.remove('recording'); $('#record span').textContent = 'Talk to Fairy'; $('#record').disabled = true;
      try {
        if (Date.now() - recordingStarted < 1100 && state.settings.transcriptionProvider === 'fish') throw new Error('Speak for at least one second before finishing the recording.');
        if (token !== generation) return;
        const local = state.settings.transcriptionProvider === 'apple';
        const blob = new Blob(chunks, { type: mime });
        const bytes = local ? await localRecording(blob) : new Uint8Array(await blob.arrayBuffer());
        if (token !== generation) return;
        avatar?.setActivity('thinking');
        const text = await api.transcribe(bytes, local ? 'audio/wav' : mime); if (token !== generation) return;
        if (!text) throw new Error('No speech detected. Try again a little closer to the microphone.');
        setBusy(false);
        if (quickTalking) { quickTalking = false; api.quickHeard(text); } else await send(text, { spoken: true });
      } catch (e) { if (token === generation) error(e.message); }
      finally { voiceGlow.off(); quickTalking = false; setBusy(false); status(token === generation ? 'Ready when you are' : 'Ready'); }
    };
    recorder.start(); voiceGlow.listen(stream); $('#floating-mic').disabled = false; $('#record').disabled = false; $('#record').classList.add('recording'); $('#record span').textContent = 'Finish recording'; status('Listening · up to 60 seconds'); avatar?.setActivity('listening');
    recordingTimeout = setTimeout(() => recorder?.stop(), 60000);
  } catch (e) { voiceGlow.off(); stream?.getTracks().forEach(t => t.stop()); stream = null; recorder = null; error(e.message); setBusy(false); }
}

function bubble(text, { reset = true } = {}) {
  const panel = $('#floating-bubble'), content = $('#floating-bubble-text');
  const previousTop = content.scrollTop;
  const follow = reset || panel.hidden || content.scrollHeight - content.clientHeight - previousTop <= 32;
  panel.hidden = !text;
  renderReply(content, text);
  // Rich rendering replaces the DOM. Restore the reader's position unless they
  // were following the end; use an immediate scroll for each throttled chunk.
  content.scrollTop = follow ? content.scrollHeight : previousTop;
}
$('#close-floating-bubble').onclick = () => { bubble(''); conversationTimer.snooze(); if (proactiveRun || vocalRun) void stop(); $(floatingCollapsed ? '#floating-collapse' : '#floating-message').focus({ preventScroll: true }); };
function applySpriteHidden(hidden){state.spriteHidden=hidden;avatar?.setVisible(!hidden&&!state.companionHidden);walkController?.cancel();}
function applyCompanionHidden(hidden){state.companionHidden=hidden;document.body.style.opacity=hidden?'0':'';applySpriteHidden(Boolean(state.spriteHidden));requestBackgroundSync();}
for(const prefix of ['', 'floating-'])$(`#${prefix}quiz-auto`).onclick=async()=>{quizInfo=await api.setQuizAuto(quizInfo.autoTarget===false);updateAwareness();};
$('#companion-toggle').onclick = () => api?.companionToggle?.();
$('#chat-header-companion').onclick = () => api?.companionToggle?.();
api?.onCompanionOpen?.(open => {
  $('#companion-toggle').setAttribute('aria-pressed', String(open));
  $('#chat-header-companion')?.setAttribute('aria-pressed', String(open));
  $('#chat-header-companion')?.classList.toggle('is-on', Boolean(open));
});
// Reads the companion's replies aloud, unless muted or the window is already speaking.
// A reply said for the companion or another app (Flux). Main hears when it has finished, said or not (muted, busy), so
// the app asking can stop offering its Stop; a hush stops only this speech, never one of her own replies.
let companionToken = 0;
api?.onCompanionSpeak?.(async text => {
  let spoke = muted();
  try {
    if (busy || muted() || audio || !text) return;
    const token = companionToken = ++generation;
    try {
      const bytes = await api.speak(text);
      if (token === generation && bytes) {
        await play(bytes, token);
        spoke = true;
      }
    } catch (err) {
      console.warn('companion-speak failed:', err);
    }
  } finally {
    companionToken = 0;
    api.companionSpoken?.(spoke).catch?.(() => {});
  }
});
api?.onCompanionHush?.(() => { if (companionToken && companionToken === generation) { generation++; stopAudio(); } });
// The companion's ring presses floating mode's buttons here. Its record button records here, as a quick talk, so what
// was said is asked in the companion's own chat.
const COMPANION_MIRRORED = ['floating-listening', 'floating-mic', 'floating-mute', 'floating-new-topic', 'floating-news', 'floating-pause-ideas', 'floating-sing', 'floating-music', 'floating-hands-free', 'floating-pause-awareness', 'floating-quiz-hints', 'floating-quiz-auto', 'floating-meeting'];
api?.onCompanionAction?.(name => {
  const id = { listening: 'floating-listening', mute: 'floating-mute', meeting: 'floating-meeting' }[name] || name;
  if (!COMPANION_MIRRORED.includes(id)) return;
  if (id === 'floating-mic') { if (recorder) recorder.stop(); else if (!busy) { quickTalking = true; void toggleRecording(); } return; }
  document.getElementById(id)?.click();
});
// And their state goes back to the companion whenever one changes: on or off, its label, whether it can be pressed.
let mirrorTimer = 0;
function sendCompanionMirror() {
  clearTimeout(mirrorTimer);
  mirrorTimer = setTimeout(() => {
    const list = COMPANION_MIRRORED.map(id => document.getElementById(id)).filter(Boolean).map(button => ({ id: button.id, html: button.innerHTML, label: button.getAttribute('aria-label') || '', title: button.title || '',
      pressed: button.getAttribute('aria-pressed'), disabled: button.disabled, hidden: button.hidden }));
    api?.companionMirror?.(list).catch(() => {});
  }, 120);
}
api?.onCompanionMirrorRequest?.(sendCompanionMirror);
{ const watch = new MutationObserver(sendCompanionMirror); for (const id of COMPANION_MIRRORED) { const button = document.getElementById(id); if (button) watch.observe(button, { attributes: true, childList: true, subtree: true, characterData: true }); } }
for (const canvas of document.querySelectorAll('.fairy-mini')) {
  const context = canvas.getContext('2d'), image = context.createImageData(FAIRY_GRID, FAIRY_GRID);
  paintFairy(image.data); context.putImageData(image, 0, 0);
}
// remember: false folds it for a while (the notebook's paper view) without changing how it opens next time.
function setSidebarCollapsed(value, { remember = true } = {}) {
  if (remember) paperFold?.changed();
  document.documentElement.classList.toggle('sidebar-collapsed', value);
  $('#sidebar-toggle').setAttribute('aria-label', value ? 'Expand sidebar' : 'Collapse sidebar'); $('#sidebar-toggle').title = value ? 'Expand sidebar (⌘B)' : 'Collapse sidebar (⌘B)';
  if (value) setSidebarSearch(false);
  if (remember) try { localStorage.setItem('fairy-sidebar', value ? 'collapsed' : 'open'); } catch {}
}
// The notebook's paper view folds the sidebar while a PDF is open and opens it again after, unless it was already
// folded, or you folded or opened it yourself in the meantime (⌘B or the button), which then stands.
const paperFold = sidebarFold({ isFolded: () => document.documentElement.classList.contains('sidebar-collapsed'), setFolded: value => setSidebarCollapsed(value, { remember: false }) });
// A paper open in the notebook: its sidebar folds, and a pane open beside it gives way (workspace.css paper-open).
const paperSidebar = on => { paperFold.paper(on); document.documentElement.classList.toggle('paper-open', !!on); };
function setSidebarSearch(value) {
  $('#sidebar-search-input').hidden = !value; $('#sidebar-search').setAttribute('aria-expanded', String(value));
  if (value) $('#sidebar-search-input').focus(); else $('#sidebar-search-input').value = '';
  if (!value) void sessionList.search('');
}
setupSidebarResize({ handle: $('#sidebar-resize') });
setupPaneResize({ pane: $('#side-pane') });
$('#sidebar-toggle').onclick = () => setSidebarCollapsed(!document.documentElement.classList.contains('sidebar-collapsed'));
// ⌘B collapses the sidebar, or brings it back, from anywhere in the window.
document.addEventListener('keydown', event => {
  if (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'b' && !floating) { event.preventDefault(); setSidebarCollapsed(!document.documentElement.classList.contains('sidebar-collapsed')); }
  if (event.metaKey && !event.ctrlKey && !event.altKey && event.shiftKey && event.key.toLowerCase() === 'u' && !floating && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) { event.preventDefault(); hideOtherBoards(); hidePlugins(); void openUsage().then(view => view?.toggle()); }
  if (event.metaKey && !event.ctrlKey && !event.altKey && event.shiftKey && event.key.toLowerCase() === 'a' && !floating && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) { event.preventDefault(); hideOtherBoards(); hidePlugins(); hideUsage(); void openAnalytics().then(view => view?.toggle()); }
  if (event.metaKey && !event.ctrlKey && !event.altKey && event.shiftKey && event.key.toLowerCase() === 'e' && !floating && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) { event.preventDefault(); hideOtherBoards(); hidePlugins(); hideUsage(); void openAcademy().then(view => view?.toggle()); }
  if (event.metaKey && !event.ctrlKey && !event.altKey && event.shiftKey && event.key.toLowerCase() === 'd' && !floating && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) { event.preventDefault(); hideOtherBoards(); hidePlugins(); hideUsage(); void openDesign().then(view => view?.toggle()); }
  if (event.metaKey && !event.ctrlKey && !event.altKey && event.shiftKey && event.key.toLowerCase() === 'g' && !floating && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) { if (featureOn('studio') && api?.studio) { event.preventDefault(); hideOtherBoards(); hidePlugins(); hideUsage(); void openDiffusion().then(view => view?.toggle()); } }
  if (event.metaKey && !event.ctrlKey && !event.altKey && event.shiftKey && event.key.toLowerCase() === 'l' && !floating && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) { if (featureOn('worlds') && api?.worlds) { event.preventDefault(); hideOtherBoards(); hidePlugins(); hideUsage(); void openWorlds().then(view => view?.toggle()); } }
  if (event.metaKey && !event.ctrlKey && !event.altKey && event.shiftKey && event.key.toLowerCase() === 'j' && !floating && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) { if (featureOn('game') && api?.game) { event.preventDefault(); hideOtherBoards(); hidePlugins(); hideUsage(); void openGame().then(view => view?.toggle()); } }
});
$('#sidebar-search').onclick = () => { if (document.documentElement.classList.contains('sidebar-collapsed')) setSidebarCollapsed(false); setSidebarSearch($('#sidebar-search-input').hidden); };
let chatSearchTimer;
$('#sidebar-search-input').oninput = () => { clearTimeout(chatSearchTimer); chatSearchTimer = setTimeout(() => void sessionList.search($('#sidebar-search-input').value), 150); };
$('#new-folder').onclick = () => void sessionList.newFolder();
$('#new-folder').disabled = !api;
$('#new-section').onclick = () => void sessionList.newCategory();
$('#side-mode-chat').onclick = () => sessionList.setMode('chat');
$('#side-mode-work').onclick = () => sessionList.setMode('work');
$('#new-section').disabled = !api;
$('#select-chats').disabled = !api;
sessionList.onSearchOpen(query => {
  const match = [...document.querySelectorAll('#messages .message')].find(item => item.textContent.toLowerCase().includes(query.toLowerCase()));
  match?.scrollIntoView({ behavior: 'smooth', block: 'center' });
});
// A message from the phone in the chat that's open here.
api?.onChatChanged?.(({ session, history }) => { if (state.sessions?.active !== session) return; state.history = history; if (!busy) renderHistory(); });
api?.onA2uiUpdate?.(({ session, at, surfaces }) => {
  if (state.sessions?.active !== session || !at || !Array.isArray(surfaces)) return;
  const idx = state.history.findIndex(e => e.role === 'assistant' && e.at === at);
  if (idx < 0) return;
  state.history[idx] = { ...state.history[idx], a2ui: surfaces };
  const node = document.querySelector(`#messages .message.assistant[data-entry="${idx}"]`);
  if (node && !node.contains(document.activeElement)) mountA2UISurfaces(node, surfaces, a2uiHandlers(at));
});
api?.onSessions(value => { state.sessions = value; if (drawnHistory.startsWith('|')) drawnHistory = historySignature(); sessionList.update(value); activityPopover?.refresh(); threadsPopover?.refresh(); drawNotchBand(); syncWorkSession(); if (sidePane?.isOpen('today')) sidePane.refresh(); });
// Long stalls go in a small local log, so the next real freeze leaves a trace.
try {
  if (api) new PerformanceObserver(list => { for (const entry of list.getEntries()) if (entry.duration >= 500) void api.stallReport({ ms: entry.duration, pane: sidePane.current(), busy, messages: document.querySelectorAll('#messages .message').length }).catch(() => {}); }).observe({ type: 'longtask' });
} catch {}
$('#sidebar-new-work').disabled = !api;
$('#sidebar-new-scratch').disabled = !api;
$('#sidebar-new-scratch').onclick = async () => { try { const next = await api.sessionNewWork('scratch'); if (next) { showSession(next); status('New scratch session: its files go in Fairy Scratch'); $('#message').focus(); } } catch (e) { error(e.message); } };
$('#sidebar-new-work').onclick = async () => { try { await startWork(); } catch (e) { error(e.message); } };
const PERMISSION_ABOUT = { ask: 'Ask before editing files or running commands', plan: 'Read and plan first without changing files', auto: 'Edit files and run commands without asking' };
function setPermissionMenu(open) {
  const menu = $('#permission-menu'), button = $('#work-permission');
  if (!menu || !button) return;
  menu.hidden = !open;
  button.setAttribute('aria-expanded', String(open));
  if (!open) return;
  const current = PERMISSIONS[button.dataset.permission] ? button.dataset.permission : 'ask';
  menu.replaceChildren(...Object.entries(PERMISSIONS).map(([value, label]) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'permission-item';
    item.dataset.permission = value;
    item.setAttribute('role', 'menuitemradio');
    item.setAttribute('aria-checked', String(value === current));
    const textWrap = document.createElement('span');
    textWrap.className = 'permission-item-text';
    const titleEl = document.createElement('span');
    titleEl.textContent = label;
    const aboutEl = document.createElement('small');
    aboutEl.textContent = PERMISSION_ABOUT[value] || '';
    textWrap.append(titleEl, aboutEl);
    item.append(textWrap);
    item.onclick = () => {
      setPermissionMenu(false);
      api?.workPermission(value).catch(e => { error(e.message); syncWorkSession(); });
    };
    return item;
  }));
  const dockBox = $('.dock')?.getBoundingClientRect(), btnBox = button.getBoundingClientRect();
  if (dockBox && btnBox) {
    const left = Math.max(0, Math.min(Math.max(0, dockBox.width - 248), btnBox.left - dockBox.left));
    menu.style.left = `${Math.round(left)}px`;
  }
}
$('#work-permission').onclick = () => { if (!$('#work-permission').disabled) setPermissionMenu($('#permission-menu').hidden); };
document.addEventListener('pointerdown', event => { if (!$('#permission-menu').hidden && !event.target.closest('#permission-menu,#work-permission')) setPermissionMenu(false); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('#permission-menu').hidden) { setPermissionMenu(false); $('#work-permission').focus(); } });
$('#work-where').onchange = () => api?.workIsolate($('#work-where').value === 'own').catch(e => { error(e.message); syncWorkSession(); });
function closeNotchMenus() {
  notchMenu = '';
  const wtMenu = $('#notch-worktree-menu'), brMenu = $('#notch-branch-menu');
  if (wtMenu) wtMenu.hidden = true;
  if (brMenu) brMenu.hidden = true;
  $('#notch-worktree-btn')?.setAttribute('aria-expanded', 'false');
  $('#notch-branch-btn')?.setAttribute('aria-expanded', 'false');
}
async function loadNotchBranches(force = false) {
  const work = state.sessions?.work;
  const target = work ? (work.path || work.folder || '') : '';
  if (!work || !target || !api?.gitBranches) return null;
  if (!force && notchBranchFolder === target && notchBranchData) return notchBranchData;
  notchBranchFolder = target;
  notchBranchLoading = true;
  if (notchMenu === 'branch') renderBranchNotchMenu();
  try {
    notchBranchData = await api.gitBranches();
  } catch {
    notchBranchData = null;
  } finally {
    notchBranchLoading = false;
  }
  syncWorkNotch();
  if (notchMenu === 'branch') renderBranchNotchMenu();
  return notchBranchData;
}
function syncWorkNotch() {
  const notch = $('#work-notch');
  if (!notch) return;
  const work = state.sessions?.work;
  notch.hidden = !work;
  if (!work) {
    closeNotchMenus();
    return;
  }
  const activeId = state.sessions?.active;
  const target = work.path || work.folder || '';
  if (target && notchBranchFolder !== target && !notchBranchLoading) {
    void loadNotchBranches(false);
  }
  const wtBtn = $('#notch-worktree-btn'), wtLabel = $('#notch-worktree-label');
  const newWtBtn = $('#notch-new-worktree-btn'), newWtLabel = $('#notch-new-worktree-label');
  const brLabel = $('#notch-branch-label'), protonBtn = $('#notch-proton-btn');
  if (wtLabel) {
    wtLabel.textContent = work.branch ? work.branch : (work.isolate && !activeId ? 'New worktree' : `Local · ${work.name}`);
  }
  wtBtn?.classList.toggle('is-active', Boolean(work.branch || (work.isolate && !activeId)));
  if (newWtBtn && newWtLabel) {
    if (!activeId) {
      newWtBtn.hidden = false;
      newWtBtn.classList.toggle('is-active', Boolean(work.isolate));
      newWtLabel.textContent = work.isolate ? 'Worktree on' : 'New worktree';
      newWtBtn.title = work.isolate ? 'Switch back to local folder checkout' : 'Start this session on an isolated git worktree branch';
    } else {
      newWtBtn.hidden = Boolean(work.branch);
      newWtBtn.classList.remove('is-active');
      newWtLabel.textContent = 'New worktree';
      newWtBtn.title = `Start a new isolated worktree session in ${work.name}`;
    }
  }
  if (brLabel) {
    if (work.branch) {
      brLabel.textContent = work.branch;
    } else if (work.isolate && !activeId) {
      brLabel.textContent = notchBranchData?.current ? `From ${notchBranchData.current}` : 'From current';
    } else {
      brLabel.textContent = notchBranchData?.current || 'branch';
    }
  }
  if (protonBtn) {
    protonBtn.disabled = !api?.openInProton;
  }
}
function renderWorktreeNotchMenu() {
  const menu = $('#notch-worktree-menu'), work = state.sessions?.work;
  if (!menu || !work) return;
  const activeId = state.sessions?.active;
  const items = [];
  const head = document.createElement('div');
  head.className = 'work-notch-menu-head';
  head.textContent = 'Workspace Checkout';
  items.push(head);
  if (!activeId) {
    const localBtn = document.createElement('button');
    localBtn.type = 'button';
    localBtn.className = `work-notch-option ${!work.isolate ? 'is-selected' : ''}`;
    localBtn.innerHTML = `<span>Local · ${work.name}</span><small>${!work.isolate ? '✓' : 'folder'}</small>`;
    localBtn.onclick = () => {
      closeNotchMenus();
      void api?.workIsolate?.(false).catch(e => error(e.message));
    };
    const isoBtn = document.createElement('button');
    isoBtn.type = 'button';
    isoBtn.className = `work-notch-option ${work.isolate ? 'is-selected' : ''}`;
    isoBtn.innerHTML = `<span>New isolated worktree</span><small>${work.isolate ? '✓' : 'branch'}</small>`;
    isoBtn.onclick = () => {
      closeNotchMenus();
      void api?.workIsolate?.(true).catch(e => error(e.message));
    };
    items.push(localBtn, isoBtn);
  } else {
    const infoBtn = document.createElement('button');
    infoBtn.type = 'button';
    infoBtn.className = 'work-notch-option is-selected';
    infoBtn.disabled = true;
    infoBtn.innerHTML = `<span>${work.branch ? `Worktree · ${work.branch}` : `Local · ${work.name}`}</span><small>active</small>`;
    const newBtn = document.createElement('button');
    newBtn.type = 'button';
    newBtn.className = 'work-notch-option';
    newBtn.innerHTML = `<span>+ Start new worktree session…</span><small>isolated</small>`;
    newBtn.onclick = async () => {
      closeNotchMenus();
      try {
        const next = await api?.sessionNewWork?.(work.folder);
        if (next) {
          showSession(next);
          await api?.workIsolate?.(true);
          status(`Ready in a new worktree for ${work.name}`);
          $('#message').focus();
        }
      } catch (e) {
        error(e?.message || 'Could not start worktree session.');
      }
    };
    items.push(infoBtn, newBtn);
  }
  const peers = (state.sessions?.sessions || []).filter(s => s.workPath === work.folder && s.branch && s.id !== activeId);
  if (peers.length) {
    const peerHead = document.createElement('div');
    peerHead.className = 'work-notch-menu-head';
    peerHead.textContent = 'Other Worktrees';
    items.push(peerHead);
    for (const peer of peers.slice(0, 6)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'work-notch-option';
      const left = document.createElement('span');
      left.textContent = peer.branch;
      const right = document.createElement('small');
      right.textContent = (peer.title || '').slice(0, 18);
      btn.append(left, right);
      btn.onclick = () => {
        closeNotchMenus();
        void openChat(peer.id);
      };
      items.push(btn);
    }
  }
  menu.replaceChildren(...items);
}
function renderBranchNotchMenu() {
  const menu = $('#notch-branch-menu'), work = state.sessions?.work;
  if (!menu || !work) return;
  const nodes = [];
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'work-notch-search';
  search.placeholder = 'Filter or type branch…';
  search.value = notchBranchQuery;
  search.oninput = () => {
    notchBranchQuery = search.value;
    renderBranchNotchMenu();
    const fresh = $('#notch-branch-menu .work-notch-search');
    if (fresh) { fresh.focus(); fresh.setSelectionRange(fresh.value.length, fresh.value.length); }
  };
  nodes.push(search);
  if (work.branch) {
    const locked = document.createElement('div');
    locked.className = 'work-notch-menu-head';
    locked.textContent = `Worktree pinned to ${work.branch}`;
    nodes.push(locked);
  }
  if (notchBranchLoading && !notchBranchData) {
    const loadingEl = document.createElement('div');
    loadingEl.className = 'work-notch-menu-head';
    loadingEl.textContent = 'Loading branches…';
    nodes.push(loadingEl);
  } else if (notchBranchData) {
    const q = notchBranchQuery.trim().toLowerCase();
    const localList = (notchBranchData.local || []).filter(b => !q || b.name.toLowerCase().includes(q));
    const remoteList = (notchBranchData.remote || []).filter(b => !b.local && (!q || b.name.toLowerCase().includes(q)));
    if (localList.length) {
      const h = document.createElement('div');
      h.className = 'work-notch-menu-head';
      h.textContent = 'Local Branches';
      nodes.push(h);
      for (const b of localList.slice(0, 20)) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `work-notch-option ${b.current ? 'is-selected' : ''}`;
        btn.disabled = Boolean(work.branch);
        const nameSpan = document.createElement('span');
        nameSpan.textContent = b.name;
        const metaSpan = document.createElement('small');
        metaSpan.textContent = b.current ? '✓' : (b.short || '');
        btn.append(nameSpan, metaSpan);
        btn.onclick = async () => {
          if (b.current) return closeNotchMenus();
          closeNotchMenus();
          try {
            await api.gitAct('switch', b.name);
            await loadNotchBranches(true);
            syncChatHeader();
            status(`Switched branch to ${b.name}`);
          } catch (e) {
            error(e?.message || 'Could not switch branch.');
          }
        };
        nodes.push(btn);
      }
    }
    if (remoteList.length && !work.branch) {
      const h = document.createElement('div');
      h.className = 'work-notch-menu-head';
      h.textContent = 'Remote Branches';
      nodes.push(h);
      for (const b of remoteList.slice(0, 10)) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'work-notch-option';
        const nameSpan = document.createElement('span');
        nameSpan.textContent = b.name;
        const metaSpan = document.createElement('small');
        metaSpan.textContent = b.short || 'remote';
        btn.append(nameSpan, metaSpan);
        btn.onclick = async () => {
          closeNotchMenus();
          try {
            await api.gitAct('checkout', b.name);
            await loadNotchBranches(true);
            syncChatHeader();
            status(`Checked out ${b.name}`);
          } catch (e) {
            error(e?.message || 'Could not check out remote branch.');
          }
        };
        nodes.push(btn);
      }
    }
  }
  if (!work.branch) {
    const createForm = document.createElement('form');
    createForm.className = 'work-notch-create';
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.placeholder = 'New branch name…';
    inp.value = notchBranchQuery && !(notchBranchData?.local || []).some(b => b.name === notchBranchQuery.trim()) ? notchBranchQuery.trim() : '';
    const sub = document.createElement('button');
    sub.type = 'submit';
    sub.textContent = 'Create';
    createForm.onsubmit = async e => {
      e.preventDefault();
      const name = inp.value.trim();
      if (!name) return;
      closeNotchMenus();
      try {
        await api.gitAct('create', name);
        notchBranchQuery = '';
        await loadNotchBranches(true);
        syncChatHeader();
        status(`Created & switched to ${name}`);
      } catch (err) {
        error(err?.message || 'Could not create branch.');
      }
    };
    createForm.append(inp, sub);
    nodes.push(createForm);
  }
  menu.replaceChildren(...nodes);
}
const openWorkFolderInProton = async () => {
  const work = state.sessions?.work;
  if (!work || !api?.openInProton) return;
  try {
    await api.openInProton(work.path || work.folder, work.name);
    status(`Opened ${work.name} in Proton`);
  } catch (e) {
    error(e?.message || 'Could not open Proton.');
  }
};
$('#chat-header-proton')?.addEventListener('click', () => { void openWorkFolderInProton(); });
$('#notch-proton-btn')?.addEventListener('click', () => { void openWorkFolderInProton(); });
$('#notch-worktree-btn')?.addEventListener('click', () => {
  if (notchMenu === 'worktree') { closeNotchMenus(); return; }
  closeNotchMenus();
  notchMenu = 'worktree';
  renderWorktreeNotchMenu();
  $('#notch-worktree-menu').hidden = false;
  $('#notch-worktree-btn').setAttribute('aria-expanded', 'true');
});
$('#notch-new-worktree-btn')?.addEventListener('click', async () => {
  closeNotchMenus();
  const work = state.sessions?.work;
  if (!work) return;
  if (!state.sessions?.active) {
    api?.workIsolate?.(!work.isolate).catch(e => { error(e.message); syncWorkSession(); });
    return;
  }
  try {
    const next = await api?.sessionNewWork?.(work.folder);
    if (next) {
      showSession(next);
      await api?.workIsolate?.(true);
      status(`Started isolated worktree session in ${work.name}`);
      $('#message').focus();
    }
  } catch (e) {
    error(e?.message || 'Could not create worktree session.');
  }
});
$('#notch-branch-btn')?.addEventListener('click', () => {
  if (notchMenu === 'branch') { closeNotchMenus(); return; }
  closeNotchMenus();
  notchMenu = 'branch';
  notchBranchQuery = '';
  renderBranchNotchMenu();
  $('#notch-branch-menu').hidden = false;
  $('#notch-branch-btn').setAttribute('aria-expanded', 'true');
  void loadNotchBranches(true);
});
document.addEventListener('pointerdown', event => {
  if (notchMenu && !event.target.closest('#work-notch,#notch-worktree-menu,#notch-branch-menu')) {
    closeNotchMenus();
  }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && notchMenu) closeNotchMenus();
});
api?.onSessionShow(id => api.sessionOpen(id).then(showSession).catch(e => error(e.message)));
api?.onBrowser(value => browserView.setState(value));
api?.onPreview(value => browserView.setPreview(value));
const automationSettings = setupAutomationSettings({ api, root: $('#automation-pane'), onError: text => error(text), onReproduce: paper => { $('#settings').close(); void startReproduction(paper); } });
// The evals saved from work sessions, under Work sessions (docs/evals-from-sessions.md).
const evalsSettings = setupEvalsSettings({ api, root: $('#evals-pane'), onError: text => error(text) });
$('#tab-projects').addEventListener('click', () => void evalsSettings.render());
const strengthsSettings = setupStrengthsSettings({ api, root: $('#strengths-pane'), onError: text => error(text) });
var autoChoices = setupAutoChoices($('#settings-form'));
$('#tab-conversation').addEventListener('click', () => void strengthsSettings.render());
// A chat offering to save your previous request as an eval (offer_save_eval) opens its card here; you save it.
api?.onEvalOffer?.(({ at }) => void import('./save-eval.js').then(({ openSaveEval }) => openSaveEval({ api, at, onError: error, onSaved: saved => status(`Saved “${saved.title}” as an eval`) })));
$('#tab-automation').addEventListener('click', () => automationSettings.render());
const phoneSettings = setupPhoneSettings({ api, root: $('#phone-pane') });
const phoneLinkSettings = setupPhoneLinkSettings({ api, root: $('#phone-link-pane') });
setupPlanUsage({ api, root: $('#plan-usage') });
setupMessageRail({ scroller: $('#messages'), host: $('.conversation') });
$('#tab-phone').addEventListener('click', () => { phoneSettings.render(); phoneLinkSettings.render(); });
const PANE_NAMES = { today: 'Today', meeting: 'Meeting', outline: 'Outline', 'side-chat': 'Side chat', sources: 'Sources', artifacts: 'Pages', files: 'Files', data: 'Data', tasks: 'Tasks', swarm: 'Swarm', trace: 'Run trace', journal: 'Lab journal', compute: 'Compute', changes: 'Changes', git: 'Git', terminal: 'Terminal', browser: 'Browser' };
const startChat = async () => { showSession(await api.sessionNew()); $('#message').focus(); };
const startWork = async folder => {
  const picked = await pickWorkFolderIfRemote(folder, { title: 'New work session on mini', confirmLabel: 'Work here' });
  if (picked.cancelled) return;
  const next = await api.sessionNewWork(picked.folder);
  if (next) { showSession(next); status('New work session'); $('#message').focus(); }
};
const openChat = async id => { if (id !== state.sessions?.active) showSession(await api.sessionOpen(id)); };
const composeSkill = skill => { setDraft(`/${skill.name} `); $('#message').focus(); };
// /fork: a copy of this chat as it stands, opened in its place; the original stays in the sidebar.
async function forkChat() {
  try { showSession(await api.sessionFork()); status('Forked. This is the copy; the original is in the sidebar.'); }
  catch (e) { error(e.message); }
}
// Convert a regular chat into a work session attached to a folder, keeping its full conversation history.
async function convertChatToWork(folder) {
  if (!api?.sessionToWork) return;
  if (state.sessions?.work) { error('This chat is already a work session.'); return; }
  if (busy) { error('Wait for Fairy to finish replying first.'); return; }
  try {
    const picked = await pickWorkFolderIfRemote(folder, { title: 'Convert chat to work session', confirmLabel: 'Convert here' });
    if (picked.cancelled) return;
    const next = await api.sessionToWork(state.sessions?.active ?? null, picked.folder);
    if (next) {
      showSession(next);
      status(picked.folder === 'scratch' ? 'Converted to scratch work session in Fairy Scratch' : `Converted to work session in ${next.sessions?.work?.name || 'folder'}`);
      $('#message').focus();
    }
  } catch (e) { error(e.message); }
}
// /btw: a side question answered in a card above the composer, never kept in the chat. × or Esc closes it.
let btwAsked = 0;
function closeBtw() { btwAsked += 1; $('#btw').hidden = true; $('#btw').replaceChildren(); }
function showBtw(question) {
  const card = $('#btw'), asked = ++btwAsked, part = (tag, className, text) => { const node = document.createElement(tag); node.className = className; if (text) node.textContent = text; return node; };
  const head = part('div', 'btw-head'), close = part('button', 'btw-close', '×'), answer = part('div', 'btw-answer', 'Thinking…');
  close.type = 'button'; close.title = 'Close (Esc)'; close.setAttribute('aria-label', 'Close the side answer'); close.onclick = closeBtw;
  head.append(part('span', 'btw-label', 'By the way'), part('span', 'btw-question', question), close);
  const foot = part('div', 'btw-foot');
  foot.append(part('p', 'btw-note', 'Not kept in this chat.'));
  card.replaceChildren(head, answer, foot);
  card.hidden = false;
  api.btw(question).then(reply => {
    if (asked !== btwAsked) return;
    const text = reply.text || 'No answer came back.';
    renderReply(answer, text);
    const addBtn = part('button', 'btw-action', 'Add to chat');
    addBtn.type = 'button';
    addBtn.onclick = () => {
      quoteSelection?.add({ snippet: `${question}: ${text}`, text, formatted: `> Side question: ${question}\n>\n${text.split('\n').map(l => `> ${l}`).join('\n')}`, source: 'side-chat' });
      closeBtw();
      $('#message').focus();
    };
    const panelBtn = part('button', 'btw-action', 'Open in Side chat');
    panelBtn.type = 'button';
    panelBtn.onclick = () => {
      sideChatView.seedTurn({ question, answer: text });
      closeBtw();
      sidePane?.show('side-chat');
    };
    foot.append(addBtn, panelBtn);
  }, e => { if (asked === btwAsked) answer.textContent = e.message; });
}
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('#btw').hidden && !document.querySelector('dialog[open]')) closeBtw(); });
function secondOpinion() { if (state.sessions?.work) void sendWork('/review'); else error('A second opinion needs a work session.'); }
async function startReproduction(paper) {
  if (!api?.reproStart) { error('Reproducing a paper needs the desktop app.'); return; }
  error('');
  status(`Fetching ${paper} from arXiv…`);
  try {
    const result = await api.reproStart({ paper });
    status(`Added ${result.goal.id} in ${result.folder}`);
    hideOtherBoards(); hidePlugins(); hideUsage();
    await openGoals().then(view => view?.open(result.goal.id));
  } catch (e) {
    const message = String(e?.message || e).replace(/Error invoking remote method '[^']+': Error: /, '');
    error(message);
    status('');
  }
}
async function generateMorningBrief() {
  if (!api?.researchBriefGenerate) { error('Research brief needs the desktop app.'); return; }
  error('');
  status('Building today’s Research brief…');
  try {
    const res = await api.researchBriefGenerate({ refreshPapers: true });
    if (res?.artifacts) state.artifacts = res.artifacts;
    status(`${res.brief.title}: ${res.brief.summaryLine}`);
    if (res?.artifact) sidePane.show('artifacts', { artifact: res.artifact.id, seq: res.artifact.seq });
  } catch (e) {
    error(e.message);
    status('');
  }
}
const slashCommands = () => [
  { name: 'new', about: 'Start a new chat', run: startChat },
  { name: 'work', about: 'Start a work session in a folder', run: startWork },
  { name: 'brief', about: 'Generate today’s Research brief page (papers, runs, PRs & calendar)', run: generateMorningBrief },
  { name: 'investigate', about: 'Search code, web, notes & papers in parallel for a cited answer', run: () => { setDraft('/investigate '); $('#message').focus(); } },
  { name: 'ui', about: 'Render an interactive A2UI widget, form, calculator or checklist in chat', run: () => { setDraft('/ui '); $('#message').focus(); } },
  { name: 'reproduce', about: 'Fetch an arXiv paper into ~/Reproductions and add a goal', run: () => { setDraft('/reproduce '); $('#message').focus(); } },
  { name: 'settings', about: 'Open Settings', run: openSettings },
  { name: 'setup', about: 'Open Baryon Setup & Feature Guide', run: () => { void openSetupWizard(); } },
  { name: 'guide', about: 'Open Baryon Setup & Feature Guide', run: () => { void openSetupWizard(); } },
  { name: 'stop', about: 'Stop what Fairy is doing', run: () => $('#stop').click() },
  { name: 'tasks', about: 'Show this chat’s task list', run: () => sidePane.show('tasks') },
  { name: 'trace', about: 'Show this chat’s run trace (steps, models, timings, tokens & handoffs)', run: () => sidePane.show('trace') },
  { name: 'journal', about: 'Open this project’s editable lab journal', run: () => sidePane.show('journal') },
  { name: 'compute', about: 'Open the Compute panel for Nexus tickets, running jobs, logs & outputs', run: () => sidePane.show('compute') },
  { name: 'data', about: 'Open the Data pane to inspect CSV, JSON, Parquet, or SQLite files', run: () => sidePane.show('data') },
  { name: 'swarm', about: 'Deploy parallel agents in isolated workspaces', run: () => { if (!state.sessions?.work) { error('Open a work session first to deploy a parallel agent swarm.'); return; } sidePane.show('swarm'); } },
  { name: 'council', about: 'Ask multiple model families to debate a design before building', run: () => { setDraft('/council '); $('#message').focus(); } },
  { name: 'teamwork', about: 'Deploy parallel agents in isolated workspaces (alias for /swarm)', run: () => { if (!state.sessions?.work) { error('Open a work session first to deploy a parallel agent swarm.'); return; } sidePane.show('swarm'); } },
  { name: 'agents', about: 'Open the Parallel Agent Swarm panel (alias for /swarm)', run: () => { if (!state.sessions?.work) { error('Open a work session first to deploy a parallel agent swarm.'); return; } sidePane.show('swarm'); } },
  { name: 'changes', about: 'Show what’s changed in this folder', run: () => sidePane.show('changes') },
  { name: 'review', about: 'Ask another model to check this work', run: secondOpinion },
  { name: 'btw', about: 'Ask a quick side question; the answer isn’t kept in the chat', run: () => { setDraft('/btw '); $('#message').focus(); } },
  { name: 'fanout', about: 'Ask all connected models in parallel and compare answers side by side', run: () => { setDraft('/fanout '); $('#message').focus(); } },
  { name: 'side', about: 'Open Side chat panel (disposable side conversation with Add to chat)', run: () => sidePane.show('side-chat') },
  { name: 'stash', about: 'Stash or restore a composer draft', run: () => { const hasDraft = Boolean($('#message').value.trim() || attachmentDraft.list().length || quoteSelection?.list?.().length); if (hasDraft) composerStashView?.stashCurrent(); else composerStashView?.openMenu(); } },
  { name: 'fork', about: 'Copy this chat so far into a new one, and carry on there', run: forkChat },
  { name: 'to-work', about: 'Convert this chat into a work session in a folder', run: () => void convertChatToWork() },
  { name: 'plugins', about: 'Open Plugins & Integrations gallery', run: () => { $('#sidebar-plugins').click(); } },
  { name: 'attach', about: 'Attach files to your message', run: () => attachmentDraft.choose() },
  { name: 'import', about: 'Import new chats from Claude Code', run: async () => { status('Importing from Claude Code…'); status((await api.claudeImport()).text); } },
  { name: 'recall', about: 'Search across all past chats and work sessions', run: () => palette.open() },
];
setupSlashMenu({ input: $('#message'), parent: $('.composer'), onError: text => error(text), commands: async () => [...slashCommands(), ...(api ? await api.skillsList() : []).map(skill => ({ name: skill.name, about: skill.description, source: skill.source }))] });
let triggerFilesCache = { at: 0, key: '', items: [] };
async function composerFileItems(query) {
  const q = String(query || '').trim().toLowerCase();
  const key = `${activeSessionKey()}:${state.sessions?.work?.name || ''}`;
  if (triggerFilesCache.key !== key || Date.now() - triggerFilesCache.at > 5000) {
    const collected = [];
    const seen = new Set();
    const pushFile = (path, hint = '') => {
      if (!path || seen.has(path)) return;
      seen.add(path);
      collected.push({ path, hint });
    };
    if (state.sessions?.work && api?.gitStatus) {
      const st = await api.gitStatus().catch(() => null);
      for (const f of st?.files || []) pushFile(f.path, f.kind || 'Changed');
    }
    if (api?.filesStatus && api?.filesList) {
      const roots = await api.filesStatus().catch(() => []);
      for (const root of (roots || []).slice(0, 4)) {
        const listing = await api.filesList(root.id, '').catch(() => null);
        for (const item of listing?.items || []) {
          if (item.kind === 'file') pushFile(item.link || item.path, root.name || 'File');
        }
      }
    }
    triggerFilesCache = { at: Date.now(), key, items: collected };
  }
  return triggerFilesCache.items
    .filter(item => !q || item.path.toLowerCase().includes(q))
    .slice(0, 12)
    .map(item => ({ label: item.path.split('/').pop() || item.path, insert: serializeComposerFileLink(item.path), hint: item.hint || item.path }));
}
setupMultiTriggerMenu({
  input: $('#message'),
  parent: $('.composer'),
  onError: text => error(text),
  providers: {
    path: composerFileItems,
    skill: async query => {
      const q = String(query || '').trim().toLowerCase();
      const skills = api ? await api.skillsList().catch(() => []) : [];
      return (skills || [])
        .filter(s => !q || s.name.toLowerCase().includes(q) || String(s.description || '').toLowerCase().includes(q))
        .slice(0, 12)
        .map(s => ({ label: `$${s.name}`, insert: `$${s.name}`, hint: s.description || s.source || 'Skill' }));
    },
    'pull-request': async query => {
      const q = String(query || '').trim().toLowerCase();
      const items = [];
      if (state.sessions?.work && api?.gitOverview) {
        const ov = await api.gitOverview().catch(() => null);
        if (ov?.branch) items.push({ label: `#${ov.branch}`, insert: `#${ov.branch}`, hint: 'Current branch' });
      }
      for (const s of state.sessions?.sessions || []) {
        const title = s.title || s.id;
        if (!q || title.toLowerCase().includes(q) || String(s.branch || '').toLowerCase().includes(q)) {
          items.push({ label: `#${title}`, insert: `${title}${s.branch ? ` (${s.branch})` : ''}`, hint: s.work || 'Thread' });
        }
        if (items.length >= 12) break;
      }
      return items.slice(0, 12);
    },
  },
});
const palette = setupPalette({ parent: $('#app'), enabled: () => !floating && Boolean(api), onError: text => error(text),
  search: async query => {
    if (!api?.sessionRecall) return [];
    const res = await api.sessionRecall(query, { limit: 8, perSession: 1 });
    return (res?.hits || []).map(hit => ({
      group: 'In chats',
      label: hit.title,
      hint: `${hit.date}${hit.folder ? ` · ${hit.folder}` : ''} — ${hit.excerpt}`,
      run: () => openChat(hit.sessionId),
    }));
  },
  items: async () => [
  ...slashCommands().map(command => ({ group: 'Commands', label: command.about, hint: `/${command.name}`, run: command.run })),
  { group: 'Commands', label: 'Baryon Setup & Feature Guide', hint: '/setup', run: () => { void openSetupWizard(); } },
  { group: 'Commands', label: 'Show or put away the companion', run: () => api.companionToggle() },
  // The default work folder (Settings → Work sessions), straight away.
  ...(state.settings?.workFolder ? [{ group: 'Commands', label: `Work in ${state.settings.workFolder.split('/').filter(Boolean).at(-1)}`, hint: state.settings.workFolder, run: () => startWork(state.settings.workFolder) }] : []),
  ...Object.entries(PANE_NAMES).map(([id, name]) => ({ group: 'Panels', label: name, run: () => sidePane.show(id) })),
  ...(await api.skillsList()).map(skill => ({ group: 'Skills', label: `/${skill.name}`, hint: skill.description, run: () => composeSkill(skill) })),
  ...[...(state.sessions?.sessions || [])].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).map(session => ({ group: 'Chats', label: session.title, hint: session.work || '', run: () => openChat(session.id) })),
  ...(state.artifacts?.items || []).slice(0, 200).map(item => ({ group: 'Pages', label: item.title, hint: item.description || '', run: () => sidePane.show('artifacts', { artifact: item.id, seq: item.versions?.at(-1)?.seq }) })),
] });
api?.onPalette?.(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true })));
new MutationObserver(() => browserView.sync()).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
let lastViewClasses = '';
const viewClassesOf = () => ['home', 'notebook-open', 'notebook-book', 'academy-open', 'research-open', 'diffusion-open', 'runs-open', 'goals-open', 'plugins-open', 'boards-open', 'analytics-open', 'usage-open', 'neutrino-open'].filter(c => document.documentElement.classList.contains(c)).join(' ');
lastViewClasses = viewClassesOf();
new MutationObserver(() => {
  browserView.sync();
  const nextView = viewClassesOf();
  if (nextView !== lastViewClasses) { lastViewClasses = nextView; requestBackgroundSync(); }
}).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
api?.onArtifacts(value => pagesPane.update(value, () => sidePane.redraw()));
$('#sidebar-search-input').onkeydown = event => { if (event.key === 'Escape') setSidebarSearch(false); };
try { if (localStorage.getItem('fairy-sidebar') === 'collapsed') setSidebarCollapsed(true); } catch {}
$('#sidebar-new-note').onclick = () => $('#notes-develop').click();
const settingsAt = pane => { openSettings(); showSettingsPane(pane); };
api?.onSettingsAt?.(pane => settingsAt(pane));
// The window's tools (Companion, Pin, Voice, Float) live on the left rail, below its actions, so the chat, notebooks and
// panels all reach the top of the window.
$('#action-rail').append($('.window-tools'));
// Study notebooks take the chat's place; opening or starting a chat brings it back.
// Fairy is the notebook's tutor, and reads its answers aloud in her own voice.
// Efficiency audit, fix 12: the notebook view, with its PDF viewer, graphics and styles, loads the first time it's
// opened. Until then hiding it or a voice change has nothing to do.
let studyNotebooks = null;
const openNotebooks = () => !featureOn('notebooks') ? Promise.resolve(null) : (studyNotebooks ??= import('./notebook-view.js').then(({ notebookView }) => notebookView({ api, root: $('#notebook-view'), sidebarButton: $('#sidebar-study'), sidebarSlot: $('#notebook-sources'), onPaper: paperSidebar,
  // Notebook's sky shows and the wallpaper rests while it's open.
  onShow: () => requestBackgroundSync(), onHide: () => requestBackgroundSync(),
  openPage: artifact => sidePane.show('artifacts', { artifact: artifact.id, seq: artifact.seq }),
  // Research (stage 8.10): a Deep Research report opens a new investigation's form, filled in from it.
  onInvestigate: seed => draftInvestigation(seed),
  speech: { settings: () => state.settings, muted, speak: speakNotebook, stop: stopNotebookVoice, unmute: () => setMuted(false), openSettings: pane => settingsAt(pane) } }))
  .catch(e => { studyNotebooks = null; error(`Notebooks couldn’t open: ${e.message}`); return null; }));
notebookVoiceChanged = () => { void studyNotebooks?.then(view => view?.voiceChanged()); };
$('#sidebar-study').disabled = !api;
const hideNotebooks = () => { void studyNotebooks?.then(view => view?.hide()); };
// Research (docs/research-migration.md, stage 5): its board, loaded the first time it's opened, in the place the
// notebooks use; one of the two is open at a time.
let researchBoard = null;
const openResearch = () => !featureOn('research') ? Promise.resolve(null) : (researchBoard ??= import('./research-view.js').then(({ researchView }) => researchView({ api, root: $('#research-view'), sidebarButton: $('#sidebar-research'), openLink: api.openSource ? url => api.openSource(url) : null,
  // The Study link (stage 8.4): Research hands a paper to the notebooks, which open beside the tutor.
  onStudy: ({ source }) => { hideOtherBoards(); hidePlugins(); hideUsage(); void openNotebooks().then(view => view?.showSource(source)); },
  // Manuscripts (stage 8.6): the report opens in the Pages panel beside the board.
  onPage: artifact => sidePane.show('artifacts', { artifact: artifact.id, seq: artifact.seq }),
  // Reproduce a paper (stage 6, Decision 11): one-click Reproduce from a paper in Research's literature.
  onReproduce: paper => void startReproduction(paper),
  // Velvet's grid stands down while Research shows its lattice.
  onShow: () => requestBackgroundSync(), onHide: () => requestBackgroundSync() }))
  .catch(e => { researchBoard = null; error(`Research couldn’t open: ${e.message}`); return null; }));
const hideResearch = () => { void researchBoard?.then(view => view?.hide()); };
// Diffusion: where images and videos will be made; a placeholder for now, loaded the first time it's opened, in the
// same place. One of the notebooks, Research and Diffusion is open at a time.
let diffusionBoard = null;
const openDiffusion = () => !featureOn('studio') ? Promise.resolve(null) : (diffusionBoard ??= import('./studio-view.js').then(({ studioView }) => studioView({ api, root: $('#diffusion-view'), onError: error, onOpenSettings: pane => settingsAt(pane), onLaunchWorld: seed => { hideOtherBoards(); hidePlugins(); hideUsage(); void openWorlds().then(view => view?.openWithSeed?.(seed)); }, onSendToGame: asset => { hideOtherBoards(); hidePlugins(); hideUsage(); void openGame().then(view => view?.openWithAsset?.(asset)); }, sidebarButton: $('#sidebar-diffusion'), onShow: () => requestBackgroundSync(), onHide: () => requestBackgroundSync() }))
  .catch(e => { diffusionBoard = null; error(`Studio couldn’t open: ${e.message}`); return null; }));
const hideDiffusion = () => { void diffusionBoard?.then(view => view?.hide()); };
let worldsBoard = null;
const openWorlds = () => !featureOn('worlds') ? Promise.resolve(null) : (worldsBoard ??= import('./worlds-view.js').then(({ worldsView }) => worldsView({ api, root: $('#worlds-view'), sidebarButton: $('#sidebar-worlds'), onError: error, onOpenSettings: pane => settingsAt(pane), onShow: () => requestBackgroundSync(), onHide: () => requestBackgroundSync() }))
  .catch(e => { worldsBoard = null; error(`Worlds couldn’t open: ${e.message}`); return null; }));
const hideWorlds = () => { void worldsBoard?.then(view => view?.hide()); };
let gameBoard = null;
const openGame = () => !featureOn('game') ? Promise.resolve(null) : (gameBoard ??= import('./game-view.js').then(({ gameView }) => gameView({ api, root: $('#game-view'), sidebarButton: $('#sidebar-game'), onError: error, onShow: () => requestBackgroundSync(), onHide: () => requestBackgroundSync() }))
  .catch(e => { gameBoard = null; error(`Games couldn’t open: ${e.message}`); return null; }));
const hideGame = () => { void gameBoard?.then(view => view?.hide()); };
// Runs (docs/tracker-plan.md, stage 3): the experiments Fairy ran, by project, in the same place, loaded the first time.
let runsBoard = null;
const openRuns = () => runsBoard ??= import('./runs-view.js').then(({ runsView }) => runsView({ api, root: $('#runs-view'), sidebarButton: $('#sidebar-runs'),
  onOpenChat: id => { hideRuns(); void openChat(id).catch(e => error(e.message)); }, onError: error, onShow: () => requestBackgroundSync(), onHide: () => requestBackgroundSync() }))
  .catch(e => { runsBoard = null; error(`Experiments couldn’t open: ${e.message}`); return null; });
const openPlugins = () => pluginsBoard ??= import('./plugins-view.js').then(({ pluginsView }) => pluginsView({
  api,
  root: $('#plugins-view'),
  sidebarButton: $('#sidebar-plugins'),
  getSettings: () => state.settings,
  isRemote: () => Boolean(state.remote),
  onOpenSettings: pane => settingsAt(pane),
  onOpenMusic: () => $('#music-button').click(),
  onIntegrationsChanged: () => { void googleAccountSettings.refresh(); void calendarSettings.refresh(); void gmailSettings.refresh(); void driveSettings.refresh(); void filesSettings.refresh(); void automationSettings.render(); },
  onShow: () => requestBackgroundSync(),
  onHide: () => requestBackgroundSync(),
})).catch(e => { pluginsBoard = null; error(`Plugins couldn’t open: ${e.message}`); return null; });
const openUsage = () => usageBoard ??= import('./usage-view.js').then(({ usageView }) => usageView({
  api,
  root: $('#usage-view'),
  sidebarButton: $('#sidebar-usage'),
  onOpenChat: id => { hideUsage(); void openChat(id).catch(e => error(e.message)); },
  onError: error,
  onShow: () => requestBackgroundSync(),
  onHide: () => requestBackgroundSync(),
})).catch(e => { usageBoard = null; error(`Usage couldn’t open: ${e.message}`); return null; });
const openPricing = () => pricingBoard ??= import('./pricing-view.js').then(({ pricingView }) => pricingView({
  api,
  root: $('#pricing-view'),
  sidebarButton: $('#sidebar-pricing'),
  getState: () => state,
  onShow: () => requestBackgroundSync(),
  onHide: () => requestBackgroundSync(),
})).catch(e => { pricingBoard = null; error(`Pricing couldn’t open: ${e.message}`); return null; });
const openNeutrino = () => neutrinoBoard ??= import('./neutrino-view.js').then(({ neutrinoView }) => neutrinoView({
  api,
  root: $('#neutrino-view'),
  onOpenWork: (next, said) => { hideNeutrino(); showSession(next); sidePane.show('git'); $('#message').focus(); if (said) status(said); },
  onDraft: text => { hideNeutrino(); setDraft(text); $('#message').focus(); status('Ready to send: change the question if you like, then press Return'); },
  onError: error,
  onShow: () => requestBackgroundSync(),
  onHide: () => requestBackgroundSync(),
})).catch(e => { neutrinoBoard = null; error(`Neutrino couldn’t open: ${e.message}`); return null; });
const hideRuns = () => { void runsBoard?.then(view => view?.hide()); hideGoals(); };
// Goals (docs/goals-board-plan.md): the board, in the chat's place as Experiments is. Hidden with Experiments, so every
// place that hides one hides the other.
let goalsBoard = null;
const openGoals = () => goalsBoard ??= import('./goals-view.js').then(({ goalsView }) => goalsView({ api, root: $('#goals-view'), sidebarButton: $('#sidebar-goals'),
  openLink: api?.openSource ? url => api.openSource(url) : null,
  chats: () => (state.sessions?.sessions || []).map(({ id, title }) => ({ id, title })),
  onOpenChat: id => { hideGoals(); void openChat(id).catch(e => error(e.message)); },
  onOpenRun: (folder, id) => { hideGoals(); void openRuns().then(view => view?.open(folder, id)); },
  onError: error, onShow: () => requestBackgroundSync(), onHide: () => requestBackgroundSync() }))
  .catch(e => { goalsBoard = null; error(`Goals couldn’t open: ${e.message}`); return null; });
const openBoards = () => boardsBoard ??= import('./boards-view.js').then(({ boardsView }) => boardsView({
  api,
  root: $('#boards-view'),
  sidebarButton: $('#sidebar-boards'),
  onOpenDoc: docId => {
    if (!docId) return;
    const art = state.artifacts?.items?.find(item => item.id === docId);
    const seq = art?.versions?.at(-1)?.seq;
    sidePane.show('artifacts', seq ? { artifact: docId, seq } : { artifact: docId });
  },
  onShow: () => requestBackgroundSync(),
  onHide: () => requestBackgroundSync(),
})).catch(e => { boardsBoard = null; error(`Boards couldn’t open: ${e.message}`); return null; });
const openAnalytics = () => !featureOn('analytics') ? Promise.resolve(null) : (analyticsBoard ??= import('./analytics-view.js').then(({ analyticsView }) => analyticsView({
  api,
  root: $('#analytics-view'),
  sidebarButton: $('#sidebar-analytics'),
  onPage: artifact => { if (artifact?.id) sidePane.show('artifacts', { artifact: artifact.id, seq: artifact.seq }); },
  onError: error,
  onShow: () => requestBackgroundSync(),
  onHide: () => requestBackgroundSync(),
})).catch(e => { analyticsBoard = null; error(`Analytics couldn’t open: ${e.message}`); return null; }));
const openDesign = () => (designBoard ??= import('./design-view.js').then(({ designView }) => designView({
  api,
  root: $('#design-view'),
  sidebarButton: $('#sidebar-design'),
  onError: error,
  onShow: () => requestBackgroundSync(),
  onHide: () => requestBackgroundSync(),
})).catch(e => { designBoard = null; error(`Design Mode couldn’t open: ${e.message}`); return null; }));
const openAcademy = () => !featureOn('academy') ? Promise.resolve(null) : (academyBoard ??= import('./academy-view.js').then(({ academyView }) => academyView({
  api,
  root: $('#academy-view'),
  sidebarButton: $('#sidebar-academy'),
  onError: error,
  onShow: () => requestBackgroundSync(),
  onHide: () => requestBackgroundSync(),
})).catch(e => { academyBoard = null; error(`Academy couldn’t open: ${e.message}`); return null; }));
function hideGoals() { void goalsBoard?.then(view => view?.hide()); hidePlugins(); hideBoards(); hideDesign(); hideWorlds(); hideGame(); hideUsage(); hidePricing(); hideAnalytics(); hideAcademy(); hideNeutrino(); }
const openRunCitation = id => { const folder = state.sessions?.work?.path; if (!folder || !api?.runsList) return; hideOtherBoards(); hidePlugins(); hideUsage(); void openRuns().then(view => view?.open(folder, id)); };
// A new investigation's form, filled in from a notebook's report or by a chat (stage 8.10): nothing is made until you press Create.
const draftInvestigation = seed => { if (!api?.research) return; hideOtherBoards(); hidePlugins(); hideUsage(); void openResearch().then(view => view?.draft(seed)); };
api?.onResearchDraft?.(seed => draftInvestigation(seed));
api?.onAnalyticsOpen?.(payload => {
  hideOtherBoards(); hidePlugins(); hideUsage();
  void openAnalytics().then(view => view?.openDataset(payload?.datasetId || '', { mode: payload?.mode || 'learn' }));
});
$('#sidebar-research').hidden = !featureOn('research');
$('#sidebar-research').disabled = !api?.research;
$('#sidebar-research').onclick = () => { if (api?.research) { hideOtherBoards(); hidePlugins(); hideUsage(); void openResearch().then(view => view?.toggle()); } };
$('#sidebar-study').hidden = !featureOn('notebooks');
$('#sidebar-study').onclick = () => { if (api) { hideOtherBoards(); hidePlugins(); hideUsage(); void openNotebooks().then(view => view?.toggle()); } };
$('#sidebar-academy').hidden = !featureOn('academy');
$('#sidebar-academy').disabled = !api?.academy;
$('#sidebar-academy').onclick = () => { if (api?.academy) { hideOtherBoards(); hidePlugins(); hideUsage(); void openAcademy().then(view => view?.toggle()); } };
$('#sidebar-diffusion').hidden = !featureOn('studio');
$('#sidebar-diffusion').disabled = !api?.studio;
$('#sidebar-diffusion').onclick = () => { if (api?.studio) { hideOtherBoards(); hidePlugins(); hideUsage(); void openDiffusion().then(view => view?.toggle()); } };
$('#sidebar-worlds').hidden = !featureOn('worlds');
$('#sidebar-worlds').disabled = !api?.worlds;
$('#sidebar-worlds').onclick = () => { if (api?.worlds) { hideOtherBoards(); hidePlugins(); hideUsage(); void openWorlds().then(view => view?.toggle()); } };
$('#sidebar-game').hidden = !featureOn('game');
$('#sidebar-game').disabled = !api?.game;
$('#sidebar-game').onclick = () => { if (api?.game) { hideOtherBoards(); hidePlugins(); hideUsage(); void openGame().then(view => view?.toggle()); } };
$('#sidebar-runs').disabled = !api?.runsProjects;
$('#sidebar-runs').onclick = () => { if (api?.runsProjects) { hideOtherBoards(); hidePlugins(); hideUsage(); void openRuns().then(view => view?.toggle()); } };
$('#sidebar-goals').disabled = !api?.goalsList;
$('#sidebar-goals').onclick = () => { if (api?.goalsList) { hideOtherBoards(); hidePlugins(); hideUsage(); void openGoals().then(view => view?.toggle()); } };
$('#sidebar-boards').disabled = !api?.boardsList;
$('#sidebar-boards').onclick = () => { if (api?.boardsList) { hideOtherBoards(); hidePlugins(); hideUsage(); void openBoards().then(view => view?.toggle()); } };
$('#sidebar-design').disabled = !api?.design;
$('#sidebar-design').onclick = () => { if (api?.design) { hideOtherBoards(); hidePlugins(); hideUsage(); void openDesign().then(view => view?.toggle()); } };
$('#sidebar-analytics').hidden = !featureOn('analytics');
$('#sidebar-analytics').disabled = !api?.analytics;
$('#sidebar-analytics').onclick = () => { if (api?.analytics) { hideOtherBoards(); hidePlugins(); hideUsage(); void openAnalytics().then(view => view?.toggle()); } };
const hideOtherBoards = () => { hideNotebooks(); hideAcademy(); hideResearch(); hideDiffusion(); hideWorlds(); hideGame(); hideBoards(); hideDesign(); hidePricing(); hideAnalytics(); hideNeutrino(); void runsBoard?.then(view => view?.hide()); void goalsBoard?.then(view => view?.hide()); };
$('#sidebar-usage').disabled = !api?.tokenUsage;
$('#sidebar-usage').onclick = () => { if (api?.tokenUsage) { hideOtherBoards(); hidePlugins(); void openUsage().then(view => view?.toggle()); } };
$('#sidebar-plugins').onclick = () => { hideOtherBoards(); hideUsage(); void openPlugins().then(view => view?.toggle()); };
$('#sidebar-pricing')?.addEventListener('click', () => { hideOtherBoards(); hidePlugins(); hideUsage(); void openPricing().then(view => view?.toggle()); });
$('#open-pricing-from-settings')?.addEventListener('click', () => { $('#settings').close(); hideOtherBoards(); hidePlugins(); hideUsage(); void openPricing().then(view => view?.show()); });
$('#open-plugins-from-settings').onclick = () => { $('#settings').close(); hideOtherBoards(); hideUsage(); void openPlugins().then(view => view?.show()); };
let setupWizard = null;
const jumpToWorkspace = target => {
  hideOtherBoards();
  hidePlugins();
  hideUsage();
  if (target === 'notebooks' && api) void openNotebooks().then(v => v?.show?.() ?? v?.toggle?.());
  else if (target === 'academy' && api?.academy) void openAcademy().then(v => v?.show?.() ?? v?.toggle?.());
  else if (target === 'design' && api?.design) void openDesign().then(v => v?.show?.() ?? v?.toggle?.());
  else if (target === 'studio' && api?.studio) void openDiffusion().then(v => v?.show?.() ?? v?.toggle?.());
  else if (target === 'worlds' && api?.worlds) void openWorlds().then(v => v?.show?.() ?? v?.toggle?.());
  else if (target === 'game' && api?.game) void openGame().then(v => v?.show?.() ?? v?.toggle?.());
  else if (target === 'research' && api?.research) void openResearch().then(v => v?.show?.() ?? v?.toggle?.());
  else if (target === 'runs' && api?.runsProjects) void openRuns().then(v => v?.show?.() ?? v?.toggle?.());
  else if (target === 'goals' && api?.goalsList) void openGoals().then(v => v?.show?.() ?? v?.toggle?.());
  else if (target === 'boards' && api?.boardsList) void openBoards().then(v => v?.show?.() ?? v?.toggle?.());
  else if (target === 'analytics' && api?.analytics) void openAnalytics().then(v => v?.show?.() ?? v?.toggle?.());
  else if (target === 'plugins') void openPlugins().then(v => v?.show?.() ?? v?.toggle?.());
  else if (target === 'usage' && api?.tokenUsage) void openUsage().then(v => v?.show?.() ?? v?.toggle?.());
  else if (target === 'pricing') void openPricing().then(v => v?.show?.() ?? v?.toggle?.());
  else if (target === 'neutrino') void openNeutrino().then(v => v?.show?.() ?? v?.toggle?.());
  else if (target === 'pages') sidePane.show('artifacts');
};
const openSetupWizard = async stepId => {
  try {
    setupWizard ??= await import('./setup-wizard.js').then(({ createSetupWizard }) => createSetupWizard({
      api,
      parent: document.body,
      getState: () => state,
      onStateChange: next => { if (next) { state = next; ambient = state.awareness ?? ambient; updateState(); } },
      openSettings: pane => (pane ? settingsAt(pane) : openSettings()),
      jumpTo: jumpToWorkspace,
      toggleCompanion: () => api?.companionToggle?.(),
      toggleAnimations: () => $('#wallpaper-toggle')?.click(),
      startChat,
      startWork,
      onError: error,
    }));
    setupWizard.open(stepId);
  } catch (e) {
    setupWizard = null;
    error(`Setup guide couldn’t open: ${e.message}`);
  }
};
for (const id of ['#open-setup-wizard', '#open-setup-wizard-app']) $(id)?.addEventListener('click', () => { $('#settings').close(); void openSetupWizard(); });
$('#connection')?.addEventListener('click', () => { if (!conversationReady()) void openSetupWizard('providers'); else openSettings('accounts'); });
$('#connection').style.cursor = 'pointer';
for (const id of ['#recent-list', '#notebook-list']) $(id).addEventListener('click', event => { if (event.target.closest('[data-session]')) { hideOtherBoards(); hidePlugins(); hideUsage(); } }, true);
for (const id of ['#sidebar-new-chat', '#sidebar-new-work', '#sidebar-new-scratch']) $(id).addEventListener('click', () => { hideOtherBoards(); hidePlugins(); hideUsage(); }, true);
modelMenu = setupModelMenu({ api, button: $('#provider-label'), providerButton: $('#provider-button'), effortButton: $('#effort-label'), parent: $('.dock'), state: () => state, onChange: next => { state = next; updateState(); }, onError: error, openSettings: settingsAt });
// Auto's pick for the request just sent, beside “Auto” in the model button.
// Auto's pick for the request just sent: beside "Auto" in the model button, and under the reply once it starts.
let pendingAuto = null;
// A move offered mid-chat (Auto by task, stage 6): another model clearly ahead on this kind. Move answers this again
// there and holds the chat to it; Not now is remembered for this chat and kind, so it isn't offered again.
const KIND_WORDS = { code: 'coding', maths: 'maths', circuits: 'circuit', research: 'research', data: 'data', business: 'business', writing: 'writing', vision: 'picture', teaching: 'study' };
function messageFooter(item) {
  let footer = item.querySelector('.message-footer');
  if (!footer) { footer = document.createElement('div'); footer.className = 'message-footer'; item.append(footer); }
  return footer;
}
function addReplyTime(item, at) {
  const formatted = formatReplyTime(at);
  if (!item || !formatted) return;
  const footer = messageFooter(item);
  let stamp = footer.querySelector('.message-time');
  if (!stamp) { stamp = document.createElement('time'); stamp.className = 'message-time'; footer.append(stamp); }
  stamp.dateTime = formatted.iso;
  stamp.textContent = formatted.label;
  stamp.title = formatted.title;
}
function addMoveOffer(item, auto, request) {
  const offer = auto.byTask?.offer;
  if (!offer?.provider || !auto.kind || (state.sessions?.declined || []).includes(auto.kind) || item.querySelector('.message-offer')) return;
  for (const old of document.querySelectorAll('.message-offer')) old.remove();
  const chip = document.createElement('div'); chip.className = 'message-offer'; chip.setAttribute('role', 'group');
  const words = document.createElement('span'); words.textContent = `This looks like ${KIND_WORDS[auto.kind] || auto.kind} work. Move to ${modelName(offer.model)}?`;
  const move = document.createElement('button'); move.type = 'button'; move.textContent = 'Move';
  move.title = 'Answer this again on that model; the chat stays with it.';
  move.onclick = () => { chip.remove(); send(request, { autoProvider: offer.provider }); };
  const no = document.createElement('button'); no.type = 'button'; no.className = 'quiet'; no.textContent = 'Not now';
  no.onclick = async () => { chip.remove(); try { await api.chatOfferDecline(auto.kind); state.sessions = { ...state.sessions, declined: [...(state.sessions?.declined || []), auto.kind] }; } catch (e) { error(e.message); } };
  chip.append(words, move, no);
  (item.querySelector('.message-footer') || item.querySelector('.message-auto'))?.after(chip);
}
// request: the message this reply answered, for Choose another (Auto by task, stage 5), which answers it again on
// another provider's model; offered only on a chat's latest reply, with Auto by task on and other models to choose.
function addAutoLine(item, auto, request = '') {
  if (!item || !auto?.model) return;
  let line = item.querySelector('.message-auto');
  if (!line) { line = document.createElement('div'); line.className = 'message-auto'; messageFooter(item).append(line); }
  line.textContent = autoCaption(auto); line.title = autoWhy(auto);
  const others = auto.byTask?.others || [];
  if (!request || state.settings?.autoByTask !== 'on' || state.sessions?.work) return;
  addMoveOffer(item, auto, request);
  if (!others.length || item.querySelector('.message-choose')) return;
  for (const old of document.querySelectorAll('.message-choose')) old.remove();
  const choose = document.createElement('button'); choose.type = 'button'; choose.className = 'message-choose'; choose.textContent = 'Choose another';
  choose.title = 'Answer this again on another model. The chat stays with the one you choose.';
  choose.onclick = () => {
    const open = item.querySelector('.message-choose-menu');
    if (open) { open.remove(); return; }
    const menu = document.createElement('div'); menu.className = 'message-choose-menu'; menu.setAttribute('role', 'menu');
    for (const other of others) {
      const option = document.createElement('button'); option.type = 'button'; option.setAttribute('role', 'menuitem');
      option.textContent = `${modelName(other.model)}${other.score != null ? ` · ${Math.round(other.score)}` : ''}`;
      option.onclick = () => { menu.remove(); choose.remove(); send(request, { autoProvider: other.provider }); };
      menu.append(option);
    }
    item.append(menu);
  };
  line.after(choose);
}
function addVerdictLine(item, verdict) {
  const status = ['checked', 'failed', 'out-of-date', 'not-checked'].includes(verdict?.status) ? verdict.status : 'not-checked';
  const line = document.createElement('div');
  line.className = `message-verdict message-verdict--${status}`;
  line.dataset.verdict = status;
  line.textContent = verdict.line;
  if (verdict.tooltip) line.title = verdict.tooltip;
  messageFooter(item).append(line);
}
function addSwarmLine(item, record) {
  const line = document.createElement('div'); line.className = 'message-auto'; line.textContent = record.text; if (record.why) line.title = record.why;
  messageFooter(item).append(line);
}
// Puts /council and the request in the box, ready to send: the budget card still asks before any model is called.
function addTrySwarm(item, request) {
  const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'message-try-swarm'; chip.textContent = 'Try Council';
  chip.title = 'Auto thinks several designs from different model families could help with this. Puts /council and your request in the box.';
  chip.onclick = () => { const box = $('#message'); box.value = `/council ${request}`; box.dispatchEvent(new Event('input', { bubbles: true })); box.focus(); };
  messageFooter(item).append(chip);
}
api?.onAutoModel?.(pick => { state.autoPick = pick; modelMenu?.update(); if (pick?.where !== 'work' && pick?.where !== 'notebook') pendingAuto = { ...pick, receivedAt: Date.now() }; });
function setExtras(open) {
  $('#extras').hidden = !open; $('#extras-toggle').setAttribute('aria-expanded', String(open));
  $('#convert-to-work').hidden = Boolean(state.sessions?.work || !api?.sessionToWork);
  $('#project-memory').hidden = !state.sessions?.work;
  $('#lab-journal').hidden = !state.sessions?.work;
  for (const name of ['aria-label', 'title']) $('#extras-toggle').setAttribute(name, open ? 'Close options' : 'More options');
}
$('#extras-toggle').onclick = () => setExtras($('#extras').hidden);
$('#attach-files').onclick = () => { setExtras(false); attachmentDraft.choose(); };
$('#compact-chat').onclick = () => { setExtras(false); void compactChat(); };
$('#convert-to-work').onclick = () => { setExtras(false); void convertChatToWork(); };
$('#chat-header-to-work').onclick = () => void convertChatToWork();
$('#project-memory').onclick = () => { setExtras(false); void openProjectMemory({ api, onError: error }); };
$('#lab-journal').onclick = () => { setExtras(false); sidePane.show('journal'); };
document.addEventListener('pointerdown', event => { if (!$('#extras').hidden && !event.target.closest('#extras,#extras-toggle')) setExtras(false); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('#extras').hidden) { setExtras(false); $('#extras-toggle').focus(); } });
const askInChat = (text, options) => { if (mode !== 'chat') document.querySelector('[data-mode="chat"]').click(); void send(text, options); };
$('#share-screen').onclick = () => askInChat($('#message').value.trim() || 'Explain what’s on my screen.', { mode: 'screen' });
for (const button of document.querySelectorAll('#suggestions button')) button.onclick = () => button.dataset.screen ? askInChat(button.dataset.screen, { mode: 'screen' }) : askInChat(button.dataset.prompt);
$('#close-window').onclick = () => api?.close(); $('#minimize-window').onclick = () => api?.minimize();
// Full screen around the notch: the window's background runs up around the notch, and its contents start below it. The
// strip beside the notch shows the chat you're in on its left, and on its right what's working or waiting for your OK,
// the battery when it's running on it, and the time, since the menu bar and its clock are tucked away.
const notchBand = document.createElement('div');
notchBand.id = 'notch-band'; notchBand.hidden = true;
notchBand.innerHTML = '<div class="notch-left"><span class="notch-brand">Baryon</span><span id="notch-chat"></span></div><div class="notch-gap" aria-hidden="true"></div><div class="notch-right"><span id="notch-status"></span><span id="notch-battery"></span><span id="notch-time"></span></div>';
document.body.prepend(notchBand);
let notchClock = 0, notchBattery = null;
function drawNotchBand() {
  if (notchBand.hidden) return;
  const value = state.sessions || {}, running = Object.values(value.running || {});
  const chat = (value.sessions || []).find(session => session.id === value.active);
  $('#notch-chat').textContent = chat?.title || '';
  const waiting = running.filter(run => run === 'waiting').length, working = running.length - waiting;
  const status = $('#notch-status');
  status.textContent = [waiting && `${waiting} need${waiting === 1 ? 's' : ''} your OK`, working && `${working} working`].filter(Boolean).join(' · ');
  status.classList.toggle('waiting', waiting > 0);
  $('#notch-battery').textContent = notchBattery && !notchBattery.charging ? `${Math.round(notchBattery.level * 100)}%` : '';
  $('#notch-time').textContent = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date());
}
function showAroundNotch(value) {
  const on = Boolean(value?.on);
  $('#notch-window').hidden = !on && !value?.available;
  $('#notch-window').setAttribute('aria-label', on ? 'Leave full screen' : 'Full screen around the notch');
  $('#notch-window').title = on ? 'Leave full screen (⌃⌘F)' : 'Full screen around the notch (⌃⌘F)';
  document.documentElement.classList.toggle('around-notch', on);
  notchBand.hidden = !on;
  if (on) {
    const style = document.documentElement.style;
    style.setProperty('--notch-band', `${value.band}px`);
    style.setProperty('--notch-left', value.notch ? `${value.left}px` : '50%');
    style.setProperty('--notch-gap', value.notch ? `${Math.max(0, value.width - value.left - value.right)}px` : '0px');
    navigator.getBattery?.().then(battery => { notchBattery = battery; battery.onlevelchange = battery.onchargingchange = drawNotchBand; drawNotchBand(); }).catch(() => {});
    clearInterval(notchClock); notchClock = setInterval(drawNotchBand, 15000);
    drawNotchBand();
  } else clearInterval(notchClock);
}
$('#notch-window').onclick = () => void api?.aroundNotch(!document.documentElement.classList.contains('around-notch'));
api?.onAroundNotch?.(showAroundNotch);
api?.aroundNotch?.().then(showAroundNotch).catch(() => {});
let selectedPose = 'crossed';
try { if (localStorage.getItem('fairy-pose') === 'relaxed') selectedPose = 'relaxed'; } catch {}
function updatePose() {
  avatar?.setPose(selectedPose);
}
$('#floating-wave').onclick = () => {walkController?.cancel();avatar?.wave();};
$('#floating-listening').onclick = () => toggleHandsFree(undefined, true);
$('#floating-mic').onclick = toggleRecording; $('#floating-stop').onclick = () => {walkController?.cancel();void stop();};
$('#floating-mode').onclick = () => { if (!busy) document.querySelector(`[data-mode="${mode === 'chat' ? 'desktop' : 'chat'}"]`).click(); };
let spriteHoverTimeout = null, nextHoverWaveAt = -Infinity;
function setSpriteHovered(hovered) {
  const el = $('#avatar');
  if (!el) return;
  if (hovered) {
    if (spriteHoverTimeout) {
      clearTimeout(spriteHoverTimeout);
      spriteHoverTimeout = null;
    }
    // Forwarded mouse movement never makes the sprite capture clicks. Greet
    // once on entry, with a cooldown and the existing 150 ms edge hysteresis.
    const entering = !el.classList.contains('sprite-hovered');
    const sprite = avatar?.mode === 'sprite' ? avatar.spriteAvatar : null;
    if (entering && floating && !busy && ambient.awake && !document.hidden
        && sprite?.loaded && sprite.companion.kind!=='sleep' && sprite.canSit() && sprite.idleAnimation.phase === 'idle'
        && performance.now() >= nextHoverWaveAt) {
      nextHoverWaveAt = performance.now() + 10000;
      walkController?.cancel();avatar.wave();
    }
    el.classList.add('sprite-hovered');
    if (floating) radialMenu?.spriteHover(true);
  } else {
    if (spriteHoverTimeout) clearTimeout(spriteHoverTimeout);
    spriteHoverTimeout = null;
    el.classList.remove('sprite-hovered');
    radialMenu?.spriteHover(false);
  }
}
let isDraggingWindow = false;
let roamingEnabled=true, walkController;
let cursorTrackingEnabled=true;
try{cursorTrackingEnabled=localStorage.getItem('fairy-cursor-tracking')!=='off';}catch{}
$('#cursor-tracking-enabled').checked=cursorTrackingEnabled;
$('#cursor-tracking-enabled').onchange=()=>{cursorTrackingEnabled=$('#cursor-tracking-enabled').checked;try{localStorage.setItem('fairy-cursor-tracking',cursorTrackingEnabled?'on':'off');}catch{}if(avatar){avatar.spriteAvatar.cursorTrackingEnabled=cursorTrackingEnabled;avatar.spriteAvatar.cursorSampler?.cancel();avatar.spriteAvatar.cursorGaze.reset();}};
let reactionsEnabled=true;
try{reactionsEnabled=localStorage.getItem('fairy-conversation-reactions')!=='off';}catch{}
$('#conversation-reactions-enabled').checked=reactionsEnabled;
$('#conversation-reactions-enabled').onchange=()=>{reactionsEnabled=$('#conversation-reactions-enabled').checked;try{localStorage.setItem('fairy-conversation-reactions',reactionsEnabled?'on':'off');}catch{}if(avatar){avatar.spriteAvatar.reactionsEnabled=reactionsEnabled;if(!reactionsEnabled)avatar.spriteAvatar.reaction.stop();}};
let companionAnimationsEnabled=true;
try{companionAnimationsEnabled=localStorage.getItem('fairy-companion-animations')!=='off';}catch{}
$('#companion-animations-enabled').checked=companionAnimationsEnabled;
$('#companion-animations-enabled').onchange=()=>{companionAnimationsEnabled=$('#companion-animations-enabled').checked;try{localStorage.setItem('fairy-companion-animations',companionAnimationsEnabled?'on':'off');}catch{}if(avatar){avatar.spriteAvatar.animationsEnabled=companionAnimationsEnabled;if(!companionAnimationsEnabled)avatar.spriteAvatar.stopAnimations();}playbackIndicator.reset();requestBackgroundSync();};
function companionAllowed(preview=false,allowFollowups=false){
 return Boolean(initialized && avatar?.mode==='sprite' && ambient.awake && !ambient.paused && ambient.power?.optional!==false && !document.hidden
  && !busy && !recorder && !audio && !handsFree.detector?.started && !handsFree.processing && (!voiceGate.engaged || allowFollowups)
  && !meetingActive(meetingPanel?.state) && !quizInfo.enabled && !isDraggingWindow && !document.documentElement.classList.contains('desktop-working')
  && !$('#message').value.trim() && !$('#floating-message').value.trim() && !$('#settings').open && !$('#music').open && !document.querySelector('.file-preview')?.open
  && (preview || (!$('#avatar').classList.contains('sprite-hovered') && !document.querySelector('#floating-controls:hover, #floating-panel:hover') && (!floating || $('#floating-bubble').hidden))));
}
function previewAnimation(kind){
 noteInteraction();
 $('#settings').close();document.activeElement?.blur();walkController?.cancel();
 if(!avatar?.spriteAvatar.previewAnimation(kind))status('Animation paused · finish the current interaction or check motion/power settings');
}
$('#preview-animation').onclick=()=>previewAnimation($('#animation-preview').value);
try{roamingEnabled=localStorage.getItem('fairy-roaming')!=='off';}catch{}
const reducedWalking=matchMedia('(prefers-reduced-motion: reduce)');
$('#roaming-enabled').checked=roamingEnabled;
$('#roaming-enabled').onchange=()=>{roamingEnabled=$('#roaming-enabled').checked;try{localStorage.setItem('fairy-roaming',roamingEnabled?'on':'off');}catch{}if(!roamingEnabled)walkController?.cancel();};
// Ride along: after a few idle seconds, floating Fairy shrinks onto the pointer (main hides her window and the ink
// window draws her there). Anything she has to do, or pointing at her spot, brings her back.
let rideEnabled=false, riding=false, rideIdleSince=0, rideAway=false;
try{rideEnabled=localStorage.getItem('fairy-ride-along')==='on';}catch{}
function rideEligible(){
  return Boolean(api?.ride && rideEnabled && initialized && floating && !document.hidden && !busy && !recorder && !audio && !handsFree.detector?.started && !handsFree.processing && !voiceGate.engaged
    && !meetingActive(meetingPanel?.state) && !quizInfo.enabled && !isDraggingWindow && !walkController?.active && $('#floating-bubble').hidden && !$('#settings').open
    && !$('#floating-message').value.trim() && document.activeElement!==$('#floating-message') && !$('#avatar').classList.contains('sprite-hovered')
    && !document.querySelector('#floating-controls:hover, #floating-panel:hover, #avatar:hover'));
}
function setRide(on){
  if(on===riding)return Promise.resolve(riding);
  riding=on; document.body.classList.toggle('riding',on);
  return api.ride(on).then(result=>{riding=Boolean(result);document.body.classList.toggle('riding',riding);if(!riding)api.setPointerPassthrough?.(passthrough).catch(()=>{});return riding;}).catch(()=>{riding=false;document.body.classList.remove('riding');return false;});
}
function setRideEnabled(on){
  rideEnabled=on; try{localStorage.setItem('fairy-ride-along',on?'on':'off');}catch{}
  $('#ride-along').checked=on; $('#floating-ride')?.setAttribute('aria-pressed',String(on));
  if(!on){rideIdleSince=0;setRide(false);}
}
// Two Macs: Ride along goes with her when she crosses, as in companion.js (main calls these).
window.fairyRideAlong={
  state:()=>({enabled:rideEnabled,riding}),
  leave:()=>{rideAway=true;rideIdleSince=0;riding=false;document.body.classList.remove('riding');},
  arrive:({enabled,riding:was}={})=>{
    rideAway=false;riding=false;document.body.classList.remove('riding');
    if(typeof enabled==='boolean'&&enabled!==rideEnabled)setRideEnabled(enabled);
    if(!rideEnabled||was!==true){rideIdleSince=0;return Promise.resolve(false);}
    rideIdleSince=Date.now()-6000;
    return setRide(true);
  },
};
setInterval(()=>{
  if(rideAway)return;
  if(!rideEligible()){rideIdleSince=0;if(riding)setRide(false);return;}
  rideIdleSince||=Date.now();
  if(!riding&&Date.now()-rideIdleSince>6000)setRide(true);
},500);
function walkingEligible(manual=false){
  const sprite=avatar?.spriteAvatar;
  return Boolean(api?.walkStart && initialized && floating && !riding && avatar?.mode==='sprite' && sprite?.walkingReady && sprite.loaded
    && (roamingEnabled || manual) && !reducedWalking.matches && ambient.awake && !ambient.paused && ambient.power?.optional!==false
    && !document.hidden && !busy && !recorder && !audio && !handsFree.detector?.started && !handsFree.processing && !voiceGate.engaged
    && !meetingActive(meetingPanel?.state) && !quizInfo.enabled && !isDraggingWindow && !sprite.companion.kind && !sprite.reaction.kind && sprite.canSit() && sprite.idleAnimation.phase==='idle'
    && !$('#avatar').classList.contains('sprite-hovered') && !document.querySelector('#floating-controls:hover, #floating-panel:hover')
    && !$('#settings').open && !$('#music').open && !document.querySelector('.file-preview')?.open && $('#floating-bubble').hidden
    && !$('#floating-message').value.trim() && !$('#message').value.trim() && document.activeElement!==$('#floating-message'));
}
reducedWalking.addEventListener('change',()=>walkController?.cancel());
document.addEventListener('visibilitychange',()=>{if(document.hidden)walkController?.cancel();});
$('#ride-along').checked=rideEnabled; $('#ride-along').onchange=()=>setRideEnabled($('#ride-along').checked);
$('#floating-meeting').insertAdjacentHTML('beforebegin','<button id="floating-ride" class="icon-button" title="Ride along: when she’s idle, Fairy shrinks onto your pointer" aria-label="Ride along" aria-pressed="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 3l7 17 2.5-7.5L21 10z"/><circle cx="18" cy="18" r="2.5"/></svg></button>');
$('#floating-ride').setAttribute('aria-pressed',String(rideEnabled)); $('#floating-ride').onclick=()=>setRideEnabled(!rideEnabled);
const floatingControls = $('#floating-controls');
const groupIcon = path => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
// The floating controls and the old composer, ideas and awareness boxes, as one radial menu around the eye.
radialMenu = floatingControls ? setupRadialMenu({
  container: floatingControls,
  anchor: () => avatar?.mode === 'sprite' ? avatar.spriteAvatar.menuAnchor() : null,
  input: $('#floating-message'), send: $('#floating-send'), status: $('#floating-status'), pointer: api?.cursorPosition ? () => api.cursorPosition() : null,
  actions: ['#floating-listening', '#floating-mic', '#floating-explain', '#floating-mode', '#floating-wave', '#floating-mute',
    { label: 'Ideas', icon: groupIcon('<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/>'), items: ['#floating-new-topic', '#floating-news', '#floating-pause-ideas', '#floating-sing', '#floating-music'] },
    { label: 'Senses', icon: groupIcon('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'), items: ['#floating-hands-free', '#floating-pause-awareness', '#floating-quiz-hints', '#floating-quiz-auto'] },
    { label: 'More', icon: groupIcon('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'), items: ['#floating-ride', '#floating-meeting', '#open-workspace', '#floating-stop'] }],
}) : null;
if (floatingControls) {
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  const onPointerDown = event => {
    if (!floating) return;
    if (event.button !== 0) return;
    if (event.target.closest('button, input, textarea, a')) return;
    if (!event.target.closest('.floating-handle') && event.target !== floatingControls) return;

    walkController?.cancel();
    isDraggingWindow = true;
    dragOffsetX = event.clientX;
    dragOffsetY = event.clientY;

    if (api && passthrough) {
      passthrough = false;
      api.setPointerPassthrough(false);
    }
    setSpriteHovered(false);

    try {
      floatingControls.setPointerCapture(event.pointerId);
    } catch {}
    document.body.classList.add('is-dragging');
    event.preventDefault();
  };

  const onPointerMove = event => {
    if (!isDraggingWindow) return;
    api?.setWindowPosition(event.screenX - dragOffsetX, event.screenY - dragOffsetY);
  };

  const onPointerUp = event => {
    if (!isDraggingWindow) return;
    isDraggingWindow = false;
    document.body.classList.remove('is-dragging');
    try {
      floatingControls.releasePointerCapture(event.pointerId);
    } catch {}
  };

  floatingControls.addEventListener('pointerdown', onPointerDown);
  floatingControls.addEventListener('pointermove', onPointerMove);
  floatingControls.addEventListener('pointerup', onPointerUp);
  floatingControls.addEventListener('pointercancel', onPointerUp);

  floatingControls.addEventListener('pointerenter', () => {
    if (floating && api && passthrough && !isDraggingWindow) {
      passthrough = false;
      api.setPointerPassthrough(false);
      setSpriteHovered(false);
    }
  });
}
document.addEventListener('mousemove', event => {
  avatar?.look(event.clientX, event.clientY);
  if(!api?.cursorPosition)avatar?.spriteAvatar.trackCursor({x:event.clientX,y:event.clientY});
  if (!floating || isDraggingWindow) return;
  const interactive = Boolean(event.target.closest('#floating-controls, #floating-composer, #floating-bubble, #floating-ideas-bar, #floating-awareness'));
  const next = !interactive;
  if (api && next !== passthrough) { passthrough = next; api.setPointerPassthrough(next); }
  if (interactive) {
    setSpriteHovered(false);
  } else {
    const overSprite = Boolean(avatar?.hitTest(event.clientX, event.clientY));
    if (overSprite) {
      setSpriteHovered(true);
    } else if ($('#avatar')?.classList.contains('sprite-hovered')) {
      if (!spriteHoverTimeout) {
        spriteHoverTimeout = setTimeout(() => {
          setSpriteHovered(false);
        }, 150);
      }
    }
  }
});
document.addEventListener('mouseleave', () => {
  if (!floating || isDraggingWindow) return;
  setSpriteHovered(false);
  if (api && !passthrough) {
    passthrough = true;
    api.setPointerPassthrough(true);
  }
});
$('#send').onclick = () => send();
$('#floating-send').onclick = () => send();
// Explain: Fairy answers by drawing on the screen beside what you're reading (screen ink). With text in the ring the pen
// sends it to be drawn. With an empty ring it arms Explain: the pen lights up and your next typed or spoken question is
// drawn; pressing it again with nothing typed explains what's on the screen.
function armExplain(value) {
  explainArmed = value;
  $('#floating-explain').setAttribute('aria-pressed', String(value));
  $('#floating-message').placeholder = value ? 'Explain anything… (pen again: explain the screen)' : mode === 'chat' ? 'Chat, news, or ask about your screen…' : 'Give Fairy a task…';
  radialMenu?.render?.();
}
$('#floating-explain').onclick = () => {
  if (busy) return;
  const asked = $('#floating-message').value.trim();
  if (!asked && !explainArmed) { armExplain(true); $('#floating-message').focus({ preventScroll: true }); return; }
  armExplain(false);
  if (mode !== 'chat') document.querySelector('[data-mode="chat"]').click();
  void send(asked || 'Explain what I’m looking at.', { mode: 'explain' });
};
for (const input of [$('#message'), $('#floating-message')]) {
  input.oninput = () => { noteInteraction(); setDraft(input.value); conversationTimer.defer(); if (proactiveRun || vocalRun) void stop(); };
  input.onkeydown = event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      send(undefined, event.altKey ? { steer: true } : {});
      return;
    }
    if (input.id === 'message' && event.altKey && event.shiftKey && event.key.toLowerCase() === 's') {
      event.preventDefault();
      composerStashView?.stashCurrent();
    }
  };
}
$('#floating-message').onfocus = () => { if (passthrough) { passthrough = false; api?.setPointerPassthrough(false); } };
$('#record').onclick = toggleRecording;
$('#stop').onclick = () => {
  const sid = activeSessionKey();
  if (!steeringPending || steeringPending.sessionId !== sid) composerQueue.setPaused(sid, true);
  composerQueueView?.render();
  if (workRunOnScreen()) { status('Stopping…'); api.workStop(state.sessions.active).catch(e => error(e.message)); }
  else stop();
};
$('#settings-button').onclick = openSettings; $('#close-settings').onclick = () => { if (leaveSettings()) $('#settings').close(); };
$('#settings').addEventListener('click', event => { if (event.target === $('#settings') && leaveSettings()) $('#settings').close(); });
$('#settings').addEventListener('cancel', event => { if (!leaveSettings()) event.preventDefault(); });
const voiceTraining = setupVoiceTraining({ api, root: $('#pane-voice'), name: () => state.settings.name || 'Fairy', onProfile: value => { wakeProfile = value; } });
void voiceTraining.load();
$('#settings').addEventListener('close', () => voiceTraining.cancel());
$('#settings-form').addEventListener('input', () => updateSettingsBar());
$('#settings-form').addEventListener('change', () => updateSettingsBar());
$('#settings-discard').onclick = reopenSettings;
$('#settings-close-window').onclick = () => api?.close(); $('#settings-minimize-window').onclick = () => api?.minimize();
$('#accounts-antigravity-refresh').onclick = () => void refreshAntigravity({ force: true });
$('#accounts-antigravity-switch').onclick = async () => {
  if (!api?.antigravitySwitchAccount) return;
  const btn = $('#accounts-antigravity-switch');
  const setStatus = text => { $('#antigravity-status').textContent = $('#accounts-antigravity-status').textContent = text; };
  btn.disabled = true;
  setStatus('Signing out and opening Antigravity login in Terminal…');
  try {
    const res = await api.antigravitySwitchAccount();
    setStatus(res?.message || 'Finish Google sign-in in Terminal, then click Refresh.');
  } catch (e) { setStatus(e.message); }
  finally { btn.disabled = false; }
};
$('#accounts-antigravity-logout').onclick = async () => {
  if (!api?.antigravityLogout) return;
  const btn = $('#accounts-antigravity-logout');
  const setStatus = text => { $('#antigravity-status').textContent = $('#accounts-antigravity-status').textContent = text; };
  btn.disabled = true;
  setStatus('Signing out of Antigravity…');
  try {
    const res = await api.antigravityLogout();
    await refreshAntigravity({ force: true });
    if (res?.message) setStatus(res.message);
  } catch (e) { setStatus(e.message); }
  finally { btn.disabled = false; }
};
$('#agy-check-run').onclick = async () => {
  $('#agy-check-run').disabled = true;
  try { await api.agyCheckRun(); } catch (e) { $('#agy-check-status').textContent = e.message; $('#agy-check-run').disabled = false; }
};
api?.onAgyCheck?.(renderAgyCheck);
// Long notes stay readable in place: two lines until clicked, because some describe what is sent where.
const toggleNote = note => { note.classList.toggle('is-open'); note.setAttribute('aria-expanded', String(note.classList.contains('is-open'))); };
$('.settings-panes').addEventListener('click', event => { const note = event.target.closest('.field-note.can-expand'); if (note && !event.target.closest('a,button,code')) toggleNote(note); });
$('.settings-panes').addEventListener('keydown', event => { if ((event.key === 'Enter' || event.key === ' ') && event.target.matches?.('.field-note.can-expand')) { event.preventDefault(); toggleNote(event.target); } });
function updateLocalSpeechSettings() {
  const local = $('#settings-form').elements.transcriptionProvider.value === 'apple';
  $('#local-speech-settings').hidden = !local;
  $('#settings-form').elements.transcriptionModel.closest('label').hidden = local;
}
$('#settings-form').elements.transcriptionProvider.onchange = updateLocalSpeechSettings;
$('#prepare-local-speech').onclick = async () => {
  if (!api || busy) return;
  const button = $('#prepare-local-speech'), save = $('#settings-form button[type="submit"]');
  button.disabled = save.disabled = true; $('#cancel-local-speech').hidden = false; setBusy(true);
  try {
    const result = await api.prepareLocalSpeech($('#settings-form').elements.localLanguage.value.trim());
    $('#local-speech-status').textContent = `Ready · ${result.locale.replaceAll('_', '-')} · speech is transcribed on this Mac. Save settings to use it.`;
  } catch (e) { $('#local-speech-status').textContent = e.message.replace(/Error invoking remote method '[^']+': Error: /g, ''); }
  finally { button.disabled = save.disabled = false; $('#cancel-local-speech').hidden = true; setBusy(false); }
};
$('#cancel-local-speech').onclick = () => api?.stop();
$('#pin').onclick = async () => { if (api) { pinned = await api.pin(!pinned); $('#pin').textContent = pinned ? 'Unpin window' : 'Pin window'; $('#pin').setAttribute('aria-pressed', String(pinned)); } };
document.querySelectorAll('[data-mode]').forEach(button => button.onclick = () => {
  if (busy) return; mode = button.dataset.mode;
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('selected', b === button));
  $('#mode-hint').textContent = mode === 'chat' ? `Chat naturally. Ask about your screen or the latest news.${state.settings.autoDesktop === 'on' ? ' Ask me to do something on your computer, such as opening an app or clicking a button, and I’ll do it.' : ''}` : `Shares primary-display screenshots with ${{ antigravity: 'Google', claude: 'Anthropic', codex: 'OpenAI', openai: 'OpenAI' }[state.settings.desktopBackend] || 'Google'}. ${state.settings.desktopApproval === 'always' ? 'Review every action batch.' : 'Safe actions run automatically; risky or uncertain actions ask first.'} ⌘⇧Esc stops.`;
  $('#screen-options').hidden = mode !== 'chat';
  $('#floating-message').placeholder = mode === 'chat' ? 'Chat, news, or ask about your screen…' : 'Give Fairy a task…';
  $('#floating-mode').textContent = mode === 'chat' ? 'Chat' : 'Task';
  $('#floating-mode').setAttribute('aria-label', `Current mode: ${mode === 'chat' ? 'Chat with automatic screen questions' : 'Desktop task'}. Click to switch.`);
  status('Ready when you are');
  $('#message').placeholder = mode === 'chat' ? "What's on your mind, or on your screen?" : 'e.g. Open Calculator and calculate 24 × 7';
});
$('#screen-settings').onclick = async () => { try { const result = await api?.screenSettings(); status(result === 'granted' ? 'Screen access enabled' : 'Enable Fairy in System Settings, then reopen Fairy'); } catch (e) { error(e.message); } };
// Falls back to Fairy, as browser storage can come back empty.
let currentAvatarChoice = 'fairy';
try { currentAvatarChoice = localStorage.getItem('lyra-avatar-choice') || 'fairy'; } catch {}

function updateAvatarUI(choice) {
  currentAvatarChoice = choice;
  try { localStorage.setItem('lyra-avatar-choice', choice); } catch {}

  const isClassic = choice === 'lyra';
  const isFairy = choice === 'fairy';
  const is3D = choice === 'stella';
  const isCustom = choice === 'custom';

  // Fairy and the classic sprite share the pixel-sprite renderer; only the character differs.
  if (avatar) { avatar.setCharacter(isFairy ? 'fairy' : 'robin'); void avatar.setMode(isClassic || isFairy ? 'sprite' : 'vrm').catch(e=>error(`Avatar could not load: ${e.message}`)); }
  $('#avatar-hint').hidden = true;

  const displayName = state?.settings?.name || (isClassic ? 'Fairy' : 'Fairy');
  $('#character-name').replaceChildren(document.createTextNode(displayName), Object.assign(document.createElement('span'), { textContent: '✧' }));

  const classicCard = $('#avatar-choice-lyra');
  const vrmCard = $('#avatar-choice-stella');
  const customCard = $('#avatar-choice-custom');
  if (classicCard && vrmCard && customCard) {
    classicCard.classList.toggle('active', isClassic);
    $('#avatar-choice-fairy').classList.toggle('active', isFairy);
    $('#status-choice-fairy').textContent = isFairy ? 'Active' : 'Select';
    vrmCard.classList.toggle('active', is3D);
    customCard.classList.toggle('active', isCustom);
    $('#status-choice-classic').textContent = isClassic ? 'Active' : 'Select';
    $('#status-choice-3d').textContent = is3D ? 'Active' : 'Select';
    $('#status-choice-custom').textContent = isCustom ? 'Active' : 'Import ↗';
  }
}

function openAvatarDialog() {
  updateAvatarUI(currentAvatarChoice);
  $('#avatar-dialog').showModal();
}
$('#close-avatar-dialog').onclick = () => $('#avatar-dialog').close();
$('#import-avatar').onclick = openAvatarDialog;
$('#change-avatar').onclick = openAvatarDialog;
$('#routines').disabled = !api;
$('#routines').onclick = () => routinesPopover.toggle();

// Profiles: persona settings live in the main process; avatar and animation
// switches are window preferences, applied here.
const currentAnimations = () => ({ roaming: roamingEnabled, cursorTracking: cursorTrackingEnabled, companionAnimations: companionAnimationsEnabled, reactions: reactionsEnabled });
function setToggle(id, value) { const box = $(`#${id}`); if (box.checked !== value) { box.checked = value; box.onchange(); } }
async function applyProfileLocal(profile) {
  const motion = profile.animations || {};
  setToggle('roaming-enabled', motion.roaming !== false); setToggle('cursor-tracking-enabled', motion.cursorTracking !== false);
  setToggle('companion-animations-enabled', motion.companionAnimations !== false); setToggle('conversation-reactions-enabled', motion.reactions !== false);
  try { localStorage.setItem('active-profile', profile.id); } catch {}
  updateAvatarUI(profile.avatar);
  if (['stella', 'custom'].includes(profile.avatar) && avatar && !avatar.vrm && api) {
    try { const bytes = await api.loadAvatar(); if (bytes) await avatar.load(bytes, true); } catch (e) { error(`Avatar could not load: ${e.message}`); }
  }
  const form = $('#settings-form');
  for (const [key, value] of Object.entries(state.settings)) if (key in (profile.settings || {}) && form.elements[key]) form.elements[key].value = value;
  if ($('#settings').open) markSettingsClean();
  renderProfiles(); updateState();
}
function renderProfiles() {
  let active = ''; try { active = localStorage.getItem('active-profile') || ''; } catch {}
  const select = $('#profile-select'), profiles = state?.profiles || [];
  select.replaceChildren(...profiles.map(p => Object.assign(document.createElement('option'), { value: p.id, textContent: p.id === active ? `${p.label} · active` : p.label })));
  if (profiles.some(p => p.id === active)) select.value = active;
  $('#profile-apply').disabled = $('#profile-delete').disabled = !profiles.length;
}
$('#profile-apply').onclick = async () => {
  if (!api) return;
  try { const result = await api.applyProfile($('#profile-select').value); state = result.state; await applyProfileLocal(result.profile); $('#profile-status').textContent = `Switched to ${result.profile.label}.`; }
  catch (e) { $('#profile-status').textContent = e.message; }
};
$('#profile-save').onclick = async () => {
  if (!api) return;
  try {
    const result = await api.saveProfile({ label: $('#profile-name').value, avatar: currentAvatarChoice, animations: currentAnimations() });
    state = result.state; try { localStorage.setItem('active-profile', result.profile.id); } catch {}
    $('#profile-name').value = ''; renderProfiles(); $('#profile-status').textContent = `Saved ${result.profile.label}.`;
  } catch (e) { $('#profile-status').textContent = e.message; }
};
$('#profile-delete').onclick = async () => {
  const option = $('#profile-select').selectedOptions[0];
  if (!api || !option || !confirm(`Delete the ${option.textContent.replace(/ · active$/, '')} profile? Your current settings stay as they are.`)) return;
  try { state = await api.deleteProfile(option.value); renderProfiles(); $('#profile-status').textContent = 'Profile deleted.'; }
  catch (e) { $('#profile-status').textContent = e.message; }
};

$('#avatar-choice-fairy').onclick = () => {
  updateAvatarUI('fairy');
  $('#avatar-dialog').close();
};
$('#avatar-choice-lyra').onclick = () => {
  updateAvatarUI('lyra');
  $('#avatar-dialog').close();
};

$('#avatar-choice-stella').onclick = async () => {
  updateAvatarUI('stella');
  $('#avatar-dialog').close();
  if (avatar && !avatar.vrm && api) {
    try {
      const bytes = await api.loadAvatar();
      if (bytes) await avatar.load(bytes, true);
    } catch (e) {
      error(`Avatar could not load: ${e.message}`);
    }
  }
};

$('#avatar-choice-custom').onclick = async () => {
  if (!api) { error('Load a VRM file from the desktop app.'); $('#avatar-dialog').close(); return; }
  try {
    const bytes = await api.importAvatar();
    if (bytes) {
      await avatar.load(bytes, true);
      updateAvatarUI('custom');
      $('#avatar-dialog').close();
      error('');
    }
  } catch (e) {
    error(e.message);
  }
};
let idlePreviewRunning = false;
$('#preview-idle-dialogue').onclick = async () => {
  if (idlePreviewRunning) { await stop(); return; }
  const text = $('#settings-form').elements.idleDialogueLines.value.split(/\r?\n/).map(line => line.trim()).find(Boolean);
  const note = $('#idle-preview-status'), button = $('#preview-idle-dialogue');
  if (!text || text.length > 500) { note.textContent = 'Paste a line of 1–500 characters first.'; return; }
  if (!api || busy || recorder) { note.textContent = 'Finish the current task before previewing a line in the desktop app.'; return; }
  if (state.settings.voiceProvider === 'off') { note.textContent = 'Choose and save a voice provider first.'; return; }
  const token = ++generation;
  idlePreviewRunning = true; setBusy(true); conversationTimer.defer(); vocalTimer.defer();
  button.textContent = 'Stop preview'; note.textContent = 'Preparing your saved voice…';
  try {
    spokenReply = text;
    const bytes = await api.speak(text);
    if (token === generation) { note.textContent = text; await play(bytes, token); }
    note.textContent = token === generation ? 'Preview finished. Save settings to use these lines during quiet moments.' : 'Preview stopped.';
  } catch (e) { if (token === generation) note.textContent = e.message; }
  finally { idlePreviewRunning = false; setBusy(false); button.textContent = 'Preview first line'; conversationTimer.defer(); vocalTimer.defer(); status('Ready when you are'); }
};
const VOICE_TEST = 'This is how loud I’ll sound. Move the slider until it feels right.';
let voiceTestRunning = false;
$('#test-voice-volume').onclick = async () => {
  if (voiceTestRunning) { await stop(); return; }
  const note = $('#voice-volume-status'), button = $('#test-voice-volume'), slider = $('#settings-form').elements.voiceVolume;
  if (!api || busy || recorder) { note.textContent = 'Finish the current task before testing her voice in the desktop app.'; return; }
  if (muted()) { note.textContent = 'Fairy is muted, so you wouldn’t hear this. Unmute her first.'; return; }
  if (state.settings.voiceProvider === 'off') { note.textContent = 'Choose and save a voice provider first.'; return; }
  const token = ++generation;
  voiceTestRunning = true; setBusy(true); conversationTimer.defer(); vocalTimer.defer();
  button.textContent = 'Stop test'; note.textContent = 'Preparing her voice…';
  try {
    spokenReply = VOICE_TEST;
    const bytes = await savedSpeech(VOICE_TEST);
    if (token === generation) { note.textContent = 'Move the slider to change it while she speaks.'; await play(bytes, token); }
    note.textContent = token === generation && slider.value !== state.settings.voiceVolume ? 'Save settings to keep this volume.' : '';
  } catch (e) { if (token === generation) note.textContent = e.message; }
  finally { voiceTestRunning = false; setBusy(false); button.textContent = 'Test volume'; conversationTimer.defer(); vocalTimer.defer(); status('Ready when you are'); }
};
let settingsSavedTimer;
$('#settings-form').onsubmit = async event => {
  event.preventDefault();
  if (!api) { $('#settings-error').textContent = 'Run npm start to save settings in the desktop app.'; $('#settings-error').hidden = false; updateSettingsBar(); return; }
  // The form skips native validation because an invalid field may be in a hidden pane.
  const invalid = event.target.querySelector(':invalid');
  if (invalid) { showSettingsPane(invalid.closest('.settings-pane').dataset.pane); invalid.reportValidity(); return; }
  const data = Object.fromEntries(new FormData(event.target));
  data.clearopenaiKey = event.target.elements.clearopenaiKey.checked;
  data.clearfishKey = event.target.elements.clearfishKey.checked;
  data.cleardeepseekKey = event.target.elements.cleardeepseekKey?.checked;
  data.cleargeminiKey = event.target.elements.cleargeminiKey?.checked;
  const WALLPAPER_KEYS = new Set(['windowWallpaper', 'wallpaperMotion', 'wallpaperReactive', 'wallpaperDim']);
  const baseline = Object.fromEntries(JSON.parse(settingsBaseline || '[]'));
  const changedKeys = [...new Set([...Object.keys(data), ...Object.keys(baseline)])].filter(k => (k.startsWith('clear') && k.endsWith('Key') ? data[k] === true : String(data[k] ?? '') !== String(baseline[k] ?? '')));
  const onlyWallpaper = Boolean(state.remote) && changedKeys.length > 0 && changedKeys.every(k => WALLPAPER_KEYS.has(k));
  const saveCall = onlyWallpaper
    ? api.setWallpaper({ windowWallpaper: data.windowWallpaper, wallpaperMotion: data.wallpaperMotion, wallpaperReactive: data.wallpaperReactive, wallpaperDim: data.wallpaperDim })
    : api.saveSettings(data);
  try { state = await saveCall; ambient = state.awareness; listenFault = ''; updateState(); document.querySelector(`[data-mode="${mode}"]`).click(); reopenSettings(); updateSettingsBar(true); clearTimeout(settingsSavedTimer); settingsSavedTimer = setTimeout(() => { if ($('#settings').open) updateSettingsBar(); }, 1800); error(''); await syncListening(); }
  catch (e) { $('#settings-error').textContent = e.message; $('#settings-error').hidden = false; updateSettingsBar(); }
};
async function startNewChat() {
  showSession(await api.sessionNew()); status('New chat');
}
$('#sidebar-new-chat').onclick = async () => {
  if (!api) return;
  try { await startNewChat(); $('#message').focus(); } catch (e) { error(e.message); }
};
try { avatar = new Avatar($('#avatar')); updatePose(); updateAvatarUI(currentAvatarChoice); } catch { error('3D rendering is unavailable. Conversation still works.'); }
// Screen ink: where the floating eye is (main asks, so the pen starts and ends on it), and Fairy turning into the pen
// to draw ('out') and back ('in'), in pixel steps.
window.fairyEyeAnchor = () => { const a = floating && avatar?.mode === 'sprite' ? avatar.spriteAvatar.menuAnchor() : null; return a ? { x: a.x, y: a.y } : null; };
// A quiz's "more like this" asks again from here, as an Explain turn.
// Quicker ways to ask. Holding ⌃⌥ records like the mic button and, when let go, hands what was heard to main, which
// knows whether something was circled and whether the companion is the one asking; typed and heard questions come back
// through onQuickAsk.
let quickTalking = false;
api?.onQuickTalk?.(({ phase } = {}) => {
  if (phase === 'start') { if (!recorder && !busy && !state.sessions?.work) { quickTalking = true; void toggleRecording(); } }
  else if (!quickTalking) return;
  else if (phase === 'stop') { if (recorder) recorder.stop(); else quickTalking = false; }
  else { quickTalking = false; if (recorder) void stop(); }
});
api?.onQuickAsk?.(({ text, mode } = {}) => { if (!busy && typeof text === 'string' && text.trim()) void send(text.trim(), mode === 'explain' ? { mode: 'explain' } : {}); });
api?.onInkAsk?.(text => { if (!busy && typeof text === 'string') void send(text, { mode: 'explain' }); });
let eyeMorph = null;
api?.onInkMorph?.(phase => {
  const canvas = avatar?.mode === 'sprite' ? avatar.spriteAvatar.canvas : null;
  if (!canvas || !floating) return;
  const anchor = avatar.spriteAvatar.menuAnchor(), rect = canvas.getBoundingClientRect();
  canvas.style.transformOrigin = `${anchor.x - rect.left}px ${anchor.y - rect.top}px`;
  // Out: a pulse, then she squashes into a glowing ball that bursts into the pen. In: she grows back out of it.
  const out = [{ transform: 'scale(1)', opacity: 1, filter: 'brightness(1)' }, { transform: 'scale(1.12)', opacity: 1, filter: 'brightness(1.3)', offset: 0.2 }, { transform: 'scale(0.4)', opacity: 1, filter: 'brightness(2.4) saturate(1.4)', offset: 0.65 }, { transform: 'scale(0)', opacity: 0, filter: 'brightness(3)' }], back = [{ transform: 'scale(0)', opacity: 0, filter: 'brightness(3)' }, { transform: 'scale(0.4)', opacity: 1, filter: 'brightness(2.4) saturate(1.4)', offset: 0.35 }, { transform: 'scale(1.12)', opacity: 1, filter: 'brightness(1.3)', offset: 0.75 }, { transform: 'scale(1)', opacity: 1, filter: 'brightness(1)' }];
  eyeMorph?.cancel();
  eyeMorph = canvas.animate(phase === 'out' ? out : back, { duration: phase === 'out' ? 380 : 440, easing: 'steps(8, end)', fill: phase === 'out' ? 'forwards' : 'none' });
});
if(avatar){avatar.spriteAvatar.animationsEnabled=companionAnimationsEnabled;avatar.spriteAvatar.animationAllowed=companionAllowed;}
if(avatar && api?.walkStart){
  walkController=new WalkingAnimation({api,eligible:walkingEligible,display:value=>{avatar.spriteAvatar.setWalking(value);$('#avatar').dataset.walking=value?(value.direction>0?'right':'left'):'off';}});
  avatar.spriteAvatar.onFrame=dt=>walkController.tick(dt);
}
if(avatar){
 const sprite=avatar.spriteAvatar;sprite.cursorTrackingEnabled=cursorTrackingEnabled;
 sprite.cursorAllowed=()=>companionAllowed(true);sprite.reactionsEnabled=reactionsEnabled;sprite.reactionAllowed=()=>companionAllowed(true,true);
 if(api?.cursorPosition){
  const sampler=new CursorSampler({interval:()=>ambient.power?.level>0?.2:.1,read:()=>api.cursorPosition(),eligible:()=>sprite.cursorEligible(),update:point=>sprite.trackCursor(point)});
  sprite.cursorSampler=sampler;sprite.onFrame=dt=>{walkController?.tick(dt);sampler.tick(dt);};
 }
}
async function init() {
  if (api) {
    state = await api.state();
    var startupState = Math.round(performance.now());
    pagesPane.update(state.artifacts, () => {}); sessionList.update(state.sessions); syncWorkSession(); agentSwarmView.syncSession(); sidePane.restore(state.sessions?.pane);
    // First launch after the Fairy rebrand: keep today's companion as a profile, then switch.
    const rebrand = await api.rebrandProfiles?.({ avatar: currentAvatarChoice, animations: currentAnimations() }).catch(() => null);
    if (rebrand) { state = { ...state, ...rebrand.state }; await applyProfileLocal(rebrand.profile); }
    quizInfo = state.quiz;
    api.onQuiz(value => { quizInfo = value; updateAwareness(); updateIdeas(); });
    meetingPanel.update(state.meeting);
    api.onGpuRestarted?.(() => restartWallpaperVideo(document.documentElement));
    approvalTray({ api, onError: text => error(text) });
    $('#approvals-show')?.addEventListener('click', () => drawApprovalLog($('#approvals-log'), api));
    let meetingOpenRev = null;
    api.onMeeting(value => {
      // The Meeting panel opens itself when a meeting starts and when its summary is being written,
      // unless you manually closed or switched the side pane since the meeting started.
      const before = meetingPanel.state; meetingPanel.update(value);
      const started = !meetingActive(before) && meetingActive(value), summarising = value.summary?.status === 'writing' && before.summary?.status !== 'writing';
      const sid = activeSessionKey();
      if (!floating && started) {
        meetingOpenRev = sidePane.getUserActionRevision?.(sid);
        sidePane.openProactive('meeting', { sessionId: sid, expectedRevision: meetingOpenRev });
      } else if (!floating && summarising) {
        sidePane.openProactive('meeting', { sessionId: sid, expectedRevision: meetingOpenRev });
      } else if (sidePane.isOpen('meeting')) sidePane.refresh();
    });
    api.onSettings?.(value => { state.settings = value; updateState(); updateIdeas(); void syncListening(); });
    api.onMeetingToggle?.(() => $('#meeting-toggle').click());
    unsubscribeMicToggle = api.onMicToggle?.(() => toggleHandsFree(undefined, true));
    unsubscribeSizeToggle = api.onSizeToggle?.(toggleFloatingSize);
    ambient = state.awareness;
    avatar?.setPower(ambient.power); avatar?.setAwake(ambient.awake); syncUnseen();
    api.onAwareness(value => {
      const previousPower = ambient.power; ambient = value; syncUnseen();
      if(!value.awake || value.paused || value.power?.optional===false)walkController?.cancel();
      avatar?.setPower(value.power); avatar?.setAwake(value.awake);
      if(previousPower?.level!==value.power?.level){
        conversationTimer.configure(Number(state.settings.proactiveMinutes) * (value.power?.ideaMultiplier || 1));
        conversationTimer.defer(); playbackIndicator.next=Date.now()+(value.power?.playbackMs||15000);
        if(value.power?.optional===false && (proactiveRun||vocalRun))void stop();
      }
      updateIdeas(); requestBackgroundSync();
      if (!value.awake || value.paused) { voiceGate.close(); echoUntil = Date.now() + 1500; if(value.paused && (busy || audio || recorder))void stop({keepQuiz:true}); }
      void syncListening(); updateAwareness();
    });
    for (let i = state.history.length - 1; i >= 0 && state.history[i].role !== 'user'; i--) if (state.history[i].mode === 'proactive') conversationTimer.unanswered++;
    for (const display of state.displays || []) if (!display.primary) { const option = document.createElement('option'); option.value = String(display.id); option.textContent = display.label; $('#screen-display').append(option); }
    if (state.credentialWarning) error(state.credentialWarning);
    api.onDesktopActive(value => document.documentElement.classList.toggle('desktop-working', value));
    api.onSpriteHidden?.(applySpriteHidden);api.onCompanionHidden?.(applyCompanionHidden);applyCompanionHidden(Boolean(state.companionHidden));
    api.onProgress(status); api.onStop(stop); 
    // Away 3: open on the face's Mac, what only the other Mac can do is disabled, saying so.
    if (applyRemote(state)) watchLink(api);
    api.onQuiet(() => {
      conversationTimer.defer();
      if (proactiveRun || vocalRun) { void stop(); return; }
      // A page carries on while you step away. Anything else asked for you stops, and says why.
      if (!ambient.awake && activeRequestMode !== 'page') { const asked = Boolean(activeRequestMode); void stop(); if (asked) error('Stopped because your Mac locked or went to sleep.'); }
    });
    if (avatar && !['lyra', 'fairy'].includes(currentAvatarChoice)) {
      const bytes = await api.loadAvatar();
      if (bytes) {
        try {
          const autoSwitch = (currentAvatarChoice === 'stella' || currentAvatarChoice === 'custom');
          await avatar.load(bytes, autoSwitch);
          if (['lyra', 'fairy'].includes(currentAvatarChoice)) avatar.setMode('sprite');
          $('#avatar-hint').hidden = true;
        } catch (e) {
          if (!['lyra', 'fairy'].includes(currentAvatarChoice)) error(`Avatar could not load: ${e.message}`);
        }
      }
    }
  }
  initialized = true; updateState(); activityPopover?.refresh(); if (api) { api.startupUsable?.({ script: startupScript, state: startupState, usable: Math.round(performance.now()) }); void refreshClaude(); void refreshSubscription(); await syncListening(); } if (!api) status('Interface preview · launch with npm start');
  let setupCompleted = false;
  try { setupCompleted = localStorage.getItem(SETUP_STORAGE_KEY) === 'done'; } catch {}
  if (api && shouldAutoOpenSetup({ completed: setupCompleted, hasSessions: Boolean(state.sessions?.sessions?.length), conversationReady: conversationReady(), floating })) {
    void openSetupWizard();
  }
}
const playbackIndicator = new PlaybackIndicator({api,interval:()=>ambient.power?.playbackMs || 15000,
  allowed: () => ambient.power?.playbackMs !== 0 && !unseen() && initialized && Boolean(api) && !state.companionHidden && ambient.awake && !ambient.paused && !document.hidden && (state.settings.pixelEffects !== 'off' || companionAnimationsEnabled),
  onChange: playing => avatar?.setMusicPlaying(playing),
});
const ideaTask=new ConditionalTask({enabled:()=>!ideasBlocked() && conversationTimer.unanswered<2,
  delay:()=>Math.max(0,conversationTimer.nextAt-Date.now()),run:()=>startTopic()});
const vocalTask=new ConditionalTask({enabled:()=>!vocalsBlocked(),
  delay:()=>Math.max(0,Math.max(vocalTimer.nextAt,vocalTimer.lastAttempt+vocalTimer.minutes*60000)-Date.now()),run:()=>automaticVocal()});
const playbackTask=new ConditionalTask({enabled:()=>playbackIndicator.allowed(),
  delay:()=>Math.max(0,playbackIndicator.next-Date.now()),run:()=>playbackIndicator.tick()});
let ideasWereBlocked=true,vocalsWereBlocked=true,playbackWasAllowed=false;
backgroundSync=()=>{
  syncUnseen();syncWallpaper();
  avatar?.setBackground(!floating && !document.hasFocus());
  updateAwareness(false);
  const ideasAreBlocked=Boolean(ideasBlocked()),vocalsAreBlocked=Boolean(vocalsBlocked());
  if(ideasAreBlocked!==ideasWereBlocked)conversationTimer.defer();
  if(vocalsAreBlocked!==vocalsWereBlocked)vocalTimer.defer();
  ideasWereBlocked=ideasAreBlocked;vocalsWereBlocked=vocalsAreBlocked;
  const playbackAllowed=playbackIndicator.allowed();
  if(playbackAllowed!==playbackWasAllowed)playbackIndicator.reset();
  playbackWasAllowed=playbackAllowed;
  ideaTask.sync(true);vocalTask.sync(true);playbackTask.sync(true);
};
// User events and dialog-open changes replace the permanent status UI poll.
const onUIState=()=>{updateAwareness();requestBackgroundSync();todayController.syncBackground();};
for(const event of ['click','input','change','close','toggle'])document.addEventListener(event,onUIState,true);
document.addEventListener('visibilitychange',onUIState);
const dialogObserver=new MutationObserver(onUIState);
dialogObserver.observe(document.body,{subtree:true,attributes:true,attributeFilter:['open']});
document.addEventListener('fairy:spotify-change',()=>{playbackIndicator.reset();requestBackgroundSync();});
requestBackgroundSync();
window.addEventListener('beforeunload', () => { try{walkController?.cancel();}catch{}rendererDisposed=true;unsubscribeMicToggle?.();unsubscribeSizeToggle?.();clearTimeout(micFeedbackTimer);clearTimeout(awarenessDeadline);clearTimeout(spriteHoverTimeout);
  for(const task of [ideaTask,vocalTask,playbackTask,todayController])task.dispose();dialogObserver.disconnect();
  try{playbackIndicator.reset();}catch{} try{avatar?.dispose();}catch{}
  generation++;activeVoiceQueue?.cancel();stopAudio();void handsFree.dispose();
  clearTimeout(recordingTimeout);if(recorder){recorder.onstop=recorder.ondataavailable=null;if(recorder.state!=='inactive')recorder.stop();recorder=null;}
  stream?.getTracks().forEach(track=>track.stop());stream=null;
  if(audioContext){void audioContext.close().catch(()=>{});audioContext=null;} });
init().catch(e => error(e.message));
