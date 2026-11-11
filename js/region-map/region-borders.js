// The borders between the regions (the user's call, 2026-10-28): on a map built region by region (js/dm/map-upload.js's
// buildRegions) a thin black line divides each region from the next -- drawn by the app, not painted (painted, it would
// have to be painted again with every region, and blur up close). The first painting's own borders (its dark lines)
// are turned black as the map's built (make-terrain.js), so they match. Where the regions' paintings meet
// (each region's see-through outside tells where it ends; where two overlap, the one pasted later is on top) is found
// once, as the map is built (traceBorders), and kept with the map as lines (map-version.js: `borders`). Where a region
// meets the map's own painting (no region painted there yet) it has its line too, from the first region on (the
// user's call, 2026-11-01: a region placed stands out from its neighbours at once) -- only on the land, not along the
// coast; a region's edge out at sea has none.
// Since 2026-11-04 (the user's call: those also ran round a region's coast, messy) the DM can draw the borders himself,
// a picture of only the lines (linesFromPicture, below) -- those are the map's lines from then on, and a region added
// after keeps them; the traced ones are only for a map without. Since 2026-11-08 the drawn ones are also painted into
// the map's pictures as it's built (paintBorders): a region pasted over the painting's own lines covered them, and the
// thin line below was all that was left there.
//
// Since 2026-11-11 (the user's call: the line each device drew looked uneven on the phones -- the borders go into the
// map as it's built, one picture) they're painted into every region's own painting too, the ones shown up close
// (map-upload.js keeps those as each region's `shown`), and the 3D map draws no line of its own. Only a map built before
// that, or one with traced borders, still has the 3D map lay them on the land (addRegionBorders) -- the same width on
// the screen at any zoom, hidden behind a mountain like the land itself, and left out over the sea.
import * as THREE from '../vendor/three/three.module.min.js';

const MAX_CELLS = 32e6;   // the regions' outlines read at up to 4 cells a map pixel, this many cells at most
const TILE = 2048;        // ...a region's painting drawn in pieces this big (a canvas this size is fine everywhere)

/** A canvas (an OffscreenCanvas where there is one). */
function canvasOf(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** The map pixels a region covers: [x0, y0, x1, y1]. */
function boxOf(r) {
  const [a, b, c, d, e, f] = r.toMap;
  const corners = [[0, 0], [r.W, 0], [0, r.H], [r.W, r.H]].map(([x, y]) => [a * x + b * y + c, d * x + e * y + f]);
  const xs = corners.map(p => p[0]), ys = corners.map(p => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Fewer points along a line, none more than `tol` off it (Douglas-Peucker). */
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const [ax, ay] = pts[i], [bx, by] = pts[j];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    let far = -1, most = tol;
    for (let k = i + 1; k < j; k++) {
      // (from a point, where the ends are the same one -- a loop's)
      const off = len ? Math.abs((pts[k][0] - ax) * dy - (pts[k][1] - ay) * dx) / len : Math.hypot(pts[k][0] - ax, pts[k][1] - ay);
      if (off > most) { most = off; far = k; }
    }
    if (far > 0) { keep[far] = 1; stack.push([i, far], [far, j]); }
  }
  return pts.filter((_, k) => keep[k]);
}

/** A line of pixel steps straightened (0.75 px off it at most) -- a loop in two halves: its ends are the same point,
 * nothing to measure from. */
function straighten(pts, loop) {
  if (!loop) return simplify(pts, 0.75);
  let m = 1;
  pts.forEach(([x, y], i) => { if (Math.hypot(x - pts[0][0], y - pts[0][1]) > Math.hypot(pts[m][0] - pts[0][0], pts[m][1] - pts[0][1])) m = i; });
  return [...simplify(pts.slice(0, m + 1), 0.75), ...simplify(pts.slice(m), 0.75).slice(1)];
}

/** Rounded off (Chaikin, twice): the corners cut, the ends kept where they are (a loop's too, it has none). */
function smooth(pts, loop) {
  let p = pts;
  for (let n = 0; n < 2; n++) {
    if (p.length < 3) return p;
    // (a loop's first point is its last as well)
    const out = [];
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, ay] = p[i], [bx, by] = p[i + 1];
      out.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    if (loop) out.push(out[0]);
    else { out[0] = p[0]; out[out.length - 1] = p[p.length - 1]; }
    p = out;
  }
  return p;
}

