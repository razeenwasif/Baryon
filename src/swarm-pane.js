import { renderDiff } from './changes-pane.js';
import {
  COORDINATOR_EYE_COLOR,
  buildCircuitModel,
  colorForAgent,
  eyeStateForAgent,
  fairyEyeSVG,
  renderCircuitSVG,
} from './swarm-circuit.js';
import {
  AGENT_STATE_WORDS,
  KIND_WORDS,
  PROVIDER_WORDS,
  createBlankAgent,
  elapsedWords,
  parseCommaList,
  parseDependsList,
  swarmSummaryLine,
} from './swarm-logic.js';

const el = (tag, className = '', text = '') => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== '') node.textContent = text;
  return node;
};
const btn = (className, text, onclick, title = '') => {
  const b = el('button', className, text);
  b.type = 'button';
  b.onclick = onclick;
  if (title) b.title = title;
  return b;
};

// Antigravity-style parallel agent swarm side pane with a Linear Circuit Graph and colored Fairy Eye avatars:
// auto-decompose a mission into parallel sub-agents (or author custom agent cards), deploy up to 6 agents
// concurrently in isolated APFS copies, monitor communication & DAG progress on a PCB circuit trace canvas,
// steer running agents live, inspect syntax-highlighted diffs, and bring work back safely via 3-way merge.
export function swarmPane({ api, work, currentSession, onError = () => {}, onChange = () => {} }) {
  let activeChat = '';
  let liveSwarm = null;
  let draftBrief = '';
  let draftSummary = '';
  let draftOverlaps = [];
  let draftAgents = [];
  let maxParallel = 4;
  let planning = false;
  let deploying = false;
  let addingLive = false;
  let statusText = '';
  let openDiffs = new Map(); // agentId -> { loading, data, error }
  let activeContext = null;
  let clockTimer = null;

  // Circuit Graph / Board / Members view state
  let activeTab = 'graph'; // 'graph' | 'board' | 'members'
  let verticalLayout = false;
  let hideInactive = false;
  let selectedAgentId = null;
  let scrubStep = null; // null = follow latest step automatically
  let playing = false;
  let playTimer = null;
  let boardQuery = '';

  const stopPlay = () => {
    playing = false;
    if (playTimer) clearInterval(playTimer);
    playTimer = null;
  };
  const stopClock = () => { if (clockTimer) clearInterval(clockTimer); clockTimer = null; };
  const ensureClock = () => {
    const running = liveSwarm?.status === 'running';
    if (running && !clockTimer) clockTimer = setInterval(() => { if (activeContext && liveSwarm?.status === 'running') activeContext.redraw(); else stopClock(); }, 2000);
    if (!running) stopClock();
  };
  const cleanErr = error => String(error?.message || error).replace(/Error invoking remote method '[^']+': Error: /, '');
  const chatKey = () => currentSession?.() || (work?.() ? 'draft' : '');

  async function refreshFromBackend() {
    const chat = chatKey();
    activeChat = chat;
    if (!chat || !api?.agentSwarmState) { liveSwarm = null; onChange(null); return; }
    try {
      liveSwarm = await api.agentSwarmState(chat);
      ensureClock();
      onChange(liveSwarm);
    } catch {
      liveSwarm = null;
      onChange(null);
    }
  }

  function makeEyeSlot(color, { size = 28, state = 'idle', className = 'sw-eye-slot' } = {}) {
    const wrap = el('span', className);
    wrap.innerHTML = fairyEyeSVG(color, { size, state });
    return wrap;
  }

  function renderDraft(body, context) {
    const wrap = el('div', 'sw-wrap');
    const head = el('div', 'sw-head');
    const titleGroup = el('div', 'sw-title-group');
    titleGroup.append(makeEyeSlot(COORDINATOR_EYE_COLOR, { size: 26, state: planning || deploying ? 'working' : 'idle' }), el('strong', '', 'Parallel Agent Swarm'));
    head.append(titleGroup, el('span', 'sw-pill', 'Circuit mode'));
    wrap.append(head);
    wrap.append(el('p', 'sw-lede', 'Deploy multiple specialized agents concurrently. Write agents run in isolated copy-on-write workspaces and return via 3-way merge; read-only agents investigate directly.'));

    // Mission brief + Auto-plan bar
    const briefCard = el('div', 'sw-card');
    const briefInput = el('textarea', 'sw-textarea');
    briefInput.rows = 3;
    briefInput.maxLength = 4000;
    briefInput.placeholder = 'Describe a mission to split across parallel agents (e.g. “Build the API endpoint, update the UI panel, and write integration tests”)…';
    briefInput.value = draftBrief;
    briefInput.oninput = () => { draftBrief = briefInput.value; };

    const controls = el('div', 'sw-row');
    const parLabel = el('label', 'sw-inline-field');
    const parSelect = el('select', 'sw-select');
    for (const n of [2, 3, 4, 6]) {
      const opt = el('option', '', `${n} parallel`);
      opt.value = String(n);
      parSelect.append(opt);
    }
    parSelect.value = String(maxParallel);
    parSelect.onchange = () => { maxParallel = Number(parSelect.value) || 4; };
    parLabel.append(el('span', 'sw-faint', 'Concurrency'), parSelect);

    const planBtn = btn('sw-primary', planning ? 'Planning team…' : 'Auto-plan team', async () => {
      const chat = chatKey();
      if (!chat) { statusText = 'Open a work session first.'; context.redraw(); return; }
      if (!draftBrief.trim()) { statusText = 'Describe the mission above first.'; context.redraw(); return; }
      planning = true; statusText = 'Drafting parallel agent roster…'; context.redraw();
      try {
        const res = await api.agentSwarmPlan(chat, { brief: draftBrief.trim(), maxAgents: maxParallel });
        planning = false;
        if (res?.cancelled) { statusText = ''; context.redraw(); return; }
        draftSummary = res.summary || '';
        draftAgents = (res.agents || []).map(a => ({ ...a, scope: [...(a.scope || [])], dependsOn: [...(a.dependsOn || [])] }));
        draftOverlaps = res.overlaps || [];
        statusText = '';
      } catch (error) {
        planning = false;
        statusText = cleanErr(error);
      }
      context.redraw();
    }, 'One approved model turn decomposes the mission into parallel agents you can edit before deploying');
    planBtn.disabled = planning || !api?.agentSwarmPlan;

    const addBtn = btn('sw-quiet', '+ Add agent', () => {
      draftAgents.push(createBlankAgent(draftAgents));
      statusText = '';
      context.redraw();
    });

    controls.append(parLabel, planBtn, addBtn);
    briefCard.append(briefInput, controls);
    if (draftSummary) briefCard.append(el('p', 'sw-summary', draftSummary));
    wrap.append(briefCard);

    if (draftOverlaps.length) {
      const warn = el('div', 'sw-warn');
      warn.append(el('strong', '', 'Overlapping write scopes detected: '), el('span', '', draftOverlaps.map(o => `${o.path} (${o.agents.join(' & ')})`).join('; ') + '. Consider narrowing scopes or adding a dependency to avoid merge conflicts.'));
      wrap.append(warn);
    }

    if (draftAgents.length) {
      // Live Topology Preview
      const previewModel = buildCircuitModel({ status: 'draft', agents: draftAgents }, { vertical: verticalLayout });
      const previewCard = el('div', 'sw-card sw-preview-card');
      const prevHead = el('div', 'sw-section-head');
      prevHead.append(
        el('span', 'sw-subhead', 'Circuit topology preview'),
        btn('sw-chip-toggle', verticalLayout ? 'Vertical' : 'Horizontal', () => { verticalLayout = !verticalLayout; context.redraw(); }, 'Switch circuit layout orientation'),
      );
      const stage = el('div', `sw-pcb-stage is-preview${verticalLayout ? ' is-vertical' : ''}`);
      stage.innerHTML = renderCircuitSVG(previewModel, {});
      previewCard.append(prevHead, stage);
      wrap.append(previewCard);

      const rosterHead = el('div', 'sw-section-head');
      rosterHead.append(el('span', 'sw-subhead', `Agent roster (${draftAgents.length})`));
      const deployBtn = btn('sw-primary', deploying ? 'Deploying…' : `Deploy ${draftAgents.length} agent${draftAgents.length === 1 ? '' : 's'}`, async () => {
        const chat = chatKey();
        if (!chat) { statusText = 'Open a work session first.'; context.redraw(); return; }
        deploying = true; statusText = ''; context.redraw();
        try {
          liveSwarm = await api.agentSwarmDeploy(chat, { brief: draftBrief.trim(), agents: draftAgents, maxParallel });
          deploying = false;
          openDiffs.clear();
          scrubStep = null;
          selectedAgentId = null;
          activeTab = 'graph';
          ensureClock();
          onChange(liveSwarm);
        } catch (error) {
          deploying = false;
          statusText = cleanErr(error);
        }
        context.redraw();
      });
      deployBtn.disabled = deploying || !draftAgents.some(a => a.task.trim());
      rosterHead.append(deployBtn);
      wrap.append(rosterHead);

      const list = el('div', 'sw-grid');
      draftAgents.forEach((agent, index) => {
        const eyeColor = colorForAgent(agent, index);
        const card = el('div', 'sw-agent-card draft');
        card.style.borderLeftColor = eyeColor.iris;
        const top = el('div', 'sw-agent-top');
        const idTag = el('span', 'sw-id', agent.id);
        const roleInput = el('input', 'sw-input sw-role-input');
        roleInput.value = agent.role;
        roleInput.placeholder = 'Agent role (e.g. Backend Engineer)';
        roleInput.oninput = () => { agent.role = roleInput.value; };
        const remove = btn('sw-x', '×', () => { draftAgents.splice(index, 1); context.redraw(); }, 'Remove agent');
        top.append(makeEyeSlot(eyeColor, { size: 24, state: 'idle' }), idTag, roleInput, remove);

        const metaRow = el('div', 'sw-meta-row');
        const kindSel = el('select', 'sw-select');
        for (const [val, label] of [['write', 'Isolated copy (write)'], ['read', 'Read-only']]) {
          const opt = el('option', '', label); opt.value = val; kindSel.append(opt);
        }
        kindSel.value = agent.kind;
        kindSel.onchange = () => { agent.kind = kindSel.value; context.redraw(); };

        const provSel = el('select', 'sw-select');
        for (const [val, label] of Object.entries(PROVIDER_WORDS)) {
          const opt = el('option', '', label); opt.value = val; provSel.append(opt);
        }
        provSel.value = agent.provider || 'auto';
        provSel.onchange = () => { agent.provider = provSel.value; };
        metaRow.append(kindSel, provSel);

        const scopeRow = el('div', 'sw-meta-row');
        const scopeInput = el('input', 'sw-input');
        scopeInput.placeholder = 'Scope files (comma-separated, optional)';
        scopeInput.value = (agent.scope || []).join(', ');
        scopeInput.oninput = () => { agent.scope = parseCommaList(scopeInput.value); };

        const depsInput = el('input', 'sw-input sw-deps-input');
        depsInput.placeholder = 'After (e.g. A1)';
        depsInput.value = (agent.dependsOn || []).join(', ');
        depsInput.onchange = () => { agent.dependsOn = parseDependsList(depsInput.value); context.redraw(); };
        scopeRow.append(scopeInput, depsInput);

        const taskArea = el('textarea', 'sw-textarea sw-task-area');
        taskArea.rows = 3;
        taskArea.placeholder = 'Clear, self-contained instructions for this agent…';
        taskArea.value = agent.task;
        taskArea.oninput = () => { agent.task = taskArea.value; };

        card.append(top, metaRow, scopeRow, taskArea);
        list.append(card);
      });
      wrap.append(list);
    } else {
      wrap.append(el('p', 'sw-faint', 'Click Auto-plan team to decompose your brief automatically, or click + Add agent to build a custom parallel roster directly. You can also type /swarm <brief> (or /teamwork <brief>) in the chat box.'));
    }

    if (statusText) wrap.append(el('p', 'sw-status', statusText));
    body.replaceChildren(wrap);
  }

  function renderCircuitTab(swarm, model, context) {
    const box = el('div', 'sw-cg-wrap');
    const totalSteps = model.timeline.length;
    const step = model.clampedStep;

    // Scrubber / layout bar
    const ctrlBar = el('div', 'sw-cg-controls');
    const playGroup = el('div', 'sw-cg-play');
    const prevBtn = btn('sw-cg-icon', '‹', () => {
      stopPlay();
      scrubStep = Math.max(1, step - 1);
      context.redraw();
    }, 'Previous event');
    prevBtn.disabled = step <= 1;

    const playBtn = btn('sw-cg-icon', playing ? '❚❚' : '▶', () => {
      if (!totalSteps) return;
      if (playing) { stopPlay(); context.redraw(); return; }
      if (step >= totalSteps) scrubStep = 1;
      playing = true;
      playTimer = setInterval(() => {
        if (!activeContext || !liveSwarm) { stopPlay(); return; }
        const curModel = buildCircuitModel(liveSwarm, { vertical: verticalLayout, step: scrubStep, hideInactive });
        const len = curModel.timeline.length;
        if ((scrubStep ?? len) >= len) { stopPlay(); scrubStep = null; }
        else scrubStep = (scrubStep ?? 1) + 1;
        activeContext.redraw();
      }, 1450);
      context.redraw();
    }, playing ? 'Pause replay' : 'Play circuit trace');
    playBtn.disabled = totalSteps < 2;

    const nextBtn = btn('sw-cg-icon', '›', () => {
      stopPlay();
      const next = Math.min(totalSteps, step + 1);
      scrubStep = next >= totalSteps ? null : next;
      context.redraw();
    }, 'Next event');
    nextBtn.disabled = !totalSteps || step >= totalSteps;

    playGroup.append(prevBtn, playBtn, nextBtn);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'sw-cg-scrubber';
    slider.min = '1';
    slider.max = String(Math.max(1, totalSteps));
    slider.value = String(Math.max(1, step));
    slider.disabled = totalSteps < 2;
    slider.oninput = () => {
      stopPlay();
      const val = Number(slider.value);
      scrubStep = val >= totalSteps ? null : val;
      context.redraw();
    };

    const readout = el('span', 'sw-cg-readout', totalSteps ? `${step} of ${totalSteps}${scrubStep === null ? ' · Live' : ''}` : '0 events');

    const toggles = el('div', 'sw-cg-toggles');
    const hideBtn = btn('sw-chip-toggle', 'Hide inactive', () => { hideInactive = !hideInactive; context.redraw(); });
    hideBtn.setAttribute('aria-pressed', String(hideInactive));
    const orientBtn = btn('sw-chip-toggle', verticalLayout ? 'Vertical' : 'Horizontal', () => { verticalLayout = !verticalLayout; context.redraw(); }, 'Switch between Horizontal and Vertical circuit');
    orientBtn.setAttribute('aria-pressed', String(verticalLayout));
    toggles.append(hideBtn, orientBtn);

    ctrlBar.append(playGroup, slider, readout, toggles);
    box.append(ctrlBar);

    // Interactive SVG PCB canvas
    const stage = el('div', `sw-pcb-stage${verticalLayout ? ' is-vertical' : ''}`);
    stage.innerHTML = renderCircuitSVG(model, { selectedId: selectedAgentId });
    stage.querySelectorAll('.sw-ic-node').forEach(node => {
      node.onclick = () => {
        const id = node.dataset.agent || null;
        selectedAgentId = selectedAgentId === id ? null : id;
        context.redraw();
      };
    });
    box.append(stage);

    // Active Event Card + Selected Node Inspector
    const footer = el('div', 'sw-cg-inspector');
    if (model.currentEvent) {
      const ev = model.currentEvent;
      const fromNode = model.nodes.get(ev.from) || { name: `@${ev.from}`, color: COORDINATOR_EYE_COLOR };
      const card = el('div', 'sw-event-card');
      const eyeStatus = ev.from === 'coordinator' ? (swarm.status === 'running' ? 'working' : 'idle') : fromNode.status;
      card.append(makeEyeSlot(fromNode.color, { size: 30, state: eyeStateForAgent(eyeStatus) }));

      const main = el('div', 'sw-event-main');
      const route = el('div', 'sw-event-route');
      const fromSpan = el('span', 'sw-at', fromNode.name);
      fromSpan.style.color = fromNode.color.irisLight;
      route.append(fromSpan);
      if (!(ev.to.length === 1 && ev.to[0] === ev.from)) {
        route.append(el('span', 'sw-faint', '→'));
        for (const t of ev.to) {
          if (t === 'all') {
            const allSpan = el('span', 'sw-at', '@all');
            allSpan.style.color = '#9fb2ff';
            route.append(allSpan);
          } else {
            const targetNode = model.nodes.get(t);
            const tSpan = el('span', 'sw-at', `@${t}`);
            if (targetNode) tSpan.style.color = targetNode.color.irisLight;
            route.append(tSpan);
          }
        }
      }
      if (ev.tool) route.append(el('span', 'sw-badge', ev.tool));
      route.append(el('span', 'sw-event-step', `#${ev.step}`));
      main.append(route, el('p', 'sw-event-summary', ev.summary));
      card.append(main);
      footer.append(card);
    }

    if (selectedAgentId && model.nodes.has(selectedAgentId)) {
      const node = model.nodes.get(selectedAgentId);
      const agent = (swarm.agents || []).find(a => a.id === selectedAgentId);
      const insp = el('div', 'sw-node-inspector');
      const left = el('div', 'sw-node-inspector-l');
      left.append(
        makeEyeSlot(node.color, { size: 24, state: eyeStateForAgent(agent?.status || swarm.status) }),
        el('strong', '', `${node.name} · ${node.role}`),
      );
      if (agent) {
        left.append(el('span', 'sw-ni-tag', AGENT_STATE_WORDS[agent.status] || agent.status));
        left.append(el('span', 'sw-ni-tag', KIND_WORDS[agent.kind] || agent.kind));
        if (agent.seat?.model) left.append(el('span', 'sw-ni-tag', `${PROVIDER_WORDS[agent.seat.provider] || agent.seat.provider} · ${agent.seat.model}`));
        if (agent.scope?.length) left.append(el('span', 'sw-ni-tag', `Scope: ${agent.scope.join(', ')}`));
        if (agent.changes?.length) left.append(el('span', 'sw-ni-tag', `${agent.changes.length} file(s)`));
      } else {
        left.append(el('span', 'sw-ni-tag', `${swarm.agents?.length || 0} agents orchestrated`));
      }

      const right = el('div', 'sw-node-inspector-r');
      if (agent) {
        right.append(btn('sw-quiet', 'Details in Members', () => { activeTab = 'members'; context.redraw(); }));
        if (['queued', 'copying', 'running'].includes(agent.status)) {
          right.append(btn('sw-danger', 'Stop', async () => {
            try { liveSwarm = await api.agentSwarmStop(swarm.chat, agent.id); onChange(liveSwarm); context.redraw(); }
            catch (error) { onError(cleanErr(error)); }
          }));
        }
        if (agent.kind === 'write' && ['done', 'failed', 'stopped'].includes(agent.status) && agent.changes?.length) {
          right.append(btn('sw-primary', 'Merge', async () => {
            try { const res = await api.agentSwarmMerge(swarm.chat, agent.id); liveSwarm = res.swarm || liveSwarm; onChange(liveSwarm); context.redraw(); }
            catch (error) { onError(cleanErr(error)); }
          }));
        }
      }
      right.append(btn('sw-chip-toggle', 'Clear focus', () => { selectedAgentId = null; context.redraw(); }));
      insp.append(left, right);

      if (agent && agent.kind === 'write' && ['running', 'copying'].includes(agent.status)) {
        const steer = el('form', 'sw-steer sw-inspector-steer');
        const input = el('input', 'sw-input');
        input.placeholder = `Steer ${agent.id} (delivered on its next step)…`;
        input.maxLength = 2000;
        const sendBtn = el('button', 'sw-quiet', 'Send'); sendBtn.type = 'submit';
        steer.append(input, sendBtn);
        steer.onsubmit = async event => {
          event.preventDefault();
          const msg = input.value.trim();
          if (!msg) return;
          sendBtn.disabled = true;
          try { await api.agentSwarmMessage(swarm.chat, agent.id, msg); input.value = ''; }
          catch (error) { onError(cleanErr(error)); }
          sendBtn.disabled = false;
        };
        const outer = el('div', 'sw-node-inspector-wrap');
        outer.append(insp, steer);
        footer.append(outer);
      } else {
        footer.append(insp);
      }
    }

    // Legend
    const legend = el('div', 'sw-cg-legend');
    const l1 = el('span', 'sw-leg-item'); l1.append(el('i', 'sw-leg-swatch'), el('span', '', 'Dispatch / handoff'));
    const l2 = el('span', 'sw-leg-item'); l2.append(el('i', 'sw-leg-swatch is-return'), el('span', '', 'Return / merge'));
    const l3 = el('span', 'sw-leg-item'); l3.append(el('i', 'sw-leg-dot'), el('span', '', 'Active signal'));
    const l4 = el('span', 'sw-leg-item');
    l4.append(makeEyeSlot(COORDINATOR_EYE_COLOR, { size: 15, state: 'working', className: 'sw-eye-mini' }), el('span', '', 'Working'), makeEyeSlot(colorForAgent({ id: 'A2' }, 1), { size: 15, state: 'done', className: 'sw-eye-mini' }), el('span', '', '^ Done'));
    legend.append(l1, l2, l3, l4);
    footer.append(legend);
    box.append(footer);
    return box;
  }

  function renderBoardTab(swarm, model, context) {
    const wrap = el('div', 'sw-board-wrap');
    const search = el('input', 'sw-input sw-board-search');
    search.type = 'search';
    search.placeholder = 'Filter circuit events by agent, tool, summary, or file…';
    search.value = boardQuery;
    search.oninput = () => { boardQuery = search.value; context.redraw(); };
    wrap.append(search);

    const q = boardQuery.trim().toLowerCase();
    const list = model.timeline.filter(ev => {
      if (!q) return true;
      const hay = `${ev.from} ${ev.to.join(' ')} ${ev.tool} ${ev.summary} ${(ev.files || []).join(' ')}`.toLowerCase();
      return hay.includes(q);
    });

    if (!list.length) {
      wrap.append(el('p', 'sw-faint', q ? `No events matching “${boardQuery.trim()}”.` : 'No swarm events recorded yet.'));
      return wrap;
    }

    for (const ev of list) {
      const fromNode = model.nodes.get(ev.from) || { name: `@${ev.from}`, color: COORDINATOR_EYE_COLOR };
      const post = el('button', 'sw-board-post');
      post.type = 'button';
      post.onclick = () => {
        stopPlay();
        scrubStep = ev.step >= model.timeline.length ? null : ev.step;
        selectedAgentId = ev.from === 'coordinator' && ev.to[0] && ev.to[0] !== 'all' ? ev.to[0] : ev.from;
        activeTab = 'graph';
        context.redraw();
      };
      const eyeStatus = ev.from === 'coordinator' ? (swarm.status === 'running' ? 'working' : 'idle') : fromNode.status;
      post.append(makeEyeSlot(fromNode.color, { size: 28, state: eyeStateForAgent(eyeStatus) }));
      const pBody = el('div', 'sw-board-body');
      const pHead = el('div', 'sw-event-route');
      const fromSpan = el('span', 'sw-at', fromNode.name);
      fromSpan.style.color = fromNode.color.irisLight;
      pHead.append(fromSpan);
      if (!(ev.to.length === 1 && ev.to[0] === ev.from)) {
        pHead.append(el('span', 'sw-faint', '→'));
        pHead.append(el('span', 'sw-at', ev.to.map(t => (t === 'all' ? '@all' : `@${t}`)).join(' ')));
      }
      if (ev.tool) pHead.append(el('span', 'sw-badge', ev.tool));
      pHead.append(el('span', 'sw-event-step', `#${ev.step}`));
      pBody.append(pHead, el('p', 'sw-board-text', ev.summary));
      if (ev.files?.length) {
        const filesRow = el('div', 'sw-badges');
        for (const f of ev.files.slice(0, 6)) filesRow.append(el('span', 'sw-badge', f));
        if (ev.files.length > 6) filesRow.append(el('span', 'sw-faint', `+${ev.files.length - 6} more`));
        pBody.append(filesRow);
      }
      post.append(pBody);
      wrap.append(post);
    }
    return wrap;
  }

  function renderMembersTab(swarm, context) {
    const grid = el('div', 'sw-grid');
    (swarm.agents || []).forEach((agent, index) => {
      const eyeColor = colorForAgent(agent, index);
      const card = el('article', `sw-agent-card ${agent.status}`);
      card.style.borderLeftColor = eyeColor.iris;
      const top = el('div', 'sw-agent-top');
      top.append(
        makeEyeSlot(eyeColor, { size: 26, state: eyeStateForAgent(agent.status) }),
        el('span', 'sw-id', agent.id),
        el('strong', 'sw-agent-role', agent.role),
        el('span', `sw-state ${agent.status}`, AGENT_STATE_WORDS[agent.status] || agent.status),
      );
      card.append(top);

      const badges = el('div', 'sw-badges');
      badges.append(el('span', 'sw-badge', KIND_WORDS[agent.kind] || agent.kind));
      const seatLabel = agent.seat?.model ? `${PROVIDER_WORDS[agent.seat.provider] || agent.seat.provider} · ${agent.seat.model}` : (PROVIDER_WORDS[agent.provider] || 'Auto');
      badges.append(el('span', 'sw-badge', seatLabel));
      if (agent.dependsOn?.length) badges.append(el('span', 'sw-badge', `After ${agent.dependsOn.join(', ')}`));
      const dur = elapsedWords(agent.startedAt, agent.endedAt);
      if (dur) badges.append(el('span', 'sw-faint', dur));
      card.append(badges);

      if (agent.scope?.length) card.append(el('p', 'sw-faint sw-scope', `Scope: ${agent.scope.join(', ')}`));

      if (agent.steps?.length) {
        const det = el('details', 'sw-steps-box');
        det.open = agent.status === 'running';
        const latest = agent.steps.at(-1);
        det.append(el('summary', '', `${agent.steps.length} step${agent.steps.length === 1 ? '' : 's'} · ${latest.summary || latest.tool}`));
        const ul = el('ul', 'sw-steps');
        for (const s of agent.steps.slice(-12)) {
          const li = el('li', `sw-step ${s.status}`);
          li.append(el('span', 'sw-step-tool', s.tool), el('span', 'sw-step-text', s.summary || s.detail || ''));
          ul.append(li);
        }
        det.append(ul);
        card.append(det);
      }

      if (agent.kind === 'write' && (agent.status === 'running' || agent.status === 'copying')) {
        const steer = el('form', 'sw-steer');
        const input = el('input', 'sw-input');
        input.placeholder = `Steer ${agent.id} (delivered on its next step)…`;
        input.maxLength = 2000;
        const sendBtn = el('button', 'sw-quiet', 'Send'); sendBtn.type = 'submit';
        steer.append(input, sendBtn);
        if (agent.inboxWaiting > 0) steer.append(el('span', 'sw-faint', `${agent.inboxWaiting} queued`));
        steer.onsubmit = async event => {
          event.preventDefault();
          const msg = input.value.trim();
          if (!msg) return;
          sendBtn.disabled = true;
          try { await api.agentSwarmMessage(swarm.chat, agent.id, msg); input.value = ''; }
          catch (error) { onError(cleanErr(error)); }
          sendBtn.disabled = false;
        };
        card.append(steer);
      }

      if (agent.changes?.length) {
        const totalAdd = agent.changes.reduce((s, c) => s + (c.added || 0), 0);
        const totalDel = agent.changes.reduce((s, c) => s + (c.removed || 0), 0);
        const chBar = el('div', 'sw-changes-bar');
        chBar.append(el('span', 'sw-faint', `${agent.changes.length} file${agent.changes.length === 1 ? '' : 's'} changed (+${totalAdd} -${totalDel})`));
        const showing = openDiffs.has(agent.id);
        chBar.append(btn('sw-link', showing ? 'Hide diff' : 'Inspect diff', async () => {
          if (openDiffs.has(agent.id)) { openDiffs.delete(agent.id); context.redraw(); return; }
          openDiffs.set(agent.id, { loading: true });
          context.redraw();
          try {
            const data = await api.agentSwarmDiff(swarm.chat, agent.id);
            openDiffs.set(agent.id, { loading: false, data });
          } catch (error) {
            openDiffs.set(agent.id, { loading: false, error: cleanErr(error) });
          }
          context.redraw();
        }));
        card.append(chBar);

        if (showing) {
          const dState = openDiffs.get(agent.id);
          const diffWrap = el('div', 'sw-diff-wrap');
          if (dState.loading) diffWrap.append(el('p', 'sw-faint', 'Loading diff…'));
          else if (dState.error) diffWrap.append(el('p', 'sw-status', dState.error));
          else {
            for (const c of dState.data?.changes || []) {
              diffWrap.append(el('p', 'sw-diff-file', `${c.kind}: ${c.path} (+${c.added} -${c.removed})`));
              if (c.diff) diffWrap.append(renderDiff(c.diff, c.path));
            }
          }
          card.append(diffWrap);
        }
      }

      if (agent.mergeResult?.conflicts?.length) {
        const warn = el('div', 'sw-warn');
        warn.append(el('strong', '', 'Merge conflicts (nothing overwritten): '), el('span', '', agent.mergeResult.conflicts.map(c => `${c.path} (${c.why})`).join('; ')));
        card.append(warn);
      } else if (agent.status === 'merged' && agent.mergeResult) {
        card.append(el('p', 'sw-merged-note', `Merged ${agent.mergeResult.applied?.length || 0} file${(agent.mergeResult.applied?.length || 0) === 1 ? '' : 's'} into project.`));
      }

      if (agent.error) card.append(el('p', 'sw-status', agent.error));

      if (agent.report) {
        const rep = el('details', 'sw-report-box');
        rep.append(el('summary', '', 'Agent report'), el('pre', 'sw-report', agent.report));
        card.append(rep);
      }

      const acts = el('div', 'sw-actions');
      if (['queued', 'copying', 'running'].includes(agent.status)) {
        acts.append(btn('sw-danger', 'Stop', async () => {
          try { liveSwarm = await api.agentSwarmStop(swarm.chat, agent.id); onChange(liveSwarm); context.redraw(); }
          catch (error) { onError(cleanErr(error)); }
        }));
      }
      if (agent.kind === 'write' && ['done', 'failed', 'stopped'].includes(agent.status) && agent.changes?.length) {
        acts.append(btn('sw-primary', 'Merge into project', async () => {
          try {
            const res = await api.agentSwarmMerge(swarm.chat, agent.id);
            liveSwarm = res.swarm || liveSwarm;
            onChange(liveSwarm);
            context.redraw();
          } catch (error) { onError(cleanErr(error)); }
        }));
        acts.append(btn('sw-quiet', 'Discard', async () => {
          try {
            liveSwarm = await api.agentSwarmDiscard(swarm.chat, agent.id);
            openDiffs.delete(agent.id);
            onChange(liveSwarm);
            context.redraw();
          } catch (error) { onError(cleanErr(error)); }
        }));
      }
      if (acts.childNodes.length) card.append(acts);
      grid.append(card);
    });
    return grid;
  }

  function renderLive(body, context) {
    const swarm = liveSwarm;
    const model = buildCircuitModel(swarm, { vertical: verticalLayout, step: scrubStep, hideInactive });
    const wrap = el('div', 'sw-wrap');
    const head = el('div', 'sw-head');
    const titleGroup = el('div', 'sw-title-group');
    titleGroup.append(
      makeEyeSlot(COORDINATOR_EYE_COLOR, { size: 26, state: swarm.status === 'running' ? 'working' : swarm.status === 'done' ? 'done' : 'idle' }),
      el('strong', '', 'Parallel Agent Swarm'),
      el('span', `sw-state ${swarm.status}`, swarm.status === 'running' ? 'Running' : swarm.status === 'done' ? 'Finished' : 'Stopped'),
    );
    head.append(titleGroup, el('span', 'sw-faint', `${swarmSummaryLine(swarm)}${swarm.startedAt ? ` · ${elapsedWords(swarm.startedAt, swarm.endedAt)}` : ''}`));
    wrap.append(head);

    if (swarm.brief) wrap.append(el('p', 'sw-summary', swarm.brief));

    const bar = el('div', 'sw-actions');
    bar.append(btn('sw-quiet', '+ Add agent', () => { addingLive = !addingLive; context.redraw(); }));
    if (swarm.counts?.unmerged > 0) {
      const mergeAllBtn = btn('sw-primary', `Merge all (${swarm.counts.unmerged})`, async () => {
        mergeAllBtn.disabled = true; statusText = 'Running 3-way merge…'; context.redraw();
        try {
          const res = await api.agentSwarmMerge(swarm.chat, '');
          liveSwarm = res.swarm || liveSwarm;
          const conflicted = (res.results || []).filter(r => !r.merged);
          statusText = conflicted.length
            ? `Merged clean agents. Conflicts left untouched in: ${conflicted.map(c => `${c.id} (${c.conflicts.map(x => x.path).join(', ')})`).join('; ')}`
            : `Merged ${(res.results || []).length} agent${(res.results || []).length === 1 ? '' : 's'} into the project.`;
          onChange(liveSwarm);
        } catch (error) { statusText = cleanErr(error); }
        context.redraw();
      });
      bar.append(mergeAllBtn);
    }
    if (swarm.status === 'running') {
      bar.append(btn('sw-danger', 'Stop all', async () => {
        try { stopPlay(); liveSwarm = await api.agentSwarmStop(swarm.chat, ''); onChange(liveSwarm); context.redraw(); }
        catch (error) { onError(cleanErr(error)); }
      }));
    } else {
      bar.append(btn('sw-quiet', 'New swarm', async () => {
        try {
          stopPlay();
          await api.agentSwarmDiscard(swarm.chat, '');
          liveSwarm = null; addingLive = false; openDiffs.clear(); statusText = ''; scrubStep = null; selectedAgentId = null;
          onChange(null);
          context.redraw();
        } catch (error) { onError(cleanErr(error)); }
      }));
    }
    wrap.append(bar);

    if (addingLive) {
      const draft = createBlankAgent(swarm.agents);
      const form = el('form', 'sw-card sw-add-form');
      const rIn = el('input', 'sw-input'); rIn.placeholder = 'Role (e.g. Debugger)'; rIn.value = draft.role;
      const kSel = el('select', 'sw-select');
      for (const [v, l] of [['write', 'Isolated copy (write)'], ['read', 'Read-only']]) { const o = el('option', '', l); o.value = v; kSel.append(o); }
      const pSel = el('select', 'sw-select');
      for (const [v, l] of Object.entries(PROVIDER_WORDS)) { const o = el('option', '', l); o.value = v; pSel.append(o); }
      const dIn = el('input', 'sw-input'); dIn.placeholder = 'After (e.g. A1, optional)';
      const tIn = el('textarea', 'sw-textarea'); tIn.rows = 2; tIn.placeholder = 'Task for the new agent…';
      const row1 = el('div', 'sw-meta-row'); row1.append(rIn, kSel, pSel);
      const btns = el('div', 'sw-actions');
      const launch = el('button', 'sw-primary', 'Deploy agent'); launch.type = 'submit';
      btns.append(btn('sw-quiet', 'Cancel', () => { addingLive = false; context.redraw(); }), launch);
      form.append(el('span', 'sw-subhead', `Add parallel agent (${draft.id})`), row1, dIn, tIn, btns);
      form.onsubmit = async event => {
        event.preventDefault();
        if (!tIn.value.trim()) { statusText = 'Give the new agent a task.'; context.redraw(); return; }
        launch.disabled = true;
        try {
          liveSwarm = await api.agentSwarmAdd(swarm.chat, {
            role: rIn.value.trim() || draft.role,
            kind: kSel.value,
            provider: pSel.value,
            dependsOn: parseDependsList(dIn.value),
            task: tIn.value.trim(),
          });
          addingLive = false; statusText = ''; scrubStep = null; ensureClock(); onChange(liveSwarm);
        } catch (error) { statusText = cleanErr(error); launch.disabled = false; }
        context.redraw();
      };
      wrap.append(form);
    }

    if (statusText) wrap.append(el('p', 'sw-status', statusText));

    // Antigravity-style tabs: Circuit Graph / Board / Members
    const tabs = el('div', 'sw-tabs');
    tabs.setAttribute('role', 'tablist');
    const tabDefs = [
      ['graph', 'Circuit Graph', null],
      ['board', 'Board', model.timeline.length],
      ['members', 'Members', swarm.agents?.length || 0],
    ];
    for (const [id, label, count] of tabDefs) {
      const tBtn = el('button', 'sw-tab', label);
      tBtn.type = 'button';
      tBtn.setAttribute('role', 'tab');
      tBtn.setAttribute('aria-selected', String(activeTab === id));
      if (count !== null) tBtn.append(el('span', 'sw-count', String(count)));
      tBtn.onclick = () => { activeTab = id; context.redraw(); };
      tabs.append(tBtn);
    }
    wrap.append(tabs);

    if (activeTab === 'graph') wrap.append(renderCircuitTab(swarm, model, context));
    else if (activeTab === 'board') wrap.append(renderBoardTab(swarm, model, context));
    else wrap.append(renderMembersTab(swarm, context));

    body.replaceChildren(wrap);
  }

  const pane = {
    id: 'swarm',
    title: 'Swarm',
    wide: () => true,
    reset() { openDiffs.clear(); stopPlay(); scrubStep = null; selectedAgentId = null; },
    leave() { stopClock(); stopPlay(); activeContext = null; },
    async render(body, context) {
      activeContext = context;
      if (!work?.()) {
        body.replaceChildren(el('p', 'pane-empty', 'Open a work session with a project folder to deploy a parallel agent swarm.'));
        return;
      }
      const chat = chatKey();
      if (chat !== activeChat) {
        openDiffs.clear();
        stopPlay();
        addingLive = false;
        statusText = '';
        scrubStep = null;
        selectedAgentId = null;
        await refreshFromBackend();
      }
      if (liveSwarm) renderLive(body, context);
      else renderDraft(body, context);
    },
    seedBrief(brief) {
      draftBrief = String(brief || '').trim();
      if (!liveSwarm && !draftAgents.length) {
        draftSummary = '';
        draftOverlaps = [];
      }
      if (activeContext) activeContext.redraw();
    },
    setSwarm(payload) {
      const chat = chatKey();
      if (!payload || payload.chat !== chat) return;
      liveSwarm = payload.swarm || null;
      ensureClock();
      onChange(liveSwarm);
      if (activeContext) activeContext.redraw();
    },
    syncSession() {
      void refreshFromBackend().then(() => { if (activeContext) activeContext.redraw(); });
    },
  };

  return pane;
}
