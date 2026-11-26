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
} = {}) {
  let stage = 'idle'; // 'idle' | 'first-down' | 'await-second' | 'second-down'
  let downAt = 0;
  let releasedAt = 0;

  function reset() {
    stage = 'idle';
    downAt = 0;
    releasedAt = 0;
  }

  function handleEvent({ key = '', down = false, otherKeysPressed = false } = {}) {
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
  constructor({ modifier = 'option', onTrigger = () => {} } = {}) {
    this.detector = createModifierPairDetector({ modifier, onTrigger });
    this.running = false;
  }
  start() { this.running = true; return true; }
  stop() { this.running = false; this.detector.reset(); }
  isRunning() { return this.running; }
  feed(event) { return this.running ? this.detector.handleEvent(event) : { triggered: false, stage: 'stopped' }; }
}
