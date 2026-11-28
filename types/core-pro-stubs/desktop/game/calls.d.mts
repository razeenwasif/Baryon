export const GAME_CALL_NAMES: readonly string[];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function gameCalls(options: any): Record<string, (...args: any[]) => Promise<any>>;
