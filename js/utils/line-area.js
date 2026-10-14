// Line areas ("Self (80ft. line)", "50ft. line" -- always 5ft wide) as a real beam rather than a set of grid cells: it
// starts in the middle of the caster, can point in ANY direction (not just the 8 grid directions the cone uses) and tilt
// up or down at a flyer, and a creature is in it when the beam (5ft wide, 5ft tall) touches its cube -- its footprint,
// from its flying height up as high as it is wide. Used by the map's line tool (battle-map-popup.js, always level) and
// the "select from the map" line placer (line-area-picker.js).
//
// Coordinates are in cells, y pointing down, with a token's footprint the NxN square whose bottom-left cell is its
// (col, row) -- the same convention as battle-map-grid.js's cellRect. Angles are degrees clockwise from straight up,
// the same as a token's `facing`.
import { footprintForSize } from './battle-map-grid.js';

export const LINE_WIDTH_FT = 5;

/** The line length from a move's range text ("Self (80ft. line)" -> 80), or null when it isn't a line. */
export function lineFtFromRange(rangeText) {
  const m = /(\d+)\s*(?:ft|feet|foot)\.?\s*line/i.exec(String(rangeText || ''));
  return m ? Number(m[1]) : null;
}

/** The beam, in 3D: origin (the middle of the caster's cube), unit direction `d` (z is up), its length and half-size
 * (5ft wide AND 5ft tall), all in cells. `pitchDeg` tilts it up (+) or down (-) from level -- 0, the default, fires it
 * straight out at the caster's own height. `u` / `drawLen` are its shadow on the map, for drawing the strip. The length
 * runs `lengthFt` past the caster's own half-size, so the line reaches its full distance beyond the caster's edge.
 * `start` ({col, row}, one of a big caster's own squares -- its front left, say): the beam starts from the middle of that
 * square instead, and runs `lengthFt` past that square's edge. */
export function lineGeometry(casterPos, casterSize, angleDeg, lengthFt, pitchDeg = 0, start = null) {
  const n = casterSize || 1;
  const a = (angleDeg * Math.PI) / 180;
  const p = (pitchDeg * Math.PI) / 180;
  const u = { x: Math.sin(a), y: -Math.cos(a) };
  const d = { x: u.x * Math.cos(p), y: u.y * Math.cos(p), z: Math.sin(p) };
  // Grid distance counts a diagonal square (or a square up) as 5ft (move-range.js), so the reach is a box round the
  // caster, not a sphere: the beam runs to that box's edge, e.g. a 30ft line reaches 6 squares straight ahead, 6
  // diagonally, or 30ft straight up.
  const stretch = 1 / Math.max(Math.abs(d.x), Math.abs(d.y), Math.abs(d.z));
  const len = (lengthFt / 5 + (start ? 0.5 : n / 2)) * stretch;
  return {
    o: start
      ? { x: start.col + 0.5, y: start.row + 0.5, z: (casterPos.z || 0) / 5 + n / 2 }
      : { x: casterPos.col + n / 2, y: casterPos.row - n + 1 + n / 2, z: (casterPos.z || 0) / 5 + n / 2 },
    u, d, len,
    drawLen: len * Math.cos(p),
    half: LINE_WIDTH_FT / 10,
    // Across the beam: level and sideways (v), and "up" for the beam (w = d x v).
    v: { x: Math.cos(a), y: Math.sin(a), z: 0 },
    w: { x: -d.z * Math.sin(a), y: d.z * Math.cos(a), z: d.x * Math.sin(a) - d.y * Math.cos(a) },
  };
}

/** The squares within `lengthFt` of the caster's footprint (the line's reach box on the map): {c0, c1, r0, r1}, inclusive. */
export function lineReachBox(casterPos, casterSize, lengthFt) {
  const n = casterSize || 1;
  const reach = Math.floor(lengthFt / 5);
  return { c0: casterPos.col - reach, c1: casterPos.col + n - 1 + reach, r0: casterPos.row - n + 1 - reach, r1: casterPos.row + reach };
}

/** Whether creature `id` is within the line's reach -- on the map AND in height (a flyer 40ft up is 40ft away). */
export function inLineReach(session, casterId, id, lengthFt) {
  const board = session.board;
  const casterPos = board.tokens[casterId];
  const pos = board.tokens[id];
  if (!casterPos || !pos || !session.participants[id]) return false;
  const n = footprintForSize(session.participants[casterId]?.size);
  const m = footprintForSize(session.participants[id].size);
  const box = lineReachBox(casterPos, n, lengthFt);
  const reach = Math.floor(lengthFt / 5);
  const cz = (casterPos.z || 0) / 5, z = (pos.z || 0) / 5;
  return pos.col <= box.c1 && pos.col + m - 1 >= box.c0 && pos.row - m + 1 <= box.r1 && pos.row >= box.r0
    && z < cz + n + reach && z + m > cz - reach;
}

const _dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const _cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

/** Whether the beam overlaps the NxNxN cube of the creature at `pos` (its footprint, from its flying height up) --
 * a separating-axis test. A beam that only grazes a face (overlap of `eps` cells or less) doesn't count. */
