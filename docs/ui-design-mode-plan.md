# System Architecture & Implementation Plan: Agentic Frontend UI Design Mode

## 1. Executive Summary & Architectural Goals

Standard LLM coding loops produce generic, convergent UI ("AI slop": Inter font, purple/blue gradients, uniform 3-card grids, uninspired spacing) because models optimize for statistical likelihood rather than intentional visual direction, and because models poorly self-critique their own rendered output.

This document defines the architecture for a specialized **Frontend UI Design Mode** inside an agentic coding harness. Instead of relying solely on prompt engineering, the mode enforces **structural separation of concerns**, **progressive context/skill injection**, **design-token locking**, and **adversarial vision-based verification**.

### Core Objectives
1. **Eliminate Distributional Defaults:** Force explicit aesthetic commitment and enforce negative constraints before code generation begins.
2. **Prevent Context Pollution:** Isolate art direction, UI planning, code generation, and visual critique across distinct phases or subagents.
3. **Ground Styling in Real Artifacts:** Ingest existing design systems (`DESIGN.md`, CSS tokens, component registries) or generate a strict token contract prior to building components.
4. **Close the Visual Feedback Loop:** Verify rendered output via headless browser automation (Playwright) across viewports using a decoupled vision evaluator scored on taste, originality, and craft.

---

## 2. High-Level System Architecture

The UI Design Mode operates as a **4-Stage State Machine** orchestrated by the harness controller:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        AGENTIC HARNESS CONTROLLER                           │
│                     (Mode Router: UI_DESIGN_MODE active)                    │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 1: CONTEXT INGESTION & SPEC PRE-FLIGHT (Architect / Art Director)     │
│  • Detect existing DESIGN.md, Tailwind config, CSS variables, or Storybook  │
│  • Inject Progressive UI Skill (~400-token Aesthetic & Anti-Slop Rules)     │
│  • Output artifact: `ui-design-spec.json` / `DESIGN.md` (Palette, Type,     │
│    Grid, Motion, Component Hierarchy, Negative Constraints)                 │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ (Gate 1: Spec Schema Validation)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 2: STRUCTURAL & VISUAL IMPLEMENTATION (Generator Agent)               │
│  • Locked to `DESIGN.md` tokens & approved component primitives             │
│  • Enforces CSS variable usage (no hardcoded hex/arbitrary magic numbers)   │
│  • Implements choreographed motion & responsive layout rules                │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ (Gate 2: Typecheck, Lint, Build)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 3: RENDER & HEADLESS BROWSER CAPTURE (Execution Sandbox)              │
│  • Start dev/preview server in isolated environment                         │
│  • Playwright MCP captures Desktop (1440x900) & Mobile (390x844) views      │
│  • Captures interactive states (hover, modal open, empty/loading states)    │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 4: ADVERSARIAL VISUAL CRITIQUE (Evaluator Subagent - Vision)          │
│  • Isolated context (no generator chain-of-thought bias)                    │
│  • Scores screenshots on Design Quality, Originality, Craft, Functionality  │
│  • PASS (>= Threshold) -> Complete | FAIL -> Structured Patch Feedback Loop │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Core Subsystems & Reference Patterns

### 3.1 Progressive Skill Injection & Anti-Convergence Engine
*Inspired by Claude Code `frontend-design` (`SKILL.md`) & Distilled Aesthetics Prompts.*

Rather than bloating the harness's global system prompt, activating `UI_DESIGN_MODE` dynamically injects a compact, high-leverage **Aesthetic Ruleset** into the system context:
* **Mandatory Aesthetic Direction:** Before writing markup, the agent must commit to a cohesive visual identity tailored to the domain (e.g., *Editorial Print*, *Tactile Industrial Hardware*, *Swiss Grid Brutalism*, *High-Craft Financial Terminal*).
* **Explicit Negative Constraints (Banned Defaults):**
  * **Typography:** Ban `Inter`, `Roboto`, `Arial`, and system-default sans stacks unless explicitly requested by an existing brand spec. Require intentional display + body + monospace font pairings.
  * **Color & Surfaces:** Ban generic SaaS purple-to-blue gradients, unlayered flat `#FFFFFF`/`#F9FAFB` backgrounds, and default Tailwind gray scales without warm/cool tinting.
  * **Layout Anti-Patterns:** Ban repetitive 3-column equal-height card grids for hero features; encourage asymmetric grids, editorial proportions, and varied visual rhythm.
