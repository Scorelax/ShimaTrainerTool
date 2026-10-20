// DM console -- a location's icon on the region map (the user's call, 2026-10-20): a little model of the place (a
// picture the DM uploads, best a PNG with a see-through background, like the painted cities) standing on the 3D map,
// more to look at than a pin. Picked in the location's form; it stands on the location's mark (map-features.js
// iconSpot -- the user's call, 2026-10-20: never placed apart from it) and is sized in the mark's editor
// (location-map.js), against the painting and every other location's icon, so they keep to scale with each other.
//
// What's kept on the location: icon = { url, size (how tall it stands, in km: the same on every map) } -- an older one
// also has x, y (where it stood before it went with the mark: not used). js/region-map/region-map.js stands it on the
// land, facing the camera. The pictures themselves are kept in a folder on the Pi (the icon library, below).
import { DmAPI } from '../api.js';
import { showCombatConfirm } from '../utils/combat-alert.js';
import { escapeHtml, toast, openDmModal } from './dm-common.js';
import { openPicker } from './picker.js';
import { prepareImage } from './display.js';
import { kmPerPx } from '../region-map/map-version.js';

export const ICON_SIZE = { min: 0.5, max: 30, step: 0.5, first: 5 };   // km tall

const _images = {};
export function iconImage(url) {
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
export function drawIcon(ctx, img, icon, v, { faint = false } = {}) {
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

// ---------------------------------------------------------------------------
// The icon library (the user's call, 2026-10-20): the icons kept in a folder on the Pi (~/pokemon-dnd/images/locations),
// each named "<LocationType>-<LocationName>" -- "Town-Havneby.png" (Town and City both mean a city). Copied in by hand
// or uploaded here: one for a location from its form, or many at once in 🏰 Location icons before the locations are
// made -- a location then finds its own (the same type and name) to use with one click.
// ---------------------------------------------------------------------------

export const ICON_TYPES = { city: '🏙️ City / Town', route: '🛤️ Route', cave: '🕳️ Cave', forest: '🌲 Forest' };
const ICON_SIDE = 600;   // never shown big
const norm = s => String(s || '').trim().toLowerCase();

/** The library's icon for this location (its type and name), if there is one. */
export const iconFor = (library, loc) => library.find(e => e.type === (loc.type || 'city') && norm(e.name) === norm(loc.name));

/** A file's name as an icon: "Town-Havneby.png" -> { type: 'city', name: 'Havneby' } (no known type word: none). */
export function parseIconName(filename) {
  const stem = String(filename || '').replace(/\.[^.]+$/, '');
  const at = stem.indexOf('-');
  const word = at > 0 ? stem.slice(0, at).trim().toLowerCase() : '';
  const type = { city: 'city', town: 'city', route: 'route', cave: 'cave', forest: 'forest' }[word] || '';
  return { type, name: (type ? stem.slice(at + 1) : stem).trim() };
}

/** One icon onto the Pi as "<Type>-<name>" -> its library entry. Locations whose icon was the one it replaces (the same
 * type and name, maybe another picture format) are pointed at the new file -- returned as `moved` (true: save them). */
export async function uploadIcon({ type, name, file }, library, locations = []) {
  const old = library.filter(e => e.type === type && norm(e.name) === norm(name)).map(e => e.url);
  const entry = await DmAPI.saveLocationIcon({ type, name, data: await prepareImage(file, ICON_SIDE) });
  let moved = false;
  locations.forEach((l) => {
    if (l.icon && old.includes(l.icon.url) && l.icon.url !== entry.url) { l.icon = { ...l.icon, url: entry.url }; moved = true; }
  });
  return { entry, moved };
}

/** An icon from the library for `loc` -> its URL (null: none picked). This location's own (the same type and name)
 * first. */
export async function pickLibraryIcon(loc) {
  let library;
  try { library = await DmAPI.locationIcons(); } catch (err) { toast(`Couldn't load the icons: ${err.message}`); return null; }
  const mine = iconFor(library, loc);
  const items = [...(mine ? [mine] : []), ...library.filter(e => e !== mine)].map(e => ({
    key: e.file, label: e.name, image: e.url, search: e.file,
    sub: e === mine ? "✓ This location's" : (ICON_TYPES[e.type] || 'No type in its name'),
  }));
  const picked = await openPicker({
    title: '🏰 Pick an icon',
    items,
    hint: 'The icons in the locations folder on the Pi (~/pokemon-dnd/images/locations).',
    emptyText: 'No icons on the Pi yet -- upload some with 🏰 Location icons, or one with Upload an icon.',
  });
  const key = picked?.keys?.[0];
  return key ? library.find(e => e.file === key)?.url || null : null;
}

/** 🏰 Location icons: every icon in the library by type (each deletable), and many uploaded at once -- each named from
 * its file name ("Town-Havneby.png"), changeable before it goes. `locations`: to say which use an icon, and to point
 * them at a replaced one (`onLocationsChanged` saves them). */
export function openIconLibrary({ locations = [], onLocationsChanged } = {}) {
  let library = [];
  let staged = [];   // [{ file, type, name, preview, status }]
  return openDmModal({
    title: '🏰 Location icons',
    wide: true,
    buttons: [{ label: 'Close', value: null }],
    html: `<div class="dm-icl">
      <div class="dm-icl-bar">
        <button class="dm-btn primary" data-icl="pick">⬆ Upload icons</button>
        <span class="dm-hint">Kept on the Pi in ~/pokemon-dnd/images/locations, named "&lt;Type&gt;-&lt;Location name&gt;" -- Town-Havneby,
          Cave-Mossy Cave. A location with the same type and name finds its icon on its own.</span>
      </div>
      <div class="dm-icl-stage" hidden></div>
      <div class="dm-icl-list"><div class="dm-loading">Loading…</div></div>
    </div>`,
    onOpen: (body) => {
      const listBox = body.querySelector('.dm-icl-list');
      const stage = body.querySelector('.dm-icl-stage');
      const usedBy = e => locations.filter(l => l.icon?.url === e.url);
      const drawList = () => {
        const groups = [...Object.keys(ICON_TYPES), ''].map((t) => {
          const here = library.filter(e => e.type === t);
          if (!here.length) return '';
          return `<div class="dm-cs-group-title">${t ? ICON_TYPES[t] : '❔ No type in the name'}</div>
            <div class="dm-icl-grid">${here.map((e) => {
              const users = usedBy(e);
              const own = locations.find(l => iconFor([e], l));
              const note = users.length ? `On ${users.map(l => l.name).join(', ')}`
                : own ? (own.icon?.url ? 'Its location uses another icon' : 'Its location has no icon yet') : 'No location uses it';
              return `<div class="dm-icl-card">
                <span class="dm-world-icon"><img src="${escapeHtml(e.url)}" alt="" loading="lazy"></span>
                <strong title="${escapeHtml(e.file)}">${escapeHtml(e.name)}</strong>
                <small>${escapeHtml(note)}</small>
                <button class="dm-icon-btn danger" data-icl-del="${escapeHtml(e.file)}" title="Delete it from the Pi">🗑</button>
              </div>`;
            }).join('')}</div>`;
        }).join('');
        listBox.innerHTML = groups || '<div class="dm-hint">No icons on the Pi yet.</div>';
      };
      const statusOf = (s) => {
        if (s.status === 'done') return '✓ Uploaded';
        if (s.status === 'sending') return 'Uploading…';
        if (s.status) return s.status;
        return library.some(e => e.type === s.type && norm(e.name) === norm(s.name)) ? 'Replaces the one there' : '';
      };
      const drawStage = () => {
        stage.hidden = !staged.length;
        if (!staged.length) { stage.innerHTML = ''; return; }
        const waiting = staged.filter(s => s.status !== 'done');
        stage.innerHTML = `<div class="dm-cs-group-title">To upload</div>
          ${staged.map((s, i) => {
            const done = s.status === 'done';
            return `<div class="dm-icl-row">
              <span class="dm-world-icon small"><img src="${s.preview}" alt=""></span>
              <select class="dm-select" data-icl-type="${i}" ${done ? 'disabled' : ''}><option value="">Type…</option>${Object.entries(ICON_TYPES).map(([k, lab]) => `<option value="${k}" ${s.type === k ? 'selected' : ''}>${lab}</option>`).join('')}</select>
              <input class="dm-input" data-icl-name="${i}" value="${escapeHtml(s.name)}" placeholder="Location name" maxlength="80" ${done ? 'disabled' : ''}>
              <span class="dm-icl-status ${done ? 'ok' : s.status && s.status !== 'sending' ? 'bad' : ''}">${escapeHtml(statusOf(s))}</span>
              ${done ? '' : `<button class="dm-icon-btn danger" data-icl-drop="${i}" title="Don't upload it">✕</button>`}
            </div>`;
          }).join('')}
          <div class="dm-row"><button class="dm-btn primary" data-icl="send" ${waiting.length ? '' : 'disabled'}>Upload ${waiting.length} icon${waiting.length === 1 ? '' : 's'}</button>
            <button class="dm-btn" data-icl="clear">${waiting.length ? 'Cancel' : 'Done'}</button></div>`;
      };
      const reload = async () => {
        try {
          library = await DmAPI.locationIcons();
          drawList();
        } catch (err) {
          listBox.innerHTML = `<div class="dm-cs-empty">Couldn't load the icons: ${escapeHtml(err.message)}</div>`;
        }
      };
      reload();
      body.addEventListener('input', (e) => {
        const n = e.target.dataset.iclName;
        if (n !== undefined) { staged[Number(n)].name = e.target.value; staged[Number(n)].status = ''; }
      });
      body.addEventListener('change', (e) => {
        const t = e.target.dataset.iclType;
        if (t !== undefined) { staged[Number(t)].type = e.target.value; staged[Number(t)].status = ''; drawStage(); }
      });
      body.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-icl], [data-icl-del], [data-icl-drop]');
        if (!b) return;
        if (b.dataset.icl === 'pick') {
          const el = document.createElement('input');
          el.type = 'file';
          el.accept = 'image/png,image/webp,image/jpeg,image/gif';
          el.multiple = true;
          el.addEventListener('change', () => {
            [...(el.files || [])].forEach(file => staged.push({ file, ...parseIconName(file.name), preview: URL.createObjectURL(file), status: '' }));
            drawStage();
          });
          el.click();
        } else if (b.dataset.icl === 'clear') {
          staged.forEach(s => URL.revokeObjectURL(s.preview));
          staged = [];
          drawStage();
        } else if (b.dataset.iclDrop !== undefined) {
          URL.revokeObjectURL(staged[Number(b.dataset.iclDrop)].preview);
          staged.splice(Number(b.dataset.iclDrop), 1);
          drawStage();
        } else if (b.dataset.icl === 'send') {
          let moved = false;
          for (const s of staged.filter(x => x.status !== 'done')) {
            if (!s.type) { s.status = 'Pick its type'; continue; }
            if (!s.name.trim()) { s.status = 'Give it a name'; continue; }
            s.status = 'sending';
            drawStage();
            try {
              const r = await uploadIcon(s, library, locations);
              moved = moved || r.moved;
              library = [...library.filter(x => !(x.type === r.entry.type && norm(x.name) === norm(r.entry.name))), r.entry];
              s.status = 'done';
            } catch (err) {
              s.status = err.message;
            }
          }
          drawStage();
          await reload();
          if (moved) onLocationsChanged?.();
        } else if (b.dataset.iclDel) {
          const entry = library.find(x => x.file === b.dataset.iclDel);
          if (!entry) return;
          const users = usedBy(entry);
          const lose = users.length ? ` ${users.map(l => l.name).join(', ')} ${users.length === 1 ? 'loses its' : 'lose their'} icon on the map.` : '';
          if (!await showCombatConfirm(`Delete the icon "${entry.file}" from the Pi?${lose}`, { title: 'Delete icon', yesLabel: 'Delete', noLabel: 'Cancel' })) return;
          try {
            await DmAPI.deleteLocationIcon(entry.file);
            if (users.length) { users.forEach((l) => { delete l.icon; }); onLocationsChanged?.(); }
          } catch (err) {
            toast(`Couldn't delete it: ${err.message}`);
          }
          await reload();
        }
      });
    },
  });
}
