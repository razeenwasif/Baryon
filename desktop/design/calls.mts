// Argument-validated IPC surface for Baryon UI Design Mode.
import { realpathSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  critiqueSingleScreen,
  runDesignGeneration,
  type CritiqueSingleScreenResult,
  type DesignAskAIFn,
  type DesignCapturePreviewFn,
  type DesignPipelineEvent,
  type RunDesignGenerationResult,
} from './orchestrator.mjs';
import { scanRepoDesignSystem, type DesignScanResult } from './scanner.mjs';
import { AESTHETIC_PRESETS, type AestheticPreset, type PresetId, type RepoScanSummary } from './skill.mjs';
import {
  checkDesignId,
  slugifyDesignName,
  type DesignProject,
  type DesignProjectSummary,
  type DesignStore,
} from './store.mjs';

export const DESIGN_CALL_NAMES = Object.freeze([
  'state',
  'listProjects',
  'getProject',
  'createProject',
  'deleteProject',
  'scanRepo',
  'updateDesignMd',
  'updateTokens',
  'generate',
  'refineScreen',
  'critiqueScreen',
  'duplicateScreen',
  'deleteScreen',
  'moveScreen',
  'exportToRepo',
  'publishPage',
] as const);

export interface DesignProviderInfo {
  id: string;
  label: string;
  connected: boolean;
}

export interface DesignProvidersResult {
  active: string;
  providers: DesignProviderInfo[];
  [key: string]: unknown;
}

export interface DesignPresetSummary {
  id: PresetId;
  label: string;
  archetype: string;
}

export type DesignCallEvent =
  | DesignPipelineEvent
  | {
      type: 'projects-changed';
      projectId?: string;
    };

export interface PublishArtifactInput {
  title: string;
  description: string;
  html: string;
}

export type PublishArtifactFn = (input: PublishArtifactInput) => Promise<unknown>;

export interface DesignCallsOptions {
  store?: DesignStore;
  askAI?: DesignAskAIFn | null;
  getProviders?: (() => DesignProvidersResult | null | undefined) | null;
  capturePreview?: DesignCapturePreviewFn | null;
  getWorkFolder?: (() => string) | null;
  publishArtifact?: PublishArtifactFn | null;
  home?: string;
  onEvent?: (event: DesignCallEvent) => void;
}

export interface CreateDesignProjectPayload {
  name?: unknown;
  preset?: unknown;
  folder?: unknown;
}

export interface ScanRepoPayload {
  projectId?: unknown;
  folder?: unknown;
}

export interface UpdateDesignMdPayload {
  projectId?: unknown;
  designMd?: unknown;
}

export interface UpdateTokensPayload {
  projectId?: unknown;
  tokens?: Record<string, unknown>;
}

export interface GenerateDesignPayload {
  projectId?: unknown;
  prompt?: unknown;
  platform?: unknown;
  preset?: unknown;
  provider?: unknown;
  enforceTokenLock?: boolean;
  critiqueEnabled?: boolean;
  maxIterations?: number;
  passingScore?: number;
}

export interface RefineScreenPayload extends GenerateDesignPayload {
  screenId?: unknown;
}

export interface CritiqueScreenPayload {
  projectId?: unknown;
  screenId?: unknown;
  provider?: unknown;
  passingScore?: number;
}

export interface ScreenRefPayload {
  projectId?: unknown;
  screenId?: unknown;
}

export interface MoveScreenPayload extends ScreenRefPayload {
  x?: unknown;
  y?: unknown;
}

export interface ExportToRepoPayload {
  projectId?: unknown;
  folder?: unknown;
  subdir?: unknown;
  screenId?: unknown;
}

export interface DesignStateResult {
  projects: DesignProjectSummary[];
  activeProject: DesignProject | null;
  providers: DesignProvidersResult;
  presets: DesignPresetSummary[];
  workFolder: string;
}

export interface ExportToRepoResult {
  ok: true;
  root: string;
  files: string[];
}