* **Choreographed Motion:** Require purposeful page-load reveals (staggered `animation-delay`), tactile micro-interactions, and smooth state transitions rather than static mounts.

### 3.2 Design-System & Token Ingestion Adapter
*Inspired by Vercel v0 Design Systems & Bolt.new Design System Agents.*

When operating inside an existing repository, the harness runs a **Pre-Flight Token Extractor** before planning:
1. **Artifact Discovery:** Scans for `DESIGN.md`, `tailwind.config.*`, `globals.css` / CSS custom properties, `theme.ts`, or component directories (`src/components/ui/*`).
2. **Context Compilation:** Compiles discovered tokens (colors, spacing scale, border radii, typography classes) and available UI primitives into a structured context block.
3. **Token Lock Enforcement:** Configures AST/linter rules or post-generation checks to flag raw hex codes or unapproved utility classes when design tokens exist.
4. **Greenfield Fallback:** If no design system exists, Phase 1 generates a `DESIGN.md` contract first and commits it to the workspace so all subsequent turns remain visually consistent.

### 3.3 Spec-Driven Pre-Flight Planning
*Inspired by Google AI Studio / Stitch multi-phase UI workflows.*

Separates **UI Architecture** from **UI Implementation** to prevent the model from making layout decisions mid-JSX generation:
* **Deliverable (`ui-plan.md` or `ui-spec.json`):**
  * **Aesthetic Thesis:** Mood, lighting/surface philosophy, typography pairing, and color roles (surface, elevated surface, primary ink, muted ink, accent).
  * **View & Component Tree:** Exact breakdown of screens, layout regions, and reusable components.
  * **State Matrix:** Explicit handling for `default`, `loading` (skeletons), `empty`, `error`, and `dense data` states.
  * **Responsive Strategy:** How navigation, grids, and typography adapt between mobile (`<768px`) and desktop (`>=1280px`).

### 3.4 Generator–Evaluator Adversarial Critique Loop
*Inspired by Anthropic’s Frontend Harness & Playwright MCP verification pipelines.*

Because LLMs exhibit strong confirmation bias toward code they just wrote, visual evaluation is executed by a **separate subagent instance** with a fresh context window containing only the user's goal, the `DESIGN.md` contract, and rendered screenshots.

#### Evaluation Rubric (Weighted Scoring)
| Criterion | Weight | What the Vision Evaluator Inspects |
| :--- | :--- | :--- |
| **Design Quality** | 35% | Cohesive visual mood, clear typographic hierarchy, intentional use of whitespace, and surface depth. |
| **Originality** | 30% | Avoidance of generic AI templates; bespoke layout composition, memorable visual hooks, and domain fit. |
| **Craft & Polish** | 20% | Alignment precision, WCAG contrast compliance, consistent padding/radii, and responsive integrity across viewports. |
| **Functionality** | 15% | Interactive elements visible and reachable, zero console/runtime errors, complete state coverage. |

#### Loop Control & Termination
* **Threshold:** Default pass score `>= 8.0 / 10` with zero critical craft/functionality defects.
* **Structured Feedback:** On failure, the Evaluator outputs actionable, localized critique (e.g., *"Hero section uses a generic 3-card grid; refactor into an asymmetric split layout with high-contrast display typography"* or *"Mobile viewport at 390px overflows horizontally on the pricing table"*).
* **Retry Budget:** Max `3` critique-and-refine iterations per task to bound latency and token cost, escalating to the user with the best candidate if convergence isn't reached.

---

## 4. Harness Tooling & Execution Interface

To support this mode, the harness exposes the following tools and middleware hooks:

```typescript
interface UIDesignModeConfig {
  mode: "ui_design";
  aestheticProfilePath?: string; // e.g., "./DESIGN.md"
  enforceTokenLock: boolean;
  viewports: Array<{ name: string; width: number; height: number }>;
  critiqueLoop: {
    enabled: boolean;
    maxIterations: number;
    passingScore: number;
    evaluatorModel: string; // Vision-capable model
  };
}
```

