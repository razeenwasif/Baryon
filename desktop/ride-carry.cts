// Two Macs: Ride along goes with her when she crosses between the Macs. The page that runs it (the companion's, or
// floating Fairy's on the full Fairy) has window.fairyRideAlong: state() says whether its switch is on and whether she's
// riding, leave() tells it she's gone to the other Mac, and arrive(ride) takes on the other Mac's switch and rides at
// once if she was riding there, resolving whether she now is.

export interface RideState {
  enabled: boolean;
  riding: boolean;
}

export interface RideContents {
  isDestroyed(): boolean;
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
}

// Only these two fields cross between the Macs.
function rideOf(value: unknown): RideState | null {
  return value && typeof value === 'object' && typeof (value as { enabled?: unknown }).enabled === 'boolean'
    ? { enabled: (value as { enabled: boolean }).enabled, riding: (value as { riding?: unknown }).riding === true }
    : null;
}
function live(contents: RideContents | null | undefined): contents is RideContents {
  return Boolean(contents) && !contents!.isDestroyed();
}
async function rideState(contents: RideContents | null | undefined): Promise<RideState | null> {
  if (!live(contents)) return null;
  return rideOf(await contents.executeJavaScript('window.fairyRideAlong?.state?.() ?? null', true).catch(() => null));
}
async function leaveRide(contents: RideContents | null | undefined): Promise<void> {
  if (live(contents)) await contents.executeJavaScript('window.fairyRideAlong?.leave?.()', true).catch(() => {});
}
// ride may be null (she came back without word from the other Mac): the page keeps its own switch and doesn't ride.
async function arriveRide(contents: RideContents | null | undefined, ride: unknown): Promise<boolean> {
  if (!live(contents)) return false;
  const value = JSON.stringify(rideOf(ride) ?? {});
  return (await contents.executeJavaScript(`Promise.resolve(window.fairyRideAlong?.arrive?.(${value}) ?? false)`, true).catch(() => false)) === true;
}
module.exports = { rideOf, rideState, leaveRide, arriveRide };
