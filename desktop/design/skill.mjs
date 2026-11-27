// Progressive UI Design skill injection, aesthetic presets, DESIGN.md rendering, and Phase 1/2/4 prompts.

export const BANNED_FONTS = Object.freeze(['inter', 'roboto', 'arial', 'helvetica']);

export const AESTHETIC_PRESETS = Object.freeze({
  auto: {
    id: 'auto',
    label: 'Auto (Domain Fit)',
    archetype: 'Precision Editorial Workspace',
    mood: 'Matte tactile surfaces with hairline 1px borders, strong typographic contrast, and zero generic card slop',
    displayFont: 'Instrument Serif',
    bodyFont: 'Plus Jakarta Sans',
    monoFont: 'JetBrains Mono',
    tokens: {
      '--bg-canvas': '#09090b',
      '--bg-surface': '#111114',
      '--bg-elevated': '#18181d',
      '--text-primary': '#f4f4f6',
      '--text-secondary': '#a1a1aa',
      '--accent-primary': '#d4a259',
      '--border-subtle': '#27272f',
    },
  },
  editorial: {
    id: 'editorial',
    label: 'Editorial Print',
    archetype: 'Swiss Editorial Print',
    mood: 'Warm matte paper with crisp ink hairlines, asymmetric columns, and editorial display serif headings',
    displayFont: 'Fraunces',
    bodyFont: 'Plus Jakarta Sans',
    monoFont: 'IBM Plex Mono',
    tokens: {
      '--bg-canvas': '#f6f3ec',
      '--bg-surface': '#efebe1',
      '--bg-elevated': '#ffffff',
      '--text-primary': '#17171a',
      '--text-secondary': '#57564f',
      '--accent-primary': '#b8432b',
      '--border-subtle': '#d8d2c5',
    },
  },
  instrument: {
    id: 'instrument',
    label: 'Tactile Dark Instrument',
    archetype: 'Precision Dark Hardware Instrument',
    mood: 'Deep obsidian metal wells, machined 1px dividers, amber/cyan indicator telemetry, zero blur slop',
    displayFont: 'Space Grotesk',
    bodyFont: 'DM Sans',
    monoFont: 'JetBrains Mono',
    tokens: {
      '--bg-canvas': '#07080b',
      '--bg-surface': '#0e1015',
      '--bg-elevated': '#161922',
      '--text-primary': '#eef1f6',
      '--text-secondary': '#949bab',
      '--accent-primary': '#18b8cc',
      '--border-subtle': '#232834',
    },
  },
  swiss: {
    id: 'swiss',
    label: 'Swiss Grid Utility',
    archetype: 'Swiss Grid Brutalism',
    mood: 'High-contrast structural grid lines, disciplined tabular metadata, stark type scale, signal vermilion accent',
    displayFont: 'Syne',
    bodyFont: 'IBM Plex Sans',
    monoFont: 'IBM Plex Mono',
    tokens: {
      '--bg-canvas': '#f4f4f1',
      '--bg-surface': '#eaeae4',
      '--bg-elevated': '#ffffff',
      '--text-primary': '#111111',
      '--text-secondary': '#52524e',
      '--accent-primary': '#d9381e',
      '--border-subtle': '#cfcfc6',
    },
  },
  architectural: {
    id: 'architectural',
    label: 'Warm Architectural',
    archetype: 'Warm Architectural Monograph',
    mood: 'Limestone plaster surfaces, bronze hairlines, generous whitespace, calm editorial rhythm',
    displayFont: 'Instrument Serif',
    bodyFont: 'DM Sans',
    monoFont: 'JetBrains Mono',
    tokens: {
      '--bg-canvas': '#12110f',
      '--bg-surface': '#1a1815',
      '--bg-elevated': '#23201c',
      '--text-primary': '#f2ede4',
      '--text-secondary': '#a89f91',
      '--accent-primary': '#c9935b',
      '--border-subtle': '#2f2b25',
    },
  },
  terminal: {
    id: 'terminal',
    label: 'Financial Terminal',
    archetype: 'High-Craft Financial Terminal',
    mood: 'True matte black canvas, dense tabular data alignment, emerald/amber status ticks, hairline rules',
    displayFont: 'Space Grotesk',
    bodyFont: 'IBM Plex Sans',
    monoFont: 'JetBrains Mono',
    tokens: {
      '--bg-canvas': '#050608',
      '--bg-surface': '#0b0d11',
      '--bg-elevated': '#131720',
      '--text-primary': '#f0f3f8',
      '--text-secondary': '#8892a4',
      '--accent-primary': '#34d399',
      '--border-subtle': '#1e2430',
    },
  },
  organic: {
    id: 'organic',
    label: 'Botanical Organic',
    archetype: 'Tactile Botanical Studio',
    mood: 'Warm sage-ivory surfaces, deep forest ink, expressive serif hierarchy, soft natural transitions',
    displayFont: 'Fraunces',
    bodyFont: 'Plus Jakarta Sans',
    monoFont: 'IBM Plex Mono',
    tokens: {
      '--bg-canvas': '#f2f3ed',
      '--bg-surface': '#e7eae0',
      '--bg-elevated': '#fafbf7',
      '--text-primary': '#16241a',
      '--text-secondary': '#4c5e51',
      '--accent-primary': '#2d6a4f',
      '--border-subtle': '#cdd4c3',
    },
  },
});

