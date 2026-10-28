// The 3D region map's terrain made from a painting, in the browser (the user's call, 2026-10-20: a new version of the
// map uploaded from the Admin module gets its own land, not just a new picture). The same steps as
// tools/region-map/make_terrain.py, which made the first one on a PC with numpy -- ported to plain typed arrays so the
// DM's own computer does the work and the Pi only stores what comes out:
//   height  the height map: R = high byte, G = low byte of the height in metres (+ SEA_OFFSET), B = what's there
//           (0 sea, 1 land, 2 lake, 3 river) -- the painting's size
//   topo    the topographic picture (SCALE x): coloured by height, shaded, the lake, the rivers, the coast and the
//           painting's dark lines -- the region borders (the user's call, 2026-10-28: they're borders, not roads, and
//           drawn black; the code still calls them `road`)
//   shade   the light on the land (SCALE x, 0-255), for the painted picture (paintTexture)
//   lines   those lines (the painting's size, 1 on one), so paintTexture draws them black on the painted picture too
//   places  the spots (the painting's red dots) and the names on the water, plus the towns it was given
// Its noise isn't numpy's, so a painting built here gets slightly different rough peaks than the PC script gave it.
//
// Pure maths on arrays (no DOM), so it runs the same under Node for testing.
import { readColours, components } from './map-features.js';

export const SEA_OFFSET = 1000;

const tick = () => new Promise(r => setTimeout(r, 0));

// ---------------------------------------------------------------------------
// The building blocks (scipy.ndimage's, as make_terrain.py used them)
// ---------------------------------------------------------------------------

const reflect = (i, n) => {
  // scipy's 'reflect': d c b a | a b c d | d c b a
  for (;;) {
    if (i < 0) i = -i - 1;
    else if (i >= n) i = 2 * n - i - 1;
    else return i;
  }
};

/** A Gaussian blur (as ndi.gaussian_filter: truncated at 4 sigma, edges mirrored). */
export function gaussian(src, W, H, sigma) {
  const r = Math.max(1, Math.ceil(4 * sigma));
  const k = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); sum += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
  const xi = new Int32Array(W + 2 * r), yi = new Int32Array(H + 2 * r);
  for (let i = 0; i < xi.length; i++) xi[i] = reflect(i - r, W);
  for (let i = 0; i < yi.length; i++) yi[i] = reflect(i - r, H);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let j = 0; j < k.length; j++) s += src[row + xi[x + j]] * k[j];
      tmp[row + x] = s;
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let j = 0; j < k.length; j++) s += tmp[yi[y + j] * W + x] * k[j];
      out[y * W + x] = s;
    }
  }
  return out;
}

const toFloat = m => Float32Array.from(m, v => (v ? 1 : 0));

/** The straight-line distance from each pixel of `mask` to the nearest pixel outside it (as
 * ndi.distance_transform_edt; 0 outside the mask) -- and with `indices`, which pixel that is. Felzenszwalb's exact
 * method: a pass down the columns, then along the rows. */
export function edt(mask, W, H, { indices = false } = {}) {
  const INF = 1e20;
  const n = Math.max(W, H);
  const f = new Float64Array(n), d = new Float64Array(n), z = new Float64Array(n + 1);
  const v = new Int32Array(n), arg = new Int32Array(n);
  const g = new Float64Array(W * H);         // squared distances, columns first
  const gi = indices ? new Int32Array(W * H) : null;   // ...and the row of the nearest one
  const pass = (len, get, set) => {
    // the lower envelope of parabolas: the 1-D squared distance transform of f
    let k = 0;
    v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s;
      for (;;) {
        const p = v[k];
        s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p);
        if (s <= z[k] && k > 0) k--; else break;
      }
      if (s <= z[k]) { v[0] = q; z[0] = -INF; z[1] = INF; k = 0; continue; }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
      arg[q] = v[k];
    }
    for (let q = 0; q < len; q++) set(q, d[q], arg[q]);
    void get;
  };
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = mask[y * W + x] ? INF : 0;
    pass(H, null, (y, dist, a) => { g[y * W + x] = dist; if (gi) gi[y * W + x] = a; });
  }
  const out = new Float32Array(W * H);
  const idx = indices ? new Int32Array(W * H) : null;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) f[x] = g[y * W + x];
    pass(W, null, (x, dist, a) => {
      out[y * W + x] = Math.sqrt(Math.min(dist, INF));
      if (idx) idx[y * W + x] = gi[y * W + a] * W + a;
    });
  }
  return indices ? { dist: out, nearest: idx } : out;
}

