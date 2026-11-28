import './landing.css';
import { mountLandingAurora } from './landing-aurora.js';

interface ScreenshotItem {
  key: string;
  title: string;
  src: string;
  alt: string;
  caption: string;
}

interface IndexedScreenshot extends ScreenshotItem {
  index: number;
}

interface MacArm64Release {
  filename: string;
  url: string;
  sha256Url: string;
  sha256: string;
  sizeLabel: string;
  minMacOS: string;
}

interface ReleasesPayload {
  version?: string;
  macos?: {
    arm64?: MacArm64Release;
  };
}

const SCREENSHOTS: ScreenshotItem[] = [
  {
    key: 'home',
    title: 'Home',
    src: '/media/baryon-home.webp?v=2',
    alt: 'Baryon Home with the Fairy companion eye, Orchestrator routing, live Calendar and unread Gmail Today pills, and per-provider quota meters',
    caption: 'Baryon Home with the Fairy companion eye, Orchestrator routing, live Calendar & unread Gmail Today pills, and per-provider quota meters.',
  },
  {
    key: 'work',
    title: 'Work & Git',
    src: '/media/baryon-work.webp?v=2',
    alt: 'Baryon work session beside native Git branches, commit activity heatmap, and Neutrino pull requests',
    caption: 'Multi-repo agent work sessions beside a native Git & Neutrino panel with commit activity heatmap, branch graph, and pull requests.',
  },
  {
    key: 'research',
    title: 'Research',
    src: '/media/baryon-research.webp?v=2',
    alt: 'Baryon Research Workbench pairing multi-round synthesis and citations with a Python lab notebook',
    caption: 'Autonomous multi-round Research Workbench pairing literature synthesis and citations with a live sandboxed Python/SciPy lab notebook.',
  },
  {
    key: 'analytics',
    title: 'Analytics',
    src: '/media/baryon-analytics.webp?v=2',
    alt: 'Baryon Analytics column telemetry profiler, automatic leakage guard, and AutoML model zoo',
    caption: 'Local AutoML & column telemetry profiler with automatic leakage guard, LightGBM/XGBoost/CatBoost model zoo, and local CPU/MPS runs.',
  },
  {
    key: 'notebooks',
    title: 'Study',
    src: '/media/baryon-notebooks.webp?v=2',
    alt: 'Baryon Study Notebooks showing convex graph animation, 57 ticked sources, and 12 Studio tools',
    caption: 'Study Notebooks with 57+ ticked course sources, interactive math animations, cited tutoring, and 12 Studio tools from FSRS-6 cards to practice exams.',
  },
  {
    key: 'plugins',
    title: 'Plugins & MCP',
    src: '/media/baryon-plugins.webp?v=2',
    alt: 'Baryon Plugins gallery showing Google Workspace, AI subscriptions, Local Files, and MCP connectors',
    caption: 'Unified Google Workspace hub (Drive, Docs, Sheets, Slides, Calendar, Gmail), built-in Claude/Gemini/Codex subscriptions, and MCP connectors.',
  },
  {
    key: 'usage',
    title: 'Usage',
    src: '/media/baryon-usage.webp?v=2',
    alt: 'Baryon Usage telemetry showing daily cost curves, token totals, cache savings, and top sessions',
    caption: 'Real-time daily cost curves, cached vs. uncached token totals, cache savings, per-model spend bars, and top session breakdowns.',
  },
];

const BY_KEY: Record<string, IndexedScreenshot> = Object.fromEntries(
  SCREENSHOTS.map((s, i) => [s.key, { ...s, index: i }])
);

const auroraCanvasEl = document.getElementById('baryon-aurora');
const auroraCanvas = auroraCanvasEl instanceof HTMLCanvasElement ? auroraCanvasEl : null;
mountLandingAurora(auroraCanvas);

// Interactive Hero Screenshot Switcher
const shotImgEl = document.getElementById('bl-shot-img');
const shotImg = shotImgEl instanceof HTMLImageElement ? shotImgEl : null;
const shotCaption = document.getElementById('bl-shot-caption');
const tabs = Array.from(document.querySelectorAll<HTMLElement>('.bl-tab[data-shot]'));
let currentIdx = 0;

function selectShot(key: string | undefined): void {
  if (!key) return;
  const shot = BY_KEY[key];
  if (!shot || !shotImg || !shotCaption) return;
  currentIdx = shot.index;
  tabs.forEach(tab => {
    const active = tab.dataset.shot === key;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
    if (active) tab.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
  });
  shotImg.classList.add('is-swapping');
  shotImg.src = shot.src;
  shotImg.alt = shot.alt;
  shotCaption.textContent = shot.caption;
  requestAnimationFrame(() => shotImg.classList.remove('is-swapping'));
}

function stepShot(delta: number): void {
  const next = (currentIdx + delta + SCREENSHOTS.length) % SCREENSHOTS.length;
  selectShot(SCREENSHOTS[next].key);
}

tabs.forEach(tab => {
  tab.addEventListener('click', () => selectShot(tab.dataset.shot));
});

document.getElementById('bl-shot-prev')?.addEventListener('click', () => stepShot(-1));
document.getElementById('bl-shot-next')?.addEventListener('click', () => stepShot(1));

