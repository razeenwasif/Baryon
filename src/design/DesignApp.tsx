import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Screen = {
  id: string;
  title: string;
  viewport: 'desktop' | 'mobile';
  width: number;
  height: number;
  x: number;
  y: number;
  html: string;
  reactCode?: string;
  notes?: string;
  staticGate?: {
    passed: boolean;
    errors: string[];
    warnings: string[];
    metrics?: {
      rawHexOutsideRoot?: number;
      textContrast?: number | null;
      accentContrast?: number | null;
      tokenCount?: number;
      bannedFontsFound?: string[];
    };
  };
  critique?: {
    scores?: { designQuality: number; originality: number; craft: number; functionality: number };
    weightedTotal: number;
    threshold: number;
    passed: boolean;
    strengths?: string[];
    criticalIssues?: string[];
  };
  captures?: Array<{
    name: string;
    width: number;
    height: number;
    dataUrl: string;
    overflowX?: boolean;
    interactiveCount?: number;
    consoleErrors?: string[];
  }>;
};

type DesignProject = {
  id: string;
  name: string;
  folder?: string;
  spec?: {
    preset?: string;
    archetype?: string;
    mood?: string;
    typography?: { display?: string; body?: string; mono?: string };
    tokens?: Record<string, string>;
    layout?: { grid?: string; signatureDetail?: string; responsiveStrategy?: string };
    bans?: string[];
  };
  designMd?: string;
  repoScan?: {
    folder?: string;
    hasDesignMd?: boolean;
    stack?: string[];
    tokens?: Record<string, string>;
    components?: string[];
  } | null;
  screens: Screen[];
  turns?: Array<{
    id: string;
    at: number;
    prompt: string;
    provider?: string;
    archetype?: string;
    iterations?: number;
    score?: number;
    passed?: boolean;
    summary?: string;
  }>;
};

const PHASE_STEPS = [
  { id: 'spec', label: '1 Spec' },
  { id: 'generate', label: '2 Build' },
  { id: 'capture', label: '3 Capture' },
  { id: 'critique', label: '4 Critique' },
];

