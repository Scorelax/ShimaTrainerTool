// DM console -- a region's own picture (the user's call, 2026-10-21): a region with no picture of its own is shown as
// the region itself -- its stretch of the map, the land it covers lit and everything round it dimmed -- in place of the
// 📍 a single place gets (Admin › Locations' list and form, the PokéNav's location info). Drawn from the map in use's
// painted picture (the one the map editor shows), made once per shape and kept while the page is open.
import { currentMap } from '../region-map/map-version.js';
import { shapeBounds } from '../region-map/map-features.js';

const OUT_W = 480, OUT_H = 300;
let _painted = null;   // { id (the map's), img: Promise<HTMLImageElement> }
const _made = new Map();   // shape key -> data URL (ready)
const _making = new Map(); // shape key -> Promise<data URL | null>
let _mapId = null;          // the map the last picture was asked for on

/** Whether `l` gets a region picture: a region marked as an area, with no picture of its own. */
export const wantsRegionPicture = l => !l?.image && l?.type === 'region' && l.shape?.kind === 'area';

const keyOf = (mapId, l) => { const b = shapeBounds(l.shape); return `${mapId}|${l.id}|${b.x0},${b.y0},${b.x1},${b.y1}|${JSON.stringify(l.shape.rings).length}`; };

function painted(map) {
  if (_painted?.id !== map.id) {
    _painted = {
      id: map.id,
      img: new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Couldn't load the map"));
        img.src = map.files.painted;
      }),
    };
  }
  return _painted.img;
}

/** -> a data URL of the region's picture (null: not a region on the map, or the map couldn't be loaded). */
export async function regionPicture(l) {
  if (l?.type !== 'region' || l.shape?.kind !== 'area') return null;
  const map = await currentMap();
  _mapId = map.id;
  const key = keyOf(map.id, l);
  if (_made.has(key)) return _made.get(key);
  if (!_making.has(key)) _making.set(key, draw(map, l).then((url) => { if (url) _made.set(key, url); return url; }).catch(() => null).finally(() => _making.delete(key)));
  return _making.get(key);
}

async function draw(map, l) {
  const img = await painted(map);
  const k = img.naturalWidth / map.W;   // painting pixel -> painted picture pixel
  const b = shapeBounds(l.shape);
  // the region with some of what's round it, widened (or heightened) to the picture's shape
  let w = (b.x1 - b.x0) * 1.2 + 20, h = (b.y1 - b.y0) * 1.2 + 20;
  if (w / h < OUT_W / OUT_H) w = h * (OUT_W / OUT_H); else h = w / (OUT_W / OUT_H);
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  const x0 = cx - w / 2, y0 = cy - h / 2;
  const c = document.createElement('canvas');
  c.width = OUT_W; c.height = OUT_H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0c2240';
  ctx.fillRect(0, 0, OUT_W, OUT_H);
  ctx.drawImage(img, x0 * k, y0 * k, w * k, h * k, 0, 0, OUT_W, OUT_H);
  const s = OUT_W / w;
  const ring = () => l.shape.rings.forEach((r) => { r.forEach(([x, y], i) => (i ? ctx.lineTo((x - x0) * s, (y - y0) * s) : ctx.moveTo((x - x0) * s, (y - y0) * s))); ctx.closePath(); });
  // everything outside it dimmed, the land in it a little brighter -- no line round it (the map's own look: the
  // 3D map lights a region the same way)
  ctx.beginPath();
  ctx.rect(0, 0, OUT_W, OUT_H);
  ring();
  ctx.fillStyle = 'rgba(6, 12, 28, 0.62)';
  ctx.fill('evenodd');
  ctx.save();
  ctx.beginPath();
  ring();
  ctx.clip('evenodd');
  ctx.fillStyle = 'rgba(255, 248, 222, 0.12)';
  ctx.fillRect(0, 0, OUT_W, OUT_H);
  ctx.restore();
  return c.toDataURL('image/jpeg', 0.85);
}

/** The picture now, when it's been made already (drawn straight into the HTML, no flicker) -- else null. */
export function regionPictureNow(l) {
  if (!wantsRegionPicture(l) || !_mapId) return null;
  return _made.get(keyOf(_mapId, l)) || null;
}

/** The HTML for a picture box's inside: the region's picture (now, or once it's made), else `fallback`. */
export function regionPictureHtml(l, fallback) {
  if (!wantsRegionPicture(l)) return fallback;
  const now = regionPictureNow(l);
  return now ? `<img src="${now}" alt="">` : `<span class="dm-region-pic" data-region-pic="${String(l.id).replace(/"/g, '&quot;')}">🗺️</span>`;
}

/** Each `[data-region-pic="<location id>"]` in `box` given its region's picture once it's made. */
export function fillRegionPictures(box, locations) {
  box?.querySelectorAll('[data-region-pic]:not([data-filled])').forEach((el) => {
    el.dataset.filled = '1';
    const l = locations.find(x => x.id === el.dataset.regionPic);
    regionPicture(l).then((url) => { if (url && el.isConnected) el.innerHTML = `<img src="${url}" alt="">`; });
  });
}
