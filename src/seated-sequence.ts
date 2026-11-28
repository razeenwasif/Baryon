// A seated session alternates playful gestures with longer quiet rests.
export type SeatedKind = 'finger' | 'chin' | 'peek';

export interface SeatedPose {
  kind: SeatedKind;
  frame: number;
}

export const SEATED_KINDS: SeatedKind[] = ['finger', 'chin', 'peek'];
export function seatedPose(time: number, out: Partial<SeatedPose> = {}): SeatedPose {
  const t = Math.max(0, time) % 66;
  let kind: SeatedKind = 'chin', frame = 0;
  if (t < 8) { kind = 'finger'; frame = Math.min(4, Math.floor(t / 1.6)); }
  else if (t >= 33 && t < 41) { const p = t - 33; kind = 'peek'; frame = p < 1 ? 0 : p < 1.7 ? 1 : p < 2.4 ? 2 : p < 3.5 ? 3 : p < 4.8 ? 4 : p < 5.8 ? 5 : p < 6.7 ? 6 : 7; }
  out.kind = kind;
  out.frame = frame;
  return out as SeatedPose;
}
