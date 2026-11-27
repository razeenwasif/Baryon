import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/, MAX_TEXT = 32 * 1024, MAX_SKILLS = 200;
export function parseSkill(name, raw, source = 'yours') {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  const front = match?.[1] || '', body = (match ? match[2] : raw).trim();
  return { name, source, description: /^description:\s*(.+)$/m.exec(front)?.[1]?.trim().slice(0, 200) || '', text: body.slice(0, MAX_TEXT) };
}
async function readFolder(dir, source) {
  let names = [];
  try { names = await readdir(dir); } catch (error) { if (['ENOENT', 'ENOTDIR'].includes(error.code)) return []; throw error; }
  const skills = [];
  for (const file of names.sort().slice(0, MAX_SKILLS)) {
    const name = file.replace(/\.md$/, '');
    if (!file.endsWith('.md') || !NAME.test(name)) continue;
    try { skills.push(parseSkill(name, await readFile(join(dir, file), 'utf8'), source)); } catch {}
  }
  return skills;
}
// Reusable instructions, run only when you type their name. A project's own skills count as its text, so they're labelled.
export class SkillStore {
  constructor({ dir }) { this.dir = dir; }
  list(root) { return Promise.all([readFolder(this.dir, 'yours'), root ? readFolder(join(root, '.fairy/skills'), 'project') : []]).then(([mine, project]) => [...mine, ...project.filter(skill => !mine.some(own => own.name === skill.name))]); }
  async save({ name, description = '', text }) {
    if (!NAME.test(name || '')) throw new Error('Name a skill with lowercase letters, numbers and dashes.');
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) throw new Error('A skill needs some instructions, under 32 KB.');
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await writeFile(join(this.dir, `${name}.md`), `---\ndescription: ${String(description).replace(/\s+/g, ' ').trim().slice(0, 200)}\n---\n${text.trim()}\n`, { mode: 0o600 });
  }
  async remove(name) {
    if (!NAME.test(name || '')) throw new Error('That skill isn’t valid.');
    await rm(join(this.dir, `${name}.md`), { force: true });
  }
  // "/name what to do" becomes the skill's instructions and the request, for the model only.
  async expand(typed, root) {
    const match = /^\/([a-z0-9][a-z0-9-]{0,39})(?:\s+([\s\S]*))?$/.exec(String(typed).trim());
    if (!match) return typed;
    const skill = (await this.list(root)).find(entry => entry.name === match[1]);
    if (!skill) return typed;
    const from = skill.source === 'project' ? ' It comes from this project.' : '';
    return `Follow this skill, "${skill.name}", which the user chose to run.${from}\n\n${skill.text}${match[2] ? `\n\nThe user's request: ${match[2].trim()}` : ''}`;
  }
}
