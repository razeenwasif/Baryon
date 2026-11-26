// Work answers cite project files with the same links notes use, so a claim opens in the Sources panel at its line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CITE_RULE, linkCitations, workRootId } from '../desktop/work-citations.mjs';
import { LocalFiles, parseSourceLink, sourceLink } from '../desktop/local-files.mjs';
import { describeSource } from '../src/source-link.js';

const project = () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'fairy-cite-')));
  mkdirSync(join(root, 'src')); mkdirSync(join(root, '.git')); mkdirSync(join(root, 'node_modules'));
  writeFileSync(join(root, 'src', 'parse.js'), Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join('\n'));
  writeFileSync(join(root, 'README.md'), '# Demo\n');
  writeFileSync(join(root, '.env'), 'KEY=x'); writeFileSync(join(root, '.git', 'config'), ''); writeFileSync(join(root, 'node_modules', 'a.js'), '');
  writeFileSync(join(root, 'secrets.json'), '{}');
  return root;
};

test('a work folder has a stable root id shaped like Fairy’s other roots', () => {
  assert.equal(workRootId('/p/a'), workRootId('/p/a'));
  assert.notEqual(workRootId('/p/a'), workRootId('/p/b'));
  assert.match(workRootId('/p/a'), /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
  assert.equal(parseSourceLink(sourceLink(workRootId('/p/a'), 'src/x.js', 3)).rootId, workRootId('/p/a'));
});

test('plain path links to real project files become citations at their line; anything else is left as written', async () => {
  const root = project(), id = workRootId(root);
  const text = [
    'The parser stops early in [parse.js line 42](src/parse.js#L42), see also [the range](./src/parse.js#L10-L12) and [colon](src/parse.js:7).',
    'Setup is in [the README](README.md). Twice: [the README](README.md).',
    'Left alone: [web](https://example.com/a), [anchor](#top), [missing](src/nope.js#L1), [up](../outside.js), [abs](/etc/hosts),',
    '[env](.env), [git](.git/config), [deps](node_modules/a.js), [secret](secrets.json), [mail](mailto:a@b.c), [folder](src).',
  ].join('\n');
  const out = await linkCitations(text, { root });
  const links = [...out.matchAll(/\]\((lyra-file:[^)]+)\)/g)].map(match => parseSourceLink(match[1]));
  assert.deepEqual(links.map(link => [link.rootId === id, link.path, link.start]), [[true, 'src/parse.js', 42], [true, 'src/parse.js', 10], [true, 'src/parse.js', 7], [true, 'README.md', 1], [true, 'README.md', 1]]);
  for (const kept of ['(https://example.com/a)', '(#top)', '(src/nope.js#L1)', '(../outside.js)', '(/etc/hosts)', '(.env)', '(.git/config)', '(node_modules/a.js)', '(secrets.json)', '(mailto:a@b.c)', '(src)']) assert.ok(out.includes(kept), kept);
  assert.equal(await linkCitations('No links here.', { root }), 'No links here.');
  assert.equal(describeSource(links[0].link ?? out.match(/lyra-file:[^)]+/)[0]).line, 42);
});

test('a citation opens through the work folder’s root, and only inside it', async () => {
  const root = project(), id = workRootId(root);
  const files = new LocalFiles({ file: () => join(root, 'unused.json') }).including([{ id, path: root, name: 'demo' }]);
  const preview = await files.preview(sourceLink(id, 'src/parse.js', 42));
  assert.match(JSON.stringify(preview), /line 42/);
  await assert.rejects(() => files.preview(sourceLink(id, '.env', 1)));
});

test('the rule is one stable line in the work instructions, and main links replies before saving and opens work roots', () => {
  assert.match(CITE_RULE, /\[parse\.js line 42\]\(src\/parse\.js#L42\)/);
  const agent = readFileSync(new URL('../desktop/work-agent.mjs', import.meta.url), 'utf8'), main = readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(agent, /\$\{CITE_RULE\}/);
  assert.match(main, /reply = await workCitations\.linkCitations\(reply, \{ root \}\)\.catch\(\(\) => reply\);\n\s+\/\/ A run it names \(R12\) opens its page in Runs \(runs\.mjs, stage 5\)\.\n\s+reply = await runsModule\.linkRuns\(reply, \{ root, store: runStore \}\)\.catch\(\(\) => reply\);\n\s+const replyAt/);
  assert.match(main, /const filesFor = rootId => attachments\.has\(rootId\) \? [^\n]+workRootOf\(rootId\) \? localFiles\.including\(\[workRootOf\(rootId\)\]\)/);
});
