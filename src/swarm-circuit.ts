// Pure SVG circuit-graph layout, timeline synthesizer, and colored Fairy Eye avatar renderer
// for Fairy's live Parallel Agent Swarm pane (src/swarm-pane.js).

export interface EyeColorPalette {
  readonly name: string;
  readonly disc: string;
  readonly discShade: string;
  readonly casing: string;
  readonly iris: string;
  readonly irisLight: string;
  readonly lav: string;
  readonly glow: string;
}

export type EyeState = 'idle' | 'working' | 'done' | 'error';

export interface FairyEyeOptions {
  size?: number;
  state?: EyeState;
  uid?: string;
}

export interface SwarmAgentStep {
  tool?: string;
  summary?: string;
  detail?: string;
  status?: string;
}

export interface SwarmAgentChange {
  path: string;
  kind?: string;
  added?: number;
  removed?: number;
}

export interface SwarmAgentSeat {
  provider?: string;
  model?: string;
}

export interface SwarmMergeResult {
  applied?: string[];
}

export interface SwarmAgent {
  id: string;
  role?: string;
  kind?: string;
  provider?: string;
  seat?: SwarmAgentSeat;
  scope?: string[];
  dependsOn?: string[];
  task?: string;
  status?: string;
  startedAt?: string;
  endedAt?: string;
  steps?: SwarmAgentStep[];
  changes?: SwarmAgentChange[];
  error?: string;
  report?: string;
  mergeResult?: SwarmMergeResult;
}

export interface SwarmState {
  chat?: string;
  status?: string;
  startedAt?: string;
  endedAt?: string;
  agents?: SwarmAgent[];
}

export interface CircuitNode {
  id: string;
  name: string;
  role: string;
  kind: string;
  provider?: string;
  model?: string;
  scope?: string[];
  dependsOn?: string[];
  status?: string;
  changes?: SwarmAgentChange[];
  steps?: SwarmAgentStep[];
  error?: string;
  report?: string;
  stage: number;
  lane: number;
  stageSize?: number;
  color: EyeColorPalette;
}

export interface StageBucketEntry {
  agent: SwarmAgent;
  index: number;
  stage: number;
}

export interface CircuitStagesResult {
  nodes: Map<string, CircuitNode>;
  maxStage: number;
  maxLanes: number;
  stageBuckets: Map<number, StageBucketEntry[]>;
  stageLabels: string[];
}

export interface CircuitTimelineEvent {
  step: number;
  from: string;
  to: string[];
  kind: string;
  tool: string;
  at: string;
  summary: string;
  files?: string[];
}

export type CircuitTimelineEventInput = Omit<CircuitTimelineEvent, 'step'>;

export interface Point {
  x: number;
  y: number;
}

export interface CircuitLayout {
  vertical: boolean;
  stageCols: number[];
  laneRows: number[];
  nw: number;
  nh: number;
  returnLine: number;
}

export interface CircuitEdge {
  from: string;
  target: string;
  kind: string;
  count: number;
}

export interface CircuitPathEdge {
  from: string;
  target: string;
  kind: string;
}

export interface CircuitPathOptions {
  vertical?: boolean;
  busOffset?: number;
  nw?: number;
  nh?: number;
  returnLine?: number;
}

export interface BuildCircuitModelOptions {
  vertical?: boolean;
  step?: number | null;
  hideInactive?: boolean;
}

export interface CircuitModel {
  swarm: SwarmState | null | undefined;
  nodes: Map<string, CircuitNode>;
  coords: Map<string, Point>;
  layout: CircuitLayout;
  width: number;
  height: number;
  stageLabels: string[];
  timeline: CircuitTimelineEvent[];
  clampedStep: number;
  currentEvent: CircuitTimelineEvent | null;
  edges: CircuitEdge[];
  everActive: Set<string>;
  hideInactive: boolean;
}

export interface RenderCircuitSvgOptions {
  selectedId?: string | null;
}

export const COORDINATOR_EYE_COLOR: EyeColorPalette = Object.freeze({
  name: 'iris',
  disc: '#3e5aec',
  discShade: '#263dbd',
  casing: '#14172b',
  iris: '#5f7cff',
  irisLight: '#9fb2ff',
  lav: '#c7d2fe',
  glow: '#3e5aec',
});