### Required Harness Capabilities
1. **Sandbox Lifecycle Manager:** Starts the local dev server (`npm run dev` / `vite`), polls health endpoints until ready, and tears down cleanly after capture.
2. **Playwright / Browser Bridge:**
   * `browser_navigate(url)`
   * `browser_set_viewport(width, height)`
   * `browser_capture_screenshot(fullPage, selector?)`
   * `browser_interact(action, selector)` (clicks tabs, opens modals, toggles themes)
   * `browser_get_console_errors()`
3. **Static Verification Gate (Pre-Screenshot):**
   * Runs `tsc --noEmit`, framework linter, and CSS/Tailwind build check before launching Playwright so broken builds never waste vision tokens.

---

## 5. Prompt & Artifact Templates

### 5.1 Pre-Flight `DESIGN.md` Template (Generated in Phase 1)
```markdown
# DESIGN.md — Project Visual Contract

## 1. Aesthetic Direction
- **Archetype:** [e.g., Swiss Editorial / Tactile Dark Instrument / Warm Architectural]
- **Mood & Surface Philosophy:** [e.g., Matte warm paper (#F7F5F0) with crisp 1px ink borders (#18181B), zero drop shadows]

## 2. Typography
- **Display Font:** [Font Name] (Weights: 600, 700; tight tracking -0.03em)
- **Body Font:** [Font Name] (Weights: 400, 500; relaxed line-height 1.6)
- **Mono Font:** [Font Name] (Tabular numerals enabled for metrics)

## 3. Color Tokens (CSS Variables)
- `--bg-canvas`: #...
- `--bg-surface`: #...
- `--text-primary`: #...
- `--text-secondary`: #...
- `--accent-primary`: #...
- `--border-subtle`: #...

## 4. Layout & Motion Rules
- **Grid System:** [e.g., 12-column asymmetric container, max-width 1360px]
- **Signature Detail:** [e.g., Staggered 60ms entrance reveal + custom hairline dividers]
- **Explicit Bans:** No Inter/Roboto, no purple gradients, no generic 3-card feature rows.
```

### 5.2 Evaluator System Prompt (Phase 4)
```text
You are an uncompromising Principal Product Designer reviewing live screenshots of a web application.
You did NOT write this code. Your job is to evaluate visual excellence, originality, and craft.

Review the attached desktop and mobile screenshots against:
1. The user's original intent.
2. The project's DESIGN.md contract.

Penalize heavily for:
- Generic "AI template" aesthetics (default Tailwind cards, repetitive 3-column grids, uninspired typography, cliché gradients).
- Weak visual hierarchy where everything competes for attention.
- Alignment drift, cramped padding, low text contrast, or mobile overflow.

Output a JSON evaluation with:
- scores: { designQuality: 1-10, originality: 1-10, craft: 1-10, functionality: 1-10 }
- weightedTotal: number
- passed: boolean
- criticalIssues: string[] (specific, spatial, actionable fixes)
```

---

## 6. Phased Implementation Roadmap

### Milestone 1: Skill Injection & Spec-First Planning (MVP)
* Add `ui_design` mode router to the harness.
* Implement progressive prompt injection with aesthetic commitment + negative constraints.
* Require generation of `DESIGN.md` before any component files are created or modified.

### Milestone 2: Design System & Repo Ingestion
* Build the repository scanner to extract existing Tailwind configs, CSS variables, and UI component libraries into `DESIGN.md` automatically.
* Add static validation checks (TypeScript, build, token usage checks).

### Milestone 3: Playwright Render & Vision Critique Loop
* Integrate headless Playwright capture across desktop (`1440x900`) and mobile (`390x844`) viewports, plus console error collection.
* Implement the isolated Evaluator subagent loop with weighted rubric scoring and a 3-iteration refinement cap.

### Milestone 4: Interactive & Multi-State Verification
* Extend Playwright scripts to capture interactive states (hover, active modals, form validation, empty/loading states) and dark/light theme toggles.
* Add diff-based visual regression checks when iterating on existing UIs.
