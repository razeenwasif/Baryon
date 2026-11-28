export const MAIN_ONLY: readonly string[];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function notebookCalls(options: any): Record<string, (...args: any[]) => any> & {
  hush(): void;
  close(): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  studyPaper(args: any): Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  phone: any;
};