export const AGENT_EYE_PALETTE: readonly EyeColorPalette[] = Object.freeze([
  Object.freeze({
    name: 'violet',
    disc: '#7c3aed',
    discShade: '#5b21b6',
    casing: '#1e1635',
    iris: '#a855f7',
    irisLight: '#d8b4fe',
    lav: '#ddd6fe',
    glow: '#8b5cf6',
  }),
  Object.freeze({
    name: 'emerald',
    disc: '#059669',
    discShade: '#047857',
    casing: '#0d261f',
    iris: '#34d399',
    irisLight: '#a7f3d0',
    lav: '#a7f3d0',
    glow: '#10b981',
  }),
  Object.freeze({
    name: 'amber',
    disc: '#d97706',
    discShade: '#b45309',
    casing: '#2c1808',
    iris: '#fbbf24',
    irisLight: '#fde68a',
    lav: '#fed7aa',
    glow: '#f59e0b',
  }),
  Object.freeze({
    name: 'cyan',
    disc: '#0891b2',
    discShade: '#0e7490',
    casing: '#0b2530',
    iris: '#38bdf8',
    irisLight: '#bae6fd',
    lav: '#a5f3fc',
    glow: '#06b6d4',
  }),
  Object.freeze({
    name: 'rose',
    disc: '#e11d48',
    discShade: '#be123c',
    casing: '#2c0d19',
    iris: '#fb7185',
    irisLight: '#fecdd3',
    lav: '#fbcfe8',
    glow: '#f43f5e',
  }),
  Object.freeze({
    name: 'teal',
    disc: '#0d9488',
    discShade: '#115e59',
    casing: '#0b2524',
    iris: '#2dd4bf',
    irisLight: '#99f6e4',
    lav: '#ccfbf1',
    glow: '#14b8a6',
  }),
]);

export function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function eyeStateForAgent(status?: string | null): EyeState {
  if (status === 'running' || status === 'copying') return 'working';
  if (status === 'done' || status === 'merged') return 'done';
  if (status === 'failed') return 'error';
  return 'idle';
}

export function colorForAgent(
  agent?: { id?: string; kind?: string; role?: string } | null,
  index = 0,
): EyeColorPalette {
  const idMatch = /^A(\d+)$/i.exec(String(agent?.id || ''));
  const idx = idMatch ? Math.max(0, Number(idMatch[1]) - 1) : Math.max(0, Number(index) || 0);
  if (agent?.kind === 'read' && /verif|audit|review/i.test(String(agent?.role || ''))) {
    return AGENT_EYE_PALETTE[3]; // cyan verifier signature
  }
  return AGENT_EYE_PALETTE[idx % AGENT_EYE_PALETTE.length];
}

let eyeUidCounter = 0;

