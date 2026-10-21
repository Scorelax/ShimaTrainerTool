// What's painted where on the region map's painting, read from its colours -- for the Admin module's map marking tools
// (the user's call, 2026-10-20): a route follows the painted road between the DM's clicks, a forest (or a lake, or any
// patch of one colour) fills itself in from one click. The same reading as tools/region-map/make_terrain.py's
// classify(), so the roads and forests found here are the ones the 3D map was built from.
//
// Pure maths on pixel arrays (no DOM), so it runs the same in the browser and under Node for testing. Everything is in
// painting pixels: (x, y) from the top left, a mask a Uint8Array of W x H (1 = in).

/** The painting's pixels (RGBA, as getImageData gives them) -> the masks the tools work on:
 * { W, H, rgba, road, water, forest (the dark green of the trees), density (how much of the land round each pixel is
 * trees, 0-255) }. */
export function readFeatures(rgba, W, H) {
  const n = W * H;
  const road = new Uint8Array(n), water = new Uint8Array(n), forest = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = (mx - mn) / Math.max(mx, 1);
    const val = mx / 255;
    const d = Math.max(mx - mn, 1e-3);
    let hue = mx === r ? (((g - b) / d) % 6 + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hue *= 60;
    const isWater = hue > 185 && hue < 240 && sat > 0.35 && val > 0.2;
    water[i] = isWater ? 1 : 0;
    road[i] = val < 0.3 && hue > 0 && hue < 50 && !isWater ? 1 : 0;
    forest[i] = hue > 55 && hue < 170 && sat > 0.25 && val < 0.5 ? 1 : 0;
  }
  // the dark specks between the trees read as road too: only lines of some length are kept
  dropSmall(road, W, H, 40);
  const density = boxMean(forest, W, H, 6);
  return { W, H, rgba, road, water, forest, density };
}

/** Everything make_terrain.py's classify() reads from the colours, for building the 3D land from a new painting
 * (js/region-map/make-terrain.js): { water, white (foam, snow, white walls), cream (the name boxes), snow, red (the red
 * dots and the roofs), forest, rock, road } -- each a Uint8Array of W x H. */
export function readColours(rgba, W, H) {
  const n = W * H;
  const out = {};
  ['water', 'white', 'cream', 'snow', 'red', 'forest', 'rock', 'road'].forEach((k) => { out[k] = new Uint8Array(n); });
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = (mx - mn) / Math.max(mx, 1);
    const val = mx / 255;
    const d = Math.max(mx - mn, 1e-3);
    let hue = mx === r ? (((g - b) / d) % 6 + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hue *= 60;
    const water = hue > 185 && hue < 240 && sat > 0.35 && val > 0.2;
    const white = sat < 0.16 && val > 0.8;
    const cream = r > 200 && g > 180 && b > 140 && r - b > 18 && sat < 0.35;
    out.water[i] = water ? 1 : 0;
    out.white[i] = white ? 1 : 0;
    out.cream[i] = cream ? 1 : 0;
    out.snow[i] = white && b >= r - 6 ? 1 : 0;
    out.red[i] = r > 170 && g < 80 && b < 80 ? 1 : 0;
    out.forest[i] = hue > 55 && hue < 170 && sat > 0.25 && val < 0.5 ? 1 : 0;
    const road = val < 0.3 && hue > 0 && hue < 50 && !water;
    out.road[i] = road ? 1 : 0;
    const rock = (sat < 0.3 && val > 0.25 && !water && !cream) || (hue > 10 && hue < 45 && sat > 0.2 && sat < 0.6 && val > 0.3 && val < 0.75);
    out.rock[i] = rock ? 1 : 0;
  }
  // the tree shadows are specks: only road lines of some length are kept, and the rock is what isn't road
  dropSmall(out.road, W, H, 40);
  for (let i = 0; i < n; i++) if (out.road[i]) out.rock[i] = 0;
  return out;
}

// ---------------------------------------------------------------------------
// Mask tools
// ---------------------------------------------------------------------------