// Full-Size Lightbox Preview
const lightboxEl = document.getElementById('bl-lightbox');
const lightbox = lightboxEl instanceof HTMLDialogElement ? lightboxEl : null;
const lbImgEl = document.getElementById('bl-lb-img');
const lbImg = lbImgEl instanceof HTMLImageElement ? lbImgEl : null;
const lbTitle = document.getElementById('bl-lb-title');
const lbTag = document.getElementById('bl-lb-tag');
const lbCaption = document.getElementById('bl-lb-caption');
let lbIdx = 0;

function renderLightbox(idx: number): void {
  lbIdx = (idx + SCREENSHOTS.length) % SCREENSHOTS.length;
  const shot = SCREENSHOTS[lbIdx];
  if (!shot || !lbImg) return;
  lbImg.src = shot.src;
  lbImg.alt = shot.alt;
  if (lbTitle) lbTitle.textContent = shot.title;
  if (lbTag) lbTag.textContent = `${lbIdx + 1} / ${SCREENSHOTS.length}`;
  if (lbCaption) lbCaption.textContent = shot.caption;
}

function openLightbox(key: string | undefined): void {
  const shot = (key ? BY_KEY[key] : undefined) ?? { ...SCREENSHOTS[currentIdx], index: currentIdx };
  renderLightbox(shot.index);
  lightbox?.showModal?.();
}

document.getElementById('bl-shot-expand')?.addEventListener('click', () => openLightbox(SCREENSHOTS[currentIdx].key));
document.getElementById('bl-shot-trigger')?.addEventListener('click', () => openLightbox(SCREENSHOTS[currentIdx].key));
document.querySelectorAll<HTMLElement>('[data-lightbox]').forEach(btn => {
  btn.addEventListener('click', () => openLightbox(btn.dataset.lightbox));
});
document.getElementById('bl-lb-prev')?.addEventListener('click', () => renderLightbox(lbIdx - 1));
document.getElementById('bl-lb-next')?.addEventListener('click', () => renderLightbox(lbIdx + 1));
document.getElementById('bl-lb-close')?.addEventListener('click', () => lightbox?.close?.());
lightbox?.addEventListener('click', e => {
  if (e.target === lightbox) lightbox.close();
});
lightbox?.addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    renderLightbox(lbIdx - 1);
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    renderLightbox(lbIdx + 1);
  }
});

// Copy-to-clipboard buttons
document.querySelectorAll<HTMLElement>('.bl-copy-btn').forEach(btn => {
  const original = btn.textContent;
  btn.addEventListener('click', async () => {
    let text = btn.dataset.copyText || '';
    if (!text && btn.dataset.copyTarget === 'sha256') {
      text = document.getElementById('bl-sha256-val')?.textContent?.trim() || '';
    }
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = 'Copied';
      btn.classList.add('is-copied');
      setTimeout(() => {
        btn.textContent = original;
        btn.classList.remove('is-copied');
      }, 1600);
    } catch {
      btn.textContent = 'Select & Copy';
      setTimeout(() => { btn.textContent = original; }, 1600);
    }
  });
});

// Hydrate installer metadata dynamically from /releases.json
async function hydrateRelease(): Promise<void> {
  try {
    const res = await fetch('/releases.json', { cache: 'no-cache' });
    if (!res.ok) return;
    const data = (await res.json()) as ReleasesPayload;
    const mac = data?.macos?.arm64;
    if (!mac) return;

    const version = data.version || '0.1.0';
    document.querySelectorAll('[data-release="version"]').forEach(el => {
      el.textContent = el.closest('.bl-meta-strip') ? `v${version}` : version;
    });
    document.querySelectorAll('[data-release="version-pill"]').forEach(el => {
      el.textContent = `v${version}`;
    });
    document.querySelectorAll('[data-release="size"]').forEach(el => {
      el.textContent = el.closest('.bl-meta-strip') ? `${mac.sizeLabel} DMG` : mac.sizeLabel;
    });
    document.querySelectorAll('[data-release="eyebrow"]').forEach(el => {
      el.textContent = `MACOS · APPLE SILICON · v${version}`;
    });
    document.querySelectorAll('[data-release="filename"]').forEach(el => {
      el.textContent = mac.filename;
    });
    document.querySelectorAll('[data-release="sha256"]').forEach(el => {
      el.textContent = mac.sha256;
    });
    document.querySelectorAll('[data-release="req"]').forEach(el => {
      el.textContent = `macOS ${mac.minMacOS}+ (arm64)`;
    });
    document.querySelectorAll('[data-release="arch"]').forEach(el => {
      el.textContent = `Apple Silicon · macOS ${mac.minMacOS}+`;
    });
    document.querySelectorAll('[data-release="download-link"]').forEach(el => {
      el.setAttribute('href', mac.url);
      el.setAttribute('download', mac.filename);
    });
    document.querySelectorAll('[data-release="sha-link"]').forEach(el => {
      el.setAttribute('href', mac.sha256Url);
    });
  } catch {
    // Keep static HTML fallback values
  }
}

hydrateRelease();