export const REQUIRED_TOKEN_KEYS = Object.freeze([
  '--bg-canvas',
  '--bg-surface',
  '--text-primary',
  '--text-secondary',
  '--accent-primary',
  '--border-subtle',
]);

export const DESIGN_SKILL_RULES = `AESTHETIC & ANTI-SLOP DIRECTIVE (Baryon UI Design Mode):
1. Commit to a distinctive domain archetype (Editorial Print, Tactile Dark Instrument, Swiss Grid Utility, Warm Architectural, Financial Terminal).
2. EXPLICIT NEGATIVE CONSTRAINTS:
   - Typography: BAN Inter, Roboto, Arial, and default system stacks (unless mandated by an existing repo DESIGN.md). Pair an expressive display font (e.g. Fraunces, Instrument Serif, Space Grotesk, Syne) with a crisp body font (Plus Jakarta Sans, DM Sans, IBM Plex Sans) and tabular monospace (JetBrains Mono, IBM Plex Mono).
   - Color & Surfaces: BAN SaaS purple-to-blue gradients, flat unlayered #FFFFFF/#F9FAFB backgrounds, and heavy blurry box-shadows. Use intentional CSS variables (--bg-canvas, --bg-surface, --bg-elevated, --text-primary, --text-secondary, --accent-primary, --border-subtle) with 1px structural borders and tonal separation.
   - Layout Anti-Patterns: BAN repetitive 3-column equal-height card grids for hero sections. Use asymmetric splits (e.g. 1.25fr 0.75fr), editorial proportions, clear focal hierarchy, and disciplined 4px/8px spatial rhythm.
3. Motion & Craft: Use staggered transform/opacity entrance animations (with prefers-reduced-motion support), semantic HTML landmarks (<header>, <nav>, <main>, <button>), WCAG AA contrast (>=4.5:1 body), and interactive view/tab/filter state hooks so the preview feels alive.`;

function hasBannedFontName(fontName) {
  const lower = String(fontName || '').trim().toLowerCase();
  if (!lower) return false;
  return BANNED_FONTS.some(b => new RegExp(`\\b${b}\\b`, 'i').test(lower));
}

/**
 * Validate a structured ui-design-spec object before code generation (Gate 1).
 */
