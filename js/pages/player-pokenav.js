// The players' PokéNav (the user's call, 2026-10-21): the region map the table's board screen shows -- the same 3D
// island, the DM's locations (not the secret ones) with their icons and names, and the party's marker where the DM put
// it -- but on the player's own device, to move round, zoom and turn as they like (js/region-map/region-map.js, not
// view only). Just to look at: where the party is is still set in the DM console's PokéNav, and the board screen still
// follows the DM there, not this. Opened from the trainer info page (the button beside the Pokédex); kept up to date
// by the app's live connection (live-updates.js's 'app:dm-state', 'app:live-resync').
//
// mountPlayerPokenav(root, { onBack }) -> { ready, destroy }.
import { DmAPI } from '../api.js';

const PARTY_ICON = 'assets/region-map/party-marker.png';

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
    <button class="pnav-party" id="pnavParty" hidden title="Where the party is"><img src="${PARTY_ICON}" alt=""><span>The party</span></button>`;
  const partyBtn = root.querySelector('#pnavParty');
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
    map?.setLocations(marked.length ? marked : null);
    syncParty();
  };
  // ...and where the party is, unless the DM keeps it off the table's map (then off this one too)
  const showParty = async () => {
    const p = await DmAPI.getState('party-location').catch(() => undefined);
    if (p === undefined || destroyed) return;
    partyAt = p && p.onBoard !== false ? p.locationId || null : null;
    map?.setParty(partyAt);
    syncParty();
  };
  // the party button: only while the party's marker is on the map (a secret place shows nothing)
  const syncParty = () => { partyBtn.hidden = !(partyAt && shownIds.has(partyAt)); };
  partyBtn.addEventListener('click', () => { if (partyAt) map?.flyToLocation(partyAt); });

  const mount = async () => {
    const { mountRegionMap } = await import('../region-map/region-map.js');
    if (destroyed) return;
    map = mountRegionMap(root.querySelector('#pnavMap'), { onBack, title: true });
    showLocations();
    showParty();
    await map.ready;
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