export function lineTouchesCube(g, pos, n, eps = 0.05) {
  const x0 = pos.col, y0 = pos.row - n + 1, z0 = (pos.z || 0) / 5;
  const cube = [];
  for (const x of [x0, x0 + n]) for (const y of [y0, y0 + n]) for (const z of [z0, z0 + n]) cube.push({ x, y, z });
  const beam = [];
  for (const s of [0, g.len]) for (const t of [-g.half, g.half]) for (const q of [-g.half, g.half]) {
    beam.push({ x: g.o.x + g.d.x * s + g.v.x * t + g.w.x * q, y: g.o.y + g.d.y * s + g.v.y * t + g.w.y * q, z: g.o.z + g.d.z * s + g.v.z * t + g.w.z * q });
  }
  const unit = [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }];
  const own = [g.d, g.v, g.w];
  const axes = [...unit, ...own];
  unit.forEach(e => own.forEach(f => { const c = _cross(e, f); if (_dot(c, c) > 1e-9) axes.push(c); }));
  for (const ax of axes) {
    const l = Math.sqrt(_dot(ax, ax));
    const a = cube.map(pt => _dot(pt, ax) / l);
    const b = beam.map(pt => _dot(pt, ax) / l);
    if (Math.min(Math.max(...a), Math.max(...b)) - Math.max(Math.min(...a), Math.min(...b)) <= eps) return false;
  }
  return true;
}

/** Ids of every creature (except the caster) in the line's reach that the beam touches. Level by default (pitch 0), so
 * it passes under a flyer and over nothing on the ground; tilted (aimAtCreature) it can climb to one. */
export function lineHitIds(session, casterId, angleDeg, lengthFt, pitchDeg = 0, start = null) {
  const board = session.board;
  const casterPos = board.tokens[casterId];
  if (!casterPos) return [];
  const casterSize = footprintForSize(session.participants[casterId]?.size);
  const g = lineGeometry(casterPos, casterSize, angleDeg, lengthFt, pitchDeg, start);
  // The beam's square end pokes a little past the reach box's corner on a diagonal; whoever stands out there isn't hit.
  return Object.entries(board.tokens)
    .filter(([id, pos]) => id !== casterId && inLineReach(session, casterId, id, lengthFt)
      && lineTouchesCube(g, pos, footprintForSize(session.participants[id].size)))
    .map(([id]) => id);
}

/** The aim {angle, pitch} that points the beam from the middle of the caster's cube (or its chosen `start` square) at
 * the middle of creature `id`'s. */
export function aimAtCreature(session, casterId, id, fallbackAngle = 0, start = null) {
  const board = session.board;
  const casterPos = board.tokens[casterId];
  const pos = board.tokens[id];
  const o = lineGeometry(casterPos, footprintForSize(session.participants[casterId]?.size), 0, 5, 0, start).o;
  const m = footprintForSize(session.participants[id]?.size);
  const dx = pos.col + m / 2 - o.x, dy = pos.row - m + 1 + m / 2 - o.y, dz = (pos.z || 0) / 5 + m / 2 - o.z;
  const flat = Math.hypot(dx, dy);
  const angle = flat < 1e-6 ? fallbackAngle : (((Math.atan2(dx, -dy) * 180) / Math.PI) + 360) % 360;
  return { angle, pitch: (Math.atan2(dz, flat) * 180) / Math.PI };
}

/** Inline style for the strip element (the beam's shadow on the map), positioned in percent of the map stage (cells
 * are square, see the stage's aspect-ratio, so one transform keeps the 5ft width true at every angle). */
export function lineStyle(board, g, angleDeg) {
  const { cols, rows } = board.grid;
  return `left:${(g.o.x / cols) * 100}%;top:${((g.o.y - g.half) / rows) * 100}%;width:${((g.drawLen ?? g.len) / cols) * 100}%;`
    + `height:${((2 * g.half) / rows) * 100}%;transform:rotate(${angleDeg - 90}deg);`;
}

/** The angle from the strip's origin to a pointer position over the stage element. */
export function angleToPointer(stageEl, board, origin, clientX, clientY) {
  const r = stageEl.getBoundingClientRect();
  const x = ((clientX - r.left) / r.width) * board.grid.cols;
  const y = ((clientY - r.top) / r.height) * board.grid.rows;
  return (((Math.atan2(x - origin.x, -(y - origin.y)) * 180) / Math.PI) + 360) % 360;
}

export function injectLineStyles() {
  if (document.getElementById('line-area-styles')) return;
  const style = document.createElement('style');
  style.id = 'line-area-styles';
  style.textContent = `
    .bmap-line { position: absolute; z-index: 0; pointer-events: none; transform-origin: 0 50%; box-sizing: border-box;
      background: linear-gradient(90deg, rgba(255,140,60,0.55), rgba(255,140,60,0.25)); border: 2px solid rgba(255,170,90,0.95);
      border-radius: 2px 6px 6px 2px; box-shadow: 0 0 14px rgba(255,120,50,0.6); }
    .bmap-token.line-hit .bmap-token-portrait { box-shadow: 0 0 0 3px #ff8a3c, 0 0 16px 2px rgba(255,120,50,0.85); }
  `;
  document.head.appendChild(style);
}
