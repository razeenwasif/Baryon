// What the Simulator panel sends a device: where a pointer is, in the device's points, and what a key press means.
const KEYS: Record<string, string> = {
  Enter: 'return',
  Backspace: 'delete',
  Delete: 'forward_delete',
  Tab: 'tab',
  Escape: 'escape',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  Home: 'home',
  End: 'end',
  PageUp: 'page_up',
  PageDown: 'page_down',
};

export interface PointerCoords {
  clientX: number;
  clientY: number;
}

export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface DevicePointResult {
  x: number;
  y: number;
}

export interface SimulatorKeyInput {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

export type SimulatorKeyCommand =
  | { key: string; modifiers: string[] }
  | { text: string };

export interface SimulatorDevice {
  booted?: boolean;
  name?: string;
  runtime?: string;
  type?: string;
}

export interface FrameSizeResult {
  bezel: number;
  corner: number;
}

// Where a pointer is on the device, in its points, from where it is on the picture of the screen.
export function devicePoint(
  { clientX, clientY }: PointerCoords,
  rect: ScreenRect | null | undefined,
  points: readonly number[] | null | undefined,
): DevicePointResult | null {
  if (!rect?.width || !rect?.height || !points) return null;
  const x = (clientX - rect.left) / rect.width * points[0], y = (clientY - rect.top) / rect.height * points[1];
  return { x: Math.min(points[0], Math.max(0, Math.round(x * 10) / 10)), y: Math.min(points[1], Math.max(0, Math.round(y * 10) / 10)) };
}

// What a key press in the panel sends: text, a named key, or a shortcut with ⌘. Others stay with the window.
export function keyFor(event: SimulatorKeyInput): SimulatorKeyCommand | null {
  if (event.metaKey && !event.ctrlKey && /^[a-z]$/i.test(event.key)) return { key: event.key.toLowerCase(), modifiers: ['command', ...(event.shiftKey ? ['shift'] : [])] };
  if (event.metaKey || event.ctrlKey) return null;
  if (KEYS[event.key]) return { key: KEYS[event.key], modifiers: event.shiftKey && event.key !== 'Tab' ? ['shift'] : event.altKey ? ['option'] : [] };
  if (event.key.length === 1) return { text: event.key };
  return null;
}

export const deviceLabel = (device: SimulatorDevice): string => `${device.booted ? '● ' : ''}${device.name} · ${device.runtime}`;

// The outline drawn around a device's screen, sized from the screen's width so it scales with the panel: an iPhone gets a
// thin bezel and its deep rounded corners (Xcode's own frame has an 80pt corner on a ~400pt-wide phone), an iPad a
// slightly thicker bezel and gentler corners.
export const isTablet = (device?: SimulatorDevice | null): boolean => /^iPad/i.test(device?.type || device?.name || '');

export function frameSize(screenWidth: unknown, tablet = false): FrameSizeResult {
  const width = Math.max(0, Number(screenWidth) || 0);
  return { bezel: Math.round(width * (tablet ? 0.045 : 0.034)), corner: Math.round(width * (tablet ? 0.055 : 0.135)) };
}
