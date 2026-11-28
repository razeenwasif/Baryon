const QUIT_HOLD_DURATION_MS = 1200;
const QUIT_DOUBLE_PRESS_MS = 500;
// macOS drops letter keyUp events while Command is held, so auto-repeat keydowns prove the hold.
// Once armed, quitting waits for Q keyUp or a quiet grace period so trailing repeats don't hit the next app.
const QUIT_HOLD_RELEASE_GRACE_MS = 600;
const QUIT_HOLD_REPEAT_CADENCE_MULTIPLIER = 2;

type QuitMode = 'hold' | 'double-click' | 'direct' | string;

interface QuitNotifyEvent {
  state: 'up' | 'down';
  mode?: QuitMode;
  durationMs?: number;
}

interface QuitInputEvent {
  preventDefault: () => void;
}

interface QuitKeyboardInput {
  type?: string;
  key?: string;
  meta?: boolean;
  control?: boolean;
  alt?: boolean;
  shift?: boolean;
  isAutoRepeat?: boolean;
}

interface MakeQuitShortcutHandlerOptions<TTimer = ReturnType<typeof setTimeout>> {
  platform?: NodeJS.Platform | string;
  getMode?: () => Promise<QuitMode> | QuitMode;
  notify?: (event: QuitNotifyEvent) => void;
  concealWindow?: () => void;
  quit?: () => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => TTimer;
  clearTimer?: (id: TTimer) => void;
}

function makeQuitShortcutHandler<TTimer = ReturnType<typeof setTimeout>>({
  platform = process.platform,
  getMode = () => Promise.resolve('hold'),
  notify = () => {},
  concealWindow = () => {},
  quit = () => {},
  now = Date.now,
  setTimer = ((fn: () => void, ms: number) => setTimeout(fn, ms)) as unknown as (fn: () => void, ms: number) => TTimer,
  clearTimer = ((id: TTimer) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>)) as unknown as (id: TTimer) => void,
}: MakeQuitShortcutHandlerOptions<TTimer> = {}): (event: QuitInputEvent, input?: QuitKeyboardInput) => void {
  const modifierKey = platform === 'darwin' ? 'meta' : 'control';
  let watchdog: TTimer | undefined;
  let holding = false;
  let mode: QuitMode | undefined;
  let notified = false;
  let armed = false;
  let quitOnRelease = false;
  let heldSince = 0;
  let lastPressAt = 0;
  let lastRepeatAt = 0;
  let repeatCadenceMs = 0;
  let generation = 0;

  const clearWatchdog = () => {
    if (watchdog !== undefined) {
      clearTimer(watchdog);
      watchdog = undefined;
    }
  };

  const release = (cancelPendingMode = true, keepDoublePressHint = false) => {
    if (cancelPendingMode) generation += 1;
    if (!holding && !notified) return;
    const keepHint = keepDoublePressHint && mode === 'double-click' && notified;
    holding = false;
    armed = false;
    quitOnRelease = false;
    lastRepeatAt = 0;
    repeatCadenceMs = 0;
    if (keepHint) return;

    mode = undefined;
    clearWatchdog();
    if (notified) {
      notified = false;
      notify({ state: 'up' });
    }
  };

  const quitNow = () => {
    release();
    lastPressAt = 0;
    quit();
  };

  const quitAfterQuietPeriod = () => {
    clearWatchdog();
    const quietPeriodMs = Math.max(QUIT_HOLD_RELEASE_GRACE_MS, repeatCadenceMs * QUIT_HOLD_REPEAT_CADENCE_MULTIPLIER);
    watchdog = setTimer(quitNow, quietPeriodMs);
  };

  return (event: QuitInputEvent, input?: QuitKeyboardInput) => {
    const key = String(input?.key || '').toLowerCase();
    if (input?.type === 'keyUp') {
      if (key === 'q') {
        const shouldQuit = quitOnRelease;
        release(false, true);
        if (shouldQuit) quit();
      } else if (key === modifierKey) {
        if (!quitOnRelease) release(false, true);
        else quitAfterQuietPeriod();
      }
      return;
    }
    if (input?.type !== 'keyDown') return;

    const modifierDown = platform === 'darwin' ? Boolean(input.meta) : Boolean(input.control);
    if (input.isAutoRepeat && modifierDown && key === 'q') {
      const ts = now();
      repeatCadenceMs = ts - (lastRepeatAt === 0 ? heldSince : lastRepeatAt);
      lastRepeatAt = ts;
    }
    if (quitOnRelease) {
      event.preventDefault();
      if (key === 'q') quitAfterQuietPeriod();
      return;
    }

    if (!modifierDown || input.alt || input.shift || key !== 'q') {
      if (key === modifierKey && !input.alt && !input.shift) return;
      if (!input.isAutoRepeat) {
        lastPressAt = 0;
        release();
      }
      return;
    }

    event.preventDefault();

    if (input.isAutoRepeat) {
      if (mode === 'hold' && armed && now() - heldSince >= QUIT_HOLD_DURATION_MS) {
        armed = false;
        quitOnRelease = true;
        concealWindow();
        quitAfterQuietPeriod();
      }
      return;
    }

    const ts = now();
    const previousPressAt = lastPressAt;
    lastPressAt = ts;
    if (holding || notified) release();

    generation += 1;
    if (previousPressAt !== 0 && ts - previousPressAt <= QUIT_DOUBLE_PRESS_MS) {
      quitNow();
      return;
    }

    const pressGeneration = generation;
    holding = true;
    heldSince = ts;
    void Promise.resolve(getMode()).then(
      resolvedMode => {
        if (generation !== pressGeneration) return;
        if (resolvedMode === 'direct') {
          quitNow();
          return;
        }
        if (resolvedMode === 'double-click') {
          const remainingMs = QUIT_DOUBLE_PRESS_MS - (now() - ts);
          if (remainingMs <= 0) {
            release();
            return;
          }
          mode = resolvedMode;
          notified = true;
          notify({ state: 'down', mode: resolvedMode, durationMs: QUIT_DOUBLE_PRESS_MS });
          watchdog = setTimer(() => release(), remainingMs);
          return;
        }

        if (!holding) return;
        mode = resolvedMode || 'hold';
        notified = true;
        notify({ state: 'down', mode, durationMs: QUIT_HOLD_DURATION_MS });
        armed = true;
        watchdog = setTimer(() => {
          watchdog = undefined;
          release();
        }, QUIT_HOLD_DURATION_MS + QUIT_HOLD_RELEASE_GRACE_MS);
      },
      () => {
        if (generation !== pressGeneration) return;
        quitNow();
      },
    );
  };
}

module.exports = { QUIT_HOLD_DURATION_MS, QUIT_DOUBLE_PRESS_MS, makeQuitShortcutHandler };