export function fairyEyeSVG(
  color: EyeColorPalette | null = COORDINATOR_EYE_COLOR,
  { size = 28, state = 'idle', uid = '' }: FairyEyeOptions = {},
): string {
  const palette = color || COORDINATOR_EYE_COLOR;
  const id = uid ? String(uid).replace(/[^a-zA-Z0-9_-]/g, '') : `fe-${++eyeUidCounter}`;
  const isDone = state === 'done';
  const isWorking = state === 'working';
  const isError = state === 'error';
  const look = isWorking ? '2 -2' : isError ? '0 1' : '0 0';

  return `<svg width="${size}" height="${size}" viewBox="0 0 80 80" fill="none" aria-hidden="true">`
    + `<defs>`
    + `<radialGradient id="${id}-halo" cx="50%" cy="50%" r="50%">`
    + `<stop offset="68%" stop-color="${escapeXml(palette.glow)}" stop-opacity=".44"/>`
    + `<stop offset="100%" stop-color="${escapeXml(palette.glow)}" stop-opacity="0"/>`
    + `</radialGradient>`
    + `<linearGradient id="${id}-disc" x1="15%" y1="15%" x2="85%" y2="85%">`
    + `<stop offset="0%" stop-color="${escapeXml(palette.disc)}"/>`
    + `<stop offset="100%" stop-color="${escapeXml(palette.discShade)}"/>`
    + `</linearGradient>`
    + `</defs>`
    + `<circle cx="40" cy="41" r="38" fill="url(#${id}-halo)"/>`
    + `<circle cx="40" cy="41" r="30.2" fill="#e8eeff" fill-opacity=".86"/>`
    + `<circle cx="40" cy="41" r="29" fill="url(#${id}-disc)"/>`
    + `<g transform="rotate(45 40 41)" fill="${escapeXml(palette.casing)}">`
    + `<rect x="20" y="20" width="40" height="40" rx="12"/>`
    + `<rect x="35" y="13" width="10" height="54" rx="4"/>`
    + `<rect x="13" y="35" width="54" height="10" rx="4"/>`
    + `</g>`
    + `<rect x="19" y="20" width="42" height="42" rx="14" fill="${escapeXml(palette.casing)}"/>`
    + `<circle cx="40" cy="41.5" r="18" fill="#eef0f8"/>`
    + (isDone
      ? `<path d="M26 44 Q40 28 54 44" stroke="${escapeXml(palette.disc)}" stroke-width="5.2" stroke-linecap="round" fill="none"/>`
        + `<path d="M27 42 Q40 26.5 53 42" stroke="#ffffff" stroke-width="2" stroke-linecap="round" fill="none" opacity=".72"/>`
      : isError
        ? `<path d="M29 33 L51 50 M51 33 L29 50" stroke="#e11d48" stroke-width="4.5" stroke-linecap="round"/>`
        : `<g transform="translate(${look})">`
          + `<circle cx="40" cy="41.5" r="13.5" fill="${escapeXml(palette.lav)}"/>`
          + `<circle cx="40" cy="41.5" r="10.4" fill="${escapeXml(palette.iris)}"${isWorking ? ' stroke="#fff" stroke-opacity=".55" stroke-width="1.6" stroke-dasharray="4 3"' : ''}/>`
          + `<circle cx="40" cy="41.5" r="7.4" fill="${escapeXml(palette.casing)}"/>`
          + `<circle cx="44.2" cy="46.8" r="3.4" fill="#fafbff"/>`
          + `</g>`
          + (isWorking ? `<path d="M21 31 Q40 24 59 31" stroke="${escapeXml(palette.casing)}" stroke-width="6" stroke-linecap="round"/>` : ''))
    + `</svg>`;
}

export function computeCircuitStages(agents: SwarmAgent[] = []): CircuitStagesResult {
  const list = Array.isArray(agents) ? agents : [];
  const byId = new Map<string, { agent: SwarmAgent; index: number }>(
    list.map((a, i) => [a.id, { agent: a, index: i }]),
  );
  const memo = new Map<string, number>();

  const stageOf = (id: string, visiting = new Set<string>()): number => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 1;
    visiting.add(id);
    const entry = byId.get(id);
    const deps = Array.isArray(entry?.agent?.dependsOn) ? entry.agent.dependsOn : [];
    let maxDep = 0;
    for (const dep of deps) {
      if (byId.has(dep)) maxDep = Math.max(maxDep, stageOf(dep, visiting));
    }
    visiting.delete(id);
    const st = maxDep + 1;
    memo.set(id, st);
    return st;
  };

  for (const a of list) stageOf(a.id);

  const stageBuckets = new Map<number, StageBucketEntry[]>();
  list.forEach((agent, index) => {
    const st = memo.get(agent.id) || 1;
    let bucket = stageBuckets.get(st);
    if (!bucket) {
      bucket = [];
      stageBuckets.set(st, bucket);
    }
    bucket.push({ agent, index, stage: st });
  });

  const nodes = new Map<string, CircuitNode>();
  nodes.set('coordinator', {
    id: 'coordinator',
    name: '@coordinator',
    role: 'Orchestrator',
    kind: 'coordinator',
    stage: 0,
    lane: 0,
    color: COORDINATOR_EYE_COLOR,
  });

  const stageNumbers = [...stageBuckets.keys()].sort((a, b) => a - b);
  let maxLanes = 1;
  for (const st of stageNumbers) {
    const bucket = stageBuckets.get(st) ?? [];
    maxLanes = Math.max(maxLanes, bucket.length);
    bucket.forEach(({ agent, index }, lane) => {
      nodes.set(agent.id, {
        id: agent.id,
        name: `@${agent.id}`,
        role: agent.role || agent.id,
        kind: agent.kind || 'write',
        provider: agent.seat?.provider || agent.provider || 'auto',
        model: agent.seat?.model || '',
        scope: agent.scope || [],
        dependsOn: agent.dependsOn || [],
        status: agent.status || 'queued',
        changes: agent.changes || [],
        steps: agent.steps || [],
        error: agent.error || '',
        report: agent.report || '',
        stage: st,
        lane,
        stageSize: bucket.length,
        color: colorForAgent(agent, index),
      });
    });
  }

  const maxStage = stageNumbers.length ? Math.max(...stageNumbers) : 1;
  const stageLabels: string[] = [];
  for (let s = 0; s <= maxStage; s += 1) {
    if (s === 0) stageLabels.push('01 DISPATCH');
    else if (s === 1) stageLabels.push(`0${s + 1} PARALLEL BRANCHES`);
    else stageLabels.push(`0${s + 1} ${s === maxStage ? 'VERIFY & DOWNSTREAM' : `STAGE ${s}`}`);
  }

  return { nodes, maxStage, maxLanes, stageBuckets, stageLabels };
}

