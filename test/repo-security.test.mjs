import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';

const REPO_ROOT = resolve(new URL('..', import.meta.url).pathname);

test('GitHub repository security files exist and enforce cooldowns', async () => {
  for (const rel of ['SECURITY.md', '.github/CODEOWNERS', '.github/dependabot.yml']) {
    assert.equal(existsSync(join(REPO_ROOT, rel)), true, `Missing required security file: ${rel}`);
  }
  const dependabot = await readFile(join(REPO_ROOT, '.github/dependabot.yml'), 'utf8');
  assert.match(dependabot, /cooldown:/);
  assert.match(dependabot, /default-days:\s*7/);
});

test('All GitHub Actions workflows enforce SHA pinning, minimal permissions, and safe npm installs', async () => {
  const wfDir = join(REPO_ROOT, '.github/workflows');
  const files = (await readdir(wfDir)).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
  assert.ok(files.length >= 2, 'Expected CI and Dependency Review workflows');

  for (const file of files) {
    const src = await readFile(join(wfDir, file), 'utf8');
    assert.match(src, /^permissions:\s*\{\s*\}/m, `${file} must declare top-level permissions: {}`);
    assert.doesNotMatch(src, /\bpull_request_target\b/, `${file} must never use pull_request_target`);
    assert.doesNotMatch(src, /\bworkflow_run\b/, `${file} must never use workflow_run`);

    const usesMatches = [...src.matchAll(/uses:\s*([^\s#]+)/g)];
    assert.ok(usesMatches.length > 0, `${file} should reference at least one pinned action`);
    for (const [, target] of usesMatches) {
      assert.match(
        target,
        /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*@[0-9a-f]{40}$/,
        `${file} uses unpinned action reference: ${target}`,
      );
    }

    if (src.includes('actions/checkout@')) {
      assert.match(src, /persist-credentials:\s*false/, `${file} must set persist-credentials: false on actions/checkout`);
    }
    if (/\bnpm ci\b/.test(src)) {
      assert.match(src, /\bnpm ci\b[^\n]*--ignore-scripts/, `${file} must pass --ignore-scripts to npm ci`);
    }
  }
});
