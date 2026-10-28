// DM console -- the region map's paintings (the Admin module's Locations tab, the user's call, 2026-10-20). Shima's
// map isn't finished: when Benjakronk paints more of it, the new painting is uploaded here and becomes the map --
//   1. Line it up: the DM clicks the same few spots on both maps (a town's middle, a cape, where two roads meet). Two
//      pairs say how the new painting sits on the one in use (turned, bigger, moved); a third checks it. A painting with
//      the same framing (only more drawn on it) is lined up by its edges without any.
//   2. Check it: the map in use laid see-through over the new painting, with every location on it.
//   3. Build it: its 3D land made from its colours right here (js/region-map/make-terrain.js, in a worker), then its
//      files stored on the Pi and every location's shape moved onto it.
// The maps before it are kept: any of them can be put back in use, and the locations move back with it
// (js/region-map/map-version.js keeps where each map sits on the first one).
// Regions (the user's call, 2026-10-28): the map can also be painted one region at a time -- each region its own
// painting (up to 4096 pixels, only the region, the rest see-through), lined up and checked the same way, then pasted
// onto the map's own painting (its frame) with the others and the map built again at the same size, so nothing marked
// on it moves. Each region is kept whole on the Pi (as a WebP): the painted picture is drawn from them at twice the
// map's size, and adding a region again later replaces it. A whole new painting starts without regions.
import { DmAPI } from '../api.js';
import { showCombatAlert, showCombatConfirm } from '../utils/combat-alert.js';
import { escapeHtml, newId, toast } from './dm-common.js';
import { drawShape } from './location-map.js';
import {
  FIRST_ID, allMaps, currentMap, loadMapState, between, compose, invert, apply, scaleOf, transformShape, transformIcon, fitSimilarity,
} from '../region-map/map-version.js';
import { SEA_OFFSET, paintTexture } from '../region-map/make-terrain.js';

const KM_PER_PX = 0.12;     // a new painting is worked on at the first one's detail: 120 m a pixel...
const MAX_SIDE = 2048;      // ...unless that's bigger than this (its 3D pictures are twice the size: 4096, what every
const MAX_PIXELS = 2.6e6;   // graphics card takes), or than this many pixels (the land's reading needs ~100 bytes each)
const PAIR_COLOURS = ['#ff5252', '#40c4ff', '#69f0ae', '#ffd740', '#e040fb', '#ff9100', '#ffffff', '#b2ff59'];

// A region (the user's call, 2026-10-28): one part of the map painted on its own at up to this size each way (what
// every graphics card takes), only the region, the rest see-through. Kept on the Pi as a WebP (see-through too, and
// under the Pi's 15 MB a picture -- a 4096 PNG of a painting can be more).
const REGION_MAX_SIDE = 4096;
const REGION_QUALITY = 0.92;

/** How fine a region's painting is, in words: metres a pixel. */
const regionDetail = (r, map) => `about ${Math.round((map.kmPerPx * 1000) / scaleOf(r.toMap))} m a pixel`;

async function loadBitmap(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`The Pi didn't send a picture (${res.status}).`);
  return createImageBitmap(await res.blob());
}

const sameFraming = (a, b) => Math.abs((a.W / a.H) / (b.W / b.H) - 1) < 0.02;
const km = (px, perPx) => `${Math.round(px * perPx)}`;

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't load the map's picture"));
    img.src = url;
  });
}

const blobOf = (canvas, type, quality) => new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error("Couldn't make the picture"))), type, quality));
const dataUrlOf = blob => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(new Error("Couldn't read the picture"));
  r.readAsDataURL(blob);
});
async function store(canvas, type, quality) {
  return (await DmAPI.adminPicture(await dataUrlOf(await blobOf(canvas, type, quality)))).url;
}
function canvasOf(W, H, pixels) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  if (pixels) c.getContext('2d').putImageData(new ImageData(pixels, W, H), 0, 0);
  return c;
}

/** The new painting's 3D land, made in a worker (on the page when there's none) -> make-terrain.js's terrain. */
function buildInWorker(rgba, W, H, options, onStep) {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(new URL('../region-map/terrain-worker.js', import.meta.url), { type: 'module' });
    } catch (err) {
      import('../region-map/make-terrain.js').then(m => m.buildTerrain(rgba, W, H, { ...options, onStep })).then(resolve, reject);
      return;
    }
    worker.onmessage = (e) => {
      if (e.data.step) onStep(e.data.step);
      else { worker.terminate(); if (e.data.error) reject(new Error(e.data.error)); else resolve(e.data.done); }
    };
    worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message || 'The land could not be built')); };
    worker.postMessage({ rgba, W, H, options }, [rgba.buffer]);
  });
}

// ---------------------------------------------------------------------------
// A picture you can zoom (wheel, ＋ －) and move (drag) and click on -- in its map's pixels
// ---------------------------------------------------------------------------

