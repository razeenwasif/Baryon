export const SLUG: RegExp;
export const IDS: Record<string, RegExp>;
export const CITED: RegExp;
export const DISCIPLINES: readonly string[];
export const STATUSES: readonly string[];
export const BOARD_SEATS: readonly string[];
export function isRunFile(key: unknown): key is string;
export function checkSlug(slug: unknown): string;
export function checkId(kind: string, id: unknown): string | null;
export function checkText(text: unknown, most: number, what: string): string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function researchCalls(options: { engine: any }): Record<string, (...args: any[]) => any>;