function summarizeTask(text: unknown): string {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > 110 ? `${clean.slice(0, 107)}…` : clean;
}

export function buildCircuitTimeline(swarm?: SwarmState | null): CircuitTimelineEvent[] {
  const agents = Array.isArray(swarm?.agents) ? swarm.agents : [];
  if (!agents.length) return [];

  const events: CircuitTimelineEvent[] = [];
  const push = (ev: CircuitTimelineEventInput): void => {
    events.push({ step: events.length + 1, ...ev });
  };

  // 1. Coordinator dispatches root and queued missions
  for (const agent of agents) {
    const firstDep = agent.dependsOn?.[0];
    if (!firstDep) {
      push({
        from: 'coordinator',
        to: [agent.id],
        kind: 'direct',
        tool: 'dispatch',
        at: agent.startedAt || swarm?.startedAt || '',
        summary: `${agent.role || agent.id}: ${summarizeTask(agent.task) || 'Assigned mission'}`,
      });
    } else {
      push({
        from: firstDep,
        to: [agent.id],
        kind: 'handoff',
        tool: 'handoff',
        at: agent.startedAt || '',
        summary: `Upstream ${(agent.dependsOn ?? []).join(', ')} hands off to @${agent.id} (${agent.role || agent.id})`,
      });
    }
  }

  // 2. Agent live steps + outcomes interleaved in stable stage/order
  for (const agent of agents) {
    const steps = Array.isArray(agent.steps) ? agent.steps : [];
    const slice = steps.slice(-4);
    for (const s of slice) {
      push({
        from: agent.id,
        to: [agent.id],
        kind: 'step',
        tool: s.tool || 'step',
        at: '',
        summary: s.summary || s.detail || s.tool || 'Working…',
      });
    }

    if (agent.status === 'done' || agent.status === 'merged') {
      const files = (agent.changes || []).map(c => c.path);
      const adds = (agent.changes || []).reduce((acc, c) => acc + (c.added || 0), 0);
      const dels = (agent.changes || []).reduce((acc, c) => acc + (c.removed || 0), 0);
      const changeSummary = files.length
        ? `${files.length} file${files.length === 1 ? '' : 's'} changed (+${adds} -${dels})`
        : (agent.kind === 'read' ? 'Investigation report ready' : 'Completed with no edits');
      push({
        from: agent.id,
        to: ['coordinator'],
        kind: 'return',
        tool: agent.status === 'merged' ? 'merged' : 'done',
        at: agent.endedAt || '',
        summary: agent.status === 'merged'
          ? `Merged ${agent.mergeResult?.applied?.length || files.length} file(s) into project`
          : `${agent.role || agent.id} finished — ${changeSummary}`,
        files,
      });
    } else if (agent.status === 'failed' || agent.status === 'stopped') {
      push({
        from: agent.id,
        to: ['coordinator'],
        kind: 'return',
        tool: agent.status,
        at: agent.endedAt || '',
        summary: agent.error || `${agent.role || agent.id} ${agent.status}.`,
      });
    }
  }

  if (swarm?.status === 'done' && agents.every(a => ['done', 'merged', 'discarded'].includes(a.status ?? ''))) {
    push({
      from: 'coordinator',
      to: ['all'],
      kind: 'all',
      tool: 'complete',
      at: swarm.endedAt || '',
      summary: '[done] Swarm mission settled cleanly across all branches.',
    });
  }

  return events;
}

