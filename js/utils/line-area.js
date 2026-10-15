// Line areas ("Self (80ft. line)", "50ft. line" -- always 5ft wide): a beam 5ft wide and 5ft tall that starts in the
// caster, can point in ANY direction (not just the 8 grid directions -- a cone too, cone-area.js) and tilt up or down at a
// flyer. It reaches its length beyond the caster in grid distance (a diagonal square, or a square up, counts 5ft like
// every other distance here). Each 5ft square (cube) counts by how much of it the beam covers (the user's rule, 2026-10-14, so an
// angled line doesn't catch extra squares just by grazing them; 25% / 50% since 2026-10-15): over half is a full hit,
// over a quarter up to half an EDGE hit (the creature saves -- nothing on a success, half damage and the move's effects on
// a failure; combat-wip.js), a quarter or less misses -- so a diagonal line's side squares (exactly a quarter) miss. A creature counts its best-covered cube (its footprint, from its flying height up as high as it is wide).
// Used by the map's line tool (battle-map-popup.js, always level) and the "select from the map" line placer
// (line-area-picker.js).
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

/** The square the beam fires from when none was chosen: none (the middle) for an odd-sized caster; for an even-sized one,
 * whose middle is a grid corner -- a straight beam from there would run down a grid line, half of every square on each
 * side of it -- its own square furthest along the aim, ties going to the right of it (its front right). */
function _fireSquare(casterPos, n, square, angleDeg) {
  if (square || n % 2) return square;
  const a = (angleDeg * Math.PI) / 180;
  const fx = Math.sin(a), fy = -Math.cos(a); // forward on the map
  const left = casterPos.col, top = casterPos.row - n + 1, mx = left + n / 2, my = top + n / 2;
  let best = null, bestAlong = -Infinity, bestSide = -Infinity;
  for (let c = left; c < left + n; c++) for (let r = top; r < top + n; r++) {
    const dx = c + 0.5 - mx, dy = r + 0.5 - my;
    const along = dx * fx + dy * fy, side = dx * -fy + dy * fx;
    if (along > bestAlong + 1e-9 || (Math.abs(along - bestAlong) <= 1e-9 && side > bestSide)) {
      best = { col: c, row: r }; bestAlong = along; bestSide = side;
    }
  }
  return best;
}

/** Where the beam is aimed from, before an angle is known (dragging to aim it): the middle of the caster, or of its chosen
 * `start` square, at its start layer. */
export function lineAimOrigin(casterPos, casterSize, start = null) {
  const n = casterSize || 1;
  const { square, layer } = _startOf(start, n);
  const z = Math.floor((casterPos.z || 0) / 5) + layer + 0.5;
  return square ? { x: square.col + 0.5, y: square.row + 0.5, z } : { x: casterPos.col + n / 2, y: casterPos.row - n + 1 + n / 2, z };
}

/** The beam in 3D: origin `o` (the middle of the square it fires from -- see _fireSquare -- at its start layer, see
 * _startOf), unit direction `d` (z is up; `pitchDeg` tilts it up (+) or down (-) from level), `len` from the origin to
 * its far end -- out of the caster, then the line's length beyond it in grid distance (a diagonal square, or a square up,
 * counts 5ft) -- `drawLen`, the length of its shadow on the map, and `fire`, the square it fires from (null: the middle of
 * an odd-sized caster). Which squares it covers is lineCells'. */