export function DesignApp({ api, onError }: { api: any; onError?: (msg: string) => void }) {
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [project, setProject] = useState<DesignProject | null>(null);
  const [providers, setProviders] = useState<Array<{ id: string; label: string; connected?: boolean }>>([
    { id: 'auto', label: 'Auto (Active)', connected: true },
  ]);
  const [presets, setPresets] = useState<Array<{ id: string; label: string }>>([{ id: 'auto', label: 'Auto (Domain Fit)' }]);
  const [workFolder, setWorkFolder] = useState('');

  const [selectedScreenId, setSelectedScreenId] = useState<string>('');
  const [vpFilter, setVpFilter] = useState<'all' | 'desktop' | 'mobile'>('all');
  const [canvasMode, setCanvasMode] = useState<'select' | 'interact'>('select');
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [inspectorTab, setInspectorTab] = useState<'tokens' | 'critique' | 'code' | 'captures'>('tokens');
  const [codeTab, setCodeTab] = useState<'html' | 'react'>('html');

  // Infinite canvas pan + zoom
  const [pan, setPan] = useState({ x: 36, y: 24 });
  const [zoom, setZoom] = useState(0.54);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const panDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const boardDragRef = useRef<{ screenId: string; startX: number; startY: number; origX: number; origY: number } | null>(null);

  // Composer & pipeline state
  const [promptText, setPromptText] = useState('');
  const [platform, setPlatform] = useState<'responsive' | 'desktop' | 'mobile'>('responsive');
  const [preset, setPreset] = useState('auto');
  const [provider, setProvider] = useState('auto');
  const [critiqueEnabled, setCritiqueEnabled] = useState(true);
  const [enforceTokenLock, setEnforceTokenLock] = useState(true);
  const [maxIterations, setMaxIterations] = useState(2);

  const [busy, setBusy] = useState(false);
  const [activePhase, setActivePhase] = useState('');
  const [phaseDetail, setPhaseDetail] = useState('Ready — Stitch 4-stage pipeline');
  const [notice, setNotice] = useState('');

  // Editable token & DESIGN.md state synced from project
  const [tokenDraft, setTokenDraft] = useState<Record<string, string>>({});
  const [designMdDraft, setDesignMdDraft] = useState('');
  const [creatingNew, setCreatingNew] = useState(false);
  const [newName, setNewName] = useState('');

  const reportError = useCallback((err: any) => {
    const msg = err?.message || String(err || 'Design Mode error');
    setNotice(msg);
    onError?.(msg);
  }, [onError]);

  const syncProject = useCallback((next: DesignProject | null) => {
    setProject(next);
    if (!next) return;
    setTokenDraft({ ...(next.spec?.tokens || {}) });
    setDesignMdDraft(next.designMd || '');
    if (next.spec?.preset) setPreset(next.spec.preset);
    setSelectedScreenId(prev => {
      if (prev && next.screens?.some(s => s.id === prev)) return prev;
      return next.screens?.[0]?.id || '';
    });
  }, []);

  const loadState = useCallback(async () => {
    if (!api?.design) return;
    try {
      const res = await api.design('state');
      setProjects(res?.projects || []);
      setProviders(res?.providers?.providers || [{ id: 'auto', label: 'Auto (Active)', connected: true }]);
      if (res?.presets?.length) setPresets(res.presets);
      setWorkFolder(res?.workFolder || '');
      syncProject(res?.activeProject || null);
    } catch (err) {
      reportError(err);
    }
  }, [api, reportError, syncProject]);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  useEffect(() => {
    if (!api?.onDesign) return undefined;
    return api.onDesign((evt: any) => {
      if (!evt) return;
      if (evt.type === 'pipeline') {
        setActivePhase(evt.phase || '');
        const iter = evt.iteration && evt.maxIterations ? ` [${evt.iteration}/${evt.maxIterations}]` : '';
        setPhaseDetail(`${evt.detail || ''}${iter}`);
      } else if (evt.type === 'project-changed' && evt.projectId) {
        void api.design('getProject', evt.projectId).then(syncProject).catch(() => {});
      } else if (evt.type === 'projects-changed') {
        void api.design('listProjects').then(setProjects).catch(() => {});
      }
    });
  }, [api, syncProject]);

  const visibleScreens = useMemo(() => {
    const list = project?.screens || [];
    if (vpFilter === 'all') return list;
    return list.filter(s => s.viewport === vpFilter);
  }, [project, vpFilter]);

  const selectedScreen = useMemo(() => {
    const list = project?.screens || [];
    return list.find(s => s.id === selectedScreenId) || list[0] || null;
  }, [project, selectedScreenId]);

  const fitCanvas = useCallback(() => {
    const list = visibleScreens;
    const host = canvasRef.current;
    if (!list.length || !host) {
      setPan({ x: 36, y: 24 });
      setZoom(0.54);
      return;
    }
    const minX = Math.min(...list.map(s => s.x || 0));
    const minY = Math.min(...list.map(s => s.y || 0));
    const maxX = Math.max(...list.map(s => (s.x || 0) + (s.viewport === 'mobile' ? 320 : 620)));
    const maxY = Math.max(...list.map(s => (s.y || 0) + 520));
    const spanW = Math.max(420, maxX - minX + 80);
    const spanH = Math.max(420, maxY - minY + 80);
    const nextZoom = Math.max(0.28, Math.min(1, Math.min(host.clientWidth / spanW, host.clientHeight / spanH) * 0.92));
    setZoom(Number(nextZoom.toFixed(2)));
    setPan({ x: Math.round(32 - minX * nextZoom), y: Math.round(28 - minY * nextZoom) });
  }, [visibleScreens]);

  const handleSelectProject = async (id: string) => {
    if (!id || !api?.design) return;
    try {
      const next = await api.design('getProject', id);
      syncProject(next);
    } catch (err) {
      reportError(err);
    }
  };

  const handleCreateProject = async () => {
    if (!api?.design || !newName.trim()) return;
    try {
      const next = await api.design('createProject', { name: newName.trim(), preset, folder: workFolder });
      setCreatingNew(false);
      setNewName('');
      const list = await api.design('listProjects');
      setProjects(list || []);
      syncProject(next);
    } catch (err) {
      reportError(err);
    }
  };

  const handleScanRepo = async () => {
    if (!project || !api?.design) return;
    setBusy(true);
    setNotice('');
    try {
      const res = await api.design('scanRepo', { projectId: project.id });
      syncProject(res.project);
      setPhaseDetail(`Ingested ${Object.keys(res.scan?.tokens || {}).length} tokens from ${res.scan?.folder || 'repo'}`);
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleGenerate = async (refineMode = false) => {
    if (!project || !api?.design || !promptText.trim() || busy) return;
    setBusy(true);
    setNotice('');
    setActivePhase('spec');
    setPhaseDetail('Starting Phase 1 Spec Architect…');
    try {
      const res = refineMode && selectedScreen
        ? await api.design('refineScreen', {
            projectId: project.id,
            screenId: selectedScreen.id,
            prompt: promptText.trim(),
            platform,
            preset,
            provider,
            critiqueEnabled,
            enforceTokenLock,
            maxIterations,
          })
        : await api.design('generate', {
            projectId: project.id,
            prompt: promptText.trim(),
            platform,
            preset,
            provider,
            critiqueEnabled,
            enforceTokenLock,
            maxIterations,
          });
      if (res?.project) syncProject(res.project);
      if (res?.screensAdded?.[0]) setSelectedScreenId(res.screensAdded[0]);
      setPromptText('');
      setActivePhase('done');
      setPhaseDetail(`Complete · ${res?.critique?.weightedTotal ?? '—'}/10 (${res?.critique?.passed ? 'PASS' : 'REFINED'})`);
    } catch (err) {
      reportError(err);
      setActivePhase('');
    } finally {
      setBusy(false);
    }
  };

  const handleCritiqueScreen = async (screenId: string) => {
    if (!project || !api?.design || busy) return;
    setBusy(true);
    setNotice('');
    setInspectorOpen(true);
    setInspectorTab('critique');
    setActivePhase('capture');
    try {
      const res = await api.design('critiqueScreen', {
        projectId: project.id,
        screenId,
        provider,
      });
      if (res?.project) syncProject(res.project);
      setActivePhase('done');
      setPhaseDetail(`Critique finished · ${res?.critique?.weightedTotal ?? '—'}/10`);
    } catch (err) {
      reportError(err);
      setActivePhase('');
    } finally {
      setBusy(false);
    }
  };

  const handleApplyTokens = async () => {
    if (!project || !api?.design) return;
    try {
      const next = await api.design('updateTokens', { projectId: project.id, tokens: tokenDraft });
      syncProject(next);
      setPhaseDetail('Applied updated DESIGN.md tokens live to all artboards.');
    } catch (err) {
      reportError(err);
    }
  };

  const handleSaveDesignMd = async () => {
    if (!project || !api?.design) return;
    try {
      const next = await api.design('updateDesignMd', { projectId: project.id, designMd: designMdDraft });
      syncProject(next);
      setPhaseDetail('Saved DESIGN.md contract.');
    } catch (err) {
      reportError(err);
    }
  };

  const handleExportRepo = async () => {
    if (!project || !api?.design) return;
    try {
      const res = await api.design('exportToRepo', { projectId: project.id });
      setPhaseDetail(`Exported ${res.files?.length || 0} files (incl. DESIGN.md) to ${res.root}`);
    } catch (err) {
      reportError(err);
    }
  };

  const handlePublishPage = async () => {
    if (!project || !selectedScreen || !api?.design) return;
    try {
      await api.design('publishPage', { projectId: project.id, screenId: selectedScreen.id });
      setPhaseDetail(`Published "${selectedScreen.title}" to Baryon Pages.`);
    } catch (err) {
      reportError(err);
    }
  };

  // Mouse handlers for canvas pan & artboard repositioning
  const onCanvasMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.ds-artboard')) return;
    panDragRef.current = { startX: e.clientX, startY: e.clientY, origX: pan.x, origY: pan.y };
  };

  const onArtboardHeaderDown = (e: React.MouseEvent, screen: Screen) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.stopPropagation();
    setSelectedScreenId(screen.id);
    boardDragRef.current = {
      screenId: screen.id,
      startX: e.clientX,
      startY: e.clientY,
      origX: screen.x || 0,
      origY: screen.y || 0,
    };
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (panDragRef.current) {
        const d = panDragRef.current;
        setPan({ x: d.origX + (e.clientX - d.startX), y: d.origY + (e.clientY - d.startY) });
      } else if (boardDragRef.current) {
        const d = boardDragRef.current;
        const dx = (e.clientX - d.startX) / zoom;
        const dy = (e.clientY - d.startY) / zoom;
        setProject(prev => prev ? {
          ...prev,
          screens: prev.screens.map(s => s.id === d.screenId ? { ...s, x: Math.round(d.origX + dx), y: Math.round(d.origY + dy) } : s),
        } : prev);
      }
    };
    const onUp = () => {
      if (boardDragRef.current && project && api?.design) {
        const movedId = boardDragRef.current.screenId;
        const scr = project.screens.find(s => s.id === movedId);
        if (scr) {
          void api.design('moveScreen', { projectId: project.id, screenId: scr.id, x: scr.x, y: scr.y }).catch(() => {});
        }
      }
      panDragRef.current = null;
      boardDragRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [zoom, project, api]);

  const activeStepIdx = activePhase === 'done'
    ? 4
    : PHASE_STEPS.findIndex(p => p.id === activePhase);

  const activeCritique = selectedScreen?.critique || null;
  const activeGate = selectedScreen?.staticGate || null;

  return (
    <div className="ds-root" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <header className="ds-topbar">
        <div className="ds-bar-group">
          <span className="ds-brand"><span className="ds-brand-dot" />Design</span>
          <select
            className="ds-select"
            aria-label="Design project"
            value={project?.id || ''}
            onChange={e => void handleSelectProject(e.target.value)}
          >
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {creatingNew ? (
            <>
              <input
                className="ds-input"
                placeholder="New canvas name…"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void handleCreateProject(); }}
              />
              <button type="button" className="ds-btn is-primary" onClick={() => void handleCreateProject()}>Create</button>
              <button type="button" className="ds-btn" onClick={() => setCreatingNew(false)}>Cancel</button>
            </>
          ) : (
            <button type="button" className="ds-btn" onClick={() => setCreatingNew(true)}>+ New</button>
          )}
          {(workFolder || project?.folder) && (
            <>
              <span className="ds-repo-pill" title={project?.folder || workFolder}>
                Repo: {(project?.folder || workFolder).split('/').at(-1)}
              </span>
              <button type="button" className="ds-btn" disabled={busy} onClick={() => void handleScanRepo()}>
                Scan Repo
              </button>
            </>
          )}
        </div>

        <div className="ds-bar-group">
          <div className="ds-seg" role="group" aria-label="Viewport filter">
            {(['all', 'desktop', 'mobile'] as const).map(f => (
              <button key={f} type="button" className={vpFilter === f ? 'is-on' : ''} onClick={() => setVpFilter(f)}>
                {f === 'all' ? 'All' : f === 'desktop' ? 'Desktop' : 'Mobile'}
              </button>
            ))}
          </div>
          <div className="ds-seg" role="group" aria-label="Canvas interaction mode">
            <button type="button" className={canvasMode === 'select' ? 'is-on' : ''} onClick={() => setCanvasMode('select')}>Select</button>
            <button type="button" className={canvasMode === 'interact' ? 'is-on' : ''} onClick={() => setCanvasMode('interact')}>Interact</button>
          </div>
          <div className="ds-seg" role="group" aria-label="Canvas zoom">
            <button type="button" onClick={() => setZoom(z => Math.max(0.25, Number((z - 0.1).toFixed(2))))}>−</button>
            <button type="button" className="is-on" onClick={fitCanvas}>{Math.round(zoom * 100)}% Fit</button>
            <button type="button" onClick={() => setZoom(z => Math.min(1.25, Number((z + 0.1).toFixed(2))))}>+</button>
          </div>
          <button type="button" className="ds-btn" disabled={!project?.screens?.length} onClick={() => void handleExportRepo()}>Export Repo</button>
          <button type="button" className="ds-btn" disabled={!selectedScreen} onClick={() => void handlePublishPage()}>Publish Page</button>
          <button type="button" className={`ds-btn ${inspectorOpen ? 'is-on' : ''}`} onClick={() => setInspectorOpen(v => !v)}>Inspector</button>
        </div>
      </header>

      <div className={`ds-workspace ${inspectorOpen ? '' : 'no-inspector'}`}>
        <aside className="ds-left" aria-label="Design prompt and pipeline">
          <div className="ds-pipeline">
            <div className="ds-phases">
              {PHASE_STEPS.map((st, idx) => {
                const cls = activeStepIdx > idx ? 'is-done' : activeStepIdx === idx ? 'is-active' : '';
                return <div key={st.id} className={`ds-phase ${cls}`}>{st.label}</div>;
              })}
            </div>
            <div className="ds-pipeline-status" title={notice || phaseDetail}>
              {notice ? `Error: ${notice}` : phaseDetail}
            </div>
          </div>

          <div className="ds-turns">
            {(project?.turns || []).slice().reverse().map(turn => (
              <article key={turn.id} className="ds-turn-card">
                <div className="ds-turn-prompt">{turn.prompt}</div>
                <div className="ds-turn-meta">
                  <span>{turn.archetype || 'Custom Spec'}</span>
                  {turn.score != null && (
                    <span className={`ds-score-pill ${turn.passed === false ? 'is-fail' : ''}`}>
                      {turn.score}/10 · {turn.iterations || 1}x
                    </span>
                  )}
                </div>
                {turn.summary && <p style={{ fontSize: 11.5, color: 'var(--ds-dim)' }}>{turn.summary}</p>}
              </article>
            ))}
            {!project?.turns?.length && (
              <div style={{ fontSize: 12, color: 'var(--ds-dim)', padding: 6 }}>
                Describe an app, landing page, or dashboard below. Phase 1 commits a DESIGN.md contract before code runs.
              </div>
            )}
          </div>

          <div className="ds-composer">
            <textarea
              aria-label="UI design prompt"
              placeholder={selectedScreen
                ? `Describe a new UI or how to refine "${selectedScreen.title}"…`
                : 'Describe the UI you want to craft (e.g., Swiss editorial climate dashboard)…'}
              value={promptText}
              onChange={e => setPromptText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void handleGenerate(false);
                }
              }}
            />
            <div className="ds-ctrl-grid">
              <select className="ds-select" aria-label="Target viewport" value={platform} onChange={e => setPlatform(e.target.value as any)}>
                <option value="responsive">Responsive Pair</option>
                <option value="desktop">Desktop (1440px)</option>
                <option value="mobile">Mobile (390px)</option>
              </select>
              <select className="ds-select" aria-label="Aesthetic preset" value={preset} onChange={e => setPreset(e.target.value)}>
                {presets.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              <select className="ds-select" aria-label="Design model provider" value={provider} onChange={e => setProvider(e.target.value)}>
                {providers.map(p => (
                  <option key={p.id} value={p.id}>{p.label}{p.connected === false ? ' (Sign in)' : ''}</option>
                ))}
              </select>
              <select className="ds-select" aria-label="Critique iterations" value={maxIterations} onChange={e => setMaxIterations(Number(e.target.value))}>
                <option value={1}>Critique: 1 pass</option>
                <option value={2}>Critique: Max 2</option>
                <option value={3}>Critique: Max 3</option>
              </select>
            </div>
            <div className="ds-toggles">
              <label className="ds-check">
                <input type="checkbox" checked={critiqueEnabled} onChange={e => setCritiqueEnabled(e.target.checked)} />
                Vision Critique
              </label>
              <label className="ds-check">
                <input type="checkbox" checked={enforceTokenLock} onChange={e => setEnforceTokenLock(e.target.checked)} />
                Token Lock
              </label>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                className="ds-btn is-primary"
                style={{ flex: 1, justifyContent: 'center' }}
                disabled={busy || !promptText.trim()}
                onClick={() => void handleGenerate(false)}
              >
                {busy ? 'Running 4-Stage Pipeline…' : 'Generate Stitch Canvas'}
              </button>
              {selectedScreen && (
                <button
                  type="button"
                  className="ds-btn"
                  disabled={busy || !promptText.trim()}
                  title="Refine the selected artboard using your prompt and DESIGN.md"
                  onClick={() => void handleGenerate(true)}
                >
                  Refine Selected
                </button>
              )}
            </div>
          </div>
        </aside>

        <div
          ref={canvasRef}
          className={`ds-canvas ${panDragRef.current ? 'is-panning' : ''}`}
          onMouseDown={onCanvasMouseDown}
          onWheel={e => {
            if (e.metaKey || e.ctrlKey) {
              e.preventDefault();
              const delta = e.deltaY > 0 ? -0.05 : 0.05;
              setZoom(z => Math.max(0.25, Math.min(1.25, Number((z + delta).toFixed(2)))));
            }
          }}
        >
          <div className="ds-stage-transform" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
            {visibleScreens.map(screen => {
              const isMobile = screen.viewport === 'mobile';
              const frameW = isMobile ? 390 : 1200;
              const frameH = isMobile ? 760 : 760;
              return (
                <div
                  key={screen.id}
                  className={`ds-artboard ${selectedScreen?.id === screen.id ? 'is-selected' : ''} ${isMobile ? 'is-mobile' : ''}`}
                  style={{ left: screen.x || 60, top: screen.y || 60, width: frameW }}
                  onClick={() => setSelectedScreenId(screen.id)}
                >
                  <div className="ds-artboard-head" onMouseDown={e => onArtboardHeaderDown(e, screen)}>
                    <div className="ds-artboard-title">
                      <span>{screen.title}</span>
                      <span className="ds-dim-tag">{screen.width}×{screen.height}</span>
                      {screen.critique && (
                        <span className={`ds-score-pill ${screen.critique.passed ? '' : 'is-fail'}`}>
                          {screen.critique.weightedTotal}
                        </span>
                      )}
                    </div>
                    <div className="ds-artboard-actions">
                      <button type="button" className="ds-icon-btn" onClick={() => void handleCritiqueScreen(screen.id)}>Critique</button>
                      <button
                        type="button"
                        className="ds-icon-btn"
                        onClick={() => void api?.design('duplicateScreen', { projectId: project?.id, screenId: screen.id }).then(syncProject).catch(reportError)}
                      >
                        Duplicate
                      </button>
                      <button
                        type="button"
                        className="ds-icon-btn"
                        onClick={() => void api?.design('deleteScreen', { projectId: project?.id, screenId: screen.id }).then(syncProject).catch(reportError)}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                  <div className="ds-frame-wrap" style={{ width: frameW, height: frameH }}>
                    <iframe
                      title={screen.title}
                      sandbox="allow-scripts"
                      srcDoc={screen.html}
                      style={{ width: frameW, height: frameH }}
                    />
                    {canvasMode === 'select' && (
                      <div className="ds-frame-shield" title="Click to select artboard (switch to Interact mode above to click inside UI)" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {!visibleScreens.length && (
            <div className="ds-empty" style={{ position: 'relative', top: '28%' }}>
              <span className="ds-kicker">BARYON STITCH STUDIO</span>
              <h2 style={{ fontSize: 18 }}>No artboards on this canvas yet</h2>
              <p style={{ fontSize: 12.5, color: 'var(--ds-dim)' }}>
                Enter a UI prompt on the left to generate a DESIGN.md contract, desktop + mobile screens, and a vision critique score.
              </p>
            </div>
          )}
          <div className="ds-canvas-hint">
            Drag empty dot-grid to pan · Drag artboard headers to arrange · Switch to Interact mode to test buttons/tabs
          </div>
        </div>

        {inspectorOpen && (
          <aside className="ds-inspector" aria-label="Design Inspector">
            <div className="ds-tabs" role="tablist">
              <button type="button" role="tab" className={inspectorTab === 'tokens' ? 'is-on' : ''} onClick={() => setInspectorTab('tokens')}>Tokens</button>
              <button type="button" role="tab" className={inspectorTab === 'critique' ? 'is-on' : ''} onClick={() => setInspectorTab('critique')}>Critique</button>
              <button type="button" role="tab" className={inspectorTab === 'code' ? 'is-on' : ''} onClick={() => setInspectorTab('code')}>Code</button>
              <button type="button" role="tab" className={inspectorTab === 'captures' ? 'is-on' : ''} onClick={() => setInspectorTab('captures')}>Captures</button>
            </div>

            <div className="ds-insp-scroll">
              {inspectorTab === 'tokens' && (
                <>
                  <section className="ds-section-card">
                    <span className="ds-kicker">AESTHETIC THESIS</span>
                    <strong style={{ fontSize: 13 }}>{project?.spec?.archetype || 'Precision Editorial'}</strong>
                    <p style={{ fontSize: 12, color: 'var(--ds-dim)' }}>{project?.spec?.mood || ''}</p>
                    <div style={{ fontSize: 11.5, color: 'var(--ds-soft)' }}>
                      Display: <strong>{project?.spec?.typography?.display || '—'}</strong> · Body: <strong>{project?.spec?.typography?.body || '—'}</strong>
                    </div>
                  </section>

                  <section className="ds-section-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className="ds-kicker">LIVE TOKEN LOCK</span>
                      <button type="button" className="ds-btn is-primary" onClick={() => void handleApplyTokens()}>Apply Live</button>
                    </div>
                    {Object.entries(tokenDraft).map(([key, val]) => {
                      const isHex = /^#[0-9a-f]{6}$/i.test(String(val).trim());
                      return (
                        <div key={key} className="ds-token-row">
                          <code title={key}>{key}</code>
                          <input
                            type="color"
                            className="ds-color-swatch"
                            aria-label={key}
                            value={isHex ? val : '#3e5aec'}
                            onChange={e => setTokenDraft(d => ({ ...d, [key]: e.target.value }))}
                          />
                          <input
                            className="ds-input"
                            style={{ height: 24, fontSize: 11 }}
                            value={val}
                            onChange={e => setTokenDraft(d => ({ ...d, [key]: e.target.value }))}
                          />
                        </div>
                      );
                    })}
                  </section>

                  <section className="ds-section-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className="ds-kicker">DESIGN.MD CONTRACT</span>
                      <button type="button" className="ds-btn" onClick={() => void handleSaveDesignMd()}>Save</button>
                    </div>
                    <textarea className="ds-md-editor" value={designMdDraft} onChange={e => setDesignMdDraft(e.target.value)} />
                  </section>
                </>
              )}

              {inspectorTab === 'critique' && (
                <>
                  <section className="ds-section-card">
                    <span className="ds-kicker">ADVERSARIAL CRITIQUE</span>
                    {activeCritique ? (
                      <>
                        <div className="ds-score-hero">
                          <div>
                            <div className="ds-score-num">{activeCritique.weightedTotal}</div>
                            <div style={{ fontSize: 11, color: 'var(--ds-dim)' }}>Weighted Rubric (Threshold {activeCritique.threshold})</div>
                          </div>
                          <span className={`ds-score-pill ${activeCritique.passed ? '' : 'is-fail'}`}>
                            {activeCritique.passed ? 'PASS' : 'NEEDS REFINEMENT'}
                          </span>
                        </div>
                        {[
                          ['Design Quality (35%)', activeCritique.scores?.designQuality],
                          ['Originality (30%)', activeCritique.scores?.originality],
                          ['Craft & Polish (20%)', activeCritique.scores?.craft],
                          ['Functionality (15%)', activeCritique.scores?.functionality],
                        ].map(([label, score]) => (
                          <div key={String(label)} className="ds-bar-row">
                            <div className="ds-bar-head"><span>{label}</span><span>{score ?? '—'}/10</span></div>
                            <div className="ds-bar-track"><div className="ds-bar-fill" style={{ width: `${Math.min(100, Number(score || 0) * 10)}%` }} /></div>
                          </div>
                        ))}
                      </>
                    ) : (
                      <p style={{ fontSize: 12, color: 'var(--ds-dim)' }}>Run Vision Critique on any artboard to inspect rubric scores.</p>
                    )}
                    {selectedScreen && (
                      <button type="button" className="ds-btn is-primary" disabled={busy} onClick={() => void handleCritiqueScreen(selectedScreen.id)}>
                        Run Vision Critique Now
                      </button>
                    )}
                  </section>

                  {activeGate && (
                    <section className="ds-section-card">
                      <span className="ds-kicker">STATIC VERIFICATION GATE</span>
                      <div style={{ fontSize: 12, color: activeGate.passed ? 'var(--ds-emerald)' : 'var(--ds-amber)' }}>
                        {activeGate.passed ? 'Passed Token Lock & Anti-Slop checks' : `${activeGate.errors.length} gate violation(s)`}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--ds-dim)' }}>
                        Raw hex outside :root: {activeGate.metrics?.rawHexOutsideRoot ?? 0} · Text contrast: {activeGate.metrics?.textContrast ?? '—'}:1
                      </div>
                      {activeGate.errors?.map((err, i) => <div key={i} style={{ fontSize: 11.5, color: 'var(--ds-red)' }}>• {err}</div>)}
                    </section>
                  )}

                  {activeCritique?.criticalIssues?.length ? (
                    <section className="ds-section-card">
                      <span className="ds-kicker">ACTIONABLE ISSUES</span>
                      {activeCritique.criticalIssues.map((iss, i) => (
                        <div key={i} style={{ fontSize: 11.5, color: 'var(--ds-amber)' }}>• {iss}</div>
                      ))}
                    </section>
                  ) : null}
                </>
              )}

              {inspectorTab === 'code' && (
                <section className="ds-section-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                    <div className="ds-seg">
                      <button type="button" className={codeTab === 'html' ? 'is-on' : ''} onClick={() => setCodeTab('html')}>HTML / CSS</button>
                      <button type="button" className={codeTab === 'react' ? 'is-on' : ''} onClick={() => setCodeTab('react')}>React TSX</button>
                    </div>
                    <button
                      type="button"
                      className="ds-btn"
                      onClick={() => {
                        const code = codeTab === 'react' ? (selectedScreen?.reactCode || '// No TSX snippet') : (selectedScreen?.html || '');
                        void navigator.clipboard?.writeText(code);
                        setPhaseDetail('Copied code to clipboard.');
                      }}
                    >
                      Copy
                    </button>
                  </div>
                  <pre className="ds-code-pre">
                    {codeTab === 'react' ? (selectedScreen?.reactCode || '// No React TSX snippet generated for this screen.') : (selectedScreen?.html || '<!-- Select an artboard -->')}
                  </pre>
                </section>
              )}

              {inspectorTab === 'captures' && (
                <section className="ds-section-card">
                  <span className="ds-kicker">PHASE 3 RENDERED CAPTURES</span>
                  {selectedScreen?.captures?.length ? (
                    selectedScreen.captures.map(cap => (
                      <div key={cap.name} className="ds-capture-card">
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5 }}>
                          <strong>{cap.name} ({cap.width}×{cap.height})</strong>
                          <span style={{ color: cap.overflowX ? 'var(--ds-red)' : 'var(--ds-emerald)' }}>
                            {cap.overflowX ? 'OverflowX detected' : 'Clean layout'}
                          </span>
                        </div>
                        {cap.dataUrl ? <img src={cap.dataUrl} alt={`${cap.name} capture`} /> : <div style={{ fontSize: 11, color: 'var(--ds-dim)' }}>Capture skipped.</div>}
                      </div>
                    ))
                  ) : (
                    <p style={{ fontSize: 12, color: 'var(--ds-dim)' }}>
                      Click Critique on any artboard (or generate with Vision Critique enabled) to capture 1440×900 &amp; 390×844 offscreen screenshots.
                    </p>
                  )}
                </section>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