export function nodeCoords(node: CircuitNode, layout: CircuitLayout): Point {
  const { vertical, stageCols, laneRows, nw } = layout;
  if (!vertical) {
    const x = stageCols[node.stage];
    if (node.id === 'coordinator') {
      const midY = (laneRows[0] + laneRows[laneRows.length - 1]) / 2;
      return { x, y: Math.round(midY) };
    }
    return { x, y: laneRows[node.lane] ?? (laneRows[0] + node.lane * 84) };
  }
  // Vertical flow: stage flows top-to-bottom, lanes across
  const y = stageCols[node.stage];
  if (node.id === 'coordinator') {
    const midX = (laneRows[0] + laneRows[laneRows.length - 1]) / 2;
    return { x: Math.round(midX), y };
  }
  return { x: laneRows[node.lane] ?? (laneRows[0] + node.lane * (nw + 24)), y };
}

export function pcbPath(
  a: Point,
  b: Point,
  edge: CircuitPathEdge,
  { vertical = false, busOffset = 0, nw = 156, nh = 54, returnLine = 380 }: CircuitPathOptions = {},
): string {
  if (edge.from === edge.target) {
    // Compact self-loop solder trace above chip when an internal tool step is highlighted
    if (!vertical) {
      const x1 = a.x + 42, x2 = a.x + nw - 42, y0 = a.y, top = y0 - 16;
      return `M ${x1} ${y0} L ${x1} ${top} L ${x2} ${top} L ${x2} ${y0}`;
    }
    const y1 = a.y + 14, y2 = a.y + nh - 14, x0 = a.x + nw, right = x0 + 16;
    return `M ${x0} ${y1} L ${right} ${y1} L ${right} ${y2} L ${x0} ${y2}`;
  }

  if (edge.kind === 'all') {
    if (!vertical) {
      const topY = 34 + busOffset * 5;
      const sx = a.x + nw / 2, sy = a.y;
      const tx = b.x + nw / 2, ty = b.y;
      return `M ${sx} ${sy} L ${sx} ${topY} L ${tx} ${topY} L ${tx} ${ty}`;
    }
    const busX = 28 + busOffset * 5;
    const sx = a.x, sy = a.y + nh / 2;
    const tx = b.x, ty = b.y + nh / 2;
    return `M ${sx} ${sy} L ${busX} ${sy} L ${busX} ${ty} L ${tx} ${ty}`;
  }

  if (edge.kind === 'return') {
    if (!vertical) {
      const sx = a.x + nw / 2, sy = a.y + nh;
      const tx = b.x + nw / 2, ty = b.y + nh;
      const busY = returnLine + busOffset * 6;
      return `M ${sx} ${sy} L ${sx} ${busY} L ${tx} ${busY} L ${tx} ${ty}`;
    }
    const sx = a.x + nw, sy = a.y + nh / 2;
    const tx = b.x + nw, ty = b.y + nh / 2;
    const rightX = returnLine + busOffset * 6;
    return `M ${sx} ${sy} L ${rightX} ${sy} L ${rightX} ${ty} L ${tx} ${ty}`;
  }

  if (!vertical) {
    const sx = a.x + nw, sy = a.y + nh / 2 + busOffset * 3;
    const tx = b.x, ty = b.y + nh / 2 + busOffset * 3;
    const midX = Math.round((sx + tx) / 2 + busOffset * 4);
    return `M ${sx} ${sy} L ${midX} ${sy} L ${midX} ${ty} L ${tx} ${ty}`;
  }
  const sx = a.x + nw / 2 + busOffset * 3, sy = a.y + nh;
  const tx = b.x + nw / 2 + busOffset * 3, ty = b.y;
  const midY = Math.round((sy + ty) / 2 + busOffset * 3);
  return `M ${sx} ${sy} L ${sx} ${midY} L ${tx} ${midY} L ${tx} ${ty}`;
}

