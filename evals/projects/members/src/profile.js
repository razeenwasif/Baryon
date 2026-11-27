import { fetchUser } from './users.js';

export function profileLine(id) {
  const user = fetchUser(id);
  return user ? `${user.name} (#${user.id})` : 'Unknown member';
}
