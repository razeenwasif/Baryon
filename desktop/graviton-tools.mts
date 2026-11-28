// Graviton's container-engine tools for Fairy (mirrors Lyra's flux-tools.mjs).
// When Graviton asks Fairy something from its Fairy panel, the ask carries the path of a socket
// Graviton listens on (`fairy-tools.sock` in Application Support/Graviton) and a fresh key valid
// only for that turn. High-impact or destructive actions are gated inside Graviton behind a
// Touch ID prompt to the user. One line of JSON each way:
//   → {id, token, tool, args}   ← {id, result} or {id, error}
import net from 'node:net';
import { defineTool, type ToolScope } from './tool-registry.mjs';

const LINE_LIMIT = 4 << 20;

export const GRAVITON_STEPS = Object.freeze([
  'status',
  'events',
  'switch_host',
  'navigate',
  'containers',
  'inspect',
  'logs',
  'stats',
  'container_action',
  'run',
  'exec',
  'commit_container',
  'stack_action',
  'compose',
  'list_files',
  'read_file',
  'copy_files',
  'images',
  'pull',
  'build',
  'tag_image',
  'push_image',
  'save_image',
  'load_image',
  'remove_image',
  'volumes',
  'volume_action',
  'network',
  'disk_and_prune',
  'snapshots',
  'list_logins',
]);

export interface GravitonBridgeOptions {
  socket: string;
  token: string;
  timeout?: number;
  connect?: (path: string) => net.Socket;
}

/** Graviton, as one turn's tools reach it. `socket` and `token` come from Graviton's ask. */
export class GravitonBridge {
  socket: string;
  token: string;
  timeout: number;
  connect: (path: string) => net.Socket;
  seq: number;

  constructor({ socket, token, timeout = 10 * 60 * 1000, connect = path => net.createConnection(path) }: GravitonBridgeOptions) {
    if (typeof socket !== 'string' || !socket.startsWith('/') || !socket.endsWith('.sock') || socket.length > 200) {
      throw new Error('Graviton sent no usable tool socket.');
    }
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(token)) {
      throw new Error('Graviton sent no usable tool key.');
    }
    this.socket = socket;
    this.token = token;
    this.timeout = timeout;
    this.connect = connect;
    this.seq = 0;
  }

  /** Ask Graviton to run `tool` with `args`; resolves with its result, or rejects with its refusal/denial. */
  call(tool: string, args: Record<string, unknown> = {}, signal?: AbortSignal | null): Promise<unknown> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const conn = this.connect(this.socket);
      let buffer = '', settled = false;
      const finish = (error: Error | null, value?: unknown): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener?.('abort', onAbort);
        conn.destroy();
        error ? reject(error) : resolve(value);
      };
      const onAbort = (): void => finish(Object.assign(new Error('Stopped.'), { name: 'AbortError' }));
      const timer = setTimeout(() => finish(new Error('Graviton took too long to answer.')), this.timeout);
      signal?.addEventListener?.('abort', onAbort, { once: true });
      conn.setEncoding('utf8');
      conn.on('connect', () => conn.write(`${JSON.stringify({ id, token: this.token, tool, args })}\n`));
      conn.on('data', (chunk: string | Buffer) => {
        buffer += chunk;
        if (buffer.length > LINE_LIMIT) return finish(new Error("Graviton's answer was too long."));
        const at = buffer.indexOf('\n');
        if (at < 0) return;
        let message: { error?: unknown; result?: unknown } | null;
        try { message = JSON.parse(buffer.slice(0, at)) as { error?: unknown; result?: unknown } | null; } catch { return finish(new Error('Graviton sent something that was not JSON.')); }
        if (message?.error) finish(new Error(String(message.error)));
        else finish(null, message?.result ?? null);
      });
      conn.on('error', (error: Error) => finish(new Error(`Graviton isn't reachable: ${error.message}`)));
      conn.on('close', () => finish(new Error('Graviton closed the connection.')));
    });
  }
}

const call = (tool: string) => (args: Record<string, unknown>, { graviton, signal }: ToolScope): Promise<unknown> =>
  (graviton as GravitonBridge).call(tool, args, signal);
const containerProp = { type: 'string', description: 'Container name, full ID, or unique ID prefix.' };
const reasonProp = { type: 'string', description: 'Why, in a few words, shown to the user and in any Touch ID prompt.' };
const strList = (description: string) => ({ type: 'array', items: { type: 'string' }, description });

