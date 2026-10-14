// Cone areas in 3D, for the "select from the map" cone aimer (line-area-picker.js's pickConeArea). The map is cubes: every
// square is a 5ft cube, stacked up into the air, and a creature fills the cubes of its footprint from its flying height up
// (as tall as it is wide). A cube is in the cone when its middle is within the cone's reach (grid distance -- a diagonal or
// a square up counts 5ft) AND less than 45 degrees off the cone's direction. Level and pointed along the grid, that's the
// table's grid cone exactly (battle-map-view.js's coneCells: rows 1, 3, 5... wide straight ahead, the square block off the
// corner on a diagonal) -- and it spreads upward the same way, so a flyer is only caught where the cone has grown tall
// enough. Tapping a creature tilts the cone straight at it.
//
// Coordinates are in cells: x = column, y = row (down), z = height in cubes (up).
import { footprintForSize } from './battle-map-grid.js';

const HALF_ANGLE_COS = Math.cos(Math.PI / 4) + 1e-6; // strictly inside 45 degrees, like the grid template's edges

/** The cube the cone comes out of: the footprint cell on the edge it faces (coneCells' rule -- the corner for a
 * diagonal, the middle of the edge otherwise), at the caster's lowest layer (or the one `start.layer` raises it to). `dir` is 0-7 (up, up-right, ...);
 * a tilted cone (no grid direction) comes out of the footprint's middle. */
export function coneOrigin(pos, size, dir = null, start = null) {
  const n = size || 1;
  const mid = Math.floor((n - 1) / 2);
  const left = pos.col, top = pos.row - n + 1;
  let x = left + mid, y = top + mid;
  // From the caster's lowest point unless the player raised it (`start.layer`, up to its own height -- the user's rule,
  // 2026-10-14), and from the square they chose (`start.col/row`, its front left, say), whichever way it points.
  const z = Math.floor((pos.z || 0) / 5) + Math.max(0, Math.min(n - 1, Math.floor(start?.layer || 0)));
  if (start && start.col != null && start.row != null) return { x: start.col, y: start.row, z };
  if (dir != null) {
    const dx = [0, 1, 1, 1, 0, -1, -1, -1][dir];
    const dy = [-1, -1, 0, 1, 1, 1, 0, -1][dir];
    x = dx > 0 ? left + n - 1 : dx < 0 ? left : left + mid;
    y = dy > 0 ? top + n - 1 : dy < 0 ? top : top + mid;
  }
  return { x, y, z };
}

/** The level cone's direction for a facing angle, snapped to the 8 grid directions: { dir, axis }. */
export function levelCone(angleDeg) {
  const dir = ((Math.round((angleDeg || 0) / 45) % 8) + 8) % 8;
  const dx = [0, 1, 1, 1, 0, -1, -1, -1][dir];
  const dy = [-1, -1, 0, 1, 1, 1, 0, -1][dir];
  const l = Math.hypot(dx, dy);
  return { dir, axis: { x: dx / l, y: dy / l, z: 0 } };
}

/** Whether the cube whose middle is `v` (offset from the origin cube's middle, in cells) is in the cone. */
function _inCone(v, axis, reach) {
  if (Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)) > reach) return false;
  const len = Math.hypot(v.x, v.y, v.z);
  if (len < 1e-9) return false; // the origin cube is the caster's own
  return (v.x * axis.x + v.y * axis.y + v.z * axis.z) / len > HALF_ANGLE_COS;
}

/** The cubes a creature fills: [{x, y, z}] cell / layer indices. */
function _cubesOf(pos, m) {
  const out = [];
  const z0 = Math.floor((pos.z || 0) / 5);
  for (let c = pos.col; c < pos.col + m; c++) for (let r = pos.row - m + 1; r <= pos.row; r++) for (let h = z0; h < z0 + m; h++) out.push({ x: c, y: r, z: h });
  return out;
}

/** Whether creature `id` has any cube within the cone's reach of `origin` (it could be aimed at). */
export function inConeReach(session, id, origin, lengthCells) {
  const pos = session.board.tokens[id];
  if (!pos || !session.participants[id]) return false;
  return _cubesOf(pos, footprintForSize(session.participants[id].size))
    .some(q => Math.max(Math.abs(q.x - origin.x), Math.abs(q.y - origin.y), Math.abs(q.z - origin.z)) <= lengthCells);
}

/** Ids of every creature (but the caster) with a cube in the cone. */
export function coneHitIds(session, casterId, origin, axis, lengthCells) {
  return Object.entries(session.board.tokens)
    .filter(([id, pos]) => id !== casterId && session.participants[id]
      && _cubesOf(pos, footprintForSize(session.participants[id].size))
        .some(q => _inCone({ x: q.x - origin.x, y: q.y - origin.y, z: q.z - origin.z }, axis, lengthCells)))
    .map(([id]) => id);
}

/** The map squares to shade: where the cone covers the caster's own height or the ground (a cone fired down from the air
 * shows where it lands). Level, that's coneCells exactly; tilted up, only its start near the caster -- the creatures it
 * catches higher up are ringed instead. */
export function coneShadowCells(board, origin, axis, lengthCells) {
  const { cols, rows } = board.grid;
  const out = new Set();
  const layers = [...new Set([0, origin.z])].map(h => h - origin.z);
  for (let c = Math.max(0, origin.x - lengthCells); c <= Math.min(cols - 1, origin.x + lengthCells); c++) {
    for (let r = Math.max(0, origin.y - lengthCells); r <= Math.min(rows - 1, origin.y + lengthCells); r++) {
      if (layers.some(dz => _inCone({ x: c - origin.x, y: r - origin.y, z: dz }, axis, lengthCells))) out.add(`${c},${r}`);
    }
  }
  return out;
}

/** The cone tilted straight at creature `id`: { origin, axis, pitch } (pitch in degrees, + up). */
export function coneAimAt(session, casterId, id, start = null) {
  const board = session.board;
  const origin = coneOrigin(board.tokens[casterId], footprintForSize(session.participants[casterId]?.size), null, start);
  const pos = board.tokens[id];
  const m = footprintForSize(session.participants[id]?.size);
  const v = {
    x: pos.col + (m - 1) / 2 - origin.x,
    y: pos.row - m + 1 + (m - 1) / 2 - origin.y,
    z: Math.floor((pos.z || 0) / 5) + (m - 1) / 2 - origin.z,
  };
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { origin, axis: { x: v.x / len, y: v.y / len, z: v.z / len }, pitch: (Math.atan2(v.z, Math.hypot(v.x, v.y)) * 180) / Math.PI };
}
