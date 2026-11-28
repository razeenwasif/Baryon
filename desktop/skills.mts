import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type SkillSource = 'yours' | 'project';

export interface Skill {
  name: string;
  source: SkillSource;
  description: string;
  text: string;
}

export interface SaveSkillInput {
  name?: string;
  description?: string;
  text: string;
}

const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/, MAX_TEXT = 32 * 1024, MAX_SKILLS = 200;

export function parseSkill(name: string, raw: string, source: SkillSource = 'yours'): Skill {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  const front = match?.[1] || '', body = (match ? match[2] : raw).trim();
  return { name, source, description: /^description:\s*(.+)$/m.exec(front)?.[1]?.trim().slice(0, 200) || '', text: body.slice(0, MAX_TEXT) };
}

async function readFolder(dir: string, source: SkillSource): Promise<Skill[]> {
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch (error: unknown) {
    const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : '';
    if (['ENOENT', 'ENOTDIR'].includes(code)) return [];
    throw error;
  }
  const skills: Skill[] = [];
  for (const file of names.sort().slice(0, MAX_SKILLS)) {
    const name = file.replace(/\.md$/, '');
    if (!file.endsWith('.md') || !NAME.test(name)) continue;
    try { skills.push(parseSkill(name, await readFile(join(dir, file), 'utf8'), source)); } catch {}
  }
  return skills;
}

// Reusable instructions, run only when you type their name. A project's own skills count as its text, so they're labelled.
export class SkillStore {
  dir: string;

  constructor({ dir }: { dir: string }) {
    this.dir = dir;
  }

  list(root?: string | null): Promise<Skill[]> {
    return Promise.all([readFolder(this.dir, 'yours'), root ? readFolder(join(root, '.fairy/skills'), 'project') : Promise.resolve([] as Skill[])]).then(
      ([mine, project]) => [...mine, ...project.filter(skill => !mine.some(own => own.name === skill.name))],
    );
  }

  async save({ name, description = '', text }: SaveSkillInput): Promise<void> {
    if (!NAME.test(name || '')) throw new Error('Name a skill with lowercase letters, numbers and dashes.');
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) throw new Error('A skill needs some instructions, under 32 KB.');
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await writeFile(join(this.dir, `${name}.md`), `---\ndescription: ${String(description).replace(/\s+/g, ' ').trim().slice(0, 200)}\n---\n${text.trim()}\n`, { mode: 0o600 });
  }

  async remove(name?: string): Promise<void> {
    if (!NAME.test(name || '')) throw new Error('That skill isn’t valid.');
    await rm(join(this.dir, `${name}.md`), { force: true });
  }

  // "/name what to do" becomes the skill's instructions and the request, for the model only.
  async expand(typed: string, root?: string | null): Promise<string> {
    const match = /^\/([a-z0-9][a-z0-9-]{0,39})(?:\s+([\s\S]*))?$/.exec(String(typed).trim());
    if (!match) return typed;
    const skill = (await this.list(root)).find(entry => entry.name === match[1]);
    if (!skill) return typed;
    const from = skill.source === 'project' ? ' It comes from this project.' : '';
    return `Follow this skill, "${skill.name}", which the user chose to run.${from}\n\n${skill.text}${match[2] ? `\n\nThe user's request: ${match[2].trim()}` : ''}`;
  }
}
