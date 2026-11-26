// Reliability plan, Part C (docs/reliability-plan.md): pure, deterministic check verdicts for work turns.
// Computes Checked / Failed / Out of date / Not checked strictly from exit codes Fairy recorded and the turn's
// file-change journal — never from what the model claimed. Zero model calls, zero external dependencies.

export const VERDICTS = Object.freeze(['checked', 'failed', 'out-of-date', 'not-checked']);
export const CHECK_SOURCES = Object.freeze(['lead', 'builder', 'goal', 'claim']);

const squash = text => String(text ?? '').replace(/\s+/g, ' ').trim();

export function shortCommand(command, limit = 80) {
  const clean = squash(command);
  if (!clean) return 'check';
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
}

export function makeCheckRecord({
  command = '',
  exitCode = null,
  timedOut = false,
  passed = null,
  at = new Date().toISOString(),
  journalPos = 0,
  source = 'lead',
  run = null,
  claim = null,
  detail = '',
} = {}) {
  const cmd = squash(command).slice(0, 300);
  const code = Number.isInteger(exitCode) ? exitCode : null;
  const timed = timedOut === true;
  const ok = typeof passed === 'boolean' ? passed : (!timed && code === 0);
  const pos = Number.isInteger(journalPos) && journalPos >= 0 ? journalPos : 0;
  const src = CHECK_SOURCES.includes(source) ? source : 'lead';
  const time = typeof at === 'string' && at.trim() ? at.trim().slice(0, 40) : new Date().toISOString();
  const cleanDetail = squash(detail).slice(0, 300);
  return {
    command: cmd,
    exitCode: code,
    timedOut: timed,
    passed: ok,
    at: time,
    journalPos: pos,
    source: src,
    ...(run ? { run: String(run).trim().slice(0, 20) } : {}),
    ...(claim ? { claim: String(claim).trim().slice(0, 16) } : {}),
    ...(cleanDetail ? { detail: cleanDetail } : {}),
  };
}

export function cleanCheckRecord(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (typeof raw.at !== 'string' || !raw.at) return null;
  return makeCheckRecord(raw);
}

// Adapter for a goal's done-when check (desktop/goal-check.mjs) into the same check record format.
export function goalCheckRecord(check, { journalPos = 0 } = {}) {
  if (!check || typeof check !== 'object' || check.kind === 'say') return null;
  if (check.kind === 'command') {
    return makeCheckRecord({
      command: check.command || '',
      exitCode: Number.isInteger(check.exitCode) ? check.exitCode : (check.passed ? 0 : null),
      timedOut: check.timedOut === true,
      passed: check.passed === true,
      at: check.at || new Date().toISOString(),
      journalPos,
      source: 'goal',
      detail: check.detail || '',
    });
  }
  if (check.kind === 'metric') {
    return makeCheckRecord({
      command: check.command || check.metric || 'goal metric check',
      exitCode: check.passed ? 0 : 1,
      timedOut: false,
      passed: check.passed === true,
      at: check.at || new Date().toISOString(),
      journalPos,
      source: 'goal',
      run: check.run || null,
      detail: check.detail || '',
    });
  }
  if (check.kind === 'claims') {
    const runs = Array.isArray(check.claims) ? check.claims.map(c => c.run).filter(Boolean) : [];
    return makeCheckRecord({
      command: 'reproduce claims check',
      exitCode: check.passed ? 0 : 1,
      timedOut: false,
      passed: check.passed === true,
      at: check.at || new Date().toISOString(),
      journalPos,
      source: 'goal',
      run: runs.length === 1 ? runs[0] : null,
      detail: check.detail || '',
    });
  }
  return null;
}

// Adapter for a Reproduce a paper claim row (desktop/reproduce/compare.mjs), linked to the run it points at.
export function claimEvidenceRecord(row, { at = new Date().toISOString() } = {}) {
  if (!row || typeof row !== 'object') return null;
  const runId = row.run?.id || null;
  const cmd = row.run?.command || `${row.claimId || 'claim'}: ${row.metric || 'metric'}`;
  const runDone = row.run?.state === 'done';
  return makeCheckRecord({
    command: cmd,
    exitCode: runDone ? (row.passed ? 0 : 1) : null,
    timedOut: false,
    passed: row.passed === true,
    at: row.run?.ended || at,
    journalPos: 0,
    source: 'claim',
    run: runId,
    claim: row.claimId || null,
    detail: row.detail || '',
  });
}

function formatTimeShort(iso) {
  const m = /T(\d{2}:\d{2}:\d{2})/.exec(String(iso || ''));
  return m ? m[1] : '';
}

function uniqueFiles(entries) {
  const paths = new Set();
  for (const item of Array.isArray(entries) ? entries : []) {
    const path = typeof item === 'string' ? item.trim() : typeof item?.path === 'string' ? item.path.trim() : '';
    if (path) paths.add(path);
  }
  return paths;
}

export function formatCheckLine(record, lastWritePos = 0) {
  const cmd = shortCommand(record.command, 100);
  const outcome = record.timedOut
    ? 'timed out'
    : record.passed
      ? (record.exitCode === 0 ? 'passed (exit 0)' : 'passed')
      : Number.isInteger(record.exitCode)
        ? `failed (exit ${record.exitCode})`
        : 'failed';
  const timing = record.journalPos >= lastWritePos ? 'after last change' : 'before later changes';
  const time = formatTimeShort(record.at);
  const bits = [
    `${cmd} — ${outcome}`,
    timing,
    ...(record.run ? [record.run] : []),
    ...(record.source ? [`[${record.source}]`] : []),
    ...(time ? [time] : []),
  ];
  return bits.join(' · ');
}

