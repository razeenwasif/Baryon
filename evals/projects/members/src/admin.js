import { fetchUser } from './users.js';

// Whether a member may see the admin page. Only member 1 can.
export function isAdmin(id) {
  return fetchUser(id)?.id === 1;
}
