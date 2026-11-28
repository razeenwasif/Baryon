export const WORLDS_CALL_NAMES: readonly string[];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function worldsCalls(options: any): Record<string, (...args: any[]) => Promise<any>>;
