# Vorssaint × Baryon Integration Plan — Native OS Body & Living Notch

> **Status:** All Phases 0–6 implemented and deployed (`vorssaint-utils` at `~/Github/Applications/vorssaint-utils`, `baryon-integration` branch, bundled as `baryon-vorssaint` inside `Baryon.app`).
> **Guiding split:** **Baryon / Fairy** stays the cognitive brain, conversations, work agent, notebooks, research, analytics, goals, and iOS/mini bridge; **Vorssaint** stays the stripped-down, high-signal native Swift/AppKit/SwiftUI OS body & reflexes (`CoreAudioTapCompat`, `HIDEventSystem`, `VMStatisticsCompat`, `CGEventTap`, `ScreenCaptureKit`, Accessibility, Dynamic Island, Teleprompter, Command Bar + AI Launcher, Radial Menu, Shelf, Window Layout, Stratus System Monitor).

---

## 1. Architecture & Dual-Mac Topology

Instead of porting Vorssaint's Swift OS modules into Electron/JS, **Vorssaint compiles via SwiftPM as a debloated, signed native helper** embedded inside `Baryon.app` and communicates with Baryon over a local, user-only Unix domain socket (`vorssaint.sock`, mode `0600`), extending Baryon's existing native-link pattern (`desktop/chat-link.mjs`, `tachyon.sock`, `flux.sock`, `electron.sock`, `cli.sock`).

```
┌─────────────────────────────────────────────────────────────────────────┐
│ MacBook (or single-Mac install)                                         │
│                                                                         │
│  ┌──────────────────────────────┐  vorssaint.sock  ┌─────────────────┐  │
│  │ VorssaintHelper (SwiftPM)    │ ◄── NDJSON ────► │ Baryon Electron │  │
│  │ • Dynamic Island + Teleprmp  │     (0600)       │ (face or full)  │  │
│  │ • 120Hz Drag-Orb NSPanel     │                  │ • Pre-warmed    │  │
│  │ • Command Bar + AI Launcher  │                  │   companionWin  │  │
│  │ • Hadron Tasks/Notes + iCloud│                  │ • GCal Bridge   │  │
│  │ • Stratus SysMon + Mixer     │                  │ • Settings Hub  │  │
│  └──────────────┬───────────────┘                  └────────┬────────┘  │
└─────────────────┼───────────────────────────────────────────┼───────────┘
                  │ Local/iCloud Files                        │ Tailscale
                  ▼                                           ▼ (face↔mini)
┌─────────────────────────────────┐  ┌────────────────────────────────────┐
│ Hadron (dev.flux.browser) & iCl │  │ Mac mini ("Brain" — main.cjs)      │
│ • todos.json (atomic LWW sync)  │  │ • LLM turns (Claude/Gemini/Codex)  │
│ • md-notes/*.md ↔ CloudDocs     │  │ • Notebooks · Research · Goals     │
└─────────────────────────────────┘  └────────────────────────────────────┘
```

### Key Architectural Decisions
1. **Separate Helper Process over `vorssaint.sock`**:
   - Keeps Vorssaint's `GPL-3.0-or-later` Swift package cleanly isolated as a separate executable talking over a documented JSON protocol.
   - Prevents AppKit/SwiftUI `CGEventTap`, Accessibility, and `ScreenCaptureKit` loops from stalling Chromium/Node event loops.
   - Works identically standalone or in `face` (`desktop/face-main.cjs`) ↔ `mini` (`desktop/main.cjs`) mode: Vorssaint runs **locally on the Mac in front of you** (MacBook), so the Notch, Teleprompter, Window Manager, Mixer, Screenshot, Command Bar, AI Launcher, and Stratus System Monitor act on your active screen while Fairy's intelligence & Google Calendar data route transparently over the face↔mini link.
2. **Modular Permissions (`FeatureCatalog`)**: Preserves Vorssaint's *install/enable only what you use* layer (`Sources/Vorssaint/Core/FeatureCatalog.swift`) for kept features so macOS permissions are requested only for subsystems you switch on.

---

## 2. Coexistence Guardrails (Day-1 Safety Fixes)

Before enabling Vorssaint alongside Baryon permanently (addressing conflicts noted in `docs/fairy-status-and-plan.html`), enforce automatic defaults in Vorssaint:

