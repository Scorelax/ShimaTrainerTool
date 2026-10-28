// Which painting the region map is made from (the user's call, 2026-10-20): Shima's map isn't finished, so the DM can
// upload a new painting from the Admin module's Locations tab (js/dm/map-upload.js) -- lined up with the one in use by a
// few landmarks, its 3D land built in the browser (make-terrain.js) -- and go back to an older one at any time. Every
// location's shape is moved onto whichever map is in use, so what's marked on one stays where it is on the next.
//
// Kept in the 'region-map' state (with townsSeeded, admin-world.js):
//   current   the id of the map in use (none: the first one, the files in assets/)
//   versions  [{ id, name, at (when it was made), W, H (its painting's pixels -- the locations' coordinates while it's
//             in use), kmPerPx, toBase (the affine [a, b, c, d, e, f] from its pixels to the first painting's: x' = ax +
//             by + c, y' = dx + ey + f), files: { painting, height, topo, painted, shade (a map built from regions: the
//             light on its land, region-detail.js) } (URLs on the Pi), places: { seaOffset,
//             scale, towns, spots, water } (as places.json),
//             frame: { painting } (a map built from regions: its painting before any region was pasted on),
//             regions: [{ id, name, file (its whole painting on the Pi, a WebP), W, H, toMap (the affine from its pixels to
//             the map's), at }] (js/dm/map-upload.js's buildRegions, the user's call, 2026-10-28),
//             borders: [[[x, y], ...], ...] (the lines between those regions, in its pixels: region-borders.js) }]
// Every map knows where it sits on the first one (toBase), so going from any map to any other is one transform
// (between()), and going back puts the shapes back where they were -- the locations' icons too (their spot moves, their
// size is in km).
import { DmAPI } from '../api.js';

export const FIRST_ID = 'original';

/** The map the 3D region map was first made with (tools/region-map/make_terrain.py, the files in assets/). */
export const FIRST_MAP = Object.freeze({
  id: FIRST_ID, name: 'The first map', at: '', W: 941, H: 1672, kmPerPx: 0.12, toBase: [1, 0, 0, 0, 1, 0],
  files: {
    painting: 'assets/Shiman Federation.png',
    height: 'assets/region-map/height.png',
    topo: 'assets/region-map/topo.jpg',
    painted: 'assets/region-map/painted.jpg',
  },
  places: null,  // assets/region-map/places.json, loaded with it
});

let _state = null;     // the 'region-map' state's promise
let _places = null;    // places.json's promise
let _now = FIRST_MAP;  // the last map in use known here (for kmPerPx(), which can't wait)

// The DM switched maps (here or in another console tab): asked again next time.
if (typeof window !== 'undefined') {
  window.addEventListener('app:dm-state', (e) => { if (e.detail?.key === 'region-map') _state = null; });
  window.addEventListener('app:live-resync', () => { _state = null; });
}

/** The 'region-map' state ({ townsSeeded, current, versions }), fetched once until it changes. Not reached: thrown,
 * and asked again next time. */
export function loadMapState({ fresh = false } = {}) {
  if (fresh) _state = null;
  if (!_state) {
    _state = DmAPI.getState('region-map').then(s => ({ versions: [], ...(s || {}) }));
    _state.catch(() => { _state = null; });
  }
  return _state;
}

function firstPlaces() {
  if (!_places) {
    _places = fetch('assets/region-map/places.json').then((r) => { if (!r.ok) throw new Error("Couldn't load the map's places"); return r.json(); });
    _places.catch(() => { _places = null; });
  }
  return _places;
}

/** Every map there is, the first one first, each with its places. */
export async function allMaps(state) {
  const s = state || await loadMapState();
  return [{ ...FIRST_MAP, places: await firstPlaces() }, ...(s.versions || [])];
}

/** The map in use, with its places. The 'region-map' state not reached: the first map (what the board showed before
 * there were others). */
export async function currentMap({ fresh = false } = {}) {
  let s = null;
  try { s = await loadMapState({ fresh }); } catch (err) { /* the first map */ }
  const v = s?.current && s.versions?.find(x => x.id === s.current);
  _now = v || { ...FIRST_MAP, places: await firstPlaces() };
  return _now;
}

/** A major location (the user's call, 2026-10-20): its name shows on the map with the whole island in view; the others'
 * come in as it zooms in. Ticked by the DM on the location -- until then a city is, the rest aren't. */
export const isMajor = l => (typeof l?.major === 'boolean' ? l.major : ['city', 'region'].includes(l?.type || 'city'));

// A location inside another (the user's call, 2026-10-20: a sawmill in Inex Woods, with its own mark and icon): it keeps
// the id of the one it's part of (`parentId`; '' = picked "not part of another", missing = never set -- then marking it
// inside a forest puts it there, admin-world.js). Listed under it in Admin and the PokéNav; picked on the PokéNav map,
// the outline of what it's part of is lit with it.

/** The location `l` is part of (null: none, or that one's gone). */
export function parentOf(l, all) {
  const p = l?.parentId && all.find(x => x.id === l.parentId);
  return p && p !== l ? p : null;
}

