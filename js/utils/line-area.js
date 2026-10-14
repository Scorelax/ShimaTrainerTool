// Line areas ("Self (80ft. line)", "50ft. line" -- always 5ft wide): a beam that starts in the middle of the caster, can
// point in ANY direction (not just the 8 grid directions the cone uses) and tilt up or down at a flyer. It covers exactly
// one 5ft square (cube) per 5ft of its length beyond the caster, whatever the angle -- one per step along its main
// direction, a diagonal step counting 5ft like every other distance here (the user's rule, 2026-10-14: a line hits the
// same number of squares at any angle) -- and a creature is in it when one of its cubes (its footprint, from its flying
// height up as high as it is wide) is one of those. Used by the map's line tool (battle-map-popup.js, always level) and
// the "select from the map" line placer (line-area-picker.js).
//
// Coordinates are in cells, y pointing down, with a token's footprint the NxN square whose bottom-left cell is its
// (col, row) -- the same convention as battle-map-grid.js's cellRect. Angles are degrees clockwise from straight up,
// the same as a token's `facing`.
import { footprintForSize } from './battle-map-grid.js';

/** The line length from a move's range text ("Self (80ft. line)" -> 80), or null when it isn't a line. */
export function lineFtFromRange(rangeText) {
  const m = /(\d+)\s*(?:ft|feet|foot)\.?\s*line/i.exec(String(rangeText || ''));
  return m ? Number(m[1]) : null;
}

/** Where a big caster fires from: `start` = { col, row } (one of its own squares -- its front left, say; left out = the
 * middle of it) and `layer` (how many 5ft up its own height: 0, the default, is its lowest point -- a Huge Pokemon on the
 * ground fires along the ground; the user's rule, 2026-10-14). Either may be missing. */
function _startOf(start, n) {
  const square = start && start.col != null && start.row != null ? { col: start.col, row: start.row } : null;
  const layer = Math.max(0, Math.min(n - 1, Math.floor(start?.layer || 0)));
  return { square, layer };
}

/** The beam's aim in 3D, for drawing its guide and aiming it: origin (the middle of the caster's start square, at its
 * start layer -- see _startOf), unit direction `d` (z is up; `pitchDeg` tilts it up (+) or down (-) from level) and
 * `drawLen`, the length of its shadow on the map out to the edge of the line's reach (grid distance: a diagonal square,
 * or a square up, counts 5ft). Which squares it covers is lineCells'. */
