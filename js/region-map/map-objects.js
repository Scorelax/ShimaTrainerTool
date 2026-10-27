// The region map's objects (the user's call, 2026-10-25: a map of objects, more alive than the painting alone): trees
// standing on the 3D land -- made here in code, no model files (rocks and summits only get one from a DM's model,
// MODEL_ONLY). Where they stand is read
// from the painting's colours, in the background (object-places.js, object-worker.js: findPlaces).
//
// The DM's own models stand in for them where there are any (the user's call, 2026-10-26): "mapobject-<kind>.glb" in
// the locations' icon folder (MODEL_KINDS: tree, rock_land, rock_sea, peak), fitted into the box of the shape it
// replaces, each copy still sized, turned and shaded its own way; more than one of a kind ("mapobject-tree-2.glb") are
// mixed in. Only light ones (MAX_TRIANGLES) -- a heavier one is left out, the shape made here standing in.
//
// Thousands of them, so: a handful of low-poly shapes, each drawn as copies (InstancedMesh) in blocks of land (CHUNK),
// so only the blocks on screen are drawn; and each object grows in from nothing as the camera comes close enough for it
// to be a few pixels tall -- from far out the map looks as it did, and nothing flickers into place. Lit by the map's
// own light from the north-west (region-map.js), shaded flat like a low-poly model.
//
// findPlaces({ rgba (the painting, at the land's size), W, H, kind, metres }) -> where they stand, then
// buildMapObjects({ land, placed, groundAt(x, y) (the land's surface there, world y), toWorld, models ({ kind: [{ file,
// scene } loaded, in file order] }) }) -> { group (into the
// scene), update(camera, viewHeightPx), setClearings([{ x, y, r }]) (no objects there: the locations' icons and models),
// dispose() }.
import * as THREE from '../vendor/three/three.module.min.js';
import { mergeGeometries } from '../vendor/three/BufferGeometryUtils.js';
import { FIELDS, PEAK_SIZE } from './object-places.js';

const CHUNK = 160;          // a block of land, in painting pixels: drawn or left out as one
// How big each kind is, in world units (painting pixels, 120 m) -- as big as the painting's own trees, not real ones --
// and how many screen pixels tall it has to be to show (`from`: starts growing in, `full`: full size).
const CLASSES = {
  small: { tall: 3.6, from: 2.5, full: 7 },   // trees and rocks
  big: { tall: PEAK_SIZE, from: 4, full: 12 },   // peaks
};

// Which of the DM's models stands in for each shape -- the first kind there is (a kind without a model: none)
export const MODEL_KINDS = {
  pine: ['tree_pine', 'tree'],
  leafy: ['tree_leafy', 'tree'],
  rock: ['rock_land', 'rock'],
  searock: ['rock_sea', 'rock'],
  peak: ['peak'],
};
// Shapes only shown as a DM's model (the user's calls, 2026-10-27): the spires made here looked clumsy on the summits,
// and the rocks wait for the DM's own -- a mapobject-peak / rock_land / rock_sea model still stands in their places
const MODEL_ONLY = new Set(['peak', 'rock', 'searock']);
// The most triangles a model may have: thousands of trees and rocks are drawn at once, and only 16 summits
const MAX_TRIANGLES = { small: 1500, big: 30000 };

/** A number from -1 to 1 for a point -- so the corners two faces share are moved alike, and the shape stays closed. */
function hash3(x, y, z) {
  const s = Math.sin(Math.round(x * 1000) * 12.9898 + Math.round(y * 1000) * 78.233 + Math.round(z * 1000) * 37.719) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

/** Every corner pushed out or in along its direction from the middle by up to `amount` (a lumpy rock, a jagged spire). */
function roughen(geo, amount, seed = 0) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + hash3(x + seed, y, z) * amount;
    p.setXYZ(i, x * k, y * (1 + hash3(y, z + seed, x) * amount * 0.5), z * k);
  }
  return geo;
}