/** `l` and the locations it's part of, itself first (stops at a loop). */
export function partOfChain(l, all) {
  const out = [];
  for (let x = l; x && !out.includes(x) && out.length < 12; x = parentOf(x, all)) out.push(x);
  return out;
}

/** Whether `l` is listed at the top: part of nothing (or of a loop of them, never hidden). */
export function isTopLocation(l, all) {
  const chain = partOfChain(l, all);
  return chain.length === 1 || !!parentOf(chain[chain.length - 1], all);
}

/** `tops` (in order) each followed by what's inside it, by name, nested -> [{ l, depth }]. `folded`: the ids of the
 * ones folded up (what's inside them left out). */
export function withInside(tops, all, folded = null) {
  const out = [];
  const seen = new Set();
  const walk = (l, depth) => {
    if (seen.has(l.id)) return;
    seen.add(l.id);
    out.push({ l, depth });
    if (folded?.has(l.id)) return;
    all.filter(x => parentOf(x, all) === l).sort((a, b) => String(a.name).localeCompare(String(b.name))).forEach(x => walk(x, depth + 1));
  };
  tops.forEach(l => walk(l, 0));
  return out;
}

/** How many km one pixel of the map in use is (the last one loaded). */
export const kmPerPx = () => _now.kmPerPx || 0.12;

// ---------------------------------------------------------------------------
// Transforms: [a, b, c, d, e, f] -> x' = a x + b y + c, y' = d x + e y + f
// ---------------------------------------------------------------------------

export const IDENTITY = [1, 0, 0, 0, 1, 0];

/** m2 after m1. */
export function compose(m2, m1) {
  const [a, b, c, d, e, f] = m1;
  const [A, B, C, D, E, F] = m2;
  return [A * a + B * d, A * b + B * e, A * c + B * f + C, D * a + E * d, D * b + E * e, D * c + E * f + F];
}

export function invert(m) {
  const [a, b, c, d, e, f] = m;
  const det = a * e - b * d;
  return [e / det, -b / det, (b * f - c * e) / det, -d / det, a / det, (c * d - a * f) / det];
}

export const apply = (m, x, y) => [m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5]];

/** How much bigger a length gets. */
export const scaleOf = m => Math.sqrt(Math.abs(m[0] * m[4] - m[1] * m[3]));

/** From one map's pixels to another's. */
export const between = (from, to) => compose(invert(to.toBase || IDENTITY), from.toBase || IDENTITY);

/** A location's shape moved by `m` (a new object; points kept to a tenth of a pixel). */
export function transformShape(shape, m) {
  if (!shape) return shape;
  const r = v => Math.round(v * 10) / 10;
  const pt = ([x, y]) => apply(m, x, y).map(r);
  if (shape.kind === 'pin') { const [x, y] = pt([shape.x, shape.y]); return { ...shape, x, y }; }
  if (shape.kind === 'path') return { ...shape, anchors: shape.anchors?.map(pt), points: (shape.points || []).map(pt) };
  if (shape.kind === 'area') return { ...shape, rings: (shape.rings || []).map(ring => ring.map(pt)), ...(shape.reach ? { reach: shape.reach.map(ring => ring.map(pt)) } : {}) };
  return shape;
}

/** A location's icon on the map ({url, x, y, size}) moved by `m`: its spot only -- its size is in km, the same on
 * every map. */
export function transformIcon(icon, m) {
  if (!icon || !Number.isFinite(icon.x)) return icon;
  const [x, y] = apply(m, icon.x, icon.y).map(v => Math.round(v * 10) / 10);
  return { ...icon, x, y };
}

/** The turn, size and shift that best lay the `from` points onto the `to` points (least squares; nothing sheared or
 * stretched one way only) -> { m, error (the points' average miss, in `to` pixels) }. Needs two pairs or more. */
export function fitSimilarity(from, to) {
  const n = Math.min(from.length, to.length);
  if (n < 2) return null;
  let mx = 0, my = 0, nx = 0, ny = 0;
  for (let i = 0; i < n; i++) { mx += from[i][0]; my += from[i][1]; nx += to[i][0]; ny += to[i][1]; }
  mx /= n; my /= n; nx /= n; ny /= n;
  let sxx = 0, sa = 0, sb = 0;
  for (let i = 0; i < n; i++) {
    const x = from[i][0] - mx, y = from[i][1] - my, u = to[i][0] - nx, v = to[i][1] - ny;
    sxx += x * x + y * y;
    sa += x * u + y * v;
    sb += x * v - y * u;
  }
  if (sxx < 1e-6) return null;
  const a = sa / sxx, b = sb / sxx;
  const m = [a, -b, nx - (a * mx - b * my), b, a, ny - (b * mx + a * my)];
  let miss = 0;
  for (let i = 0; i < n; i++) { const [x, y] = apply(m, from[i][0], from[i][1]); miss += Math.hypot(x - to[i][0], y - to[i][1]); }
  return { m, error: miss / n };
}
