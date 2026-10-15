// Cone areas in 3D, for the "select from the map" cone aimer (line-area-picker.js's pickConeArea) and the map's cone
// preview (battle-map-popup.js). The map is cubes: every square is a 5ft cube, stacked up into the air, and a creature
// fills the cubes of its footprint from its flying height up (as tall as it is wide). A cone is a 90-degree wedge -- a
// square pyramid in 3D, as wide and as tall as it is long -- that turns to ANY angle like a line, and tilts up or down.
// It comes out of the caster's edge: where the aim leaves the square it fires from (the line's rule -- the middle of an
// odd-sized caster, the square facing the aim of an even-sized one, or the square the player chose), at its start layer;
// and it reaches its length beyond that square in grid distance (a diagonal square, or a square up, counts 5ft).
// Each square (cube) counts by how much of it the cone covers, the same as a line (the user's rule, 2026-10-15): over 2/3
// is a hit, 1/3 to 2/3 the edge (a save for nothing, half damage and effects on a fail), less misses. Straight or
// diagonal that's the table's grid cone exactly (rows 1, 3, 5... wide; the square block off the corner), and at any
// angle in between it covers about as many squares.
//
// Coordinates are in cells: x = column, y = row (down), z = height in cubes (up).
import { footprintForSize } from './battle-map-grid.js';
import { lineGeometry, LINE_FULL, LINE_EDGE } from './line-area.js';

const dot = (a, p) => a.x * p.x + a.y * p.y + a.z * p.z;

/** The cone in 3D: `apex` (where it leaves the caster), unit `d` (forward), `layer` (the height layer it starts in), `z`
 * (the middle of that layer), `level`, `reach` (the box it can't leave: its length around the square it fires from) and
 * `planes` -- the half-spaces [a, b] (a·p <= b) it's the inside of: the wedge's four sides and the reach box. */
export function coneGeometry(casterPos, casterSize, angleDeg, lengthFt, pitchDeg = 0, start = null) {
  const n = casterSize || 1;
  const { o, d, fire } = lineGeometry(casterPos, n, angleDeg, 0, pitchDeg, start);
  const layer = Math.floor(o.z);
  // The cube it fires from (a whole odd-sized caster's footprint when it fires from the middle), at its start layer.
  const box = fire ? { x0: fire.col, x1: fire.col + 1, y0: fire.row, y1: fire.row + 1 }
    : { x0: casterPos.col, x1: casterPos.col + n, y0: casterPos.row - n + 1, y1: casterPos.row + 1 };
  box.z0 = layer; box.z1 = layer + 1;
  let out = Infinity;
  [['x', box.x0, box.x1], ['y', box.y0, box.y1], ['z', box.z0, box.z1]].forEach(([k, lo, hi]) => {
    if (Math.abs(d[k]) > 1e-9) out = Math.min(out, ((d[k] > 0 ? hi : lo) - o[k]) / d[k]);
  });
  const apex = { x: o.x + d.x * out, y: o.y + d.y * out, z: o.z + d.z * out };
  const a = (angleDeg * Math.PI) / 180, p = (pitchDeg * Math.PI) / 180;
  const w = { x: Math.cos(a), y: Math.sin(a), z: 0 };                                          // across it
  const u = { x: -Math.sin(a) * Math.sin(p), y: Math.cos(a) * Math.sin(p), z: Math.cos(p) };    // up through it
  // Inside: |v·w| <= v·d and |v·u| <= v·d, v from the apex -- 45 degrees off the middle each way.
  const planes = [[w, 1], [w, -1], [u, 1], [u, -1]].map(([v, s]) => {
    const n3 = { x: s * v.x - d.x, y: s * v.y - d.y, z: s * v.z - d.z };
    return [n3, dot(n3, apex)];
  });
  const L = lengthFt / 5;
  const reach = { x0: box.x0 - L, x1: box.x1 + L, y0: box.y0 - L, y1: box.y1 + L, z0: box.z0 - L, z1: box.z1 + L };
  planes.push(
    [{ x: 1, y: 0, z: 0 }, reach.x1], [{ x: -1, y: 0, z: 0 }, -reach.x0],
    [{ x: 0, y: 1, z: 0 }, reach.y1], [{ x: 0, y: -1, z: 0 }, -reach.y0],
    [{ x: 0, y: 0, z: 1 }, reach.z1], [{ x: 0, y: 0, z: -1 }, -reach.z0],
  );
  return { apex, d, layer, z: o.z, level: Math.abs(pitchDeg) < 1e-9, reach, planes };
}

/** How much (0..1) of square (c, r) at height layer h the cone covers. A level cone fills its start layer exactly (it
 * grows up and down from there), so that layer is measured as the square at the cone's height; any other cube through
 * the whole cube. */
function _cover(g, c, r, h) {
  const flat = g.level && h === g.layer;
  const zs = flat ? [g.z] : [h, h + 1];
  const corners = [];
  for (const x of [c, c + 1]) for (const y of [r, r + 1]) for (const z of zs) corners.push({ x, y, z });
  let allIn = true;
  for (const [a, b] of g.planes) {
    const inside = corners.filter(q => dot(a, q) <= b + 1e-9).length;
    if (!inside) return 0;              // wholly outside one side
    if (inside < corners.length) allIn = false;
  }
  if (allIn) return 1;                  // wholly inside (it's convex)
  // Cut by a side: measured by points spread evenly through the square (or the cube).
  const S = flat ? 12 : 7;
  let hit = 0;
  for (let i = 0; i < S; i++) for (let j = 0; j < S; j++) for (let k = 0; k < (flat ? 1 : S); k++) {
    const q = { x: c + (i + 0.5) / S, y: r + (j + 0.5) / S, z: flat ? g.z : h + (k + 0.5) / S };
    if (g.planes.every(([a, b]) => dot(a, q) <= b + 1e-9)) hit++;
  }
  return hit / (flat ? S * S : S * S * S);
}