export interface DesignCallsApi {
  state(): Promise<DesignStateResult>;
  listProjects(): Promise<DesignProjectSummary[]>;
  getProject(projectId: unknown): Promise<DesignProject>;
  createProject(payload?: CreateDesignProjectPayload): Promise<DesignProject>;
  deleteProject(projectId: unknown): Promise<{ deleted: string }>;
  scanRepo(payload?: ScanRepoPayload): Promise<{ project: DesignProject; scan: DesignScanResult }>;
  updateDesignMd(payload?: UpdateDesignMdPayload): Promise<DesignProject>;
  updateTokens(payload?: UpdateTokensPayload): Promise<DesignProject>;
  generate(payload?: GenerateDesignPayload): Promise<RunDesignGenerationResult>;
  refineScreen(payload?: RefineScreenPayload): Promise<RunDesignGenerationResult>;
  critiqueScreen(payload?: CritiqueScreenPayload): Promise<CritiqueSingleScreenResult>;
  duplicateScreen(payload?: ScreenRefPayload): Promise<DesignProject>;
  deleteScreen(payload?: ScreenRefPayload): Promise<DesignProject>;
  moveScreen(payload?: MoveScreenPayload): Promise<DesignProject>;
  exportToRepo(payload?: ExportToRepoPayload): Promise<ExportToRepoResult>;
  publishPage(payload?: ScreenRefPayload): Promise<unknown>;
}

const VALID_PROVIDERS = new Set(['auto', 'claude', 'antigravity', 'codex']);
const VALID_PLATFORMS = new Set(['responsive', 'desktop', 'mobile']);

function checkSubdir(subdir: unknown): string {
  const raw = String(subdir || 'baryon-design').trim();
  if (!raw || raw.includes('\0') || raw.startsWith('/') || raw.split(/[\\/]+/).includes('..')) {
    throw new Error('Invalid export subfolder.');
  }
  return raw;
}

function resolvePresetId(value: unknown): PresetId {
  return typeof value === 'string' && (AESTHETIC_PRESETS as Record<string, AestheticPreset | undefined>)[value]
    ? (value as PresetId)
    : 'auto';
}

