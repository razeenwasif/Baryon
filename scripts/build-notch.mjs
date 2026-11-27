// Builds native/bin/fairy-notch.node, the small Node-API module behind full screen around the notch (native/Notch.m).
// Node-API is the same in every Node and Electron, so this Node's headers do.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const headers = join(dirname(process.execPath), '..', 'include', 'node');
if (!existsSync(join(headers, 'node_api.h'))) throw new Error(`No Node-API headers at ${headers}.`);
mkdirSync(join(root, 'native/bin'), { recursive: true });
execFileSync('/usr/bin/clang', ['-bundle', '-undefined', 'dynamic_lookup', '-fobjc-arc', '-O2', '-mmacosx-version-min=12.0',
  '-DNODE_GYP_MODULE_NAME=fairy_notch', '-I', headers, '-framework', 'AppKit',
  join(root, 'native/Notch.m'), '-o', join(root, 'native/bin/fairy-notch.node')], { stdio: 'inherit' });
