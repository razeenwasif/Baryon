import { readFileSync } from 'node:fs';

// The settings, read once from config.json at the project's root.
export const config = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf8'));