/** The city-block distance from each pixel to the nearest one of `mask` (0 on it). `edgeIsMask`: past the picture's
 * edge counts as the mask too. Two passes -- exact for this distance. */
function cityBlock(mask, W, H, edgeIsMask = false) {
  const BIG = 1e9;
  const d = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      d[i] = mask[i] ? 0 : edgeIsMask ? Math.min(x + 1, y + 1, W - x, H - y) : BIG;
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (x > 0 && d[i - 1] + 1 < d[i]) d[i] = d[i - 1] + 1;
      if (y > 0 && d[i - W] + 1 < d[i]) d[i] = d[i - W] + 1;
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x;
      if (x < W - 1 && d[i + 1] + 1 < d[i]) d[i] = d[i + 1] + 1;
      if (y < H - 1 && d[i + W] + 1 < d[i]) d[i] = d[i + W] + 1;
    }
  }
  return d;
}

// ndi.binary_dilation / erosion with the default cross and `n` iterations (outside the picture counts as empty)
const dilate = (m, W, H, n) => cityBlock(m, W, H).map(v => (v <= n ? 1 : 0));
const erode = (m, W, H, n) => cityBlock(m.map(v => (v ? 0 : 1)), W, H, true).map(v => (v > n ? 1 : 0));
const closing = (m, W, H, n) => erode(dilate(m, W, H, n), W, H, n);
const opening = (m, W, H, n) => dilate(erode(m, W, H, n), W, H, n);
const and = (a, b) => a.map((v, i) => (v && b[i] ? 1 : 0));
const or = (a, b) => a.map((v, i) => (v || b[i] ? 1 : 0));
const not = a => a.map(v => (v ? 0 : 1));

/** Every patch of a mask: its pixels' count, box and middle. */
function patches(mask, W, H) {
  const { label, sizes } = components(mask, W, H);
  const info = sizes.map(() => ({ area: 0, x0: Infinity, y0: Infinity, x1: -1, y1: -1, sx: 0, sy: 0 }));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const l = label[y * W + x];
      if (!l) continue;
      const p = info[l];
      p.area++; p.sx += x; p.sy += y;
      if (x < p.x0) p.x0 = x; if (x > p.x1) p.x1 = x;
      if (y < p.y0) p.y0 = y; if (y > p.y1) p.y1 = y;
    }
  }
  return { label, list: info.slice(1).map((p, i) => ({ ...p, id: i + 1, w: p.x1 - p.x0 + 1, h: p.y1 - p.y0 + 1, cx: p.sx / p.area, cy: p.sy / p.area })) };
}

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** A seeded random number generator (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cubic = (p0, p1, p2, p3, t) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));

/** Smooth value noise in layers, 0..1 (ridged: sharp crests, for the mountains). */
function fractal(W, H, random, scales, ridged = false) {
  const total = new Float32Array(W * H);
  let ampSum = 0;
  scales.forEach((s, i) => {
    const gw = Math.floor(W / s) + 3, gh = Math.floor(H / s) + 3;
    const grid = new Float32Array(gw * gh).map(() => random());
    const at = (gx, gy) => grid[Math.min(gh - 1, Math.max(0, gy)) * gw + Math.min(gw - 1, Math.max(0, gx))];
    const amp = 0.55 ** i;
    for (let y = 0; y < H; y++) {
      const fy = y / s, iy = Math.floor(fy), ty = fy - iy;
      for (let x = 0; x < W; x++) {
        const fx = x / s, ix = Math.floor(fx), tx = fx - ix;
        const rows = [-1, 0, 1, 2].map(dy => cubic(at(ix - 1, iy + dy), at(ix, iy + dy), at(ix + 1, iy + dy), at(ix + 2, iy + dy), tx));
        let v = cubic(rows[0], rows[1], rows[2], rows[3], ty);
        if (ridged) { v = 1 - Math.abs(v * 2 - 1); v *= v; }
        total[y * W + x] += v * amp;
      }
    }
    ampSum += amp;
  });
  for (let i = 0; i < total.length; i++) total[i] = Math.min(1, Math.max(0, total[i] / ampSum));
  return total;
}