export function validateDesignSpec(spec, { allowRepoFonts = false } = {}) {
  const errors = [];
  const warnings = [];
  const s = spec && typeof spec === 'object' ? spec : {};
  const preset = AESTHETIC_PRESETS[s.preset] || AESTHETIC_PRESETS.auto;

  const archetype = String(s.archetype || preset.archetype).trim();
  const mood = String(s.mood || preset.mood).trim();
  const displayFont = String(s.typography?.display || preset.displayFont).trim();
  const bodyFont = String(s.typography?.body || preset.bodyFont).trim();
  const monoFont = String(s.typography?.mono || preset.monoFont).trim();

  if (!s.archetype || String(s.archetype).trim().length < 3) {
    errors.push('Missing aesthetic archetype commitment.');
  }
  if (!allowRepoFonts) {
    if (hasBannedFontName(displayFont)) errors.push(`Display font "${displayFont}" violates anti-slop ban (Inter/Roboto/Arial).`);
    if (hasBannedFontName(bodyFont)) errors.push(`Body font "${bodyFont}" violates anti-slop ban (Inter/Roboto/Arial).`);
  }
  if (displayFont.toLowerCase() === bodyFont.toLowerCase()) {
    warnings.push('Display and body font are identical; pairing distinct voices strengthens hierarchy.');
  }

  const rawTokens = s.tokens && typeof s.tokens === 'object' ? s.tokens : {};
  const normalizedTokens = { ...preset.tokens, ...rawTokens };
  for (const key of REQUIRED_TOKEN_KEYS) {
    if (!rawTokens[key]) {
      errors.push(`Missing required CSS token ${key} in spec.`);
    }
  }

  const bans = Array.isArray(s.bans) && s.bans.length
    ? s.bans.map(b => String(b).trim()).filter(Boolean)
    : ['No Inter/Roboto/Arial defaults', 'No purple-blue SaaS gradients', 'No uniform 3-card hero grids'];

  const normalized = {
    preset: preset.id,
    archetype,
    mood,
    typography: {
      display: displayFont,
      body: bodyFont,
      mono: monoFont,
    },
    tokens: normalizedTokens,
    layout: {
      grid: String(s.layout?.grid || '12-column asymmetric split with sticky navigation rail').trim(),
      signatureDetail: String(s.layout?.signatureDetail || 'Staggered 60ms entrance reveal + 1px structural hairline rules').trim(),
      responsiveStrategy: String(s.layout?.responsiveStrategy || 'Desktop 1440px multi-region cockpit collapsing cleanly to single-column 390px mobile drawer & bottom bar').trim(),
    },
    states: Array.isArray(s.states) && s.states.length
      ? s.states.map(st => String(st).trim()).filter(Boolean)
      : ['default', 'interactive-tabs', 'empty', 'loading-skeleton'],
    bans,
  };

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    normalized,
  };
}

/**
 * Render a DESIGN.md contract matching the UI Design Mode specification.
 */
export function renderDesignMarkdown(specInput, title = 'Project Visual Contract') {
  const { normalized: spec } = validateDesignSpec(specInput, { allowRepoFonts: true });
  const tokenLines = Object.entries(spec.tokens)
    .map(([k, v]) => `- \`${k}\`: ${v}`)
    .join('\n');
  const statesLine = spec.states.join(', ');
  const bansLines = spec.bans.map(b => `- ${b}`).join('\n');

  return `# DESIGN.md — ${title}

## 1. Aesthetic Direction
- **Archetype:** ${spec.archetype}
- **Mood & Surface Philosophy:** ${spec.mood}

## 2. Typography
- **Display Font:** ${spec.typography.display} (Weights: 600, 700; tight tracking -0.03em)
- **Body Font:** ${spec.typography.body} (Weights: 400, 500; relaxed line-height 1.55)
- **Mono Font:** ${spec.typography.mono} (Tabular numerals enabled for metrics and timestamps)

## 3. Color Tokens (CSS Variables)
${tokenLines}

## 4. Layout, States & Negative Constraints
- **Grid System:** ${spec.layout.grid}
- **Signature Detail:** ${spec.layout.signatureDetail}
- **Responsive Strategy:** ${spec.layout.responsiveStrategy}
- **Required UI States:** ${statesLine}
${bansLines}
`;
}