export function makePane(stage, { W, H, draw, onClick }) {
  const canvas = document.createElement('canvas');
  stage.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const v = { s: 1, ox: 0, oy: 0 };
  let cw = 0, ch = 0, dpr = 1;
  const fit = () => {
    v.s = Math.min(cw / W, ch / H) * 0.96;
    v.ox = (cw - W * v.s) / 2;
    v.oy = (ch - H * v.s) / 2;
  };
  const redraw = () => {
    if (!cw) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0c2240';
    ctx.fillRect(0, 0, cw, ch);
    draw(ctx, v, dpr);
  };
  const resize = () => {
    const r = stage.getBoundingClientRect();
    const first = !cw;
    dpr = window.devicePixelRatio || 1;
    cw = r.width; ch = r.height;
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    canvas.style.width = `${cw}px`; canvas.style.height = `${ch}px`;
    if (first) fit();
    redraw();
  };
  const zoom = (k, cx = cw / 2, cy = ch / 2) => {
    const s = Math.min(40, Math.max(0.02, v.s * k));
    v.ox = cx - ((cx - v.ox) * s) / v.s;
    v.oy = cy - ((cy - v.oy) * s) / v.s;
    v.s = s;
    redraw();
  };
  const at = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); const [x, y] = at(e); zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2, x, y); }, { passive: false });
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, ox: v.ox, oy: v.oy, moved: false };
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* a synthetic pointer */ }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true;
    v.ox = drag.ox + dx; v.oy = drag.oy + dy;
    canvas.style.cursor = 'grabbing';
    redraw();
  });
  canvas.addEventListener('pointerup', (e) => {
    const d = drag;
    drag = null;
    canvas.style.cursor = '';
    if (!d || d.moved || !onClick) return;
    const [x, y] = at(e);
    onClick([(x - v.ox) / v.s, (y - v.oy) / v.s], [x, y], v);
  });
  const observer = new ResizeObserver(resize);
  observer.observe(stage);
  return { redraw, zoom, fit: () => { fit(); redraw(); }, view: v, destroy: () => observer.disconnect() };
}

// ---------------------------------------------------------------------------
// The maps: which one is in use, the others to go back to, a new one to upload
// ---------------------------------------------------------------------------

/** ⬇ Export (the user's call, 2026-10-21): a map's painting saved to the DM's computer as a PNG -- the raw picture it
 * was made from, no locations, names or marks on it (to paint more of Shima on, say). Sent as it is when it's a PNG
 * already; another kind of picture is turned into one first. Named after the map. */
async function exportPainting(map) {
  const res = await fetch(map.files.painting, { cache: 'no-store' });
  if (!res.ok) throw new Error(`The Pi didn't send the painting (${res.status}).`);
  let blob = await res.blob();
  if (blob.type !== 'image/png') {
    const bitmap = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bitmap.width; c.height = bitmap.height;
    c.getContext('2d').drawImage(bitmap, 0, 0);
    blob = await new Promise((resolve, reject) => c.toBlob(b => (b ? resolve(b) : reject(new Error('The painting could not be made into a PNG.'))), 'image/png'));
  }
  const name = `${String(map.id === FIRST_ID ? 'Shiman Federation' : map.name || 'Region map').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Region map'}.png`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  toast(`Exported "${name}"`);
}

/** The region map's paintings. `locations`: the Locations tab's own list (moved onto a map switched to, and saved);
 * `onChanged`: after a switch. */
