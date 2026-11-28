export function serveViewerAsset(
  pathname: string,
  options?: { roots?: string[] },
): Promise<{ status: number; headers: Record<string, string>; body: Buffer | string }>;
