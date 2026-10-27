// The region map in 3D: the Shiman Federation as a block of land you can turn, tilt, zoom and move -- our own take on
// the 3D map in Benjakronk's Nynorsk course. Shima is invented, so its heights come from his painted map
// (tools/region-map/make_terrain.py writes assets/region-map/: the height map, the topographic and the painted map
// pictures, and places.json with the towns and the red spots) -- or from a newer painting the DM uploaded (the user's
// call, 2026-10-20: js/region-map/map-version.js says which map is in use, js/dm/map-upload.js makes them).
//
// Drag to move, scroll / pinch to zoom, right-drag / two fingers to turn and tilt (the user's call, 2026-10-20: moving
// is what the left button does on any other map). Only drawn while something moves, so it
// costs nothing while it's left alone.
//
// Self-contained so it can live in its own page (region-map.html) or be mounted elsewhere -- the DM console's PokeNav
// steers it (onView) and the table's board screen (battle-map.html) shows it view only, following along (setView):
// mountRegionMap(root, { onBack, viewOnly, title, rememberStyle, onView, loadingText }) -> { ready, destroy, getView, setView, home,
// setLocations, highlight, setParty, flyToLocation, mapId (the map it shows, once ready), graphics: {renderer, software} }.
// Its names are the DM's locations (setLocations -- the Admin module's Locations tab, each with a `shape` on the map,
// js/dm/location-map.js) once it's given them, the towns in places.json until then; a highlighted location is drawn
// onto the land (a glowing line along a route, a forest shaded and outlined, a ring round a town). Where the party is
// (setParty, the user's call, 2026-10-20) has the players' marker standing on it -- nothing else drawn, the map as
// bright as ever. A minor location's name (not ticked Major, map-version.js isMajor) only shows zoomed in. A route or a forest the DM only looks at (highlight) is drawn in light blue (a town or a cave
// isn't: its own pin is enough, and a ring over it looked odd).
// A location with an icon (the user's call, 2026-10-20: a little model of the place the DM uploads, js/dm/location-icon.js)
// has it standing on its mark facing south, the way the painting's towns are drawn (the user's call, 2026-10-21: it stays
// put as the map turns, never turning round to face the viewer -- only leaning back as the map's tilted towards straight
// down, so it's still seen from above), as tall as the DM set in km -- so it grows and shrinks with the land as the map
// zooms, and keeps to scale with the others. A location with a 3D model as well (the user's call, 2026-10-25: a .glb
// beside its picture on the Pi, "City-Astria.glb" by "City-Astria.png") has the model standing there instead -- the
// picture stays the fallback, shown while the model loads and wherever there's none.
// Trees, rocks and peaks stand on the land, made in code (map-objects.js; not without the graphics card).
// A view is { x, y (the painting pixel in the middle), zoom (the distance as a share of the whole-island one), polar,
// azimuth, style }. Styles: css/region-map.css (.rmap-*).
import * as THREE from '../vendor/three/three.module.min.js';
import { OrbitControls } from '../vendor/three/OrbitControls.js';
import { shapeBounds, iconSpot } from './map-features.js';
import { currentMap, isMajor, partOfChain, FIRST_ID } from './map-version.js';
import { addLandDetail } from './land-detail.js';
import { addSea, seaInfoTexture, LONGEST_WAVE, FADE } from './sea.js';
import { buildMapObjects, findPlaces, MODEL_KINDS } from './map-objects.js';
import { DmAPI } from '../api.js';

const BASE = 'assets/region-map/';
// (one pixel of the first painting is 120 m: the island is ~110 x 200 km -- each map says its own, kmPerPx)
const EXAG = 3;              // the heights exaggerated, so the mountains read from the air
const STEP = 3;              // one corner of the land's mesh every this many pixels
const BLOCK = 60;            // how deep the block of land goes under the sea
const PIN_POLAR = 0.5;       // how far from straight down a flight to a town looks (radians)
const STYLES = { topo: 'topo', painted: 'painted' };   // ...the map's files
const STYLE_KEY = 'rmapStyle';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));

/** The height map as tables: metres and what's there (0 sea, 1 land, 2 lake, 3 river) per painting pixel. */
async function loadHeights(url, seaOffset) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Couldn't load the map's heights");
  const blob = await res.blob();
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

function loadTexture(renderer, url) {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      resolve(tex);
    }, undefined, () => reject(new Error("Couldn't load the map's picture")));
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

/** Whether the box (x0, y0)-(x1, y1) is inside the rings (even-odd, so a hole is outside): its middle inside, and no
 * edge of the rings through it. */
function boxInside(rings, x0, y0, x1, y1) {
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  let inside = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [ax, ay] = r[i], [bx, by] = r[j];
      if ((ay > my) !== (by > my) && mx < ((bx - ax) * (my - ay)) / (by - ay) + ax) inside = !inside;
      if (segmentInBox(ax, ay, bx, by, x0, y0, x1, y1)) return false;
    }
  }
  return inside;
}

/** Whether the line from (ax, ay) to (bx, by) passes through the box (Liang-Barsky). */
function segmentInBox(ax, ay, bx, by, x0, y0, x1, y1) {
  const dx = bx - ax, dy = by - ay;
  let t0 = 0, t1 = 1;
  for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return true;
}

