// 4-Stage Pipeline Controller for Agentic Frontend UI Design Mode.
import { evaluateDesign, extractJsonObject } from './evaluator.mjs';
import {
  AESTHETIC_PRESETS,
  buildPhase1SpecPrompt,
  buildPhase2GeneratePrompt,
  renderDesignMarkdown,
  validateDesignSpec,
} from './skill.mjs';
import { runStaticGate } from './static-gate.mjs';
import { checkDesignId } from './store.mjs';

const clampInt = (val, lo, hi, fb) => {
  const n = Math.round(Number(val));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fb;
};

const clampNum = (val, lo, hi, fb) => {
  const n = Number(val);
  return Number.isFinite(n) ? Number(Math.max(lo, Math.min(hi, n)).toFixed(2)) : fb;
};

function emit(onEvent, payload) {
  try {
    onEvent?.(payload);
  } catch {}
}

function normalizeScreenDraft(raw, index, existingScreens = []) {
  const viewport = raw?.viewport === 'mobile' ? 'mobile' : 'desktop';
  const width = viewport === 'mobile' ? 390 : 1440;
  const height = viewport === 'mobile' ? 844 : 900;
  const prevSame = existingScreens.find(s => s.id === raw?.id) || null;
  const col = existingScreens.length + index;
  const defaultX = viewport === 'mobile' ? 620 + index * 320 : 60 + col * 580;
  return {
    id: prevSame?.id || checkDesignId(`scr-${Date.now().toString(36)}-${index}`),
    title: String(raw?.title || (viewport === 'mobile' ? 'Mobile View' : 'Desktop View')).trim().slice(0, 80),
    viewport,
    width,
    height,
    x: prevSame ? prevSame.x : defaultX,
    y: prevSame ? prevSame.y : 64,
    html: String(raw?.html || '').trim(),
    reactCode: String(raw?.reactCode || '').trim(),
    notes: String(raw?.notes || '').trim(),
    updatedAt: Date.now(),
  };
}

/**
 * Execute the 4-stage Agentic UI Design pipeline:
 * Phase 1 (Spec/DESIGN.md) -> Phase 2 (Generate + Static Gate) -> Phase 3 (Capture) -> Phase 4 (Adversarial Critique loop).
 */