export function buildPhase1SpecPrompt({ prompt, platform = 'responsive', preset = 'auto', repoScan = null, existingSpec = null } = {}) {
  const presetObj = AESTHETIC_PRESETS[preset] || AESTHETIC_PRESETS.auto;
  const repoContext = repoScan
    ? `DISCOVERED REPOSITORY DESIGN SYSTEM:\n${repoScan.summaryText}\nRespect existing brand tokens/components where compatible.`
    : 'GREENFIELD PROJECT: No existing DESIGN.md found. Establish a fresh high-craft contract.';
  const prior = existingSpec ? `\nPRIOR PROJECT SPEC (evolve or preserve consistency):\n${JSON.stringify(existingSpec, null, 2)}` : '';

  return `${DESIGN_SKILL_RULES}

ROLE: Phase 1 Architect / Art Director.
Commit to a specific visual specification BEFORE any HTML/JSX code is generated.
Target Platform: ${platform}. Preferred Preset: ${presetObj.label} (${presetObj.archetype}).
${repoContext}${prior}

User Request:
${prompt}

Reply ONLY with valid JSON matching this schema (no markdown outside JSON):
{
  "title": "Concise 2-4 word project/screen title",
  "archetype": "Specific aesthetic direction",
  "mood": "1-2 sentence lighting, material, and surface philosophy",
  "preset": "${presetObj.id}",
  "typography": {
    "display": "Intentional Google Font display family",
    "body": "Intentional Google Font body family",
    "mono": "Intentional Google Font mono family"
  },
  "tokens": {
    "--bg-canvas": "#hex",
    "--bg-surface": "#hex",
    "--bg-elevated": "#hex",
    "--text-primary": "#hex",
    "--text-secondary": "#hex",
    "--accent-primary": "#hex",
    "--border-subtle": "#hex"
  },
  "layout": {
    "grid": "Specific asymmetric/editorial grid architecture",
    "signatureDetail": "One distinctive visual signature carried throughout",
    "responsiveStrategy": "How 1440px desktop adapts cleanly to 390px mobile without overflow"
  },
  "screens": [
    { "title": "Screen name", "viewport": "desktop" }
  ],
  "states": ["default", "loading", "empty", "interactive-filter"],
  "bans": ["No Inter/Roboto/Arial defaults", "No purple-blue SaaS gradients", "No uniform 3-card hero grids"]
}`;
}

