// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function generatePaperPlan(options: any): Promise<{ plan: any; file: string }>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function renderReproductionMarkdown(goal: any, plan: any): string;
export function writeReproductionPlanFile(folder: string, markdown: string): Promise<void>;
