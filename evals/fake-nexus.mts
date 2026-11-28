import type { NexusFound, NexusRunner, RunNexusResult } from '../desktop/nexus.mjs';

export interface FakeNexusJob {
  job: string;
  state: string;
  node?: string;
  name?: string;
  target?: string;
  command?: string;
  requester?: string;
  reason?: string;
  log?: string;
}

export interface FakeNexusWorld {
  defaultName?: string;
  jobs?: FakeNexusJob[];
}

export interface FakeNexusCall {
  args: string[];
}

export interface FakeNexus {
  run: NexusRunner;
  calls: FakeNexusCall[];
  jobs: FakeNexusJob[];
  submitted: FakeNexusJob[];
}

// Fake nexus CLI kept in memory, matching desktop/nexus.mjs's real Nexus class (submit, logs, listJobs, listTickets).
// Nothing reaches the real home cluster; every submission is recorded in `submitted` and listed by `jobs`/`tickets`.
export function fakeNexus(world: FakeNexusWorld = {}): FakeNexus {
  const jobs: FakeNexusJob[] = (world.jobs || []).map(j => ({ ...j }));
  const calls: FakeNexusCall[] = [], submitted: FakeNexusJob[] = [];
  const flag = (args: string[], name: string): string | undefined => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  let seq = jobs.length;

  const run: NexusRunner = async (_found: NexusFound, args: string[]): Promise<RunNexusResult> => {
    calls.push({ args });
    const [cmd] = args;
    if (cmd === 'cpu' || cmd === 'gpu') {
      const sep = args.indexOf('--');
      const command = sep >= 0 ? args.slice(sep + 1).join(' ') : '';
      const name = flag(args, '--name') || world.defaultName || 'project';
      const node = flag(args, '--on') || (cmd === 'gpu' ? 'forge' : 'atlas');
      const id = `j-${String(++seq).padStart(6, '0')}`;
      const record: FakeNexusJob = { job: id, state: 'held', node, name, target: cmd, command, requester: flag(args, '--from') || 'Fairy' };
      jobs.unshift(record);
      submitted.push(record);
      return { code: 0, out: `${id}\n`, err: `→ ${node} · queued\n`, stopped: false };
    }
    if (cmd === 'jobs') {
      const lines = jobs.map(j => `${j.job.padEnd(12)} ${j.state.padEnd(10)} ${(j.node || '-').padEnd(8)} ${String(j.name || '').slice(0, 32).padEnd(32)} ${j.reason || ''}`.trimEnd());
      return { code: 0, out: lines.length ? `${lines.join('\n')}\n` : '', err: '', stopped: false };
    }
    if (cmd === 'tickets') {
      const lines = jobs.filter(j => j.state === 'held').map(j => `${j.job.padEnd(12)} from ${j.requester || 'Fairy'}: ${j.command || ''}`);
      return { code: 0, out: lines.length ? `${lines.join('\n')}\n` : '', err: '', stopped: false };
    }
    if (cmd === 'logs') {
      const found = jobs.find(j => j.job === args[1]);
      return { code: 0, out: found?.log || '', err: '', stopped: found?.state === 'held' || found?.state === 'running' };
    }
    return { code: 1, out: '', err: `fake nexus doesn't know: ${args.join(' ')}`, stopped: false };
  };

  return { run, calls, jobs, submitted };
}
