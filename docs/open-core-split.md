# Baryon Open Core Architecture

Baryon uses an **Open Core** model maintained from this repository:

- **Baryon Open Core (`Apache-2.0`)**: The AI desktop companion, chat & per-session work agents, multi-provider routing (`Claude`, `Gemini`, `ChatGPT / Codex`, `DeepSeek`), Multi-Agent `/swarm`, Auto-by-Task Orchestrator, Goals, Watchers, Experiments (`Runs`), Miro-style `Boards`, Pages, Memory, Plugins/Connectors, Token Usage Analytics, Two-Mac `Face Link`, iOS companion, Remote Compute (`Nexus` / `Neutrino`), and `Vorssaint` Mac Utilities.
- **Baryon Pro (Proprietary / Excluded from Core)**:
  1. **Research Workbench & Paper Reproduction** (`desktop/research/`, `desktop/reproduce/`, `desktop/research-brief.mjs`, `native/research/`, `src/research-*`)
  2. **Analytics, AutoML & Record Linkage** (`desktop/analytics/`, `native/analytics/`, `src/analytics/`, `src/analytics-*`)
  3. **Baryon Academy & Study Notebooks** (`desktop/academy/`, `desktop/notebook/`, `desktop/phone-notebooks.mjs`, `native/notebook-engines/`, `native/Study.swift`, `src/academy/`, `src/academy-*`, `src/notebook*`)

---

## Edition Resolution (`desktop/edition.mjs`)

`resolveEdition({ env, rootDir })` determines the active edition in priority order:
1. `BARYON_EDITION=core|pro` environment variable
2. `baryonEdition` in `package.json` (`"core"` in exported public repos)
3. Automatic filesystem detection (presence of `desktop/research/service.mjs`, `desktop/analytics/calls.mjs`, etc.)

Even in `pro` mode, individual feature flags (`FEATURES.research`, `FEATURES.reproduce`, `FEATURES.analytics`, `FEATURES.academy`, `FEATURES.notebooks`) require both `edition === 'pro'` and the corresponding module on disk. Core desktop modules (`web-pdf.mjs`, `phone-pages.mjs`, `benchmark-watch.mjs`, `runs.mjs`, `goals.mjs`, `goal-check.mjs`, `work-tools.mjs`) load optional Pro extensions via `optionalImport()` with safe fallbacks so they run and pass standalone in an exported Core repository.

---

## Build, Package & Export Commands

```bash
# Build & package Pro (default)
npm run build
npm run package:baryon

# Build & package Open Core locally (writes to release-core/)
npm run build:core
npm run package:core

# Generate clean standalone Apache-2.0 public Core export locally
npm run export:core

# Generate and verify standalone Core export (file exclusions, Core ESM imports, Vite Core build)
npm run export:core:verify
```

The default export directory is `.local-data/baryon-core-export` so you can inspect the exact public Core tree locally before pushing to a public GitHub repository.
