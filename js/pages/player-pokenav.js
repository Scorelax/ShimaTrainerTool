// The players' PokéNav (the user's call, 2026-10-21): the region map the table's board screen shows -- the same 3D
// island, the DM's locations (not the secret ones) with their icons and names, and the party's marker where the DM put
// it -- but on the player's own device, to move round, zoom and turn as they like (js/region-map/region-map.js, not
// view only). Just to look at: where the party is is still set in the DM console's PokéNav, and the board screen still
// follows the DM there, not this. Opened from the trainer card (the button left of the party); kept up to date by the
// app's live connection (live-updates.js's 'app:dm-state', 'app:live-resync').
//
// It opens on the DM console PokéNav's default view, and its compass goes back to it (the user's call, 2026-10-21): the
// whole island looked at straight down, north up, filling the screen.
//
// A location tapped (its name or its icon) opens a panel at the side (the user's call, 2026-10-21): its name, what it's
// part of, its points of interest as the DM wrote them in Admin › Locations, and the places inside it (each tappable) --
// not the DM's description, which can hold notes for the DM only.
//
// mountPlayerPokenav(root, { onBack }) -> { ready, destroy }.
import { DmAPI } from '../api.js';
import { parentOf } from '../region-map/map-version.js';

const PARTY_ICON = 'assets/region-map/party-marker.png';
const HOME_AZIMUTH = 0; // north up -- the DM console PokéNav's default view (js/dm/pokenav.js)
// (as the DM console's location types, js/dm/admin-world.js -- not imported: that's the DM's code)
const TYPES = { region: '🗺️ Region', city: '🏙️ City', route: '🛤️ Route', cave: '🕳️ Cave', forest: '🌲 Forest', landmark: '🗿 Landmark', building: '🏠 Building' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The map's stylesheet, added to the app's page once (the app doesn't load it otherwise). */
function useMapStyles() {
  if (document.querySelector('link[data-rmap-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'css/region-map.css';
  link.dataset.rmapCss = '';
  document.head.appendChild(link);
}

export function mountPlayerPokenav(root, { onBack } = {}) {
  useMapStyles();
  // the page under it held still (no scrollbar beside the map, no bounce dragging it on a phone) until it's left
  const scrollWas = document.documentElement.style.overflow;
  document.documentElement.style.overflow = 'hidden';
  root.innerHTML = `<div class="pnav-map" id="pnavMap"></div>
    <button class="pnav-party" id="pnavParty" hidden title="Where the party is" aria-label="Where the party is"><img src="${PARTY_ICON}" alt=""></button>
    <aside class="pnav-panel" id="pnavPanel" aria-hidden="true"></aside>`;
  const partyBtn = root.querySelector('#pnavParty');
  const panel = root.querySelector('#pnavPanel');
  let shown = [];           // the locations the players may see
  let openId = null;        // the one in the panel
  let map = null;
  let destroyed = false;
  let partyAt = null;       // where the party is, when the players may see it (null: not shown)
  let shownIds = new Set(); // the locations on the map (the secret ones left out)
  const off = [];
  const on = (type, fn) => { window.addEventListener(type, fn); off.push(() => window.removeEventListener(type, fn)); };

  // The DM's locations on the map -- none of the secret ones, as on the board screen; the towns the map was made with
  // until any are marked.
  const showLocations = async () => {
    const list = await DmAPI.getState('locations').catch(() => undefined);
    if (list === undefined || destroyed) return;
    const marked = Array.isArray(list) ? list.filter(l => l && (l.shape || l.icon?.url) && !l.secret) : [];
    shownIds = new Set(marked.filter(l => l.shape).map(l => l.id));
    shown = marked;
    map?.setLocations(marked.length ? marked : null);
    syncParty();
    if (openId) openPanel(openId, { fly: false });   // the DM changed it meanwhile (or took it away)
  };

  /** The panel for a location (gone, or a secret one now: closed). */
  function openPanel(id, { fly = true } = {}) {
    const l = shown.find(x => x.id === id);
    if (!l) { closePanel(); return; }
    openId = id;
    if (fly) map?.flyToLocation(id);
    map?.highlight(id);
    const up = parentOf(l, shown);
    const pois = (l.pois || []).map(p => String(p).trim()).filter(Boolean);
    const inside = shown.filter(x => parentOf(x, shown) === l).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    panel.innerHTML = `<div class="pnav-panel-head">
        <div><div class="pnav-panel-type">${TYPES[l.type || 'city'] || ''}</div><h2>${esc(l.name || 'Unnamed')}</h2>
          ${up ? `<button class="pnav-panel-up" data-open="${esc(up.id)}">in ${esc(up.name || 'Unnamed')}</button>` : ''}</div>
        <button class="pnav-panel-close" data-close aria-label="Close">✕</button>
      </div>
      ${l.id === partyAt ? `<div class="pnav-panel-here"><img src="${PARTY_ICON}" alt=""> The party is here</div>` : ''}
      <h3>Points of interest</h3>
      ${pois.length ? `<ul class="pnav-panel-pois">${pois.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : '<p class="pnav-panel-none">Nothing noted here yet.</p>'}
      ${inside.length ? `<h3>Places here</h3><div class="pnav-panel-inside">${inside.map(x => `<button data-open="${esc(x.id)}">${(TYPES[x.type || 'city'] || '').split(' ')[0]} ${esc(x.name || 'Unnamed')}</button>`).join('')}</div>` : ''}`;
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
  }
  function closePanel() {
    openId = null;
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
    map?.highlight(null);
  }
  panel.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { closePanel(); return; }
    const b = e.target.closest('[data-open]');
    if (b) openPanel(b.dataset.open);
  });
  // ...and where the party is, unless the DM keeps it off the table's map (then off this one too)
  const showParty = async () => {
    const p = await DmAPI.getState('party-location').catch(() => undefined);
    if (p === undefined || destroyed) return;
    partyAt = p && p.onBoard !== false ? p.locationId || null : null;
    map?.setParty(partyAt);
    syncParty();
  };
  // the party button: only while the party's marker is on the map (a secret place shows nothing) -- flies there, turning
  // the map north up on the way (the user's call, 2026-10-22)
  const syncParty = () => { partyBtn.hidden = !(partyAt && shownIds.has(partyAt)); };
  partyBtn.addEventListener('click', () => { if (partyAt) map?.flyToLocation(partyAt, { azimuth: HOME_AZIMUTH }); });

  const mount = async () => {
    const { mountRegionMap } = await import('../region-map/region-map.js');
    if (destroyed) return;
    map = mountRegionMap(root.querySelector('#pnavMap'), { onBack, title: true, homeAzimuth: HOME_AZIMUTH, onPick: id => openPanel(id, { fly: false }) });
    showLocations();
    showParty();
    await map.ready;
    map?.home({ ms: 0, azimuth: HOME_AZIMUTH, fill: true });
  };

  // The DM switched to another map (Admin › Locations): made again on it.
  const remount = async () => {
    const { currentMap } = await import('../region-map/map-version.js');
    const next = await currentMap({ fresh: true });
    if (destroyed || !map || next.id === map.mapId) return;
    map.destroy();
    map = null;
    await mount();
  };

  on('app:dm-state', (e) => {
    if (e.detail?.key === 'locations') showLocations();
    if (e.detail?.key === 'party-location') showParty();
    if (e.detail?.key === 'region-map') remount().catch(err => console.warn('[PokéNav] The new map could not be shown:', err));
  });
  on('app:live-resync', () => { showLocations(); showParty(); remount().catch(() => {}); });

  const ready = mount();
  return {
    ready,
    destroy() {
      destroyed = true;
      document.documentElement.style.overflow = scrollWas;
      off.forEach(f => f());
      map?.destroy();
      map = null;
    },
  };
}