export async function runDesignGeneration({
  store,
  projectId,
  prompt,
  platform = 'responsive',
  preset = 'auto',
  provider = 'auto',
  enforceTokenLock = true,
  critiqueEnabled = true,
  maxIterations = 3,
  passingScore = 8.0,
  targetScreenId = null,
  askAI,
  capturePreview = null,
  onEvent = () => {},
  signal,
} = {}) {
  const cleanPrompt = String(prompt || '').trim();
  if (!cleanPrompt) throw new Error('Describe the UI you want to design.');
  if (typeof askAI !== 'function') throw new Error('Connect Claude, Gemini, or Codex in Settings first.');

  const project = await store.getProject(projectId);
  if (!project) throw new Error('Design project not found.');

  const iters = critiqueEnabled ? clampInt(maxIterations, 1, 3, 2) : 1;
  const threshold = clampNum(passingScore, 5, 10, 8.0);
  const providerOverride = provider && provider !== 'auto' ? provider : null;
  const repoScan = project.repoScan || null;
  const allowRepoFonts = Boolean(repoScan?.hasDesignMd || repoScan?.fonts?.length);

  // ── Phase 1: Context Ingestion & Spec Pre-Flight ──
  emit(onEvent, {
    type: 'pipeline',
    projectId: project.id,
    phase: 'spec',
    step: 1,
    iteration: 1,
    maxIterations: iters,
    detail: repoScan ? 'Aligning with discovered repository DESIGN.md & tokens…' : 'Synthesizing DESIGN.md contract & typography pairing…',
  });

  let activeSpec = project.spec || AESTHETIC_PRESETS[preset] || AESTHETIC_PRESETS.auto;
  let activeDesignMd = project.designMd || '';

  const specPrompt = buildPhase1SpecPrompt({
    prompt: cleanPrompt,
    platform,
    preset,
    repoScan,
    existingSpec: project.screens?.length ? project.spec : null,
  });

  const specRes = await askAI({
    instructions: 'You are Phase 1 Architect / Art Director. Commit to a clear aesthetic direction and DESIGN.md token contract. Reply ONLY with JSON.',
    prompt: specPrompt,
    providerOverride,
    timeoutMs: 75_000,
    signal,
  });

  const parsedSpec = extractJsonObject(specRes?.text);
  const gate1 = validateDesignSpec(parsedSpec || activeSpec, { allowRepoFonts });
  activeSpec = gate1.normalized;
  activeDesignMd = renderDesignMarkdown(activeSpec, parsedSpec?.title || project.name);

  project.spec = activeSpec;
  project.designMd = activeDesignMd;
  await store.saveProject(project);

  // Target screen when refining an existing artboard
  const targetScreen = targetScreenId
    ? (project.screens || []).find(s => s.id === checkDesignId(targetScreenId))
    : null;
  const effectivePlatform = targetScreen ? targetScreen.viewport : platform;

  // ── Phases 2 -> 3 -> 4 Bounded Refinement Loop ──
  let bestCandidate = null;
  let lastCritique = null;
  let usedIterations = 0;

  for (let iteration = 1; iteration <= iters; iteration++) {
    usedIterations = iteration;

    emit(onEvent, {
      type: 'pipeline',
      projectId: project.id,
      phase: 'generate',
      step: 2,
      iteration,
      maxIterations: iters,
      detail: iteration === 1
        ? `Generating token-locked ${effectivePlatform} UI…`
        : `Refining UI from Evaluator critique (attempt ${iteration}/${iters})…`,
    });

    const genPrompt = buildPhase2GeneratePrompt({
      prompt: cleanPrompt,
      platform: effectivePlatform,
      spec: activeSpec,
      designMd: activeDesignMd,
      repoScan,
      existingScreens: bestCandidate?.screens?.length
        ? bestCandidate.screens
        : targetScreen
          ? [targetScreen]
          : [],
      critiqueFeedback: lastCritique,
      enforceTokenLock,
    });

    const genRes = await askAI({
      instructions: 'You are Phase 2 Principal UI Implementation Engineer. Output complete self-contained HTML5/CSS/JS locked strictly to DESIGN.md. Reply ONLY with JSON.',
      prompt: genPrompt,
      providerOverride,
      timeoutMs: 120_000,
      signal,
    });

    const parsedGen = extractJsonObject(genRes?.text);
    const rawScreens = Array.isArray(parsedGen?.screens) && parsedGen.screens.length
      ? parsedGen.screens
      : parsedGen?.html
        ? [{ title: project.name, viewport: effectivePlatform === 'mobile' ? 'mobile' : 'desktop', html: parsedGen.html, reactCode: parsedGen.reactCode || '' }]
        : [];

    if (!rawScreens.length) {
      throw new Error('Model did not return generated screen HTML. Please retry.');
    }

    const candidateScreens = rawScreens.map((raw, idx) => {
      const normalized = normalizeScreenDraft(
        targetScreen && idx === 0 ? { ...raw, id: targetScreen.id } : raw,
        idx,
        targetScreen ? project.screens : (project.screens || []),
      );
      normalized.staticGate = runStaticGate({
        html: normalized.html,
        spec: activeSpec,
        enforceTokenLock,
        allowRepoFonts,
      });
      return normalized;
    });

    const primary = candidateScreens[0];

    // ── Phase 3: Offscreen Multi-Viewport Capture ──
    emit(onEvent, {
      type: 'pipeline',
      projectId: project.id,
      phase: 'capture',
      step: 3,
      iteration,
      maxIterations: iters,
      detail: 'Capturing 1440×900 desktop & 390×844 mobile viewports…',
    });

    let captureReport = { available: false, captures: [], consoleErrors: [], hasOverflow: false };
    if (typeof capturePreview === 'function' && primary?.html) {
      const viewports = candidateScreens.length === 1 && primary.viewport === 'mobile'
        ? [{ name: 'mobile', width: 390, height: 844 }]
        : undefined;
      captureReport = await capturePreview({ html: primary.html, viewports }).catch(err => ({
        available: false,
        captures: [],
        consoleErrors: [err.message],
        hasOverflow: false,
      }));
    }

    // ── Phase 4: Isolated Adversarial Critique ──
    emit(onEvent, {
      type: 'pipeline',
      projectId: project.id,
      phase: 'critique',
      step: 4,
      iteration,
      maxIterations: iters,
      detail: critiqueEnabled ? 'Isolated Evaluator scoring taste, craft & hierarchy…' : 'Running static craft check…',
    });

    const critique = await evaluateDesign({
      prompt: cleanPrompt,
      spec: activeSpec,
      designMd: activeDesignMd,
      html: primary.html,
      captures: captureReport.captures || [],
      staticGate: primary.staticGate,
      captureReport,
      askAI: critiqueEnabled ? askAI : null,
      provider,
      threshold,
      signal,
    });

    for (const scr of candidateScreens) {
      scr.critique = critique;
      scr.captures = captureReport.captures || [];
    }

    const candidate = {
      screens: candidateScreens,
      critique,
      summary: String(parsedGen?.summary || '').trim(),
      provider: genRes?.provider || provider,
    };

    if (!bestCandidate || critique.weightedTotal >= bestCandidate.critique.weightedTotal) {
      bestCandidate = candidate;
    }

    emit(onEvent, {
      type: 'pipeline',
      projectId: project.id,
      phase: 'critique',
      step: 4,
      iteration,
      maxIterations: iters,
      score: critique.weightedTotal,
      passed: critique.passed,
      detail: `Score ${critique.weightedTotal}/10 (${critique.passed ? 'PASS' : 'NEEDS REFINEMENT'})`,
    });

    lastCritique = critique;
    if (!critiqueEnabled || critique.passed) break;
  }

  // Merge kept screens into project
  const existing = [...(project.screens || [])];
  for (const nextScr of bestCandidate.screens) {
    const idx = existing.findIndex(s => s.id === nextScr.id);
    if (idx >= 0) existing[idx] = nextScr;
    else existing.push(nextScr);
  }
  project.screens = existing;
  project.turns = [
    ...(project.turns || []),
    {
      id: `turn-${Date.now().toString(36)}`,
      at: Date.now(),
      prompt: cleanPrompt,
      provider: bestCandidate.provider || provider,
      archetype: activeSpec.archetype,
      iterations: usedIterations,
      score: bestCandidate.critique.weightedTotal,
      passed: bestCandidate.critique.passed,
      summary: bestCandidate.summary || `Generated ${bestCandidate.screens.length} artboard(s) under ${activeSpec.archetype}.`,
    },
  ].slice(-40);

  const saved = await store.saveProject(project);
  emit(onEvent, {
    type: 'project-changed',
    projectId: saved.id,
    score: bestCandidate.critique.weightedTotal,
  });

  return {
    project: saved,
    critique: bestCandidate.critique,
    iterations: usedIterations,
    screensAdded: bestCandidate.screens.map(s => s.id),
  };
}

