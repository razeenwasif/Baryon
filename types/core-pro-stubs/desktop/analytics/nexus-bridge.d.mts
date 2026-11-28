export interface AnalyticsNexusBridge {
  stop(): void;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createAnalyticsNexusBridge(options: any): AnalyticsNexusBridge;
