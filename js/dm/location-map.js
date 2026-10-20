// DM console -- marking a location on the region map (the Admin module's Locations tab, the user's call, 2026-10-20):
// a City or a Cave is one spot, a Route a line along the painted roads (the DM clicks the start, the end and any turn
// in between, and it follows the road on its own), a Forest an area (one click fills the forest it's in; a brush, an
// eraser and an outline to tidy it up). Any location can be any of the three.
//
// What's kept on the location (`shape`, painting pixels of the map in use -- assets/Shiman Federation.png, or a newer
// painting the DM uploaded (js/region-map/map-version.js moves every shape onto it) -- the 3D map's own coordinates, so
// js/region-map/region-map.js draws it as it is):
//   { kind: 'pin', x, y }
//   { kind: 'path', anchors: [[x, y], ...] (the DM's clicks), follow (along the roads), points: [[x, y], ...] (the line) }
//   { kind: 'area', rings: [[[x, y], ...], ...] (outlines; a hole runs the other way round) }
// The painting's roads and forests are read from its colours (js/region-map/map-features.js).
import { escapeHtml, toast } from './dm-common.js';
import * as F from '../region-map/map-features.js';
import { currentMap, kmPerPx } from '../region-map/map-version.js';
import { iconImage, drawIcon, ICON_SIZE } from './location-icon.js';

// The map in use's files: its painting (what the roads and forests are read from) and its painted picture (what the DM
// sees -- the same painting, twice the size, shaded). One painting pixel is kmPerPx() km (120 m on the first map).

export const SHAPE_KINDS = { pin: '📍 One spot', path: '〰️ A line', area: '⬚ An area' };

/** What a new location of this type is marked as: a route a line, a forest an area, the rest one spot. */
export const defaultKind = type => (type === 'route' ? 'path' : type === 'forest' || type === 'region' ? 'area' : 'pin');

/** "A line, about 14 km" -- for the location's form. */
export function describeShape(s) {
  if (!s) return 'Not on the map yet';
  if (s.kind === 'pin') return 'One spot';
  if (s.kind === 'path') {
    const pts = s.points || [];
    const px = pts.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
    return `A line, about ${Math.max(1, Math.round(px * kmPerPx()))} km`;
  }
  const px = Math.abs((s.rings || []).reduce((a, r) => a + F.ringArea(r), 0));
  return `An area of about ${Math.max(1, Math.round(px * kmPerPx() * kmPerPx()))} km²`;
}

let _painting = null;
let _paintingOf = null;
/** The map in use's painting, loaded once (again after the DM switches maps): { W, H (painting pixels), shown (the
 * picture drawn), features (map-features.js) }. */
export async function loadPainting() {
  const map = await currentMap();
  if (_paintingOf !== map.id) { _painting = null; _paintingOf = map.id; }
  if (!_painting) {
    _painting = (async () => {
      const [src, shown] = await Promise.all([loadImage(map.files.painting), loadImage(map.files.painted)]);
      const W = src.naturalWidth, H = src.naturalHeight;
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(src, 0, 0);
      return { W, H, shown, features: F.readFeatures(ctx.getImageData(0, 0, W, H).data, W, H) };
    })().catch((err) => { _painting = null; throw err; });
  }
  return _painting;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Couldn't load ${url}`));
    img.src = url;
  });
}

// ---------------------------------------------------------------------------
// Drawing a shape (the editor, the form's preview)
// ---------------------------------------------------------------------------

/** One shape onto a 2D canvas: `tf` = { s (canvas pixels per painting pixel), ox, oy }. `faint`: another location,
 * there for reference. */
