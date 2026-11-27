// Reads investigations through Fairy's research engine (docs/research-migration.md, stage 1), until there is a view:
//   node scripts/research.mjs list            the investigations, newest first
//   node scripts/research.mjs open <slug>     one investigation's board: its plan, overview, hypotheses and round
// The folder is Proton's research.folder setting, else ~/Github/Research; FAIRY_RESEARCH_DIR overrides it. Needs
// native/bin/fairy-research (npm run build:research). It only reads, and is read only wherever Proton holds the lock.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ResearchEngine } from '../desktop/research/engine.mjs';
import { researchCalls } from '../desktop/research/calls.mjs';
import { researchFolder } from '../desktop/research/folder.mjs';

const binary = join(dirname(fileURLToPath(import.meta.url)), '..', 'native', 'bin', 'fairy-research');
const status = round => !round ? 'no round yet' : round.held ? `read only: ${round.held}` : round.status?.status === 'running' ? `round ${round.round} running` : round.status?.status === 'paused' ? `round ${round.round} paused` : round.round ? `${round.round} round${round.round === 1 ? '' : 's'} so far` : 'no rounds yet';

export function describe(events, { slug = null } = {}) {
  const last = type => events.filter(event => event.type === type).at(-1);
  const list = last('researchList'), board = last('researchBoard'), round = last('researchRound'), lines = [];
  for (const notice of events.filter(event => event.type === 'notice')) lines.push(`(${notice.level}) ${notice.text}`);
  if (!slug) {
    lines.push(`Investigations in ${list?.folder ?? '?'}`);
    for (const item of list?.investigations ?? []) lines.push(`  ${item.slug}  ${item.title} · ${item.discipline} · ${item.hypotheses} hypotheses · ${item.rounds} rounds${item.forkedFrom ? ` · forked from ${item.forkedFrom}` : ''}`);
    if (!list?.investigations?.length) lines.push('  none yet');
    return lines.join('\n');
  }
  if (!board || board.slug !== slug) return [...lines, `No board came back for ${slug}.`].join('\n');
  lines.push(`${board.title} · ${board.discipline} · ${status(round)}`);
  for (const [name, text] of [['Brief', board.brief], ['Overview', board.overview], ['Feedback', board.feedback]]) if (text?.trim()) lines.push(`\n${name}\n${text.trim()}`);
  lines.push('\nHypotheses');
  for (const [rank, row] of (board.hypotheses ?? []).entries()) lines.push(`  ${rank + 1}. ${row.id} ${row.title} · Elo ${row.elo} · ${row.wins}–${row.losses} · ${row.status}`);
  if (!board.hypotheses?.length) lines.push('  none yet');
  return lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [what, slug] = process.argv.slice(2);
  if (!['list', 'open'].includes(what) || (what === 'open' && !slug)) { console.error('node scripts/research.mjs list | open <slug>'); process.exit(2); }
  if (!existsSync(binary)) { console.error('Build the research engine first: npm run build:research'); process.exit(1); }
  const events = [], engine = new ResearchEngine({ binary, folder: researchFolder(), onEvent: event => events.push(event) });
  const calls = researchCalls({ engine });
  try {
    if (what === 'open') await calls.open(slug); else await calls.list();
    console.log(describe(events, { slug: what === 'open' ? slug : null }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  await engine.stop();
}