- **`AutoQuit` Exclusion / Removal**: Exempt `dev.razeen.lyra` (`Baryon.app`)—and `dev.flux.browser` (`Hadron.app`)—from any auto-quit behavior (or remove `AutoQuit` cleanly in the Debloat pass), because Face companion windows stay invisible while Fairy rides the pointer or lives in the notch.
- **Per-App Audio Mixer Exclusion**: Protect `dev.razeen.lyra` and its audio helpers from inadvertent muting/attenuation in `Sources/Vorssaint/Services/Audio/` (except intentional *Meeting* mode rules), fixing the issue where Vorssaint's mixer cut out Fairy's TTS voice.
- **`QuitProtection` De-confliction**: Exempt `dev.razeen.lyra` from `Sources/Vorssaint/Services/QuitProtection/` (or prune it for Baryon) so `desktop/quit-hold.cjs` remains the single ⌘Q hold-to-quit handler inside Baryon.

---

## 3. Phased Implementation Plan (Phases 0–6)

### Phase 0 — Repo Setup, Debloat Audit & Coexistence Guardrails (`vorssaint-utils` + `Baryon`)
- **Local repo:** `/Users/razeenwasif/Github/Applications/vorssaint-utils` (upstream `0f0fdd91`, Swift 6.4.2).
- **Build & supervisor pipeline:**
  - Add `scripts/build-vorssaint.mjs` (`swift build -c release`, Developer ID `C63K728GC6` + `Resources/Vorssaint.entitlements`).
  - Add `desktop/vorssaint-bridge.mjs` mirroring `desktop/process-audit-token.mjs` orphan cleanup + exponential backoff restart, communicating on `<userData>/vorssaint.sock` (or `<userData>/face/vorssaint.sock` in Face mode).
- **Debloat Audit & Pruning Matrix (`FeatureCatalog.swift`):**
  Strip standalone bloat, redundant helpers, and unused tools from `vorssaint-utils` before deep feature work (compile-time removal of Swift sources/views + localization cleanup; user confirms exact Keep/Cut choices before deletion):

  | Category | **Keep (Core Body & Integration Targets)** | **Candidate Cuts (Debloat / Prune)** |
  | --- | --- | --- |
  | **Shell & Repo Bloat** | Core Swift targets (`Vorssaint`, `CoreAudioTapCompat`, `HIDEventSystem`, `VMStatisticsCompat`, `RecorderGIFCodec`), `en.lproj` | Standalone updater/Sparkle-style release flows (`AppUpdates`, `Services/Update/`), Feedback window, BuyMeACoffee/Sponsors/Intro views, `SelfUninstall` + `Uninstall/`, 15 unused `.lproj` localizations (`de`, `es`, `fr`, `it`, `ja`, `ko`, `pt-BR`, `ru`, `sk`, `tr`, `uk`, `zh-*`), unused `ReleaseAssets/*.mp4` |
  | **Dynamic Island** | `notch`, `notchCalendar` (GCal), `notchNotifications`, `notchGestures`, `notchTimer`, `notchLyrics`, `notchLiveEqualizer`, `notchAgents`, `notchMascot`, **new `notchTeleprompter`**, **new `notchTasks`** | `notchDownloads`, `notchQueue`, `notchAccessories`, `notchWatch`, `notchMirror` (unless desired for camera preview) |
  | **Command Bar, Capture & Productivity** | `commandBar` (+ AI Launcher), `radialMenu`, `shelf`, `clipboardHistory`, `pastePlain`, `scratchpad` (Hadron/iCloud synced), `screenshot`, `screenOCR`, `screenRecorder`, `cameraPreview`, `textSnippets`, `quickToggles`, `portManager`, `killProcess`, `quickLauncher` | `wallpaper` (Baryon owns wallpapers), `cleaningMode`, `diskImageInstaller`, `urlCleaner`, `finderCutPaste`, `finderRename`, `appUpdates`, `homebrew`, `uninstaller`, `cleaner`, `mediaTools`, `quitApps`, `colorPicker` (optional keep) |
  | **Windows, Dock, Sound & Display** | `switcher`, `dockPreview`, `windowMaximizer`, `windowLayout`, `mixer`, `soundOutputSwitcher`, `audioPriority`, `micMute`, `keepAwake`, `brightness`, `extraBrightness` | `autoQuit`, `dockClick`, `spacesOrder`, `musicBlock`, `bluetoothSleep`, `quitWindowProtection` (Baryon already has `quit-hold.cjs`), redundant input tweaks (`scrollInverter`, `scrollHorizontal`, `scrollZoom`, `focusFollowsMouse`, `smoothScroll`, `linearScroll`, `scrollSpeed`, `mouseAcceleration`, `mouseNavigation`, `mouseButtonShortcuts`, `middleClick`, `mouseClickDebounce`, `keyboardDebounce`, `superKey`) |
  | **System Monitor** | `monitorCPU`, `monitorGPU`, `monitorMemory`, `monitorNetwork`, `monitorDisk`, `monitorPower`, `fanControl` (all redesigned in Stratus UI) | `connectedDevices` (optional keep) |

