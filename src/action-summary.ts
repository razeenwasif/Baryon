export type ActionCategory = 'commands' | 'device' | 'read' | 'search' | 'edited' | 'web' | 'other';
export type ActionIcon = 'terminal' | 'device' | 'file' | 'edit' | 'globe' | 'tool';

export interface ActivityRow {
  tool?: string;
  kind?: string;
  status?: string;
  summary?: string;
  command?: string;
  [key: string]: unknown;
}

export type ActivitySegment =
  | { type: 'action-group'; rows: ActivityRow[] }
  | { type: 'commentary' | 'thought' | 'action-live'; row: ActivityRow };

export interface ActionGroupSummary {
  icon: ActionIcon;
  text: string;
  count: number;
}

export interface LiveActionInfo {
  icon: ActionIcon;
  text: string;
}

function plural(count: number, singular: string, pluralWord = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralWord}`;
}

function capitalize(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : '';
}

function joinOxford(parts: string[]): string {
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

function shortTarget(value: unknown, limit = 44): string {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
}

function shortCommandTarget(row?: ActivityRow | null): string {
  const raw = String(row?.command || row?.summary || '').trim();
  if (!raw) return 'command';
  // Prefer the concise executable / subcommand (e.g. `vp`, `npm test`, `git status`) over long flags.
  const firstLine = raw.split(/\r?\n/)[0].trim();
  const tokens = firstLine.split(/\s+/).filter(Boolean);
  if (!tokens.length) return 'command';
  const head = tokens[0].split('/').pop() || tokens[0];
  if (tokens.length === 1 || tokens[1]?.startsWith('-')) return shortTarget(head, 36);
  return shortTarget(`${head} ${tokens[1]}`, 36);
}

const TOOL_CATEGORY: Readonly<Record<string, ActionCategory>> = Object.freeze({
  run: 'commands',
  run_command: 'commands',
  bash: 'commands',
  shell: 'commands',
  command_status: 'commands',
  send_command_input: 'commands',
  simulator: 'device',
  computer: 'device',
  read: 'read',
  read_file: 'read',
  view_file: 'read',
  read_attachment: 'read',
  inspect_data: 'read',
  list: 'search',
  list_files: 'search',
  list_dir: 'search',
  search: 'search',
  search_files: 'search',
  grep_search: 'search',
  find_by_name: 'search',
  'look-back': 'search',
  glob: 'search',
  grep: 'search',
  write: 'edited',
  write_file: 'edited',
  write_to_file: 'edited',
  edit: 'edited',
  edit_file: 'edited',
  replace_file_content: 'edited',
  multi_replace_file_content: 'edited',
  sed_file: 'edited',
  'web-search': 'web',
  web_search: 'web',
  'web-read': 'web',
  read_page: 'web',
  read_url_content: 'web',
  browser: 'web',
});

export function categorizeTool(tool = ''): ActionCategory {
  const key = String(tool || '').trim().toLowerCase();
  if (!key) return 'other';
  if (TOOL_CATEGORY[key]) return TOOL_CATEGORY[key];
  if (key.startsWith('simulator_') || key.startsWith('computer_')) return 'device';
  if (key.startsWith('browser_')) return 'web';
  return 'other';
}

const CATEGORY_ICON: Readonly<Record<ActionCategory, ActionIcon>> = Object.freeze({
  commands: 'terminal',
  device: 'device',
  read: 'file',
  search: 'file',
  edited: 'edit',
  web: 'globe',
  other: 'tool',
});

function phraseForCategory(key: ActionCategory, count: number): string {
  switch (key) {
    case 'commands': return `ran ${plural(count, 'command')}`;
    case 'device': return `used device controls ${count === 1 ? '1 time' : `${count} times`}`;
    case 'read': return `read ${plural(count, 'file')}`;
    case 'search': return `searched ${plural(count, 'time')}`;
    case 'edited': return `edited ${plural(count, 'file')}`;
    case 'web': return `browsed ${plural(count, 'source')}`;
    default: return `performed ${plural(count, 'other action')}`;
  }
}

/**
 * Segment an ordered activity stream into interleaved commentary, thoughts,
 * live running actions, and grouped completed tool bursts.
 */
export function segmentActivity(rows: ActivityRow[] = []): ActivitySegment[] {
  const segments: ActivitySegment[] = [];
  let pendingGroup: ActivityRow[] = [];

  const flushGroup = () => {
    if (!pendingGroup.length) return;
    segments.push({ type: 'action-group', rows: pendingGroup });
    pendingGroup = [];
  };

  for (const row of rows || []) {
    if (!row) continue;
    if (row.tool === 'thought') {
      flushGroup();
      segments.push({ type: row.kind === 'commentary' ? 'commentary' : 'thought', row });
      continue;
    }
    if (row.status === 'running') {
      flushGroup();
      segments.push({ type: 'action-live', row });
      continue;
    }
    pendingGroup.push(row);
  }
  flushGroup();
  return segments;
}

/**
 * Summarize a contiguous group of completed tool rows into an icon and Oxford-comma label.
 */
export function summarizeActionGroup(rows: ActivityRow[] = []): ActionGroupSummary {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (!list.length) return { icon: 'tool', text: 'Performed 0 actions', count: 0 };

  const counts = new Map<ActionCategory, number>();
  const appearanceOrder: ActionCategory[] = [];
  for (const row of list) {
    const key = categorizeTool(row.tool);
    if (!counts.has(key)) appearanceOrder.push(key);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const orderedKeys: ActionCategory[] = [
    ...appearanceOrder.filter(k => k !== 'other'),
    ...(counts.has('other') ? (['other'] as const) : []),
  ];

  const phrases = orderedKeys.map(key => phraseForCategory(key, counts.get(key) ?? 0));
  const icon: ActionIcon = orderedKeys.length === 1 ? (CATEGORY_ICON[orderedKeys[0]] || 'tool') : 'tool';
  return {
    icon,
    text: capitalize(joinOxford(phrases)),
    count: list.length,
  };
}

/**
 * Build a concise icon + label for an in-flight running tool row.
 */
export function liveActionLabel(row: ActivityRow = {}): LiveActionInfo {
  const tool = String(row.tool || '').trim().toLowerCase();
  const cat = categorizeTool(tool);
  const summary = String(row.summary || '').trim();
  const target = shortTarget(summary, 42);

  if (cat === 'commands') {
    return { icon: 'terminal', text: `Running ${shortCommandTarget(row)}` };
  }
  if (cat === 'device') {
    if (/screenshot|capture|screen/i.test(`${tool} ${summary}`)) return { icon: 'device', text: 'Taking a screenshot of the device' };
    if (/tap|click/i.test(`${tool} ${summary}`)) return { icon: 'device', text: 'Tapping on the device' };
    if (/type|input/i.test(`${tool} ${summary}`)) return { icon: 'device', text: 'Typing on the device' };
    if (/swipe|scroll/i.test(`${tool} ${summary}`)) return { icon: 'device', text: 'Scrolling on the device' };
    if (/build/i.test(`${tool} ${summary}`)) return { icon: 'device', text: 'Building app for simulator' };
    return { icon: 'device', text: target ? `Using device controls (${target})` : 'Using device controls' };
  }
  if (cat === 'read') return { icon: 'file', text: target ? `Reading ${target}` : 'Reading file' };
  if (cat === 'search') {
    if (/list/.test(tool)) return { icon: 'file', text: target ? `Listing ${target}` : 'Listing files' };
    return { icon: 'file', text: target ? `Searching ${target}` : 'Searching files' };
  }
  if (cat === 'edited') return { icon: 'edit', text: target ? `Editing ${target}` : 'Editing file' };
  if (cat === 'web') {
    if (/search/.test(tool)) return { icon: 'globe', text: target ? `Searching the web for ${target}` : 'Searching the web' };
    return { icon: 'globe', text: target ? `Checking ${target}` : 'Checking web page' };
  }
  return { icon: 'tool', text: target ? `Running ${target}` : `Running ${row.tool || 'action'}` };
}

function formatDur(ms: number): string {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return '';
  if (value < 1000) return '<1s';
  const seconds = value / 1000;
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const rem = Math.round(seconds % 60);
  return rem ? `${mins}m ${rem}s` : `${mins}m`;
}

/**
 * Derive a crisp single-line headline for a thinking block header.
 */
export function thoughtHeadline(text = '', durationMs = 0, status = 'done'): string {
  const raw = String(text || '').trim();
  if (!raw) {
    if (status === 'running') return 'Thinking';
    const dur = formatDur(durationMs);
    return dur ? `Thought for ${dur}` : 'Thought';
  }
  const stripped = raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*•]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!stripped) {
    if (status === 'running') return 'Thinking';
    const dur = formatDur(durationMs);
    return dur ? `Thought for ${dur}` : 'Thought';
  }
  return stripped.length > 96 ? `${stripped.slice(0, 95)}…` : stripped;
}