/** Each pixel's share of `mask` in the (2r+1)^2 square round it, 0-255. */
export function boxMean(mask, W, H, r) {
  const sum = integral(mask, W, H);
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1);
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(W, x + r + 1);
      const s = sum[y1 * (W + 1) + x1] - sum[y0 * (W + 1) + x1] - sum[y1 * (W + 1) + x0] + sum[y0 * (W + 1) + x0];
      out[y * W + x] = Math.round((s * 255) / ((x1 - x0) * (y1 - y0)));
    }
  }
  return out;
}

function integral(mask, W, H) {
  const sum = new Int32Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += mask[y * W + x] ? 1 : 0;
      sum[(y + 1) * (W + 1) + x + 1] = sum[y * (W + 1) + x + 1] + row;
    }
  }
  return sum;
}

/** Grown by r pixels (a square brush). */
export function dilate(mask, W, H, r) {
  const m = boxMean(mask, W, H, r);
  return m.map(v => (v > 0 ? 1 : 0));
}

/** Shrunk by r pixels. */
export function erode(mask, W, H, r) {
  const inv = mask.map(v => (v ? 0 : 1));
  return dilate(inv, W, H, r).map(v => (v ? 0 : 1));
}

/** The connected patches (4 ways round) of `mask`: a label per pixel (0 = not in it) and each label's size. */
export function components(mask, W, H) {
  const label = new Int32Array(W * H);
  const sizes = [0];
  const stack = new Int32Array(W * H);
  let next = 0;
  for (let s = 0; s < W * H; s++) {
    if (!mask[s] || label[s]) continue;
    next++;
    let top = 0, size = 0;
    stack[top++] = s;
    label[s] = next;
    while (top) {
      const i = stack[--top];
      size++;
      const x = i % W;
      if (x > 0 && mask[i - 1] && !label[i - 1]) { label[i - 1] = next; stack[top++] = i - 1; }
      if (x < W - 1 && mask[i + 1] && !label[i + 1]) { label[i + 1] = next; stack[top++] = i + 1; }
      if (i >= W && mask[i - W] && !label[i - W]) { label[i - W] = next; stack[top++] = i - W; }
      if (i < W * (H - 1) && mask[i + W] && !label[i + W]) { label[i + W] = next; stack[top++] = i + W; }
    }
    sizes.push(size);
  }
  return { label, sizes };
}

/** Patches smaller than `min` pixels taken out (in place). */
export function dropSmall(mask, W, H, min) {
  const { label, sizes } = components(mask, W, H);
  for (let i = 0; i < mask.length; i++) if (mask[i] && sizes[label[i]] < min) mask[i] = 0;
  return mask;
}

/** Holes smaller than `max` pixels filled (in place) -- a clearing in the middle of a forest stays a hole. */
export function fillHoles(mask, W, H, max) {
  const inv = mask.map(v => (v ? 0 : 1));
  const { label, sizes } = components(inv, W, H);
  for (let i = 0; i < mask.length; i++) if (inv[i] && sizes[label[i]] < max) mask[i] = 1;
  return mask;
}

/** The patch of `mask` that (x, y) is in (an empty mask if it's not in any). */
export function floodFrom(mask, W, H, x, y) {
  const out = new Uint8Array(W * H);
  const s = Math.round(y) * W + Math.round(x);
  if (!mask[s]) return out;
  const stack = new Int32Array(W * H);
  let top = 0;
  stack[top++] = s;
  out[s] = 1;
  while (top) {
    const i = stack[--top];
    const px = i % W;
    if (px > 0 && mask[i - 1] && !out[i - 1]) { out[i - 1] = 1; stack[top++] = i - 1; }
    if (px < W - 1 && mask[i + 1] && !out[i + 1]) { out[i + 1] = 1; stack[top++] = i + 1; }
    if (i >= W && mask[i - W] && !out[i - W]) { out[i - W] = 1; stack[top++] = i - W; }
    if (i < W * (H - 1) && mask[i + W] && !out[i + W]) { out[i + W] = 1; stack[top++] = i + W; }
  }
  return out;
}