function buildTooltip(checks, lastWritePos, startCommit) {
  const lines = checks.map(entry => formatCheckLine(entry, lastWritePos));
  if (startCommit) lines.push(`Turn started at ${String(startCommit).slice(0, 12)}`);
  return lines.join('\n');
}

function failedLine(record) {
  const cmd = shortCommand(record.command || record.detail || 'check');
  if (record.timedOut) return `Check failed: ${cmd} timed out`;
  if (Number.isInteger(record.exitCode)) return `Check failed: ${cmd} exited ${record.exitCode}`;
  return `Check failed: ${cmd}`;
}

// Pure verdict from recorded check runs and the turn's file-change journal.
// Returns null when the turn changed no files (a read-only turn shows no line).
export function computeWorkVerdict({ checks = [], journal = [], changedFiles = [], startCommit = '' } = {}) {
  const journalList = Array.isArray(journal) ? journal : [];
  const allChanged = uniqueFiles([...journalList, ...(Array.isArray(changedFiles) ? changedFiles : [])]);
  const changedCount = allChanged.size;

  // Read-only turn: no files changed -> no verdict line.
  if (changedCount === 0 && journalList.length === 0) return null;

  const cleanChecks = (Array.isArray(checks) ? checks : []).map(makeCheckRecord);
  const commit = typeof startCommit === 'string' && startCommit.trim() ? startCommit.trim().slice(0, 64) : '';
  const lastWritePos = journalList.length;

  // Files changed and no check ran.
  if (cleanChecks.length === 0) {
    return {
      status: 'not-checked',
      line: 'Not checked',
      tooltip: `Files changed (${changedCount}) and no check ran.${commit ? `\nTurn started at ${commit.slice(0, 12)}` : ''}`,
      checks: [],
      changedCount,
      changedSinceCount: changedCount,
      ...(commit ? { startCommit: commit } : {}),
    };
  }

  // Checks that ran at or after the last recorded file change.
  const afterLast = cleanChecks.filter(entry => entry.journalPos >= lastWritePos);

  if (afterLast.length > 0) {
    // Track the latest result per distinct command after the last change so a later pass of the same command
    // supersedes an earlier flaky failure, while an unresolved failure of a different check still yields Failed.
    const latestByCmd = new Map();
    for (const entry of afterLast) {
      const key = squash(entry.command).toLowerCase() || '__check__';
      latestByCmd.set(key, entry);
    }
    const failing = [...latestByCmd.values()].filter(entry => !entry.passed);
    if (failing.length > 0) {
      const latestFail = failing[failing.length - 1];
      return {
        status: 'failed',
        line: failedLine(latestFail),
        tooltip: buildTooltip(cleanChecks, lastWritePos, commit),
        checks: cleanChecks,
        changedCount,
        changedSinceCount: 0,
        ...(commit ? { startCommit: commit } : {}),
      };
    }

    const latestPass = afterLast[afterLast.length - 1];
    const cmd = shortCommand(latestPass.command);
    const extra = latestByCmd.size > 1 ? ` (${latestByCmd.size} checks)` : '';
    return {
      status: 'checked',
      line: `Checked: ${cmd} passed${extra}, after the last change`,
      tooltip: buildTooltip(cleanChecks, lastWritePos, commit),
      checks: cleanChecks,
      changedCount,
      changedSinceCount: 0,
      ...(commit ? { startCommit: commit } : {}),
    };
  }

  // No check ran after the last change: inspect the latest check overall.
  const latest = cleanChecks[cleanChecks.length - 1];
  if (!latest.passed) {
    const laterFiles = uniqueFiles(journalList.slice(latest.journalPos));
    const sinceCount = laterFiles.size || Math.max(0, lastWritePos - latest.journalPos);
    return {
      status: 'failed',
      line: failedLine(latest),
      tooltip: buildTooltip(cleanChecks, lastWritePos, commit),
      checks: cleanChecks,
      changedCount,
      changedSinceCount: sinceCount,
      ...(commit ? { startCommit: commit } : {}),
    };
  }

  // Latest check passed, but files changed afterwards (even a file the test might not touch).
  const laterFiles = uniqueFiles(journalList.slice(latest.journalPos));
  const sinceCount = laterFiles.size || Math.max(1, lastWritePos - latest.journalPos);
  return {
    status: 'out-of-date',
    line: `Check is out of date: ${sinceCount} ${sinceCount === 1 ? 'file' : 'files'} changed since`,
    tooltip: buildTooltip(cleanChecks, lastWritePos, commit),
    checks: cleanChecks,
    changedCount,
    changedSinceCount: sinceCount,
    ...(commit ? { startCommit: commit } : {}),
  };
}

// Concise summary of Fairy's recorded verdict for compacted notes ("Done and checked") and work context digests.
export function formatVerdictForNotes(verdict) {
  if (!verdict || typeof verdict !== 'object' || !verdict.line) return '';
  const checks = Array.isArray(verdict.checks) ? verdict.checks : [];
  if (!checks.length) return `Check verdict: ${verdict.line}`;
  const summary = checks.slice(-6).map(entry => {
    const cmd = shortCommand(entry.command, 60);
    const res = entry.timedOut ? 'timed out' : entry.passed ? 'passed' : Number.isInteger(entry.exitCode) ? `exit ${entry.exitCode}` : 'failed';
    return `${cmd} (${res}${entry.run ? `, ${entry.run}` : ''})`;
  }).join('; ');
  return `Check verdict: ${verdict.line} [recorded: ${summary}]`;
}