/** The land shrunk by 2 pixels (1 where the 5 x 5 square round a pixel is all land): off the coast. */
function erode2(land, W, H) {
  const across = new Uint8Array(W * H), out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let all = 1;
      for (let d = -2; d <= 2 && all; d++) all = land[y * W + Math.min(W - 1, Math.max(0, x + d))] ? 1 : 0;
      across[y * W + x] = all;
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let all = 1;
      for (let d = -2; d <= 2 && all; d++) all = across[Math.min(H - 1, Math.max(0, y + d)) * W + x];
      out[y * W + x] = all;
    }
  }
  return out;
}

/**
 * traceBorders(W, H) -> { add(picture, region), finish(land) -> lines }: the borders round the regions on a W x H map.
 * add() each region's whole painting in the order they're pasted (`region`: its { W, H, toMap }); finish() gives the
 * lines, each [[x, y], ...] in the map's pixels.
 */
export function traceBorders(W, H) {
  const r = Math.max(1, Math.min(4, Math.floor(Math.sqrt(MAX_CELLS / (W * H)))));   // cells a map pixel
  const GW = Math.ceil(W * r), GH = Math.ceil(H * r);
  const owner = new Uint8Array(GW * GH);   // which region shows in each cell (1 the first pasted), 0 none
  let count = 0;

  function add(picture, region) {
    if (count >= 255) return;
    const id = ++count;
    const [bx0, by0, bx1, by1] = boxOf(region);
    const x0 = Math.max(0, Math.floor(bx0 * r)), y0 = Math.max(0, Math.floor(by0 * r));
    const x1 = Math.min(GW, Math.ceil(bx1 * r)), y1 = Math.min(GH, Math.ceil(by1 * r));
    const [a, b, c, d, e, f] = region.toMap;
    for (let ty = y0; ty < y1; ty += TILE) {
      for (let tx = x0; tx < x1; tx += TILE) {
        const w = Math.min(TILE, x1 - tx), h = Math.min(TILE, y1 - ty);
        const cv = canvasOf(w, h);
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        // the region's pixels -> this piece's cells
        ctx.setTransform(a * r, d * r, b * r, e * r, c * r - tx, f * r - ty);
        ctx.drawImage(picture, 0, 0);
        const alpha = ctx.getImageData(0, 0, w, h).data;
        for (let y = 0; y < h; y++) {
          const row = (ty + y) * GW + tx;
          for (let x = 0; x < w; x++) if (alpha[(y * w + x) * 4 + 3] >= 128) owner[row + x] = id;
        }
      }
    }
  }

  /** `land`: the built map's land (W x H, 1 on land) -- where a region meets the map's own painting, the line's only
   * drawn on land, a little way in from the coast. */
  function finish(land = null) {
    if (!count) return [];
    const inland = land ? erode2(land, W, H) : null;
    const onLand = (x, y) => !!inland?.[Math.min(H - 1, Math.floor(y / r)) * W + Math.min(W - 1, Math.floor(x / r))];
    // a line between two cells: two regions, or a region and the map's own painting there on the land
    const meets = (o, n, x, y, nx, ny) => o !== n && ((o && n) || (onLand(x, y) && onLand(nx, ny)));
    // the cells' edges where a region ends, kept on their corners: 1 east, 2 south, 4 west, 8 north
    const CW = GW + 1;
    const links = new Uint8Array(CW * (GH + 1));
    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        const o = owner[y * GW + x];
        if (x + 1 < GW && meets(o, owner[y * GW + x + 1], x, y, x + 1, y)) { links[y * CW + x + 1] |= 2; links[(y + 1) * CW + x + 1] |= 8; }
        if (y + 1 < GH && meets(o, owner[(y + 1) * GW + x], x, y, x, y + 1)) { links[(y + 1) * CW + x] |= 1; links[(y + 1) * CW + x + 1] |= 4; }
      }
    }
    const STEPS = { 1: [1, 0, 4], 2: [0, 1, 8], 4: [-1, 0, 1], 8: [0, -1, 2] };   // [dx, dy, the way back]
    const degree = k => ((links[k] & 1) + ((links[k] >> 1) & 1) + ((links[k] >> 2) & 1) + ((links[k] >> 3) & 1));
    const ends = new Uint8Array(links.length);   // where lines meet or stop (walked to, never through)
    for (let k = 0; k < links.length; k++) if (links[k] && degree(k) !== 2) ends[k] = 1;
    const walk = (k) => {
      const pts = [[k % CW, Math.floor(k / CW)]];
      let at = k;
      do {
        const bit = [1, 2, 4, 8].find(v => links[at] & v);
        const [dx, dy, back] = STEPS[bit];
        links[at] &= ~bit;
        at += dy * CW + dx;
        links[at] &= ~back;
        pts.push([at % CW, Math.floor(at / CW)]);
      } while (at !== k && !ends[at] && links[at]);
      return pts;
    };
    const raw = [];
    for (let k = 0; k < links.length; k++) while (links[k] && ends[k]) raw.push(walk(k));
    for (let k = 0; k < links.length; k++) while (links[k]) raw.push(walk(k));   // loops (a region inside another)
    // the cells' steps straightened, rounded off, in map pixels; specks (a few stray cells) left out
    return raw.map((pts) => {
      const loop = pts.length > 2 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
      return simplify(smooth(straighten(pts, loop), loop), 0.1).map(([x, y]) => [Math.round((x / r) * 100) / 100, Math.round((y / r) * 100) / 100]);
    }).filter((pts) => {
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      return len >= 2;
    });
  }

  return { add, finish };
}