/** A value of `src` (W x H) at a fractional pixel: bicubic (`smooth`) or bilinear. */
function sampler(src, W, H, smooth) {
  const at = (x, y) => src[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];
  return (fx, fy) => {
    const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    if (!smooth) return (at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx) * (1 - ty) + (at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx) * ty;
    const r = [-1, 0, 1, 2].map(dy => cubic(at(ix - 1, iy + dy), at(ix, iy + dy), at(ix + 1, iy + dy), at(ix + 2, iy + dy), tx));
    return cubic(r[0], r[1], r[2], r[3], ty);
  };
}

const TOPO_STOPS = [[-1000, [24, 62, 112]], [-300, [38, 88, 146]], [-60, [70, 132, 186]], [-8, [132, 186, 220]], [0, [160, 205, 228]],
  [3, [122, 160, 98]], [150, [150, 182, 112]], [400, [206, 204, 142]], [800, [196, 166, 116]],
  [1300, [164, 126, 92]], [1800, [150, 138, 130]], [2300, [238, 238, 240]], [3200, [255, 255, 255]]];

function topoColour(h, out) {
  const s = TOPO_STOPS;
  if (h <= s[0][0]) { out[0] = s[0][1][0]; out[1] = s[0][1][1]; out[2] = s[0][1][2]; return; }
  for (let i = 1; i < s.length; i++) {
    if (h <= s[i][0]) {
      const t = (h - s[i - 1][0]) / (s[i][0] - s[i - 1][0]);
      for (let c = 0; c < 3; c++) out[c] = s[i - 1][1][c] + (s[i][1][c] - s[i - 1][1][c]) * t;
      return;
    }
  }
  const last = s[s.length - 1][1];
  out[0] = last[0]; out[1] = last[1]; out[2] = last[2];
}

// ---------------------------------------------------------------------------
// The land
// ---------------------------------------------------------------------------

/** The terrain from a painting's pixels (RGBA, W x H). Options: towns [[x, y]] (kept low and even -- their buildings
 * would read as rock), water [{name, x, y}] (names written on the sea), k (how many of this painting's pixels make one
 * of the first painting's -- the sizes the reading looks for grow with it), scale (the pictures' size, x the
 * painting's), seed, onStep(text) (progress).
 * -> { W, H, height (RGBA), SW, SH, topo (RGBA), shade (0-255), land (W x H, for the painted picture), places, stats } */
