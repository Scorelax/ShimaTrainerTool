// Line areas ("Self (80ft. line)", "50ft. line" -- always 5ft wide) as a real strip laid over the map rather than a set
// of grid cells: it starts at the caster, can point in ANY direction (not just the 8 grid directions the cone uses), and a
// creature is in it when any part of its footprint square overlaps the strip. Used by the map's line tool
// (battle-map-popup.js) and the "select from the map" line placer (line-area-picker.js).
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

/** The strip: origin (the caster's centre), unit direction `u`, length and half-width, all in cells. The length runs
 * `lengthFt` past the caster's own half-size, so the line reaches its full distance beyond the caster's edge. */
export function lineGeometry(casterPos, casterSize, angleDeg, lengthFt) {
  const n = casterSize || 1;
  const a = (angleDeg * Math.PI) / 180;
  const u = { x: Math.sin(a), y: -Math.cos(a) };
  // Grid distance counts a diagonal square as 5ft (move-range.js), so the reach is a square box round the caster, not a
  // circle: the strip runs to that box's edge, e.g. a 30ft line reaches 6 squares straight ahead AND 6 diagonally.
  const stretch = 1 / Math.max(Math.abs(u.x), Math.abs(u.y));
  return {
    o: { x: casterPos.col + n / 2, y: casterPos.row - n + 1 + n / 2 },
    u,
    len: (lengthFt / 5 + n / 2) * stretch,
    half: LINE_WIDTH_FT / 10,
  };
}

/** The squares within `lengthFt` of the caster's footprint (the line's reach box): {c0, c1, r0, r1}, inclusive. */
export function lineReachBox(casterPos, casterSize, lengthFt) {
  const n = casterSize || 1;
  const reach = Math.floor(lengthFt / 5);
  return { c0: casterPos.col - reach, c1: casterPos.col + n - 1 + reach, r0: casterPos.row - n + 1 - reach, r1: casterPos.row + reach };
}

function _inReachBox(box, pos, n) {
  return pos.col <= box.c1 && pos.col + n - 1 >= box.c0 && pos.row - n + 1 <= box.r1 && pos.row >= box.r0;
}

/** Whether the strip overlaps the NxN footprint at `pos` (separating-axis test). A strip that only grazes an edge
 * (overlap of `eps` cells or less) doesn't count. */
export function lineTouchesFootprint(g, pos, n, eps = 0.05) {
  const x0 = pos.col, y0 = pos.row - n + 1;
  const square = [[x0, y0], [x0 + n, y0], [x0 + n, y0 + n], [x0, y0 + n]];
  const v = { x: -g.u.y, y: g.u.x };
  const strip = [[0, -g.half], [g.len, -g.half], [g.len, g.half], [0, g.half]]
    .map(([s, t]) => [g.o.x + g.u.x * s + v.x * t, g.o.y + g.u.y * s + v.y * t]);
  for (const [ax, ay] of [[1, 0], [0, 1], [g.u.x, g.u.y], [v.x, v.y]]) {
    const a = square.map(([x, y]) => x * ax + y * ay);
    const b = strip.map(([x, y]) => x * ax + y * ay);
    if (Math.min(Math.max(...a), Math.max(...b)) - Math.max(Math.min(...a), Math.min(...b)) <= eps) return false;
  }
  return true;
}

/** Ids of every creature on the board (except the caster) the line touches. */
export function lineHitIds(session, casterId, angleDeg, lengthFt) {
  const board = session.board;
  const casterPos = board.tokens[casterId];
  if (!casterPos) return [];
  const casterSize = footprintForSize(session.participants[casterId]?.size);
  const g = lineGeometry(casterPos, casterSize, angleDeg, lengthFt);
  // The strip's 5ft-wide end pokes a little past the reach box's corner on a diagonal; whoever stands out there isn't hit.
  const box = lineReachBox(casterPos, casterSize, lengthFt);
  return Object.entries(board.tokens)
    .filter(([id, pos]) => id !== casterId && session.participants[id]
      && Math.abs((pos.z || 0) - (casterPos.z || 0)) <= lengthFt // a flyer higher up than the line is long is out of it (same as cones)
      && _inReachBox(box, pos, footprintForSize(session.participants[id].size))
      && lineTouchesFootprint(g, pos, footprintForSize(session.participants[id].size)))
    .map(([id]) => id);
}

/** Inline style for the strip element, positioned in percent of the map stage (cells are square, see the stage's
 * aspect-ratio, so one transform keeps the 5ft width true at every angle). */
export function lineStyle(board, g, angleDeg) {
  const { cols, rows } = board.grid;
  return `left:${(g.o.x / cols) * 100}%;top:${((g.o.y - g.half) / rows) * 100}%;width:${(g.len / cols) * 100}%;`
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
