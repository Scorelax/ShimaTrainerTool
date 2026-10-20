// DM console -- a location's icon on the region map (the user's call, 2026-10-20): a little model of the place (a
// picture the DM uploads, best a PNG with a see-through background, like the painted cities) standing on the 3D map,
// more to look at than a pin. Placed and sized here, against the painting and every other location's icon, so they keep
// to scale with each other.
//
// What's kept on the location: icon = { url, x, y (where it stands: painting pixels of the map in use, its bottom
// middle -- moved onto a new map with the shapes, js/region-map/map-version.js), size (how tall it stands, in km: the
// same on every map) }. js/region-map/region-map.js stands it on the land, facing the camera.
import { escapeHtml, toast } from './dm-common.js';
import { loadPainting, drawShape } from './location-map.js';
import { makePane } from './map-upload.js';
import { shapeBounds } from '../region-map/map-features.js';
import { kmPerPx } from '../region-map/map-version.js';

export const ICON_SIZE = { min: 0.5, max: 30, step: 0.5, first: 5 };   // km tall

const _images = {};
function iconImage(url) {
  if (!_images[url]) {
    _images[url] = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => { delete _images[url]; reject(new Error("Couldn't load the icon")); };
      img.src = url;
    });
  }
  return _images[url];
}

/** One icon onto a 2D canvas, standing on its spot (`v` = { s (canvas pixels per painting pixel), ox, oy }). */
function drawIcon(ctx, img, icon, v, { faint = false } = {}) {
  const h = ((icon.size || ICON_SIZE.first) / kmPerPx()) * v.s;
  const w = (h * img.naturalWidth) / Math.max(1, img.naturalHeight);
  const x = v.ox + icon.x * v.s, y = v.oy + icon.y * v.s;
  ctx.save();
  ctx.globalAlpha = faint ? 0.85 : 1;
  ctx.drawImage(img, x - w / 2, y - h, w, h);
  if (!faint) {
    ctx.strokeStyle = 'rgba(255, 210, 63, 0.9)';
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x - w / 2, y - h, w, h);
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd23f';
    ctx.fill();
  }
  ctx.restore();
}

/** Where a new icon stands first: the middle of the location's mark, else the middle of the map. */
export function firstSpot(loc, W, H) {
  const b = shapeBounds(loc.shape);
  return b ? { x: Math.round(b.mid[0]), y: Math.round(b.mid[1]) } : { x: Math.round(W / 2), y: Math.round(H / 2) };
}

/** The icon placed and sized on the painting -> the new icon, or undefined (cancelled). `others`: the other locations,
 * their icons drawn for scale. */
export async function placeLocationIcon(loc, others = []) {
  let P, img;
  try {
    [P, img] = await Promise.all([loadPainting(), iconImage(loc.icon.url)]);
  } catch (err) {
    toast(`Couldn't load the map: ${err.message}`);
    return undefined;
  }
  const otherIcons = (await Promise.all(others.filter(o => o.icon?.url && Number.isFinite(o.icon.x))
    .map(o => iconImage(o.icon.url).then(im => ({ o, im })).catch(() => null)))).filter(Boolean);
  const icon = { ...loc.icon, size: loc.icon.size || ICON_SIZE.first, ...(Number.isFinite(loc.icon.x) ? {} : firstSpot(loc, P.W, P.H)) };

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'dm-lme-overlay';
    overlay.innerHTML = `
      <div class="dm-lme-head">
        <h3>🏰 ${escapeHtml(loc.name || 'Location')}'s icon on the map</h3>
        <span class="dm-lme-spacer"></span>
        <button class="dm-btn" data-ic="cancel">Cancel</button>
        <button class="dm-btn primary" data-ic="done">Done</button>
      </div>
      <div class="dm-lme-body">
        <aside class="dm-lme-tools">
          <div class="dm-hint">Click where it should stand -- the dot is its bottom middle. Scroll to zoom, drag to move the map.
            The other locations' icons are there to size it against.</div>
          <label class="dm-field"><span>How big: <b id="icSizeText"></b></span>
            <input type="range" id="icSize" min="${ICON_SIZE.min}" max="${ICON_SIZE.max}" step="${ICON_SIZE.step}" value="${icon.size}"></label>
          <label class="dm-check"><input type="checkbox" id="icShapes" checked><span>Show the locations' marks</span></label>
        </aside>
        <div class="dm-lme-stage" id="icStage">
          <div class="dm-lme-zoom"><button class="dm-btn small" data-ic="in" title="Zoom in">＋</button><button class="dm-btn small" data-ic="out" title="Zoom out">－</button><button class="dm-btn small" data-ic="fit" title="The whole map">⤢</button></div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    let showShapes = true;
    const sizeText = () => { overlay.querySelector('#icSizeText').textContent = `about ${icon.size} km tall`; };
    sizeText();
    const stage = overlay.querySelector('#icStage');
    const pane = makePane(stage, {
      W: P.W, H: P.H,
      draw: (ctx, v) => {
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(P.shown, v.ox, v.oy, P.W * v.s, P.H * v.s);
        if (showShapes) {
          others.forEach(o => drawShape(ctx, o.shape, v, { faint: true, name: o.icon ? '' : o.name || '' }));
          drawShape(ctx, loc.shape, v, { name: loc.name || '' });
        }
        otherIcons.forEach(({ o, im }) => drawIcon(ctx, im, o.icon, v, { faint: true }));
        drawIcon(ctx, img, icon, v);
      },
      onClick: ([x, y]) => {
        icon.x = Math.round(Math.min(P.W - 1, Math.max(0, x)) * 10) / 10;
        icon.y = Math.round(Math.min(P.H - 1, Math.max(0, y)) * 10) / 10;
        pane.redraw();
      },
    });
    stage.appendChild(stage.querySelector('.dm-lme-zoom'));   // over the canvas
    // in close on the icon to start with (once the pane has fitted itself to the screen)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const r = stage.getBoundingClientRect();
      const v = pane.view;
      v.s = Math.min(r.width / P.W, r.height / P.H) * 3;
      v.ox = r.width / 2 - icon.x * v.s;
      v.oy = r.height / 2 - icon.y * v.s;
      pane.redraw();
    }));
    overlay.querySelector('#icSize').addEventListener('input', (e) => { icon.size = Number(e.target.value); sizeText(); pane.redraw(); });
    overlay.querySelector('#icShapes').addEventListener('change', (e) => { showShapes = e.target.checked; pane.redraw(); });
    const finish = (value) => {
      pane.destroy();
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const onKey = (e) => { if (e.key === 'Escape') finish(undefined); };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ic]');
      if (!b) return;
      const act = b.dataset.ic;
      if (act === 'cancel') finish(undefined);
      else if (act === 'done') finish({ url: icon.url, x: icon.x, y: icon.y, size: icon.size });
      else if (act === 'in') pane.zoom(1.4);
      else if (act === 'out') pane.zoom(1 / 1.4);
      else if (act === 'fit') pane.fit();
    });
  });
}