export async function buildTerrain(rgba, W, H, { towns = [], water = [], k = 1, scale = 2, seed = 7, onStep = () => {} } = {}) {
  const N = W * H;
  const kk = k * k;
  onStep('Reading the painting');
  await tick();
  // The name boxes (cream, flat and wide) are filled with the colours just outside them before reading the land, so a
  // coast runs on underneath a box that sits half on the sea. Found by their shape here (the PC script was told where
  // they were); the names written on the water get the same.
  let c = readColours(rgba, W, H);
  const boxes = new Uint8Array(N);
  patches(c.cream, W, H).list
    .filter(p => p.w >= 25 * k && p.w <= 260 * k && p.h >= 8 * k && p.h <= 60 * k && p.w / p.h >= 1.8 && p.area / (p.w * p.h) >= 0.35)
    .forEach((p) => {
      const m = Math.round(7 * k);   // the dark frame and its shadow round the cream
      for (let y = Math.max(0, p.y0 - m); y <= Math.min(H - 1, p.y1 + m); y++) for (let x = Math.max(0, p.x0 - m); x <= Math.min(W - 1, p.x1 + m); x++) boxes[y * W + x] = 1;
    });
  water.forEach(({ x, y }) => {
    for (let py = Math.max(0, Math.round(y - 20 * k)); py < Math.min(H, y + 20 * k); py++) for (let px = Math.max(0, Math.round(x - 45 * k)); px < Math.min(W, x + 45 * k); px++) boxes[py * W + px] = 1;
  });
  const { nearest } = edt(boxes, W, H, { indices: true });
  const filled = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < N; i++) { const j = boxes[i] ? nearest[i] : i; filled[i * 4] = rgba[j * 4]; filled[i * 4 + 1] = rgba[j * 4 + 1]; filled[i * 4 + 2] = rgba[j * 4 + 2]; filled[i * 4 + 3] = 255; }
  c = readColours(filled, W, H);

  // --- The towns and the red dots: kept out of the rock / road reading ---
  const townMask = new Uint8Array(N);
  const TOWN_R = 48 * k;
  towns.forEach(([tx, ty]) => {
    for (let y = Math.max(0, Math.floor(ty - TOWN_R)); y <= Math.min(H - 1, Math.ceil(ty + TOWN_R)); y++) {
      for (let x = Math.max(0, Math.floor(tx - TOWN_R)); x <= Math.min(W - 1, Math.ceil(tx + TOWN_R)); x++) if ((x - tx) ** 2 + (y - ty) ** 2 < TOWN_R ** 2) townMask[y * W + x] = 1;
    }
  });
  const dots = patches(c.red, W, H).list.filter(p => p.area >= 120 * kk && p.area <= 700 * kk && p.w / Math.max(p.h, 1) > 0.6 && p.w / Math.max(p.h, 1) < 1.6);
  const marks = or(townMask, boxes);
  dots.forEach((d) => {
    const r = 18 * k;
    for (let y = Math.max(0, Math.floor(d.cy - r)); y <= Math.min(H - 1, Math.ceil(d.cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(d.cx - r)); x <= Math.min(W - 1, Math.ceil(d.cx + r)); x++) if ((x - d.cx) ** 2 + (y - d.cy) ** 2 < r * r) marks[y * W + x] = 1;
    }
  });
  const unmarked = not(marks);
  ['rock', 'snow', 'road', 'forest'].forEach((key) => { c[key] = and(c[key], unmarked); });

  onStep('Finding the land and the sea');
  await tick();
  // --- The sea: the water connected to the edge, the foam and small rocks closed into it ---
  let wet = closing(or(c.water, and(c.white, dilate(c.water, W, H, 3))), W, H, 2);
  wet = or(wet, c.water);
  const wl = components(wet, W, H);
  const edgeIds = new Set();
  for (let x = 0; x < W; x++) { edgeIds.add(wl.label[x]); edgeIds.add(wl.label[(H - 1) * W + x]); }
  for (let y = 0; y < H; y++) { edgeIds.add(wl.label[y * W]); edgeIds.add(wl.label[y * W + W - 1]); }
  edgeIds.delete(0);
  let sea = wl.label.map(l => (edgeIds.has(l) ? 1 : 0));
  // islets smaller than this vanish into the sea (stray rocks); bigger ones stay
  let land = not(sea);
  const ll = components(land, W, H);
  land = ll.label.map(l => (l && ll.sizes[l] >= 60 * kk ? 1 : 0));
  // under the name boxes the filled-in coast is straight-edged: rounded off there
  const nearBoxes = dilate(boxes, W, H, Math.round(10 * k));
  const soft = gaussian(toFloat(land), W, H, 5 * k);
  land = land.map((v, i) => (nearBoxes[i] ? (soft[i] > 0.5 ? 1 : 0) : v));
  sea = not(land);
  sea = or(opening(sea, W, H, 1), and(sea, not(erode(land, W, H, 1))));

  // --- Inland water: the lake (a big blob) and the rivers (thin lines) ---
  const inland = and(and(c.water, land), unmarked);
  const lake = new Uint8Array(N), river = new Uint8Array(N);
  const ip = patches(inland, W, H);
  ip.list.forEach((p) => {
    if (p.area <= 20 * k) return;
    // the patch on its own, in its box (with room to close it up)
    const pad = 6;
    const bx0 = Math.max(0, p.x0 - pad), by0 = Math.max(0, p.y0 - pad), bw = Math.min(W - 1, p.x1 + pad) - bx0 + 1, bh = Math.min(H - 1, p.y1 + pad) - by0 + 1;
    const part = new Uint8Array(bw * bh);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) part[y * bw + x] = ip.label[(y + by0) * W + x + bx0] === p.id ? 1 : 0;
    const thick = erode(part, bw, bh, Math.round(4 * k)).reduce((a, v) => a + v, 0);
    const into = (m, dest) => { for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (m[y * bw + x]) dest[(y + by0) * W + x + bx0] = 1; };
    if (thick > 400 * kk) into(closing(part, bw, bh, 3), lake); else into(part, river);
  });

  onStep('Raising the mountains');
  await tick();
  // --- Heights from what's painted ---
  const coastD = edt(land, W, H);          // pixels to the sea
  const seaD = edt(sea, W, H);
  const forestD = gaussian(toFloat(and(c.forest, land)), W, H, 7 * k);
  const rockD = gaussian(toFloat(and(and(and(c.rock, land), not(lake)), not(river))), W, H, 9 * k);
  const snowD = gaussian(toFloat(and(c.snow, land)), W, H, 8 * k);
  const random = rng(seed);
  const sc = list => list.map(s => Math.max(2, Math.round(s * k)));
  const ridges = fractal(W, H, random, sc([64, 32, 16, 8, 4]), true);
  await tick();
  const hills = fractal(W, H, random, sc([96, 48, 24, 12]));
  await tick();
  let h = new Float32Array(N);
  const mountain = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    // The rocks and cliffs painted along the shore read as mountains -- seen from the side the coast stood up in walls
    // (the user's call, 2026-10-20): a mountain only rises away from the sea, fully ~1.7 km inland.
    mountain[i] = smoothstep(0.18, 0.62, rockD[i] + snowD[i] * 0.8) * smoothstep(0, 14 * k, coastD[i]);
    h[i] = 25 + 240 * (1 - Math.exp(-coastD[i] / (70 * k)))
      + 140 * forestD[i] + 90 * (hills[i] - 0.5)
      + mountain[i] * (900 + 1100 * ridges[i] + 500 * smoothstep(0.1, 0.5, snowD[i]));
  }
  h = gaussian(h, W, H, 1.2);
  let lakeLevel = 0;
  if (lake.some(v => v)) {
    const ring = and(dilate(lake, W, H, 4), not(lake));
    const vals = [];
    for (let i = 0; i < N; i++) if (ring[i]) vals.push(h[i]);
    vals.sort((a, b) => a - b);
    const pos = (vals.length - 1) * 0.2, lo = Math.floor(pos);
    lakeLevel = (vals[lo] + (vals[Math.min(vals.length - 1, lo + 1)] - vals[lo]) * (pos - lo)) - 6;
  }
  const lakeDepth = edt(lake, W, H);
  const riverSoft = gaussian(toFloat(river), W, H, 1.5);
  for (let i = 0; i < N; i++) {
    if (lake[i]) h[i] = lakeLevel - Math.min(lakeDepth[i] * 2.5 / k, 40);
    h[i] -= 30 * Math.min(1, Math.max(0, riverSoft[i] * 3)) * (1 - mountain[i] * 0.7);
    // ...and no land stands higher than a steep slope up from the shore allows (55 m a pixel, ~25 degrees)
    if (land[i]) h[i] = Math.min(h[i], 15 + (55 * coastD[i]) / k);
    h[i] = land[i] ? Math.max(h[i], 3) : -Math.min(seaD[i] * 6 / k + 4, SEA_OFFSET - 10);
  }
  const hSoft = gaussian(h, W, H, 1.0);
  for (let i = 0; i < N; i++) if (!land[i] && seaD[i] <= 2) h[i] = hSoft[i];

  // the height map
  const height = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i++) {
    const stored = Math.min(65535, Math.max(0, Math.round(h[i] + SEA_OFFSET)));
    height[i * 4] = stored >> 8;
    height[i * 4 + 1] = stored & 255;
    height[i * 4 + 2] = sea[i] ? 0 : lake[i] ? 2 : river[i] ? 3 : 1;
    height[i * 4 + 3] = 255;
  }

  onStep('Drawing the topographic map');
  await tick();
  // --- The map pictures, `scale` x: the heights bicubic, the masks bilinear, their soft edges blurred at the painting's
  // own size (the same look as blurring the big ones, for a quarter of the work) ---
  const SW = Math.round(W * scale), SH = Math.round(H * scale);
  const fx = (W - 1) / Math.max(1, SW - 1), fy = (H - 1) / Math.max(1, SH - 1);
  const hAt = sampler(h, W, H, true);
  const bigH = new Float32Array(SW * SH);
  for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) bigH[y * SW + x] = hAt(x * fx, y * fy);
  await tick();
  const landAt = sampler(toFloat(land), W, H, false);
  const lakeAt = sampler(toFloat(lake), W, H, false);
  const forestAt = sampler(forestD, W, H, false);
  const riverAt = sampler(gaussian(toFloat(river), W, H, 0.35), W, H, false);
  const coastAt = sampler(gaussian(toFloat(land), W, H, 0.4), W, H, false);
  const lines = opening(and(c.road, land), W, H, 1);
  const roadAt = sampler(gaussian(toFloat(lines), W, H, 0.4), W, H, false);
  const topo = new Uint8ClampedArray(SW * SH * 4);
  const shade = new Uint8Array(SW * SH);
  const col = [0, 0, 0];
  const az = (315 * Math.PI) / 180, alt = (42 * Math.PI) / 180;
  for (let y = 0; y < SH; y++) {
    for (let x = 0; x < SW; x++) {
      const i = y * SW + x;
      // shading: light from the north-west, the slopes exaggerated so the relief shows (np.gradient's differences)
      const xl = Math.max(0, x - 1), xr = Math.min(SW - 1, x + 1), yu = Math.max(0, y - 1), yd = Math.min(SH - 1, y + 1);
      const gx = ((bigH[y * SW + xr] - bigH[y * SW + xl]) / Math.max(1, xr - xl)) * 0.018;
      const gy = ((bigH[yd * SW + x] - bigH[yu * SW + x]) / Math.max(1, yd - yu)) * 0.018;
      const slope = Math.PI / 2 - Math.atan(Math.hypot(gx, gy));
      const aspect = Math.atan2(-gx, gy);
      const sh = Math.min(1, Math.max(0, Math.sin(alt) * Math.sin(slope) + Math.cos(alt) * Math.cos(slope) * Math.cos(az - aspect)));
      shade[i] = Math.round(sh * 255);
      const px = x * fx, py = y * fy;
      const lb = landAt(px, py);
      topoColour(bigH[i], col);
      let [r, g, b] = col;
      const f = Math.min(Math.max(forestAt(px, py) * 1.4, 0), 0.55) * lb;
      r = r * (1 - f) + 84 * f; g = g * (1 - f) + 124 * f; b = b * (1 - f) + 72 * f;
      const sk = lb > 0.5 ? 0.55 + 0.65 * sh : 0.92 + 0.12 * sh;
      r *= sk; g *= sk; b *= sk;
      const lk = lakeAt(px, py);
      r = r * (1 - lk) + 78 * lk; g = g * (1 - lk) + 140 * lk; b = b * (1 - lk) + 196 * lk;
      const rv = Math.min(1, Math.max(0, riverAt(px, py) * 1.6));
      r = r * (1 - rv) + 70 * rv; g = g * (1 - rv) + 138 * rv; b = b * (1 - rv) + 205 * rv;
      const cl = Math.abs(Math.min(1, Math.max(0, coastAt(px, py))) - 0.5) < 0.22 ? 0.55 : 0;
      r = r * (1 - cl) + 40 * cl; g = g * (1 - cl) + 60 * cl; b = b * (1 - cl) + 70 * cl;
      const rd = Math.min(Math.max(roadAt(px, py) * 1.3, 0), 0.85);
      r = r * (1 - rd) + 22 * rd; g = g * (1 - rd) + 20 * rd; b = b * (1 - rd) + 18 * rd;
      topo[i * 4] = r; topo[i * 4 + 1] = g; topo[i * 4 + 2] = b; topo[i * 4 + 3] = 255;
    }
    if (y % 400 === 0) await tick();
  }

  let maxH = -Infinity, minH = Infinity, landCount = 0;
  for (let i = 0; i < N; i++) { if (h[i] > maxH) maxH = h[i]; if (h[i] < minH) minH = h[i]; landCount += land[i]; }
  return {
    W, H, height, SW, SH, topo, shade, land, lines: Uint8Array.from(lines),
    dots: dots.map(d => ({ x: Math.round(d.cx * 10) / 10, y: Math.round(d.cy * 10) / 10 })).sort((a, b) => a.y - b.y || a.x - b.x),
    stats: { land: landCount / N, lake: lake.reduce((a, v) => a + v, 0), rivers: river.reduce((a, v) => a + v, 0), highest: Math.round(maxH), deepest: Math.round(minH), boxes: boxes.reduce((a, v) => a + v, 0), spots: dots.length },
  };
}

