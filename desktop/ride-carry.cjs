// Two Macs: Ride along goes with her when she crosses between the Macs. The page that runs it (the companion's, or
// floating Fairy's on the full Fairy) has window.fairyRideAlong: state() says whether its switch is on and whether she's
// riding, leave() tells it she's gone to the other Mac, and arrive(ride) takes on the other Mac's switch and rides at
// once if she was riding there, resolving whether she now is.

// Only these two fields cross between the Macs.
function rideOf(value) {
  return value && typeof value === 'object' && typeof value.enabled === 'boolean' ? { enabled: value.enabled, riding: value.riding === true } : null;
}
const live = contents => Boolean(contents) && !contents.isDestroyed();
async function rideState(contents) {
  if (!live(contents)) return null;
  return rideOf(await contents.executeJavaScript('window.fairyRideAlong?.state?.() ?? null', true).catch(() => null));
}
async function leaveRide(contents) {
  if (live(contents)) await contents.executeJavaScript('window.fairyRideAlong?.leave?.()', true).catch(() => {});
}
// ride may be null (she came back without word from the other Mac): the page keeps its own switch and doesn't ride.
async function arriveRide(contents, ride) {
  if (!live(contents)) return false;
  const value = JSON.stringify(rideOf(ride) ?? {});
  return (await contents.executeJavaScript(`Promise.resolve(window.fairyRideAlong?.arrive?.(${value}) ?? false)`, true).catch(() => false)) === true;
}
module.exports = { rideOf, rideState, leaveRide, arriveRide };