export function lineGeometry(casterPos, casterSize, angleDeg, lengthFt, pitchDeg = 0, start = null) {
  const n = casterSize || 1;
  const { square, layer } = _startOf(start, n);
  const oz = Math.floor((casterPos.z || 0) / 5) + layer + 0.5;
  const a = (angleDeg * Math.PI) / 180;
  const p = (pitchDeg * Math.PI) / 180;
  const d = { x: Math.sin(a) * Math.cos(p), y: -Math.cos(a) * Math.cos(p), z: Math.sin(p) };
  const stretch = 1 / Math.max(Math.abs(d.x), Math.abs(d.y), Math.abs(d.z));
  const len = (lengthFt / 5 + (square ? 0.5 : n / 2)) * stretch;
  return {
    o: square
      ? { x: square.col + 0.5, y: square.row + 0.5, z: oz }
      : { x: casterPos.col + n / 2, y: casterPos.row - n + 1 + n / 2, z: oz },
    d, len,
    drawLen: len * Math.cos(p),
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

/** The cubes a line covers, [{x: col, y: row, z: height layer}]: exactly lengthFt / 5 of them beyond the caster (fewer
 * where it runs off the map or into the ground), whatever the angle. From the middle of the caster -- or of its chosen
 * start square -- at its lowest layer unless raised (see _startOf), one cube per step along the beam's main direction;
 * the caster's own cubes don't count. */
export function lineCells(casterPos, casterSize, angleDeg, lengthFt, pitchDeg = 0, start = null, grid = null) {
  const n = casterSize || 1;
  const left = casterPos.col, top = casterPos.row - n + 1, z0 = Math.floor((casterPos.z || 0) / 5);
  const a = (angleDeg * Math.PI) / 180;
  const p = (pitchDeg * Math.PI) / 180;
  const d = { x: Math.sin(a) * Math.cos(p), y: -Math.cos(a) * Math.cos(p), z: Math.sin(p) };
  const { square, layer } = _startOf(start, n);
  const o = square ? { x: square.col + 0.5, y: square.row + 0.5 } : { x: left + n / 2, y: top + n / 2 };
  o.z = z0 + layer + 0.5;
  const main = Math.max(Math.abs(d.x), Math.abs(d.y), Math.abs(d.z));
  const want = Math.floor(lengthFt / 5);
  const own = (c, r, h) => c >= left && c < left + n && r >= top && r < top + n && h >= z0 && h < z0 + n;
  const out = [];
  for (let k = 1; out.length < want && k <= want + 2 * n + 2; k++) {
    // A hair past each step, so a beam out of a square's corner (a 2x2 caster's middle) picks its squares consistently.
    const t = k / main + 1e-6;
    const c = Math.floor(o.x + d.x * t), r = Math.floor(o.y + d.y * t), h = Math.floor(o.z + d.z * t);
    if (own(c, r, h)) continue;
    if (h < 0 && z0 >= 0) break; // into the ground
    if (grid && (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows)) break;
    out.push({ x: c, y: r, z: h });
  }
  return out;
}

/** Ids of every creature (except the caster) with a cube in the line (lineCells). Level by default (pitch 0), so it
 * passes under a flyer and over nothing on the ground; tilted (aimAtCreature) it can climb to one. */
export function lineHitIds(session, casterId, angleDeg, lengthFt, pitchDeg = 0, start = null) {
  const board = session.board;
  const casterPos = board.tokens[casterId];
  if (!casterPos) return [];
  const casterSize = footprintForSize(session.participants[casterId]?.size);
  const cubes = new Set(lineCells(casterPos, casterSize, angleDeg, lengthFt, pitchDeg, start, board.grid).map(q => `${q.x},${q.y},${q.z}`));
  return Object.entries(board.tokens)
    .filter(([id, pos]) => {
      if (id === casterId || !session.participants[id]) return false;
      const m = footprintForSize(session.participants[id].size);
      const z0 = Math.floor((pos.z || 0) / 5);
      for (let c = pos.col; c < pos.col + m; c++) for (let r = pos.row - m + 1; r <= pos.row; r++) for (let h = z0; h < z0 + m; h++) {
        if (cubes.has(`${c},${r},${h}`)) return true;
      }
      return false;
    })
    .map(([id]) => id);
}

/** The line's squares on the map (its cubes' ground squares), drawn as shaded squares. */
export function lineCellsHtml(board, cells) {
  const { cols, rows } = board.grid;
  const seen = new Set();
  return cells.filter((q) => { const k = `${q.x},${q.y}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .map(q => `<div class="bmap-line-cell" style="left:${(q.x / cols) * 100}%;top:${(q.y / rows) * 100}%;width:${100 / cols}%;height:${100 / rows}%"></div>`)
    .join('');
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

/** A thin aiming guide along the beam (the squares themselves are lineCellsHtml's). */
export function lineGuideStyle(board, g, angleDeg) {
  const { cols, rows } = board.grid;
  return `left:${(g.o.x / cols) * 100}%;top:calc(${(g.o.y / rows) * 100}% - 1.5px);width:${((g.drawLen ?? g.len) / cols) * 100}%;`
    + `height:3px;transform:rotate(${angleDeg - 90}deg);`;
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
    .bmap-line.guide { background: rgba(255,190,120,0.85); border: none; border-radius: 2px; box-shadow: 0 0 6px rgba(255,120,50,0.7); }
    .bmap-line-cells { position: absolute; inset: 0; z-index: 0; pointer-events: none; }
    .bmap-line-cell { position: absolute; box-sizing: border-box; background: rgba(255,140,60,0.42); box-shadow: inset 0 0 0 2px rgba(255,170,90,0.9); }
  `;
  document.head.appendChild(style);
}