export function pathMidpoint(
  a: Point,
  b: Point,
  edge: CircuitPathEdge,
  { vertical = false, busOffset = 0, nw = 156, nh = 54, returnLine = 380 }: CircuitPathOptions = {},
): Point {
  if (edge.from === edge.target) {
    return vertical ? { x: a.x + nw + 16, y: a.y + nh / 2 } : { x: a.x + nw / 2, y: a.y - 16 };
  }
  if (edge.kind === 'all') {
    return vertical
      ? { x: 28 + busOffset * 5, y: Math.round((a.y + b.y + nh) / 2) }
      : { x: Math.round((a.x + b.x + nw) / 2), y: 34 + busOffset * 5 };
  }
  if (edge.kind === 'return') {
    return vertical
      ? { x: returnLine + busOffset * 6, y: Math.round((a.y + b.y + nh) / 2) }
      : { x: Math.round((a.x + b.x + nw) / 2), y: returnLine + busOffset * 6 };
  }
  if (!vertical) {
    return { x: Math.round((a.x + nw + b.x) / 2 + busOffset * 4), y: Math.round((a.y + b.y + nh) / 2) };
  }
  return { x: Math.round((a.x + b.x + nw) / 2), y: Math.round((a.y + nh + b.y) / 2 + busOffset * 3) };
}

export function buildCircuitModel(
  swarm?: SwarmState | null,
  { vertical = false, step = null, hideInactive = false }: BuildCircuitModelOptions = {},
): CircuitModel {
  const { nodes, maxStage, maxLanes, stageLabels } = computeCircuitStages(swarm?.agents || []);
  const timeline = buildCircuitTimeline(swarm);
  const totalSteps = timeline.length;
  const clampedStep = totalSteps ? Math.max(1, Math.min(step ?? totalSteps, totalSteps)) : 0;
  const currentEvent = clampedStep ? timeline[clampedStep - 1] : null;

  const nw = 156, nh = 54;
  let width: number;
  let height: number;
  let stageCols: number[];
  let laneRows: number[];
  let returnLine: number;
  if (!vertical) {
    const colGap = 248;
    const rowGap = 78;
    stageCols = Array.from({ length: maxStage + 1 }, (_, s) => 44 + s * colGap);
    laneRows = Array.from({ length: Math.max(1, maxLanes) }, (_, l) => 70 + l * rowGap);
    width = Math.max(640, stageCols[maxStage] + nw + 56);
    const contentBottom = laneRows[laneRows.length - 1] + nh;
    returnLine = contentBottom + 34;
    height = Math.max(300, returnLine + 34);
  } else {
    const rowStageGap = 118;
    const colLaneGap = 186;
    stageCols = Array.from({ length: maxStage + 1 }, (_, s) => 56 + s * rowStageGap);
    laneRows = Array.from({ length: Math.max(1, maxLanes) }, (_, l) => 66 + l * colLaneGap);
    const contentRight = laneRows[laneRows.length - 1] + nw;
    returnLine = contentRight + 38;
    width = Math.max(500, returnLine + 42);
    height = Math.max(340, stageCols[maxStage] + nh + 52);
  }

  const layout: CircuitLayout = { vertical, stageCols, laneRows, nw, nh, returnLine };
  const coords = new Map<string, Point>();
  for (const [id, node] of nodes) coords.set(id, nodeCoords(node, layout));

  // Build visible edges up to clampedStep (always include structural dispatch + dependsOn wires so topology is clear).
  const structuralEdges: CircuitEdge[] = [];
  for (const agent of swarm?.agents || []) {
    if (!agent.dependsOn?.length) {
      structuralEdges.push({ from: 'coordinator', target: agent.id, kind: 'direct', count: 0 });
    } else {
      for (const dep of agent.dependsOn) {
        if (nodes.has(dep)) structuralEdges.push({ from: dep, target: agent.id, kind: 'handoff', count: 0 });
      }
    }
  }

  const counts = new Map<string, CircuitEdge>();
  for (const edge of structuralEdges) {
    counts.set(`${edge.from}->${edge.target}:${edge.kind}`, { ...edge });
  }
  const activeSlice = timeline.slice(0, clampedStep);
  const everActive = new Set<string>(['coordinator']);
  for (const ev of activeSlice) {
    everActive.add(ev.from);
    const targets = ev.to.includes('all')
      ? [...nodes.keys()].filter(id => id !== ev.from)
      : ev.to;
    for (const target of targets) {
      everActive.add(target);
      if (ev.from === target) continue;
      const kind = ev.to.includes('all') ? 'all' : ev.kind;
      const key = `${ev.from}->${target}:${kind}`;
      const existing = counts.get(key);
      if (existing) existing.count += 1;
      else counts.set(key, { from: ev.from, target, kind, count: 1 });
    }
  }

  return {
    swarm,
    nodes,
    coords,
    layout,
    width,
    height,
    stageLabels,
    timeline,
    clampedStep,
    currentEvent,
    edges: [...counts.values()],
    everActive,
    hideInactive,
  };
}

