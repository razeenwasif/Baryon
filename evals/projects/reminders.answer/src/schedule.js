// The first n times a weekly reminder goes off, starting from its first one. Each is seven calendar days on in local
// time, so a daylight-saving change moves the gap, not the clock time.
export function nextTimes(first, n) {
  const times = [];
  for (let i = 0; i < n; i++) {
    const time = new Date(first.getTime());
    time.setDate(first.getDate() + 7 * i);
    times.push(time);
  }
  return times;
}