function _ownCube(casterPos, n, c, r, h) {
  const z0 = Math.floor((casterPos.z || 0) / 5);
  return c >= casterPos.col && c < casterPos.col + n && r > casterPos.row - n && r <= casterPos.row && h >= z0 && h < z0 + n;
}

/** The squares to show on the map, [{x: col, y: row, z, cover, edge}]: where the cone covers its own start height or the
 * ground (a cone fired down from the air shows where it lands), at least LINE_EDGE of a square, `edge` when that's
 * LINE_FULL or less. Tilted up, only its start near the caster -- the creatures it catches higher up are ringed instead. */
export function coneSquares(casterPos, casterSize, angleDeg, lengthFt, pitchDeg = 0, start = null, grid = null) {
  const n = casterSize || 1;
  const g = coneGeometry(casterPos, n, angleDeg, lengthFt, pitchDeg, start);
  const layers = [...new Set([g.layer, 0])];
  const out = [];
  for (let c = Math.floor(g.reach.x0); c < Math.ceil(g.reach.x1); c++) {
    for (let r = Math.floor(g.reach.y0); r < Math.ceil(g.reach.y1); r++) {
      if (grid && (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows)) continue;
      for (const h of layers) {
        if (_ownCube(casterPos, n, c, r, h)) continue;
        const cover = _cover(g, c, r, h);
        if (cover >= LINE_EDGE) out.push({ x: c, y: r, z: h, cover, edge: cover <= LINE_FULL });
      }
    }
  }
  return out;
}

/** Who the cone catches: `ids` everyone (but the caster) with a cube at least LINE_EDGE inside it, `edgeIds` those of
 * them whose best-covered cube is only an edge hit (LINE_FULL or less). */
export function coneHits(session, casterId, angleDeg, lengthFt, pitchDeg = 0, start = null) {
  const board = session.board;
  const casterPos = board.tokens[casterId];
  if (!casterPos) return { ids: [], edgeIds: [] };
  const n = footprintForSize(session.participants[casterId]?.size);
  const g = coneGeometry(casterPos, n, angleDeg, lengthFt, pitchDeg, start);
  const ids = [], edgeIds = [];
  Object.entries(board.tokens).forEach(([id, pos]) => {
    if (id === casterId || !session.participants[id]) return;
    const m = footprintForSize(session.participants[id].size);
    const z0 = Math.floor((pos.z || 0) / 5);
    let best = 0;
    for (let c = pos.col; c < pos.col + m; c++) for (let r = pos.row - m + 1; r <= pos.row; r++) for (let h = z0; h < z0 + m; h++) {
      if ((h < 0 && (casterPos.z || 0) >= 0) || _ownCube(casterPos, n, c, r, h)) continue; // under the ground; the caster's
      best = Math.max(best, _cover(g, c, r, h));
    }
    if (best < LINE_EDGE) return;
    ids.push(id);
    if (best <= LINE_FULL) edgeIds.push(id);
  });
  return { ids, edgeIds };
}

/** The cone's own shape at its start height, as an SVG over the map (the squares under it are coneSquares'). */
export function coneOutlineSvg(board, casterPos, casterSize, angleDeg, lengthFt, pitchDeg = 0, start = null) {
  const { cols, rows } = board.grid;
  const g = coneGeometry(casterPos, casterSize, angleDeg, lengthFt, pitchDeg, start);
  // Its slice at height g.z: the reach box (on the map), cut by each side (Sutherland-Hodgman).
  const x0 = Math.max(0, g.reach.x0), x1 = Math.min(cols, g.reach.x1), y0 = Math.max(0, g.reach.y0), y1 = Math.min(rows, g.reach.y1);
  if (x0 >= x1 || y0 >= y1) return '';
  let poly = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  for (const [a, b0] of g.planes.slice(0, 4)) {
    const b = b0 - a.z * g.z;
    const f = ([x, y]) => a.x * x + a.y * y - b; // <= 0 inside
    const next = [];
    poly.forEach((P, i) => {
      const Q = poly[(i + 1) % poly.length];
      const fp = f(P), fq = f(Q);
      if (fp <= 0) next.push(P);
      if ((fp <= 0) !== (fq <= 0)) { const t = fp / (fp - fq); next.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t]); }
    });
    poly = next;
    if (poly.length < 3) return '';
  }
  return `<svg class="bmap-cone-outline" viewBox="0 0 ${cols} ${rows}" preserveAspectRatio="none">`
    + `<polygon points="${poly.map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`).join(' ')}"/></svg>`;
}

export function injectConeStyles() {
  if (document.getElementById('cone-area-styles')) return;
  const style = document.createElement('style');
  style.id = 'cone-area-styles';
  style.textContent = `
    .bmap-cone-outline { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 1; pointer-events: none; overflow: visible; }
    .bmap-cone-outline polygon { fill: rgba(255,150,70,0.08); stroke: rgba(255,200,130,0.95); stroke-width: 2px; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
  `;
  document.head.appendChild(style);
}
