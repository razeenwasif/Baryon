# Baryon Web (`https://baryon.web.app`)

Standalone landing & installer portal (`/`) and PWA Web Studio (`/chat`) built in Stratus Obsidian style (`#050507` ground, `#0B0B0E` sidebar/cards, `#111114` raised surfaces, `#3E5AEC` cobalt accent, `#18B8CC` cyan highlight) and hosted on Firebase Hosting (`baryon` site in GCP project `stella-508707`).

## Routes

- **`/` (`web/index.html`) — Landing & macOS Installer Download**:
  - Bottom-confined WebGL horizon aurora shader (`web/src/landing-aurora.js`) with Canvas2D fallback and `prefers-reduced-motion` guard.
  - Interactive screenshot showcase (`/media/baryon-{home,notebooks,studio}.webp`).
  - Direct Apple Silicon `.dmg` download hosted on public GitHub Releases (`razeenwasif/baryon-releases`), SHA-256 verification hash & `.sha256` file, and 3-step first-launch Gatekeeper guide.
  - Release metadata sourced from `web/public/releases.json` (`Cache-Control: no-cache`).
- **`/chat` (`web/chat/index.html`) — Baryon Web Studio (PWA)**:
  - **`/fanout` Multi-Model Arena**: Compare up to 3 models in parallel on one prompt with synchronized streaming cards, latency (`ms`) and `tok/s` metrics, and **Use Winner & Continue**.
  - **Time-Travel DAG Branching (`web/src/store.js`)**: Fork any prompt (`Fork Branch ⑂`), step through sibling branches inline (`‹ 1/2 ›`), or switch timelines in the **Branches** drawer.
  - **Live Sandboxed Artifacts (`web/src/markdown.js`)**: Any `html` or `svg` fenced code block opens inside a sandboxed `iframe` (`sandbox="allow-scripts"`) in the **Artifact** drawer alongside Source toggle and `.html` export.
  - **Ephemeral `/side` Chat, Queue/Steer & Voice**: Side Chat drawer, queued/steered follow-ups (`⌥Enter`), Web Speech API dictation, `/` slash menu, and `⌘K` palette.
  - **Hybrid Engines (`web/src/providers.js`)**: Demo Studio (zero API keys), BYOK Direct SSE (Gemini, OpenAI, Claude, DeepSeek, custom), and Baryon Mac Host over HTTPS/Tailscale.

## Responsive Layout Matrix

- **Desktop (`> 1120px`)**: 3-column Stratus layout in Web Studio and 12-column Bento grid on Landing.
- **iPad Landscape (`901px–1120px`)**: Persistent sidebar, fluid chat stage, slide-over right inspector.
- **iPad Mini (`641px–900px`)**: Slide-over left drawer (`<= 300px`), `2`-column `/fanout` Arena, slide-over right inspector.
- **Phone (`<= 640px`)**: `100dvh` + `interactive-widget=resizes-content` + `env(safe-area-inset-*)`, `16px` form fields, `1`-column `/fanout` Arena, bottom-sheet Inspector drawer.

## Package DMG, Build, Test & Deploy

```zsh
# 1. Build signed macOS DMG installer (output: release/Baryon-<ver>-arm64.dmg + .sha256)
npm run package:dmg

# 2. Publish installer asset to razeenwasif/baryon-releases (v0.1.0)
gh release create v0.1.0 release/Baryon-0.1.0-arm64.dmg release/Baryon-0.1.0-arm64.dmg.sha256 --repo razeenwasif/baryon-releases

# 3. Build multi-page web bundle (output: web/dist)
npx vite build --config web/vite.config.js

# 4. Run Baryon Web & Landing Page checks
node --test test/baryon-web.test.mjs

# 5. Deploy to Firebase Hosting (https://baryon.web.app)
firebase deploy --only hosting --project stella-508707

# 6. Verify hosting site & open in Stratus
~/.local/bin/stratus firebase hosting sites -p stella-508707
~/.local/bin/stratus open firebase -p stella-508707
```

## Source Map

- `scripts/build-dmg.mjs` — Signed macOS UDZO `.dmg` packager & SHA-256 generator (`npm run package:dmg`)
- `web/index.html`, `web/src/landing.css`, `web/src/landing-aurora.js`, `web/src/landing.js` — Landing & macOS installer portal (`/`)
- `web/chat/index.html`, `web/public/manifest.webmanifest` — Web Studio PWA shell (`/chat`)
- `web/public/releases.json` & `web/public/media/*.webp` — Release manifest & optimized showcase screenshots
- `web/vite.config.js` — Multi-page Vite config (`/` and `/chat`) outputting to `web/dist`
- `web/src/styles.css`, `web/src/store.js`, `web/src/markdown.js`, `web/src/providers.js`, `web/src/app.js` — Web Studio client
- `firebase.json` & `.firebaserc` — Firebase Hosting config (`site: "baryon"`, `project: "stella-508707"`, `/chat` rewrite, `/downloads/*.dmg` headers)
