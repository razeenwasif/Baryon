const people = new Map([[1, { id: 1, name: 'Ada' }], [2, { id: 2, name: 'Grace' }]]);

// One member by id, or null when there's no such member.
export function fetchUser(id) {
  return people.get(Number(id)) ?? null;
}
