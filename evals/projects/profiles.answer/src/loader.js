// Loads profiles through the API, keeping each one so it's fetched once. The request itself is kept, so loads that
// arrive while it's under way share it; a request that fails is dropped, so the next load tries again.
export function createLoader(fetchUser) {
  const cache = new Map();
  return function load(id) {
    if (!cache.has(id)) cache.set(id, Promise.resolve().then(() => fetchUser(id)).catch(error => { cache.delete(id); throw error; }));
    return cache.get(id);
  };
}
