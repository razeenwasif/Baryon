#!/usr/bin/env node
// Fairy away from the mini, Away 1: a launch agent on the Mac Fairy lives on that starts her at login and again after a
// crash, and leaves her quit when you quit her. Run it from this Mac over SSH, as scripts/fairy-to-mini.mjs is:
//
//   node scripts/fairy-keepalive.mjs install --host mini     the agent, then Fairy started by it
//   node scripts/fairy-keepalive.mjs remove --host mini      the agent gone; Fairy keeps running until you quit her
//   add --dry-run to see what it would do
//
// A Fairy already running there keeps running; the agent watches her from then on. "Open at login" in Fairy's settings
// can stay as it is: whichever opens her at login, the watcher waits on her.
import { pathToFileURL } from 'node:url';
import { runners, tailscaleFallback, type MiniRunners } from './fairy-to-mini.mjs';

export type KeepaliveCommand = 'install' | 'remove';

export interface KeepaliveOptions {
  command: KeepaliveCommand;
  host: string;
  fallback: string | null | undefined;
  dryRun: boolean;
}

export interface KeepaliveRunParams {
  options: Pick<KeepaliveOptions, 'host'> & Partial<Pick<KeepaliveOptions, 'fallback' | 'dryRun'>>;
  run?: Pick<MiniRunners, 'remote'>;
  log?: (message: string) => void;
}

export const LABEL = 'dev.razeen.fairy.keepalive';

// The agent doesn't run Fairy itself: started by launchd, a program can't use Tailscale's command-line tool ("The
// Tailscale GUI failed to start"), so her phone link would stay closed. It runs this watcher instead, which opens her as
// the Finder does and waits until she's gone. When she quits normally she leaves a note (QUIT_NOTE, written by main.cjs
// on will-quit) and the watcher ends; a crash, a kill or a restart asked from a face leaves none, and it opens her again,
// pausing longer if she didn't last 20 seconds. launchd starts the watcher at login, and again if it's killed itself.
export const QUIT_NOTE = 'Library/Application Support/lyra-companion/quit-cleanly';
export const WATCHER = `app="$1"; note="$HOME/${QUIT_NOTE}"
while :; do
  rm -f "$note"; started=$(date +%s)
  /usr/bin/open -W --env FAIRY_KEPT_ALIVE=1 "$app" || sleep 10
  if [ -f "$note" ]; then rm -f "$note"; exit 0; fi
  echo "$(date '+%F %T') Fairy stopped without quitting; opening her again."
  if [ $(( $(date +%s) - started )) -lt 20 ]; then sleep 30; else sleep 2; fi
done`;

// The agent's property list, for a Fairy at app (the full path to Fairy.app) and a log file. KeepAlive with
// SuccessfulExit false: the watcher is started again if it's killed, not when it ends because you quit her.
export function agentPlist(app: string, log: string): string {
  const escape = (value: unknown): string => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>/bin/sh</string><string>-c</string><string>${escape(WATCHER)}</string><string>sh</string><string>${escape(app)}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>LimitLoadToSessionType</key><string>Aqua</string>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>${escape(log)}</string>
  <key>StandardErrorPath</key><string>${escape(log)}</string>
</dict>
</plist>
`;
}

// On the mini. $1 is the property list. The agent is replaced if it was there already; a Fairy already running is left
// running, and the watcher waits on her as on one it opened.
export const REMOTE_INSTALL = `set -e
agents="$HOME/Library/LaunchAgents"; plist="$agents/${LABEL}.plist"; app="$HOME/Applications/Baryon.app"
[ -d "$app" ] || { echo "Baryon isn’t in $app." >&2; exit 2; }
mkdir -p "$agents" "$HOME/Library/Logs/Fairy"
printf '%s' "$1" | sed -e "s|__APP__|$app|" -e "s|__LOG__|$HOME/Library/Logs/Fairy/keepalive.log|" > "$plist"
plutil -lint "$plist" >/dev/null
launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
sleep 1
launchctl bootstrap "gui/$(id -u)" "$plist"
i=0; while ! pgrep -f "$app/Contents/MacOS/Baryon$" >/dev/null 2>&1 && [ $i -lt 30 ]; do sleep 0.5; i=$((i+1)); done
pgrep -f "$app/Contents/MacOS/Baryon$" >/dev/null 2>&1 && echo "running=yes" || echo "running=no"`;

// Removing the agent ends the watcher; Fairy keeps running, as she was opened apart from it.
export const REMOTE_REMOVE = `plist="$HOME/Library/LaunchAgents/${LABEL}.plist"
launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null && echo "removed=yes" || echo "removed=no"
rm -f "$plist"`;

export function parseArgs(argv: readonly string[]): KeepaliveOptions {
  const [command, ...rest] = argv;
  const options: {
    command: string;
    host: string;
    fallback: string | undefined;
    dryRun: boolean;
  } = { command: command ?? '', host: 'mini', fallback: undefined, dryRun: false };
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i];
    if (word === '--host') options.host = rest[++i];
    else if (word === '--tailscale') options.fallback = rest[++i];
    else if (word === '--dry-run') options.dryRun = true;
    else throw new Error(`Not an option: ${word}`);
  }
  if (!['install', 'remove'].includes(options.command)) throw new Error('Say install or remove.');
  if (!/^[A-Za-z0-9._@-]+$/.test(options.host ?? '')) throw new Error('That isn’t a host name from your SSH config.');
  if (options.fallback !== undefined && !/^[A-Za-z0-9._@-]+$/.test(options.fallback ?? '')) throw new Error('That isn’t a Tailscale name.');
  return { ...options, command: options.command as KeepaliveCommand };
}

const lines = (text: string): Record<string, string> => Object.fromEntries(
  String(text)
    .split('\n')
    .map(line => /^([a-z_]+)=(.*)$/.exec(line.trim()))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map(match => [match[1], match[2]]),
);

export async function install({ options, run = runners(options), log = console.log }: KeepaliveRunParams): Promise<Record<string, string>> {
  log(`Installing the keep-alive agent on ${options.host}: Fairy starts at login and again after a crash.`);
  // __APP__ and __LOG__ are filled in on the mini, where $HOME is known.
  const said = lines(await run.remote(REMOTE_INSTALL, [agentPlist('__APP__', '__LOG__')], { label: 'Installing the keep-alive agent' }));
  if (options.dryRun) return said;
  log(said.running === 'yes' ? 'Fairy is running there, watched by the agent.' : 'The agent is installed, but Fairy hasn’t started yet. Check the mini.');
  return said;
}
export async function remove({ options, run = runners(options), log = console.log }: KeepaliveRunParams): Promise<Record<string, string>> {
  const said = lines(await run.remote(REMOTE_REMOVE, [], { label: 'Removing the keep-alive agent' }));
  if (!options.dryRun) log(said.removed === 'yes' ? 'The agent is gone. Fairy keeps running until you quit her.' : 'There was no agent to remove.');
  return said;
}

async function main(argv: readonly string[]): Promise<void> {
  const options = parseArgs(argv);
  if (options.fallback === undefined) options.fallback = tailscaleFallback(options.host);
  if (options.command === 'install') await install({ options });
  else await remove({ options });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
