export interface AcademyApi {
  academy?: (name: string, ...args: unknown[]) => Promise<unknown>;
  onAcademy?: (cb: (evt: unknown) => void) => () => void;
}
