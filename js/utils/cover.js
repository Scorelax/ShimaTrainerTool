// Cover from the DM's map objects (board.objects -- a rock, a tree, a wall..., each w x h squares and `height` ft
// tall): whether the attacker has a clear line of sight to a target, or the target is partly or fully behind something.
//
// In 3D, the same way line-area.js sees the board: coordinates in cells (y pointing down, a token's footprint the NxN
// square whose bottom-left cell is its (col, row)), heights in cells (5ft). An object is a solid block over its cells,
// from the ground up to its height; a creature is a cube, its footprint from its flying height up as high as it is wide.
// Sight lines run from points spread through the attacker's cube to points spread through the target's -- the attacker
// gets to lean out, so the point that sees the most of the target counts. Nothing of the target in sight = full cover
// (it can't be targeted); at least PARTIAL_COVER_SHARE of it hidden = partial cover (the attack roll has disadvantage).
// The top of a cube is one of its points, so a rock exactly as tall as the target hides it only partly.
// Objects standing in the attacker's or the target's own squares don't count -- a creature in a bush isn't hidden from
// everyone, and can still see out of it.
import { footprintForSize, objectCells, footprintCells } from './battle-map-grid.js';

/** How much of the target has to be hidden for partial cover (less than this is a clear shot). */
export const PARTIAL_COVER_SHARE = 0.25;

// Where the sight-line points sit in a cube (fractions of its size): a little in from the sides, and the very top.
const ACROSS = [0.1, 0.5, 0.9];
const UP = [0.1, 0.5, 1];

function _points(pos, n) {
  const x0 = pos.col, y0 = pos.row - n + 1, z0 = (pos.z || 0) / 5;
  const out = [];
  for (const fx of ACROSS) for (const fy of ACROSS) for (const fz of UP) out.push({ x: x0 + fx * n, y: y0 + fy * n, z: z0 + fz * n });
  return out;
}

/** "col,row" -> {h (cells), label} -- the tallest object standing on each square, minus the squares in `skip`. */
function _heights(board, skip) {
  const map = new Map();
  for (const o of board.objects || []) {
    const h = Number(o.height) / 5;
    if (!(h > 0)) continue;
    for (const c of objectCells(o)) {
      const key = `${c.col},${c.row}`;
      if (skip.has(key)) continue;
      if (!map.has(key) || map.get(key).h < h) map.set(key, { h, label: o.label || o.kind || 'an object' });
    }
  }
  return map;
}

/** The object square that blocks the straight line from a to b, or null. The line is cut where it crosses square
 * borders; in each piece it is inside one square, and it is blocked there when its lowest point in that piece is below
 * the object's top (only touching the top, or a corner, doesn't block). */
function _blocker(a, b, heights) {
  const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const ts = [0, 1];
  for (const axis of ['x', 'y']) {
    if (Math.abs(d[axis]) < 1e-9) continue;
    const lo = Math.min(a[axis], b[axis]), hi = Math.max(a[axis], b[axis]);
    for (let v = Math.ceil(lo); v <= Math.floor(hi); v++) ts.push((v - a[axis]) / d[axis]);
  }
  ts.sort((p, q) => p - q);
  for (let i = 0; i < ts.length - 1; i++) {
    const t0 = ts[i], t1 = ts[i + 1];
    if (t1 - t0 < 1e-9) continue;
    const tm = (t0 + t1) / 2;
    const square = heights.get(`${Math.floor(a.x + d.x * tm)},${Math.floor(a.y + d.y * tm)}`);
    if (square && Math.min(a.z + d.z * t0, a.z + d.z * t1) < square.h - 1e-6) return square;
  }
  return null;
}

/**
 * How well creature `targetId` is covered from `attackerId` by the map's objects:
 * {level: 'none' | 'partial' | 'full', by: [labels of the objects in the way], hidden: share of the target hidden}.
 * 'none' when either isn't on the map or there's nothing in the way.
 */
export function coverBetween(session, attackerId, targetId) {
  const none = { level: 'none', by: [], hidden: 0 };
  const board = session?.board;
  const ta = board?.tokens?.[attackerId], tb = board?.tokens?.[targetId];
  if (!ta || !tb || !(board.objects || []).length) return none;
  const na = footprintForSize(session.participants?.[attackerId]?.size);
  const nb = footprintForSize(session.participants?.[targetId]?.size);
  const skip = new Set([...footprintCells(ta.col, ta.row, na), ...footprintCells(tb.col, tb.row, nb)].map(c => `${c.col},${c.row}`));
  const heights = _heights(board, skip);
  if (!heights.size) return none;
  const targetPoints = _points(tb, nb);
  let best = -1, bestBy = new Set();
  for (const a of _points(ta, na)) {
    let seen = 0;
    const by = new Set();
    for (const b of targetPoints) {
      const square = _blocker(a, b, heights);
      if (square) by.add(square.label); else seen++;
    }
    if (seen > best) { best = seen; bestBy = by; }
    if (seen === targetPoints.length) return none;
  }
  const hidden = 1 - best / targetPoints.length;
  const by = [...bestBy];
  if (best === 0) return { level: 'full', by, hidden };
  if (hidden >= PARTIAL_COVER_SHARE) return { level: 'partial', by, hidden };
  return none;
}

/** "Partial cover (Rock)" / "Full cover (Tree, Wall)". */
export function coverText(cover) {
  if (!cover || cover.level === 'none') return '';
  return `${cover.level === 'full' ? 'Full' : 'Partial'} cover${cover.by.length ? ` (${cover.by.join(', ')})` : ''}`;
}
