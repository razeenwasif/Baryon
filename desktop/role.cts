// Two Macs (docs/fairy-on-two-macs-plan.md): which part this copy of Fairy plays. 'home' is the whole Fairy, as she has
// always been; 'face' is the thin companion on another Mac that shows her and passes on what you say (face-main.cjs).
// It's kept beside the data folder, never inside it, and FAIRY_ROLE wins over it so a test copy can pick its own.
const fs = require('node:fs') as typeof import('node:fs');
const { join } = require('node:path') as typeof import('node:path');

type FairyRole = 'home' | 'face';

interface ReadRoleOptions {
  userData?: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  read?: (path: string, encoding: BufferEncoding) => string;
}

interface WriteRoleOptions {
  write?: (path: string, data: string) => void;
  mkdir?: (path: string, options: { recursive: boolean }) => unknown;
}

const ROLES: FairyRole[] = ['home', 'face'];
const roleFile = (userData: string): string => join(userData, 'role.json');

function readRole({ userData = '', env = process.env, read = fs.readFileSync }: ReadRoleOptions = {}): FairyRole {
  const envRole = env.FAIRY_ROLE;
  if (envRole && (ROLES as readonly string[]).includes(envRole)) return envRole as FairyRole;
  try {
    const parsed = JSON.parse(read(roleFile(userData), 'utf8')) as { role?: unknown } | null;
    const role = parsed?.role;
    return typeof role === 'string' && (ROLES as readonly string[]).includes(role) ? (role as FairyRole) : 'home';
  } catch { return 'home'; }
}

function writeRole(userData: string, role: string, { write = fs.writeFileSync, mkdir = fs.mkdirSync }: WriteRoleOptions = {}): void {
  if (!(ROLES as readonly string[]).includes(role)) throw new Error('A role is home or face.');
  mkdir(userData, { recursive: true });
  write(roleFile(userData), `${JSON.stringify({ role })}\n`);
}

module.exports = { ROLES, readRole, writeRole, roleFile };
