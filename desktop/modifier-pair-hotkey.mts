export type ModifierPairStage = 'idle' | 'first-down' | 'await-second' | 'second-down' | 'stopped';

export interface ModifierPairTriggerEvent {
  modifier: string;
  at: number;
}

export interface ModifierPairDetectorOptions {
  modifier?: string;
  maxGapMs?: number;
  maxHoldMs?: number;
  now?: () => number;
  onTrigger?: (event: ModifierPairTriggerEvent) => void;
}

export interface ModifierPairInputEvent {
  key?: string;
  down?: boolean;
  otherKeysPressed?: boolean;
}

export interface ModifierPairHandleResult {
  triggered: boolean;
  stage: ModifierPairStage;
}

export interface ModifierPairDetector {
  handleEvent: (event?: ModifierPairInputEvent) => ModifierPairHandleResult;
  reset: () => void;
  state: () => {
    stage: ModifierPairStage;
    downAt: number;
    releasedAt: number;
    modifier: string;
  };
}

/**
 * Double-modifier tap state machine (e.g. Option-Option or Command-Command) that avoids
 * macOS Accessibility / Input Monitoring permissions required by global character hooks.
 */
export function createModifierPairDetector({
  modifier = 'option',
  maxGapMs = 350,
  maxHoldMs = 400,
  now = Date.now,
  onTrigger = () => {},
}: ModifierPairDetectorOptions = {}): ModifierPairDetector {
  let stage: ModifierPairStage = 'idle'; // 'idle' | 'first-down' | 'await-second' | 'second-down'
  let downAt = 0;
  let releasedAt = 0;

  function reset(): void {
    stage = 'idle';
    downAt = 0;
    releasedAt = 0;
  }

  function handleEvent({ key = '', down = false, otherKeysPressed = false }: ModifierPairInputEvent = {}): ModifierPairHandleResult {
    const cleanKey = String(key || '').toLowerCase();
    const target = String(modifier || 'option').toLowerCase();
    if (otherKeysPressed || (cleanKey && cleanKey !== target)) {
      reset();
      return { triggered: false, stage };
    }
    const ts = now();

    if (down) {
      if (stage === 'idle') {
        stage = 'first-down';
        downAt = ts;
      } else if (stage === 'await-second') {
        if (ts - releasedAt <= maxGapMs) {
          stage = 'second-down';
          downAt = ts;
        } else {
          stage = 'first-down';
          downAt = ts;
        }
      }
      return { triggered: false, stage };
    }

    // key up
    if (stage === 'first-down') {
      if (ts - downAt <= maxHoldMs) {
        stage = 'await-second';
        releasedAt = ts;
      } else {
        reset();
      }
      return { triggered: false, stage };
    }

    if (stage === 'second-down') {
      const quick = ts - downAt <= maxHoldMs;
      reset();
      if (quick) {
        onTrigger({ modifier: target, at: ts });
        return { triggered: true, stage };
      }
    }

    return { triggered: false, stage };
  }

  return {
    handleEvent,
    reset,
    state: () => ({ stage, downAt, releasedAt, modifier }),
  };
}

export class ModifierPairShortcutProcess {
  detector: ModifierPairDetector;
  running: boolean;

  constructor({ modifier = 'option', onTrigger = () => {} }: { modifier?: string; onTrigger?: (event: ModifierPairTriggerEvent) => void } = {}) {
    this.detector = createModifierPairDetector({ modifier, onTrigger });
    this.running = false;
  }
  start(): boolean { this.running = true; return true; }
  stop(): void { this.running = false; this.detector.reset(); }
  isRunning(): boolean { return this.running; }
  feed(event?: ModifierPairInputEvent): ModifierPairHandleResult {
    return this.running ? this.detector.handleEvent(event) : { triggered: false, stage: 'stopped' };
  }
}