// ---------------------------------------------------------------------------
// The DM's own borders (the user's call, 2026-11-04: the traced ones also ran round a region's coast, messy): a picture
// of only the border lines (dark, the rest see-through), drawn over the whole map, read into lines once as it's
// uploaded -- thinned to their middle, followed from end to end, rounded off.
// ---------------------------------------------------------------------------

const LINE_MAX_SIDE = 4096;   // a border picture is read at up to this size each way

/** A picture's dark, solid pixels: 1 a line. -> { mask, w, h, s (the picture's pixels -> the mask's) } */
function lineMask(picture) {
  const s = Math.min(1, LINE_MAX_SIDE / Math.max(picture.width, picture.height));
  const w = Math.max(1, Math.round(picture.width * s)), h = Math.max(1, Math.round(picture.height * s));
  const mask = new Uint8Array(w * h);
  for (let ty = 0; ty < h; ty += TILE) {
    const th = Math.min(TILE, h - ty);
    const cv = canvasOf(w, th);
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(picture, 0, -ty, w, h);
    const px = ctx.getImageData(0, 0, w, th).data;
    // (a picture made smaller fades its thin lines: a lower bar for it)
    const solid = s < 1 ? 96 : 128;
    for (let i = 0; i < w * th; i++) {
      const luma = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
      mask[ty * w + i] = px[i * 4 + 3] >= solid && luma < 110 ? 1 : 0;
    }
  }
  return { mask, w, h, s };
}