export function buildPhase2GeneratePrompt({
  prompt,
  platform = 'responsive',
  spec,
  designMd = '',
  repoScan = null,
  existingScreens = [],
  critiqueFeedback = null,
  enforceTokenLock = true,
} = {}) {
  const viewportSpec = platform === 'desktop'
    ? 'Generate 1 high-craft Desktop screen (`viewport: "desktop"`, designed for 1440x900).'
    : platform === 'mobile'
      ? 'Generate 1 high-craft Mobile screen (`viewport: "mobile"`, designed for 390x844).'
      : 'Generate 2 cohesive screens sharing the exact same brand/data: 1 Desktop (`viewport: "desktop"`, 1440x900) and 1 Mobile (`viewport: "mobile"`, 390x844).';

  const priorCode = existingScreens.length
    ? `\nEXISTING SCREEN TO REFINE OR MAINTAIN CONSISTENCY WITH:\nTitle: ${existingScreens[0].title} (${existingScreens[0].viewport})\nHTML snippet (first 3500 chars):\n${String(existingScreens[0].html || '').slice(0, 3500)}`
    : '';

  const critiqueBlock = critiqueFeedback?.criticalIssues?.length
    ? `\nEVALUATOR CRITIQUE TO FIX IN THIS ITERATION (Score ${critiqueFeedback.weightedTotal}/10 — MUST RESOLVE ALL ISSUES):\n- ${critiqueFeedback.criticalIssues.join('\n- ')}`
    : '';

  const repoNote = repoScan
    ? `\nEXISTING REPO CONTEXT:\nStack: ${repoScan.stack.join(', ') || 'vanilla'} | Components: ${repoScan.components.slice(0, 12).join(', ') || 'none'}`
    : '';

  return `${DESIGN_SKILL_RULES}

ROLE: Phase 2 Principal UI Implementation Engineer.
Build complete, interactive, production-grade standalone HTML5/CSS/JS screens locked strictly to the DESIGN.md contract below.
${enforceTokenLock ? 'TOKEN LOCK ENFORCED: Define CSS variables in `:root { ... }` matching the exact spec tokens, and use `var(--token)` everywhere outside `:root` (zero raw hardcoded hex codes in component rules!).' : ''}
Include Google Fonts \`<link>\` tags for \`${spec?.typography?.display}\`, \`${spec?.typography?.body}\`, and \`${spec?.typography?.mono}\`, interactive vanilla JS tabs/filters/modals (including a working state toggle for Default / Loading / Empty or view switch), semantic landmarks, zero external image dependencies that 404 (use crisp inline SVGs / CSS charts / procedural SVG illustrations), and zero horizontal overflow on both 1440px and 390px viewports.

LOCKED DESIGN.md:
${designMd || renderDesignMarkdown(spec)}
${repoNote}${priorCode}${critiqueBlock}

${viewportSpec}

User Request:
${prompt}

Reply ONLY with valid JSON matching this schema:
{
  "summary": "2-sentence architectural summary of layout, hierarchy, and craft choices",
  "screens": [
    {
      "title": "Concise Screen Title",
      "viewport": "desktop" | "mobile",
      "html": "<!doctype html><html lang=\\"en\\">...complete self-contained interactive document...</html>",
      "reactCode": "// Clean equivalent React + CSS-variable TSX component snippet",
      "notes": "Key interaction and responsive notes"
    }
  ]
}`;
}

export function buildPhase4EvaluatorPrompt({ prompt, spec, designMd, staticGate, captureReport } = {}) {
  const staticSummary = staticGate
    ? `STATIC GATE METRICS: rawHexOutsideRoot=${staticGate.metrics?.rawHexOutsideRoot ?? 0}, textContrast=${staticGate.metrics?.textContrast ?? 'n/a'}, bannedFonts=${(staticGate.metrics?.bannedFontsFound || []).join(',') || 'none'}, errors=[${(staticGate.errors || []).join('; ')}], warnings=[${(staticGate.warnings || []).join('; ')}]`
    : '';
  const captureSummary = captureReport?.captures?.length
    ? captureReport.captures.map(c => `- ${c.name} (${c.width}x${c.height}): overflowX=${c.overflowX}, interactiveControls=${c.interactiveCount}, consoleErrors=${c.consoleErrors?.length || 0}`).join('\n')
    : '- Headless browser capture skipped or unavailable; rely closely on HTML/CSS craft inspection.';

  return `You are an uncompromising Principal Product Designer reviewing a rendered UI implementation.
You did NOT write this code. Your job is to evaluate visual excellence, originality, and craft objectively.

Evaluate against:
1. The user's original intent: "${prompt}"
2. The locked DESIGN.md contract:
${designMd || renderDesignMarkdown(spec)}

${staticSummary}
VIEWPORT CAPTURE TELEMETRY:
${captureSummary}

Penalize heavily for:
- Generic "AI template" aesthetics (default card grids, uninspired typography, Inter/Roboto fallback, purple-blue gradient slop).
- Weak visual hierarchy where everything competes for attention.
- Alignment drift, cramped padding, low text contrast, console errors, or mobile overflow.

Reply ONLY with valid JSON matching this exact schema:
{
  "scores": {
    "designQuality": 8.5,
    "originality": 8.5,
    "craft": 8.5,
    "functionality": 8.5
  },
  "strengths": ["1-2 specific visual/structural strengths"],
  "criticalIssues": ["Specific, spatial, actionable fix if any score < 8 or craft defect exists (empty array [] if passing)"]
}`;
}