/** A round brush stroke of radius r at (x, y): set to `value` in the mask (in place) -- only where `allow` is 1, when
 * it's given (a region's brush keeps to the land). */
export function stamp(mask, W, H, x, y, r, value, allow = null) {
  const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(W - 1, Math.ceil(x + r));
  const y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(H - 1, Math.ceil(y + r));
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      if ((px + 0.5 - x) ** 2 + (py + 0.5 - y) ** 2 <= r * r && (!allow || allow[py * W + px])) mask[py * W + px] = value;
    }
  }
}

// ---------------------------------------------------------------------------
// The wand: one click -> the patch it's in
// ---------------------------------------------------------------------------

/** The area round a click: the forest it's in (where the trees are thick), the water it's in, or else the patch of
 * much the same colour (`tolerance` 0-100). -> { mask, kind: 'forest' | 'water' | 'colour', size }. */
export function wandAt(f, x, y, tolerance = 30) {
  const { W, H } = f;
  const i = Math.round(y) * W + Math.round(x);
  let kind, region;
  if (f.density[i] >= 70) {
    kind = 'forest';
    region = floodFrom(f.density.map(v => (v >= 70 ? 1 : 0)), W, H, x, y);
    region = erode(dilate(region, W, H, 3), W, H, 3);
  } else if (f.water[i]) {
    kind = 'water';
    // the lake (or bay) without the rivers running out of it: thin water cut off first, then grown back to the shore
    const thick = erode(f.water, W, H, 2);
    const core = thick[i] ? floodFrom(thick, W, H, x, y) : floodFrom(f.water, W, H, x, y);
    region = thick[i] ? dilate(core, W, H, 3).map((v, j) => v & f.water[j]) : core;
  } else {
    kind = 'colour';
    region = floodFrom(similarColour(f, x, y, tolerance), W, H, x, y);
    region = erode(dilate(region, W, H, 2), W, H, 2);
  }
  fillHoles(region, W, H, 600);
  return { mask: region, kind, size: region.reduce((a, v) => a + v, 0) };
}

/** The sea: the open water that reaches the painting's edge (the user's call, 2026-10-21: a region is the land in it,
 * never the sea) -- not a lake or a river inland, which are part of the land a region covers. Rivers are thinned away
 * first so the sea doesn't run up them. Worked out once per painting (kept on `f`). */
export function seaOf(f) {
  if (f.sea) return f.sea;
  const { W, H } = f;
  const open = dilate(erode(f.water, W, H, 3), W, H, 3);
  const { label } = components(open, W, H);
  const edge = new Set();
  for (let x = 0; x < W; x++) { edge.add(label[x]); edge.add(label[(H - 1) * W + x]); }
  for (let y = 0; y < H; y++) { edge.add(label[y * W]); edge.add(label[y * W + W - 1]); }
  edge.delete(0);
  const sea = new Uint8Array(W * H);
  for (let i = 0; i < sea.length; i++) if (edge.has(label[i])) sea[i] = 1;
  f.sea = sea;
  return sea;
}

/** The land round a click that's still free (`free`: 1 = land not in another region): all of it reached from there
 * without crossing the sea or another region -- the roads and the painting's lines don't matter (the user's call,
 * 2026-10-21: they never closed a region in). -> { mask, size } (empty when the click isn't on free land). */
export function freeLandAt(free, W, H, x, y) {
  const mask = floodFrom(free, W, H, x, y);
  return { mask, size: mask.reduce((a, v) => a + v, 0) };
}

/** Where the colour (a little blurred, so the painting's brushwork doesn't break it up) is close to the click's. */
function similarColour(f, x, y, tolerance) {
  const { W, H, rgba } = f;
  const ch = [0, 1, 2].map((c) => {
    const one = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) one[i] = rgba[i * 4 + c];
    return blur(one, W, H, 2);
  });
  const i0 = Math.round(y) * W + Math.round(x);
  const lim = (8 + tolerance * 1.2) ** 2;
  const out = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const dr = ch[0][i] - ch[0][i0], dg = ch[1][i] - ch[1][i0], db = ch[2][i] - ch[2][i0];
    out[i] = dr * dr + dg * dg + db * db <= lim ? 1 : 0;
  }
  return out;
}

