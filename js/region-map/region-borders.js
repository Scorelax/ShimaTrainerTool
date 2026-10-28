// The borders between the regions (the user's call, 2026-10-28): on a map built region by region (js/dm/map-upload.js's
// buildRegions) a thin dark line divides each region from the next -- drawn by the app, not painted (a black line in a
// painting is read as a road, and it would be painted again with every region). Where the regions' paintings meet
// (each region's see-through outside tells where it ends; where two overlap, the one pasted later is on top) is found
// once, as the map is built (traceBorders), and kept with the map as lines (map-version.js: `borders`). A region's
// edge against the sea or against the map's own painting (no region painted there yet) has no line.
//
// The 3D map lays them on the land (addRegionBorders) -- the same width on the screen at any zoom, sharp up close, hidden
// behind a mountain like the land itself, and left out over the sea.
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
    const len = Math.hypot(dx, dy) || 1;
    let far = -1, most = tol;
    for (let k = i + 1; k < j; k++) {
      const off = Math.abs((pts[k][0] - ax) * dy - (pts[k][1] - ay) * dx) / len;
      if (off > most) { most = off; far = k; }
    }
    if (far > 0) { keep[far] = 1; stack.push([i, far], [far, j]); }
  }
  return pts.filter((_, k) => keep[k]);
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

/**
 * traceBorders(W, H) -> { add(picture, region), finish() -> lines }: the borders between the regions on a W x H map.
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

  function finish() {
    if (count < 2) return [];
    // the cells' edges where two regions meet, kept on their corners: 1 east, 2 south, 4 west, 8 north
    const CW = GW + 1;
    const links = new Uint8Array(CW * (GH + 1));
    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        const o = owner[y * GW + x];
        if (!o) continue;
        const east = x + 1 < GW ? owner[y * GW + x + 1] : 0;
        if (east && east !== o) { links[y * CW + x + 1] |= 2; links[(y + 1) * CW + x + 1] |= 8; }
        const south = y + 1 < GH ? owner[(y + 1) * GW + x] : 0;
        if (south && south !== o) { links[(y + 1) * CW + x] |= 1; links[(y + 1) * CW + x + 1] |= 4; }
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
      let straight = simplify(pts, 0.75);
      if (loop) {
        // (a loop in two halves: its ends are the same point, nothing to measure from)
        let m = 1;
        pts.forEach(([x, y], i) => { if (Math.hypot(x - pts[0][0], y - pts[0][1]) > Math.hypot(pts[m][0] - pts[0][0], pts[m][1] - pts[0][1])) m = i; });
        straight = [...simplify(pts.slice(0, m + 1), 0.75), ...simplify(pts.slice(m), 0.75).slice(1)];
      }
      return simplify(smooth(straight, loop), 0.1).map(([x, y]) => [Math.round((x / r) * 100) / 100, Math.round((y / r) * 100) / 100]);
    }).filter((pts) => {
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      return len >= 2;
    });
  }

  return { add, finish };
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
      rbColour: { value: new THREE.Color(0x1e160c) },
      rbOpacity: { value: 0.85 },
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
