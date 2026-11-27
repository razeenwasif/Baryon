// Loads profiles through the API, keeping each one so it's fetched once.
export function createLoader(fetchUser) {
  const cache = new Map();
  return async function load(id) {
    if (cache.has(id)) return cache.get(id);
    const user = await fetchUser(id);
    cache.set(id, user);
    return user;
  };
}