/** The lines thinned to one pixel, in place (Zhang-Suen). */
function thin(m, w, h) {
  for (let x = 0; x < w; x++) { m[x] = 0; m[(h - 1) * w + x] = 0; }
  for (let y = 0; y < h; y++) { m[y * w] = 0; m[y * w + w - 1] = 0; }
  let pts = [];
  for (let i = 0; i < m.length; i++) if (m[i]) pts.push(i);
  const del = [];
  for (let changed = true; changed;) {
    changed = false;
    for (const pass of [0, 1]) {
      del.length = 0;
      for (const p of pts) {
        if (!m[p]) continue;
        const n = [m[p - w], m[p - w + 1], m[p + 1], m[p + w + 1], m[p + w], m[p + w - 1], m[p - 1], m[p - w - 1]];   // P2..P9
        const b = n[0] + n[1] + n[2] + n[3] + n[4] + n[5] + n[6] + n[7];
        if (b < 2 || b > 6) continue;
        let a = 0;
        for (let k = 0; k < 8; k++) if (!n[k] && n[(k + 1) % 8]) a++;
        if (a !== 1) continue;
        if (pass === 0 ? (n[0] && n[2] && n[4]) || (n[2] && n[4] && n[6]) : (n[0] && n[2] && n[6]) || (n[0] && n[4] && n[6])) continue;
        del.push(p);
      }
      for (const p of del) m[p] = 0;
      if (del.length) changed = true;
    }
    pts = pts.filter(p => m[p]);
  }
  return pts;
}

/** The thinned pixels followed into lines ([[x, y], ...] in the mask's pixels): from each end or crossing to the next,
 * then the loops. A step across a corner counts only where no step along the sides goes round it (a staircase is one
 * line, not a ladder); stubs off a line (shorter than `stub`) and specks (shorter than `speck`) are left out. */
function follow(m, w, pts, stub, speck) {
  const NB = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]];
  const near = (p) => {
    const out = [];
    for (const [dx, dy] of NB) {
      const q = p + dy * w + dx;
      if (!m[q]) continue;
      if (dx && dy && (m[p + dx] || m[p + dy * w])) continue;   // (a corner with a way round it)
      out.push(q);
    }
    return out;
  };
  const links = new Map();
  for (const p of pts) links.set(p, near(p));
  const isNode = p => links.get(p).length !== 2;
  const seen = new Uint8Array(m.length);
  const pairs = new Set();
  const raw = [];   // [{ pts: [index, ...], a: degree at its start, b: at its end }]
  const walk = (from, to) => {
    const line = [from];
    let prev = from, at = to;
    for (;;) {
      line.push(at);
      if (isNode(at) || seen[at]) break;
      seen[at] = 1;
      const next = links.get(at).find(q => q !== prev);
      if (next == null) break;
      prev = at; at = next;
    }
    return line;
  };
  for (const p of pts) {
    if (!isNode(p)) continue;
    for (const q of links.get(p)) {
      if (isNode(q)) {
        const key = p < q ? `${p},${q}` : `${q},${p}`;
        if (!pairs.has(key)) { pairs.add(key); raw.push([p, q]); }
      } else if (!seen[q]) raw.push(walk(p, q));
    }
  }
  for (const p of pts) {
    if (seen[p] || isNode(p)) continue;
    seen[p] = 1;
    const line = walk(p, links.get(p)[0]);
    if (line[line.length - 1] !== p) line.push(p);
    raw.push(line);
  }
  const degree = p => links.get(p).length;
  const twins = new Set();   // short lines between the same two points (round a pinhole in a drawn line): one is enough
  return raw.filter((line) => {
    const a = degree(line[0]), b = degree(line[line.length - 1]);
    if (line.length < stub) {
      const [p, q] = [line[0], line[line.length - 1]].sort((x, y) => x - y);
      if (twins.has(`${p},${q}`)) return false;
      twins.add(`${p},${q}`);
    }
    if ((a === 1 && b >= 3) || (b === 1 && a >= 3)) return line.length >= stub;   // a stub off a line
    if (a === 1 && b === 1) return line.length >= speck;                          // a line on its own
    return true;
  }).map(line => line.map(p => [p % w + 0.5, Math.floor(p / w) + 0.5]));
}