/** The painting at the pictures' size (RGBA, SW x SH, drawn there by the browser) shaded like the land, its dark
 * lines (the region borders) turned black, in place. */
export function paintTexture(big, terrain) {
  const { W, H, SW, SH, land, shade } = terrain;
  const landAt = sampler(toFloat(land), W, H, false);
  const lineAt = terrain.lines ? sampler(gaussian(toFloat(terrain.lines), W, H, 0.4), W, H, false) : () => 0;
  const fx = (W - 1) / Math.max(1, SW - 1), fy = (H - 1) / Math.max(1, SH - 1);
  for (let y = 0; y < SH; y++) {
    for (let x = 0; x < SW; x++) {
      const i = y * SW + x;
      if (landAt(x * fx, y * fy) <= 0.5) continue;
      const k = 0.8 + 0.35 * (shade[i] / 255);
      let r = big[i * 4] * k, g = big[i * 4 + 1] * k, b = big[i * 4 + 2] * k;
      // the brown of a border line to near black (its own light and dark kept a little, so it isn't flat)
      const m = Math.min(Math.max(lineAt(x * fx, y * fy) * 1.6, 0), 0.92);
      if (m > 0) {
        const v = ((r + g + b) / 3) * 0.18;
        r = r * (1 - m) + v * m; g = g * (1 - m) + v * m; b = b * (1 - m) + v * m;
      }
      big[i * 4] = Math.min(255, r);
      big[i * 4 + 1] = Math.min(255, g);
      big[i * 4 + 2] = Math.min(255, b);
    }
  }
  return big;
}

/** What paintTexture multiplies the painting by, as a grey picture (RGBA, SW x SH): 0.7 + grey / 255 * 0.5 -- 1 on the
 * water. The regions' own paintings are shaded with it on the 3D map (region-detail.js). */
export function shadePicture(terrain) {
  const { W, H, SW, SH, land, shade } = terrain;
  const landAt = sampler(toFloat(land), W, H, false);
  const fx = (W - 1) / Math.max(1, SW - 1), fy = (H - 1) / Math.max(1, SH - 1);
  const out = new Uint8ClampedArray(SW * SH * 4);
  for (let y = 0; y < SH; y++) {
    for (let x = 0; x < SW; x++) {
      const i = y * SW + x;
      const k = landAt(x * fx, y * fy) <= 0.5 ? 1 : 0.8 + 0.35 * (shade[i] / 255);
      out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = Math.round(((k - 0.7) / 0.5) * 255);
      out[i * 4 + 3] = 255;
    }
  }
  return out;
}