function blur(chan, W, H, r) {
  const sum = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += chan[y * W + x];
      sum[(y + 1) * (W + 1) + x + 1] = sum[y * (W + 1) + x + 1] + row;
    }
  }
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1);
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(W, x + r + 1);
      out[y * W + x] = (sum[y1 * (W + 1) + x1] - sum[y0 * (W + 1) + x1] - sum[y1 * (W + 1) + x0] + sum[y0 * (W + 1) + x0]) / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Roads: the way along the painted road between two clicks
// ---------------------------------------------------------------------------

/** The nearest road pixel to (x, y) within `r` pixels (or the point itself). */
export function snapToRoad(f, x, y, r = 10) {
  const { W, H, road } = f;
  let best = null, bestD = Infinity;
  for (let py = Math.max(0, Math.round(y) - r); py <= Math.min(H - 1, Math.round(y) + r); py++) {
    for (let px = Math.max(0, Math.round(x) - r); px <= Math.min(W - 1, Math.round(x) + r); px++) {
      if (!road[py * W + px]) continue;
      const d = (px - x) ** 2 + (py - y) ** 2;
      if (d < bestD) { bestD = d; best = [px, py]; }
    }
  }
  return best && bestD <= r * r ? best : [Math.round(x), Math.round(y)];
}

/** The cheapest way from a to b ([x, y] each), keeping to the painted roads where it can (off a road costs 10 times
 * as much, over water 40 times) -> [[x, y], ...] (simplified), or a straight line when there's no road to follow
 * (`follow` false). */
export function tracePath(f, a, b, { follow = true } = {}) {
  if (!follow) return [a, b];
  const { W, H, road, water } = f;
  // only searched in a box round the two ends -- a road can wander, so with room to spare
  const pad = 120 + Math.hypot(a[0] - b[0], a[1] - b[1]) * 0.35;
  const bx0 = Math.max(0, Math.floor(Math.min(a[0], b[0]) - pad)), bx1 = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0]) + pad));
  const by0 = Math.max(0, Math.floor(Math.min(a[1], b[1]) - pad)), by1 = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1]) + pad));
  const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
  const idx = (x, y) => (y - by0) * bw + (x - bx0);
  const cost = (x, y) => { const i = y * W + x; return road[i] ? 1 : water[i] ? 40 : 10; };
  const g = new Float32Array(bw * bh).fill(Infinity);
  const from = new Int32Array(bw * bh).fill(-1);
  const closed = new Uint8Array(bw * bh);
  const heap = new MinHeap();
  const [ax, ay] = a.map(Math.round), [tx, ty] = b.map(Math.round);
  const h = (x, y) => Math.hypot(x - tx, y - ty);
  g[idx(ax, ay)] = 0;
  heap.push(idx(ax, ay), h(ax, ay));
  const goal = idx(tx, ty);
  const steps = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  while (heap.size) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goal) break;
    const cx = (cur % bw) + bx0, cy = Math.floor(cur / bw) + by0;
    for (const [dx, dy, len] of steps) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < bx0 || nx > bx1 || ny < by0 || ny > by1) continue;
      const ni = idx(nx, ny);
      if (closed[ni]) continue;
      const ng = g[cur] + len * (cost(cx, cy) + cost(nx, ny)) / 2;
      if (ng < g[ni]) { g[ni] = ng; from[ni] = cur; heap.push(ni, ng + h(nx, ny)); }
    }
  }
  if (from[goal] < 0 && goal !== idx(ax, ay)) return [a, b];
  const pts = [];
  for (let i = goal; i >= 0; i = from[i]) pts.push([(i % bw) + bx0, Math.floor(i / bw) + by0]);
  pts.reverse();
  return simplify(pts, 0.9);
}

class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const { k, v } = this;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (v[p] <= val) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const { k, v } = this;
    const top = k[0];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= k.length) break;
        if (c + 1 < k.length && v[c + 1] < v[c]) c++;
        if (v[c] >= lv) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

