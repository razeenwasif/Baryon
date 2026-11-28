export const BINARY: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function researchService(options: any): {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  watch(options: any): void;
  knowSeats(): Promise<void>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setKernels(kernels: any): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  seatsNow(): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prefs?: { get(): Record<string, any> };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  engine: { call(method: string, ...args: any[]): Promise<any> };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  say?(notice: any): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
};
