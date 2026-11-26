# Fairy performance audit — 2026-09-22

Scope: read-only code audit, isolated GPU capability probe and brief live process
sampling. No application source, settings, renderer backend or installed app was
changed. No RESEARCH_PLAN.md exists. User reports the sitting animation works.

## Measurements and limits

- Same Electron 44.3.0 runtime in an isolated process reports ANGLE Metal Renderer:
  Apple M2 Pro; accelerated 2D canvas, compositing, rasterization, WebGL and WebGPU
  available. This establishes runtime capability, not a per-draw GPU trace of Fairy.
- AC power, thermal state nominal during the probe.
- Live sample: 8.12s, 6 matching Fairy processes, 30.5% of one CPU
  core, 322.4 MiB summed RSS. User activity/features were not controlled. Shared
  pages may be counted repeatedly; RSS is not macOS physical footprint.
- 22 persistent 840×1520 RGBA sprite/intermediate canvases have 107.15 MiB
  nominal pixel storage. This is a code-derived estimate, not attributable RSS.
  Decoded source images and browser/GPU storage can add to this; reclamation must
  be measured. No leak conclusion can be drawn from a short sample.

## Verified source findings

1. src/avatar.js constructs Three.js WebGL, scene, geometries, controls and a
   running animation callback even in sprite mode. frame() returns early but the
   callback remains scheduled. ResizeObserver is not retained for teardown and
   Avatar has no full disposal lifecycle. These are lifecycle risks, not proof of
   an accumulating leak in normal single-instance use.
2. src/sprite-avatar.js expands every frame to a full double-size canvas. Atlas
   region draws or source-size frames could avoid redundant transparent pixels.
   The seated composite is rebuilt even while holding a static expression.
   Alpha hit maps use getImageData repeatedly during sitting; cache compact masks.
3. Sprite loop still calls render when document.hidden or sprite mode disabled;
   only the idle scheduler pauses. BrowserWindow disables background throttling.
4. IdleAnimation.sample allocates temporary frame arrays and sample objects on the
   frame path. Effects reconstruct small palettes/ray arrays and redraw even when
   their quantized 8 Hz state is unchanged. Precompute and reuse hot-path data.
5. Main process already caches settings/history/memory in RAM, with bounded 1000
   episode recall and one replaceable ambient snapshot. There is no database
   polling loop to remove. History/memory JSON is rewritten on completed turns.
6. Multiple independent timers wake for UI awareness, tray refresh, proactive
   checks, quizzes, ambient screenshots and music. Many check guards but still
   wake; prefer event-driven state updates and cancellable deadline scheduling.
7. Lock/suspend handling already pauses sensors. Battery, thermal throttling,
   Low Power Mode and render-budget propagation to renderer are not implemented.

## Recommended implementation order

A. Establish controlled baselines: idle standing/seated, talking, music, desktop
   work, hidden/minimized, lock/sleep/wake; GPU/CPU frame time and long tasks,
   allocations/heap retention, native/GPU memory, wakeups, I/O bytes and energy.
B. Lazy-load/create optional 3D stack. Cancel inactive render loops. Reuse source
   atlases and compact alpha masks; reblend only when pose or blend weight changes.
   Use adaptive 24/30 FPS budgets, reduced battery/thermal rate, zero animation
   when hidden/locked/asleep; preserve awake listening/screen features as selected.
C. Explicit owner/dispose for timers, observers, listeners, audio, textures,
   object URLs, buffers, child processes and in-flight loads. Run repeat-cycle
   and multi-hour soak tests; confirm retained memory plateaus after warmup.
D. Unify cache and scheduling: bounded TTL/LRU, in-flight request deduplication,
   latest-state coalescing, bounded queues/backpressure and backoff with jitter.
   Store durable chat/writes safely; only debounce/coalesce expendable settings
   writes with serialized atomic writes and shutdown flush. Avoid persistent
   screenshot caches. Fresh observations remain mandatory for desktop actions.
E. If recall grows, maintain incremental token/posting indexes and bounded top-k
   selection rather than scanning/sorting every document after each new turn.
   Benchmark first because current recall is capped at 1000 episodes.

## HPC techniques: applicability

- Data-oriented layout: shared atlases, numeric frame IDs and packed metadata;
  typed arrays for alpha masks/audio, precomputed frame timelines. High relevance.
- GC reduction: reusable scratch objects/buffers in hot loops; bounded pools only
  for proven allocation hotspots. Oversized pools can increase retained memory.
- SIMD: defer unless measured CPU pixel/audio loops dominate; use platform vector
  APIs or WASM SIMD only where justified. GPU rendering is already available.
- Lock-free concurrency: not a priority for a single-avatar main JS loop. Use
  asynchronous message passing and bounded worker queues for demonstrated heavy
  decode/index/parse jobs; transfer buffers where ownership permits.
- Compression: PNG/synthesized audio already encoded. Avoid recompressing them;
  remove redundant copies/base64 and choose appropriate resolution first, while
  preserving readable screenshots. Transport choices must match provider APIs.
- Framework migration: native AppKit/SpriteKit may lower baseline overhead but
  requires a substantial frontend/integration rewrite. Measure existing wins
  before proposing migration; retain plain JS rather than adding a UI framework.

## References

- https://www.electronjs.org/docs/latest/api/app
- https://www.electronjs.org/docs/latest/api/power-monitor
- https://github.com/google/angle/blob/main/doc/DebuggingTips.md
- https://developer.apple.com/documentation/foundation/processinfo/islowpowermodeenabled

No peer handoff is needed. This audit makes no claim that optimizations have
already been applied or that Fairy is leak-free.

## Implementation status — 2026-09-22

Pass 1 rendering/sprite-memory changes implemented and isolated checks passed.
See VERDICT.md for measured results and final install status. Later cleanup,
scheduling, power policy and data-path passes remain queued before animations.

Pass 2: bounded audio decoding and explicit playback/microphone ownership
implemented; 287 tests pass. See VERDICT.md for evidence and the remaining native
microphone-restart retention question. Next planned work remains timer/event
scheduling, safe I/O coalescing and power policies; animations are deferred.

Pass 3 implemented: conditional background tasks, event-driven status/tray
updates, actual proactive deadlines, bounded playback refresh. See VERDICT.md
for test and install status. Quiz inference independently uses Codex gpt-6-astra
per user request. Safe I/O/cache coalescing and power policy remain next.

Pass 4 implemented and installed: bounded metadata-validated local text cache,
serialized atomic JSON writes, identical pending-save coalescing, shutdown
flush. 305 tests pass; Electron I/O fixture passes. Ten repeated synthetic file
searches read 90% fewer content bytes. Live UI check awaits Mac unlock; see
VERDICT.md for exact evidence and limits. Next: power-budget policy.
