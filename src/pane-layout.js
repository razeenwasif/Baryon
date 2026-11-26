// How the side panel's panes are laid out: up to three at once, side by side ('row') or stacked ('col'), as a small
// tree. The root is always a group { dir, items, sizes }; an item is a pane { tab } or, for a third pane split the other
// way, one more group of two. sizes are each item's share of its group, adding up to 1. Shared by the page
// (side-pane.js) and the Mac that saves it with each chat (desktop/sessions.mjs), so both clean it the same way.
export const MAX_PANELS = 3, MIN_SHARE = 0.15;
const DIRS = ['row', 'col'];

export const single = tab => ({ dir: 'row', items: [{ tab }], sizes: [1] });
export const isLeaf = node => typeof node?.tab === 'string';

// The panes' ids, in order.
export function leaves(node) {
  if (!node) return [];
  if (isLeaf(node)) return [node.tab];
  return node.items.flatMap(leaves);
}

function shares(sizes, count) {
  const list = Array.from({ length: count }, (_, index) => { const n = Number(sizes?.[index]); return Number.isFinite(n) && n > 0 ? n : 1; });
  const total = list.reduce((sum, n) => sum + n, 0);
  return list.map(n => Math.round(n / total * 1000) / 1000);
}

// A saved layout made safe: known panes only, each once, three at most, nested one level at most; null if nothing's
// left. valid(tab) says whether a pane id is known.
export function cleanLayout(value, valid = tab => typeof tab === 'string' && tab.length > 0 && tab.length <= 40) {
  const seen = new Set();
  const walk = (node, depth) => {
    if (isLeaf(node)) {
      const tab = node.tab.slice(0, 40);
      if (!valid(tab) || seen.has(tab) || seen.size >= MAX_PANELS) return null;
      seen.add(tab); return { tab };
    }
    if (!node || typeof node !== 'object' || !Array.isArray(node.items) || depth > 1) return null;
    const dir = DIRS.includes(node.dir) ? node.dir : 'row';
    const kept = [];
    node.items.slice(0, MAX_PANELS).forEach((item, index) => { const clean = walk(item, depth + 1); if (clean) kept.push({ clean, size: node.sizes?.[index] }); });
    if (!kept.length) return null;
    // A group of one is just that item.
    if (kept.length === 1 && depth > 0) return kept[0].clean;
    return { dir, items: kept.map(entry => entry.clean), sizes: shares(kept.map(entry => entry.size), kept.length) };
  };
  let root = walk(value, 0);
  if (!root) return null;
  if (isLeaf(root)) root = single(root.tab);
  // A root holding only a group is that group.
  if (root.items.length === 1 && !isLeaf(root.items[0])) root = root.items[0];
  return root;
}

const copy = node => JSON.parse(JSON.stringify(node));
// The group holding a pane, and where in it.
function find(root, tab) {
  for (const [index, item] of root.items.entries()) {
    if (isLeaf(item) && item.tab === tab) return { group: root, index };
    if (!isLeaf(item)) { const inner = find(item, tab); if (inner) return inner; }
  }
  return null;
}

// Opens tab beside (dir 'row') or below (dir 'col') the pane target. Unchanged if three are open or tab already is.
export function split(layout, target, tab, dir = 'row') {
  if (!layout) return single(tab);
  const ids = leaves(layout);
  if (ids.length >= MAX_PANELS || ids.includes(tab)) return layout;
  const root = copy(layout), at = find(root, target) ?? find(root, ids.at(-1));
  if (!at) return layout;
  const { group, index } = at;
  if (group.items.length === 1) group.dir = dir;
  if (group.dir === dir) {
    const half = group.sizes[index] / 2;
    group.items.splice(index + 1, 0, { tab });
    group.sizes.splice(index, 1, half, half);
  } else {
    group.items[index] = { dir, items: [group.items[index], { tab }], sizes: [0.5, 0.5] };
  }
  return cleanLayout(root);
}

// Closes a pane; null when none is left.
export function remove(layout, tab) {
  if (!layout) return null;
  const root = copy(layout), at = find(root, tab);
  if (!at) return layout;
  at.group.items.splice(at.index, 1); at.group.sizes.splice(at.index, 1);
  return cleanLayout(root);
}

// Shows tab where target was. If tab is already open elsewhere, the two swap places.
export function replace(layout, target, tab) {
  if (!layout) return single(tab);
  const root = copy(layout), at = find(root, target);
  if (!at) return layout;
  const there = find(root, tab);
  if (there) there.group.items[there.index] = { tab: target };
  at.group.items[at.index] = { tab };
  return cleanLayout(root);
}

// The group at path (indexes from the root), for resizing and turning a split.
export function groupAt(layout, path) {
  let node = layout;
  for (const index of path) node = node?.items?.[index];
  return node && !isLeaf(node) ? node : null;
}
// Moves the line between items index and index + 1 of the group at path by delta (a share of the group).
export function resize(layout, path, index, delta) {
  const root = copy(layout), group = groupAt(root, path);
  if (!group || index < 0 || index + 1 >= group.items.length) return layout;
  const pair = group.sizes[index] + group.sizes[index + 1];
  const left = Math.min(pair - MIN_SHARE, Math.max(MIN_SHARE, group.sizes[index] + delta));
  group.sizes[index] = Math.round(left * 1000) / 1000; group.sizes[index + 1] = Math.round((pair - left) * 1000) / 1000;
  return root;
}
// Side by side becomes stacked, and back, for the group at path.
export function turn(layout, path) {
  const root = copy(layout), group = groupAt(root, path);
  if (!group) return layout;
  group.dir = group.dir === 'row' ? 'col' : 'row';
  return root;
}
// Whether any panes sit side by side, so the panel wants more width.
export const sideBySide = node => Boolean(node) && !isLeaf(node) && ((node.dir === 'row' && node.items.length > 1) || node.items.some(sideBySide));