### Phase 1 — `vorssaint.sock` Bridge, Fairy in the Dynamic Island & Notch Teleprompter
Extend `desktop/chat-link.mjs` patterns into a bidirectional NDJSON protocol (`desktop/vorssaint-link.mjs` + `Sources/Vorssaint/Services/Baryon/BaryonBridgeService.swift`):

| Direction | Message `type` | Purpose |
| --- | --- | --- |
| Baryon ↔ Vorssaint | `hello` / `hello.ack` | Handshake: `Baryon`, role (`full`/`face`), active mode, kept `FeatureCatalog` keys |
| Baryon → Vorssaint | `fairy.state` | Live state: `{ state: 'idle'\|'listening'\|'thinking'\|'speaking'\|'working'\|'approval'\|'quiz', title, subtitle, progress, audioLevel, model }` |
| Baryon ↔ Vorssaint | `fairy.approval` / `fairy.approvalDecision` | Interactive work/Goal approval cards in the Notch (`allow` / `deny` / `inspect`) |
| Baryon ↔ Vorssaint | `fairy.ask` / `fairy.text` / `fairy.done` / `fairy.stop` | Text, clipboard, capture, selected text, or shelf drop → Fairy reply stream |
| Vorssaint ↔ Baryon | `fairy.undock` / `fairy.dockHover` / `fairy.dock` | Coordinates, velocity & proximity for seamless Notch ↔ Floating Companion transitions |
| Baryon → Vorssaint | `vorssaint.calendarEvents` | Synchronized Google Calendar agenda & join links (`desktop/calendar.mjs`) |
| Vorssaint ↔ Baryon | `vorssaint.todos` | Hadron `todos.json` delta sync & "Promote to Goal" actions |
| Vorssaint ↔ Baryon | `vorssaint.notesSync` | Hadron `md-notes` / iCloud / Scratchpad sync status & promote-to-Baryon actions |
| Vorssaint ↔ Baryon | `vorssaint.teleprompter` | Load script from Chat/Tutor/Notes, start/pause, or stream word-match scroll ticks |
| Vorssaint ↔ Baryon | `vorssaint.aiLaunch` | Open Ghostty/Tachyon CLI in folder, launch Trio, or jump to Baryon mode |
| Baryon ↔ Vorssaint | `vorssaint.tool` / `vorssaint.toolResult` / `vorssaint.preset` / `vorssaint.alert` / `vorssaint.usage` | Approval-gated Mac OS tools, mode presets, smart monitor alerts & unified token usage |

- **Fairy in the Dynamic Island (`NotchMascotView.swift`):** Add `NotchMascotLook.fairy` (Core Animation luminous `#3e5aec` iris reacting to speech `audioLevel`, thinking/Swarm orbit ticks, amber approval pulses, cursor/typing eye tracking) + Notch work/Goal Approval Pills + unified Quiz status pill (while **preserving the paired Baryon + Fairy menu bar icon** in `native/QuizOverlay.swift` / `assets/tray/trayPairTemplate*.png` specifically for Quiz mode).
- **Notch Teleprompter (`Sources/Vorssaint/UI/Notch/NotchTeleprompterView.swift` + `NotchTeleprompterService.swift`):**
  - Renders directly centered under the MacBook camera cutout so your eyes naturally look at the webcam lens while reading.
  - Hard-configured with `NSWindow.sharingType = .none` so it is **100% invisible on Zoom/Meet screen shares, QuickTime, and OBS recordings**.
  - **Sources:** Pull text directly from Clipboard, any Scratchpad / Hadron `.md` note, or ask Fairy (*"Write a 60s pitch and load in Teleprompter"*).
  - **Controls:** Adjustable width/height/opacity, font size, mirror toggle, smooth 60/120Hz cadence scroll (`100–240 WPM`), keyboard controls (`Space` play/pause, `↑`/`↓` speed, `←`/`→` nudge).
  - **Optional Voice-Paced Auto-Scroll:** Stream lightweight on-device transcript deltas from Apple Speech / `fairy-transcribe` so the prompter tracks the exact sentence you are speaking and pauses automatically when you ad-lib.