export function lineGeometry(casterPos, casterSize, angleDeg, lengthFt, pitchDeg = 0, start = null) {
  const n = casterSize || 1;
  const { square, layer } = _startOf(start, n);
  const fire = _fireSquare(casterPos, n, square, angleDeg);
  const left = casterPos.col, top = casterPos.row - n + 1, z0 = Math.floor((casterPos.z || 0) / 5);
  const o = fire ? { x: fire.col + 0.5, y: fire.row + 0.5, z: z0 + layer + 0.5 } : lineAimOrigin(casterPos, n, start);
  const a = (angleDeg * Math.PI) / 180;
  const p = (pitchDeg * Math.PI) / 180;
  const d = { x: Math.sin(a) * Math.cos(p), y: -Math.cos(a) * Math.cos(p), z: Math.sin(p) };
  const stretch = 1 / Math.max(Math.abs(d.x), Math.abs(d.y), Math.abs(d.z));
  // Where the middle of the beam leaves the caster's own cubes.
  let out = Infinity;
  [['x', left, left + n], ['y', top, top + n], ['z', z0, z0 + n]].forEach(([k, lo, hi]) => {
    if (Math.abs(d[k]) > 1e-9) out = Math.min(out, ((d[k] > 0 ? hi : lo) - o[k]) / d[k]);
  });
  const len = (Number.isFinite(out) ? out : 0) + (lengthFt / 5) * stretch;
  return { o, d, len, drawLen: len * Math.cos(p), fire };
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

/** Over this share of a square (cube) the beam is a full hit; over LINE_EDGE up to it, an edge hit; LINE_EDGE or
 * less, a miss (the user's rule, 2026-10-14; a half and a quarter since 2026-10-15 -- exactly a quarter misses). */
export const LINE_FULL = 1 / 2;
export const LINE_EDGE = 1 / 4;
const _EPS = 1e-6;

/** 'full' | 'edge' | null (a miss) for a covered share (see LINE_FULL / LINE_EDGE). */
export function coverClass(cover) {
  if (cover > LINE_FULL + _EPS) return 'full';
  if (cover > LINE_EDGE + _EPS) return 'edge';
  return null;
}

/** The exact share (0..1) of map square (c, r) inside every half-plane [ax, ay, b] (ax*x + ay*y <= b) -- the square
 * cut down to the shape they make, then measured. Used for squares at a level beam's / cone's own height, where an
 * exact share matters: a diagonal line's side squares are exactly a quarter inside. */
export function squareShareInside(c, r, planes) {
  let poly = [[c, r], [c + 1, r], [c + 1, r + 1], [c, r + 1]];
  for (const [ax, ay, b] of planes) {
    const f = ([x, y]) => ax * x + ay * y - b;
    const next = [];
    poly.forEach((P, i) => {
      const Q = poly[(i + 1) % poly.length];
      const fp = f(P), fq = f(Q);
      if (fp <= 0) next.push(P);
      if ((fp <= 0) !== (fq <= 0)) { const t = fp / (fp - fq); next.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t]); }
    });
    poly = next;
    if (poly.length < 3) return 0;
  }
  let area = 0;
  poly.forEach(([x0, y0], i) => { const [x1, y1] = poly[(i + 1) % poly.length]; area += x0 * y1 - x1 * y0; });
  return Math.abs(area) / 2;
}

/** The cubes a line covers, [{x: col, y: row, z: height layer, cover, edge}], nearest first: every cube more than
 * LINE_EDGE of which lies inside the beam (`cover`, 0..1), `edge` when that's LINE_FULL or less. The caster's own cubes,
 * cubes under the ground and squares off the map (`grid`) don't count. A level beam fills its start layer exactly, so
 * only the squares across it matter; a tilted one is measured through the whole cube. */
export function lineCells(casterPos, casterSize, angleDeg, lengthFt, pitchDeg = 0, start = null, grid = null) {
  const n = casterSize || 1;
  const left = casterPos.col, top = casterPos.row - n + 1, z0 = Math.floor((casterPos.z || 0) / 5);
  const { o, d, len } = lineGeometry(casterPos, n, angleDeg, lengthFt, pitchDeg, start);
  const a = (angleDeg * Math.PI) / 180, p = (pitchDeg * Math.PI) / 180;
  const w = { x: Math.cos(a), y: Math.sin(a), z: 0 };                                          // across the beam
  const u = { x: -Math.sin(a) * Math.sin(p), y: Math.cos(a) * Math.sin(p), z: Math.cos(p) };    // up through it
  const level = Math.abs(pitchDeg) < 1e-9;
  const inBeam = (x, y, z) => {
    const sx = x - o.x, sy = y - o.y, sz = z - o.z;
    const t = sx * d.x + sy * d.y + sz * d.z;
    return t >= 0 && t <= len && Math.abs(sx * w.x + sy * w.y) <= 0.5 && Math.abs(sx * u.x + sy * u.y + sz * u.z) <= 0.5;
  };
  // Level: the square cut exactly to the strip. Tilted: points spread evenly through the cube.
  const strip = [
    [-d.x, -d.y, -(d.x * o.x + d.y * o.y)], [d.x, d.y, len + d.x * o.x + d.y * o.y],
    [w.x, w.y, 0.5 + w.x * o.x + w.y * o.y], [-w.x, -w.y, 0.5 - w.x * o.x - w.y * o.y],
  ];
  const S = 7;
  const coverOf = (c, r, h) => {
    if (level) return squareShareInside(c, r, strip);
    let hit = 0;
    for (let i = 0; i < S; i++) for (let j = 0; j < S; j++) {
      const x = c + (i + 0.5) / S, y = r + (j + 0.5) / S;
      for (let k = 0; k < S; k++) if (inBeam(x, y, h + (k + 0.5) / S)) hit++;
    }
    return hit / (S * S * S);
  };
  const own = (c, r, h) => c >= left && c < left + n && r >= top && r < top + n && h >= z0 && h < z0 + n;
  // The cubes near the middle of the beam, all along it.
  const seen = new Map();
  const reach = level ? 0 : 1;
  for (let t = 0; t <= len + 1e-9; t += 0.25) {
    const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
    for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) for (let dh = -reach; dh <= reach; dh++) {
      const c = Math.floor(x) + dc, r = Math.floor(y) + dr, h = Math.floor(z) + dh;
      const k = `${c},${r},${h}`;
      if (!seen.has(k)) seen.set(k, { c, r, h, t });
    }
  }
  const out = [];
  for (const { c, r, h, t } of seen.values()) {
    if (own(c, r, h) || (h < 0 && z0 >= 0)) continue; // its own cubes; under the ground
    if (grid && (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows)) continue;
    const cover = coverOf(c, r, h);
    const cls = coverClass(cover);
    if (cls) out.push({ x: c, y: r, z: h, cover, edge: cls === 'edge', t });
  }
  return out.sort((q1, q2) => q1.t - q2.t).map(({ t, ...q }) => q);
}