// ---------------------------------------------------------------------------
// Shapes: a mask <-> its outlines (what's kept -- a few hundred points instead of a picture, and they can be moved onto
// a new version of the map)
// ---------------------------------------------------------------------------

/** Douglas-Peucker: the points that matter for a line, within `eps` pixels. */
export function simplify(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    const [x1, y1] = pts[s], [x2, y2] = pts[e];
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    let best = -1, bestD = eps;
    for (let i = s + 1; i < e; i++) {
      const d = Math.abs((x2 - x1) * (y1 - pts[i][1]) - (x1 - pts[i][0]) * (y2 - y1)) / len;
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best > 0) { keep[best] = 1; stack.push([s, best], [best, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** The outlines of a mask: closed rings of [x, y] on the pixels' corners (holes run the other way round), simplified
 * within `eps` pixels; rings round less than `minArea` pixels left out. */
export function maskToRings(mask, W, H, { eps = 1.1, minArea = 30 } = {}) {
  const at = (x, y) => (x >= 0 && y >= 0 && x < W && y < H ? mask[y * W + x] : 0);
  // every pixel side between in and out, as an edge going round with the inside on its right (y down)
  const next = new Map();   // corner -> the corners its edges go to
  const key = (x, y) => y * (W + 1) + x;
  const add = (x1, y1, x2, y2) => {
    const k = key(x1, y1);
    const list = next.get(k);
    if (list) list.push(key(x2, y2)); else next.set(k, [key(x2, y2)]);
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!mask[y * W + x]) continue;
      if (!at(x, y - 1)) add(x, y, x + 1, y);
      if (!at(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!at(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!at(x - 1, y)) add(x, y + 1, x, y);
    }
  }
  const rings = [];
  for (const [start, list] of next) {
    while (list.length) {
      const ring = [];
      let k = start;
      // every corner has as many edges in as out, so the walk always comes back round to where it started
      do {
        ring.push([k % (W + 1), Math.floor(k / (W + 1))]);
        k = next.get(k).pop();
      } while (k !== start);
      if (ring.length < 4) continue;
      if (Math.abs(ringArea(ring)) < minArea) continue;
      const s = simplifyRing(ring, eps);
      if (s.length >= 3) rings.push(s);
    }
  }
  return rings;
}

/** A closed ring simplified: as two lines, from its first point to the point farthest from it and back round (one line
 * from a point to itself has no length to measure the others against). */
function simplifyRing(ring, eps) {
  let far = 0, farD = -1;
  ring.forEach((p, i) => { const d = (p[0] - ring[0][0]) ** 2 + (p[1] - ring[0][1]) ** 2; if (d > farD) { farD = d; far = i; } });
  const a = simplify(ring.slice(0, far + 1), eps);
  const b = simplify([...ring.slice(far), ring[0]], eps);
  return [...a, ...b.slice(1, -1)];
}

/** Signed area (positive: clockwise on the screen). */
export function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** Rings -> a mask (even-odd, so the holes stay holes). */
export function ringsToMask(rings, W, H) {
  const mask = new Uint8Array(W * H);
  const edges = [];
  rings.forEach(r => r.forEach((p, i) => { const q = r[(i + 1) % r.length]; if (p[1] !== q[1]) edges.push([p[0], p[1], q[0], q[1]]); }));
  const xs = [];
  for (let y = 0; y < H; y++) {
    const cy = y + 0.5;
    xs.length = 0;
    for (const [x1, y1, x2, y2] of edges) {
      if ((y1 <= cy) !== (y2 <= cy)) xs.push(x1 + ((cy - y1) / (y2 - y1)) * (x2 - x1));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const x0 = Math.max(0, Math.ceil(xs[i] - 0.5)), x1 = Math.min(W - 1, Math.floor(xs[i + 1] - 0.5));
      for (let x = x0; x <= x1; x++) mask[y * W + x] = 1;
    }
  }
  return mask;
}

/** Where a shape is: its box and its middle (for the camera to fly to and a name to sit on), in painting pixels. */
export function shapeBounds(shape) {
  const pts = !shape ? [] : shape.kind === 'pin' ? [[shape.x, shape.y]] : shape.kind === 'path' ? shape.points || [] : (shape.rings || []).flat();
  if (!pts.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  pts.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); });
  let mid = [(x0 + x1) / 2, (y0 + y1) / 2];
  if (shape.kind === 'path' && pts.length > 1) mid = alongPath(pts, 0.5);
  if (shape.kind === 'area') mid = areaMiddle(shape.rings) || mid;
  return { x0, y0, x1, y1, mid };
}

/** Where a location's icon stands (the user's call, 2026-10-20: the icon and the mark go together, never placed
 * apart): its mark's middle -- the spot of a town, halfway along a route, well inside a forest -- where its name goes
 * too. null: not on the map (nor its icon then). */
export function iconSpot(shape) {
  return shapeBounds(shape)?.mid || null;
}

/** The point `t` (0-1) of the way along a line. */
export function alongPath(pts, t) {
  const lens = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  let left = lens.reduce((a, b) => a + b, 0) * t;
  for (let i = 0; i < lens.length; i++) {
    if (left <= lens[i]) { const k = lens[i] ? left / lens[i] : 0; return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k]; }
    left -= lens[i];
  }
  return pts[pts.length - 1].slice();
}

/** A point well inside an area (the middle of its widest stretch on the row through its centre) -- the middle of the
 * box can fall outside a curved forest. */
function areaMiddle(rings) {
  if (!rings?.length) return null;
  const big = rings.reduce((a, r) => (Math.abs(ringArea(r)) > Math.abs(ringArea(a)) ? r : a));
  let y0 = Infinity, y1 = -Infinity;
  big.forEach(p => { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); });
  let best = null;
  for (const t of [0.5, 0.4, 0.6, 0.3, 0.7]) {
    const cy = y0 + (y1 - y0) * t + 0.01;
    const xs = [];
    rings.forEach(r => r.forEach((p, i) => { const q = r[(i + 1) % r.length]; if ((p[1] <= cy) !== (q[1] <= cy)) xs.push(p[0] + ((cy - p[1]) / (q[1] - p[1])) * (q[0] - p[0])); }));
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const w = xs[i + 1] - xs[i];
      if (!best || w > best.w) best = { w, at: [(xs[i] + xs[i + 1]) / 2, cy] };
    }
    if (best && best.w > 20) break;
  }
  return best?.at || null;
}