### Phase 2 — Fluid Notch ↔ Floating Companion Drag-Out & Re-Dock Gesture
Make pulling Fairy out of the Dynamic Island onto the desktop—and docking her back in—feel like one continuous 120Hz native macOS physics interaction:

1. **Stage 1 · Elastic Liquid-Glass Tether (`0–70 pt` downward pull)** (`NotchWindowHost.swift` + `NotchMascotView.swift`):
   - Pressing & dragging downward on Fairy inside the notch draws a GPU `CAShapeLayer` metaball/bezier neck stretching from the island silhouette into a droplet cradling Fairy's eye. Her iris scales (`1.0 → 1.35×`), tilts with horizontal velocity `vx`, and intensifies its halo. Releasing before `70 pt` snaps cleanly back via `CASpringAnimation`.
2. **Stage 2 · Haptic Snap Detach & 120Hz Native Drag-Orb (`> 70 pt`)**:
   - Crossing `70 pt` triggers `NSHapticFeedbackManager.defaultPerformer.perform(.alignment, performanceTime: .now)` and breaks the tether:
     - The notch silhouette recoils upward into a subtle ghost slot (*"Out on desktop · Drag back to redock"*).
     - Vorssaint shows a frameless, non-activating transparent Swift `NSPanel` (`140×140 pt`, `screenSaver` level, `ignoresMouseEvents = true`) running `NotchMascotRig` at full display refresh rate (120Hz ProMotion) with subtle pointer inertia. Pressing `Esc` cancels cleanly.
3. **Stage 3 · Zero-Lag Handoff to Pre-Warmed Electron `companionWindow`**:
   - Keep `companionWindow` (`290×296` frameless transparent `BrowserWindow` in `desktop/main.cjs` & `desktop/face-main.cjs`) pre-warmed at `opacity = 0` so Chromium never pays window creation lag.
   - On mouse-up, Vorssaint sends `fairy.undock { x, y, vx, vy, displayId }`. Baryon maps Cocoa bottom-left coords → Electron top-left display coords, aligns `companionWindow`'s `.companion-eye` center pixel-for-pixel under the Swift orb, runs a `240 ms` spring bloom (`scale(0.38) → 1.0`) + slight velocity settle (`desktop/glide.cjs`), and signals the Swift orb to crossfade out over `120 ms`. Floating Fairy is live with Quick Chat, Voice, Ink overlay, and Approvals intact.