/**
 * linesFromPicture(picture, toMap) -> lines ([[x, y], ...] in the map's pixels): a picture of border lines read into
 * lines -- `toMap` the affine from its pixels to the map's.
 */
export function linesFromPicture(picture, toMap) {
  const { mask, w, h, s } = lineMask(picture);
  let solid = 0;
  for (let i = 0; i < mask.length; i++) solid += mask[i];
  const pts = thin(mask, w, h);
  const width = pts.length ? solid / pts.length : 1;   // how thick the lines were drawn, about
  const [a, b, c, d, e, f] = toMap;
  return follow(mask, w, pts, Math.max(4, width * 1.5), Math.max(6, width * 3)).map((line) => {
    const loop = line.length > 3 && line[0][0] === line[line.length - 1][0] && line[0][1] === line[line.length - 1][1];
    return simplify(smooth(straighten(line, loop), loop), 0.1)
      .map(([x, y]) => [x / s, y / s])
      .map(([x, y]) => [Math.round((a * x + b * y + c) * 100) / 100, Math.round((d * x + e * y + f) * 100) / 100]);
  }).filter(line => line.length > 1);
}

/**
 * paintBorders(target, lines, { scale, width, colour, land, W, H }): the DM's drawn borders painted into one of the map's
 * pictures as it's built (the user's call, 2026-11-08: a region pasted over the painting's own lines left only the thin
 * 3D line there -- painted, they're in the painting, its export and the painted and topographic pictures like the
 * painting's own). `target` a canvas `scale` times the map's W x H pixels -- or, with `toPic` (the affine [a, b, c, d,
 * e, f] from the map's pixels to the target's), any picture lying on the map: a region's own painting (the user's call,
 * 2026-11-11: the borders built into every picture of the map, none drawn by the device); `width` in the map's pixels;
 * `land` (W x H, 1 on land) keeps them off the sea, as the painted ones are.
 */
export function paintBorders(target, lines, { scale = 1, toPic = null, width = 4, colour = '#000', land = null, W = 0, H = 0 } = {}) {
  if (!lines?.length) return;
  const [ta, tb, tc, td, te, tf] = toPic || [scale, 0, 0, 0, scale, 0];
  const layer = canvasOf(target.width, target.height);
  const c = layer.getContext('2d');
  c.setTransform(ta, td, tb, te, tc, tf);
  c.lineJoin = 'round';
  c.lineCap = 'round';
  c.lineWidth = width;
  c.strokeStyle = colour;
  c.beginPath();
  lines.forEach(l => l.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))));
  c.stroke();
  if (land && W && H) {
    const mask = canvasOf(W, H);
    const mc = mask.getContext('2d');
    const img = mc.createImageData(W, H);
    for (let i = 0; i < W * H; i++) img.data[i * 4 + 3] = land[i] ? 255 : 0;
    mc.putImageData(img, 0, 0);
    // (the land laid on the target as the lines are: whatever of the target it leaves out is cleared too)
    c.globalCompositeOperation = 'destination-in';
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(mask, 0, 0, W, H);
  }
  target.getContext('2d').drawImage(layer, 0, 0);
}

const VERTEX = /* glsl */ `
attribute vec3 prev;
attribute vec3 next;
attribute float side;
uniform vec2 rbView;
uniform float rbWidth;
varying float vSide;
#include <logdepthbuf_pars_vertex>
void main() {
  // a touch towards the camera: on the land, not in it
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  mv.xyz *= 0.997;
  vec4 at = projectionMatrix * mv;
  vec4 a = projectionMatrix * modelViewMatrix * vec4(prev, 1.0);
  vec4 b = projectionMatrix * modelViewMatrix * vec4(next, 1.0);
  vec2 dir = b.xy / max(b.w, 1e-4) - a.xy / max(a.w, 1e-4);
  dir *= rbView;
  dir = length(dir) > 1e-5 ? normalize(dir) : vec2(1.0, 0.0);
  // out to the side by half the width, in the screen's pixels
  at.xy += vec2(-dir.y, dir.x) * side * rbWidth / rbView * at.w;
  vSide = side;
  gl_Position = at;
  #include <logdepthbuf_vertex>
}`;