export const GRAVITON_TOOLS = [
  defineTool({
    name: 'graviton_status',
    description: 'Get the current Graviton engine status: active host (This Mac or paired remote Mac), connection state, kernel, architecture, Rosetta availability, CPU/RAM usage, container/image/volume counts, Compose stacks, and paired hosts.',
    run: call('status'),
  }),
  defineTool({
    name: 'graviton_events',
    description: 'Read recent Graviton engine events (container starts, stops, failures, pulls, builds, removals).',
    properties: {
      limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Maximum number of recent events (default 50).' },
    },
    run: call('events'),
  }),
  defineTool({
    name: 'graviton_switch_host',
    risk: 'write',
    description: 'Switch the active Mac in Graviton between "local" (This Mac) and any paired remote Mac (e.g. "mini").',
    properties: {
      host: { type: 'string', description: 'Host name ("local" or "This Mac" for this Mac, or a paired Mac name like "mini").' },
      reason: reasonProp,
    },
    required: ['host'],
    run: call('switch_host'),
  }),
  defineTool({
    name: 'graviton_navigate',
    description: 'Navigate the Graviton Mac window to a section (containers, images, volumes, networks, settings) or open a specific container detail tab.',
    properties: {
      section: { type: 'string', enum: ['containers', 'images', 'volumes', 'networks', 'settings'], description: 'Sidebar section to show.' },
      container: { ...containerProp, description: 'Optional container ID or name to open when section is containers.' },
      tab: { type: 'string', enum: ['overview', 'logs', 'terminal', 'files', 'stats', 'inspect'], description: 'Detail tab to open when container is specified.' },
    },
    required: ['section'],
    run: call('navigate'),
  }),
  defineTool({
    name: 'graviton_containers',
    description: 'List containers on the active Mac, optionally filtered by status or Compose project/stack.',
    properties: {
      filter: { type: 'string', enum: ['all', 'running', 'paused', 'stopped'], description: 'Status filter (default all).' },
      project: { type: 'string', description: 'Optional Compose stack/project name filter.' },
    },
    run: call('containers'),
  }),
  defineTool({
    name: 'graviton_inspect',
    description: 'Inspect a container configuration: image, command, working directory, user, hostname, CPUs/memory, ports, mounts, architecture/Rosetta, Compose stack/service/labels, and redacted environment variables.',
    properties: {
      container: containerProp,
      include_env_values: { type: 'boolean', description: 'If true, include non-secret env values (secret-looking values remain masked).' },
    },
    required: ['container'],
    run: call('inspect'),
  }),
  defineTool({
    name: 'graviton_logs',
    description: 'Read log lines from a container, optionally filtering by severity, time window, or tail count.',
    properties: {
      container: containerProp,
      tail: { type: 'integer', minimum: 1, maximum: 500, description: 'Number of trailing lines (default 100).' },
      level: { type: 'string', enum: ['debug', 'info', 'warn', 'error'], description: 'Minimum log level filter.' },
      since: { type: 'string', description: 'Only include logs since timestamp or relative duration (e.g. "5m", "2h", epoch seconds, or RFC 3339).' },
      until: { type: 'string', description: 'Only include logs before timestamp or relative duration.' },
    },
    required: ['container'],
    run: call('logs'),
  }),
  defineTool({
    name: 'graviton_stats',
    description: 'Get live CPU, memory, network RX/TX stats and running process list (`top`) for a running container.',
    properties: {
      container: containerProp,
    },
    required: ['container'],
    run: call('stats'),
  }),
  defineTool({
    name: 'graviton_container_action',
    risk: 'write',
    description: 'Start, restart, pause, unpause, stop, or remove a container. `pause`, `stop`, and `remove` require Touch ID approval.',
    properties: {
      container: containerProp,
      action: { type: 'string', enum: ['start', 'stop', 'restart', 'pause', 'unpause', 'remove'], description: 'Lifecycle action to perform.' },
      reason: reasonProp,
    },
    required: ['container', 'action', 'reason'],
    run: call('container_action'),
  }),
  defineTool({
    name: 'graviton_run',
    risk: 'write',
    description: 'Create and start a new container VM from an image (pulls if missing). Requires Touch ID approval.',
    properties: {
      image: { type: 'string', description: 'Image reference, e.g. "alpine:3.22" or "postgres:17-alpine".' },
      name: { type: 'string', description: 'Optional container name.' },
      command: strList('Optional command and arguments replacing image Cmd.'),
      entrypoint: strList('Optional entrypoint override.'),
      env: strList('Environment entries as KEY=VALUE.'),
      ports: strList('Port mappings like "8080:80", "0.0.0.0:5353:53/udp".'),
      volumes: strList('Volume/bind mounts like "pgdata:/var/lib/postgresql/data" or "~/code:/app:ro".'),
      cpus: { type: 'integer', minimum: 1, maximum: 32, description: 'Number of vCPUs.' },
      memory_mib: { type: 'integer', minimum: 128, maximum: 65536, description: 'Memory limit in MiB.' },
      working_dir: { type: 'string', description: 'Working directory inside container.' },
      user: { type: 'string', description: 'User (name, uid, or uid:gid).' },
      hostname: { type: 'string', description: 'Container hostname.' },
      restart: { type: 'string', enum: ['no', 'on-failure', 'always'], description: 'Automatic restart policy.' },
      platform: { type: 'string', description: 'Target platform e.g. "linux/arm64" or "linux/amd64".' },
      project: { type: 'string', description: 'Optional Compose project/stack name.' },
      service: { type: 'string', description: 'Optional Compose service name.' },
      read_only: { type: 'boolean', description: 'Mount the container root filesystem read-only (`--read-only`).' },
      init: { type: 'boolean', description: 'Run `docker-init` zombie reaper as PID 1 (`--init`).' },
      cap_drop: strList('Linux capabilities to drop (e.g. ["ALL"] or ["NET_RAW"]).'),
      cap_add: strList('Linux capabilities to add (e.g. ["NET_BIND_SERVICE"]).'),
      tmpfs: strList('Ephemeral tmpfs mounts like "/tmp:rw,noexec,size=64m".'),
      reason: reasonProp,
    },
    required: ['image', 'reason'],
    run: call('run'),
  }),
  defineTool({
    name: 'graviton_exec',
    risk: 'write',
    description: 'Run a non-interactive command inside a running container and return stdout/stderr + exit code. Requires Touch ID approval.',
    properties: {
      container: containerProp,
      command: strList('Command argv array, e.g. ["sh", "-c", "ls -la /app"].'),
      env: strList('Optional extra KEY=VALUE env vars.'),
      reason: reasonProp,
    },
    required: ['container', 'command', 'reason'],
    run: call('exec'),
  }),
  defineTool({
    name: 'graviton_stack_action',
    risk: 'write',
    description: 'Start, restart, or stop all containers in a Compose stack. `stop` requires Touch ID approval.',
    properties: {
      project: { type: 'string', description: 'Compose stack/project name.' },
      action: { type: 'string', enum: ['start', 'stop', 'restart'], description: 'Stack lifecycle action.' },
      reason: reasonProp,
    },
    required: ['project', 'action', 'reason'],
    run: call('stack_action'),
  }),
  defineTool({
    name: 'graviton_compose',
    risk: 'write',
    description: 'Run a `grav compose` workflow on a folder containing compose.yaml / docker-compose.yml (supports config, up, down, ps, logs, stop, start, restart, build). `up`, `down`, `stop`, and `build` require Touch ID approval.',
    properties: {
      action: { type: 'string', enum: ['config', 'up', 'down', 'ps', 'logs', 'stop', 'start', 'restart', 'build'], description: 'Compose subcommand.' },
      directory: { type: 'string', description: 'Directory containing compose.yaml / docker-compose.yml.' },
      files: strList('Optional explicit compose file paths (-f).'),
      project: { type: 'string', description: 'Optional project name override (-p).' },
      profiles: strList('Optional profiles to enable (--profile).'),
      services: strList('Optional subset of service names.'),
      volumes: { type: 'boolean', description: 'For `down`: also remove declared named volumes (-v).' },
      build: { type: 'boolean', description: 'For `up`: rebuild images before starting (--build).' },
      no_cache: { type: 'boolean', description: 'For `build`: build without layer cache (--no-cache).' },
      force_recreate: { type: 'boolean', description: 'For `up`: recreate existing containers (--force-recreate).' },
      timestamps: { type: 'boolean', description: 'For `logs`: include RFC 3339 timestamps (`-t`).' },
      since: { type: 'string', description: 'For `logs`: filter logs since timestamp or relative duration (e.g. "10m", "2026-11-22T10:00:00Z").' },
      until: { type: 'string', description: 'For `logs`: filter logs before timestamp or relative duration.' },
      tail: { type: 'integer', minimum: 1, maximum: 500, description: 'For `logs`: number of lines per service.' },
      reason: reasonProp,
    },
    required: ['action', 'directory', 'reason'],
    run: call('compose'),
  }),
  defineTool({
    name: 'graviton_list_files',
    description: 'List directory entries (files, directories, symlinks, sizes, modes) inside a running container.',
    properties: {
      container: containerProp,
      path: { type: 'string', description: 'Absolute path inside the container (default "/").' },
    },
    required: ['container'],
    run: call('list_files'),
  }),
  defineTool({
    name: 'graviton_read_file',
    description: 'Read the contents of a file (up to 256 KiB) inside a running container.',
    properties: {
      container: containerProp,
      path: { type: 'string', description: 'Absolute file path inside the container.' },
    },
    required: ['container', 'path'],
    run: call('read_file'),
  }),
  defineTool({
    name: 'graviton_copy_files',
    risk: 'write',
    description: 'Copy files or folders between this Mac and a running container (upload or download). Requires Touch ID approval.',
    properties: {
      direction: { type: 'string', enum: ['upload', 'download'], description: 'Transfer direction.' },
      container: containerProp,
      local_path: { type: 'string', description: 'Absolute path on this Mac.' },
      container_path: { type: 'string', description: 'Absolute path inside the container.' },
      reason: reasonProp,
    },
    required: ['direction', 'container', 'local_path', 'container_path', 'reason'],
    run: call('copy_files'),
  }),
  defineTool({
    name: 'graviton_images',
    description: 'List local OCI images on the active Mac with tags, sizes, architectures, and container reference counts.',
    run: call('images'),
  }),
  defineTool({
    name: 'graviton_pull',
    risk: 'write',
    description: 'Pull an OCI image from its registry to the active Mac.',
    properties: {
      reference: { type: 'string', description: 'Image reference, e.g. "postgres:17-alpine" or "ghcr.io/org/app:latest".' },
      platform: { type: 'string', description: 'Optional platform override, e.g. "linux/amd64" or "linux/arm64".' },
      reason: reasonProp,
    },
    required: ['reference'],
    run: call('pull'),
  }),
  defineTool({
    name: 'graviton_build',
    risk: 'write',
    description: 'Build an OCI image (single or comma-separated multi-arch platforms such as "linux/arm64,linux/amd64" producing an OCI Image Index) from a local Dockerfile/context on the active Mac (uploads context automatically when targeting a remote Mac). Requires Touch ID approval.',
    properties: {
      context: { type: 'string', description: 'Local build context directory path.' },
      dockerfile: { type: 'string', description: 'Optional Dockerfile path (default context/Dockerfile).' },
      tag: { type: 'string', description: 'Optional image name[:tag].' },
      build_args: strList('Optional build-time ARG KEY=VALUE pairs.'),
      target: { type: 'string', description: 'Optional multi-stage build target.' },
      no_cache: { type: 'boolean', description: 'Rebuild without layer cache.' },
      platform: { type: 'string', description: 'Optional target platform(s), e.g. "linux/arm64", "linux/amd64", or comma-separated "linux/arm64,linux/amd64" for multi-arch OCI Image Index.' },
      reason: reasonProp,
    },
    required: ['context', 'reason'],
    run: call('build'),
  }),
  defineTool({
    name: 'graviton_tag_image',
    risk: 'write',
    description: 'Tag an existing local OCI image under an additional name or registry reference without copying layers.',
    properties: {
      source: { type: 'string', description: 'Existing local image reference, e.g. "myapp:latest".' },
      target: { type: 'string', description: 'New tag or registry reference, e.g. "ghcr.io/org/myapp:1.0".' },
      reason: reasonProp,
    },
    required: ['source', 'target'],
    run: call('tag_image'),
  }),
  defineTool({
    name: 'graviton_push_image',
    risk: 'write',
    description: 'Push a local single-arch or multi-arch OCI Image Index to its registry using saved `grav login` Keychain credentials. Requires Touch ID approval.',
    properties: {
      reference: { type: 'string', description: 'Local image reference to push, e.g. "ghcr.io/org/myapp:1.0".' },
      reason: reasonProp,
    },
    required: ['reference', 'reason'],
    run: call('push_image'),
  }),
  defineTool({
    name: 'graviton_commit_container',
    risk: 'write',
    description: 'Snapshot a container filesystem and optional Dockerfile config overrides into a new local OCI image. Requires Touch ID approval.',
    properties: {
      container: containerProp,
      reference: { type: 'string', description: 'Target image reference (repo[:tag]); omit to default to committed:<short_id>.' },
      author: { type: 'string', description: 'Optional author metadata.' },
      message: { type: 'string', description: 'Optional commit message.' },
      changes: strList('Optional Dockerfile instructions (ENV, CMD, ENTRYPOINT, WORKDIR, USER, EXPOSE, LABEL, VOLUME, STOPSIGNAL, HEALTHCHECK).'),
      reason: reasonProp,
    },
    required: ['container', 'reason'],
    run: call('commit_container'),
  }),
  defineTool({
    name: 'graviton_save_image',
    risk: 'write',
    description: 'Export one or more local OCI images to a Docker/OCI `.tar` archive file on disk. Requires Touch ID approval.',
    properties: {
      references: strList('One or more image references to include in the archive.'),
      output_path: { type: 'string', description: 'Destination `.tar` file path on this Mac.' },
      reason: reasonProp,
    },
    required: ['references', 'output_path', 'reason'],
    run: call('save_image'),
  }),
  defineTool({
    name: 'graviton_load_image',
    risk: 'write',
    description: 'Import one or more OCI/Docker images from a `.tar` or `.tar.gz` archive on disk into the active Mac. Requires Touch ID approval.',
    properties: {
      input_path: { type: 'string', description: 'Path to `.tar` or `.tar.gz` image archive on this Mac.' },
      reason: reasonProp,
    },
    required: ['input_path', 'reason'],
    run: call('load_image'),
  }),
  defineTool({
    name: 'graviton_remove_image',
    risk: 'write',
    description: 'Remove an unused image from the active Mac. Requires Touch ID approval.',
    properties: {
      reference: { type: 'string', description: 'Image reference to remove.' },
      reason: reasonProp,
    },
    required: ['reference', 'reason'],
    run: call('remove_image'),
  }),
  defineTool({
    name: 'graviton_volumes',
    description: 'List named volumes on the active Mac (size, file count, paths, and attached containers).',
    run: call('volumes'),
  }),
  defineTool({
    name: 'graviton_volume_action',
    risk: 'write',
    description: 'Create or remove a named volume. `remove` requires Touch ID approval.',
    properties: {
      action: { type: 'string', enum: ['create', 'remove'], description: 'Volume action.' },
      name: { type: 'string', description: 'Volume name (starts with ASCII letter/digit; [A-Za-z0-9_.-]).' },
      reason: reasonProp,
    },
    required: ['action', 'name', 'reason'],
    run: call('volume_action'),
  }),
  defineTool({
    name: 'graviton_network',
    description: 'Inspect Graviton\'s shared L2 container switch, subnet, embedded DNS server, container IPs/DNS aliases, forwarded bytes/frames, and published ports.',
    run: call('network'),
  }),
  defineTool({
    name: 'graviton_disk_and_prune',
    risk: 'write',
    description: 'Check disk usage (`usage`), preview reclaimable space (`prune_dry_run`), or prune build cache / unused layers / images / stopped containers (`prune`). Actual `prune` requires Touch ID approval.',
    properties: {
      action: { type: 'string', enum: ['usage', 'prune_dry_run', 'prune'], description: 'Disk usage or prune mode.' },
      images: { type: 'boolean', description: 'Also include unused images when pruning.' },
      containers: { type: 'boolean', description: 'Also include stopped containers when pruning.' },
      reason: reasonProp,
    },
    required: ['action', 'reason'],
    run: call('disk_and_prune'),
  }),
  defineTool({
    name: 'graviton_snapshots',
    risk: 'write',
    description: 'Inspect VM snapshot pool status (`status`), pre-warm snapshots (`warm`), or clear idle snapshots (`clear`). `warm` and `clear` require Touch ID approval.',
    properties: {
      action: { type: 'string', enum: ['status', 'warm', 'clear'], description: 'Snapshot action.' },
      cpus: { type: 'integer', minimum: 1, maximum: 32, description: 'vCPUs for `warm` (default 2).' },
      memory_mib: { type: 'integer', minimum: 128, maximum: 65536, description: 'Memory in MiB for `warm` (default 1024).' },
      rosetta: { type: 'boolean', description: 'Warm a Rosetta-enabled snapshot slot.' },
      slots: { type: 'integer', minimum: 1, maximum: 8, description: 'Number of slots to warm (default 1).' },
      reason: reasonProp,
    },
    required: ['action', 'reason'],
    run: call('snapshots'),
  }),
  defineTool({
    name: 'graviton_list_logins',
    description: 'List saved OCI registry logins (registry hostname and username only; passwords/tokens stay in Keychain) on the active Mac.',
    run: call('list_logins'),
  }),
];