export function mountRegionMap(root, { onBack, viewOnly = false, title = true, rememberStyle = true, onView, homeAzimuth = null, turned = false, onPick, loadingText = 'Loading the map…' } = {}) {
  // `onPick(locationId)` (the players' PokéNav, the user's call, 2026-10-21): a location's name or icon tapped -- the map
  // flies there and lights it up, and this is told (to show what's there).
  // `turned` (the DM's PokeNav, the user's call, 2026-10-20): this screen is the table's 16:9 board screen seen from the
  // players' side -- portrait, a quarter turn round. The views it sends and takes stay the board's own (its azimuth and
  // zoom); only this screen shows them turned, and as far back as the board's long side needs.
  const TURN = turned ? -Math.PI / 2 : 0;
  const BOARD_LONG = 16 / 9;
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
      : `<button class="rmap-compass" data-act="north" aria-label="${homeAzimuth == null ? 'North up' : 'Back to the default view'}" title="${homeAzimuth == null ? 'North up' : 'Back to the default view'}"><span class="rmap-needle"></span><b>N</b></button>`}
    <div class="rmap-loading">${loadingText}</div>`;
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
  // The light the objects (map-objects.js, the locations' models) are lit by: from the north-west and high, as the land's
  // own relief is shaded (land-detail.js) -- the land itself is the painting's colours, not lit.
  scene.add(new THREE.HemisphereLight(0xfffaf0, 0x5a4e3c, 2.1));
  const sun = new THREE.DirectionalLight(0xfff3dc, 2.3);
  sun.position.set(-0.62, 1, -0.55);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(40, 1, 1, 20000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.25;            // close behind the finger, a short glide after it
  controls.screenSpacePanning = false;     // moving slides over the land, not up into the sky
  controls.zoomToCursor = true;
  controls.maxPolarAngle = 1.2;             // never under the horizon
  controls.rotateSpeed = 0.6;
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  controls.enabled = !viewOnly;

  let land = null;          // { W, H, metres, kind, vert }
  let places = null;
  let version = null;       // the map shown (map-version.js)
  let mesh = null;
  const geometries = {};    // the land's surface: fine, and coarse (while moving on a slow device)
  const textures = {};
  let dirty = true;
  const seaTime = { value: 0 };   // the sea's waves (sea.js): seconds, moved on while they can be seen (seaMoves)
  let seaTimer = 0;
  let seaDue = false;
  // The waves come to rest once nothing's moved on the map for a while -- the board screen left on the sea all evening
  // (the user's call, 2026-10-27) -- and go on as soon as anything does
  const SEA_REST_MS = 3 * 60 * 1000;
  let lastActive = performance.now();
  let seaInfo = null;             // ...and how far its water is from the coast (a texture)
  let flight = null;
  let follow = null;        // view only: the camera easing towards the last view it was sent
  let lastView = null;      // ... and that view, put back when the screen changes size
  let lastTick = 0;
  let frame = 0;
  let destroyed = false;
  const labels = [];
  let locations = null;     // the DM's locations (setLocations), or null: the towns in places.json
  let highlighted = null;   // the id of the location drawn onto the land (the DM looking at it)
  let partyAt = null;       // the id of the location the party is at (outlined in gold, marked)
  let overlay = null;       // ...drawn here: { canvas, ctx, tex, mesh } -- the land's surface again, see-through
  const icons = [];         // the locations' icons standing on the land (pictures facing south)
  // one square, standing up facing south (+z, down the painting), every icon a copy of it scaled to its picture
  const iconPlane = new THREE.PlaneGeometry(1, 1);
  const iconTextures = {};  // their pictures, by URL (a promise each)
  const models = [];        // the locations' 3D models standing on the land (in place of their icons' pictures)
  const modelScenes = {};   // the models, by URL (a promise each: the loaded scene, or why not)
  let objects = null;       // the trees, rocks and peaks (map-objects.js), once made

  // Painting pixel -> world: x to the east, z to the south, y up (metres scaled by vert).
  const toWorld = (x, y, metres = 0) => new THREE.Vector3(x - land.W / 2, Math.max(metres, 0) * land.vert, y - land.H / 2);
  function heightAt(x, y) {
    const i = Math.min(land.H - 1, Math.max(0, Math.round(y))) * land.W + Math.min(land.W - 1, Math.max(0, Math.round(x)));
    return land.kind[i] === 0 ? 0 : land.metres[i];
  }

  /** The land's surface at painting pixel (x, y) in world units, exactly as the fine mesh has it (its two triangles a
   * square, gridGeometry) -- what's stood on it neither floats nor sinks between the mesh's corners. */
  function groundAt(x, y) {
    const { W, H, kind, metres, vert } = land;
    const cols = Math.ceil((W - 1) / STEP) + 1, rows = Math.ceil((H - 1) / STEP) + 1;
    const c = Math.min(cols - 2, Math.max(0, Math.floor(x / STEP)));
    const r = Math.min(rows - 2, Math.max(0, Math.floor(y / STEP)));
    const at = (rr, cc) => {
      const i = Math.min(H - 1, rr * STEP) * W + Math.min(W - 1, cc * STEP);
      return Math.max(kind[i] === 0 ? 0 : metres[i], 0) * vert;
    };
    const x0 = c * STEP, y0 = r * STEP;
    const fx = Math.min(1, Math.max(0, (x - x0) / (Math.min(W - 1, x0 + STEP) - x0)));
    const fy = Math.min(1, Math.max(0, (y - y0) / (Math.min(H - 1, y0 + STEP) - y0)));
    const a = at(r, c), b = at(r, c + 1), d = at(r + 1, c), e = at(r + 1, c + 1);
    return fx + fy <= 1 ? a + (b - a) * fx + (d - a) * fy : e + (d - e) * (1 - fx) + (b - e) * (1 - fy);
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
    geo.computeVertexNormals(); // the slope, smooth from corner to corner (land-detail.js)
    return { geo, pos, cols, rows };
  }

  /** The land as one mesh (every STEP pixels, and a coarser one, every 2 x STEP, swapped in while moving on a slow
   * device), with the block's sides going down under the sea. */
  function buildMesh(texture) {
    const { W, H } = land;
    const { geo, pos, cols, rows } = gridGeometry(STEP);
    geometries.fine = geo;
    geometries.coarse = gridGeometry(STEP * 2).geo;
    const material = new THREE.MeshBasicMaterial({ map: texture });
    if (!gpu.software) addLandDetail(material); // made-up detail up close (land-detail.js) -- too costly without the card
    if (!gpu.software) {
      seaInfo = seaInfoTexture(land);
      addSea(material, { info: seaInfo, size: [land.W, land.H], time: seaTime }); // (sea.js)
    }
    mesh = new THREE.Mesh(geo, material);
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
    labels.forEach(l => l.el.remove());
    labels.length = 0;
    const add = (kind, name, x, y, lift, { locId = null, extra = '' } = {}) => {
      const el = document.createElement(kind === 'town' || kind === 'region' ? 'button' : 'div');
      el.className = `rmap-label ${kind}${extra}`;
      if (kind === 'town') el.innerHTML = `<span class="rmap-pin"></span><span class="rmap-name">${esc(name)}</span>`;
      else if (kind === 'spot') el.innerHTML = '<span class="rmap-spot"></span>';
      // the players' marker (assets/MapMarker.png, the user's pixel-art trainer, kept 32 x 32 here and drawn crisp)
      else if (kind === 'party') el.innerHTML = `<img class="rmap-party-marker" src="${BASE}party-marker.png" alt="The party">`;
      else el.textContent = name;
      if (kind === 'town' || kind === 'region') el.dataset.fly = labels.length;
      labelLayer.appendChild(el);
      labels.push({ el, kind, x, y, locId, at: toWorld(x, y, heightAt(x, y) + lift) });
    };
    if (locations) {
      // A spot (a city, a cave) as a town's pin; a route's or a forest's name on its middle, in closer (like the sea's).
      // A town the painting already names (one of places.json's, where it is) keeps only its pin on the painted map --
      // only the first painting has the names painted on (an uploaded one carries the towns along for the land, not
      // their names: the user's call, 2026-10-20, every name hidden there), and a location with its own icon covers the
      // painted town, so it keeps its name.
      const painted = (l, b) => version?.id === FIRST_ID && !l.icon?.url && places.towns.some(t => t.name.toLowerCase() === String(l.name || '').trim().toLowerCase() && Math.hypot(t.x - b.mid[0], t.y - b.mid[1]) < 40);
      // A location with an icon: its name (and the party's marker) placed from the icon's own middle -- on the ground,
      // not lifted like the others' -- so tilted, it's still exactly under the picture / on it (the user's call,
      // 2026-10-20: lifted, the name came out over the bottom of the icon and the marker north of it).
      const liftOf = (l, lift) => (l.icon?.url ? 0 : lift);
      locations.forEach((l) => {
        const b = shapeBounds(l.shape);
        if (!b) return;
        const minor = isMajor(l) ? '' : ' minor';
        if (l.shape.kind === 'pin') add('town', l.name || '', b.mid[0], b.mid[1], liftOf(l, 40), { locId: l.id, extra: `${['cave', 'landmark', 'building'].includes(l.type) ? ` ${l.type}` : ''}${painted(l, b) ? ' on-painting' : ''}${minor}` });
        else add('region', l.name || '', b.mid[0], b.mid[1], liftOf(l, 30), { locId: l.id, extra: ` ${l.shape.kind}${minor}${l.icon?.url ? ' has-icon' : ''}${l.type === 'region' ? ' realm' : ''}` });
        // a region's name kept inside the region (fitRealmName): its outline on the land, a few hundred points at most
        if (l.type === 'region' && l.shape.kind === 'area') {
          labels[labels.length - 1].border = (l.shape.rings || []).filter(r => r.length > 2).map((r) => {
            const every = Math.ceil(r.length / 160);
            return r.filter((_, i) => i % every === 0).map(([x, y]) => toWorld(x, y, heightAt(x, y)));
          });
        }
      });
    } else {
      places.towns.forEach(t => add('town', t.name, t.x, t.y, 40, { extra: version?.id === FIRST_ID ? ' on-painting' : '' }));
    }
    places.spots.forEach(s => add('spot', '', s.x, s.y, 25));
    places.water.forEach(w => add('water', w.name, w.x, w.y, 0));
    // the party's marker: standing on its location's spot, or on its icon (region-map.css puts it there, whatever the
    // zoom)
    const party = partyAt && locations?.find(l => l.id === partyAt);
    const pb = shapeBounds(party?.shape);
    if (pb) add('party', '', pb.mid[0], pb.mid[1], party.icon?.url ? 0 : party.shape.kind === 'pin' ? 40 : 30);
    markLabels();
    dirty = true;
    wake();
  }

  // ---------------------------------------------------------------------------
  // A location drawn onto the land: a picture the painting's shape (twice its size, like the map pictures), laid over
  // the land's surface
  // ---------------------------------------------------------------------------

  function buildOverlay() {
    const c = document.createElement('canvas');
    c.width = land.W * 2;
    c.height = land.H * 2;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const m = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    m.renderOrder = 1;
    m.visible = false;
    scene.add(m);
    overlay = { canvas: c, ctx: c.getContext('2d'), tex, mesh: m };
    drawOverlay();
  }

  /** The highlighted location and the ones it's part of (a sawmill and its forest: lit together), itself first. */
  function litChain() {
    const l = highlighted && locations?.find(x => x.id === highlighted);
    return l ? partOfChain(l, locations) : [];
  }

  function markLabels() {
    const ids = litChain().map(l => l.id);
    labels.forEach((l) => {
      l.el.classList.toggle('lit', !!l.locId && ids.includes(l.locId));
    });
  }

  /** The shape's own path on the overlay picture (scaled `k`): an area's outline, a line, or a ring round a spot. */
  function tracePathOf(ctx, shape, k, ring = 30) {
    ctx.beginPath();
    if (shape.kind === 'area') shape.rings.forEach((r) => { r.forEach(([x, y], i) => (i ? ctx.lineTo(x * k, y * k) : ctx.moveTo(x * k, y * k))); ctx.closePath(); });
    else if (shape.kind === 'path') shape.points.forEach(([x, y], i) => (i ? ctx.lineTo(x * k, y * k) : ctx.moveTo(x * k, y * k)));
    else ctx.arc(shape.x * k, shape.y * k, ring, 0, Math.PI * 2);
  }

  /** One location drawn: shaded and outlined (an area, a spot's ring) or a glowing line (a route), in `colour`. */
  function drawLit(ctx, shape, k, colour, fill) {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    tracePathOf(ctx, shape, k);
    if (shape.kind !== 'path') { ctx.fillStyle = fill; ctx.fill('evenodd'); }
    ctx.lineWidth = shape.kind === 'path' ? 16 : shape.kind === 'pin' ? 12 : 9;
    ctx.strokeStyle = 'rgba(30, 20, 0, 0.55)';
    ctx.stroke();
    ctx.lineWidth = shape.kind === 'path' ? 8 : shape.kind === 'pin' ? 7 : 4.5;
    ctx.strokeStyle = colour;
    ctx.stroke();
    ctx.restore();
  }

  /** A region looked at: the land in it lightly brightened, soft at the edge -- no outline (the user's call, 2026-10-21:
   * no painted lines, just the land lit a little), and never the sea (the land's own sea, `kind` 0, is cut out). */
  function drawRegionTint(ctx, shape, k) {
    const c = ctx.canvas;
    if (!overlay.landMask) {
      const m = document.createElement('canvas');
      m.width = land.W; m.height = land.H;
      const mc = m.getContext('2d');
      const img = mc.createImageData(land.W, land.H);
      for (let i = 0; i < land.kind.length; i++) img.data[i * 4 + 3] = land.kind[i] === 0 ? 0 : 255;
      mc.putImageData(img, 0, 0);
      overlay.landMask = m;
      overlay.tint = document.createElement('canvas');
    }
    const t = overlay.tint;
    if (t.width !== c.width || t.height !== c.height) { t.width = c.width; t.height = c.height; }
    const tc = t.getContext('2d');
    tc.clearRect(0, 0, t.width, t.height);
    // a light wash over all of it, and a soft glow just inside its edge (blurred, so it reads as light, not a line --
    // without canvas filters, a browser draws it sharp: a faint band, fine)
    tc.save();
    tracePathOf(tc, shape, k);
    tc.clip('evenodd');
    tc.fillStyle = 'rgba(255, 248, 222, 0.3)';
    tc.fillRect(0, 0, t.width, t.height);
    tc.filter = 'blur(12px)';
    tc.lineJoin = 'round';
    tc.lineWidth = 34;
    tc.strokeStyle = 'rgba(255, 250, 232, 0.6)';
    tracePathOf(tc, shape, k);
    tc.stroke();
    tc.restore();
    tc.globalCompositeOperation = 'destination-in';
    tc.imageSmoothingEnabled = true;
    tc.drawImage(overlay.landMask, 0, 0, t.width, t.height);
    tc.globalCompositeOperation = 'source-over';
    ctx.drawImage(t, 0, 0);
  }

  function drawOverlay() {
    markLabels();
    if (!overlay) return;
    const { canvas: c, ctx } = overlay;
    ctx.clearRect(0, 0, c.width, c.height);
    // what's looked at drawn on the land -- and what it's part of: a sawmill's forest outlined round it (the user's call,
    // 2026-10-20)
    // (a region -- a big stretch of the island -- only just tinted inside its outline)
    const looked = litChain().filter(l => shapeBounds(l.shape) && l.shape.kind !== 'pin');
    overlay.mesh.visible = looked.length > 0;
    const k = c.width / (land.W - 1);   // painting pixel -> picture pixel (the land's uv runs 0..W-1)
    // (the party's place has nothing drawn on it, nor the map round it dimmed -- the user's call, 2026-10-20: the
    // players' marker on it is enough)
    looked.reverse().forEach(l => (l.type === 'region' && l.shape.kind === 'area' ? drawRegionTint(ctx, l.shape, k) : drawLit(ctx, l.shape, k, '#8fd8ff', 'rgba(143, 216, 255, 0.28)')));
    overlay.tex.needsUpdate = true;
    dirty = true;
    wake();
  }

  // ---------------------------------------------------------------------------
  // The locations' icons: a picture with its middle on its spot, standing facing south -- turning with the map, not
  // towards the viewer (the user's call, 2026-10-21), leaning back with the camera's tilt (orientIcons) -- drawn over the
  // land (never hidden in a hillside) like the labels
  // ---------------------------------------------------------------------------

  function iconTexture(url) {
    if (!iconTextures[url]) {
      iconTextures[url] = new Promise((resolve, reject) => {
        new THREE.TextureLoader().load(url, (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
          resolve(tex);
        }, undefined, () => { delete iconTextures[url]; reject(new Error("Couldn't load an icon")); });
      });
    }
    return iconTextures[url];
  }

  function buildIcons() {
    icons.forEach((sp) => { scene.remove(sp); sp.material.dispose(); });
    icons.length = 0;
    models.forEach(m => scene.remove(m)); // (their shapes are kept with the loaded scene, for the next time)
    models.length = 0;
    (locations || []).forEach((l) => {
      const ic = l.icon;
      const at = ic?.url && iconSpot(l.shape);   // on its mark (map-features.js)
      if (!at) return;
      const [ix, iy] = at;
      const tall = (ic.size || 5) / land.kmPerPx;   // km -> painting pixels (the world's units across the land)
      // (both sides drawn: from the north it's seen from behind, as a cut-out would be)
      const bias = { value: 0 };
      const sp = new THREE.Mesh(iconPlane, iconMaterial(bias));
      // how far the ground round the spot (as far out as the picture reaches) rises above it, in the world's units --
      // a hillside under the picture mustn't hide it either (orientIcons)
      const ground = heightAt(ix, iy);
      let rise = 0;
      const reach = Math.ceil(tall * 0.6);
      for (let dy = -reach; dy <= reach; dy += 2) {
        for (let dx = -reach; dx <= reach; dx += 2) {
          if (dx * dx + dy * dy <= reach * reach) rise = Math.max(rise, heightAt(ix + dx, iy + dy) - ground);
        }
      }
      // its middle on the spot, the pin in the middle of the picture (the user's call, 2026-10-20) -- the name goes under
      // the picture (placeLabels: userData)
      sp.userData = { locId: l.id, tall, bias, rise: rise * land.vert };
      sp.renderOrder = 2;
      sp.visible = false;
      sp.position.copy(toWorld(ix, iy, heightAt(ix, iy)));
      scene.add(sp);
      icons.push(sp);
      iconTexture(ic.url).then((tex) => {
        if (!icons.includes(sp)) return;
        sp.material.map = tex;
        sp.material.needsUpdate = true;
        sp.scale.set((tall * tex.image.width) / Math.max(1, tex.image.height), tall, 1);
        orientIcons();
        sp.visible = !sp.userData.model; // (its model came first: that stands there)
        dirty = true;
        wake();
      }).catch(() => {});
      // its model, when there's one beside the picture: standing there in its place
      modelScene(ic.url).then((src) => {
        if (!icons.includes(sp)) return;
        standModel(sp, src, ix, iy);
      }).catch(() => {});
    });
    clearObjects();
    dirty = true;
    wake();
  }

  /** The model beside an icon's picture ("City-Astria.png" -> "City-Astria.glb"), loaded once -> its scene (rejected:
   * there's none, or it couldn't be read -- the picture stays). */
  function modelScene(iconUrl) {
    const url = String(iconUrl).replace(/\.[a-z0-9]+(\?.*)?$/i, '.glb');
    if (url === iconUrl) return Promise.reject(new Error('No model'));
    return gltfScene(url);
  }

  /** A .glb's scene, loaded once. */
  function gltfScene(url) {
    if (!modelScenes[url]) {
      modelScenes[url] = import('../vendor/three/GLTFLoader.js')
        .then(({ GLTFLoader }) => new GLTFLoader().loadAsync(url))
        .then(gltf => gltf.scene);
    }
    return modelScenes[url];
  }

  /** A location's model on its spot, in place of its icon's picture: its base on the land, facing south as it was made
   * (a .glb's front is +z), as big as the icon -- its biggest side as long as the picture is tall. */
  function standModel(sp, src, ix, iy) {
    const box = new THREE.Box3().setFromObject(src);
    const size = box.getSize(new THREE.Vector3());
    const biggest = Math.max(size.x, size.y, size.z);
    if (!(biggest > 0)) return;
    const inner = src.clone(true);
    inner.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
    const k = sp.userData.tall / biggest;
    const model = new THREE.Group();
    model.add(inner);
    model.scale.setScalar(k);
    const at = toWorld(ix, iy);
    model.position.set(at.x, groundAt(ix, iy) - 0.02 * sp.userData.tall, at.z);
    model.updateMatrixWorld(true);
    model.userData = { locId: sp.userData.locId, box: new THREE.Box3().setFromObject(model), reach: (Math.max(size.x, size.z) * k) / 2 };
    scene.add(model);
    models.push(model);
    sp.userData.model = model;
    sp.visible = false;
    clearObjects();
    dirty = true;
    wake();
  }

  /** No trees or rocks where a location's icon or model stands. */
  function clearObjects() {
    objects?.setClearings(icons.map((sp) => {
      const p = sp.position;
      const reach = sp.userData.model ? sp.userData.model.userData.reach + 1 : sp.userData.tall * 0.4;
      return { x: Math.round(p.x + land.W / 2), y: Math.round(p.z + land.H / 2), r: Math.round(reach) };
    }));
  }

  /** The trees, rocks and peaks (map-objects.js), read from the painting once the map's showing: off while the map's
   * drawn coarse (a slow device keeping up while it moves), and never without the graphics card. */
  async function buildObjects() {
    if (gpu.software || objects || destroyed) return;
    const res = await fetch(version.files.painting);
    if (!res.ok) throw new Error("Couldn't load the painting");
    const bitmap = await createImageBitmap(await res.blob());
    const c = document.createElement('canvas');
    c.width = land.W;
    c.height = land.H;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, land.W, land.H);
    const [placed, models] = await Promise.all([
      findPlaces({ rgba: ctx.getImageData(0, 0, land.W, land.H).data, W: land.W, H: land.H, kind: land.kind.slice(), metres: land.metres.slice() }),
      objectModels(),
    ]);
    if (destroyed || objects) return;
    objects = buildMapObjects({ land, placed, groundAt, toWorld, models });
    scene.add(objects.group);
    clearObjects();
    dirty = true;
    wake();
  }

  /** The DM's models for the trees, rocks and summits ("mapobject-<kind>.glb" beside the icons, map-objects.js
   * MODEL_KINDS) -> { kind: [{ file, scene }, in file order] } -- one that won't load is left out (the shape made in code stands
   * in), and none at all when the Pi can't say. */
  async function objectModels() {
    let list = [];
    try { list = await DmAPI.mapObjectModels(); } catch (err) { return {}; }
    const wanted = new Set(Object.values(MODEL_KINDS).flat());
    const loaded = await Promise.all(list.filter(m => wanted.has(m.kind)).map(m => gltfScene(m.url)
      .then(scene => ({ ...m, scene }))
      .catch((err) => { console.warn(`Map object ${m.file} won't load: ${err.message}`); return null; })));
    const out = {};
    loaded.filter(Boolean).sort((a, b) => a.file.localeCompare(b.file)).forEach((m) => { (out[m.kind] ||= []).push({ file: m.file, scene: m.scene }); });
    return out;
  }

  /** Whether the sea's waves move now: close enough in for them to show (sea.js FADE: the longest some 7 screen pixels
   * long), and the map on show -- not on a device without the graphics card or one too slow to keep up while
   * moving (they stand still there). Kept going on a computer set to reduce motion, like the party's marker. */
  function seaMoves() {
    if (gpu.software || movingLevel >= 2 || !land || !root.clientWidth || document.hidden) return false;
    if (performance.now() - lastActive > SEA_REST_MS) return false;
    const foot = (camera.position.distanceTo(controls.target) * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / root.clientHeight;
    return foot / LONGEST_WAVE < FADE[1];
  }

  /** The waves' next step drawn in a moment (about 20 a second) -- the map is otherwise drawn only when it changes;
   * one frame each, so the loop itself still comes to rest. */
  function seaNext() {
    if (seaTimer || destroyed || !seaMoves()) return;
    seaTimer = setTimeout(() => {
      seaTimer = 0;
      seaDue = true;
      if (!frame && !destroyed) frame = requestAnimationFrame(tick);
    }, 50);
  }
  // (the page shown again: the waves go on)
  const onVisible = () => { if (!document.hidden) wake(); };
  document.addEventListener('visibilitychange', onVisible);

  /** Draws the map as the camera has it now (the objects grown in by their distance from it first). */
  function render() {
    if (seaMoves()) seaTime.value = performance.now() / 1000;
    if (objects) {
      objects.group.visible = !LEVELS[drawnLevel].coarse;
      objects.update(camera, canvas.clientHeight || 600);
    }
    renderer.render(scene, camera);
  }

  /** An icon's picture, hidden by the land in front of it like everything else on the map (the user's call, 2026-10-22: a
   * town behind a mountain stays behind it -- it used to be drawn over everything). Only its own bit of ground mustn't
   * cut it: with its middle on the spot and leant back, its lower half reaches into the land. So the depth it's tested
   * at is pulled `bias.value` towards the camera (orientIcons) -- what it covers on the screen stays the same. */
  function iconMaterial(bias) {
    const m = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.iconBias = bias;
      shader.vertexShader = `uniform float iconBias;
${shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
        vec4 nearer = projectionMatrix * vec4(mvPosition.xy, min(mvPosition.z + iconBias, -1.0), 1.0);
        gl_Position.z = nearer.z / nearer.w * gl_Position.w;`)}`;
    };
    return m;
  }

  /** The icons leant back as far as the camera's tilted from level (straight up seen level, flat on the land seen from
   * straight above -- never edge on), still facing south: so they never turn as the map's turned. */
  function orientIcons() {
    const polar = controls.getPolarAngle();
    const lean = polar - Math.PI / 2;
    // How far behind the land in front of it the icon's lower edge is, as a share of its height (flatter: further), and a
    // little more, and the hillside round it -- so its own ground never hides it, and a mountain further in front still does.
    const under = (0.5 * Math.sin(polar)) / Math.max(Math.cos(polar), 0.25) + 0.25;
    const slope = 1 / Math.max(Math.cos(polar), 0.5);
    icons.forEach((sp) => {
      sp.rotation.x = lean;
      sp.updateMatrixWorld();
      sp.userData.bias.value = sp.userData.tall * under + sp.userData.rise * slope;
    });
  }

  /** The DM's locations as the map's names ([] or a list: theirs; null: the towns in places.json again). */
  function setLocations(list) {
    locations = Array.isArray(list) ? list : null;
    if (highlighted && !locations?.some(l => l.id === highlighted)) highlighted = null;
    // (the party's place is kept even when it isn't in the list -- a board screen leaves the secret ones out, and the
    // party can be in one of them: then nothing is shown there until it is)
    if (!land) return; // put in place once loaded
    buildLabels();
    buildIcons();
    drawOverlay();
  }

  /** One location drawn onto the land (null: none). */
  function highlight(id) {
    highlighted = id || null;
    if (land) drawOverlay();
  }

  /** Where the party is (a location's id; null: nowhere shown) -- outlined in gold and marked. */
  function setParty(id) {
    partyAt = id || null;
    if (!land) return;
    buildLabels();
    drawOverlay();
  }

  /** Flies to a location: in close over a town, far enough back over a route or a forest to see all of it. Turned the way
   * the map is now, or to `azimuth` (the players' party button: north up). */
  function flyToLocation(id, { ms = 900, azimuth = controls.getAzimuthalAngle() } = {}) {
    const loc = locations?.find(l => l.id === id);
    const b = shapeBounds(loc?.shape);
    if (!b || !land) return false;
    const az = azimuth;
    if (loc.shape.kind === 'pin') {
      // looked at from fairly high up -- a little tilt for the mountains, mostly from above (the user's call, 2026-10-20;
      // a little less tilted since 2026-10-22)
      flyTo(toWorld(b.mid[0], b.mid[1]), land.fit * 0.28, PIN_POLAR, az, ms);
      return true;
    }
    // the box turned the way the camera is, fitted to the screen (a little tilted, so a little extra up and down)
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const c = Math.abs(Math.cos(az)), s = Math.abs(Math.sin(az));
    const w = b.x1 - b.x0, h = b.y1 - b.y0;
    const spanX = w * c + h * s + 60, spanZ = (w * s + h * c + 60) * 1.15;
    const dist = Math.max(spanZ / (2 * tanV), spanX / (2 * tanV * camera.aspect)) * 1.1;
    const goal = Math.max(land.fit * 0.18, Math.min(land.fit, dist));
    flyTo(new THREE.Vector3((b.x0 + b.x1) / 2 - land.W / 2, 0, (b.y0 + b.y1) / 2 - land.H / 2), goal, 0.32, az, ms);
    return true;
  }

  const v = new THREE.Vector3();
  const corner = new THREE.Vector3();
  function placeLabels() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const dist = camera.position.distanceTo(controls.target);
    // A minor location's name only closer in than 60 % of the whole-island view the compass goes back to (the user's
    // call, 2026-10-20): from far out only the major locations are named.
    const minorAway = dist > fillFor(controls.getAzimuthalAngle()) * 0.6;
    // How far an icon reaches down the screen from its middle, by its location -- the lowest of its corners, the way the
    // map is turned and tilted now: its name goes just under it (region-map.css --below); with the
    // icon showing, the location's white dot is left out and the party's marker sits on the picture (.iconed, .on-icon).
    const halfIcon = new Map();
    icons.forEach((sp) => {
      if (!sp.visible) return;
      const mid = v.copy(sp.position).project(camera).y;
      let low = 0;
      for (const [cx, cy] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
        corner.set(cx, cy, 0).applyMatrix4(sp.matrixWorld).project(camera);
        low = Math.max(low, ((mid - corner.y) / 2) * h);
      }
      halfIcon.set(sp.userData.locId, low);
    });
    // a model: how far its box reaches down the screen from its foot
    models.forEach((m) => {
      const mid = v.copy(m.position).project(camera).y;
      const { min, max } = m.userData.box;
      let low = 0;
      for (const cx of [min.x, max.x]) for (const cy of [min.y, max.y]) for (const cz of [min.z, max.z]) {
        corner.set(cx, cy, cz).project(camera);
        low = Math.max(low, ((mid - corner.y) / 2) * h);
      }
      halfIcon.set(m.userData.locId, low);
    });
    for (const l of labels) {
      v.copy(l.at).project(camera);
      const visible = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      l.el.style.display = visible ? '' : 'none';
      if (!visible) continue;
      // a town (its pin and name) or a red spot behind a mountain stays behind it (the user's call, 2026-10-22)
      if (l.kind === 'town' || l.kind === 'spot') l.el.classList.toggle('behind', behindLand(l.at));
      l.el.style.transform = `translate(${((v.x + 1) / 2 * w).toFixed(1)}px, ${((1 - v.y) / 2 * h).toFixed(1)}px)`;
      // from far away only the towns: the spots and the sea names come in closer
      if (l.kind === 'spot' || l.kind === 'water') l.el.classList.toggle('far', dist > land.fit * 0.75);
      if (l.kind === 'town' || l.kind === 'region') l.el.classList.toggle('unnamed', minorAway && l.el.classList.contains('minor'));
      const half = halfIcon.get(l.kind === 'party' ? partyAt : l.locId);
      if (l.kind === 'town' || l.kind === 'region') l.el.style.setProperty('--below', `${Math.round(half || 0)}px`);
      if (l.kind === 'town') l.el.classList.toggle('iconed', !!half);
      if (l.kind === 'party') l.el.classList.toggle('on-icon', !!half);
      if (l.border) fitRealmName(l, (v.x + 1) / 2 * w, (1 - v.y) / 2 * h, half || 0, w, h);
      // The party's marker as big on any screen and at any zoom (the user's call, 2026-10-20): a share of the screen's
      // height, a little bigger closer in -- never lost when the whole island is in view, never huge up close.
      if (l.kind === 'party') {
        const grow = Math.min(1.7, Math.max(0.85, (land.fit / dist) ** 0.3));
        // three eighths of the size it was first (the user's call, 2026-10-20: half, then three quarters of that)
        l.el.style.setProperty('--mk', `${Math.round(Math.min(56, Math.max(10, h * 0.0206 * grow)))}px`);
      }
    }
  }

  /** Whether the land stands between the camera and `p` (a point on the map): stepped along the line of sight, from a
   * little way off the point (its own hillside doesn't count) up to where the line is higher than any of the land. */
  function behindLand(p) {
    const cam = camera.position;
    const rise = cam.y - p.y;
    if (rise <= 0) return false;
    const across = Math.hypot(cam.x - p.x, cam.z - p.z);
    const end = Math.min(1, (land.topY - p.y) / rise);
    const start = Math.min(end, 8 / Math.max(1, Math.hypot(across, rise)));
    if (end <= start) return false;
    const steps = Math.min(160, Math.ceil(((end - start) * across) / STEP));
    for (let i = 1; i <= steps; i++) {
      const t = start + ((end - start) * i) / steps;
      const ground = Math.max(0, heightAt(p.x + (cam.x - p.x) * t + land.W / 2, p.z + (cam.z - p.z) * t + land.H / 2)) * land.vert;
      if (ground > p.y + rise * t + 1.5) return true;
    }
    return false;
  }

  /** A region's name never over its border (the user's call, 2026-10-21): as big as region-map.css makes it, or smaller
   * until the box round it fits inside the region as it is on the screen now -- and hidden when even small it doesn't. */
  const MIN_REALM_PX = 6.5;
  const bv = new THREE.Vector3();
  function fitRealmName(l, cx, cy, below, w, h) {
    const el = l.el;
    if (!l.size) {
      el.style.fontSize = '';
      l.size = { base: parseFloat(getComputedStyle(el).fontSize), w: el.offsetWidth, h: el.offsetHeight };
      if (!l.size.w) { l.size = null; return; } // not laid out yet
    }
    const rings = l.border.map(r => r.map((p) => { bv.copy(p).project(camera); return [(bv.x + 1) / 2 * w, (1 - bv.y) / 2 * h]; }));
    const fits = (k) => {
      const hw = (l.size.w * k) / 2 + 3, hh = (l.size.h * k) / 2 + 2;
      // with an icon, the name hangs just under it (region-map.css's .has-icon)
      const my = el.classList.contains('has-icon') ? cy + below + 2 + (l.size.h * k) / 2 : cy;
      return boxInside(rings, cx - hw, my - hh, cx + hw, my + hh);
    };
    let k = 1;
    if (!fits(1)) {
      let lo = 0, hi = 1;
      for (let i = 0; i < 8; i++) { const m = (lo + hi) / 2; if (fits(m)) lo = m; else hi = m; }
      k = lo;
    }
    const px = l.size.base * k;
    el.classList.toggle('no-room', px < MIN_REALM_PX);
    el.style.fontSize = k < 1 ? `${px.toFixed(2)}px` : '';
  }
  // the fonts arriving change the names' sizes: measured again
  document.fonts?.ready.then(() => { labels.forEach((l) => { l.size = null; }); if (land) { dirty = true; wake(); } });

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

  /** The whole island in view, tilted a little, turned the way it is now (or `azimuth`). `fill`: the map looked at
   * straight down instead, filling the screen -- as close as the painting still covers all of it, so as little as
   * possible of what's behind the painting shows (the PokeNav's default view, the user's call, 2026-10-19). */
  function home({ ms = 900, azimuth = controls.getAzimuthalAngle(), fill = false } = {}) {
    if (!land) return;
    if (fill) {
      // a hair off straight down -- exactly 0 leaves the camera no way to know which way is up
      flyTo(new THREE.Vector3(0, 0, 0), fillFor(azimuth), 0.001, azimuth, ms);
      return;
    }
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
    const dist = camera.position.distanceTo(t);
    return {
      x: round(t.x + land.W / 2, 1), y: round(t.z + land.H / 2, 1),
      zoom: round(turned ? dist / BOARD_LONG / boardFit() : dist / land.fit, 4),
      polar: round(controls.getPolarAngle(), 4), azimuth: round(wrapAngle(controls.getAzimuthalAngle() - TURN), 4), style,
    };
  }

  /** What a zoom of 1 is on the board screen itself (16:9) -- a turned screen's views are in its terms. */
  function boardFit() {
    const aspect = camera.aspect;
    camera.aspect = 16 / 9;
    const fit = fitFor(0);
    camera.aspect = aspect;
    return fit;
  }

  /** The view as camera numbers for this screen. */
  function goalOf(view) {
    return {
      target: new THREE.Vector3(Number(view.x) - land.W / 2, 0, Number(view.y) - land.H / 2),
      dist: Math.max(controls.minDistance, Math.min(controls.maxDistance, Number(view.zoom) * (turned ? boardFit() * BOARD_LONG : land.fit))),
      polar: Math.max(0, Math.min(controls.maxPolarAngle, Number(view.polar))),
      azimuth: wrapAngle(Number(view.azimuth) + TURN),
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

  /** How far back the camera stands, looking straight down at the painting's middle turned `azimuth`, for the screen
   * to be covered by the painting edge to edge: the screen's footprint on the ground, turned, has to fit inside the
   * painting (W x H) both ways. */
  function fillFor(azimuth = 0) {
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const c = Math.abs(Math.cos(azimuth)), s = Math.abs(Math.sin(azimuth));
    const k = Math.min((land.W / 2) / (camera.aspect * c + s), (land.H / 2) / (camera.aspect * s + c));
    return Math.max(controls.minDistance, (k / tanV) * 0.97); // a little in, for the land standing above the sea
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
    // (running: a wake() from in here -- the controls' 'change' as they move -- mustn't start a second loop; it did, and
    // while the map moved they multiplied, dozens of draws a frame)
    frame = -1;
    if (destroyed) return;
    let moved = flight ? stepFlight(now) : follow ? stepFollow(now) : false;
    lastTick = now;
    if (controls.update()) moved = true;
    if (controlsMoved) { moved = true; controlsMoved = false; }
    clampTarget();
    if ((moved || dirty) && !root.clientWidth) {
      dirty = true; // put away (the board screen during a battle): drawn when it's back (the resize wakes it)
      quiet++;
    } else if (moved || dirty) {
      lastActive = performance.now();
      const shift = screenShift();
      // A glide all but stopped is ended there and then (the rest of it, under half a pixel, in one go): it went on
      // unseen for a second more -- after every tap, the hand having moved the map a pixel.
      if (moved && shift < SETTLED && !held && !flight && !follow) {
        controls.enableDamping = false;
        controls.update();
        controls.enableDamping = true;
        clampTarget();
      }
      // Drawn at the moving level only while the picture moves a good few pixels a frame: a tap, or a glide coming
      // to rest, is drawn at its best (a slow device's coarse frames blurred the map for a second after every tap).
      const fast = moved && shift >= SHARP_BELOW;      if (fast) keepUp(now); else lastDraw = 0;
      useLevel(fast ? Math.max(movingLevel, REST) : REST);
      orientIcons();
      render();
      placeLabels();
      const az = controls.getAzimuthalAngle();
      $('.rmap-needle').style.transform = `rotate(${(az * 180 / Math.PI).toFixed(1)}deg)`;
      $('.rmap-compass').classList.toggle('off-north', Math.abs(wrapAngle(az - (homeAzimuth ?? 0))) > 0.02);
      if (moved && onView) onView(getView());
      dirty = false;
      quiet = 0;
    } else if (seaDue && root.clientWidth) {
      render(); // only the sea moved: nothing else to place
      seaDue = false;
    } else {
      quiet++;
      lastDraw = 0;
      // come to rest after moving at a lower level: drawn once more at its best
      if (drawnLevel !== REST && root.clientWidth) {
        useLevel(REST);
        render();
      }
    }
    seaDue = false;
    seaNext();
    if (quiet < 30) frame = requestAnimationFrame(tick);
    else { frame = 0; lastTick = 0; }
  }

  // How far the picture moved since it was last drawn, in screen pixels (about: the land at the middle of the screen
  // sliding, or the view turning)
  const SHARP_BELOW = 3;     // slower than this: drawn at its best even while moving
  const SETTLED = 0.05;      // slower than this: the glide's ended
  const lastCam = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  function screenShift() {
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const perPx = (camera.position.distanceTo(controls.target) * 2 * Math.tan(fov / 2)) / (root.clientHeight || 1);
    const slid = camera.position.distanceTo(lastCam.pos) / perPx;
    const turned = (2 * Math.acos(Math.min(1, Math.abs(camera.quaternion.dot(lastCam.quat)))) * root.clientHeight) / fov;
    lastCam.pos.copy(camera.position);
    lastCam.quat.copy(camera.quaternion);
    return slid + turned;
  }
  // a finger or the mouse on the map (a glide isn't ended under it)
  let held = false;
  controls.addEventListener('start', () => { held = true; });
  controls.addEventListener('end', () => { held = false; });

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
    if (overlay) overlay.mesh.geometry = mesh.geometry;
  }
  function wake() {
    quiet = 0;
    lastActive = performance.now(); // (the waves on again, if they'd come to rest)
    if (!frame && !destroyed) frame = requestAnimationFrame(tick);
  }
  controls.addEventListener('start', wake);
  // A zoom (wheel, pinch) is applied by the controls there and then, in their own handler -- by the next frame there's
  // nothing left for controls.update() to move, so without this it wasn't drawn (or sent on) until something else moved.
  let controlsMoved = false;
  controls.addEventListener('change', () => { controlsMoved = true; wake(); });
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
    // (asked for before the map's loaded -- the PokéNav's saved view: load() starts in this style itself)
    if (!version) return;
    if (!textures[next]) textures[next] = await loadTexture(renderer, version.files[STYLES[next]]);
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
      // With a home direction (the DM's PokeNav: turned like the battle maps), the compass is the way back to the
      // default view -- the whole island, turned that way.
      if (homeAzimuth != null) { home({ azimuth: homeAzimuth, fill: true }); return; }
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
      if (l.locId && onPick) { pickLocation(l.locId); return; }
      if (!l.locId || !flyToLocation(l.locId)) flyTo(toWorld(l.x, l.y), land.fit * 0.28, PIN_POLAR, controls.getAzimuthalAngle());
    }
  });

  /** A location picked (its name or icon tapped, with onPick): flown to, lit up, and onPick told. */
  function pickLocation(id) {
    flyToLocation(id);
    highlight(id);
    onPick?.(id);
  }
  // A tap on an icon (not a drag of the map) picks its location, as its name does.
  if (onPick && !viewOnly) {
    let downAt = null;
    const ray = new THREE.Raycaster();
    const tap = new THREE.Vector2();
    canvas.addEventListener('pointerdown', (e) => { downAt = e.isPrimary ? [e.clientX, e.clientY] : null; });
    canvas.addEventListener('pointerup', (e) => {
      const was = downAt;
      downAt = null;
      if (!was || !land || Math.hypot(e.clientX - was[0], e.clientY - was[1]) > 6) return;
      const r = canvas.getBoundingClientRect();
      tap.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(tap, camera);
      const hit = ray.intersectObjects([...icons.filter(sp => sp.visible), ...models], true)[0];
      let o = hit?.object;
      while (o && !o.userData.locId) o = o.parent; // (a model's part: its location is on the model)
      if (o) pickLocation(o.userData.locId);
    });
  }

  const observer = new ResizeObserver(resize);

  async function load() {
    version = await currentMap();
    places = version.places;
    const first = style;
    const [heights, texture] = await Promise.all([loadHeights(version.files.height, places.seaOffset), loadTexture(renderer, version.files[STYLES[first]])]);
    if (destroyed) return;
    textures[first] = texture;
    land = { ...heights, kmPerPx: version.kmPerPx || 0.12, vert: EXAG / ((version.kmPerPx || 0.12) * 1000) };
    let top = 0;
    for (let i = 0; i < heights.metres.length; i++) if (heights.kind[i] !== 0 && heights.metres[i] > top) top = heights.metres[i];
    land.topY = top * land.vert;   // the highest land (behindLand looks no higher)
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
    buildIcons();
    buildOverlay();
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
    // the objects after the map's first shown (reading the painting takes a moment)
    setTimeout(() => buildObjects().catch(() => {}), 50);
  }

  function destroy() {
    destroyed = true;
    cancelAnimationFrame(frame);
    clearTimeout(seaTimer);
    document.removeEventListener('visibilitychange', onVisible);
    observer.disconnect();
    controls.dispose();
    scene.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
    Object.values(geometries).forEach(g => g.dispose());
    Object.values(textures).forEach(t => t.dispose());
    overlay?.tex.dispose();
    seaInfo?.dispose();
    Object.values(iconTextures).forEach(p => p.then(t => t.dispose()).catch(() => {}));
    objects?.dispose();
    renderer.dispose();
  }

  const ready = load().catch((err) => {
    const box = $('.rmap-loading');
    if (box) box.textContent = `Couldn't load the map: ${err.message}`;
    throw err;
  });
  return { ready, destroy, getView, setView, home, setLocations, highlight, setParty, flyToLocation, graphics: gpu, get mapId() { return version?.id || null; } };
}