export async function openRegionMaps({ locations, onChanged }) {
  const overlay = document.createElement('div');
  overlay.className = 'dm-lme-overlay dm-mup';
  document.body.appendChild(overlay);
  let panes = [];
  const close = () => { panes.forEach(p => p.destroy()); overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape' && overlay.dataset.screen === 'list') close(); };
  document.addEventListener('keydown', onKey);

  let state, maps, inUse;
  async function showList() {
    panes.forEach(p => p.destroy());
    panes = [];
    overlay.dataset.screen = 'list';
    overlay.innerHTML = `<div class="dm-lme-head"><h3>🗺 The region map</h3><span class="dm-lme-spacer"></span><button class="dm-btn" data-mup="close">Close</button></div>
      <div class="dm-mup-list"><div class="dm-loading">Loading…</div></div>`;
    try {
      state = await loadMapState({ fresh: true });
      maps = await allMaps(state);
      inUse = await currentMap();
    } catch (err) {
      overlay.querySelector('.dm-mup-list').innerHTML = `<div class="dm-cs-empty">Couldn't load the maps from the Pi: ${escapeHtml(err.message)}</div>`;
      return;
    }
    overlay.querySelector('.dm-mup-list').innerHTML = `
      <p class="dm-hint dm-mup-intro">When more of Shima is painted, upload the new painting here: you line it up with the map in use by a
        few spots on both, its 3D land is made from its colours, and every location moves onto it. The maps before it stay
        here -- put one back in use at any time, and the locations move back with it.</p>
      <div class="dm-row dm-mup-topbtns">
        <button class="dm-btn primary dm-mup-upload" data-mup="upload">⬆ Upload a new painting</button>
        <button class="dm-btn" data-mup="export" data-id="${escapeHtml(inUse.id)}" title="The painting of the map in use, as it was uploaded -- no locations, names or marks on it">⬇ Export the map (PNG)</button>
      </div>
      <div class="dm-mup-regions">
        <div class="dm-card-title"><span>🧩 Regions of the map in use (${(inUse.regions || []).length})</span>
          <button class="dm-btn small primary" data-mup="region-add">⬆ Add a region</button></div>
        <div class="dm-hint">Paint one region at a time -- only the region, everything round it see-through (a PNG) -- and fit it onto the
          map: the map is built again with it pasted in (its land and all), and nothing marked on the map moves. A region
          added again later replaces the one there (↺). The maps from before stay in the list below; a whole new painting
          (⬆ above) starts without regions.</div>
        <div class="dm-mup-reglist">${(inUse.regions || []).map(r => `
          <div class="dm-mup-region">
            <img src="${escapeHtml(r.file)}" alt="" loading="lazy">
            <span><strong>${escapeHtml(r.name)}</strong><small>${r.at ? `${escapeHtml(new Date(r.at).toLocaleDateString())} · ` : ''}${r.W} × ${r.H} px · ${regionDetail(r, inUse)}</small></span>
            <button class="dm-btn small" data-mup="region-replace" data-id="${escapeHtml(r.id)}" title="A new painting of this region in its place">↺ Replace</button>
            <button class="dm-icon-btn danger" data-mup="region-remove" data-id="${escapeHtml(r.id)}" title="Build the map again without it">🗑</button>
          </div>`).join('') || '<div class="dm-hint">No regions added yet.</div>'}</div>
      </div>
      <div class="dm-mup-cards">${maps.slice().reverse().map(m => `
        <div class="dm-mup-card${m.id === inUse.id ? ' in-use' : ''}">
          <img src="${escapeHtml(m.files.topo)}" alt="" loading="lazy">
          <div class="dm-mup-cardtext">
            <strong>${escapeHtml(m.name || 'A map')}</strong>
            <small>${m.at ? `${escapeHtml(new Date(m.at).toLocaleDateString())} · ` : ''}about ${km(m.W, m.kmPerPx)} × ${km(m.H, m.kmPerPx)} km</small>
          </div>
          <div class="dm-mup-cardbtns"><button class="dm-icon-btn" data-mup="export" data-id="${escapeHtml(m.id)}" title="Export this painting (PNG) -- the raw picture, no locations on it">⬇</button>${m.id === inUse.id ? '<span class="dm-pill ok">In use</span>'
            : `<button class="dm-btn small primary" data-mup="use" data-id="${escapeHtml(m.id)}">Use this map</button>
               ${m.id === FIRST_ID ? '' : `<button class="dm-icon-btn danger" data-mup="delete" data-id="${escapeHtml(m.id)}" title="Delete this map">🗑</button>`}`}</div>
        </div>`).join('')}</div>`;
  }

  /** `target` becomes the map in use: every location's shape moved onto it, then the map switched (put back as they
   * were if that couldn't be saved). `addVersion`: a new map, added to the list at the same time. */
  async function switchTo(target, { addVersion = false } = {}) {
    const from = await currentMap({ fresh: true });
    const st = await loadMapState({ fresh: true });
    const m = between(from, target);
    const before = locations.map(l => [l.shape, l.icon]);
    locations.forEach((l) => {
      if (l.shape) l.shape = transformShape(l.shape, m);
      if (l.icon) l.icon = transformIcon(l.icon, m);   // (its size is in km: the same on every map)
    });
    try {
      await DmAPI.saveState('locations', locations);
      await DmAPI.saveState('region-map', {
        ...st,
        versions: addVersion ? [...(st.versions || []), target] : (st.versions || []),
        current: target.id === FIRST_ID ? null : target.id,
      });
    } catch (err) {
      locations.forEach((l, i) => { [l.shape, l.icon] = before[i]; if (!l.shape) delete l.shape; if (!l.icon) delete l.icon; });
      await DmAPI.saveState('locations', locations).catch(() => {});
      throw err;
    }
    // the table's view of the map (the middle it looks at) onto the new one too
    try {
      const view = await DmAPI.getState('region-map-view');
      if (view && Number.isFinite(view.x)) {
        const [x, y] = apply(m, view.x, view.y);
        await DmAPI.saveState('region-map-view', { ...view, x, y });
      }
    } catch (err) { /* it goes back to the whole island */ }
    await loadMapState({ fresh: true }).catch(() => {});
    await currentMap({ fresh: true });
    onChanged?.();
  }

  overlay.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-mup]');
    if (!b || overlay.dataset.screen !== 'list') return;
    const act = b.dataset.mup;
    if (act === 'close') close();
    else if (act === 'upload') {
      const file = await pickFile();
      if (file) lineUp(file);
    } else if (act === 'region-add' || act === 'region-replace') {
      const replaces = act === 'region-replace' ? (inUse.regions || []).find(r => r.id === b.dataset.id) : null;
      const file = await pickFile();
      if (file) lineUp(file, [], { replaces, fileName: file.name });
    } else if (act === 'region-remove') {
      const gone = (inUse.regions || []).find(r => r.id === b.dataset.id);
      if (!gone || !await showCombatConfirm(`Build the map again without "${gone.name}"? Its part of the map goes back to the painting under it. (The map as it is now stays in the list below.)`, { title: 'Remove region', yesLabel: 'Build it without', noLabel: 'Cancel' })) return;
      buildRegions({ cur: inUse, remove: gone, back: showList });
    } else if (act === 'export') {
      const target = maps.find(m => m.id === b.dataset.id);
      if (!target) return;
      b.disabled = true;
      try { await exportPainting(target); } catch (err) { showCombatAlert(err.message, { title: "Couldn't export the map" }); }
      b.disabled = false;
    } else if (act === 'use') {
      const target = maps.find(m => m.id === b.dataset.id);
      if (!target || !await showCombatConfirm(`Use "${target.name}" as the region map? The table's map, the PokéNav and every location move onto it.`, { title: 'Switch maps', yesLabel: 'Use it', noLabel: 'Cancel' })) return;
      b.disabled = true;
      try {
        await switchTo(target);
        toast(`The region map is now "${target.name}"`);
      } catch (err) {
        showCombatAlert(err.message, { title: "Couldn't switch maps" });
      }
      showList();
    } else if (act === 'delete') {
      const target = maps.find(m => m.id === b.dataset.id);
      if (!target || !await showCombatConfirm(`Delete the map "${target.name}"? It can't be put back in use after that.`, { title: 'Delete map', yesLabel: 'Delete', noLabel: 'Cancel' })) return;
      try {
        const st = await loadMapState({ fresh: true });
        await DmAPI.saveState('region-map', { ...st, versions: (st.versions || []).filter(v => v.id !== target.id) });
      } catch (err) {
        showCombatAlert(err.message, { title: "Couldn't delete the map" });
      }
      showList();
    }
  });

  function pickFile() {
    return new Promise((resolve) => {
      const el = document.createElement('input');
      el.type = 'file';
      el.accept = 'image/png,image/jpeg,image/webp';
      el.addEventListener('change', () => resolve(el.files?.[0] || null));
      el.click();
    });
  }

  // ---------------------------------------------------------------------------
  // 1. Line it up
  // ---------------------------------------------------------------------------

  /** `keep`: the spots placed before (back from checking). `region` ({ replaces, fileName }): a region being added (or
   * put in place of `replaces`) rather than a whole new painting. */
  async function lineUp(file, keep = [], region = null) {
    let up, oldShown;
    try {
      [up, oldShown] = await Promise.all([createImageBitmap(file), loadImage(inUse.files.painted)]);
    } catch (err) {
      showCombatAlert("That file couldn't be opened as a picture.", { title: region ? 'Add a region' : 'Upload a new painting' });
      return;
    }
    if (region && Math.max(up.width, up.height) > REGION_MAX_SIDE) {
      showCombatAlert(`That picture is ${up.width} × ${up.height} pixels -- a region can be ${REGION_MAX_SIDE} pixels at most each way (what every graphics card takes).`, { title: 'Add a region' });
      return;
    }
    const cur = inUse;
    const upMap = { W: up.width, H: up.height };
    const shownPer = oldShown.naturalWidth / cur.W;   // the painted picture's pixels per map pixel (2)
    // Lined up without any spots: a painting framed like the map in use by its edges; a region replacing one the same
    // size where that one sat (a new painting of the same region, from the same template)
    const same = region ? !!region.replaces && region.replaces.W === up.width && region.replaces.H === up.height : sameFraming(cur, upMap);
    const sameT = () => (region ? invert(region.replaces.toMap) : (s => [s, 0, 0, 0, s, 0])((up.width / cur.W + up.height / cur.H) / 2));
    const pairs = keep.map(p => ({ ...p }));   // [{ a: [x, y] on the map in use | null, b: on the new painting | null }]
    let T = null;       // the map in use's pixels -> the new painting's
    let error = 0;

    const solve = () => {
      const done = pairs.filter(p => p.a && p.b);
      const fit = fitSimilarity(done.map(p => p.a), done.map(p => p.b));
      if (fit) { T = fit.m; error = done.length > 2 ? fit.error : 0; } else if (same) { T = sameT(); error = 0; } else T = null;
    };
    solve();

    panes.forEach(p => p.destroy());
    overlay.dataset.screen = 'align';
    overlay.innerHTML = `<div class="dm-lme-head"><h3>${region ? `🧩 Line up the region${region.replaces ? ` (in place of "${escapeHtml(region.replaces.name)}")` : ''}` : '🗺 Line up the new painting'}</h3><span class="dm-lme-spacer"></span>
        <button class="dm-btn" data-al="cancel">Cancel</button><button class="dm-btn primary" data-al="next">Check it →</button></div>
      <div class="dm-lme-body">
        <aside class="dm-lme-tools" id="alTools"></aside>
        <div class="dm-mup-panes">
          <div class="dm-mup-pane"><div class="dm-mup-cap">The map in use</div><div class="dm-lme-stage" id="alOld"></div></div>
          <div class="dm-mup-pane"><div class="dm-mup-cap">${region ? 'The region' : 'The new painting'}</div><div class="dm-lme-stage" id="alNew"></div></div>
        </div>
      </div>`;
    const marks = (ctx, v, side) => {
      pairs.forEach((p, i) => {
        const pt = p[side];
        const col = PAIR_COLOURS[i % PAIR_COLOURS.length];
        if (pt) {
          const x = v.ox + pt[0] * v.s, y = v.oy + pt[1] * v.s;
          ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'; ctx.fill();
          ctx.lineWidth = 3; ctx.strokeStyle = col; ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y); ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4);
          ctx.lineWidth = 1.5; ctx.stroke();
          ctx.font = '700 12px Outfit, sans-serif'; ctx.fillStyle = col; ctx.fillText(String(i + 1), x + 11, y - 9);
        } else if (T) {
          // where it'd be by the others: a dashed ring to aim for
          const other = side === 'b' ? apply(T, ...p.a) : apply(invert(T), ...p.b);
          const x = v.ox + other[0] * v.s, y = v.oy + other[1] * v.s;
          ctx.save(); ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2);
          ctx.lineWidth = 2; ctx.strokeStyle = col; ctx.stroke(); ctx.restore();
        }
      });
    };
    const click = side => (pt, scr, v) => {
      // a mark clicked again comes off
      const hit = pairs.findIndex(p => p[side] && Math.hypot(v.ox + p[side][0] * v.s - scr[0], v.oy + p[side][1] * v.s - scr[1]) < 11);
      if (hit >= 0) {
        pairs[hit][side] = null;
        if (!pairs[hit].a && !pairs[hit].b) pairs.splice(hit, 1);
      } else {
        const open = pairs.find(p => !p[side]);
        if (open) open[side] = pt; else pairs.push({ a: null, b: null, [side]: pt });
      }
      solve(); tools(); paneOld.redraw(); paneNew.redraw();
    };
    const paneOld = makePane(overlay.querySelector('#alOld'), {
      W: cur.W, H: cur.H, onClick: click('a'),
      draw: (ctx, v) => { ctx.drawImage(oldShown, v.ox, v.oy, cur.W * v.s, cur.H * v.s); marks(ctx, v, 'a'); },
    });
    const paneNew = makePane(overlay.querySelector('#alNew'), {
      W: up.width, H: up.height, onClick: click('b'),
      draw: (ctx, v) => { ctx.imageSmoothingQuality = 'high'; ctx.drawImage(up, v.ox, v.oy, up.width * v.s, up.height * v.s); marks(ctx, v, 'b'); },
    });
    panes = [paneOld, paneNew];
    function tools() {
      const done = pairs.filter(p => p.a && p.b).length;
      const s = T ? scaleOf(T) : 0;
      const missKm = T && error ? (error / s) * cur.kmPerPx : 0;
      overlay.querySelector('#alTools').innerHTML = `
        <div class="dm-hint">Click the same spot on both maps -- a town's middle, the tip of a cape, where two roads meet. Spread them out:
          two pairs line the maps up, a third checks it. Scroll to zoom, drag to move; click a mark again to take it off.</div>
        ${same ? `<div class="dm-lme-stat dm-mup-same">${region ? `✓ The same size as the region it replaces${done < 2 ? ': put where that one was -- spots only if it looks off' : ''}`
          : `✓ The same framing as the map in use${done < 2 ? ': lined up by its edges -- spots only if it looks off' : ''}`}</div>` : ''}
        <div class="dm-mup-pairs">${pairs.map((p, i) => `<div class="dm-mup-pair"><span class="dm-mup-dot" style="background:${PAIR_COLOURS[i % PAIR_COLOURS.length]}"></span>
          <span>${i + 1}. ${p.a ? '✓' : '…'} on the map in use · ${p.b ? '✓' : '…'} on the ${region ? 'region' : 'new one'}</span>
          <button class="dm-icon-btn danger" data-al="del" data-i="${i}" title="Take this pair off">✕</button></div>`).join('') || '<div class="dm-hint">No spots yet.</div>'}</div>
        <div class="dm-lme-stat">${T ? `${done >= 2 ? `Lined up by ${done} pairs` : region ? 'Put where the one it replaces was' : 'Lined up by its edges'}${error ? ` -- they agree within about ${missKm < 1 ? missKm.toFixed(1) : Math.round(missKm)} km${missKm > 2 ? '. One of them may be off' : ''}` : ''}`
          : `${2 - done} more pair${2 - done === 1 ? '' : 's'} to line them up`}</div>
        ${T ? `<div class="dm-hint">The ${region ? 'region' : 'new painting'} is ${s >= 1 ? `${s.toFixed(2)} × bigger` : `${(1 / s).toFixed(2)} × smaller`}, turned ${Math.round((Math.atan2(T[3], T[0]) * 180) / Math.PI)}°${region ? ` -- about ${Math.round((cur.kmPerPx * 1000) / s)} m a pixel (the map in use: ${Math.round(cur.kmPerPx * 1000)} m)` : ''}.</div>` : ''}
        ${pairs.length ? '<button class="dm-btn small danger" data-al="clear">Clear the spots</button>' : ''}`;
      overlay.querySelector('[data-al="next"]').disabled = !T;
    }
    tools();
    overlay.onclick = (e) => {
      const b = e.target.closest('[data-al]');
      if (!b) return;
      if (b.dataset.al === 'cancel') { overlay.onclick = null; showList(); }
      else if (b.dataset.al === 'next' && T) { overlay.onclick = null; check({ up, oldShown, shownPer, cur, T, region, back: () => lineUp(file, pairs, region) }); }
      else if (b.dataset.al === 'del') { pairs.splice(Number(b.dataset.i), 1); solve(); tools(); paneOld.redraw(); paneNew.redraw(); }
      else if (b.dataset.al === 'clear') { pairs.length = 0; solve(); tools(); paneOld.redraw(); paneNew.redraw(); }
    };
  }

  // ---------------------------------------------------------------------------
  // 2. Check it: the map in use see-through over the new painting, the locations on it
  // ---------------------------------------------------------------------------

  function check({ up, oldShown, shownPer, cur, T, region = null, back }) {
    panes.forEach(p => p.destroy());
    overlay.dataset.screen = 'check';
    // A region: the map in use whole, the region laid on it (see-through as the slider says) -- a whole painting: the
    // map in use laid over it
    let alpha = region ? 0.75 : 0.5;
    let showLocs = true;
    overlay.innerHTML = `<div class="dm-lme-head"><h3>🗺 Does it line up?</h3><span class="dm-lme-spacer"></span>
        <button class="dm-btn" data-ck="back">← The spots</button><button class="dm-btn primary" data-ck="next">${region ? 'Build the map with it →' : 'Build the 3D land →'}</button></div>
      <div class="dm-lme-body">
        <aside class="dm-lme-tools">
          <div class="dm-hint">${region ? 'The region, laid on the map in use the way the spots lined them up. Slide it to see through: its coast, roads and towns should sit on those of the map, and its edges meet the regions round it.'
            : `The map in use, laid over the new painting the way the spots lined them up. Slide it to see through:
            the coasts, roads and towns should sit on each other where both maps have them.`}</div>
          <label class="dm-field"><span>${region ? 'The region on top' : 'The map in use on top'}: <b id="ckPct">${Math.round(alpha * 100)} %</b></span><input type="range" id="ckAlpha" min="0" max="100" value="${Math.round(alpha * 100)}"></label>
          <label class="dm-check"><input type="checkbox" id="ckLocs" checked><span>Show the locations <small>where they'll be on the new map</small></span></label>
        </aside>
        <div class="dm-lme-stage" id="ckStage"></div>
      </div>`;
    const shapes = locations.filter(l => l.shape).map(l => ({ name: l.name || '', shape: transformShape(l.shape, T) }));
    const pane = makePane(overlay.querySelector('#ckStage'), {
      W: up.width, H: up.height,
      draw: (ctx, v, dpr) => {
        ctx.imageSmoothingQuality = 'high';
        if (!region) ctx.drawImage(up, v.ox, v.oy, up.width * v.s, up.height * v.s);
        if (alpha > 0 || region) {
          // screen <- new painting (the view) <- the map in use (T) <- its painted picture (shownPer)
          const m = compose([v.s, 0, v.ox, 0, v.s, v.oy], compose(T, [1 / shownPer, 0, 0, 0, 1 / shownPer, 0]));
          ctx.save();
          ctx.globalAlpha = region ? 1 : alpha;
          ctx.setTransform(dpr * m[0], dpr * m[3], dpr * m[1], dpr * m[4], dpr * m[2], dpr * m[5]);
          ctx.drawImage(oldShown, 0, 0);
          ctx.restore();
        }
        if (region && alpha > 0) {
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.drawImage(up, v.ox, v.oy, up.width * v.s, up.height * v.s);
          ctx.restore();
        }
        if (showLocs) shapes.forEach(s => drawShape(ctx, s.shape, v, { name: s.name }));
      },
    });
    panes = [pane];
    overlay.querySelector('#ckAlpha').addEventListener('input', (e) => {
      alpha = Number(e.target.value) / 100;
      overlay.querySelector('#ckPct').textContent = `${e.target.value} %`;
      pane.redraw();
    });
    overlay.querySelector('#ckLocs').addEventListener('change', (e) => { showLocs = e.target.checked; pane.redraw(); });
    overlay.onclick = (e) => {
      const b = e.target.closest('[data-ck]');
      if (!b) return;
      overlay.onclick = null;
      if (b.dataset.ck === 'back') back();
      else if (region) buildRegions({ cur, add: { up, T, replaces: region.replaces, fileName: region.fileName }, back: () => check({ up, oldShown, shownPer, cur, T, region, back }) });
      else build({ up, cur, T, back: () => check({ up, oldShown, shownPer, cur, T, back }) });
    };
  }

  // ---------------------------------------------------------------------------
  // 3. Build it: the land, the pictures, stored, switched to
  // ---------------------------------------------------------------------------

  function build({ up, cur, T, back }) {
    panes.forEach(p => p.destroy());
    panes = [];
    overlay.dataset.screen = 'build';
    // Worked on at the first painting's detail (so the land's reading finds the same sizes of things), as far as the
    // limits let it.
    const upKm = cur.kmPerPx / scaleOf(T);                  // km per pixel of the new painting
    let f = upKm / KM_PER_PX;
    f = Math.min(f, MAX_SIDE / Math.max(up.width, up.height), Math.sqrt(MAX_PIXELS / (up.width * up.height)));
    const W = Math.max(64, Math.round(up.width * f)), H = Math.max(64, Math.round(up.height * f));
    const fx = W / up.width, fy = H / up.height;
    const M = compose([fx, 0, 0, 0, fy, 0], T);              // the map in use's pixels -> the new map's
    const kmPerPx = upKm / ((fx + fy) / 2);
    const name = `Shima ${new Date().toLocaleDateString()}`;
    overlay.innerHTML = `<div class="dm-lme-head"><h3>🗺 The new map</h3><span class="dm-lme-spacer"></span>
        <button class="dm-btn" data-bd="back">← Check it</button><button class="dm-btn primary" data-bd="use" disabled>Use this map</button></div>
      <div class="dm-mup-build">
        <label class="dm-field"><span>Its name</span><input class="dm-input" id="bdName" value="${escapeHtml(name)}" maxlength="60"></label>
        <div class="dm-hint">${W} × ${H} pixels, about ${km(W, kmPerPx)} × ${km(H, kmPerPx)} km. Its land is read from its colours like the first map's: the blue
          round it the sea, the grey, brown and snowy parts mountains, the dark green forests, the dark lines roads.</div>
        <div class="dm-lme-stat" id="bdStep">Getting ready…</div>
        <canvas class="dm-mup-preview" id="bdPrev" hidden></canvas>
      </div>`;
    const step = (t) => { const el = overlay.querySelector('#bdStep'); if (el) el.textContent = t; };
    let built = null;
    let cancelled = false;
    overlay.onclick = async (e) => {
      const b = e.target.closest('[data-bd]');
      if (!b) return;
      if (b.dataset.bd === 'back') { cancelled = true; overlay.onclick = null; back(); return; }
      if (b.dataset.bd !== 'use' || !built) return;
      b.disabled = true;
      overlay.querySelector('[data-bd="back"]').disabled = true;
      try {
        await useIt(built, overlay.querySelector('#bdName').value.trim() || name, step);
        toast('The new map is in use');
        overlay.onclick = null;
        showList();
      } catch (err) {
        step(`Couldn't store it: ${err.message}`);
        b.disabled = false;
        overlay.querySelector('[data-bd="back"]').disabled = false;
      }
    };

    (async () => {
      const work = canvasOf(W, H);
      const wctx = work.getContext('2d', { willReadFrequently: true });
      wctx.imageSmoothingQuality = 'high';
      wctx.drawImage(up, 0, 0, W, H);
      const rgba = wctx.getImageData(0, 0, W, H).data;
      // the towns (kept low and even: their buildings would read as rock) and the names on the water, from the map in use
      const inside = ([x, y]) => x >= 0 && y >= 0 && x < W && y < H;
      const towns = [
        ...(cur.places?.towns || []).map(t => apply(M, t.x, t.y)),
        ...locations.filter(l => l.type === 'city' && l.shape?.kind === 'pin').map(l => apply(M, l.shape.x, l.shape.y)),
      ].filter(inside);
      const water = (cur.places?.water || []).map(w => { const [x, y] = apply(M, w.x, w.y); return { name: w.name, x, y }; }).filter(w => inside([w.x, w.y]));
      const t = await buildInWorker(new Uint8ClampedArray(rgba), W, H, { towns, water, k: KM_PER_PX / kmPerPx, scale: 2 }, step);
      if (cancelled) return;
      step('Painting the shaded picture');
      const big = canvasOf(t.SW, t.SH);
      const bctx = big.getContext('2d', { willReadFrequently: true });
      bctx.imageSmoothingQuality = 'high';
      bctx.drawImage(up, 0, 0, t.SW, t.SH);
      const painted = bctx.getImageData(0, 0, t.SW, t.SH);
      paintTexture(painted.data, t);
      bctx.putImageData(painted, 0, 0);
      const topo = canvasOf(t.SW, t.SH, new Uint8ClampedArray(t.topo.buffer));
      const height = canvasOf(W, H, new Uint8ClampedArray(t.height.buffer));
      built = { W, H, kmPerPx, M, t, work, big, topo, height, water, towns: (cur.places?.towns || []).map(x => { const [px, py] = apply(M, x.x, x.y); return { name: x.name, x: Math.round(px), y: Math.round(py) }; }).filter(x => inside([x.x, x.y])) };
      const prev = overlay.querySelector('#bdPrev');
      if (!prev) return;
      const ph = 420, pw = Math.round((ph * t.SW) / t.SH);
      prev.width = pw; prev.height = ph;
      prev.getContext('2d').drawImage(topo, 0, 0, pw, ph);
      prev.hidden = false;
      step(`Built: ${Math.round(t.stats.land * 100)} % land, the highest peak ${t.stats.highest.toLocaleString()} m, ${t.stats.spots} red spot${t.stats.spots === 1 ? '' : 's'}${t.stats.lake ? ', a lake' : ''}. Check the topographic map below, then use it.`);
      overlay.querySelector('[data-bd="use"]').disabled = false;
    })().catch((err) => { if (!cancelled) step(`The land couldn't be built: ${err.message}`); });
  }

  async function useIt(b, name, step) {
    step('Storing the painting on the Pi (1 of 4)…');
    const painting = await store(b.work, 'image/png');
    step('Storing the heights (2 of 4)…');
    const height = await store(b.height, 'image/png');
    step('Storing the topographic map (3 of 4)…');
    const topo = await store(b.topo, 'image/jpeg', 0.88);
    step('Storing the painted map (4 of 4)…');
    const painted = await store(b.big, 'image/jpeg', 0.88);
    const cur = await currentMap({ fresh: true });
    const version = {
      id: newId('map'), name, at: new Date().toISOString(), W: b.W, H: b.H, kmPerPx: b.kmPerPx,
      toBase: compose(cur.toBase, invert(b.M)),
      files: { painting, height, topo, painted },
      places: { width: b.W, height: b.H, seaOffset: SEA_OFFSET, scale: 2, towns: b.towns, spots: b.t.dots, water: b.water.map(w => ({ name: w.name, x: Math.round(w.x), y: Math.round(w.y) })) },
    };
    step('Moving the locations onto it…');
    await switchTo(version, { addVersion: true });
  }

  // ---------------------------------------------------------------------------
  // Regions: the map built again from its frame (the painting before any region was added) with every region pasted
  // on in order -- `add` ({ up, T: the map's pixels -> the region's, replaces, fileName }) one more (or in place of the
  // one it replaces), `remove` one less. The same size, the same place on the first map: nothing marked on it moves.
  // ---------------------------------------------------------------------------

  function buildRegions({ cur, add = null, remove = null, back }) {
    panes.forEach(p => p.destroy());
    panes = [];
    overlay.dataset.screen = 'build';
    const { W, H } = cur;
    const frameUrl = cur.frame?.painting || cur.files.painting;
    const added = add && {
      id: add.replaces?.id || newId('region'), name: add.replaces?.name || '', W: add.up.width, H: add.up.height,
      toMap: invert(add.T), at: new Date().toISOString(),
    };
    const regions = (cur.regions || []).filter(r => r.id !== remove?.id).map(r => (r.id === added?.id ? added : r));
    if (added && !add.replaces) regions.push(added);
    const guess = (add?.fileName || '').replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim();
    overlay.innerHTML = `<div class="dm-lme-head"><h3>🧩 ${remove ? `The map without "${escapeHtml(remove.name)}"` : 'The map with the region'}</h3><span class="dm-lme-spacer"></span>
        <button class="dm-btn" data-bd="back">← ${add ? 'Check it' : 'Back'}</button><button class="dm-btn primary" data-bd="use" disabled>Use this map</button></div>
      <div class="dm-mup-build">
        ${added ? `<label class="dm-field"><span>The region's name</span><input class="dm-input" id="bdRegion" value="${escapeHtml(added.name || guess)}" maxlength="60" placeholder="e.g. Inex Woods"></label>` : ''}
        <div class="dm-hint">${regions.length} region${regions.length === 1 ? '' : 's'} pasted onto the map's own painting (${W} × ${H} pixels, about ${km(W, cur.kmPerPx)} × ${km(H, cur.kmPerPx)} km),
          its land read again from the colours. The painted picture is drawn from the regions' full paintings.</div>
        <div class="dm-lme-stat" id="bdStep">Getting ready…</div>
        <canvas class="dm-mup-preview" id="bdPrev" hidden></canvas>
      </div>`;
    const step = (t) => { const el = overlay.querySelector('#bdStep'); if (el) el.textContent = t; };
    let built = null;
    let cancelled = false;
    overlay.onclick = async (e) => {
      const b = e.target.closest('[data-bd]');
      if (!b) return;
      if (b.dataset.bd === 'back') { cancelled = true; overlay.onclick = null; back(); return; }
      if (b.dataset.bd !== 'use' || !built) return;
      if (added) {
        added.name = overlay.querySelector('#bdRegion').value.trim();
        if (!added.name) { overlay.querySelector('#bdRegion').focus(); step('Give the region a name first.'); return; }
      }
      b.disabled = true;
      overlay.querySelector('[data-bd="back"]').disabled = true;
      try {
        await useRegions(built, step);
        toast(remove ? `"${remove.name}" is off the map` : `"${added.name}" is on the map`);
        overlay.onclick = null;
        showList();
      } catch (err) {
        step(`Couldn't store it: ${err.message}`);
        b.disabled = false;
        overlay.querySelector('[data-bd="back"]').disabled = false;
      }
    };

    (async () => {
      step('Pasting the regions onto the map…');
      const frame = await loadBitmap(frameUrl);
      // the map's painting (to read the land from) and, twice the size, the one the painted picture is made from
      const work = canvasOf(W, H);
      const wctx = work.getContext('2d', { willReadFrequently: true });
      const SW = Math.round(W * 2), SH = Math.round(H * 2);
      const big = canvasOf(SW, SH);
      const bctx = big.getContext('2d', { willReadFrequently: true });
      [wctx, bctx].forEach((c) => { c.imageSmoothingQuality = 'high'; });
      wctx.drawImage(frame, 0, 0, W, H);
      bctx.drawImage(frame, 0, 0, SW, SH);
      frame.close?.();
      for (const [i, r] of regions.entries()) {
        if (cancelled) return;
        step(`Pasting the regions onto the map (${i + 1} of ${regions.length})…`);
        const pic = r === added ? add.up : await loadBitmap(r.file);
        for (const [c, k] of [[wctx, 1], [bctx, SW / W]]) {
          const m = compose([k, 0, 0, 0, k, 0], r.toMap);
          c.setTransform(m[0], m[3], m[1], m[4], m[2], m[5]);
          c.drawImage(pic, 0, 0);
          c.setTransform(1, 0, 0, 1, 0, 0);
        }
        if (r !== added) pic.close?.();
      }
      const rgba = wctx.getImageData(0, 0, W, H).data;
      const inside = ([x, y]) => x >= 0 && y >= 0 && x < W && y < H;
      const towns = [
        ...(cur.places?.towns || []).map(t => [t.x, t.y]),
        ...locations.filter(l => l.type === 'city' && l.shape?.kind === 'pin').map(l => [l.shape.x, l.shape.y]),
      ].filter(inside);
      const water = (cur.places?.water || []).filter(w => inside([w.x, w.y]));
      const t = await buildInWorker(new Uint8ClampedArray(rgba), W, H, { towns, water, k: KM_PER_PX / cur.kmPerPx, scale: 2 }, step);
      if (cancelled) return;
      step('Painting the shaded picture');
      const painted = bctx.getImageData(0, 0, t.SW, t.SH);
      paintTexture(painted.data, t);
      bctx.putImageData(painted, 0, 0);
      built = {
        cur, frameUrl, regions, added, addUp: add?.up, t, work, big, water,
        topo: canvasOf(t.SW, t.SH, new Uint8ClampedArray(t.topo.buffer)),
        height: canvasOf(W, H, new Uint8ClampedArray(t.height.buffer)),
      };
      const prev = overlay.querySelector('#bdPrev');
      if (!prev) return;
      const ph = 420, pw = Math.round((ph * t.SW) / t.SH);
      prev.width = pw; prev.height = ph;
      prev.getContext('2d').drawImage(big, 0, 0, pw, ph);
      prev.hidden = false;
      step(`Built: ${Math.round(t.stats.land * 100)} % land, the highest peak ${t.stats.highest.toLocaleString()} m, ${t.stats.spots} red spot${t.stats.spots === 1 ? '' : 's'}${t.stats.lake ? ', a lake' : ''}. Check the painted map below, then use it.`);
      overlay.querySelector('[data-bd="use"]').disabled = false;
    })().catch((err) => { if (!cancelled) step(`The map couldn't be built: ${err.message}`); });
  }

  async function useRegions(b, step) {
    const n = b.added ? 5 : 4;
    if (b.added) {
      step(`Storing the region's painting on the Pi (1 of ${n})…`);
      const pic = canvasOf(b.added.W, b.added.H);
      pic.getContext('2d').drawImage(b.addUp, 0, 0);
      b.added.file = await store(pic, 'image/webp', REGION_QUALITY);
    }
    step(`Storing the map's painting (${n - 3} of ${n})…`);
    const painting = await store(b.work, 'image/png');
    step(`Storing the heights (${n - 2} of ${n})…`);
    const height = await store(b.height, 'image/png');
    step(`Storing the topographic map (${n - 1} of ${n})…`);
    const topo = await store(b.topo, 'image/jpeg', 0.88);
    step(`Storing the painted map (${n} of ${n})…`);
    const painted = await store(b.big, 'image/jpeg', 0.88);
    const { cur, t } = b;
    const replaced = b.added && (cur.regions || []).some(r => r.id === b.added.id);
    const gone = (cur.regions || []).find(r => !b.regions.some(x => x.id === r.id));
    const name = b.added ? `Shima: ${b.added.name} ${replaced ? 'painted again' : 'added'}` : `Shima: ${gone?.name || 'a region'} taken off`;
    const version = {
      id: newId('map'), name, at: new Date().toISOString(),
      W: cur.W, H: cur.H, kmPerPx: cur.kmPerPx, toBase: cur.toBase || [1, 0, 0, 0, 1, 0],
      files: { painting, height, topo, painted },
      places: { width: cur.W, height: cur.H, seaOffset: SEA_OFFSET, scale: 2,
        towns: (cur.places?.towns || []).filter(x => x.x >= 0 && x.y >= 0 && x.x < cur.W && x.y < cur.H), spots: t.dots, water: b.water },
      frame: { painting: b.frameUrl },
      regions: b.regions,
    };
    step('Putting it in use…');
    await switchTo(version, { addVersion: true });
  }

  await showList();
}
