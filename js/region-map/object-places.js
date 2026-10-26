// Where the region map's objects stand (map-objects.js draws them; the user's call, 2026-10-25), read from the painting's
// colours (map-features.js readColours, the same reading the land was built from): pines and a few leafy trees where the
// forests are painted, the odd lone tree on the fields, rocks on the painted rock up in the hills, rocks in the shallow
// sea along the coast (the user's call, 2026-10-26), and a spire on each of the highest summits. Sizes, turns and shades vary from copy to copy, the same on every screen (a fixed seed).
//
// Pure maths on pixel arrays (no DOM, no three.js), so it runs in a worker (object-worker.js) -- it takes a moment, and
// the map shouldn't stop answering meanwhile.
//
// placeObjects({ rgba (the painting at the land's size), W, H, kind, metres (the land's: 0 sea, 1 land...) }) ->
// { shapes: names, data: Float32Array, FIELDS numbers an object: [shape (its index in shapes), x, y (painting pixels),
// turn (radians), size, tall (its height x this), shade] }.
import { readColours, boxMean } from './map-features.js';

export const SHAPES = ['pine', 'leafy', 'rock', 'searock', 'peak'];
export const FIELDS = 7;
export const PEAK_SIZE = 16;  // a peak's height at scale 1 (map-objects.js CLASSES.big)
const SEED = 20261025;

/** A seeded random number generator (mulberry32): the same objects in the same places on every screen. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function placeObjects({ rgba, W, H, kind, metres }) {
  const rand = seeded(SEED);
  const colours = readColours(rgba, W, H);
  const forest = boxMean(colours.forest, W, H, 2);
  const rock = boxMean(colours.rock, W, H, 3);
  const grass = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    // the painting's light green fields: green the strongest, bright
    grass[i] = g > r && g > b + 40 && g > 110 && !colours.forest[i] ? 1 : 0;
  }
  const grassy = boxMean(grass, W, H, 4);
  let top = 0;
  for (let i = 0; i < W * H; i++) if (kind[i] === 1 && metres[i] > top) top = metres[i];
  // where nothing stands: off the land (the sea, a lake, a river), on a road, a town's roofs and walls, a name's box
  const free = (x, y) => {
    const i = Math.round(y) * W + Math.round(x);
    return kind[i] === 1 && !colours.road[i] && !colours.red[i] && !colours.cream[i] && !colours.white[i] && !colours.water[i];
  };

  const out = [];
  const tint = (lo, hi) => lo + rand() * (hi - lo);
  const add = (shape, x, y, size, tall, shade) => out.push(SHAPES.indexOf(shape), x, y, rand() * Math.PI * 2, size, tall, shade);

  // Trees: one every ~3 pixels where the painting's forest is thick (its edges thinning out), most of them pines
  const S = 2.9;
  for (let gy = 0; gy < H / S; gy++) {
    for (let gx = 0; gx < W / S; gx++) {
      const x = (gx + rand()) * S, y = (gy + rand()) * S;
      if (x >= W - 1 || y >= H - 1 || !free(x, y)) continue;
      const i = Math.round(y) * W + Math.round(x);
      if (rand() < Math.min(1, (forest[i] / 255) * 1.7)) { // (the painted trees have light gaps between them: thick still reads as thick)
        add(rand() < 0.8 ? 'pine' : 'leafy', x, y, tint(0.8, 1.25), tint(0.9, 1.15), tint(0.82, 1.1));
      } else if (rand() < (grassy[i] / 255) * 0.012) {
        add('leafy', x, y, tint(0.85, 1.2), tint(0.9, 1.1), tint(0.9, 1.12)); // a lone tree on the fields
      }
    }
  }
  // Rocks: scattered over the painted rock up in the hills (lower down, the brown is paths and bare earth), never on the snow
  const hills = 0.12 * top;
  const R = 7;
  for (let gy = 0; gy < H / R; gy++) {
    for (let gx = 0; gx < W / R; gx++) {
      const x = (gx + rand()) * R, y = (gy + rand()) * R;
      if (x >= W - 1 || y >= H - 1 || !free(x, y)) continue;
      const i = Math.round(y) * W + Math.round(x);
      if (colours.snow[i] || metres[i] < hills || rand() > (rock[i] / 255) * 0.3) continue;
      add('rock', x, y, tint(0.5, 1.4), tint(0.7, 1.3), tint(0.85, 1.12));
    }
  }
  // Sea rocks: a few in the sea close to the coast -- not touching it, and not on a name painted over the water
  const shore = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) shore[i] = kind[i] === 0 ? 0 : 1;
  const nearShore = boxMean(shore, W, H, 7), onShore = boxMean(shore, W, H, 1);
  const SR = 6;
  for (let gy = 0; gy < H / SR; gy++) {
    for (let gx = 0; gx < W / SR; gx++) {
      const x = (gx + rand()) * SR, y = (gy + rand()) * SR;
      if (x >= W - 1 || y >= H - 1) continue;
      const i = Math.round(y) * W + Math.round(x);
      if (kind[i] !== 0 || !nearShore[i] || onShore[i] || colours.white[i] || colours.cream[i] || colours.red[i] || rand() > 0.16) continue;
      add('searock', x, y, tint(0.45, 1.2), tint(0.7, 1.25), tint(0.8, 1.05));
    }
  }
  // Peaks: the highest summits, each the highest point for 30 pixels round, at least 50 apart, 16 at most
  const metresAt = (x, y) => (kind[y * W + x] === 1 ? metres[y * W + x] : 0);
  const summits = [];
  for (let y = 3; y < H - 3; y += 3) {
    for (let x = 3; x < W - 3; x += 3) {
      const m = metresAt(x, y);
      if (m < top * 0.5) continue;
      let highest = true;
      for (let dy = -30; dy <= 30 && highest; dy += 3) {
        for (let dx = -30; dx <= 30; dx += 3) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < W && yy < H && metresAt(xx, yy) > m) { highest = false; break; }
        }
      }
      if (highest) summits.push({ x, y, m });
    }
  }
  summits.sort((a, b) => b.m - a.m);
  const peaks = [];
  for (const s of summits) {
    if (peaks.length >= 16) break;
    if (peaks.some(p => Math.hypot(p.x - s.x, p.y - s.y) < 50)) continue;
    peaks.push(s);
    add('peak', s.x, s.y, PEAK_SIZE * (0.75 + 0.55 * (s.m / top)), tint(0.9, 1.15), tint(0.95, 1.05));
  }
  return { shapes: SHAPES, data: new Float32Array(out) };
}
