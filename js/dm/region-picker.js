// DM console -- the regions on the map by its borders (the user's call, 2026-11-04: with the borders drawn on the map,
// the app knows where each region is -- the DM clicks one instead of marking it round). The Locations tab's
// 🧩 Regions on the map: the map with its borders and the regions marked so far; a click in a marked region opens that
// location, a click in one not marked yet makes it a new region location -- its land up to the borders and the coast
// (location-map.js regionCell), with the sea along its coast (regionReachOf), as the location editor's 🧩 Click it does.
import { escapeHtml, toast } from './dm-common.js';
import * as F from '../region-map/map-features.js';
import { makePane } from './map-upload.js';
import { loadPainting, fenceFor, regionFreeLand, regionCell, regionReachOf, drawBorders, drawShape } from './location-map.js';
import { kmPerPx } from '../region-map/map-version.js';

/** -> { id } (a marked region clicked: open it), { name, shape } (a new one), or null (closed). */
export async function pickRegionOnMap(locations) {
  let P;
  try {
    P = await loadPainting();
  } catch (err) {
    toast(`Couldn't load the map: ${err.message}`);
    return null;
  }
  if (!fenceFor(P)) {
    toast('The map has no borders yet -- upload them first: 🗺 The region map, The region borders.');
    return null;
  }
  const { W, H } = P;
  const regions = locations.filter(l => l.type === 'region' && l.shape?.kind === 'area');
  const area = l => Math.abs((l.shape.rings || []).reduce((a, r) => a + F.ringArea(r), 0));
  // the smallest marked region a spot is in
  const regionAt = (x, y) => regions.filter(l => F.pointInRings(l.shape.rings, x, y)).sort((a, b) => area(a) - area(b))[0] || null;

  const overlay = document.createElement('div');
  overlay.className = 'dm-lme-overlay';
  overlay.innerHTML = `
    <div class="dm-lme-head"><h3>🧩 The regions on the map</h3><span class="dm-lme-spacer"></span>
      <button class="dm-btn" data-rp="close">Close</button></div>
    <div class="dm-lme-body">
      <aside class="dm-lme-tools">
        <div class="dm-hint"><b>Click a region.</b> One marked already opens its location; one that isn't becomes a new region
          location -- its land up to the borders (the red lines) and the coast. Scroll to zoom, drag to move.</div>
        <div class="dm-lme-stat" id="rpAt">Point at a region</div>
        <div class="dm-hint">${regions.length} region${regions.length === 1 ? '' : 's'} marked.</div>
        <div id="rpNew" hidden></div>
      </aside>
      <div class="dm-lme-stage" id="rpStage"></div>
    </div>`;
  document.body.appendChild(overlay);

  let hover = null;       // the marked region under the pointer
  let cellPic = null;     // a new region's land, shown while it's named
  let busy = false;
  return new Promise((resolve) => {
    const close = (value) => { pane.destroy(); document.removeEventListener('keydown', onKey); overlay.remove(); resolve(value); };
    const onKey = (e) => { if (e.key === 'Escape' && !busy) close(null); };
    document.addEventListener('keydown', onKey);
    const pane = makePane(overlay.querySelector('#rpStage'), {
      W, H,
      draw: (ctx, v) => {
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(P.shown, v.ox, v.oy, W * v.s, H * v.s);
        regions.forEach(l => drawShape(ctx, l.shape, v, { faint: l !== hover, name: l.name || '' }));
        if (cellPic) {
          ctx.imageSmoothingEnabled = v.s < 2;
          ctx.drawImage(cellPic, v.ox, v.oy, W * v.s, H * v.s);
          ctx.imageSmoothingEnabled = true;
        }
        drawBorders(ctx, P, v);
      },
      onClick: async ([x, y]) => {
        if (busy || x < 0 || y < 0 || x >= W || y >= H) return;
        const hit = regionAt(x, y);
        if (hit) { close({ id: hit.id }); return; }
        const got = regionCell(P, regionFreeLand(P, locations), x, y);
        if (!got.size) {
          const i = Math.round(y) * W + Math.round(x);
          toast(fenceFor(P)[i] ? 'That\'s on a border -- click inside the region.' : 'That\'s the sea -- click on land.');
          return;
        }
        // named on the left, the land it takes in yellow on the map meanwhile
        busy = true;
        cellPic = picture(got.mask, W, H);
        pane.redraw();
        const box = overlay.querySelector('#rpNew');
        box.hidden = false;
        box.innerHTML = `<div class="dm-card-title">🧩 A new region</div>
          <div class="dm-hint">About ${Math.max(1, Math.round(got.size * kmPerPx() * kmPerPx())).toLocaleString()} km² of land, up to the borders and the coast -- in yellow.
            Too much? A border has a gap there: close it in the location's map (⭕ Ring) after.</div>
          <label class="dm-field"><span>Its name</span><input class="dm-input" id="rpName" maxlength="60" placeholder="e.g. Inex Woods"></label>
          <div class="dm-row"><button class="dm-btn" data-rp="cancel">Cancel</button><button class="dm-btn primary" data-rp="make">Make the region</button></div>`;
        const input = box.querySelector('#rpName');
        input.focus();
        const go = await new Promise((done) => {
          box.onclick = (e) => { const a = e.target.closest('[data-rp]')?.dataset.rp; if (a) done(a === 'make'); };
          input.onkeydown = (e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
        });
        busy = false;
        box.hidden = true;
        if (!go) { cellPic = null; pane.redraw(); return; }
        const rings = F.maskToRings(got.mask, W, H);
        close({ name: input.value.trim() || 'New region', shape: { kind: 'area', rings, ...regionReachOf(P, got.mask) } });
      },
    });
    const canvas = overlay.querySelector('#rpStage canvas');
    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect(), v = pane.view;
      const x = (e.clientX - r.left - v.ox) / v.s, y = (e.clientY - r.top - v.oy) / v.s;
      const now = x >= 0 && y >= 0 && x < W && y < H ? regionAt(x, y) : null;
      if (now === hover) return;
      hover = now;
      overlay.querySelector('#rpAt').innerHTML = hover ? `<b>${escapeHtml(hover.name || 'Unnamed')}</b> -- click to open it` : 'Not a region yet -- click land to make one';
      canvas.style.cursor = 'pointer';
      pane.redraw();
    });
    overlay.querySelector('[data-rp="close"]').addEventListener('click', () => { if (!busy) close(null); });
  });
}

/** A mask as a see-through yellow picture (its edge solid). */
function picture(mask, W, H) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const cx = c.getContext('2d');
  const img = cx.createImageData(W, H);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const x = i % W;
    const edge = x === 0 || x === W - 1 || i < W || i >= W * (H - 1) || !mask[i - 1] || !mask[i + 1] || !mask[i - W] || !mask[i + W];
    img.data.set(edge ? [255, 236, 90, 255] : [255, 200, 40, 110], i * 4);
  }
  cx.putImageData(img, 0, 0);
  return c;
}