/** Whether (x, y) is inside the outlines (even-odd: inside a hole is out). */
export function pointInRings(rings, x, y) {
  let inside = false;
  for (const r of rings || []) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Points along a shape's line or outline, at most `step` pixels apart (a spot is its one point). */
function samplePoints(shape, step = 8) {
  if (!shape) return [];
  if (shape.kind === 'pin') return [[shape.x, shape.y]];
  const lines = shape.kind === 'path' ? [shape.points || []] : (shape.rings || []).map(r => [...r, r[0]]);
  const out = [];
  lines.forEach(pts => pts.forEach((p, i) => {
    if (!i) { out.push(p); return; }
    const q = pts[i - 1];
    const n = Math.max(1, Math.ceil(Math.hypot(p[0] - q[0], p[1] - q[1]) / step));
    for (let k = 1; k <= n; k++) out.push([q[0] + ((p[0] - q[0]) * k) / n, q[1] + ((p[1] - q[1]) * k) / n]);
  }));
  return out;
}

/** How far apart two shapes are at their nearest, in painting pixels: 0 when they touch or one is inside the other (a
 * city inside a forest, a route running into a town). Infinity when either isn't on the map. */
export function shapeDistance(a, b) {
  const pa = samplePoints(a), pb = samplePoints(b);
  if (!pa.length || !pb.length) return Infinity;
  if (a.kind === 'area' && pb.some(([x, y]) => pointInRings(a.rings, x, y))) return 0;
  if (b.kind === 'area' && pa.some(([x, y]) => pointInRings(b.rings, x, y))) return 0;
  let best = Infinity;
  for (const p of pa) {
    for (const q of pb) {
      const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}