export function designCalls({
  store,
  askAI = null,
  getProviders = null,
  capturePreview = null,
  getWorkFolder = () => '',
  publishArtifact = null,
  home = homedir(),
  onEvent = () => {},
}: DesignCallsOptions = {}): DesignCallsApi {
  if (!store) throw new Error('designCalls requires store.');

  const resolveProviders = (): DesignProvidersResult => {
    const res = typeof getProviders === 'function' ? getProviders() : null;
    if (res && Array.isArray(res.providers)) return res;
    return {
      active: 'auto',
      providers: [{ id: 'auto', label: 'Auto (Active)', connected: Boolean(askAI) }],
    };
  };

  return {
    async state(): Promise<DesignStateResult> {
      const projects = await store.listProjects();
      const firstId = projects[0]?.id || 'aurelia-studio';
      const activeProject = (await store.getProject(firstId).catch(() => null)) || null;
      return {
        projects,
        activeProject,
        providers: resolveProviders(),
        presets: Object.values(AESTHETIC_PRESETS).map(p => ({ id: p.id, label: p.label, archetype: p.archetype })),
        workFolder: String(getWorkFolder?.() || ''),
      };
    },

    async listProjects(): Promise<DesignProjectSummary[]> {
      return store.listProjects();
    },

    async getProject(projectId: unknown): Promise<DesignProject> {
      const id = checkDesignId(projectId);
      const proj = await store.getProject(id);
      if (!proj) throw new Error('Design project not found.');
      return proj;
    },

    async createProject(payload: CreateDesignProjectPayload = {}): Promise<DesignProject> {
      const name = String(payload?.name || 'Untitled Design').trim().slice(0, 80);
      const preset = resolvePresetId(payload?.preset);
      const folder = String(payload?.folder || getWorkFolder?.() || '').trim();
      if (folder && (folder.includes('\0') || folder.split(/[\\/]+/).includes('..'))) {
        throw new Error('Invalid project folder.');
      }
      const proj = await store.createProject({ name, folder, preset });
      onEvent({ type: 'projects-changed', projectId: proj.id });
      return proj;
    },

    async deleteProject(projectId: unknown): Promise<{ deleted: string }> {
      const out = await store.deleteProject(checkDesignId(projectId));
      onEvent({ type: 'projects-changed' });
      return out;
    },

    async scanRepo(payload: ScanRepoPayload = {}): Promise<{ project: DesignProject; scan: DesignScanResult }> {
      const projectId = checkDesignId(payload?.projectId);
      const project = await store.getProject(projectId);
      if (!project) throw new Error('Design project not found.');
      const targetFolder = String(payload?.folder || project.folder || getWorkFolder?.() || '').trim();
      const scan = await scanRepoDesignSystem(targetFolder, { home });
      project.folder = scan.folder;
      project.repoScan = scan as unknown as RepoScanSummary;
      if (Object.keys(scan.tokens || {}).length) {
        project.spec = {
          ...(project.spec || {}),
          tokens: { ...(project.spec?.tokens || {}), ...scan.tokens },
        };
      }
      if (scan.hasDesignMd && scan.designMd.trim()) {
        project.designMd = scan.designMd;
      }
      const saved = await store.saveProject(project);
      onEvent({ type: 'project-changed', projectId: saved.id });
      return { project: saved, scan };
    },

    async updateDesignMd(payload: UpdateDesignMdPayload = {}): Promise<DesignProject> {
      const projectId = checkDesignId(payload?.projectId);
      const saved = await store.updateDesignMd(projectId, payload?.designMd);
      onEvent({ type: 'project-changed', projectId: saved.id });
      return saved;
    },

    async updateTokens(payload: UpdateTokensPayload = {}): Promise<DesignProject> {
      const projectId = checkDesignId(payload?.projectId);
      const saved = await store.applyTokens(projectId, payload?.tokens || {});
      onEvent({ type: 'project-changed', projectId: saved.id });
      return saved;
    },

    async generate(payload: GenerateDesignPayload = {}): Promise<RunDesignGenerationResult> {
      const projectId = checkDesignId(payload?.projectId);
      const platform = typeof payload?.platform === 'string' && VALID_PLATFORMS.has(payload.platform) ? payload.platform : 'responsive';
      const preset = resolvePresetId(payload?.preset);
      const provider = typeof payload?.provider === 'string' && VALID_PROVIDERS.has(payload.provider) ? payload.provider : 'auto';
      return runDesignGeneration({
        store,
        projectId,
        prompt: payload?.prompt,
        platform,
        preset,
        provider,
        enforceTokenLock: payload?.enforceTokenLock !== false,
        critiqueEnabled: payload?.critiqueEnabled !== false,
        maxIterations: payload?.maxIterations ?? 2,
        passingScore: payload?.passingScore ?? 8.0,
        askAI: askAI as DesignAskAIFn,
        capturePreview,
        onEvent,
      });
    },

    async refineScreen(payload: RefineScreenPayload = {}): Promise<RunDesignGenerationResult> {
      const projectId = checkDesignId(payload?.projectId);
      const screenId = checkDesignId(payload?.screenId);
      const preset = resolvePresetId(payload?.preset);
      const provider = typeof payload?.provider === 'string' && VALID_PROVIDERS.has(payload.provider) ? payload.provider : 'auto';
      return runDesignGeneration({
        store,
        projectId,
        prompt: payload?.prompt,
        platform: typeof payload?.platform === 'string' && VALID_PLATFORMS.has(payload.platform) ? payload.platform : 'responsive',
        preset,
        provider,
        enforceTokenLock: payload?.enforceTokenLock !== false,
        critiqueEnabled: payload?.critiqueEnabled !== false,
        maxIterations: payload?.maxIterations ?? 2,
        passingScore: payload?.passingScore ?? 8.0,
        targetScreenId: screenId,
        askAI: askAI as DesignAskAIFn,
        capturePreview,
        onEvent,
      });
    },

    async critiqueScreen(payload: CritiqueScreenPayload = {}): Promise<CritiqueSingleScreenResult> {
      const projectId = checkDesignId(payload?.projectId);
      const screenId = checkDesignId(payload?.screenId);
      const provider = typeof payload?.provider === 'string' && VALID_PROVIDERS.has(payload.provider) ? payload.provider : 'auto';
      return critiqueSingleScreen({
        store,
        projectId,
        screenId,
        provider,
        passingScore: payload?.passingScore ?? 8.0,
        askAI,
        capturePreview,
        onEvent,
      });
    },

    async duplicateScreen(payload: ScreenRefPayload = {}): Promise<DesignProject> {
      const saved = await store.duplicateScreen(checkDesignId(payload?.projectId), checkDesignId(payload?.screenId));
      onEvent({ type: 'project-changed', projectId: saved.id });
      return saved;
    },

    async deleteScreen(payload: ScreenRefPayload = {}): Promise<DesignProject> {
      const saved = await store.deleteScreen(checkDesignId(payload?.projectId), checkDesignId(payload?.screenId));
      onEvent({ type: 'project-changed', projectId: saved.id });
      return saved;
    },

    async moveScreen(payload: MoveScreenPayload = {}): Promise<DesignProject> {
      const saved = await store.updateScreenPosition(
        checkDesignId(payload?.projectId),
        checkDesignId(payload?.screenId),
        { x: payload?.x, y: payload?.y },
      );
      return saved;
    },

    async exportToRepo(payload: ExportToRepoPayload = {}): Promise<ExportToRepoResult> {
      const projectId = checkDesignId(payload?.projectId);
      const project = await store.getProject(projectId);
      if (!project) throw new Error('Design project not found.');
      const workRoot = String(payload?.folder || project.folder || getWorkFolder?.() || '').trim();
      if (!workRoot) throw new Error('Open a work session or link a repo folder first to export.');
      if (workRoot.includes('\0') || workRoot.split(/[\\/]+/).includes('..')) {
        throw new Error('Invalid repository path.');
      }
      const absHome = realpathSync(resolve(home || homedir()));
      const realRoot = realpathSync(resolve(workRoot));
      if (realRoot !== absHome && !realRoot.startsWith(`${absHome}/`)) {
        throw new Error('Repository export path must stay inside your home folder.');
      }

      const subdir = checkSubdir(payload?.subdir);
      const targetDir = resolve(realRoot, subdir);
      if (!targetDir.startsWith(`${realRoot}/`) && targetDir !== realRoot) {
        throw new Error('Export target escaped project folder.');
      }
      await mkdir(targetDir, { recursive: true });
      const written: string[] = [];
      if (project.designMd) {
        const mdPath = join(realRoot, 'DESIGN.md');
        await writeFile(mdPath, `${project.designMd}\n`, 'utf8');
        written.push('DESIGN.md');
      }
      const screensToExport = payload?.screenId
        ? (project.screens || []).filter(s => s.id === checkDesignId(payload.screenId))
        : (project.screens || []);
      for (const scr of screensToExport) {
        const slug = slugifyDesignName(`${scr.title}-${scr.viewport}`, 'screen');
        const htmlPath = join(targetDir, `${slug}.html`);
        await writeFile(htmlPath, String(scr.html || ''), 'utf8');
        written.push(`${subdir}/${slug}.html`);
        if (scr.reactCode) {
          const tsxPath = join(targetDir, `${slug}.tsx`);
          await writeFile(tsxPath, String(scr.reactCode), 'utf8');
          written.push(`${subdir}/${slug}.tsx`);
        }
      }
      return { ok: true, root: realRoot, files: written };
    },

    async publishPage(payload: ScreenRefPayload = {}): Promise<unknown> {
      if (typeof publishArtifact !== 'function') {
        throw new Error('Artifact publishing is not configured.');
      }
      const projectId = checkDesignId(payload?.projectId);
      const screenId = checkDesignId(payload?.screenId);
      const project = await store.getProject(projectId);
      if (!project) throw new Error('Design project not found.');
      const screen = (project.screens || []).find(s => s.id === screenId);
      if (!screen) throw new Error('Screen not found.');
      return publishArtifact({
        title: `${project.name} · ${screen.title}`,
        description: project.spec?.archetype || 'Baryon Design Mode screen',
        html: screen.html,
      });
    },
  };
}
