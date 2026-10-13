// The region map in 3D: the Shiman Federation as a block of land you can turn, tilt, zoom and move -- our own take on
// the 3D map in Benjakronk's Nynorsk course. Shima is invented, so its heights come from his painted map
// (tools/region-map/make_terrain.py writes assets/region-map/: the height map, the topographic and the painted map
// pictures, and places.json with the towns and the red spots).
//
// Drag to turn, scroll / pinch to zoom, right-drag / two fingers to move. Only drawn while something moves, so it
// costs nothing while it's left alone.
//
// Self-contained so it can live in its own page (region-map.html) or be mounted elsewhere -- the DM console's PokeNav
// steers it (onView) and the table's board screen (battle-map.html) shows it view only, following along (setView):
// mountRegionMap(root, { onBack, viewOnly, title, rememberStyle, onView }) -> { ready, destroy, getView, setView, home,
// graphics: {renderer, software} }.
// A view is { x, y (the painting pixel in the middle), zoom (the distance as a share of the whole-island one), polar,
// azimuth, style }. Styles: css/region-map.css (.rmap-*).
import * as THREE from '../vendor/three/three.module.min.js';
import { OrbitControls } from '../vendor/three/OrbitControls.js';

const BASE = 'assets/region-map/';
const KM_PER_PX = 0.12;      // one pixel of the painting is 120 m: the island is ~110 x 200 km
const EXAG = 3;              // the heights exaggerated, so the mountains read from the air
const STEP = 3;              // one corner of the land's mesh every this many pixels
const BLOCK = 60;            // how deep the block of land goes under the sea
const STYLES = { topo: 'topo.jpg', painted: 'painted.jpg' };
const STYLE_KEY = 'rmapStyle';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));

/** The height map as tables: metres and what's there (0 sea, 1 land, 2 lake, 3 river) per painting pixel. */
async function loadHeights(seaOffset) {
  const blob = await (await fetch(`${BASE}height.png`)).blob();
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  const px = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
  const n = bitmap.width * bitmap.height;
  const metres = new Float32Array(n);
  const kind = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    metres[i] = px[i * 4] * 256 + px[i * 4 + 1] - seaOffset;
    kind[i] = px[i * 4 + 2];
  }
  return { W: bitmap.width, H: bitmap.height, metres, kind };
}

function loadTexture(renderer, file) {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(`${BASE}${file}`, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      resolve(tex);
    }, undefined, () => reject(new Error(`Couldn't load ${file}`)));
  });
}

/** What draws the 3D here: { renderer (the graphics card's name), software (no graphics card: the browser draws it
 * itself, far slower -- hardware acceleration off, or the card not allowed) }. */
function graphicsInfo() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
    if (!gl) return { renderer: '', software: false };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { renderer: name, software: /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name) };
  } catch (e) {
    return { renderer: '', software: false };
  }
}

