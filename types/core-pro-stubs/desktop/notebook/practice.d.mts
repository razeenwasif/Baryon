export const ENGINES: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function engines(options?: any): <T = Record<string, unknown>>(request: any) => Promise<T>;
export const PRACTICE: Record<string, { folder: string; letter: string }>;
export function practiceKind(id: unknown): string | null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function readPractice(book: any, id: string): any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function checkWork(options: any): Promise<any>;
