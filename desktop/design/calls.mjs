// Argument-validated IPC surface for Baryon UI Design Mode.
import { realpathSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { critiqueSingleScreen, runDesignGeneration } from './orchestrator.mjs';
import { scanRepoDesignSystem } from './scanner.mjs';
import { AESTHETIC_PRESETS } from './skill.mjs';
import { checkDesignId, slugifyDesignName } from './store.mjs';

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
]);

const VALID_PROVIDERS = new Set(['auto', 'claude', 'antigravity', 'codex']);
const VALID_PLATFORMS = new Set(['responsive', 'desktop', 'mobile']);

function checkSubdir(subdir) {
  const raw = String(subdir || 'baryon-design').trim();
  if (!raw || raw.includes('\0') || raw.startsWith('/') || raw.split(/[\\/]+/).includes('..')) {
    throw new Error('Invalid export subfolder.');
  }
  return raw;
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
} = {}) {
  if (!store) throw new Error('designCalls requires store.');

  const resolveProviders = () => {
    const res = typeof getProviders === 'function' ? getProviders() : null;
    if (res && Array.isArray(res.providers)) return res;
    return {
      active: 'auto',
      providers: [{ id: 'auto', label: 'Auto (Active)', connected: Boolean(askAI) }],
    };
  };

  return {
    async state() {
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

    async listProjects() {
      return store.listProjects();
    },

    async getProject(projectId) {
      const id = checkDesignId(projectId);
      const proj = await store.getProject(id);
      if (!proj) throw new Error('Design project not found.');
      return proj;
    },

    async createProject(payload = {}) {
      const name = String(payload?.name || 'Untitled Design').trim().slice(0, 80);
      const preset = AESTHETIC_PRESETS[payload?.preset] ? payload.preset : 'auto';
      const folder = String(payload?.folder || getWorkFolder?.() || '').trim();
      if (folder && (folder.includes('\0') || folder.split(/[\\/]+/).includes('..'))) {
        throw new Error('Invalid project folder.');
      }
      const proj = await store.createProject({ name, folder, preset });
      onEvent({ type: 'projects-changed', projectId: proj.id });
      return proj;
    },

    async deleteProject(projectId) {
      const out = await store.deleteProject(checkDesignId(projectId));
      onEvent({ type: 'projects-changed' });
      return out;
    },

    async scanRepo(payload = {}) {
      const projectId = checkDesignId(payload?.projectId);
      const project = await store.getProject(projectId);
      if (!project) throw new Error('Design project not found.');
      const targetFolder = String(payload?.folder || project.folder || getWorkFolder?.() || '').trim();
      const scan = await scanRepoDesignSystem(targetFolder, { home });
      project.folder = scan.folder;
      project.repoScan = scan;
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

    async updateDesignMd(payload = {}) {
      const projectId = checkDesignId(payload?.projectId);
      const saved = await store.updateDesignMd(projectId, payload?.designMd);
      onEvent({ type: 'project-changed', projectId: saved.id });
      return saved;
    },

    async updateTokens(payload = {}) {
      const projectId = checkDesignId(payload?.projectId);
      const saved = await store.applyTokens(projectId, payload?.tokens || {});
      onEvent({ type: 'project-changed', projectId: saved.id });
      return saved;
    },

    async generate(payload = {}) {
      const projectId = checkDesignId(payload?.projectId);
      const platform = VALID_PLATFORMS.has(payload?.platform) ? payload.platform : 'responsive';
      const preset = AESTHETIC_PRESETS[payload?.preset] ? payload.preset : 'auto';
      const provider = VALID_PROVIDERS.has(payload?.provider) ? payload.provider : 'auto';
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
        askAI,
        capturePreview,
        onEvent,
      });
    },

    async refineScreen(payload = {}) {
      const projectId = checkDesignId(payload?.projectId);
      const screenId = checkDesignId(payload?.screenId);
      const preset = AESTHETIC_PRESETS[payload?.preset] ? payload.preset : 'auto';
      const provider = VALID_PROVIDERS.has(payload?.provider) ? payload.provider : 'auto';
      return runDesignGeneration({
        store,
        projectId,
        prompt: payload?.prompt,
        platform: VALID_PLATFORMS.has(payload?.platform) ? payload.platform : 'responsive',
        preset,
        provider,
        enforceTokenLock: payload?.enforceTokenLock !== false,
        critiqueEnabled: payload?.critiqueEnabled !== false,
        maxIterations: payload?.maxIterations ?? 2,
        passingScore: payload?.passingScore ?? 8.0,
        targetScreenId: screenId,
        askAI,
        capturePreview,
        onEvent,
      });
    },

    async critiqueScreen(payload = {}) {
      const projectId = checkDesignId(payload?.projectId);
      const screenId = checkDesignId(payload?.screenId);
      const provider = VALID_PROVIDERS.has(payload?.provider) ? payload.provider : 'auto';
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

    async duplicateScreen(payload = {}) {
      const saved = await store.duplicateScreen(checkDesignId(payload?.projectId), checkDesignId(payload?.screenId));
      onEvent({ type: 'project-changed', projectId: saved.id });
      return saved;
    },

    async deleteScreen(payload = {}) {
      const saved = await store.deleteScreen(checkDesignId(payload?.projectId), checkDesignId(payload?.screenId));
      onEvent({ type: 'project-changed', projectId: saved.id });
      return saved;
    },

    async moveScreen(payload = {}) {
      const saved = await store.updateScreenPosition(
        checkDesignId(payload?.projectId),
        checkDesignId(payload?.screenId),
        { x: payload?.x, y: payload?.y },
      );
      return saved;
    },

    async exportToRepo(payload = {}) {
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
      const written = [];
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

    async publishPage(payload = {}) {
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