export function drawShape(ctx, shape, tf, { faint = false, name = '', below = 0 } = {}) {
  if (!shape) return;
  const X = x => tf.ox + x * tf.s, Y = y => tf.oy + y * tf.s;
  const gold = faint ? 'rgba(255, 255, 255, 0.75)' : '#ffd23f';
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (shape.kind === 'area' && shape.rings?.length) {
    ctx.beginPath();
    shape.rings.forEach((r) => { r.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)))); ctx.closePath(); });
    ctx.fillStyle = faint ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 210, 63, 0.3)';
    ctx.fill('evenodd');
    if (!faint) { ctx.lineWidth = 4.5; ctx.strokeStyle = 'rgba(20, 16, 4, 0.7)'; ctx.stroke(); }
    ctx.lineWidth = faint ? 1 : 2;
    ctx.strokeStyle = gold;
    ctx.stroke();
  } else if (shape.kind === 'path' && shape.points?.length > 1) {
    ctx.beginPath();
    shape.points.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
    if (!faint) { ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(20, 16, 4, 0.75)'; ctx.stroke(); }
    ctx.lineWidth = faint ? 1.5 : 3.5;
    ctx.strokeStyle = gold;
    ctx.stroke();
  } else if (shape.kind === 'pin') {
    ctx.beginPath();
    ctx.arc(X(shape.x), Y(shape.y), faint ? 4 : 7, 0, Math.PI * 2);
    ctx.fillStyle = gold;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(20, 16, 4, 0.85)';
    ctx.stroke();
  }
  if (name) {
    const at = F.shapeBounds(shape)?.mid;
    if (at) {
      ctx.font = '600 11px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
      // over the spot -- or, with an icon round it (`below`: half its height on the canvas), under the picture, as on the
      // PokéNav (the user's call, 2026-10-20: never hidden behind the icon)
      const ny = below > 0 ? Y(at[1]) + below + 11 : Y(at[1]) - 9;
      ctx.strokeText(name, X(at[0]), ny);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.fillText(name, X(at[0]), ny);
    }
  }
  ctx.restore();
}

/** The location's shape on a piece of the painting round it (the form's preview). */
export async function drawShapePreview(canvas, shape) {
  const P = await loadPainting();
  const b = F.shapeBounds(shape);
  if (!b || !canvas.isConnected) return;
  const cw = canvas.clientWidth || 320, ch = canvas.clientHeight || 180;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = cw * dpr;
  canvas.height = ch * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // the shape with room round it (at least ~20 km across, so a spot shows where it is)
  const bw = Math.max(b.x1 - b.x0, 160) * 1.35, bh = Math.max(b.y1 - b.y0, 160) * 1.35;
  const s = Math.min(cw / bw, ch / bh);
  const tf = { s, ox: cw / 2 - ((b.x0 + b.x1) / 2) * s, oy: ch / 2 - ((b.y0 + b.y1) / 2) * s };
  ctx.fillStyle = '#0c2240';
  ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(P.shown, tf.ox, tf.oy, P.W * s, P.H * s);
  drawShape(ctx, shape, tf);
}

// ---------------------------------------------------------------------------
// The editor
// ---------------------------------------------------------------------------

const AREA_TOOLS = {
  region: { label: '🗺 Region', hint: 'Click inside a region: it fills in up to the dark border lines and the coast. If it spills out through a gap in a line, Undo and draw that bit with Outline (or Erase what spilled). Alt + click takes it away again.' },
  wand: { label: '🪄 Fill', hint: 'Click inside a forest (or a lake, or a patch of one colour) and it fills it in. Alt + click takes a patch away again.' },
  brush: { label: '🖌 Paint', hint: 'Paint to add to the area.' },
  erase: { label: '🧽 Erase', hint: 'Paint to take away from the area.' },
  outline: { label: '✏️ Outline', hint: 'Click round the edge; click the first point again (or double-click) to close it and fill it in. Alt + close takes it away instead.' },
};

/** Marks `loc` on the map, full screen. `others`: the other locations, drawn faintly for reference.
 * -> the new shape, or undefined (cancelled). */