/** Who the line catches: `ids` everyone (except the caster) with a cube in it, `edgeIds` those of them whose
 * best-covered cube is only an edge hit (see lineCells). Level by default (pitch 0), so it passes under a flyer and over
 * nothing on the ground; tilted (aimAtCreature) it can climb to one. */
export function lineHits(session, casterId, angleDeg, lengthFt, pitchDeg = 0, start = null) {
  const board = session.board;
  const casterPos = board.tokens[casterId];
  if (!casterPos) return { ids: [], edgeIds: [] };
  const casterSize = footprintForSize(session.participants[casterId]?.size);
  const cover = new Map(lineCells(casterPos, casterSize, angleDeg, lengthFt, pitchDeg, start, board.grid).map(q => [`${q.x},${q.y},${q.z}`, q.cover]));
  const ids = [], edgeIds = [];
  Object.entries(board.tokens).forEach(([id, pos]) => {
    if (id === casterId || !session.participants[id]) return;
    const m = footprintForSize(session.participants[id].size);
    const z0 = Math.floor((pos.z || 0) / 5);
    let best = 0;
    for (let c = pos.col; c < pos.col + m; c++) for (let r = pos.row - m + 1; r <= pos.row; r++) for (let h = z0; h < z0 + m; h++) {
      best = Math.max(best, cover.get(`${c},${r},${h}`) || 0);
    }
    const cls = coverClass(best);
    if (!cls) return;
    ids.push(id);
    if (cls === 'edge') edgeIds.push(id);
  });
  return { ids, edgeIds };
}

/** Ids of everyone the line catches, full or edge hit (lineHits). */
export function lineHitIds(session, casterId, angleDeg, lengthFt, pitchDeg = 0, start = null) {
  return lineHits(session, casterId, angleDeg, lengthFt, pitchDeg, start).ids;
}

/** The line's squares on the map (its cubes' ground squares, each as its best-covered cube there): shaded squares,
 * edge-hit ones fainter and dashed. */
export function lineCellsHtml(board, cells) {
  const { cols, rows } = board.grid;
  const best = new Map();
  cells.forEach((q) => { const k = `${q.x},${q.y}`; if (!best.has(k) || best.get(k).cover < q.cover) best.set(k, q); });
  return [...best.values()]
    .map(q => `<div class="bmap-line-cell${q.edge ? ' edge' : ''}" style="left:${(q.x / cols) * 100}%;top:${(q.y / rows) * 100}%;width:${100 / cols}%;height:${100 / rows}%"></div>`)
    .join('');
}

/** The aim {angle, pitch} that points the beam from where it fires (the middle of the caster's cube, its chosen `start`
 * square, or an even-sized caster's square facing that way -- see _fireSquare) at the middle of creature `id`'s. */
export function aimAtCreature(session, casterId, id, fallbackAngle = 0, start = null) {
  const board = session.board;
  const casterPos = board.tokens[casterId];
  const pos = board.tokens[id];
  const n = footprintForSize(session.participants[casterId]?.size);
  const m = footprintForSize(session.participants[id]?.size);
  const aimFrom = (o, fallback) => {
    const dx = pos.col + m / 2 - o.x, dy = pos.row - m + 1 + m / 2 - o.y, dz = (pos.z || 0) / 5 + m / 2 - o.z;
    const flat = Math.hypot(dx, dy);
    const angle = flat < 1e-6 ? fallback : (((Math.atan2(dx, -dy) * 180) / Math.PI) + 360) % 360;
    return { angle, pitch: (Math.atan2(dz, flat) * 180) / Math.PI };
  };
  // Roughly from the middle first, then from the square it really fires from at that angle.
  const rough = aimFrom(lineAimOrigin(casterPos, n, start), fallbackAngle);
  return aimFrom(lineGeometry(casterPos, n, rough.angle, 5, 0, start).o, rough.angle);
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
    .bmap-line-cell.edge { background: rgba(255,200,110,0.16); box-shadow: none; border: 2px dashed rgba(255,205,120,0.85); }
    .bmap-token.line-hit.line-edge .bmap-token-portrait { box-shadow: 0 0 0 3px #ffd36e, 0 0 12px 2px rgba(255,210,110,0.7); }
  `;
  document.head.appendChild(style);
}
