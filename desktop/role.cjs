// Two Macs (docs/fairy-on-two-macs-plan.md): which part this copy of Fairy plays. 'home' is the whole Fairy, as she has
// always been; 'face' is the thin companion on another Mac that shows her and passes on what you say (face-main.cjs).
// It's kept beside the data folder, never inside it, and FAIRY_ROLE wins over it so a test copy can pick its own.
const fs = require('node:fs');
const { join } = require('node:path');

const ROLES = ['home', 'face'];
const roleFile = userData => join(userData, 'role.json');

function readRole({ userData, env = process.env, read = fs.readFileSync } = {}) {
  if (ROLES.includes(env.FAIRY_ROLE)) return env.FAIRY_ROLE;
  try {
    const { role } = JSON.parse(read(roleFile(userData), 'utf8'));
    return ROLES.includes(role) ? role : 'home';
  } catch { return 'home'; }
}

function writeRole(userData, role, { write = fs.writeFileSync, mkdir = fs.mkdirSync } = {}) {
  if (!ROLES.includes(role)) throw new Error('A role is home or face.');
  mkdir(userData, { recursive: true });
  write(roleFile(userData), `${JSON.stringify({ role })}\n`);
}

module.exports = { ROLES, readRole, writeRole, roleFile };
