const WEEK = 7 * 24 * 60 * 60 * 1000;

// The first n times a weekly reminder goes off, starting from its first one.
export function nextTimes(first, n) {
  const times = [];
  for (let i = 0; i < n; i++) times.push(new Date(first.getTime() + i * WEEK));
  return times;
}