/** One part of a shape, every face one colour (or `colourOf(face's middle)`), ready to be merged with the others. */
function part(geo, colour, colourOf = null) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const p = g.attributes.position;
  const cols = new Float32Array(p.count * 3);
  const c = new THREE.Color(colour);
  const mid = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    if (colourOf) {
      mid.set((p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3, (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3);
      c.set(colourOf(mid));
    }
    for (let k = 0; k < 3; k++) cols.set([c.r, c.g, c.b], (i + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// The shapes (each standing on y = 0, about CLASSES[...].tall high at scale 1 -- a peak 1 high, scaled up)
// ---------------------------------------------------------------------------

function pineShape() {
  const trunk = new THREE.CylinderGeometry(0.12, 0.17, 0.9, 5).translate(0, 0.45, 0);
  const tiers = [[1.15, 1.8, 0.6, 0x2c5427], [0.9, 1.6, 1.4, 0x33602d], [0.62, 1.4, 2.2, 0x3b6c33]]
    .map(([r, h, at, colour], i) => part(new THREE.ConeGeometry(r, h, 7).rotateY(i * 0.45).translate(0, at + h / 2, 0), colour));
  return mergeGeometries([part(trunk, 0x5e4128), ...tiers]);
}

function leafyShape() {
  const trunk = new THREE.CylinderGeometry(0.12, 0.18, 1.2, 5).translate(0, 0.6, 0);
  const crown = roughen(new THREE.IcosahedronGeometry(1.05, 0), 0.14, 3).scale(1, 0.9, 1).translate(0, 1.95, 0);
  const top = roughen(new THREE.IcosahedronGeometry(0.62, 0), 0.14, 5).translate(0.25, 2.65, -0.15);
  return mergeGeometries([part(trunk, 0x5e4128), part(crown, 0x4c7a31), part(top, 0x578a37)]);
}

function rockShape() {
  // a third of it under the ground, so on a slope it doesn't stand on one corner
  return part(roughen(new THREE.IcosahedronGeometry(1, 1), 0.24, 7).scale(1, 0.62, 0.85).translate(0, 0.2, 0), 0x88817a);
}

/** A jagged spire with a snowy top, and two smaller ones beside it; its skirt reaches a quarter of its height under the
 * ground, so wherever it stands on the summit it never floats. */
function peakShape() {
  const spire = (h, r, seed) => {
    const pts = [];
    for (let k = 0; k <= 5; k++) {
      const t = k / 5;
      pts.push(new THREE.Vector2(k === 5 ? 0 : r * (1.1 - t) ** 1.4, -0.25 * h + t * 1.25 * h));
    }
    return roughen(new THREE.LatheGeometry(pts, 7), 0.16, seed);
  };
  const snowy = (top) => (m) => {
    const t = m.y / top + hash3(m.x, m.z, top) * 0.08;
    return t > 0.62 ? 0xf2f5f9 : t > 0.5 ? 0xa8a199 : 0x8f8274;
  };
  return mergeGeometries([
    part(spire(1, 0.42, 1), 0, snowy(1)),
    part(spire(0.66, 0.32, 2).translate(0.3, 0, 0.14), 0, snowy(0.66)),
    part(spire(0.52, 0.28, 3).translate(-0.27, 0, -0.2), 0, snowy(0.52)),
  ]);
}

/** The material the copies of one class share: flat-shaded and lit, each copy grown in by its distance from the camera
 * (`range`: { near (full size closer than this), far (nothing further than this) }, set in update). */
function material(range) {
  return growIn(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), range);
}

/** A model's material made like the shapes' -- lit the same way, its colour, picture and see-through parts (leaves) kept
 * -- and grown in the same way. */
function modelMaterial(src, range, vertexColours) {
  return growIn(new THREE.MeshLambertMaterial({
    color: src?.color ? src.color.clone() : 0xffffff,
    map: src?.map || null,
    alphaMap: src?.alphaMap || null,
    alphaTest: src?.alphaTest || (src?.transparent || src?.alphaMap ? 0.5 : 0),
    vertexColors: vertexColours,
    side: src?.side ?? THREE.FrontSide,
  }), range);
}

/** A model's meshes as parts to draw copies of ([{ geo, mat }], one per material it uses), fitted into `target` (the
 * shape it stands in for: { biggest (its biggest side), minY (how far under the ground it reaches) }) -> { parts } --
 * none when it's too heavy (over `maxTriangles`) or has nothing to draw -- and { triangles }. */
function modelParts(scene, target, range, maxTriangles) {
  scene.updateMatrixWorld(true);
  const byMaterial = new Map();
  let triangles = 0;
  scene.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const src = Array.isArray(o.material) ? o.material[0] : o.material;
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    for (const name of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'uv', 'color'].includes(name) || (name === 'uv' && !src?.map && !src?.alphaMap)
        || (name === 'color' && !src?.vertexColors)) g.deleteAttribute(name);
    }
    g.morphAttributes = {};
    if (!g.attributes.normal) g.computeVertexNormals();
    triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
    if (!byMaterial.has(src)) byMaterial.set(src, []);
    byMaterial.get(src).push(g);
  });
  triangles = Math.round(triangles);
  if (!byMaterial.size || triangles > maxTriangles) return { triangles };
  const box = new THREE.Box3();
  for (const geos of byMaterial.values()) for (const g of geos) { g.computeBoundingBox(); box.union(g.boundingBox); }
  const size = box.getSize(new THREE.Vector3());
  const k = target.biggest / Math.max(size.x, size.y, size.z);
  if (!(k > 0) || !Number.isFinite(k)) return { triangles };
  const parts = [];
  for (const [src, geos] of byMaterial) {
    // standing in the middle, its foot as far into the ground as the shape's
    for (const g of geos) g.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2).scale(k, k, k).translate(0, target.minY, 0);
    const merged = geos.length > 1 ? mergeGeometries(geos.map(g => (g.index ? g.toNonIndexed() : g))) : null;
    const mat = modelMaterial(src, range, !!src?.vertexColors);
    for (const geo of merged ? [merged] : geos) parts.push({ geo, mat });
  }
  return { parts, triangles };
}

