// A swarm with nobody watching, for the evals' --way swarm: the same steps the app's driveSwarm takes, from the same
// parts in desktop/swarm.mjs. The designers design apart in throwaway copies, convene with checks between rounds, the
// chosen design's author writes the brief and the others sign it off, a builder builds it as one step, and designers of
// other families check the build.
//
// Where the app asks you, it decides instead: there's no budget card, a settled design is built, and an unsettled one
// is the design with the most votes in the last round (A on a tie), as you might pick it.
import { CHECK_FOCUS, buildReply, convene, conveningSeat, disputesOf, parseBrief, parseSignOff, runBriefWriter, runBuild, runChecks, runConvener, runDesigner, runDesigns, runSignOff, withCopy } from '../desktop/swarm.mjs';
import { WorkTools } from '../desktop/work-tools.mjs';
import { runBuilder, runReview } from '../desktop/work-agent.mjs';

// The design an unsettled swarm builds when nobody is there to choose.
export function unattendedPick(result) {
  if (result.design) return result.design;
  const last = result.history.at(-1)?.answers || [], votes = {};
  for (const { vote } of last) if (vote) votes[vote] = (votes[vote] || 0) + 1;
  const ranked = Object.entries(votes).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return ranked[0]?.[0] || result.designs[0].letter;
}

// seats: [{ provider, name, model, effort }]; connect(seat, { convening }) → { provider, settings } for that designer;
// builder: { provider, settings, model }; place: where throwaway copies go; run: the sandbox's runInSandbox.
// Resolves { reply, outcome, settled, rounds, designerCalls, builderCalls, designs }.
export async function runSwarmTask({ prompt, root, seats, connect, builder, place, run, offered = [], signal }) {
  let designerCalls = 0, builderCalls = 0;
  const call = (seat, job, options = {}) => { designerCalls++; return job(connect(seat, options)); };
  const reads = seatSignal => new WorkTools({ root, permission: 'plan', sandboxed: true, runCommand: run, signal: seatSignal });
  const inCopy = (seatSignal, job) => withCopy({ root, place, signal: seatSignal }, copy => copy
    ? job(new WorkTools({ root: copy.work, permission: 'auto', sandboxed: true, runCommand: run, signal: seatSignal, approve: async () => { throw new Error('A designer can’t ask anyone anything.'); } }), copy.work, true)
    : job(reads(seatSignal), root, false));

  const { designs, failed } = await runDesigns({ seats, signal,
    design: (seat, seatSignal) => inCopy(seatSignal, (tools, where, copy) => call(seat, ({ provider, settings }) => runDesigner({ provider, settings, root: where, prompt, tools, signal: seatSignal, copy }))) });
  if (!designs.length) throw new Error(`No designer finished. ${failed.map(({ seat, error }) => `${seat.name}: ${error}`).join('. ')}`);

  let entry = designs[0], settled = false, notes = [], rounds = 0, history = [], all = designs;
  if (designs.length > 1) {
    const result = await convene({ designs, signal,
      answer: (item, { round, designs: view, standing, signal: seatSignal }) => inCopy(seatSignal, (tools, where, copy) =>
        call(conveningSeat(item.seat, offered), ({ provider, settings }) => runConvener({ provider, settings, root: where, prompt, own: item.letter, designs: view, round, standing, tools, signal: seatSignal, copy }), { convening: true })),
      runChecks: (commands, { signal: checkSignal }) => runChecks({ commands, root, place, signal: checkSignal, run }) });
    const letter = unattendedPick(result);
    entry = result.designs.find(item => item.letter === letter);
    settled = result.outcome === 'settled' && letter === result.design;
    notes = settled ? result.notes : [];
    rounds = result.rounds; history = result.history; all = result.designs;
  }

  // The brief, by the chosen design's author; the others sign it off when the swarm settled.
  const writeBrief = extra => call(entry.seat, ({ provider, settings }) => runBriefWriter({ provider, settings, root, tools: reads(signal), signal, prompt, design: entry.text, settled, notes, disputes: disputesOf(history), ...extra }));
  const brief = parseBrief(await writeBrief({}));
  const signOffs = settled && brief.usable ? await Promise.all(all.filter(item => item !== entry && !item.out).map(async item => ({ seat: item.seat,
    ...parseSignOff(await call(item.seat, ({ provider, settings }) => runSignOff({ provider, settings, root, prompt, brief: brief.text, tools: reads(signal), signal }), { convening: true })) }))) : [];

  // The build: one step through a work turn's toolbox, kept to the brief's files, then the check by other families.
  const tools = new WorkTools({ root, permission: 'auto', sandboxed: true, runCommand: run, signal, approve: async () => 'allow',
    builder: ({ brief: stepped, tools: list, handle, role = 'builder', onSeat = () => {} }) => { builderCalls++; onSeat({ model: builder.model, role }); return runBuilder({ provider: builder.provider, settings: builder.settings, root, brief: stepped, tools: list, handle, signal }); } });
  if (!brief.usable) {
    // As in the app: without a usable brief, the builder takes the design as an ordinary request.
    const { runWork } = await import('../desktop/work-agent.mjs');
    builderCalls++;
    const reply = await runWork({ provider: builder.provider, settings: builder.settings, text: `${prompt}\n\nFollow this design:\n${entry.text}`, history: [], tools, signal });
    return { reply, outcome: 'no brief', settled, rounds, designerCalls, builderCalls, designs: designs.length };
  }
  const built = await runBuild({ tools, brief, reviewers: all.filter(item => !item.out).map(item => item.seat), signal,
    check: (seat, { changes, report, brief: followed, signal: seatSignal }) => call(seat, ({ provider, settings }) => runReview({ provider, settings, tools: reads(seatSignal), changes, focus: CHECK_FOCUS, signal: seatSignal,
      history: [{ role: 'user', content: `${prompt}\n\nThe brief the builder followed:\n${followed.text}`, mode: 'work' }, { role: 'assistant', content: report || 'The builder gave no report.', mode: 'work' }] })),
    rewrite: async reason => parseBrief(await writeBrief({ reason, previous: brief.text })) });
  return { reply: buildReply(built, { author: entry.seat, rounds, signOffs }), outcome: built.outcome, settled, rounds, designerCalls, builderCalls, designs: designs.length };
}