export function renderCircuitSVG(
  model: CircuitModel,
  { selectedId = null }: RenderCircuitSvgOptions = {},
): string {
  const { width, height, layout, nodes, coords, stageLabels, edges, currentEvent, everActive, hideInactive, clampedStep, swarm } = model;
  const { vertical, stageCols, nw, nh } = layout;

  const touched = new Set<string>();
  if (currentEvent) {
    touched.add(currentEvent.from);
    for (const t of currentEvent.to || []) {
      if (t === 'all') nodes.forEach((_, k) => touched.add(k));
      else if (nodes.has(t)) touched.add(t);
    }
  }

  let out = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Swarm linear circuit graph">`
    + `<defs><linearGradient id="sw-trace-glow" x1="0%" y1="0%" x2="100%" y2="0%">`
    + `<stop offset="0%" stop-color="#60a5fa"/><stop offset="50%" stop-color="#9fb2ff"/><stop offset="100%" stop-color="#34d399"/>`
    + `</linearGradient></defs>`;

  // Stage column headers and dividers
  stageCols.forEach((pos, idx) => {
    const label = escapeXml(stageLabels[idx] || `0${idx + 1}`);
    if (!vertical) {
      out += `<text x="${pos + nw / 2}" y="18" text-anchor="middle" class="sw-stage-label">${label}</text>`;
      if (idx > 0) {
        const divX = Math.round((stageCols[idx - 1] + nw + pos) / 2);
        out += `<line x1="${divX}" y1="26" x2="${divX}" y2="${height - 14}" class="sw-stage-divider"/>`;
      }
    } else {
      out += `<text x="16" y="${pos - 12}" class="sw-stage-label">${label}</text>`;
      if (idx > 0) {
        const divY = Math.round((stageCols[idx - 1] + nh + pos) / 2);
        out += `<line x1="14" y1="${divY}" x2="${width - 14}" y2="${divY}" class="sw-stage-divider"/>`;
      }
    }
  });

  // Base PCB traces
  edges.forEach((edge, idx) => {
    const a = coords.get(edge.from), b = coords.get(edge.target);
    if (!a || !b) return;
    const busOffset = (idx % 3) - 1;
    const d = pcbPath(a, b, edge, { ...layout, busOffset });
    const strokeW = Math.min(3.8, 1.4 + Math.max(0, edge.count) * 0.55);
    const isSel = selectedId && (edge.from === selectedId || edge.target === selectedId);
    const baseCls = edge.kind === 'all' ? 'sw-trace-all' : edge.kind === 'return' ? 'sw-trace-return' : 'sw-trace-bg';
    const selCls = selectedId ? (isSel ? ' is-highlighted' : ' is-dimmed') : '';
    out += `<path d="${d}" class="${baseCls}${selCls}" stroke-width="${strokeW}"/>`;

    const first = /^M\s+([\d.-]+)\s+([\d.-]+)/.exec(d);
    const last = /L\s+([\d.-]+)\s+([\d.-]+)$/.exec(d);
    if (first && last) {
      out += `<circle cx="${first[1]}" cy="${first[2]}" r="3" class="sw-via-pad"/>`;
      out += `<circle cx="${last[1]}" cy="${last[2]}" r="3" class="sw-via-pad"/>`;
    }

    if (edge.count > 1) {
      const mid = pathMidpoint(a, b, edge, { ...layout, busOffset });
      out += `<rect x="${mid.x - 10}" y="${mid.y - 8}" width="20" height="16" rx="8" class="sw-badge-pill"/>`;
      out += `<text x="${mid.x}" y="${mid.y}" class="sw-badge-text">${edge.count}</text>`;
    }
  });

  // Active signal overlay + animated data pulse
  if (currentEvent) {
    const targets = currentEvent.to.includes('all')
      ? [...nodes.keys()].filter(k => k !== currentEvent.from)
      : currentEvent.to;
    targets.forEach((t, idx) => {
      const a = coords.get(currentEvent.from), b = coords.get(t);
      if (!a || !b) return;
      const edge: CircuitPathEdge = {
        from: currentEvent.from,
        target: t,
        kind: currentEvent.to.includes('all') ? 'all' : currentEvent.kind,
      };
      const d = pcbPath(a, b, edge, { ...layout, busOffset: (idx % 3) - 1 });
      const pid = `sw-sig-${clampedStep}-${idx}`;
      out += `<path id="${pid}" d="${d}" class="sw-trace-active" stroke-width="2.5"/>`;
      out += `<circle r="4.2" fill="#9fb2ff" class="sw-trace-pulse"><animateMotion dur="1.3s" repeatCount="indefinite"><mpath href="#${pid}"/></animateMotion></circle>`;
    });
  }

  // Render IC Agent Chips with colored Fairy Eyes
  nodes.forEach(node => {
    const activeNode = everActive.has(node.id) || touched.has(node.id);
    if (hideInactive && !activeNode) return;
    const pos = coords.get(node.id);
    if (!pos) return;
    const status = node.id === 'coordinator'
      ? (swarm?.status === 'running' ? 'running' : swarm?.status === 'done' ? 'done' : 'idle')
      : node.status;
    const eyeState = eyeStateForAgent(status);
    const isEndpoint = touched.has(node.id);
    const isSelected = selectedId === node.id;
    const cls = [
      'sw-ic-node',
      !activeNode ? 'is-inactive' : '',
      isEndpoint ? 'is-endpoint' : '',
      isSelected ? 'is-selected' : '',
    ].filter(Boolean).join(' ');

    out += `<g class="${cls}" data-agent="${escapeXml(node.id)}" style="--sw-node-accent:${escapeXml(node.color.iris)}" transform="translate(${pos.x},${pos.y})">`;
    for (const px of [34, 78, 122]) {
      out += `<rect x="${px - 3}" y="-3" width="6" height="3" rx="1" class="sw-ic-pin"/>`;
      out += `<rect x="${px - 3}" y="${nh}" width="6" height="3" rx="1" class="sw-ic-pin"/>`;
    }
    out += `<rect x="0" y="0" width="${nw}" height="${nh}" rx="12" class="sw-ic-body"/>`;
    out += `<g transform="translate(8,10)">${fairyEyeSVG(node.color, { size: 34, state: eyeState })}</g>`;
    out += `<text x="48" y="22" class="sw-ic-name">${escapeXml(node.name)}</text>`;
    const clippedRole = String(node.role || '').length > 16 ? `${String(node.role).slice(0, 15)}…` : String(node.role || '');
    out += `<text x="48" y="38" class="sw-ic-role">${escapeXml(clippedRole)}</text>`;

    if (node.id === 'coordinator' && currentEvent?.to?.includes('all')) {
      out += `<rect x="${nw - 42}" y="-9" width="38" height="16" rx="8" class="sw-badge-pill"/>`;
      out += `<text x="${nw - 23}" y="-1" class="sw-badge-text" style="fill:#9fb2ff">@all</text>`;
    }
    out += `</g>`;
  });

  out += `</svg>`;
  return out;
}