const FRAGMENT = /* glsl */ `
uniform vec3 rbColour;
uniform float rbOpacity;
varying float vSide;
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  float soft = fwidth(vSide);
  gl_FragColor = vec4(rbColour, rbOpacity * (1.0 - smoothstep(1.0 - soft * 1.5, 1.0, abs(vSide))));
  #include <colorspace_fragment>
}`;

/**
 * addRegionBorders(scene, { borders, size: [W, H], groundAt(x, y), onLand(x, y) }) -> { dispose() }: the lines laid on
 * the land -- `groundAt` the land's height there in the world (region-map.js's), `onLand` false over the sea.
 */
export function addRegionBorders(scene, { borders, size, groundAt, onLand }) {
  const [W, H] = size;
  const pos = [], prev = [], next = [], side = [], index = [];
  const line = (pts) => {
    if (pts.length < 2) return;
    const first = pos.length / 3;   // (the vertices so far: two a point)
    const world = pts.map(([x, y]) => [x - W / 2, groundAt(x, y), y - H / 2]);
    world.forEach((p, i) => {
      const a = world[Math.max(0, i - 1)], b = world[Math.min(world.length - 1, i + 1)];
      pos.push(...p, ...p); prev.push(...a, ...a); next.push(...b, ...b); side.push(-1, 1);
      if (i) { const k = first + (i - 1) * 2; index.push(k, k + 1, k + 2, k + 2, k + 1, k + 3); }
    });
  };
  (borders || []).forEach((pts) => {
    // a point every map pixel at most, so the line follows the land's ups and downs; split where it's over the sea
    let run = [];
    const put = (p) => {
      if (onLand(p[0], p[1])) run.push(p);
      else { line(run); run = []; }
    };
    pts.forEach((p, i) => {
      if (i) {
        const [ax, ay] = pts[i - 1];
        const n = Math.ceil(Math.hypot(p[0] - ax, p[1] - ay));
        for (let s = 1; s < n; s++) put([ax + ((p[0] - ax) * s) / n, ay + ((p[1] - ay) * s) / n]);
      }
      put(p);
    });
    line(run);
  });
  if (!index.length) return { dispose() {} };
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('prev', new THREE.Float32BufferAttribute(prev, 3));
  geo.setAttribute('next', new THREE.Float32BufferAttribute(next, 3));
  geo.setAttribute('side', new THREE.Float32BufferAttribute(side, 1));
  geo.setIndex(index);
  const view = new THREE.Vector2(1, 1);
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false,
    side: THREE.DoubleSide,   // (which way round its triangles face depends on which way the line runs on the screen)
    uniforms: {
      rbView: { value: view },
      rbWidth: { value: 4 },   // (the screen's pixels, edge to edge)
      rbColour: { value: new THREE.Color(0x0a0a0a) },
      rbOpacity: { value: 0.9 },
    },
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;   // (moved out to the sides on the screen: its box doesn't hold it)
  mesh.renderOrder = 2;         // (over a location drawn onto the land)
  // the screen's size and sharpness, as it's drawn: the line ~2 pixels wide (and a soft edge) whatever the screen
  mesh.onBeforeRender = (renderer) => {
    renderer.getDrawingBufferSize(view);
    material.uniforms.rbWidth.value = 4 * renderer.getPixelRatio();
  };
  scene.add(mesh);
  return {
    dispose() { scene.remove(mesh); geo.dispose(); material.dispose(); },
  };
}
