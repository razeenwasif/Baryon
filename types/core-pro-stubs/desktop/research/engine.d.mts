export const ANSWER_WITHIN: number;
export const DEATHS_ALLOWED: number;
export const DEATH_WINDOW: number;
export class ResearchEngine {
  running: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(options: any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  call(method: string, params?: any, timeoutMs?: number): Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tell(method: string, params?: any): void;
  stop(): Promise<void>;
}