export function mountRegionMap(root, { onBack, viewOnly = false, title = true, rememberStyle = true, onView } = {}) {
  root.classList.add('rmap');
  root.classList.toggle('view-only', viewOnly); // nothing to press or drag: it follows setView
  let style = 'topo';
  if (rememberStyle) {
    try { if (STYLES[localStorage.getItem(STYLE_KEY)]) style = localStorage.getItem(STYLE_KEY); } catch (e) { /* not kept */ }
  }
  root.classList.toggle('painted', style === 'painted');
  root.innerHTML = `
    <canvas class="rmap-canvas"></canvas>
    <div class="rmap-labels"></div>
    ${!viewOnly && (onBack || title) ? `<header class="rmap-top">
      ${onBack ? '<button class="rmap-btn rmap-round" data-act="back" aria-label="Back">←</button>' : ''}
      ${title ? '<h1 class="rmap-title">Shiman Federation</h1>' : ''}
    </header>` : ''}
    ${viewOnly ? '' : `<div class="rmap-tools">
      <div class="rmap-seg" role="group" aria-label="Map style">
        <button data-style="topo"${style === 'topo' ? ' class="active"' : ''}>Topographic</button>
        <button data-style="painted"${style === 'painted' ? ' class="active"' : ''}>Painted</button>
      </div>
      <button class="rmap-btn" data-act="home">Whole region</button>
    </div>`}
    ${viewOnly ? '<div class="rmap-compass"><span class="rmap-needle"></span></div>'
      : '<button class="rmap-compass" data-act="north" aria-label="North up"><span class="rmap-needle"></span><b>N</b></button>'}
    <div class="rmap-loading">Loading the map…</div>`;
  const $ = sel => root.querySelector(sel);
  const canvas = $('.rmap-canvas');
  const labelLayer = $('.rmap-labels');

  // How it's drawn. The edges are smoothed (antialias) only on an ordinary screen with the graphics card at work -- a
  // sharp screen (MacBook, phone) needs none, and without the card it costs too much.
  const gpu = graphicsInfo();
  const sharpRatio = Math.min(window.devicePixelRatio || 1, 2);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !gpu.software && sharpRatio < 1.5, alpha: true });
  renderer.setPixelRatio(sharpRatio);
  // While the map moves it's drawn as finely as this device keeps up with: these levels, stepped down when the frames
  // come too slowly (and kept for the visit); still, it's always drawn at its best. Without the graphics card it
  // starts two levels down.
  const LEVELS = [
    { ratio: sharpRatio, coarse: false },
    { ratio: Math.min(sharpRatio, 1), coarse: false },
    { ratio: Math.min(sharpRatio, 1), coarse: true },
    { ratio: Math.min(sharpRatio, 1) * 0.6, coarse: true },
  ];
  const REST = gpu.software ? 1 : 0;   // still: the best -- without the card one notch less, or each stop would stall
  let movingLevel = gpu.software ? 2 : 0;
  let drawnLevel = 0;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 1, 20000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.screenSpacePanning = false;     // moving slides over the land, not up into the sky
  controls.zoomToCursor = true;
  controls.maxPolarAngle = 1.2;             // never under the horizon
  controls.rotateSpeed = 0.6;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  controls.enabled = !viewOnly;

  let land = null;          // { W, H, metres, kind, vert }
  let places = null;
  let mesh = null;
  const geometries = {};    // the land's surface: fine, and coarse (while moving on a slow device)
  const textures = {};
  let dirty = true;
  let flight = null;
  let follow = null;        // view only: the camera easing towards the last view it was sent
  let lastView = null;      // ... and that view, put back when the screen changes size
  let lastTick = 0;
  let frame = 0;
  let destroyed = false;
  const labels = [];

  // Painting pixel -> world: x to the east, z to the south, y up (metres scaled by vert).
  const toWorld = (x, y, metres = 0) => new THREE.Vector3(x - land.W / 2, Math.max(metres, 0) * land.vert, y - land.H / 2);
  function heightAt(x, y) {
    const i = Math.min(land.H - 1, Math.max(0, Math.round(y))) * land.W + Math.min(land.W - 1, Math.max(0, Math.round(x)));
    return land.kind[i] === 0 ? 0 : land.metres[i];
  }

  /** The land's surface on a grid every `step` pixels. */
  function gridGeometry(step) {
    const { W, H, metres, kind, vert } = land;
    const cols = Math.ceil((W - 1) / step) + 1;
    const rows = Math.ceil((H - 1) / step) + 1;
    const pos = new Float32Array(cols * rows * 3);
    const uv = new Float32Array(cols * rows * 2);
    for (let r = 0; r < rows; r++) {
      const py = Math.min(H - 1, r * step);
      for (let c = 0; c < cols; c++) {
        const px = Math.min(W - 1, c * step);
        const i = py * W + px;
        const k = r * cols + c;
        const m = kind[i] === 0 ? 0 : metres[i];
        pos.set([px - W / 2, Math.max(m, 0) * vert, py - H / 2], k * 3);
        uv.set([px / (W - 1), 1 - py / (H - 1)], k * 2);
      }
    }
    const index = [];
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
        index.push(a, d, b, b, d, e);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(index);
    return { geo, pos, cols, rows };
  }

  /** The land as one mesh (every STEP pixels, and a coarser one, every 2 x STEP, swapped in while moving on a slow
   * device), with the block's sides going down under the sea. */
  function buildMesh(texture) {
    const { W, H } = land;
    const { geo, pos, cols, rows } = gridGeometry(STEP);
    geometries.fine = geo;
    geometries.coarse = gridGeometry(STEP * 2).geo;
    mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: texture }));
    scene.add(mesh);

    // the block: four sides hanging from the mesh's edge (up to the land where the painting cuts through it) and a
    // bottom, the dark blue of deep water
    const side = new THREE.MeshBasicMaterial({ color: 0x14365f, side: THREE.DoubleSide });
    const bottom = -BLOCK;
    const edge = (ks) => {
      const p = new Float32Array(ks.length * 6);
      ks.forEach((k, i) => {
        p.set([pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]], i * 6);
        p.set([pos[k * 3], bottom, pos[k * 3 + 2]], i * 6 + 3);
      });
      const idx = [];
      for (let i = 0; i < ks.length - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 2, i * 2 + 1, i * 2 + 3);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      g.setIndex(idx);
      scene.add(new THREE.Mesh(g, side));
    };
    const range = (n, f) => Array.from({ length: n }, (_, i) => f(i));
    edge(range(cols, c => c));                                  // north
    edge(range(cols, c => (rows - 1) * cols + c));              // south
    edge(range(rows, r => r * cols));                           // west
    edge(range(rows, r => r * cols + cols - 1));                // east
    const base = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ color: 0x0c2240, side: THREE.DoubleSide }));
    base.rotation.x = -Math.PI / 2;
    base.position.y = bottom;
    scene.add(base);
  }

  // ---------------------------------------------------------------------------
  // Labels: HTML over the canvas, placed where their spot is on screen after every draw
  // ---------------------------------------------------------------------------

  function buildLabels() {
    const add = (kind, name, x, y, lift) => {
      const el = document.createElement(kind === 'town' ? 'button' : 'div');
      el.className = `rmap-label ${kind}`;
      if (kind === 'town') { el.innerHTML = `<span class="rmap-pin"></span><span class="rmap-name">${esc(name)}</span>`; el.dataset.fly = labels.length; }
      else if (kind === 'spot') el.innerHTML = '<span class="rmap-spot"></span>';
      else el.textContent = name;
      labelLayer.appendChild(el);
      labels.push({ el, kind, x, y, at: toWorld(x, y, heightAt(x, y) + lift) });
    };
    places.towns.forEach(t => add('town', t.name, t.x, t.y, 40));
    places.spots.forEach(s => add('spot', '', s.x, s.y, 25));
    places.water.forEach(w => add('water', w.name, w.x, w.y, 0));
  }

  const v = new THREE.Vector3();
  function placeLabels() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const dist = camera.position.distanceTo(controls.target);
    for (const l of labels) {
      v.copy(l.at).project(camera);
      const visible = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      l.el.style.display = visible ? '' : 'none';
      if (!visible) continue;
      l.el.style.transform = `translate(${((v.x + 1) / 2 * w).toFixed(1)}px, ${((1 - v.y) / 2 * h).toFixed(1)}px)`;
      // from far away only the towns: the spots and the sea names come in closer
      if (l.kind !== 'town') l.el.classList.toggle('far', dist > land.fit * 0.75);
    }
  }

  // ---------------------------------------------------------------------------
  // The camera
  // ---------------------------------------------------------------------------

  /** Where the camera stands for `target`, `distance` away, `polar` from straight down, turned `azimuth`. */
  function viewFrom(target, distance, polar, azimuth) {
    const s = new THREE.Spherical(distance, polar, azimuth);
    return new THREE.Vector3().setFromSpherical(s).add(target);
  }

  /** Flies the camera there turning, tilting and zooming round the map (the short way round) -- not in a straight line,
   * which would cut through over the middle on a big turn. */
  function flyTo(target, distance, polar, azimuth, ms = 900) {
    flight = {
      t0: performance.now(), ms,
      fromTarget: controls.target.clone(), toTarget: target,
      fromDist: camera.position.distanceTo(controls.target), toDist: distance,
      fromPolar: controls.getPolarAngle(), toPolar: polar,
      fromAz: controls.getAzimuthalAngle(), turn: wrapAngle(azimuth - controls.getAzimuthalAngle()),
    };
    wake();
  }

  /** The whole island in view, tilted a little, turned the way it is now (or `azimuth`). */
  function home({ ms = 900, azimuth = controls.getAzimuthalAngle() } = {}) {
    if (!land) return;
    const t = new THREE.Vector3(land.cx - land.W / 2, 0, land.cy - land.H / 2);
    flyTo(t, fitFor(azimuth), 0.55, azimuth, ms);
  }

  function stepFlight(now) {
    const k = flight.ms > 0 ? Math.min(1, (now - flight.t0) / flight.ms) : 1;
    const e = ease(k);
    const f = flight;
    placeCamera(new THREE.Vector3().lerpVectors(f.fromTarget, f.toTarget, e),
      f.fromDist * (f.toDist / f.fromDist) ** e,   // zooms evenly, however far it goes
      f.fromPolar + (f.toPolar - f.fromPolar) * e,
      f.fromAz + f.turn * e);
    if (k >= 1) flight = null;
    return true;
  }

  const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;

  function getView() {
    if (!land) return null;
    const t = controls.target;
    return {
      x: round(t.x + land.W / 2, 1), y: round(t.z + land.H / 2, 1),
      zoom: round(camera.position.distanceTo(t) / land.fit, 4),
      polar: round(controls.getPolarAngle(), 4), azimuth: round(controls.getAzimuthalAngle(), 4), style,
    };
  }

  /** The view as camera numbers for this screen. */
  function goalOf(view) {
    return {
      target: new THREE.Vector3(Number(view.x) - land.W / 2, 0, Number(view.y) - land.H / 2),
      dist: Math.max(controls.minDistance, Math.min(controls.maxDistance, Number(view.zoom) * land.fit)),
      polar: Math.max(0, Math.min(controls.maxPolarAngle, Number(view.polar))),
      azimuth: wrapAngle(Number(view.azimuth)),
    };
  }

  function placeCamera(target, dist, polar, azimuth) {
    controls.target.copy(target);
    camera.position.copy(viewFrom(target, dist, polar, azimuth));
    camera.lookAt(target);
  }

  /** Shows `view` -- at once, or (`smooth`) easing there from where the camera is, so a stream of views sent a few
   * times a second plays as one movement. */
  function setView(view, { smooth = false } = {}) {
    if (!view || !['x', 'y', 'zoom', 'polar', 'azimuth'].every(k => Number.isFinite(Number(view[k])))) return;
    lastView = view;
    if (STYLES[view.style] && view.style !== style) setStyle(view.style);
    if (!land) return; // put in place once loaded
    flight = null;
    const goal = goalOf(view);
    if (smooth && root.clientWidth) {
      follow = goal;
    } else {
      follow = null;
      placeCamera(goal.target, goal.dist, goal.polar, goal.azimuth);
      dirty = true;
    }
    wake();
  }

  /** One frame of easing towards `follow` (about a seventh of a second to cover most of the way). */
  function stepFollow(now) {
    const k = 1 - Math.exp(-Math.min(100, now - (lastTick || now)) / 140);
    const t = controls.target.clone().lerp(follow.target, k);
    const d0 = camera.position.distanceTo(controls.target);
    const dist = d0 * (follow.dist / d0) ** k;
    const polar = controls.getPolarAngle() + (follow.polar - controls.getPolarAngle()) * k;
    const az0 = controls.getAzimuthalAngle();
    const azimuth = az0 + wrapAngle(follow.azimuth - az0) * k;
    const done = t.distanceTo(follow.target) < 0.2 && Math.abs(dist / follow.dist - 1) < 0.002
      && Math.abs(polar - follow.polar) < 0.001 && Math.abs(wrapAngle(follow.azimuth - azimuth)) < 0.001;
    if (done) placeCamera(follow.target, follow.dist, follow.polar, follow.azimuth);
    else placeCamera(t, dist, polar, azimuth);
    if (done) follow = null;
    return true;
  }

  // The target stays over the map.
  function clampTarget() {
    const t = controls.target;
    const mx = land.W / 2, mz = land.H / 2;
    const cx = Math.max(-mx, Math.min(mx, t.x)), cz = Math.max(-mz, Math.min(mz, t.z));
    if (cx !== t.x || cz !== t.z || t.y !== 0) {
      camera.position.x += cx - t.x; camera.position.z += cz - t.z;
      t.set(cx, 0, cz);
    }
  }

  /** How far back the camera stands to see the whole island on this screen (its height and its width), turned
   * `azimuth` -- sideways on a wide screen it can come closer. */
  function fitFor(azimuth = 0) {
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const c = Math.abs(Math.cos(azimuth)), s = Math.abs(Math.sin(azimuth));
    const spanX = land.sizeX * c + land.sizeZ * s + 300;   // room for the names at the island's edges
    const spanZ = land.sizeX * s + land.sizeZ * c + 160;
    return Math.max(spanZ / (2 * tanV), spanX / (2 * tanV * camera.aspect)) * 0.95;
  }

  function resize() {
    const w = root.clientWidth, h = root.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (land) {
      land.fit = fitFor(0); // what a view's zoom is a share of
      controls.maxDistance = Math.max(land.fit, fitFor(Math.PI / 2)) * 1.8;
      if (viewOnly && lastView) setView(lastView); // the same view on the new shape
    }
    dirty = true;
    wake();
  }

  // Drawn only while something moves: the loop runs while the controls are settling or a flight is on, then stops.
  let quiet = 0;
  function tick(now) {
    frame = 0;
    if (destroyed) return;
    let moved = flight ? stepFlight(now) : follow ? stepFollow(now) : false;
    lastTick = now;
    if (controls.update()) moved = true;
    clampTarget();
    if ((moved || dirty) && !root.clientWidth) {
      dirty = true; // put away (the board screen during a battle): drawn when it's back (the resize wakes it)
      quiet++;
    } else if (moved || dirty) {
      if (moved) keepUp(now);
      useLevel(moved ? Math.max(movingLevel, REST) : REST);
      renderer.render(scene, camera);
      placeLabels();
      const az = controls.getAzimuthalAngle();
      $('.rmap-needle').style.transform = `rotate(${(az * 180 / Math.PI).toFixed(1)}deg)`;
      $('.rmap-compass').classList.toggle('off-north', Math.abs(az) > 0.02);
      if (moved && onView) onView(getView());
      dirty = false;
      quiet = 0;
    } else {
      quiet++;
      lastDraw = 0;
      // come to rest after moving at a lower level: drawn once more at its best
      if (drawnLevel !== REST && root.clientWidth) {
        useLevel(REST);
        renderer.render(scene, camera);
      }
    }
    if (quiet < 30) frame = requestAnimationFrame(tick);
    else lastTick = 0;
  }

  // Keeping up: the time between frames drawn one after the other while moving. Several in a row slower than ~30 a
  // second: the next level down, for the rest of the visit.
  let lastDraw = 0, slowAvg = 0, slowCount = 0;
  function keepUp(now) {
    if (lastDraw && now - lastDraw < 250) {
      const dt = now - lastDraw;
      slowAvg = slowCount ? slowAvg * 0.75 + dt * 0.25 : dt;
      slowCount++;
      if (slowCount >= 8 && slowAvg > 36 && movingLevel < LEVELS.length - 1) {
        movingLevel++;
        slowCount = 0;
      }
    }
    lastDraw = now;
  }

  function useLevel(n) {
    if (n === drawnLevel) return;
    drawnLevel = n;
    const { ratio, coarse } = LEVELS[n];
    if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio);
    if (mesh) mesh.geometry = coarse ? geometries.coarse : geometries.fine;
  }
  function wake() {
    quiet = 0;
    if (!frame && !destroyed) frame = requestAnimationFrame(tick);
  }
  controls.addEventListener('start', wake);
  controls.addEventListener('change', wake);
  canvas.addEventListener('wheel', wake, { passive: true });
  canvas.addEventListener('pointerdown', wake);
  // A weak device can take the 3D drawing away (short on graphics memory, say while the battle map plays its videos);
  // three.js sets it all up again when it's given back, and then it needs drawing again.
  canvas.addEventListener('webglcontextrestored', () => { dirty = true; wake(); });

  async function setStyle(next) {
    style = next;
    if (rememberStyle) {
      try { localStorage.setItem(STYLE_KEY, next); } catch (e) { /* not kept */ }
    }
    root.querySelectorAll('[data-style]').forEach(b => b.classList.toggle('active', b.dataset.style === next));
    root.classList.toggle('painted', next === 'painted'); // the painting has its own names and red dots
    if (!textures[next]) textures[next] = await loadTexture(renderer, STYLES[next]);
    if (style !== next || !mesh) return;
    mesh.material.map = textures[next];
    mesh.material.needsUpdate = true;
    dirty = true;
    wake();
  }

  root.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('[data-act="back"]')) { onBack?.(); return; }
    if (t.closest('[data-act="home"]')) { home(); return; }
    if (t.closest('[data-act="north"]')) {
      const dist = camera.position.distanceTo(controls.target);
      flyTo(controls.target.clone(), dist, controls.getPolarAngle(), 0, 600);
      return;
    }
    const styleBtn = t.closest('[data-style]');
    if (styleBtn) {
      setStyle(styleBtn.dataset.style);
      if (onView && land) onView(getView());
      return;
    }
    const town = t.closest('[data-fly]');
    if (town) {
      const l = labels[Number(town.dataset.fly)];
      flyTo(toWorld(l.x, l.y), land.fit * 0.28, 0.85, controls.getAzimuthalAngle());
    }
  });

  const observer = new ResizeObserver(resize);

  async function load() {
    places = await (await fetch(`${BASE}places.json`)).json();
    const first = style;
    const [heights, texture] = await Promise.all([loadHeights(places.seaOffset), loadTexture(renderer, STYLES[first])]);
    if (destroyed) return;
    textures[first] = texture;
    land = { ...heights, vert: EXAG / (KM_PER_PX * 1000) };
    // the land's middle and how far back the camera has to be to see all of it
    let minX = heights.W, maxX = 0, minY = heights.H, maxY = 0;
    for (let y = 0; y < heights.H; y += 4) {
      for (let x = 0; x < heights.W; x += 4) {
        if (heights.kind[y * heights.W + x] !== 0) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      }
    }
    land.cx = (minX + maxX) / 2;
    land.cy = (minY + maxY) / 2;
    land.sizeX = maxX - minX;
    land.sizeZ = maxY - minY;
    controls.minDistance = 60;
    buildMesh(texture);
    if (style !== first) setStyle(style); // a view with the other style came in while loading
    buildLabels();
    observer.observe(root);
    resize();
    if (!land.fit) {
      // put away while loading (the board screen during a battle): sized for a 16:9 screen until it's shown
      camera.aspect = 16 / 9;
      camera.updateProjectionMatrix();
      land.fit = fitFor(0);
      controls.maxDistance = Math.max(land.fit, fitFor(Math.PI / 2)) * 1.8;
    }
    const middle = new THREE.Vector3(land.cx - land.W / 2, 0, land.cy - land.H / 2);
    placeCamera(middle, land.fit, 0.55, 0);
    flight = null;
    if (lastView) setView(lastView);
    controls.update();
    dirty = true;
    wake();
    $('.rmap-loading').remove();
  }

  function destroy() {
    destroyed = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    controls.dispose();
    scene.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
    Object.values(geometries).forEach(g => g.dispose());
    Object.values(textures).forEach(t => t.dispose());
    renderer.dispose();
  }

  const ready = load().catch((err) => {
    const box = $('.rmap-loading');
    if (box) box.textContent = `Couldn't load the map: ${err.message}`;
    throw err;
  });
  return { ready, destroy, getView, setView, home, graphics: gpu };
}