4. **Stage 4 · Magnetic Re-Dock Back Into the Notch**:
   - Dragging `companionWindow` into the top-center magnetic zone (`±110 pt × 85 pt` around the display's real or simulated notch) sends `fairy.dockHover { active: true, proximity }` → Notch expands with a glowing `#3e5aec` magnetic ring. Releasing sends `fairy.dock` → `companionWindow` shrinks & glides into the notch over `200 ms`, hides back to standby, and `NotchMascotRig` plays a spring settle bounce.
   - *Reduce Motion fallback:* clean `150 ms` crossfade without elastic stretch/bloom.

### Phase 3 — Everywhere Context Flows + `AI Launcher` Integration
- **Integrate `AI Launcher` into Vorssaint (`Sources/Vorssaint/Services/CommandBar/AILauncherCatalog.swift` + Notch Strip):**
  - Port the catalogue and behaviors from `mini:/Users/razeenwasif/Development/AILauncher/Sources/AILauncher.swift`:
    - Desktop apps: Claude, Claude Science, ChatGPT Codex, Gemini (Antigravity), DeepSeek Harness, Grok Bot, Kimi, plus Baryon.
    - Terminal CLI agents (`claude`, `codex`, `gemini`) opened directly in Ghostty / Tachyon / Terminal inside a persisted working folder (`~/Github` / selected project).
  - Bind **`⌃⌥A`** (configurable so it plays nicely alongside Baryon quick keys) or open from Command Bar + Notch Quick Access with **`⌘1–⌘0` instant launch**, **`⌘↩` Research Trio** (`claude` + `codex` + `gemini`), and inline folder picker — retiring standalone `AI Launcher.app`.
- **Notch & Shelf Drag-and-Drop (`Services/Shelf/`):** Dropping files, screenshots, PDFs, or URLs onto Shelf/Notch offers **Ask Fairy**, **Add to Notebook**, **Turn into Goal**, **Profile in Analytics**, and **Attach to Active Chat**.
- **Command Bar Fairy Mode (`Services/CommandBar/`):** Prefixing `?` (or fallback *Ask Fairy*) streams replies inline via `fairy.ask` with **Continue in Chat →**; index Baryon's recent chats, skills, notebooks, and active Goals right alongside apps/clipboard/snippets.
- **Radial Menu + `SelectedTextReader` (`Services/RadialMenu/`, `Services/SelectedTextReader.swift`, `Services/TransientPaste.swift`):** Add cursor wheel **Fairy** slice (*Explain*, *Rewrite & Paste*, *Save Memory*, *Make Flashcard*, *Send to Work Session*).
- **Screenshot & Scrolling Capture → Ask Fairy (`UI/Screenshot/ScreenshotEditorView.swift`):** Add **Ask Fairy** button sending annotated PNG + offline OCR text to Fairy vision, and optionally share Vorssaint's `ScreenCaptureKit` capture stream for Quiz mode.
- **Clipboard Transforms (`Services/Clipboard/`):** AI actions (*Summarize*, *Fix Grammar*, *Format JSON*, *Draft Reply*) on clipboard history items with direct paste-back.

### Phase 4 — Ecosystem Sync: Google Calendar, Hadron Tasks/Todos & Hadron + iCloud Notes
- **Google Calendar → Vorssaint Notch Calendar:**
  - Pipe Baryon's already-authenticated Google Calendar (`desktop/google-account.mjs` + `desktop/calendar.mjs`) to Vorssaint over `vorssaint.sock` (`vorssaint.calendarEvents`, refreshed on timer + Today changes).
  - Update `NotchCalendarView.swift`, `NotchCalendarMonthView.swift`, and `NotchCalendarStrip.swift` to merge/replace Apple EventKit with rich Google Calendar events (calendar color chips, countdown pills *"In 18 min"*, one-click Meet/Zoom join buttons, offline JSON cache, and zero separate OAuth or Calendar permission needed if Google Calendar is sufficient).
- **Hadron Tasks / Todos → Vorssaint (`Sources/Vorssaint/Services/Tasks/HadronTodoSyncService.swift` + `NotchTasksView.swift`):**
  - Integrate directly with Hadron's local task store at `~/Library/Application Support/dev.flux.browser/todos.json` (verified schema in `crates/flux-core/src/todos.rs`: `{ id, title, done, created_ms, due, time, priority, minutes, profile, source, by_agent, updated_ms }`).
  - **Conflict-safe two-way sync:** Use `DispatchSourceFileSystemObject` watcher + atomic write (`todos.json.tmp` → `rename`) + timestamped **`updated_ms` Last-Writer-Wins merge per `id`** so edits in Hadron (Electron/Tauri browser) and Vorssaint never clobber each other.
  - **UI & Flows:** Show Hadron task profiles (`Uni`, `Personal`, …) inside a compact Notch card + Menu Panel section, tick `done` with one click, quick-add tasks using Hadron's shorthand (`"friday 5pm !1 ~30m"`), and offer **Start as Fairy Goal** to escalate any task.
- **Vorssaint Scratchpad ↔ Hadron Markdown Notes + iCloud Sync (`Services/Scratchpad/NotesSyncService.swift`):**
  - Sync Vorssaint Scratchpad tabs (`UI/Notch/NotchScratchpadView.swift`, `UI/Scratchpad/`) two-way with Hadron's markdown notes folder at `~/Library/Application Support/dev.flux.browser/md-notes/*.md` (using YAML frontmatter / filename-slug mapping + modified-time conflict preservation).
  - Add an optional **iCloud Drive Mirror** toggle (`~/Library/Mobile Documents/com~apple~CloudDocs/BaryonNotes/`) with `NSFileCoordinator` / placeholder download handling so notes stay synchronized across MacBook, Mac mini, Hadron, iOS/iPadOS, and Baryon Notebooks.
  - Add one-click **Send Note to Fairy Chat / Add as Notebook Source** directly inside Scratchpad.

### Phase 5 — Stratus System Monitor Overhaul, Fairy OS Superpowers, Smart Alerts & Unified Usage
- **Stratus UI Overhaul of Vorssaint System Monitor:**
  - Redesign `UI/Notch/NotchSystemView.swift`, `UI/MenuPanel/SystemSection.swift`, `MetricDetailView.swift`, `CPUCoreMatrix.swift`, `PowerSection.swift`, `NetworkSection.swift`, `DiskSection.swift`, and `Sparkline.swift` to match Baryon/Stratus's signature visual language:
    - Pure pitch-black `#050507` / `#08080a` glass cards with `0.5px` subtle hairline highlights (`rgba(255,255,255,0.06)`).
    - Smooth cubic/Catmull-Rom glowing **Stratus area splines** in **Orange (`#e88255`)**, **Purple (`#7a89ff`)**, and **Cyan (`#4bc3f7`)** replacing boxy legacy bar graphs.
    - Clean tabular monospace numerals (`cpu%`, watts, thermals, RAM pressure, network throughput, disk I/O), compact P-core vs E-core heat strip, and inline top-offender process actions (**Inspect**, **Ask Fairy**, **Kill**).
- **Approval-Gated Mac Tools (`desktop/vorssaint-tools.mjs`):**
  - Read-only (auto-allowed): `mac_system_snapshot`, `mac_port_list`, `mac_window_list`.
  - Mutating (uses Baryon approval cards + Touch ID on Face): `mac_window_layout`, `mac_audio_mixer`, `mac_port_kill`, `mac_keep_awake`, `mac_fan_profile`.
- **Smart System Alerts:** Sustained CPU/RAM/thermal alerts (`vorssaint.alert`) handed to Fairy (paired with `fairy-resource-monitor`) to surface plain-English diagnosis & cleanup pills in the Notch.
- **Mode-Linked Presets (`vorssaint.preset`):** *Meeting* (duck music + Keep Awake + Camera Preview), *Study/Notebook* (tile Baryon + PDF side-by-side + quiet distractions), *Work/Analytics* (Keep Awake + thermal watch).
- **Unified Agent Usage Telemetry:** Unify `Services/AgentUsage/` (Claude, Codex, Copilot, OpenCode) with `desktop/token-usage.mjs` & `src/usage-view.js` so Notch `NotchAgentsView` and Baryon Usage agree on quotas, resets, and estimated API value.

### Phase 6 — Single-App Bundle, Settings Feature Hub & Unified Menu Bar
- **Embedded Helper Packaging:** Update `scripts/package-fairy.mjs` to embed the debloated, signed `VorssaintHelper.app` into `Baryon.app/Contents/Helpers/` and verify startup in `desktop/self-check.cjs`.
- **Settings → Mac Utilities (`src/vorssaint-settings.js`):** Surface the kept `FeatureCatalog` toggles, AI Launcher hotkey/folder config, Hadron/iCloud sync paths, and live permission status inside Baryon's floating Obsidian Settings pane (`vorssaint.features`).
- **Single Unified Menu Bar Icon + Quiz Fairy Icon:** Optionally collapse Vorssaint's separate utility menu bar icon into the paired **Baryon + Fairy** tray (`assets/tray/trayPairTemplate*.png`), explicitly **keeping the Fairy menu bar icon intact for Quiz mode animations** (`native/QuizOverlay.swift`).

---

## 4. Verification & Risk Mitigation

- **Automated Tests to Add:**
  - `test/vorssaint-bridge.test.mjs`: `vorssaint.sock` NDJSON framing, `0600` mode enforcement, Face↔mini routing.
  - `test/vorssaint-gestures.test.mjs`: Multi-display Cocoa ↔ Electron coordinate mapping, `70 pt` tether detach threshold, `85 pt` magnetic dock capture math.
  - `test/vorssaint-sync.test.mjs`: Hadron `todos.json` `updated_ms` LWW merge without clobbering offline edits, `md-notes` / iCloud bidirectional conflict handling, Google Calendar event normalization.
  - `test/vorssaint-tools.test.mjs`: Approval gating on mutating OS tools vs read-only inspection tools.
  - SwiftPM `swift test`: Debloated build compilation, `BaryonBridgeService` codec, `NotchMascotLook.fairy`, `NotchTeleprompterWindow.sharingType == .none`, and `AutoQuit`/`Audio` exclusions.
- **Live & Visual Checks:**
  - Verify Notch ↔ Floating Companion drag-out and magnetic re-dock at 120Hz on built-in Retina and external displays.
  - Verify Teleprompter stays invisible during a Zoom / `fairy-screen` screen capture.
  - Verify Google Calendar events, Hadron todos, Hadron `md-notes` + iCloud notes, AI Launcher `⌘↩` Trio launch, and Stratus System Monitor live telemetry.
- **License & Hardening Note:** Out-of-process `VorssaintHelper.app` speaking NDJSON over `vorssaint.sock` honors `GPL-3.0-or-later` process boundaries while keeping Electron fuses locked.
