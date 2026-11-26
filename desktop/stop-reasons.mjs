// Why a request ended. Every stop names its reason when it aborts (stopWith), and every request's end is worked out
// the same way (endReason): finished, or stopped by you, by sleep, a lock, quitting or stepping away, or it ran out of
// time, or the provider failed (at a usage limit, signed out, or another error). Fairy logs it, so a turn that ended
// with nobody pressing Stop says why ("Improving existing features", stop reasons).

export const STOP_NOTES = Object.freeze({
  you: 'Stopped.',
  sleep: 'Stopped because your Mac went to sleep.',
  lock: 'Stopped because your Mac locked.',
  quit: 'Stopped because Fairy quit.',
  away: 'Stopped because you stepped away.',
  senses: 'Stopped when you paused Fairy’s senses.',
  power: 'Stopped to save power.',
});
// closed: Fairy closed or crashed during the turn, found from its checkpoint at the next start (work-checkpoint.mjs).
export const END_REASONS = Object.freeze(['done', ...Object.keys(STOP_NOTES), 'timeout', 'limit', 'signed-out', 'error', 'closed']);

// Aborts with a reason that says why. The reason is an Error named AbortError, as an abort's own reason would be, so
// code that checks for an abort still sees one.
export function stopWith(controller, reason = 'you', note = '') {
  if (!controller || controller.signal.aborted) return;
  const why = STOP_NOTES[reason] ? reason : 'you';
  controller.abort(Object.assign(new Error(note || STOP_NOTES[why]), { name: 'AbortError', stopReason: why }));
}

const LIMIT = /usage limit|rate limit|quota|limit reached|too many requests|\b429\b/i;
const SIGNED_OUT = /sign in|signed out|log ?in|not logged|expired|unauthori[sz]ed|\b401\b/i;
const TIMED_OUT = /timed out|timeout/i;

// The reason a request ended: from how it was stopped, or else from its error, or done.
export function endReason({ signal = null, error = null } = {}) {
  if (signal?.aborted) {
    const reason = signal.reason;
    if (reason?.stopReason && STOP_NOTES[reason.stopReason]) return reason.stopReason;
    if (reason?.name === 'TimeoutError') return 'timeout';
    return 'you';
  }
  if (!error) return 'done';
  const message = String(error?.message ?? error);
  if (error?.name === 'TimeoutError' || TIMED_OUT.test(message)) return 'timeout';
  if (LIMIT.test(message)) return 'limit';
  if (SIGNED_OUT.test(message)) return 'signed-out';
  return 'error';
}

// What a stopped work turn says first, naming why when it wasn't you.
export function stoppedWords(reason) {
  if (reason === 'you') return 'Stopped before finishing.';
  if (reason === 'timeout') return 'This ran past its time limit and stopped before finishing.';
  if (reason === 'closed') return 'Fairy closed before this turn finished.';
  return STOP_NOTES[reason] ? `${STOP_NOTES[reason].replace(/\.$/, '')}, before finishing.` : 'Stopped before finishing.';
}