/**
 * Run Phase 3 capture + Phase 4 isolated critique on an existing artboard on demand.
 */
export async function critiqueSingleScreen({
  store,
  projectId,
  screenId,
  provider = 'auto',
  passingScore = 8.0,
  askAI,
  capturePreview = null,
  onEvent = () => {},
  signal,
} = {}) {
  const project = await store.getProject(projectId);
  if (!project) throw new Error('Design project not found.');
  const cleanScreen = checkDesignId(screenId);
  const screen = (project.screens || []).find(s => s.id === cleanScreen);
  if (!screen) throw new Error('Screen not found.');

  emit(onEvent, { type: 'pipeline', projectId: project.id, phase: 'capture', step: 3, iteration: 1, maxIterations: 1, detail: `Capturing ${screen.title}…` });
  const staticGate = runStaticGate({
    html: screen.html,
    spec: project.spec,
    enforceTokenLock: true,
    allowRepoFonts: Boolean(project.repoScan?.hasDesignMd || project.repoScan?.fonts?.length),
  });

  let captureReport = { available: false, captures: [], consoleErrors: [], hasOverflow: false };
  if (typeof capturePreview === 'function' && screen.html) {
    captureReport = await capturePreview({
      html: screen.html,
      viewports: screen.viewport === 'mobile' ? [{ name: 'mobile', width: 390, height: 844 }] : undefined,
    }).catch(() => ({ available: false, captures: [], consoleErrors: [], hasOverflow: false }));
  }

  emit(onEvent, { type: 'pipeline', projectId: project.id, phase: 'critique', step: 4, iteration: 1, maxIterations: 1, detail: 'Running isolated Vision Evaluator…' });
  const critique = await evaluateDesign({
    prompt: screen.title,
    spec: project.spec,
    designMd: project.designMd,
    html: screen.html,
    captures: captureReport.captures || [],
    staticGate,
    captureReport,
    askAI,
    provider,
    threshold: clampNum(passingScore, 5, 10, 8.0),
    signal,
  });

  screen.staticGate = staticGate;
  screen.captures = captureReport.captures || [];
  screen.critique = critique;
  screen.updatedAt = Date.now();

  const saved = await store.saveProject(project);
  emit(onEvent, { type: 'project-changed', projectId: saved.id, score: critique.weightedTotal });
  return { project: saved, screen, critique };
}