/** A material grown in by each copy's distance from the camera (`range`, see material). */
function growIn(m, range) {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.objNear = range.near;
    shader.uniforms.objFar = range.far;
    shader.vertexShader = `uniform float objNear;\nuniform float objFar;\n${shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vec4 objFoot = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      transformed *= 1.0 - smoothstep(objNear, objFar, distance(objFoot.xyz, cameraPosition));`)}`;
  };
  m.customProgramCacheKey = () => 'map-object';
  return m;
}

/** A number from 0 to 1 for a spot -- which of a kind's models stands there, the same on every screen. */
function spotHash(x, y) {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** Where the objects stand, worked out in a worker (on the page when there's none) -> object-places.js's result. */
export function findPlaces(input) {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(new URL('./object-worker.js', import.meta.url), { type: 'module' });
    } catch (err) {
      import('./object-places.js').then(m => m.placeObjects(input)).then(resolve, reject);
      return;
    }
    worker.onmessage = (e) => { worker.terminate(); if (e.data.error) reject(new Error(e.data.error)); else resolve(e.data.done); };
    worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message || "Couldn't place the map's objects")); };
    worker.postMessage(input, [input.rgba.buffer]);
  });
}

export function buildMapObjects({ land, placed, groundAt, toWorld, models = {} }) {
  const { W, H } = land;

  // The shapes, their class, and the materials (one per class: its own grow-in distances) -- or the DM's models in
  // their place: shapes[key] = { cls, parts: [{ geo, mat }] }, a shape's keys in variants[shape] (a model each)
  const ranges = Object.fromEntries(Object.keys(CLASSES).map(k => [k, { near: { value: 1e9 }, far: { value: 2e9 } }]));
  const mats = Object.fromEntries(Object.keys(CLASSES).map(k => [k, material(ranges[k])]));
  const made = {
    pine: ['small', pineShape()],
    leafy: ['small', leafyShape()],
    rock: ['small', rockShape()],
    searock: ['small', rockShape()],
    peak: ['big', peakShape()],
  };
  const shapes = {};
  const variants = {};
  const warned = new Set();
  for (const [name, [cls, geo]] of Object.entries(made)) {
    geo.computeBoundingBox();
    const size = geo.boundingBox.getSize(new THREE.Vector3());
    const target = { biggest: Math.max(size.x, size.y, size.z), minY: geo.boundingBox.min.y };
    const kind = MODEL_KINDS[name].find(k => models[k]?.length);
    const fitted = (kind ? models[kind] : []).map(({ file, scene }) => {
      const r = modelParts(scene, target, ranges[cls], MAX_TRIANGLES[cls]);
      if (!r.parts && !warned.has(file)) {
        warned.add(file);
        console.warn(r.triangles > MAX_TRIANGLES[cls]
          ? `Map object ${file} has ${r.triangles} triangles -- ${MAX_TRIANGLES[cls]} at most, so it's left out`
          : `Map object ${file} has nothing to draw -- left out`);
      }
      return r.parts;
    }).filter(Boolean);
    if (fitted.length) {
      geo.dispose();
      variants[name] = fitted.map((parts, n) => { shapes[`${name}#${n}`] = { cls, parts }; return `${name}#${n}`; });
    } else if (MODEL_ONLY.has(name)) {
      geo.dispose(); // (only its size was needed: what a model's fitted into)
    } else {
      shapes[name] = { cls, parts: [{ geo, mat: mats[cls] }] };
      variants[name] = [name];
    }
  }

  // the objects sorted into the blocks of land they stand in (and, a shape with more than one model, by which)
  const chunks = new Map();
  const { shapes: names, data } = placed;
  for (let k = 0; k < data.length; k += FIELDS) {
    const [shape, x, y, turn, size, tall, shade] = data.subarray(k, k + FIELDS);
    const keys = variants[names[shape]];
    if (!keys) continue;
    const at = `${Math.floor(x / CHUNK)},${Math.floor(y / CHUNK)}`;
    if (!chunks.has(at)) chunks.set(at, { x0: Math.floor(x / CHUNK) * CHUNK, y0: Math.floor(y / CHUNK) * CHUNK, items: {}, meshes: {} });
    const key = keys.length > 1 ? keys[Math.min(keys.length - 1, Math.floor(spotHash(x, y) * keys.length))] : keys[0];
    (chunks.get(at).items[key] ||= []).push({ x, y, turn, size, tall, shade });
  }

  const group = new THREE.Group();
  group.name = 'map-objects';
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const col = new THREE.Color();
  let clearings = [];

  /** One chunk's copies of one shape written into its mesh -- leaving out any in a clearing. */
  function fill(mesh, items) {
    let n = 0;
    for (const it of items) {
      if (clearings.some(c => (it.x - c.x) ** 2 + (it.y - c.y) ** 2 < c.r * c.r)) continue;
      const w = toWorld(it.x, it.y);
      // a hair into the ground: the land between its corners is flat, a tree on a slope mustn't show its foot
      pos.set(w.x, groundAt(it.x, it.y) - 0.15 * it.size, w.z);
      q.setFromAxisAngle(up, it.turn);
      scl.set(it.size, it.size * it.tall, it.size);
      mesh.setMatrixAt(n, m4.compose(pos, q, scl));
      mesh.setColorAt(n, col.setScalar(it.shade));
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.boundingSphere = null; // worked out again for what's left (what it's culled by)
    mesh.computeBoundingSphere();
  }

  let count = 0;
  for (const c of chunks.values()) {
    for (const [key, items] of Object.entries(c.items)) {
      const s = shapes[key];
      c.meshes[key] = s.parts.map((p) => {
        const mesh = new THREE.InstancedMesh(p.geo, p.mat, items.length);
        mesh.userData.cls = s.cls;
        mesh.matrixAutoUpdate = false;
        fill(mesh, items);
        group.add(mesh);
        return mesh;
      });
      count += items.length;
    }
  }
  group.userData.count = count;

  /** The grow-in distances for this camera and screen, and the blocks too far away to show anything left out. */
  function update(camera, viewHeightPx) {
    const perUnit = viewHeightPx / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));   // pixels x distance, per unit
    const far = {};
    for (const [k, cl] of Object.entries(CLASSES)) {
      ranges[k].near.value = (cl.tall * perUnit) / cl.full;
      ranges[k].far.value = far[k] = (cl.tall * perUnit) / cl.from;
    }
    const cam = camera.position;
    for (const c of chunks.values()) {
      // the camera's distance from the block (its box, from the sea up to the highest land)
      const x0 = c.x0 - W / 2, z0 = c.y0 - H / 2;
      const dx = Math.max(x0 - cam.x, 0, cam.x - (x0 + CHUNK));
      const dz = Math.max(z0 - cam.z, 0, cam.z - (z0 + CHUNK));
      const dy = Math.max(0, cam.y - land.topY);
      const d = Math.hypot(dx, dy, dz);
      for (const list of Object.values(c.meshes)) for (const mesh of list) mesh.visible = mesh.count > 0 && d < far[mesh.userData.cls];
    }
  }

  /** No objects inside these circles ({ x, y, r } in painting pixels) -- where a location's icon or model stands. */
  function setClearings(list) {
    const next = (list || []).filter(c => c && c.r > 0);
    if (JSON.stringify(next) === JSON.stringify(clearings)) return;
    clearings = next;
    for (const c of chunks.values()) for (const [key, list] of Object.entries(c.meshes)) list.forEach(mesh => fill(mesh, c.items[key]));
  }

  function dispose() {
    Object.values(shapes).forEach(s => s.parts.forEach((p) => { p.geo.dispose(); p.mat.dispose(); }));
    Object.values(mats).forEach(m => m.dispose());
    group.children.forEach(m => m.dispose());
  }

  return { group, update, setClearings, dispose };
}
