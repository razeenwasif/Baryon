export const REPORT_MD: string;
export const REPORT_TEX: string;
export const REPORT_PDF: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function generateReport(options: any): Promise<{ record: any; markdown: string }>;