/** `onIcon(icon)`: the location's icon resized here (at Done) -- it stands on the mark, wherever that's put. */
export async function editLocationShape(loc, others = [], { onIcon } = {}) {
  let P;
  try {
    P = await loadPainting();
  } catch (err) {
    toast(`Couldn't load the map: ${err.message}`);
    return undefined;
  }
  const { W, H, features: f } = P;
  const old = loc.shape || null;

  // What's being drawn, one of each kind -- switching between them keeps the others as they were until Done.
  let kind = old?.kind || defaultKind(loc.type);
  let pin = old?.kind === 'pin' ? [old.x, old.y] : null;
  let anchors = old?.kind === 'path' ? (old.anchors?.length > 1 ? old.anchors : [old.points[0], old.points[old.points.length - 1]]).map(p => p.slice()) : [];
  let follow = old?.kind === 'path' ? old.follow !== false : true;
  let segs = [];
  let mask = old?.kind === 'area' ? F.ringsToMask(old.rings, W, H) : new Uint8Array(W * H);
  let areaTool = loc.type === 'region' ? 'region' : 'wand';
  let brush = 10;
  let tolerance = 30;
  let showOthers = true;
  let lasso = [];
  const undos = { pin: [], path: [], area: [] };
  // The location's icon, drawn live standing on the mark as it's placed (the user's call, 2026-10-20: the icon and the
  // mark go together -- the icon is only picked in the location's form, it's sized here); the others' icons faint.
  const icon = loc.icon?.url ? { url: loc.icon.url, size: loc.icon.size || ICON_SIZE.first } : null;
  let iconImg = null;
  let iconChanged = false;
  let areaSpot; // the painted area's middle (undefined: worked out again -- the mask changed)
  const otherIcons = [];

  const overlay = document.createElement('div');
  overlay.className = 'dm-lme-overlay';
  overlay.innerHTML = `
    <div class="dm-lme-head">
      <h3>🗺 ${escapeHtml(loc.name || 'Location')} on the map</h3>
      <div class="dm-lme-seg" role="group">${Object.entries(SHAPE_KINDS).map(([k, l]) => `<button data-kind="${k}">${l}</button>`).join('')}</div>
      <span class="dm-lme-spacer"></span>
      <button class="dm-btn" data-lme="cancel">Cancel</button>
      <button class="dm-btn primary" data-lme="done">Done</button>
    </div>
    <div class="dm-lme-body">
      <aside class="dm-lme-tools" id="lmeTools"></aside>
      <div class="dm-lme-stage"><canvas id="lmeCanvas"></canvas>
        <div class="dm-lme-zoom"><button class="dm-btn small" data-lme="in" title="Zoom in">＋</button><button class="dm-btn small" data-lme="out" title="Zoom out">－</button><button class="dm-btn small" data-lme="fit" title="The whole map">⤢</button></div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const canvas = overlay.querySelector('#lmeCanvas');
  const ctx = canvas.getContext('2d');
  const stage = overlay.querySelector('.dm-lme-stage');

  // The area as a picture over the painting, redrawn only where it changed.
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = W; maskCanvas.height = H;
  const mctx = maskCanvas.getContext('2d');
  const mimg = mctx.createImageData(W, H);
  function paintMask(x0 = 0, y0 = 0, x1 = W - 1, y1 = H - 1) {
    areaSpot = undefined;
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(W - 1, Math.ceil(x1)); y1 = Math.min(H - 1, Math.ceil(y1));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * W + x, o = i * 4;
        // its edge solid (it has to read over the yellow-green plains too), the inside see-through
        const edge = mask[i] && (x === 0 || y === 0 || x === W - 1 || y === H - 1 || !mask[i - 1] || !mask[i + 1] || !mask[i - W] || !mask[i + W]);
        if (edge) { mimg.data[o] = 255; mimg.data[o + 1] = 236; mimg.data[o + 2] = 90; mimg.data[o + 3] = 255; } else if (mask[i]) { mimg.data[o] = 255; mimg.data[o + 1] = 190; mimg.data[o + 2] = 30; mimg.data[o + 3] = 135; } else mimg.data[o + 3] = 0;
      }
    }
    mctx.putImageData(mimg, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  }
  paintMask();

  // ---- the view: painting pixel -> screen = (x * s + ox, y * s + oy) ----
  let s = 1, ox = 0, oy = 0;
  let cw = 0, ch = 0;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  function fitTo(x0, y0, x1, y1, pad = 1.25) {
    const bw = Math.max(x1 - x0, 60) * pad, bh = Math.max(y1 - y0, 60) * pad;
    s = Math.min(cw / bw, ch / bh, 8);
    ox = cw / 2 - ((x0 + x1) / 2) * s;
    oy = ch / 2 - ((y0 + y1) / 2) * s;
  }
  const fitAll = () => fitTo(0, 0, W, H, 1.02);
  function resize() {
    cw = stage.clientWidth; ch = stage.clientHeight;
    canvas.width = cw * dpr; canvas.height = ch * dpr;
    canvas.style.width = `${cw}px`; canvas.style.height = `${ch}px`;
    draw();
  }
  const toPaint = e => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left - ox) / s, (e.clientY - r.top - oy) / s]; };
  function zoomAt(k, sx = cw / 2, sy = ch / 2) {
    const min = Math.min(cw / W, ch / H) * 0.6;
    const next = Math.max(min, Math.min(12, s * k));
    ox = sx - ((sx - ox) / s) * next;
    oy = sy - ((sy - oy) / s) * next;
    s = next;
    draw();
  }

  // ---- the line along the roads ----
  function retrace(from = 0, to = anchors.length - 2) {
    segs.length = Math.max(0, anchors.length - 1);
    for (let i = Math.max(0, from); i <= Math.min(to, anchors.length - 2); i++) segs[i] = F.tracePath(f, anchors[i], anchors[i + 1], { follow });
  }
  const pathPoints = () => segs.reduce((all, sg, i) => all.concat(i ? sg.slice(1) : sg), []);

  /** Where the icon stands on the mark as it is now -- as map-features.js iconSpot will on the saved shape: the spot,
   * halfway along the line, the middle of the widest stretch across the area's middle row (null: nothing marked). */
  function markSpot() {
    if (kind === 'pin') return pin || null;
    if (kind === 'path') { const pts = pathPoints(); return pts.length > 1 ? F.alongPath(pts, 0.5) : pts[0] || null; }
    if (areaSpot !== undefined) return areaSpot;
    let y0 = H, y1 = -1;
    for (let y = 0; y < H; y++) {
      for (let x = 0, i = y * W; x < W; x++, i++) if (mask[i]) { if (y < y0) y0 = y; y1 = y; break; }
    }
    areaSpot = null;
    let best = 0;
    for (const t of [0.5, 0.4, 0.6, 0.3, 0.7]) {
      if (y1 < 0) break;
      const y = Math.round(y0 + (y1 - y0) * t);
      for (let x = 0, run = -1; x <= W; x++) {
        const on = x < W && mask[y * W + x];
        if (on && run < 0) run = x;
        if (!on && run >= 0) { if (x - run > best) { best = x - run; areaSpot = [(run + x - 1) / 2, y]; } run = -1; }
      }
      if (best > 20) break;
    }
    return areaSpot;
  }
  const snap = p => (follow ? F.snapToRoad(f, p[0], p[1], 10) : p.map(v => Math.round(v * 10) / 10));
  retrace();

  // ---- undo ----
  function remember() {
    undos[kind].push(kind === 'pin' ? pin?.slice() || null : kind === 'path' ? anchors.map(p => p.slice()) : mask.slice());
    if (undos[kind].length > 25) undos[kind].shift();
  }
  function undo() {
    if (kind === 'area' && lasso.length) { lasso.pop(); draw(); return; }
    if (!undos[kind].length) return;
    const was = undos[kind].pop();
    if (kind === 'pin') pin = was;
    else if (kind === 'path') { anchors = was; retrace(); }
    else { mask = was; paintMask(); }
    tools(); draw();
  }

  // ---- drawing ----
  let hover = null;   // the pointer over the painting (for the brush)
  function draw() {
    if (!cw) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0c2240';
    ctx.fillRect(0, 0, cw, ch);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(P.shown, ox, oy, W * s, H * s);
    const tf = { s, ox, oy };
    // the others' icons first, then their marks and names over them: the pin in the middle of its picture, the name under
    // it (never behind it)
    if (showOthers) otherIcons.forEach(({ o, im }) => { const at = F.iconSpot(o.shape); if (at) drawIcon(ctx, im, { ...o.icon, x: at[0], y: at[1] }, tf, { faint: true }); });
    if (showOthers) {
      others.forEach((o) => {
        const withIcon = otherIcons.some(x => x.o === o);
        drawShape(ctx, o.shape, tf, { faint: true, name: o.name || '', below: withIcon ? ((o.icon.size || ICON_SIZE.first) / kmPerPx()) * s / 2 : 0 });
      });
    }
    const at = icon && iconImg && markSpot();
    // (over an area's fill, under the lines and the tools' marks)
    if (at && kind !== 'area') drawIcon(ctx, iconImg, { ...icon, x: at[0], y: at[1] }, tf, { faint: true });
    if (kind === 'area') {
      ctx.imageSmoothingEnabled = s < 2;
      ctx.drawImage(maskCanvas, ox, oy, W * s, H * s);
      ctx.imageSmoothingEnabled = true;
      if (at) drawIcon(ctx, iconImg, { ...icon, x: at[0], y: at[1] }, tf, { faint: true });
      if (lasso.length) {
        ctx.save();
        ctx.beginPath();
        lasso.forEach(([x, y], i) => (i ? ctx.lineTo(x * s + ox, y * s + oy) : ctx.moveTo(x * s + ox, y * s + oy)));
        if (hover) ctx.lineTo(hover[0] * s + ox, hover[1] * s + oy);
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(lasso[0][0] * s + ox, lasso[0][1] * s + oy, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#ffd23f';
        ctx.fill();
        ctx.restore();
      }
      if (hover && (areaTool === 'brush' || areaTool === 'erase')) {
        ctx.beginPath();
        ctx.arc(hover[0] * s + ox, hover[1] * s + oy, brush * s, 0, Math.PI * 2);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = areaTool === 'erase' ? '#ff8a80' : '#fff';
        ctx.stroke();
      }
    } else if (kind === 'path') {
      drawShape(ctx, { kind: 'path', points: pathPoints() }, tf);
      anchors.forEach(([x, y], i) => {
        ctx.beginPath();
        ctx.arc(x * s + ox, y * s + oy, i === 0 || i === anchors.length - 1 ? 7 : 5.5, 0, Math.PI * 2);
        ctx.fillStyle = i === 0 ? '#7ee787' : i === anchors.length - 1 ? '#ff8a80' : '#fff';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#141004';
        ctx.stroke();
      });
    } else if (pin) {
      drawShape(ctx, { kind: 'pin', x: pin[0], y: pin[1] }, tf);
      ctx.beginPath();
      ctx.arc(pin[0] * s + ox, pin[1] * s + oy, 13, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255, 210, 63, 0.8)';
      ctx.stroke();
    }
  }

  // ---- the tools on the left ----
  function tools() {
    overlay.querySelectorAll('[data-kind]').forEach(b => b.classList.toggle('active', b.dataset.kind === kind));
    const box = overlay.querySelector('#lmeTools');
    const iconTools = icon ? `<div class="dm-card-title">🏰 Its icon</div>
      <div class="dm-hint">Stands on the mark -- ${kind === 'pin' ? 'the spot' : kind === 'path' ? 'halfway along the line' : 'the middle of the area'}.</div>
      <label class="dm-field"><span>How big: <b>about ${icon.size} km tall</b></span>
        <input type="range" id="lmeIconSize" min="${ICON_SIZE.min}" max="${ICON_SIZE.max}" step="${ICON_SIZE.step}" value="${icon.size}"></label>`
      : '<div class="dm-hint">🏰 No icon -- pick one under Icon on the map, then size it here.</div>';
    const common = `${iconTools}<label class="dm-check"><input type="checkbox" id="lmeOthers" ${showOthers ? 'checked' : ''}><span>Show the other locations</span></label>
      <div class="dm-hint">Scroll to zoom. Drag (or right-drag) to move the map.</div>`;
    if (kind === 'pin') {
      box.innerHTML = `<div class="dm-card-title">📍 One spot</div>
        <div class="dm-hint">Click where it is. Drag the spot to move it.</div>
        <div class="dm-row"><button class="dm-btn small" data-lme="undo" ${undos.pin.length ? '' : 'disabled'}>↶ Undo</button></div>
        <div class="dm-lme-stat">${pin ? 'Placed' : 'Not placed yet'}</div>${common}`;
    } else if (kind === 'path') {
      const pts = pathPoints();
      box.innerHTML = `<div class="dm-card-title">〰️ A line</div>
        <label class="dm-check"><input type="checkbox" id="lmeFollow" ${follow ? 'checked' : ''}><span>Follow the roads
          <small>Between your points it keeps to the road painted on the map. Unticked: straight lines (a sea route, a trail that isn't painted).</small></span></label>
        <div class="dm-hint">Click the start, then the end -- and any turn in between. Click on the line to add a point there, drag a point to move it, right-click a point to take it away.</div>
        <div class="dm-row"><button class="dm-btn small" data-lme="undo" ${undos.path.length ? '' : 'disabled'}>↶ Undo</button>
          <button class="dm-btn small danger" data-lme="clear" ${anchors.length ? '' : 'disabled'}>Clear</button></div>
        <div class="dm-lme-stat">${anchors.length < 2 ? `${anchors.length ? 'The start' : 'No points yet'} -- it needs a start and an end` : describeShape({ kind: 'path', points: pts })}</div>${common}`;
    } else {
      box.innerHTML = `<div class="dm-card-title">⬚ An area</div>
        <div class="dm-lme-toolgrid">${Object.entries(AREA_TOOLS).map(([k, t]) => `<button class="dm-btn small${areaTool === k ? ' active' : ''}" data-tool="${k}">${t.label}</button>`).join('')}</div>
        <div class="dm-hint">${AREA_TOOLS[areaTool].hint}</div>
        ${areaTool === 'brush' || areaTool === 'erase' ? `<div class="dm-field"><label>Brush size</label><input type="range" id="lmeBrush" min="2" max="60" value="${brush}"></div>` : ''}
        ${areaTool === 'wand' ? `<div class="dm-field"><label>How alike (for a patch of one colour)</label><input type="range" id="lmeTol" min="0" max="100" value="${tolerance}"></div>` : ''}
        <div class="dm-row"><button class="dm-btn small" data-lme="undo" ${undos.area.length || lasso.length ? '' : 'disabled'}>↶ Undo</button>
          <button class="dm-btn small danger" data-lme="clear">Clear</button></div>
        <div class="dm-lme-stat">${areaText()}</div>${common}`;
    }
  }

  function areaText() {
    let n = 0;
    for (let i = 0; i < mask.length; i++) n += mask[i];
    return n ? `An area of about ${Math.max(1, Math.round(n * kmPerPx() * kmPerPx()))} km²` : 'Nothing filled in yet';
  }

  // ---- the pointer ----
  let drag = null;
  let space = false;
  const near = (a, b, px) => a && b && Math.hypot(a[0] - b[0], a[1] - b[1]) * s <= px;
  const anchorAt = p => anchors.findIndex(a => near(a, p, 9));
  /** Where on the line a click falls: the segment it's on (or -1). */
  function segmentAt(p) {
    let best = -1, bestD = 8;
    segs.forEach((sg, i) => sg.forEach((q, j) => {
      if (!j) return;
      const a = sg[j - 1];
      const dx = q[0] - a[0], dy = q[1] - a[1];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      const d = Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]) * s;
      if (d < bestD) { bestD = d; best = i; }
    }));
    return best;
  }
  function stroke(a, b) {
    const v = areaTool === 'erase' ? 0 : 1;
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / Math.max(1, brush / 3)));
    for (let i = 0; i <= steps; i++) F.stamp(mask, W, H, a[0] + ((b[0] - a[0]) * i) / steps, a[1] + ((b[1] - a[1]) * i) / steps, brush, v);
    paintMask(Math.min(a[0], b[0]) - brush - 1, Math.min(a[1], b[1]) - brush - 1, Math.max(a[0], b[0]) + brush + 1, Math.max(a[1], b[1]) + brush + 1);
  }
  function closeLasso(take) {
    if (lasso.length >= 3) {
      remember();
      const fill = F.ringsToMask([lasso], W, H);
      for (let i = 0; i < mask.length; i++) if (fill[i]) mask[i] = take ? 0 : 1;
      paintMask();
    }
    lasso = [];
    tools(); draw();
  }
  function click(p, e) {
    if (p[0] < 0 || p[1] < 0 || p[0] >= W || p[1] >= H) return;
    if (kind === 'pin') {
      remember();
      pin = p.map(v => Math.round(v * 10) / 10);
    } else if (kind === 'path') {
      remember();
      const seg = anchors.length > 1 ? segmentAt(p) : -1;
      if (seg >= 0) { anchors.splice(seg + 1, 0, snap(p)); retrace(seg, seg + 1); } else { anchors.push(snap(p)); retrace(anchors.length - 2); }
    } else if (areaTool === 'region') {
      const got = F.regionAt(f, p[0], p[1]);
      if (!got.size) { toast("That's on a border line or in the sea -- click inside the region."); return; }
      if (got.spilled) { toast('The lines round there don\'t close it in -- it ran out over most of the island. Draw this region with ✏️ Outline instead.'); return; }
      remember();
      for (let i = 0; i < mask.length; i++) if (got.mask[i]) mask[i] = e.altKey ? 0 : 1;
      paintMask();
      if (!e.altKey) toast(`Filled in the region -- about ${Math.round(got.size * kmPerPx() * kmPerPx())} km²`);
    } else if (areaTool === 'wand') {
      const got = F.wandAt(f, p[0], p[1], tolerance);
      if (!got.size) { toast('Nothing to fill there -- try the paint brush or an outline.'); return; }
      remember();
      for (let i = 0; i < mask.length; i++) if (got.mask[i]) mask[i] = e.altKey ? 0 : 1;
      paintMask();
      if (!e.altKey) toast(`Filled in ${got.kind === 'forest' ? 'the forest' : got.kind === 'water' ? 'the water' : 'the patch'} -- about ${Math.max(1, Math.round(got.size * kmPerPx() * kmPerPx()))} km²`);
    } else if (areaTool === 'outline') {
      if (lasso.length >= 3 && near(lasso[0], p, 10)) { closeLasso(e.altKey); return; }
      lasso.push(p.map(v => Math.round(v * 10) / 10));
    }
    tools(); draw();
  }

  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* not a live pointer */ }
    const p = toPaint(e);
    drag = { x: e.clientX, y: e.clientY, ox, oy, moved: false, button: e.button, pan: e.button !== 0 || space, mode: null, last: p };
    if (drag.pan) return;
    if (kind === 'pin' && near(pin, p, 14)) drag.mode = 'pin';
    else if (kind === 'path' && anchorAt(p) >= 0) drag.mode = { anchor: anchorAt(p) };
    else if (kind === 'area' && (areaTool === 'brush' || areaTool === 'erase')) { remember(); drag.mode = 'paint'; stroke(p, p); draw(); }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = toPaint(e);
    hover = p;
    if (!drag) { if (kind === 'area') draw(); return; }
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) {
      drag.moved = true;
      if (drag.mode === 'pin' || drag.mode?.anchor !== undefined) remember();
    }
    if (!drag.moved) return;
    if (drag.mode === 'pin') pin = p;
    else if (drag.mode?.anchor !== undefined) {
      anchors[drag.mode.anchor] = p;
      // straight lines while dragging, along the road again when it's let go
      const i = drag.mode.anchor;
      if (i > 0) segs[i - 1] = [anchors[i - 1], p];
      if (i < anchors.length - 1) segs[i] = [p, anchors[i + 1]];
    } else if (drag.mode === 'paint') { stroke(drag.last, p); drag.last = p; } else {
      ox = drag.ox + e.clientX - drag.x;
      oy = drag.oy + e.clientY - drag.y;
    }
    draw();
  });
  const up = (e) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    const p = toPaint(e);
    if (d.mode?.anchor !== undefined && d.moved) {
      anchors[d.mode.anchor] = snap(p);
      retrace(d.mode.anchor - 1, d.mode.anchor);
    } else if (d.mode === 'pin' && d.moved) {
      pin = p.map(v => Math.round(v * 10) / 10);
    } else if (!d.moved && d.button === 2 && kind === 'path' && anchorAt(p) >= 0) {
      remember();
      anchors.splice(anchorAt(p), 1);
      retrace();
    } else if (!d.moved && d.button === 0 && !d.pan && d.mode !== 'paint') {
      click(p, e);
      return;
    }
    tools(); draw();
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('pointerleave', () => { hover = null; if (kind === 'area') draw(); });
  canvas.addEventListener('dblclick', (e) => { if (kind === 'area' && areaTool === 'outline') closeLasso(e.altKey); });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1.18 : 1 / 1.18, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  overlay.addEventListener('input', (e) => {
    if (e.target.id === 'lmeBrush') brush = Number(e.target.value);
    if (e.target.id === 'lmeIconSize') {
      icon.size = Number(e.target.value);
      iconChanged = true;
      e.target.previousElementSibling.querySelector('b').textContent = `about ${icon.size} km tall`;
      draw();
    }
    if (e.target.id === 'lmeTol') tolerance = Number(e.target.value);
  });
  overlay.addEventListener('change', (e) => {
    if (e.target.id === 'lmeOthers') { showOthers = e.target.checked; draw(); }
    if (e.target.id === 'lmeFollow') {
      follow = e.target.checked;
      if (follow) anchors = anchors.map(snap);
      retrace(); tools(); draw();
    }
  });

  return new Promise((resolve) => {
    const close = (value) => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('keyup', onKeyUp, true);
      observer.disconnect();
      overlay.remove();
      resolve(value);
    };
    function finish() {
      const r = v => Math.round(v * 10) / 10;
      // the icon's new size goes back only with the mark itself -- not when Done is refused and the DM then cancels
      const done = (shape) => {
        if (icon && iconChanged) onIcon?.({ url: icon.url, size: icon.size });
        close(shape);
      };
      if (kind === 'pin') {
        if (!pin) { toast('Click on the map where it is first.'); return; }
        done({ kind: 'pin', x: r(pin[0]), y: r(pin[1]) });
      } else if (kind === 'path') {
        if (anchors.length < 2) { toast('A line needs a start and an end -- click both on the map.'); return; }
        done({ kind: 'path', follow, anchors: anchors.map(p => p.map(r)), points: pathPoints().map(p => p.map(r)) });
      } else {
        if (lasso.length >= 3) closeLasso(false);
        const rings = F.maskToRings(mask, W, H);
        if (!rings.length) { toast('Nothing filled in yet -- click inside the forest, paint it, or draw its outline.'); return; }
        done({ kind: 'area', rings });
      }
    }
    const onKey = (e) => {
      if (e.key === ' ' && e.target === document.body) { space = true; e.preventDefault(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
      if (e.key === 'Escape') { e.stopPropagation(); if (lasso.length) { lasso = []; tools(); draw(); } }
      if (e.key === 'Enter' && kind === 'area' && lasso.length >= 3) closeLasso(e.altKey);
    };
    const onKeyUp = (e) => { if (e.key === ' ') space = false; };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('keyup', onKeyUp, true);
    overlay.addEventListener('click', (e) => {
      const kb = e.target.closest('[data-kind]');
      if (kb) { kind = kb.dataset.kind; lasso = []; tools(); draw(); return; }
      const tb = e.target.closest('[data-tool]');
      if (tb) { areaTool = tb.dataset.tool; lasso = []; tools(); draw(); return; }
      const act = e.target.closest('[data-lme]')?.dataset.lme;
      if (act === 'cancel') close(undefined);
      else if (act === 'done') finish();
      else if (act === 'undo') undo();
      else if (act === 'in') zoomAt(1.4);
      else if (act === 'out') zoomAt(1 / 1.4);
      else if (act === 'fit') { fitAll(); draw(); }
      else if (act === 'clear') {
        remember();
        if (kind === 'path') { anchors = []; retrace(); } else { mask = new Uint8Array(W * H); lasso = []; paintMask(); }
        tools(); draw();
      }
    });
    const observer = new ResizeObserver(() => resize());
    cw = stage.clientWidth; ch = stage.clientHeight;
    // open on the location (with plenty round it), or the whole map when it isn't marked yet
    const b = F.shapeBounds(old);
    if (b) fitTo(b.x0 - 80, b.y0 - 80, b.x1 + 80, b.y1 + 80); else fitAll();
    observer.observe(stage);
    tools();
    resize();
    if (icon) iconImage(icon.url).then((im) => { iconImg = im; draw(); }).catch(() => {});
    others.filter(o => o.icon?.url && o.shape).forEach((o) => {
      iconImage(o.icon.url).then((im) => { otherIcons.push({ o, im }); draw(); }).catch(() => {});
    });
  });
}
